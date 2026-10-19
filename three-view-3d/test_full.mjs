import { chromium } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') {
    errors.push(msg.text());
    console.log('CONSOLE ERROR', msg.text());
  }
});
page.on('pageerror', (err) => {
  errors.push(err.message);
  console.log('PAGEERROR', err.stack);
});

await page.goto(pathToFileURL(path.resolve('index.html')).href);
await page.waitForTimeout(800);
console.log('initial ready', await page.evaluate(() => window.__THREE_VIEW__?.state !== undefined));

const inputs = await page.$$('.slot input[type=file]');
const files = ['assets/demo-front.png', 'assets/demo-top.png', 'assets/demo-side.png'];
for (let i = 0; i < 3; i++) {
  await inputs[i].setInputFiles(path.resolve(files[i]));
  await page.waitForTimeout(350);
}
await page.waitForFunction(() => window.__THREE_VIEW__.state.lastResult, null, { timeout: 30000 });
await page.evaluate(() => {
  const v = window.__THREE_VIEW__.viewer;
  v.setAutoRotate(false);
  v.setView('iso');
});
await page.waitForTimeout(1100);
console.log('after upload', await page.evaluate(() => {
  const a = window.__THREE_VIEW__;
  return {
    result: a.state.lastResult.triangleCount,
    extents: a.state.lastResult.extents,
    views: Object.fromEntries(Object.entries(a.state.views).map(([k, v]) => [k, v.extracted.mode])),
    slotFilled: [...document.querySelectorAll('.slot-filled')].filter((e) => !e.hidden).length,
    statusVisible: !document.querySelector('#statusBlock').hidden,
  };
}));
await page.screenshot({ path: 'shots/10-final-iso.png' });

// Resolution change
await page.click('#settings summary');
await page.waitForTimeout(250);
await page.selectOption('#resolution', '144');
await page.waitForTimeout(1700);
console.log('after 144', await page.evaluate(() => ({
  ready: !window.__THREE_VIEW__.state.building,
  tris: window.__THREE_VIEW__.state.lastResult?.triangleCount,
  res: window.__THREE_VIEW__.state.lastResult?.resolution,
})));

// Toggle top flip and back
await page.check('#topFlip');
await page.waitForTimeout(1400);
console.log('after top flip', await page.evaluate(() => ({
  tris: window.__THREE_VIEW__.state.lastResult?.triangleCount,
  toast: [...document.querySelectorAll('.toast')].map((t) => t.textContent).slice(-1),
})));
await page.uncheck('#topFlip');
await page.waitForTimeout(1400);

// Wireframe screenshot
await page.click('#wireBtn');
await page.waitForTimeout(400);
await page.screenshot({ path: 'shots/11-wireframe.png' });
await page.click('#wireBtn');

// Export STL
const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
await page.click('#downloadBtn');
const download = await downloadPromise;
const stlPath = path.resolve('shots/test-model.stl');
await download.saveAs(stlPath);
const stl = fs.readFileSync(stlPath);
const stlCount = stl.readUInt32LE(80);
console.log('stl', { bytes: stl.length, triangles: stlCount, expectedBytes: 84 + stlCount * 50 });

// Mobile
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
mobile.on('pageerror', (err) => console.log('MOBILE PAGEERROR', err.message));
await mobile.goto(pathToFileURL(path.resolve('index.html')).href);
await mobile.waitForTimeout(600);
await mobile.click('#emptyDemoBtn');
await mobile.waitForFunction(() => window.__THREE_VIEW__.state.lastResult, null, { timeout: 30000 });
await mobile.evaluate(() => {
  window.__THREE_VIEW__.viewer.setAutoRotate(false);
  window.__THREE_VIEW__.viewer.setView('iso');
});
await mobile.waitForTimeout(900);
await mobile.screenshot({ path: 'shots/12-mobile.png', fullPage: false });

console.log('errors', errors);
await browser.close();
