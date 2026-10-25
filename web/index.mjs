import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildUpstream, normalizeEvent, readSse } from './protocol.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8' };
const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('请求需要使用 JSON 格式。');
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 2_000_000) throw new Error('对话过长，请新建对话后重试。');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function handleChat(req, res) {
  let secret = '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('模型响应超时，请重试。')), 180_000);
  timer.unref();
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  const send = event => { if (!res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`); };
  try {
    const input = await readJson(req);
    secret = typeof input?.apiKey === 'string' ? input.apiKey : '';
    const upstream = buildUpstream(input);
    const response = await fetch(upstream.url, {
      method: 'POST', headers: upstream.headers, body: JSON.stringify(upstream.body),
      redirect: 'error', signal: controller.signal,
    });
    if (!response.ok) {
      let message = `模型服务返回 HTTP ${response.status}。`;
      try {
        const detail = await response.json();
        message = detail.error?.message || detail.message || message;
      } catch { /* Do not expose proxy HTML or credentials. */ }
      throw new Error(String(message).replaceAll(input.apiKey || '\0', '[已隐藏]').slice(0, 600));
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    if (response.headers.get('content-type')?.includes('application/json')) {
      const result = await response.json();
      const text = input.provider === 'anthropic'
        ? result.content?.filter(item => item.type === 'text').map(item => item.text).join('')
        : result.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text) throw new Error('模型没有返回文本内容。');
      send({ type: 'delta', text });
      send({ type: 'done' });
    } else {
      let completed = false;
      for await (const data of readSse(response.body)) {
        const event = normalizeEvent(data, input.provider);
        if (event) send(event);
        if (event?.type === 'done') { completed = true; break; }
      }
      if (!completed) throw new Error('连接提前中断，已保留收到的内容。请重试。');
    }
    res.end();
  } catch (error) {
    if (res.destroyed) return;
    const message = (controller.signal.aborted ? '请求已取消或响应超时。' : error.message || '无法连接模型服务。').replaceAll(secret || '\0', '[已隐藏]').slice(0, 600);
    if (res.headersSent) { send({ type: 'error', message }); res.end(); }
    else json(res, 400, { error: message });
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export async function startServer({ port = 5180, dev = false } = {}) {
  const vite = dev ? await (await import('vite')).createServer({ root, server: { middlewareMode: true }, appType: 'spa' }) : null;
  const dist = resolve(root, 'dist');
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const serverPort = server.address()?.port;
    const allowedHosts = [`127.0.0.1:${serverPort}`, `localhost:${serverPort}`];
    if (!allowedHosts.includes(req.headers.host)) return json(res, 403, { error: '访问来源不受支持。' });
    if (req.headers.origin && !allowedHosts.some(host => req.headers.origin === `http://${host}`)) {
      return json(res, 403, { error: '跨站请求已被拒绝。' });
    }
    const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
    if (pathname === '/api/health') return json(res, 200, { status: 'ok', app: 'clay-chat', version: '0.1.0' });
    if (pathname === '/api/chat' && req.method === 'POST') return handleChat(req, res);
    if (pathname.startsWith('/api/')) return json(res, 404, { error: '接口不存在。' });
    if (vite) return vite.middlewares(req, res);
    res.setHeader('Content-Security-Policy', csp);
    if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: '请求方法不受支持。' });
    try {
      const decoded = decodeURIComponent(pathname);
      const file = resolve(dist, `.${decoded === '/' ? '/index.html' : decoded}`);
      if (!file.startsWith(dist + sep)) return json(res, 403, { error: '路径不受支持。' });
      if (!(await stat(file)).isFile()) return json(res, 404, { error: '文件不存在。' });
      res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
      res.setHeader('Cache-Control', pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      if (req.method === 'HEAD') return res.end();
      res.end(await readFile(file));
    } catch {
      json(res, 404, { error: '页面未找到，请先运行 npm run build。' });
    }
  });
  await new Promise((resolveReady, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolveReady);
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  return { server, url, async close() { await vite?.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const instance = await startServer({ port: Number(process.env.PORT || 5180), dev: process.argv.includes('--dev') });
    console.log(`\n  Clay Chat is ready\n  Local: ${instance.url}\n  Press Ctrl+C to stop.\n`);
    const shutdown = async () => { await instance.close(); process.exit(0); };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch (error) { console.error(`启动失败：${error.message}`); process.exitCode = 1; }
}
