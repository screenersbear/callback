// PERFORMANCE TESTS: measures real load speed in Chrome and fails if a budget is blown.
// Budgets live in safety.config.json under "budgets".
import { test, expect } from '@playwright/test';
import cfg from '../../kit.config.mjs';

const b = cfg.budgets;

const collectMetrics = () => {
  window.__perf = { lcp: 0, cls: 0, longest: 0 };
  const obs = (type, fn) => {
    try {
      new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true });
    } catch {}
  };
  obs('largest-contentful-paint', (e) => (window.__perf.lcp = e.startTime));
  obs('layout-shift', (e) => { if (!e.hadRecentInput) window.__perf.cls += e.value; });
  obs('longtask', (e) => (window.__perf.longest = Math.max(window.__perf.longest, e.duration)));
};

async function measure(page, path) {
  await page.addInitScript(collectMetrics);
  await page.goto(path, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    return {
      loadMs: Math.round(nav.loadEventEnd),
      lcpMs: Math.round(window.__perf.lcp),
      cls: Number(window.__perf.cls.toFixed(3)),
      longestTaskMs: Math.round(window.__perf.longest),
      heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null,
      transferKB: Math.round(
        performance.getEntriesByType('resource').reduce((s, r) => s + (r.transferSize || 0), nav.transferSize || 0) / 1024,
      ),
    };
  });
}

test.skip(({ browserName }) => browserName !== 'chromium', 'performance metrics need Chromium');

for (const path of cfg.pages) {
  test(`${path} is fast on a normal connection`, async ({ page }, testInfo) => {
    const m = await measure(page, path);
    await testInfo.attach('metrics.json', { body: JSON.stringify(m, null, 2), contentType: 'application/json' });
    console.log(`[perf] ${path}`, m);
    expect.soft(m.loadMs, 'full load time').toBeLessThanOrEqual(b.loadMs);
    expect.soft(m.lcpMs, 'main content visible').toBeLessThanOrEqual(b.lcpMs);
    expect.soft(m.cls, 'layout jumping around').toBeLessThanOrEqual(b.cls);
    expect.soft(m.longestTaskMs, 'longest freeze').toBeLessThanOrEqual(b.longestTaskMs);
    if (m.heapMB !== null) expect.soft(m.heapMB, 'memory used').toBeLessThanOrEqual(b.heapMB);
  });

  test(`${path} is usable on a slow phone`, async ({ page }, testInfo) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const m = await measure(page, path);
    await testInfo.attach('slow-phone-metrics.json', { body: JSON.stringify(m, null, 2), contentType: 'application/json' });
    console.log(`[perf slow phone] ${path}`, m);
    expect(m.loadMs, 'load time on slow 4G + slow CPU').toBeLessThanOrEqual(b.slowPhoneLoadMs);
  });
}
