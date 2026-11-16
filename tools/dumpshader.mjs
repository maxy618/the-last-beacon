import { chromium } from 'playwright';
import { writeFile, access } from 'node:fs/promises';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
page.on('console', (m) => { const t = m.text(); if (!t.includes('useProgram')) console.log('[' + m.type() + ']', t.slice(0, 160)); });
await page.goto(process.argv[2] || 'http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(9000);
const src = await page.evaluate(() => window.__terrainFrag || '');
console.log('len', src.length);
if (src) {
  const lines = src.split('\n');
  console.log('lines', lines.length);
  const from = Number(process.argv[3] || 1940);
  for (let i = from; i < Math.min(lines.length, from + 70); i++) console.log(i + 1, ':', lines[i]);
  await writeFile('tools/fragdump.glsl', src, 'utf8');
}
await browser.close();
