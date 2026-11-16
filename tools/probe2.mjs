import { chromium } from 'playwright';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);
const info = await page.evaluate(() => {
  const g = window.__game;
  const out = [];
  for (const mesh of g.terrain.group.children) {
    const pos = mesh.geometry.attributes.position;
    const splat = mesh.geometry.attributes.aSplat;
    if (!splat) { out.push({ err: 'no aSplat', lod: mesh.userData.lod }); continue; }
    // find the vertex closest to (250, ?, 250)
    let best = 0, bestD = 1e9;
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i) - 250, dz = pos.getZ(i) - 250;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    const surf = g.island.surfaceAt(250, 250);
    out.push({
      lod: mesh.userData.lod,
      vert: [pos.getX(best), pos.getY(best), pos.getZ(best)].map((v) => +v.toFixed(2)),
      splat: [splat.getX(best), splat.getY(best), splat.getZ(best), splat.getW(best)].map((v) => +v.toFixed(3)),
      surfAtVertex: (() => { const s = g.island.surfaceAt(pos.getX(best), pos.getZ(best)); return [+s.sand.toFixed(2), +s.grass.toFixed(2), +s.rock.toFixed(2), +s.moss.toFixed(2)]; })(),
      ref: [+surf.sand.toFixed(2), +surf.grass.toFixed(2), +surf.rock.toFixed(2), +surf.moss.toFixed(2)],
    });
  }
  return out.slice(0, 6);
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
