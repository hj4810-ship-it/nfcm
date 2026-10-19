import { chromium } from 'playwright-core';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
page.on('pageerror', (err) => console.log('PAGEERROR', err.message));
await page.goto(pathToFileURL(path.resolve('index.html')).href);
await page.waitForTimeout(700);
await page.click('#emptyDemoBtn');
await page.waitForFunction(() => window.__THREE_VIEW__.state.lastResult, null, { timeout: 30000 });
await page.evaluate(() => {
  const v = window.__THREE_VIEW__.viewer;
  v.setAutoRotate(false);
  v.setView('iso');
});
await page.waitForTimeout(1000);

const variants = [
  { name: 'A', color: 0x6f94bd, metalness: 0.35, roughness: 0.32, exposure: 0.95, key: 2.2 },
  { name: 'B', color: 0x4f7296, metalness: 0.55, roughness: 0.3, exposure: 1.0, key: 2.6 },
  { name: 'C', color: 0x87a8c9, metalness: 0.2, roughness: 0.4, exposure: 0.82, key: 1.8 },
  { name: 'D', color: 0x8aa7c4, metalness: 0.62, roughness: 0.22, exposure: 0.9, key: 2.0 },
];

for (const v of variants) {
  await page.evaluate((cfg) => {
    const viewer = window.__THREE_VIEW__.viewer;
    viewer.material.color.setHex(cfg.color);
    viewer.material.metalness = cfg.metalness;
    viewer.material.roughness = cfg.roughness;
    viewer.material.envMapIntensity = 1.0;
    viewer.material.needsUpdate = true;
    viewer.renderer.toneMappingExposure = cfg.exposure;
    viewer.keyLight.intensity = cfg.key;
  }, v);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `shots/material-${v.name}.png` });
}

await browser.close();
