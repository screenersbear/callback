## Testing rules (from app-safety-kit)

These rules apply to every change in this repo. Where they run changed on 2026-11-14, to save time and tokens: the checks
themselves and every number in safety.config.json stay as they are.

1. Every function gets several unit tests: the normal case, the edge cases (empty, zero, one item, very large, dates across midnight/months), and bad input. Three tests per function is the floor, not the goal.
2. Keep logic (calculations, data shaping, storage, parsing) in exported functions inside the folders listed under "logic" in safety.config.json. Keep DOM wiring thin. Logic is unit tested; the DOM is covered by the browser tests.
3. Never lower a number in safety.config.json, never add `.skip` / `.only`, never delete or weaken a test to make things pass, and never add files to "ignore" to dodge coverage. If a threshold seems wrong, stop and ask Starky.
4. While working, run only the unit tests for the files you changed (`npx vitest run --config vitest.config.mjs <test file>`). Then run `npm run test:quick` once, before committing, and fix anything it reports. (The pre-push check runs it again on push.)
5. Don't run the mutation tests, Lighthouse or the speed checks on this computer (`test:mutation`, `test:lighthouse`, `test:perf`, `test:all`). GitHub Actions runs them, with the unit and browser tests and an npm audit, on every push and every night (`.github/workflows/safety-checks.yml`).
6. If a GitHub run fails, fix that first. `node tools/ci-status.mjs` shows the latest runs and, for a failed job, the step and the notes it left (failing tests, mutants not caught, Lighthouse scores), without a login. A bug still gets its failing test first; mutants not caught in code you changed get tests that catch them.
7. Don't split work across parallel agents or worktrees unless Starky asks.
8. Any new button, link or control must survive tests/e2e/click-everything. Only add `data-test-skip` to a control that would destroy real data or call a paid/external service, and leave an HTML comment saying why.
9. Save tokens: run tests through the npm scripts (they print short summaries). Read only the failing test's output, e.g. `npm run test:quick 2>&1 | tail -60`. Do not open the HTML reports or paste full logs.
10. When fixing a bug, first write a test that fails because of the bug, then fix it.
