import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import http from 'node:http';
import net from 'node:net';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const binary = process.env.CLAY_CHAT_DESKTOP_BINARY || join(root, 'desktop', 'src-tauri', 'target', 'release', 'clay-chat.exe');
await access(binary);
const artifacts = join(root, '.artifacts', 'native-verification');
const profile = join(artifacts, `profile-${Date.now()}`);
await mkdir(profile, { recursive: true });
const checks = [];
const errors = [];
const requests = [];
let slowServed = false;
let canceledUpstream = false;
let canceledJson = false;
const upstream = http.createServer(async (req, res) => {
  let data = ''; for await (const chunk of req) data += chunk;
  const body = JSON.parse(data);
  requests.push({ path: req.url, headers: req.headers, body });
  if (body.messages.at(-1)?.content.includes('原生取消JSON')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"choices":[{"message":{"content":"');
    res.on('close', () => { canceledJson = true; });
    return;
  }
  if (body.messages.at(-1)?.content.includes('原生错误测试')) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end('{"error":{"message":"Invalid key: native-claude-key"}}');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  if (!slowServed && body.messages.at(-1)?.content.includes('原生取消流')) {
    slowServed = true;
    const timer = setInterval(() => res.write('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"slow"}}\n\n'), 30);
    res.on('close', () => { clearInterval(timer); canceledUpstream = true; });
    return;
  }
  const text = 'Tauri Rust 原生代理测试通过：你好，世界 🌱。';
  const event = req.url.endsWith('/messages') ? { type: 'content_block_delta', delta: { type: 'text_delta', text } } : { choices: [{ delta: { content: text } }] };
  res.write(`data: ${JSON.stringify(event)}\r\n\r\n`);
  res.end(req.url.endsWith('/messages') ? 'data: {"type":"message_stop"}\r\n\r\n' : 'data: [DONE]\r\n\r\n');
});
await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${upstream.address().port}/v1`;
let child;
let browser;
let childLog = '';

async function launch() {
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  child = spawn(binary, [], {
    cwd: root, windowsHide: false,
    env: { ...process.env, CLAY_CHAT_DATA_DIR: profile, WEBVIEW2_USER_DATA_FOLDER: join(profile, 'webview'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', data => { childLog += data; });
  child.stderr.on('data', data => { childLog += data; });
  let connected = false;
  for (let i = 0; i < 160; i++) {
    if (child.exitCode !== null) throw new Error(`Desktop exited early (${child.exitCode}): ${childLog.slice(-2000)}`);
    try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) { connected = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(connected, 'WebView2 debugging endpoint is ready');
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  let page = context.pages()[0];
  if (!page) page = await context.waitForEvent('page');
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30000 });
  return page;
}
async function close(page) {
  const exit = new Promise(resolve => child.once('exit', resolve));
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  let timeout;
  try { await Promise.race([exit, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Desktop did not close')), 10000); })]); }
  finally { clearTimeout(timeout); }
  await browser.close().catch(() => {}); browser = null; child = null;
}
async function complete(page) { await page.getByRole('button', { name: '停止生成', exact: true }).waitFor({ state: 'hidden', timeout: 20000 }); }
try {
  let page = await launch();
  await page.getByRole('heading', { name: /给想法一点/ }).waitFor();
  assert.equal(await page.evaluate(() => window.clay?.isDesktop), true);
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await page.locator('.desktop-titlebar').count(), 1);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: 'macOS', exact: true }).click();
  assert.equal(await page.locator('.desktop-titlebar.mac').count(), 1);
  assert.equal(await page.locator('.traffic-lights button').count(), 3);
  await page.getByRole('button', { name: 'Windows', exact: true }).click();
  assert.equal(await page.locator('.desktop-titlebar.mac').count(), 0);
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.welcome')).opacity) > .999);
  await page.screenshot({ path: join(artifacts, 'welcome-desktop.png'), animations: 'disabled' });
  checks.push('Embedded Tauri UI and native window controls');

  await page.getByRole('textbox', { name: '消息输入框' }).fill('桌面端独立启动测试');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await complete(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: 'OpenAI 兼容', exact: true }).click();
  await page.getByLabel(/接口地址/).fill(baseUrl);
  await page.getByLabel('模型 ID', { exact: true }).fill('native-mock');
  await page.getByLabel(/^API Key/).fill('native-test-key');
  await page.getByRole('button', { name: /保存设置/ }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('textbox', { name: '消息输入框' }).fill('验证 Rust 请求');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await complete(page);
  assert.match(await page.getByRole('article', { name: '助手消息' }).last().innerText(), /Tauri Rust 原生代理测试通过/);
  assert.equal(requests.at(-1).headers.authorization, 'Bearer native-test-key');
  assert.equal(requests.at(-1).path, '/v1/chat/completions');
  assert.ok(requests.at(-1).body.messages.some(message => message.content === '桌面端独立启动测试'));
  const secretRoundTrip = await page.evaluate(async () => await window.clay.loadSecret());
  assert.equal(secretRoundTrip, 'native-test-key');
  const stored = await readFile(join(profile, 'workspace.json'), 'utf8');
  assert.ok(!stored.includes('native-test-key'));
  checks.push('Rust HTTP streaming, native Channel, multi-turn context and Windows credential store');

  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: 'Claude API', exact: true }).click();
  await page.getByLabel(/接口地址/).fill(baseUrl);
  await page.getByLabel('模型 ID', { exact: true }).fill('native-claude');
  await page.getByLabel(/^API Key/).fill('native-claude-key');
  await page.getByRole('button', { name: /保存设置/ }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '开启新对话' }).click();
  await page.getByRole('textbox', { name: '消息输入框' }).fill('原生 Claude 协议测试');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await complete(page);
  assert.match(await page.getByRole('article', { name: '助手消息' }).innerText(), /Tauri Rust 原生代理测试通过/);
  assert.equal(requests.at(-1).headers['x-api-key'], 'native-claude-key');
  assert.equal(requests.at(-1).path, '/v1/messages');
  await page.screenshot({ path: join(artifacts, 'conversation-desktop.png'), animations: 'disabled' });
  checks.push('Claude native protocol');
  await page.getByRole('textbox', { name: '消息输入框' }).fill('原生取消流');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.getByRole('article', { name: '助手消息' }).last().getByText(/slow/).waitFor();
  await page.getByRole('button', { name: '停止生成', exact: true }).click();
  await page.getByText('已停止生成', { exact: true }).waitFor();
  for (let i = 0; i < 30 && !canceledUpstream; i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(canceledUpstream);
  await page.getByRole('button', { name: '重新生成', exact: true }).click();
  await complete(page);
  await page.getByRole('textbox', { name: '消息输入框' }).fill('原生取消JSON');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  for (let i = 0; i < 50 && !requests.at(-1)?.body.messages.at(-1)?.content.includes('原生取消JSON'); i++) await new Promise(resolve => setTimeout(resolve, 20));
  await page.getByRole('button', { name: '停止生成', exact: true }).click();
  await page.getByText('已停止生成', { exact: true }).waitFor();
  for (let i = 0; i < 30 && !canceledJson; i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(canceledJson);
  await page.getByRole('textbox', { name: '消息输入框' }).fill('原生错误测试');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.locator('.message-error').waitFor();
  const errorText = await page.locator('.message-error').innerText();
  assert.match(errorText, /Invalid key/);
  assert.ok(!errorText.includes('native-claude-key'));
  checks.push('Native SSE and stalled JSON cancellation, regeneration and credential redaction');
  await close(page);
  page = await launch();
  await page.getByRole('article', { name: '你的消息' }).first().waitFor();
  assert.match(await page.getByRole('article', { name: '你的消息' }).first().innerText(), /原生 Claude 协议测试/);
  assert.equal(await page.evaluate(() => window.clay.loadSecret()), 'native-claude-key');
  await page.evaluate(() => window.clay.saveSecret(''));
  checks.push('Native close/reopen conversation and key persistence');
  assert.deepEqual(errors, []);
  await close(page);
  await writeFile(join(artifacts, 'results.json'), JSON.stringify({ passed: checks, pageErrors: errors }, null, 2));
  console.log(JSON.stringify({ passed: checks, pageErrors: errors, screenshots: artifacts }, null, 2));
} finally {
  if (browser) { try { await browser.contexts()[0].pages()[0].evaluate(() => window.clay?.saveSecret('')); } catch {} }
  await browser?.close().catch(() => {});
  child?.kill();
  upstream.closeAllConnections();
  await new Promise(resolve => upstream.close(resolve));
  await writeFile(join(artifacts, 'process.log'), childLog);
}
