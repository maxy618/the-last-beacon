import { chromium } from 'playwright';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
page.on('console', (m) => m.text().startsWith('site') && console.log(m.text()));
await page.addInitScript(() => { try { localStorage.setItem('tlb.seed', 'skerry'); } catch (e) {} });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.__game && window.__game.sites), null, { timeout: 90000 });
const info = await page.evaluate(() => {
  const g = window.__game;
  const lb = g.sites.lighthouse;
  const lampY = g.island.heightAt(lb.x, lb.z) + 14.5;
  const rows = [];
  for (const [x, z] of g.island.coastRing) {
    const h = g.island.heightAt(x, z);
    if (h < 0.4 || h > 8) continue;
    const slope = g.island.macroSlopeAt(x, z);
    const d = Math.hypot(x - lb.x, z - lb.z);
    let blocked = 0;
    const steps = Math.max(2, Math.floor(d / 9));
    for (let k = 1; k < steps; k++) {
      const t = k / steps;
      const ground = g.island.heightAt(x + (lb.x - x) * t, z + (lb.z - z) * t);
      const line = h + 2 + (lampY - (h + 2)) * t;
      if (ground > line - 1.0) blocked++;
    }
    const surf = g.island.surfaceAt(x, z);
    rows.push({ x: +x.toFixed(0), z: +z.toFixed(0), h: +h.toFixed(1), slope: +slope.toFixed(2), d: +d.toFixed(0), blocked, sand: +surf.sand.toFixed(2) });
  }
  rows.sort((a, b) => (a.blocked - b.blocked) || (a.slope - b.slope));
  return rows.slice(0, 18);
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
