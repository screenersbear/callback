// Shared helpers for the browser tests.
import cfg from '../../kit.config.mjs';

export { cfg };

export const CLICKABLE = [
  'button',
  'a[href]',
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[onclick]',
  'input[type="button"]',
  'input[type="submit"]',
  'input[type="checkbox"]',
  'input[type="radio"]',
  'summary',
  'label[for]',
].join(',');

/** Collect every problem a page reports while we use it. */
export function watch(page, origin) {
  const problems = [];
  const ignored = (text) => cfg.ignoreConsoleErrors.some((s) => text.includes(s));
  page.on('pageerror', (e) => problems.push(`JS crash: ${e.message}`));
  page.on('console', (m) => {
    // "Failed to load resource" is reported below with its URL, so skip the URL-less duplicate.
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource') && !ignored(m.text())) {
      problems.push(`console.error: ${m.text()}`);
    }
  });
  page.on('response', (r) => {
    if (r.url().startsWith(origin) && r.status() >= 400 && !ignored(r.url())) {
      problems.push(`HTTP ${r.status()} for ${r.url()}`);
    }
  });
  page.on('requestfailed', (r) => {
    if (r.url().startsWith(origin) && !ignored(r.url())) {
      problems.push(`request failed: ${r.url()} (${r.failure()?.errorText})`);
    }
  });
  // Never let an alert/confirm freeze the run. Dismiss = the "cancel" path.
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  return problems;
}

/**
 * Tag every visible, clickable, same-site element with data-safety-idx
 * and return a fingerprint + human label for each, in page order.
 */
export async function markClickables(page) {
  return page.evaluate(
    ({ sel, skip, modalSel }) => {
      document.querySelectorAll('[data-safety-idx]').forEach((e) => e.removeAttribute('data-safety-idx'));
      const out = [];
      // While a modal dialog is open, a person can only use what's inside it
      // (the page behind is dimmed and covered), so only those count. The last
      // open one in page order is the one on top.
      const shown = (e) => {
        const b = e.getBoundingClientRect();
        const s = getComputedStyle(e);
        return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !e.closest('[hidden]');
      };
      const modals = [...document.querySelectorAll(modalSel)].filter(shown);
      const scope = modals.length ? modals[modals.length - 1] : document;
      for (const el of scope.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue;
        // Faded out to nothing and not taking taps: nobody can see or press it.
        if (cs.pointerEvents === 'none') continue;
        let faded = false;
        for (let a = el; a && a !== document.documentElement; a = a.parentElement) if (getComputedStyle(a).opacity === '0') { faded = true; break; }
        if (faded) continue;
        // Inside a screen-reader-only box (the 1px "visually hidden" pattern):
        // there for a screen reader, not a finger, so nobody taps it.
        let srOnly = false;
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          const ab = a.getBoundingClientRect();
          const as = getComputedStyle(a);
          const clipped = as.clip === 'rect(0px, 0px, 0px, 0px)' || as.clipPath === 'inset(50%)';
          if (clipped || ((ab.width <= 1 || ab.height <= 1) && as.overflow !== 'visible')) { srOnly = true; break; }
        }
        if (srOnly) continue;
        // Inside a folded <details> (not its summary): not on screen until it's opened.
        const fold = el.closest('details:not([open])');
        if (fold && !el.closest('summary')) continue;
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
        if (skip.some((s) => el.closest(s))) continue;
        if (el.tagName === 'A') {
          const href = el.getAttribute('href') || '';
          if (/^(mailto:|tel:|sms:|javascript:)/i.test(href)) continue;
          const u = new URL(el.href, location.href);
          if (u.origin !== location.origin || el.target === '_blank' || el.hasAttribute('download')) continue;
        }
        const label = (
          el.getAttribute('aria-label') ||
          el.getAttribute('title') ||
          el.innerText ||
          el.value ||
          el.id ||
          el.getAttribute('class') ||
          el.tagName
        )
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 60);
        const fp = [el.tagName, el.id, el.getAttribute('class'), el.getAttribute('href'), label].join('|');
        el.setAttribute('data-safety-idx', String(out.length));
        out.push({ fp, label: `<${el.tagName.toLowerCase()}> "${label}"` });
      }
      return out;
    },
    { sel: CLICKABLE, skip: cfg.skipClickSelectors, modalSel: (cfg.modalSelectors || ['[aria-modal="true"]', 'dialog[open]']).join(',') },
  );
}

