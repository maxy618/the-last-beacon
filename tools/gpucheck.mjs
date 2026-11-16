import { chromium } from 'playwright';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.goto(process.argv[2] || 'http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
const info = await page.evaluate(() => {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2');
  const d = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    vendor: gl.getParameter(d.UNMASKED_VENDOR_WEBGL),
    renderer: gl.getParameter(d.UNMASKED_RENDERER_WEBGL),
    version: gl.getParameter(gl.VERSION),
    maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    samples: gl.getParameter(gl.MAX_SAMPLES),
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
