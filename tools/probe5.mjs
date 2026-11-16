import { chromium } from 'playwright';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('console', (m) => console.log('[' + m.type() + ']', m.text().slice(0, 200)));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('dialog', (d) => { console.log('[dialog]', d.message()); d.accept(); });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.__game && window.__game.terrain), null, { timeout: 60000 });
const before = await page.evaluate(() => ({
  hasFn: typeof document.getElementById('btnPlay')?.onclick,
  menuClass: document.getElementById('menu')?.className,
  hidden: document.getElementById('menu')?.classList.contains('hidden'),
}));
console.log('before', JSON.stringify(before));
await page.click('#btnPlay');
await page.waitForTimeout(800);
const after = await page.evaluate(() => ({
  menuClass: document.getElementById('menu')?.className,
  hidden: document.getElementById('menu')?.classList.contains('hidden'),
  paused: window.__game.paused,
  lock: document.pointerLockElement?.id || null,
}));
console.log('after', JSON.stringify(after));
await browser.close();
