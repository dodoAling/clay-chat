import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from '../server/index.mjs';
import { readSse } from '../server/protocol.mjs';

async function fixture(t, handler) {
  const upstream = http.createServer(handler);
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const app = await startServer({ port: 0 });
  t.after(async () => { await app.close(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); });
  return { ...app, baseUrl: `http://127.0.0.1:${upstream.address().port}/v1` };
}
function payload(baseUrl, extra = {}) { return { provider: 'openai', baseUrl, model: 'test-model', apiKey: 'secret-test-value', messages: [{ role: 'user', content: '你好' }], ...extra }; }
async function post(url, body, headers = {}) { return fetch(url + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }); }
async function events(response) { const result = []; for await (const data of readSse(response.body)) result.push(JSON.parse(data)); return result; }

test('actual HTTP proxy forwards and normalizes both provider protocols', async t => {
  let received;
  const app = await fixture(t, async (req, res) => {
    let content = ''; for await (const chunk of req) content += chunk;
    received = { headers: req.headers, path: req.url, body: JSON.parse(content) };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const data = req.url.endsWith('/messages')
      ? 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"你好🌱"}}\r\n\r\ndata: {"type":"message_stop"}\r\n\r\n'
      : 'data: {"choices":[{"delta":{"content":"你好🌱"}}]}\n\ndata: [DONE]\n\n';
    for (const byte of Buffer.from(data)) res.write(Buffer.from([byte]));
    res.end();
  });
  const openai = await post(app.url, payload(app.baseUrl));
  assert.equal(openai.status, 200);
  assert.deepEqual(await events(openai), [{ type: 'delta', text: '你好🌱' }, { type: 'done' }]);
  assert.equal(received.path, '/v1/chat/completions');
  assert.equal(received.headers.authorization, 'Bearer secret-test-value');
  const claude = await post(app.url, payload(app.baseUrl, { provider: 'anthropic', systemPrompt: '中文回答' }));
  assert.deepEqual(await events(claude), [{ type: 'delta', text: '你好🌱' }, { type: 'done' }]);
  assert.equal(received.path, '/v1/messages');
  assert.equal(received.body.system, '中文回答');
  assert.equal(received.headers['x-api-key'], 'secret-test-value');
});

test('proxy preserves partial output and reports a truncated upstream stream', async t => {
  const app = await fixture(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'); });
  const result = await events(await post(app.url, payload(app.baseUrl)));
  assert.equal(result[0].text, 'partial');
  assert.equal(result[1].type, 'error');
  assert.match(result[1].message, /连接提前中断/);
});

test('upstream authentication errors are readable without reflecting the key', async t => {
  const app = await fixture(t, (_req, res) => { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Invalid key: secret-test-value' } })); });
  const result = await post(app.url, payload(app.baseUrl));
  assert.equal(result.status, 400);
  const body = await result.json();
  assert.match(body.error, /Invalid key/);
  assert.ok(!body.error.includes('secret-test-value'));
});

test('local proxy rejects foreign origins, unsupported payloads and invalid model IDs', async t => {
  const app = await fixture(t, (_req, res) => res.end());
  assert.equal((await post(app.url, payload(app.baseUrl), { Origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await post(app.url, payload(app.baseUrl, { model: '' }))).status, 400);
  assert.equal((await fetch(app.url + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 400);
  assert.equal((await fetch(app.url + '/api/health')).status, 200);
  const homepage = await fetch(app.url);
  assert.equal(homepage.status, 200);
  assert.match(homepage.headers.get('content-security-policy'), /script-src 'self'/);
});

test('non-streaming compatible services still return normalized text', async t => {
  const app = await fixture(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"choices":[{"message":{"content":"fallback"}}]}'); });
  assert.deepEqual(await events(await post(app.url, payload(app.baseUrl))), [{ type: 'delta', text: 'fallback' }, { type: 'done' }]);
});

test('canceling a client stream closes its upstream connection', async t => {
  let closed = false;
  const app = await fixture(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const interval = setInterval(() => res.write('data: {"choices":[{"delta":{"content":"x"}}]}\n\n'), 20);
    res.on('close', () => { closed = true; clearInterval(interval); });
  });
  const controller = new AbortController();
  const response = await fetch(app.url + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload(app.baseUrl)), signal: controller.signal });
  const reader = response.body.getReader(); await reader.read(); controller.abort();
  for (let attempt = 0; attempt < 30 && !closed; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(closed, true);
});
