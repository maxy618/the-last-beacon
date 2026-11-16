// ---------------------------------------------------------------------------
// Playtest harness.
//
// Drives the game in a real browser: presses keys, moves the camera, waits
// for the generator to settle and writes screenshots plus a console log.
//
//   node tools/playtest.mjs --url http://127.0.0.1:4173 --out shots/run1
//                           --seed mychart --shots "name:x,z,yaw,pitch;name2:..."
// ---------------------------------------------------------------------------
import { chromium } from 'playwright';
import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1]]);
    return acc;
  }, [])
);

const URL = args.url || 'http://127.0.0.1:4173/';
const OUT = args.out || 'shots/run';
const SEED = args.seed || '';
const HEADED = !!args.headed;
const WAIT = Number(args.wait || 90);
const SHOTS = args.shots ? String(args.shots).split(';').filter(Boolean) : [];

await mkdir(OUT, { recursive: true });

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
async function findChrome() {
  if (process.env.TLB_CHROME) return process.env.TLB_CHROME;
  for (const c of CHROME_CANDIDATES) {
    try { await access(c); return c; } catch (e) {}
  }
  return undefined;
}

const browser = await chromium.launch({
  headless: !HEADED,
  executablePath: await findChrome(),
  args: [
    '--enable-unsafe-webgpu',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--use-angle=d3d11',
    '--disable-gpu-sandbox',
    '--no-sandbox',
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
    '--disable-features=CalculateNativeWinOcclusion',
  ],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack || ''}`));

await page.addInitScript((s) => {
  try { localStorage.setItem('tlb.seed', s); } catch (e) {}
}, SEED);

console.log('opening', URL);
await page.goto(URL, { waitUntil: 'domcontentloaded' });

// wait for the game to finish generating
const t0 = Date.now();
let ready = false;
while (Date.now() - t0 < WAIT * 1000) {
  ready = await page.evaluate(() => !!(window.__game && window.__game.terrain)).catch(() => false);
  if (ready) break;
  const msg = await page.evaluate(() => document.getElementById('bootMsg')?.textContent || '').catch(() => '');
  console.log('  ...', msg);
  await page.waitForTimeout(1000);
}
console.log(ready ? `ready in ${((Date.now() - t0) / 1000).toFixed(1)}s` : 'NOT READY (timeout)');

await page.screenshot({ path: path.join(OUT, '00-menu.png') });

// start the game
await page.evaluate(() => document.getElementById('btnPlay')?.click());
await page.waitForTimeout(1500);

async function shot(name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log('shot', name);
}

async function place(x, z, yaw, pitch, height) {
  await page.evaluate(([x, z, yaw, pitch, height]) => {
    const g = window.__game;
    const h = height === null || height === undefined ? g.island.heightAt(x, z) + 1.7 : height;
    g.setPhoto(x, h, z, yaw, pitch);
  }, [x, z, yaw, pitch, height]);
  await page.waitForTimeout(900);
}

if (SHOTS.length) {
  for (const s of SHOTS) {
    const [name, spec] = s.split(':');
    const parts = spec.split(',').map(Number);
    const [x, z, yaw, pitch] = parts;
    const height = parts.length > 4 ? parts[4] : undefined;
    await place(x, z, yaw, pitch, height);
    await shot(name);
  }
} else {
  await shot('01-start');
}

// collect a perf sample
const perf = await page.evaluate(async () => {
  const g = window.__game;
  const times = [];
  let last = performance.now();
  await new Promise((res) => {
    let n = 0;
    const tick = () => {
      const now = performance.now();
      times.push(now - last);
      last = now;
      if (++n < 180) requestAnimationFrame(tick); else res();
    };
    requestAnimationFrame(tick);
  });
  times.sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  return {
    avgMs: +avg.toFixed(2),
    p50: +times[Math.floor(times.length * 0.5)].toFixed(2),
    p99: +times[Math.floor(times.length * 0.99)].toFixed(2),
    max: +times[times.length - 1].toFixed(2),
    calls: g.engine.stats?.calls,
    tris: g.engine.stats?.triangles,
    chunks: g.terrain?.stats?.chunks,
  };
});
console.log('perf', JSON.stringify(perf));

await writeFile(path.join(OUT, 'console.log'), logs.join('\n'), 'utf8');
await writeFile(path.join(OUT, 'perf.json'), JSON.stringify(perf, null, 2), 'utf8');
const errs = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
if (errs.length) {
  console.log('--- errors ---');
  console.log(errs.slice(0, 30).join('\n'));
} else {
  console.log('no console errors');
}

await browser.close();
