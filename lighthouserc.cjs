// LIGHTHOUSE: Google's page audit (speed, accessibility, best practices).
// Reports are saved locally in reports/lighthouse, never uploaded anywhere public.
const cfg = require('./safety.config.json');
const b = cfg.budgets;

module.exports = {
  ci: {
    collect: {
      staticDistDir: cfg.serveDir,
      url: cfg.pages.map((p) => `http://localhost${p}`),
      numberOfRuns: 3,
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: b.lighthousePerformance }],
        'categories:accessibility': ['error', { minScore: b.lighthouseAccessibility }],
        'categories:best-practices': ['warn', { minScore: b.lighthouseBestPractices }],
      },
    },
    upload: { target: 'filesystem', outputDir: 'reports/lighthouse' },
  },
};
