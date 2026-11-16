import { chromium } from 'playwright';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);
const info = await page.evaluate(() => {
  const g = window.__game;
  const out = [];
  for (const [x, z] of [[180, -120], [60, 60], [80, 40], [0, 0], [250, 250], [-150, 200]]) {
    const surf = g.island.surfaceAt(x, z);
    out.push({ x, z, h: +surf.height.toFixed(2), snow: +surf.snow.toFixed(3), sand: +surf.sand.toFixed(2), grass: +surf.grass.toFixed(2), rock: +surf.rock.toFixed(2), moss: +surf.moss.toFixed(2), slope: +surf.slope.toFixed(3), ao: +(surf.ao ?? 1).toFixed(3) });
  }
  return out;
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
