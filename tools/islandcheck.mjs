import { chromium } from 'playwright';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.goto(process.argv[2] || 'http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);
const info = await page.evaluate(() => {
  const g = window.__game;
  const H = g.island.height;
  let mn = 1e9, mx = -1e9, nan = 0, spikes = [];
  for (let i = 0; i < H.length; i++) {
    const v = H[i];
    if (!isFinite(v)) { nan++; continue; }
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  // count cells with huge gradient
  const R = 1024;
  let big = 0, maxJump = 0, jumpAt = null;
  for (let j = 1; j < R - 1; j++) {
    for (let i = 1; i < R - 1; i++) {
      const c = i + R * j;
      const d = Math.max(Math.abs(H[c] - H[c + 1]), Math.abs(H[c] - H[c + R]));
      if (d > maxJump) { maxJump = d; jumpAt = [i, j, H[c]]; }
      if (d > 12) big++;
    }
  }
  // sample the heightfield at a few world points
  const samples = [];
  for (const [x, z] of [[0, 0], [100, 0], [0, 100], [200, 200], [-300, 0], [400, 0], [0, -400]]) {
    samples.push([x, z, +g.island.heightAt(x, z).toFixed(2)]);
  }
  return { min: mn, max: mx, nan, bigJumps: big, maxJump, jumpAt, samples, rivers: g.island.rivers.length, waterfalls: g.island.waterfalls.length, coast: g.island.coastRing.length };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
