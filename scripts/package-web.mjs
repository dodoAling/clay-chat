/** Assemble a self-contained web package in release/: dist/ + web/ server + LICENSE, with no node_modules required. */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const release = join(root, 'release');
const target = join(release, 'clay-chat-web');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(join(root, 'web'), join(target, 'web'), { recursive: true });
await cp(join(root, 'dist'), join(target, 'dist'), { recursive: true });
await cp(join(root, 'LICENSE'), join(target, 'LICENSE'));
await writeFile(join(target, 'package.json'), JSON.stringify({
  name: 'clay-chat-web', version: pkg.version, private: true, type: 'module',
  engines: { node: '>=22.12.0' }, scripts: { start: 'node web/index.mjs' },
}, null, 2) + '\n');
await writeFile(join(target, 'README.txt'),
  `Clay Chat ${pkg.version} — web bundle\n\n` +
  `Requires Node.js 22.12 or later; no other dependencies.\n\n` +
  `    node web/index.mjs\n\n` +
  `Open http://127.0.0.1:5180. Set PORT to choose another port.\n\n` +
  `Clay Chat ${pkg.version} 网页版\n\n` +
  `需要 Node.js 22.12 或更新版本，无其他依赖。\n` +
  `运行 node web/index.mjs，打开 http://127.0.0.1:5180，可用 PORT 环境变量换端口。\n`);

const archive = join(release, `clay-chat-web-${pkg.version}.zip`);
await rm(archive, { force: true });
const tar = spawnSync('tar', ['-a', '-c', '-f', archive, '-C', release, 'clay-chat-web'], { stdio: 'inherit' });
if (tar.status === 0) console.log(`package: ${target}\narchive: ${archive}`);
else console.log(`package: ${target}\narchive skipped: tar cannot create zip on this system`);
