// MUTATION TESTS: the "is every piece covered by tests that actually catch bugs" check.
// Stryker deliberately breaks your code in hundreds of small ways (flips > to <, deletes a line,
// swaps true/false). If your tests still pass after a break, that piece is under-tested.
import cfg from './kit.config.mjs';

export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.config.mjs' },
  mutate: [...cfg.logic, ...cfg.ignore.map((g) => `!${g}`)],
  // json: read on GitHub by tools/ci-notes.mjs, which notes the mutants not caught.
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  thresholds: { high: 90, low: cfg.mutationScore, break: cfg.mutationScore },
  // Only re-check code that changed since the last run. Keeps CI fast.
  incremental: true,
  incrementalFile: 'reports/stryker-incremental.json',
  tempDirName: '.stryker-tmp',
  // Not copied into each mutation sandbox: files no unit test touches.
  ignorePatterns: ['fonts', 'icons', 'mockups', 'reports', '.claude', 'tests/e2e', 'tests/perf', 'callback-spec.md'],
};
