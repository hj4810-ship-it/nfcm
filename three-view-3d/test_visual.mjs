import { chromium } from 'playwright-core';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 920 }, deviceScaleFactor: 1 });
page.on('console', (msg) => console.log('CONSOLE', msg.type(), msg.text()));
page.on('pageerror', (err) => console.log('PAGEERROR', err.stack || err.message));

const url = pathToFileURL(path.resolve('index.html')).href;
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(1200);
await page.screenshot({ path: 'shots/01-empty.png' });

await page.click('#emptyDemoBtn');
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(150);
  const snap = await page.evaluate(() => {
    const app = window.__THREE_VIEW__;
    return {
      views: Object.keys(app.state.views).filter((k) => app.state.views[k]),
      ready: Object.values(app.state.views).filter((v) => v?.extracted).length,
      building: app.state.building,
      hasResult: !!app.state.lastResult,
      loading: !document.querySelector('#loading').hidden,
      hint: document.querySelector('#buildHint').textContent,
      toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent),
    };
  });
  console.log(i, JSON.stringify(snap));
  if (snap.hasResult) break;
}

if (await page.evaluate(() => !window.__THREE_VIEW__.state.lastResult)) {
  await page.screenshot({ path: 'shots/02-failed.png' });
  await browser.close();
  process.exit(1);
}

const stats = await page.evaluate(() => {
  const app = window.__THREE_VIEW__;
  return {
    result: {
      tris: app.state.lastResult.triangleCount,
      extents: app.state.lastResult.extents,
      resolution: app.state.lastResult.resolution,
      duration: app.state.lastResult.duration,
      tol: app.state.lastResult.toleranceExpanded,
    },
    views: Object.fromEntries(
      Object.entries(app.state.views).map(([k, v]) => [k, v && {
        mode: v.extracted?.mode,
        bbox: v.extracted?.bbox,
        warning: v.extracted?.warning,
        fillRatio: v.extracted?.fillRatio,
      }]),
    ),
  };
});
console.log('STATS', JSON.stringify(stats, null, 2));
await page.evaluate(() => {
  window.__THREE_VIEW__.viewer.setAutoRotate(false);
  window.__THREE_VIEW__.viewer.setView('iso');
});
await page.waitForTimeout(1200);
await page.screenshot({ path: 'shots/02-demo-iso.png' });

await page.evaluate(() => window.__THREE_VIEW__.viewer.setView('front'));
await page.waitForTimeout(900);
await page.screenshot({ path: 'shots/03-demo-front.png' });
await page.evaluate(() => window.__THREE_VIEW__.viewer.setView('side'));
await page.waitForTimeout(900);
await page.screenshot({ path: 'shots/04-demo-side.png' });
await page.evaluate(() => window.__THREE_VIEW__.viewer.setView('top'));
await page.waitForTimeout(900);
await page.screenshot({ path: 'shots/05-demo-top.png' });

await browser.close();
