/**
 * 产品短片用的实机录屏：在网页端里真的操作一遍，逐帧确定性地录下来。
 *
 *   node scripts/capture-film.mjs           全部段落
 *   node scripts/capture-film.mjs chat      只录 id 前缀匹配的段落
 *
 * 产物：docs/film/clips/<id>.mp4 + <id>.json（帧数与点击轨迹）
 *
 * 🔴 不是实时录屏：实时帧率取决于机器忙不忙，掉帧会直接进成片。这里用
 *    Playwright 假时钟（page.clock）推进 setTimeout / rAF，再用 Web Animations
 *    API 把每个 CSS 动画与过渡暂停、每帧手动拨 1/FPS 秒 —— 30fps 就是严格的
 *    30fps，与截一帧要多久无关。演示模式的流式回复走 setTimeout，正好被假时钟接管。
 * 🔴 点击轨迹（<id>.json）记下每次点击在窗口里的归一化位置与时刻，短片画布据此
 *    画光圈 —— 画的是镜头语言，不是产品界面。
 */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { startServer } from '../web/index.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const OUT = join(root, 'docs', 'film', 'clips');
const FFMPEG = process.env.CLAY_FFMPEG ?? 'ffmpeg';
const FPS = 30;
const DT = 1000 / FPS;
const DPR = 1.5;
const VIEW = { width: 1300, height: 812 };
const only = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });

/** 侧栏里预置的两段旧对话：短片里的界面不是刚装完的空壳。 */
const seedWorkspace = {
  version: 1, theme: 'light', activeId: null,
  conversations: [
    {
      id: 'seed-weekly', title: '周报大纲润色', pinned: true, updatedAt: Date.now() - 86400000,
      messages: [
        { id: 'sw1', role: 'user', content: '帮我把这份周报大纲润色得更清晰。', createdAt: Date.now() - 86400000 },
        { id: 'sw2', role: 'assistant', status: 'complete', demo: true, createdAt: Date.now() - 86300000, content: '## 周报大纲\n\n- 本周进展：三条主线各一句话\n- 风险与阻塞：写清楚需要什么支持\n- 下周计划：按优先级排列' },
      ],
    },
    {
      id: 'seed-trip', title: '旅行计划清单', pinned: false, updatedAt: Date.now() - 172800000,
      messages: [
        { id: 'st1', role: 'user', content: '三天两夜的短途旅行，帮我列个清单。', createdAt: Date.now() - 172800000 },
        { id: 'st2', role: 'assistant', status: 'complete', demo: true, createdAt: Date.now() - 172700000, content: '## 短途旅行清单\n\n- 证件与支付\n- 换洗衣物按天数 +1\n- 充电线、转换插头\n- 常用药与雨具' },
      ],
    },
  ],
  settings: { provider: 'demo', baseUrl: '', model: '', systemPrompt: '你是一位善于思考、表达清晰的 AI 助手。' },
};

/**
 * 一段录像：hold(秒) 原地录、click(定位器) 先悬停再点、type 逐字录入，
 * 全部按帧推进，与截帧耗时无关。
 */
class Take {
  constructor(page, rect, enc) {
    this.page = page;
    this.rect = rect;
    this.enc = enc;
    this.t = 0;
    this.frames = 0;
    this.clicks = [];
  }

  /** 推进一帧：拨动所有 CSS 动画、跑假时钟，然后截窗口区域喂给 ffmpeg。 */
  async frame() {
    await this.page.evaluate(dt => {
      const seen = (window.__clayFilmSeen ??= new WeakSet());
      for (const a of document.getAnimations()) {
        if (a.timeline !== document.timeline) continue;
        if (!seen.has(a)) { seen.add(a); a.pause(); a.currentTime = 0; }
        a.currentTime += dt;
      }
    }, DT);
    await this.page.clock.runFor(DT);
    const png = await this.page.screenshot({ clip: this.rect });
    await new Promise((ok, fail) => {
      this.enc.stdin.write(png, err => (err ? fail(err) : this.enc.stdin.writableNeedDrain ? this.enc.stdin.once('drain', ok) : ok()));
    });
    this.t += DT / 1000;
    this.frames += 1;
    if (this.frames % 60 === 0) process.stdout.write(`\r  ${this.frames} 帧 ${this.t.toFixed(1)}s`);
  }

  hold(seconds) { return this.for(seconds, () => {}); }

