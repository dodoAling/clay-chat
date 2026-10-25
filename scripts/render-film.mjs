/**
 * 宣传短片与海报的母版渲染：
 *
 *   node scripts/render-film.mjs           短片 + 封面 + GIF + 两张海报
 *   node scripts/render-film.mjs poster    只出海报
 *   node scripts/render-film.mjs film      只出短片与封面、GIF
 *
 * 做法：开一个静态服务供 docs/film/*.html 取素材，调页面上的 window.__film
 * 逐帧取 PNG 喂给 ffmpeg（与页内播放同一个渲染器），H.264 · yuv420p · 30fps，
 * 外加一条静音 AAC —— 有的平台对没有音轨的文件转码异常，静音轨最稳。
 * 海报直接按版心尺寸截图。
 *
 * 产物在 docs/media/：clay-chat-tour-1080p.mp4 / -cover.png / clay-chat-tour.gif /
 * poster-1920x1080.png / poster-1080x1440.png。
 *
 * 前提：docs/film/clips/ 里有录屏（先跑 node scripts/capture-film.mjs）。
 */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { join, normalize } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const OUT = join(root, 'docs', 'media');
const FFMPEG = process.env.CLAY_FFMPEG ?? 'ffmpeg';
const only = process.argv.slice(2);
const want = id => !only.length || only.includes(id);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function serve() {
  const server = http.createServer(async (req, res) => {
    const path = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    if (!path.startsWith(root)) { res.writeHead(403); return res.end(); }
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.slice(path.lastIndexOf('.'))] ?? 'application/octet-stream', 'Content-Length': info.size });
    createReadStream(path).pipe(res);
  });
  return new Promise(ok => server.listen(0, '127.0.0.1', () => ok({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

function ffmpeg(args) {
  const enc = spawn(FFMPEG, args, { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((ok, fail) => {
    enc.on('close', c => (c === 0 ? ok() : fail(new Error(`ffmpeg 退出码 ${c}`))));
    enc.on('error', fail);
  });
  return { enc, done };
}

mkdirSync(OUT, { recursive: true });
const { server, url } = await serve();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--force-color-profile=srgb'] });
try {
  if (want('film')) {
    /* 无头浏览器的 <video> 对 seek 不解码（currentTime 恒 0），先把录屏解成逐帧 PNG，
       film.html 按帧号取图，帧精确且不依赖浏览器编解码。 */
    for (const id of ['chat', 'browse']) {
      const clip = join(root, 'docs', 'film', 'clips', `${id}.mp4`);
      if (!existsSync(clip)) throw new Error(`缺少 ${clip} —— 先跑 node scripts/capture-film.mjs`);
      const dir = join(root, '.artifacts', 'film-frames', id);
      mkdirSync(dir, { recursive: true });
      await new Promise((ok, fail) => {
        spawn(FFMPEG, ['-v', 'error', '-y', '-i', clip, '-start_number', '0', join(dir, '%05d.png')], { stdio: 'inherit' })
          .on('close', c => (c === 0 ? ok() : fail(new Error(`ffmpeg 解帧失败: ${id}`))));
      });
    }
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', e => console.warn('  ⚠', e.message));
    await page.goto(`${url}/docs/film/film.html`);
    await page.waitForFunction(() => document.documentElement.dataset.filmReady === '1' || document.documentElement.dataset.filmError, null, { timeout: 120000 });
    const err = await page.evaluate(() => document.documentElement.dataset.filmError);
    if (err) throw new Error(err);
    const info = await page.evaluate(() => {
      const f = window.__film;
      return { w: f.w, h: f.h, fps: f.fps, frames: f.frames, cover: f.cover };
    });
    const duration = info.frames / info.fps;
    const out = join(OUT, 'clay-chat-tour-1080p.mp4');

    const { enc, done: encode } = ffmpeg([
      '-v', 'error', '-y',
      '-f', 'image2pipe', '-framerate', String(info.fps), '-i', '-',
      '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
      '-map', '0:v', '-map', '1:a',
      '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '16',
      '-pix_fmt', 'yuv420p', '-r', String(info.fps), '-g', String(info.fps * 2),
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
      '-t', String(duration), '-movflags', '+faststart',
      out,
    ]);

    const started = Date.now();
    for (let f = 0; f < info.frames; f++) {
      const b64 = await page.evaluate(i => window.__film.frame(i), f);
      const png = Buffer.from(b64, 'base64');
      await new Promise(ok => (enc.stdin.write(png) ? ok() : enc.stdin.once('drain', ok)));
      if (f % 60 === 0) process.stdout.write(`\r  film ${f}/${info.frames}`);
    }
    enc.stdin.end();
    await encode;

    const cover = await page.evaluate(t => window.__film.still(t), info.cover / info.fps);
    writeFileSync(join(OUT, 'clay-chat-tour-cover.png'), Buffer.from(cover, 'base64'));

    /* README 内联 GIF：取 chat 场景流式铺开的那一段，960 宽 15fps。 */
    await new Promise((ok, fail) => {
      spawn(FFMPEG, [
        '-v', 'error', '-y', '-ss', '3.0', '-t', '10', '-i', out,
        '-vf', 'fps=15,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer',
        join(OUT, 'clay-chat-tour.gif'),
      ], { stdio: 'inherit' }).on('close', c => (c === 0 ? ok() : fail(new Error('gif 生成失败'))));
    });
    console.log(`\r✓ clay-chat-tour-1080p.mp4  ${info.w}×${info.h} · ${info.frames} 帧 · ${duration.toFixed(1)}s · ${((Date.now() - started) / 1000).toFixed(0)}s + cover + gif`);
    await page.close();
  }

  if (want('poster')) {
    for (const [name, page2url, viewport] of [
      ['poster-1920x1080.png', 'docs/film/poster.html', { width: 1920, height: 1080 }],
      ['poster-1080x1440.png', 'docs/film/poster.html?v=1', { width: 1080, height: 1440 }],
    ]) {
      const page = await browser.newPage({ viewport });
      await page.goto(`${url}/${page2url}`);
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map(i => (i.complete ? 1 : new Promise(r => { i.onload = i.onerror = r; }))));
      });
      await page.screenshot({ path: join(OUT, name) });
      await page.close();
      console.log(`✓ ${name}`);
    }
  }
} finally {
  await browser.close();
  await new Promise(ok => server.close(ok));
}
console.log(`产物在 ${OUT}`);
