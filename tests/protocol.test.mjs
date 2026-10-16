import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readSse, endpointFor, buildUpstream, normalizeEvent } from '../server/protocol.mjs';

test('SSE survives every UTF-8 byte boundary, CRLF, comments, multiline, and EOF', async () => {
  const input = Buffer.from(': heartbeat\r\n\r\nevent: delta\r\ndata: {"text":"你好🌱"}\r\n\r\ndata: first\ndata: second\n\ndata: [DONE]');
  const chunks = Array.from(input, byte => Buffer.from([byte]));
  const results = [];
  for await (const data of readSse(Readable.from(chunks))) results.push(data);
  assert.deepEqual(results, ['{"text":"你好🌱"}', 'first\nsecond', '[DONE]']);
});

test('API endpoints preserve custom base paths and avoid duplicate endpoint suffixes', () => {
  assert.equal(endpointFor('https://example.com', 'openai').href, 'https://example.com/v1/chat/completions');
  assert.equal(endpointFor('http://localhost:11434/v1/', 'openai').href, 'http://localhost:11434/v1/chat/completions');
  assert.equal(endpointFor('https://example.com/custom/v1/chat/completions', 'openai').pathname, '/custom/v1/chat/completions');
  assert.equal(endpointFor('https://example.com/v1', 'anthropic').pathname, '/v1/messages');
  assert.throws(() => endpointFor('file:///etc/passwd', 'openai'));
  assert.throws(() => endpointFor('https://user:pass@example.com', 'openai'));
});

test('provider adapters validate inputs and keep Claude system prompts separate', () => {
  const input = { provider: 'anthropic', baseUrl: 'https://example.com/v1', model: 'test', apiKey: 'test-key', messages: [{ role: 'user', content: '你好', extra: 'discard me' }], systemPrompt: '中文' };
  const result = buildUpstream(input);
  assert.equal(result.headers['anthropic-version'], '2023-06-01');
  assert.equal(result.headers['x-api-key'], 'test-key');
  assert.equal(result.body.system, '中文');
  assert.equal(result.body.max_tokens, 4096);
  assert.deepEqual(result.body.messages, [{ role: 'user', content: '你好' }]);
  const openai = buildUpstream({ ...input, provider: 'openai' });
  assert.equal(openai.headers.Authorization, 'Bearer test-key');
  assert.equal(openai.body.messages[0].role, 'system');
  assert.throws(() => buildUpstream({ ...input, model: '' }));
  assert.throws(() => buildUpstream({ ...input, messages: [{ role: 'system', content: 'injected' }] }));
});

test('stream adapters handle text, completion, usage-only events, and errors', () => {
  assert.deepEqual(normalizeEvent('{"choices":[{"delta":{"content":"你好"}}]}', 'openai'), { type: 'delta', text: '你好' });
  assert.equal(normalizeEvent('{"choices":[],"usage":{}}', 'openai'), null);
  assert.deepEqual(normalizeEvent('[DONE]', 'openai'), { type: 'done' });
  assert.deepEqual(normalizeEvent('{"type":"content_block_delta","delta":{"type":"text_delta","text":"你好"}}', 'anthropic'), { type: 'delta', text: '你好' });
  assert.deepEqual(normalizeEvent('{"type":"message_stop"}', 'anthropic'), { type: 'done' });
  assert.throws(() => normalizeEvent('{"type":"error","error":{"message":"rate limited"}}', 'anthropic'), /rate limited/);
});
