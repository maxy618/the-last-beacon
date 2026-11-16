import { chromium } from 'playwright';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
const info = await page.evaluate(() => {
  const g = window.__game;
  const out = [];
  let best = [];
  for (let j = -10; j <= 10; j++) {
    for (let i = -10; i <= 10; i++) {
      const x = i * 45, z = j * 45;
      const surf = g.island.surfaceAt(x, z);
      if (surf.height < 3 || surf.height > 40) continue;
      if (surf.grass < 0.4 || surf.slope > 0.25) continue;
      best.push({ x, z, h: +surf.height.toFixed(1), grass: +surf.grass.toFixed(2) });
      if (best.length > 12) return best;
    }
  }
  return best;
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
