// END-TO-END + PERFORMANCE TESTS (real browsers, real clicks)
import { defineConfig, devices } from '@playwright/test';
import cfg from './kit.config.mjs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const appDir = dirname(fileURLToPath(import.meta.url));

const baseURL = `http://127.0.0.1:${cfg.port}`;

export default defineConfig({
  testDir: 'tests',
  testMatch: ['e2e/**/*.spec.{js,mjs}', 'perf/**/*.spec.{js,mjs}'],
  outputDir: 'reports/test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['github'], ['html', { outputFolder: 'reports/playwright', open: 'never' }]]
    : [['dot'], ['html', { outputFolder: 'reports/playwright', open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
    { name: 'iphone', use: { ...devices['iPhone 14'] } },
  ],
  webServer: {
    // tests/serve.mjs gzips text the way GitHub Pages does, so speed is measured as a phone gets it.
    command: `node tests/serve.mjs "${cfg.serveDir}" ${cfg.port}`,
    cwd: appDir,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
