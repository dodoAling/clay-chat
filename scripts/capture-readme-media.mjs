/** Regenerate the README screenshots in docs/media with seeded demo data (dark theme; a desktop release build is required). */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import net from 'node:net';
import { startServer } from '../web/index.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = join(root, 'docs', 'media');
const binary = process.env.CLAY_CHAT_DESKTOP_BINARY || join(root, 'desktop', 'src-tauri', 'target', 'release', 'clay-chat.exe');
const profile = join(root, '.artifacts', 'readme-shots', 'profile');
await mkdir(out, { recursive: true });
await mkdir(profile, { recursive: true });

const conversation = {
  id: 'readme-demo', title: '把想法变成代码', pinned: false, updatedAt: Date.now(),
  messages: [
    { id: 'm1', role: 'user', content: '我想开发一个小工具，先帮我梳理需求，再给一个最小可行版本的计划。', createdAt: Date.now() - 60000 },
    { id: 'm2', role: 'assistant', status: 'complete', demo: true, createdAt: Date.now(), content: '## 从一个小而完整的版本开始\n\n把需求拆成 **输入、处理、输出**，先跑通一条完整流程，再逐步扩展。\n\n```typescript\ntype Idea = { title: string; done: boolean };\n\nfunction nextStep(ideas: Idea[]) {\n  return ideas.find(idea => !idea.done);\n}\n```\n\n1. 明确用户要完成的任务。\n2. 写出最小可运行的实现。\n3. 用真实场景验证，再打磨细节。\n\n连接你的模型后，我可以基于具体代码继续深入。' },
  ],
};
const workspace = {
  version: 1, theme: 'dark', titlebar: 'macos', activeId: conversation.id, conversations: [conversation],
  settings: { provider: 'demo', baseUrl: 'https://api.openai.com/v1', model: '', systemPrompt: '你是一位善于思考、表达清晰的 AI 助手。' },
};

async function settle(page) {
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().filter(a => a.timeline === document.timeline && a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
  });
}
async function shot(page, name) { await settle(page); await page.screenshot({ path: join(out, name), animations: 'disabled' }); console.log('saved', name); }

const app = await startServer({ port: 0 });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(ws => localStorage.setItem('clay-chat.workspace.v1', JSON.stringify(ws)), workspace);
  const page = await context.newPage();
  await page.goto(app.url);
  await page.getByRole('article', { name: '助手消息' }).waitFor();
  await shot(page, 'conversation-dark.png');
  await page.getByRole('button', { name: '开启新对话' }).click();
  await page.getByRole('heading', { name: /给想法一点/ }).waitFor();
  await shot(page, 'welcome-dark.png');

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mobileContext.addInitScript(ws => localStorage.setItem('clay-chat.workspace.v1', JSON.stringify(ws)), { ...workspace, activeId: null, conversations: [] });
  const mobile = await mobileContext.newPage();
  await mobile.goto(app.url);
  await mobile.getByRole('heading', { name: /给想法一点/ }).waitFor();
  await shot(mobile, 'welcome-mobile-dark.png');
} finally {
  await app.close();
}

await writeFile(join(profile, 'workspace.json'), JSON.stringify(workspace));
const reservation = net.createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const child = spawn(binary, [], {
  cwd: root, windowsHide: false,
  env: { ...process.env, CLAY_CHAT_DATA_DIR: profile, WEBVIEW2_USER_DATA_FOLDER: join(profile, 'webview'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
  stdio: ['ignore', 'ignore', 'pipe'],
});
let connected = false;
for (let i = 0; i < 120 && child.exitCode === null && !connected; i++) {
  try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) connected = true; } catch {}
  if (!connected) await new Promise(resolve => setTimeout(resolve, 250));
}
if (!connected) { child.kill(); throw new Error('desktop did not expose a debugging endpoint'); }
const cdp = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
try {
  const page = cdp.contexts()[0].pages()[0] || await cdp.contexts()[0].waitForEvent('page');
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30000 });
  await page.getByRole('article', { name: '助手消息' }).waitFor();
  await shot(page, 'conversation-desktop-dark.png');
  await page.getByRole('button', { name: '开启新对话' }).click();
  await page.getByRole('heading', { name: /给想法一点/ }).waitFor();
  await shot(page, 'welcome-desktop-dark.png');
  await page.getByRole('button', { name: '切换浅色主题' }).click();
  await shot(page, 'welcome-desktop.png');
  await page.locator('.conversation-link').first().click();
  await page.getByRole('article', { name: '助手消息' }).waitFor();
  await shot(page, 'conversation-desktop.png');
} finally {
  await cdp.close().catch(() => {});
  child.kill();
}
await browser.close();
console.log('done');