// An app that keeps its "seen before" state in its own database
// (IndexedDB) gets it from returningVisitor.seed, a module with seed(page).
// It runs once per worker; every fresh tab after that starts from a copy of
// the storage it left (Playwright's storageState, IndexedDB included).
const seeded = new Map();
async function seededState(browser, opts, path) {
  if (!seeded.has(opts.baseURL)) {
    seeded.set(opts.baseURL, (async () => {
      const ctx = await browser.newContext(opts);
      const page = await ctx.newPage();
      await page.goto(path);
      await page.waitForLoadState('networkidle').catch(() => {});
      const { seed } = await import(new URL(`../../${cfg.returningVisitor.seed}`, import.meta.url));
      await seed(page);
      const state = await ctx.storageState({ indexedDB: true });
      await ctx.close();
      return state;
    })());
  }
  return seeded.get(opts.baseURL);
}

/** A brand new, isolated browser tab (fresh storage) with the same device settings as the project. */
// returning: start as someone who has opened the app before: with
// safety.config.json's returningVisitor.localStorage saved, and the storage
// returningVisitor.seed leaves. Otherwise storage is empty, and we wait
// firstVisitWaitMs for anything shown on a first visit to come up.
export async function freshPage(browser, testInfo, path, { returning = false } = {}) {
  const u = testInfo.project.use;
  const opts = {
    baseURL: u.baseURL,
    viewport: u.viewport,
    userAgent: u.userAgent,
    deviceScaleFactor: u.deviceScaleFactor,
    isMobile: u.isMobile,
    hasTouch: u.hasTouch,
  };
  const storageState = returning && cfg.returningVisitor?.seed ? await seededState(browser, opts, path) : undefined;
  // No service worker in these tabs: each would fetch and cache the whole app
  // again. The smoke tests check the offline copy on their own.
  const ctx = await browser.newContext({ ...opts, storageState, serviceWorkers: 'block' });
  // Counts the page's short timers (2 s or less) still to fire, so settle()
  // can wait for something the app opens a moment after a tap.
  await ctx.addInitScript(() => {
    const real = window.setTimeout;
    const clear = window.clearTimeout;
    const pending = new Set();
    window.__safetyPending = () => pending.size;
    window.setTimeout = function (fn, ms, ...args) {
      if (typeof fn !== 'function') return real.call(window, fn, ms, ...args);
      const id = real.call(window, function () { pending.delete(id); return fn.apply(this, args); }, ms);
      if ((Number(ms) || 0) <= 2000) pending.add(id);
      return id;
    };
    window.clearTimeout = function (id) { pending.delete(id); return clear.call(window, id); };
  });
  if (returning) {
    await ctx.addInitScript((saved) => {
      for (const [k, v] of Object.entries(saved)) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } }
    }, cfg.returningVisitor?.localStorage || {});
  }
  const page = await ctx.newPage();
  const problems = watch(page, new URL(u.baseURL).origin);
  // settle() below waits for the page to be done, so no need to wait for
  // the network to sit idle as well.
  await page.goto(path);
  if (!returning && cfg.firstVisitWaitMs) await page.waitForTimeout(cfg.firstVisitWaitMs);
  await settle(page);
  return { ctx, page, problems };
}

// Waits until the page has stopped adding or removing elements for settleMs, nothing is mid-animation (looping ones aside) and no short
// timer is still to fire, up to 4 s:
// a page that draws twice, or opens something once a move has finished, is
// only marked once it's done.
async function settle(page) {
  await page.evaluate((quiet) => new Promise((done) => {
    let last = performance.now();
    const t0 = last;
    const obs = new MutationObserver(() => { last = performance.now(); });
    obs.observe(document.body, { childList: true, subtree: true });
    const moving = () => document.getAnimations().some((a) => {
      if (a.playState !== 'running') return false;
      const end = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming().endTime : Infinity;
      return Number.isFinite(end);
    });
    const tick = () => {
      const now = performance.now();
      const waiting = window.__safetyPending ? window.__safetyPending() > 0 : false;
      if ((now - last >= quiet && !moving() && !waiting) || now - t0 > 4000) { obs.disconnect(); done(); return; }
      setTimeout(tick, 100);
    };
    tick();
  }), cfg.settleMs).catch(() => {});
}

export async function clickIdx(page, idx) {
  await page.locator(`[data-safety-idx="${idx}"]`).first().click({ timeout: 3000 });
  await settle(page);
}
