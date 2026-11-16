import { chromium } from 'playwright';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
page.on('console', (m) => console.log('[' + m.type() + ']', m.text().slice(0, 200)));
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);
const info = await page.evaluate(() => {
  const g = window.__game;
  g.setPhoto(-90, g.island.heightAt(-90, 0) + 3, 0, 0.9, -0.4);
  const cam = g.camera.position;
  const out = { cam: [cam.x, cam.y, cam.z], player: [g.player.pos.x, g.player.pos.y, g.player.pos.z], h: g.island.heightAt(-90, 0) };
  return out;
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
