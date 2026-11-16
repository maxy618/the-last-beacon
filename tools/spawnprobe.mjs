import { chromium } from 'playwright';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
page.on('console', (m) => console.log('[' + m.type() + ']', m.text().slice(0, 160)));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.addInitScript(() => { try { localStorage.setItem('tlb.seed', 'skerry'); } catch (e) {} });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.__game && window.__game.player), null, { timeout: 90000 });
const info = await page.evaluate(() => {
  const g = window.__game;
  const p = g.player.pos;
  return {
    landing: g.landing,
    spawn: [p.x, p.y, p.z],
    h: g.island.heightAt(p.x, p.z),
    landingH: g.island.heightAt(g.landing[0], g.landing[1]),
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
