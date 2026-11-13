// SMOKE TESTS: the basics every app must pass on every device.
import { test, expect } from '@playwright/test';
import { cfg, watch } from './_helpers.mjs';

for (const path of cfg.pages) {
  test.describe(`page ${path}`, () => {
    test('loads with no errors and shows something', async ({ page, baseURL }) => {
      const problems = watch(page, new URL(baseURL).origin);
      const res = await page.goto(path);
      await page.waitForLoadState('networkidle').catch(() => {});
      expect(res?.status(), 'page should not 404/500').toBeLessThan(400);
      await expect(page.locator('body')).toBeVisible();
      expect((await page.locator('body').innerText()).trim().length, 'page should not be blank').toBeGreaterThan(0);
      expect(problems).toEqual([]);
    });

    test('nothing spills off the side of the screen', async ({ page }) => {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, 'horizontal scroll means something is too wide').toBeLessThanOrEqual(1);
    });

    test('keeps working after a reload (saved data does not break startup)', async ({ page, baseURL }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle').catch(() => {});
      const problems = watch(page, new URL(baseURL).origin);
      await page.reload();
      await page.waitForLoadState('networkidle').catch(() => {});
      expect(problems).toEqual([]);
    });

    test('works offline once installed (PWA only)', async ({ page, context }) => {
      await page.goto(path);
      const hasSW = await page.evaluate(async () => {
        if (!('serviceWorker' in navigator)) return false;
        const reg = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((r) => setTimeout(() => r(null), 5000)),
        ]);
        return !!reg;
      });
      test.skip(!hasSW, 'no service worker on this page');
      await page.reload(); // let the service worker take control
      await context.setOffline(true);
      await page.reload();
      await expect(page.locator('body')).toBeVisible();
      expect((await page.locator('body').innerText()).trim().length).toBeGreaterThan(0);
      await context.setOffline(false);
    });
  });
}
