import { chromium } from 'playwright-core';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from '../server/index.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = join(root, '.artifacts', 'verification');
await mkdir(artifacts, { recursive: true });
const checks = [];
const errors = [];
const captured = [];
const mock = http.createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  captured.push({ path: req.url, body: JSON.parse(body), headers: req.headers });
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const texts = ['真实代理链路测试通过：', '你好，世界 🌱。'];
  for (const text of texts) {
    const event = req.url.endsWith('/messages')
      ? { type: 'content_block_delta', delta: { type: 'text_delta', text } }
      : { choices: [{ delta: { content: text } }] };
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  res.end(req.url.endsWith('/messages') ? 'data: {"type":"message_stop"}\n\n' : 'data: [DONE]\n\n');
});
await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${mock.address().port}/v1`;
const app = await startServer({ port: 0 });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
async function screenshot(page, name) {
  await page.waitForFunction(() => !document.querySelector('.welcome') || Number(getComputedStyle(document.querySelector('.welcome')).opacity) > .999);
  await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))); });
  await page.screenshot({ path: join(artifacts, name), animations: 'disabled' });
}
async function complete(page) { await page.getByRole('button', { name: '停止生成', exact: true }).waitFor({ state: 'hidden', timeout: 20000 }); }
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(app.url);
  await page.getByRole('heading', { name: /给想法一点/ }).waitFor();
  await screenshot(page, 'welcome-web.png');
  assert.equal(await page.locator('body').evaluate(body => body.scrollWidth > innerWidth), false);
  checks.push('Welcome renders without horizontal overflow or external assets');

  await page.getByRole('button', { name: '切换深色主题' }).click();
  assert.equal(await page.locator('html').getAttribute('class'), 'dark');
  await screenshot(page, 'welcome-dark.png');
  await page.getByRole('button', { name: '切换浅色主题' }).click();
  checks.push('Theme switching');

  const input = page.getByRole('textbox', { name: '消息输入框' });
  await input.fill('中文输入法确认测试');
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true });
  assert.equal(await page.getByRole('article', { name: '你的消息' }).count(), 0);
  await page.getByRole('button', { name: /把想法变成代码/ }).click();
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="消息输入框"]').value.includes('小工具'));
  assert.match(await input.inputValue(), /小工具/);
  await input.fill('帮我写一段代码');
  await input.press('Enter');
  await complete(page);
  assert.match(await page.getByRole('article', { name: '助手消息' }).innerText(), /离线演示/);
  await page.getByRole('button', { name: '复制回复', exact: true }).click();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /离线演示/);
  checks.push('CJK composition guard, suggestions, streamed demo, Markdown, clipboard');

  await page.getByRole('button', { name: '收藏当前对话' }).click();
  await page.getByRole('button', { name: /我的收藏/ }).click();
  assert.equal(await page.locator('.conversation-item').count(), 1);
  await page.keyboard.press('Control+k');
  await page.getByRole('textbox', { name: '搜索对话' }).fill('代码');
  await page.locator('.search-results > button').first().click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '导出对话', exact: true }).click()]);
  await download.saveAs(join(artifacts, 'export.md'));
  assert.match(await readFile(join(artifacts, 'export.md'), 'utf8'), /帮我写一段代码/);
  await page.reload();
  await page.getByRole('article', { name: '助手消息' }).waitFor();
  assert.equal(await page.locator('.conversation-item').count(), 1);
  checks.push('Favorites, search, Markdown export and browser persistence');

  await page.getByRole('button', { name: '开启新对话' }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: 'OpenAI 兼容', exact: true }).click();
  await page.getByLabel(/接口地址/).fill(baseUrl);
  await page.getByLabel('模型 ID', { exact: true }).fill('mock-model');
  await page.getByLabel(/^API Key/).fill('ui-test-key');
  await page.getByRole('button', { name: /保存设置/ }).click();
  await page.getByLabel('选择文本文件').setInputFiles({ name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('attachment-test-content') });
  await page.getByRole('textbox', { name: '消息输入框' }).fill('测试流式接口');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await complete(page);
  assert.match(await page.getByRole('article', { name: '助手消息' }).innerText(), /真实代理链路测试通过：你好，世界 🌱。/);
  assert.equal(captured.at(-1).headers.authorization, 'Bearer ui-test-key');
  assert.ok(captured.at(-1).body.messages.some(message => message.content.includes('attachment-test-content')));
  assert.ok(!(await page.evaluate(() => localStorage.getItem('clay-chat.workspace.v1'))).includes('ui-test-key'));
  await page.getByRole('textbox', { name: '消息输入框' }).fill('继续上一条对话');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await complete(page);
  assert.equal(captured.at(-1).body.messages.filter(message => message.role === 'user').length, 2);
  assert.equal(captured.at(-1).body.messages.filter(message => message.role === 'assistant').length, 1);
  await screenshot(page, 'conversation-web.png');
  checks.push('Real OpenAI-compatible proxy, attachments, multi-turn context and key isolation');

  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: 'Claude API', exact: true }).click();
  await page.getByLabel(/接口地址/).fill(baseUrl);
  await page.getByLabel('模型 ID', { exact: true }).fill('mock-claude');
  await page.getByLabel(/^API Key/).fill('claude-test-key');
  await page.getByRole('button', { name: /保存设置/ }).click();
  await page.getByRole('button', { name: '开启新对话' }).click();
  await page.getByRole('textbox', { name: '消息输入框' }).fill('Claude 协议测试');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await complete(page);
  assert.match(await page.getByRole('article', { name: '助手消息' }).innerText(), /真实代理链路测试通过/);
  assert.equal(captured.at(-1).path, '/v1/messages');
  assert.equal(captured.at(-1).headers['x-api-key'], 'claude-test-key');
  checks.push('Real Claude protocol proxy');

  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '演示助手', exact: true }).click();
  await page.getByRole('button', { name: /保存设置/ }).click();
  await page.getByRole('button', { name: '开启新对话' }).click();
  await page.getByRole('textbox', { name: '消息输入框' }).fill('验证停止生成');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.getByRole('button', { name: '停止生成', exact: true }).click();
  await page.getByText('已停止生成', { exact: true }).waitFor();
  await page.getByRole('button', { name: '重新生成', exact: true }).click();
  await complete(page);
  assert.match(await page.getByRole('article', { name: '助手消息' }).innerText(), /给想法一个开始的地方/);
  await page.locator('.conversation-item.selected').hover();
  await page.locator('.conversation-item.selected .conversation-tools').getByRole('button', { name: '删除对话', exact: true }).click();
  await page.getByRole('dialog', { name: '删除这段对话？' }).getByRole('button', { name: '删除对话', exact: true }).click();
  await page.getByRole('heading', { name: /给想法一点/ }).waitFor();
  checks.push('Cancellation, regeneration and conversation deletion');

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobile = await mobileContext.newPage();
  mobile.on('pageerror', error => errors.push(error.message));
  await mobile.goto(app.url);
  await mobile.getByRole('heading', { name: /给想法一点/ }).waitFor();
  assert.equal(await mobile.locator('body').evaluate(body => body.scrollWidth > innerWidth), false);
  await screenshot(mobile, 'welcome-mobile.png');
  await mobile.getByRole('button', { name: '展开侧边栏' }).click();
  await mobile.getByRole('button', { name: '设置', exact: true }).click();
  await mobile.getByRole('dialog').waitFor();
  checks.push('Mobile layout and navigation');

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: checks, pageErrors: errors, screenshots: artifacts }, null, 2));
  await writeFile(join(artifacts, 'results.json'), JSON.stringify({ passed: checks, pageErrors: errors }, null, 2));
} finally {
  await browser.close();
  await app.close();
  mock.closeAllConnections();
  await new Promise(resolve => mock.close(resolve));
}
