// ---------------------------------------------------------------------------
// Real play session: start the game, walk forward, and capture what the
// player actually sees.
//   node tools/play.mjs --url URL --out shots/play
// ---------------------------------------------------------------------------
import { chromium } from 'playwright';
import { mkdir, access } from 'node:fs/promises';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, v, i, r) => (v.startsWith('--') ? (a.push([v.slice(2), r[i + 1]?.startsWith('--') ? true : r[i + 1]]), a) : a), [])
);
const URL = args.url || 'http://127.0.0.1:5173/';
const OUT = args.out || 'shots/play';
const SEED = args.seed || '';

await mkdir(OUT, { recursive: true });
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
try { await access(CHROME); } catch (e) {}
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio', '--window-size=1600,900'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.addInitScript((s) => { try { if (s) localStorage.setItem('tlb.seed', s); } catch (e) {} }, SEED);
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.__game && window.__game.terrain), null, { timeout: 60000 });
await page.click('#btnPlay');
await page.waitForTimeout(2000);
await page.screenshot({ path: path.join(OUT, 'p1-spawn.png') });

// walk forward inland for a while, screenshot while moving
const walk = async (ms, keys = ['KeyW']) => {
  for (const k of keys) await page.keyboard.down(k);
  await page.waitForTimeout(ms);
  for (const k of keys) await page.keyboard.up(k);
};
await page.keyboard.down('KeyW');
await page.waitForTimeout(2500);
await page.keyboard.up('KeyW');
await page.screenshot({ path: path.join(OUT, 'p2-walk1.png') });

// face the sea
await page.mouse.move(800, 450);
for (let i = 0; i < 40; i++) { await page.mouse.move(800 + i * 14, 450, { steps: 1 }); await page.waitForTimeout(12); }
await page.screenshot({ path: path.join(OUT, 'p3-sea.png') });

const info = await page.evaluate(() => {
  const g = window.__game;
  const p = g.player.pos;
  return { pos: [p.x, p.y, p.z].map((v) => +v.toFixed(2)), height: +g.island.heightAt(p.x, p.z).toFixed(2), inWater: g.player.inWater };
});
console.log('player', JSON.stringify(info));
await browser.close();
