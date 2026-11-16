import { chromium } from 'playwright';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
page.on('console', (m) => { if (m.text().startsWith('site')) console.log(m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.addInitScript(() => { try { localStorage.setItem('tlb.seed', 'skerry'); } catch (e) {} });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.__game && window.__game.sites), null, { timeout: 90000 });
const info = await page.evaluate(() => {
  const g = window.__game;
  const s = g.sites;
  return { sites: s, spawn: [g.player.pos.x, g.player.pos.y, g.player.pos.z], seed: g.seed };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
