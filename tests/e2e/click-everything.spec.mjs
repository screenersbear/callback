// THE BUTTON CLICKER
// Opens each page, finds every button/link/tab/checkbox a person could click,
// and clicks each one in a fresh tab. Then it opens anything that click revealed
// (menus, modals, new screens) and clicks those too, up to clickDepth levels.
// Fails if any click causes a JS crash, a console error, a broken request,
// or if the element can't actually be clicked (covered up, frozen).
//
// No AI involved: this is a plain script, so it costs zero tokens to run.
// To exclude a button that does something irreversible to real data,
// add data-test-skip to it in your HTML.
import { test, expect } from '@playwright/test';
import { cfg, freshPage, markClickables, clickIdx } from './_helpers.mjs';

// Each page is clicked through twice: as a first visit (empty storage) and as a
// returning visitor (see returningVisitor in safety.config.json).
const VISITS = cfg.returningVisitor ? [['first visit', false], ['returning visitor', true]] : [['first visit', false]];

for (const path of cfg.pages) for (const [visit, returning] of VISITS) {
  test(`every clickable thing on ${path} works (${visit})`, async ({ browser }, testInfo) => {
    test.setTimeout(10 * 60_000);
    const failures = [];
    let clicks = 0;

    // Level 0: what's on screen when the page first loads.
    const first = await freshPage(browser, testInfo, path, { returning });
    expect(first.problems, 'page must load cleanly before clicking anything').toEqual([]);
    const level0 = await markClickables(first.page);
    await first.ctx.close();
    const seen = new Set(level0.map((c) => c.fp));

    // Each entry is a "click path": a list of indices to click in order from a fresh load.
    let frontier = level0.map((c, i) => ({ path: [i], label: c.label }));

    for (let depth = 1; depth <= cfg.clickDepth && frontier.length; depth++) {
      const next = [];
      for (const item of frontier) {
        if (clicks >= cfg.maxClicks) break;
        clicks++;
        await test.step(item.label, async () => {
          const { ctx, page, problems } = await freshPage(browser, testInfo, path, { returning });
          try {
            // Replay the path: re-mark after every click since the screen changes.
            for (let s = 0; s < item.path.length; s++) {
              await markClickables(page);
              await clickIdx(page, item.path[s]);
            }
            if (depth < cfg.clickDepth) {
              const after = await markClickables(page);
              after.forEach((c, j) => {
                if (!seen.has(c.fp)) {
                  seen.add(c.fp);
                  next.push({ path: [...item.path, j], label: `${item.label} > ${c.label}` });
                }
              });
            }
          } catch (e) {
            // The first line, plus why Playwright couldn't click (covered, moving, off screen).
            const why = e.message.split('\n').filter((l) => /intercepts pointer events|not stable|outside of the viewport|not visible|detached/.test(l)).pop();
            problems.push(`could not click: ${e.message.split('\n')[0]}${why ? ` (${why.trim().slice(0, 160)})` : ''}`);
          }
          if (problems.length) failures.push({ clicked: item.label, problems });
          await ctx.close();
        });
      }
      frontier = next;
    }

    testInfo.annotations.push({ type: 'clicks', description: `${clicks} elements clicked` });
    console.log(`[click-everything] ${path} (${visit}): clicked ${clicks} elements, ${failures.length} problems`);
    expect(failures, 'these clicks caused problems').toEqual([]);
  });
}