  /** 录 seconds 秒，每帧之间先跑 step（比如点一下、敲一个字）。 */
  async for(seconds, step) {
    const n = Math.round(seconds * FPS);
    for (let i = 0; i < n; i++) { await step(i); await this.frame(); }
  }

  async click(locator, label) {
    const box = await locator.boundingBox();
    if (!box) throw new Error(`click 目标不可见: ${label}`);
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await this.page.mouse.move(x - 40, y - 24);
    await this.hold(0.18);
    await this.page.mouse.move(x, y);
    await this.hold(0.16);
    this.clicks.push({ t: this.t, x: (x - this.rect.x) / this.rect.width, y: (y - this.rect.y) / this.rect.height, label });
    await locator.click();
    await this.hold(0.3);
  }

  /** 逐字输入，每个字给几帧的时间，看上去是人在打字。 */
  async type(locator, text, framesPerChar = 2) {
    await locator.click();
    for (const ch of text) {
      await this.page.keyboard.insertText(ch);
      await this.hold(framesPerChar / FPS);
    }
  }

  async done(id) {
    this.enc.stdin.end();
    await new Promise((ok, fail) => this.enc.on('close', c => (c === 0 ? ok() : fail(new Error(`ffmpeg 退出码 ${c}`)))));
    writeFileSync(join(OUT, `${id}.json`), JSON.stringify({ fps: FPS, frames: this.frames, duration: this.t, w: this.rect.width * DPR, h: this.rect.height * DPR, clicks: this.clicks }, null, 2));
    console.log(`\r✓ ${id}.mp4  ${this.frames} 帧 ${this.t.toFixed(2)}s，点击 ${this.clicks.length} 次`);
  }
}

function encoder(outPath) {
  return spawn(FFMPEG, [
    '-v', 'error', '-y',
    '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'medium', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    outPath,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
}

async function take(id, page, fn) {
  const enc = encoder(join(OUT, `${id}.mp4`));
  const t = new Take(page, { x: 0, y: 0, width: VIEW.width, height: VIEW.height }, enc);
  await fn(t);
  await t.done(id);
}

const app = await startServer({ port: 0 });
const browser = await chromium.launch({
  channel: 'msedge', headless: true,
  args: ['--force-color-profile=srgb', '--hide-scrollbars'],
});
try {
  const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: DPR, permissions: ['clipboard-read', 'clipboard-write'] });
  await context.addInitScript(ws => localStorage.setItem('clay-chat.workspace.v1', JSON.stringify(ws)), seedWorkspace);
  const page = await context.newPage();
  page.on('pageerror', e => console.warn('  ⚠', e.message));
  await page.clock.install();
  await page.goto(`${app.url}?titlebar=macos`);
  await page.getByRole('heading', { name: /给想法一点/ }).waitFor();

  const want = id => !only.length || only.some(p => id.startsWith(p));

  if (want('chat')) await take('chat', page, async t => {
    await t.hold(1.4);
    await t.click(page.getByRole('button', { name: /把想法变成代码/ }), '点建议卡片');
    await t.hold(0.7);
    await t.click(page.getByRole('button', { name: '发送消息', exact: true }), '发送');
    /* 演示回复 ~3.5s 流完；多留一拍让结尾的代码块和复制按钮站稳。 */
    await t.hold(6.2);
    await t.click(page.getByRole('button', { name: '复制回复', exact: true }), '复制回复');
    await t.hold(1.2);
  });

  if (want('browse')) await take('browse', page, async t => {
    await t.hold(0.6);
    /* 单独重录这一段时停在欢迎页：先点开侧栏第一段会话再往下走。 */
    if (await page.getByRole('button', { name: '收藏当前对话' }).count() === 0) {
      await t.click(page.locator('.conversation-item').first(), '打开会话');
      await t.hold(0.6);
    }
    await t.click(page.getByRole('button', { name: '收藏当前对话' }), '收藏');
    await t.hold(0.5);
    await t.click(page.getByRole('button', { name: '切换深色主题' }), '切深色');
    await t.hold(1.1);
    await t.click(page.getByRole('button', { name: '开启新对话' }), '新对话');
    await t.hold(1.2);
    await t.click(page.getByRole('button', { name: '设置', exact: true }), '设置');
    await t.hold(1.4);
    await t.click(page.getByRole('button', { name: 'OpenAI 兼容', exact: true }), '选 OpenAI');
    await t.hold(1.2);
  });
} finally {
  await browser.close();
  await app.close();
}
