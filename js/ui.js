// Interface pieces shared by every screen: bottom sheets, confirmations,
// choices and the toast.
import { esc } from './util.js';

export const X_ICON =
  '<svg class="x-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

const open = [];

// On an iPhone the keyboard covers the bottom of the screen without
// shrinking the page, and iOS scrolls the screen up to show the field being
// typed in. Sheets follow along: while the keyboard is up they sit in the
// part of the screen it leaves visible (--vv-top and --vv-height, from
// visualViewport). html also gets .kb-up and --kb (the keyboard's height),
// which gives the page room at the bottom and tucks the tab bar away, and
// whatever is being typed in is moved to sit just above the keyboard.
// Android resizes the page itself, so --kb stays near 0 there.
//
// iOS 26 and 27 often leave visualViewport's numbers stuck after the
// keyboard goes: offsetTop stays where it was and the height stays short.
// Following them then pushed a sheet opened next (the circle picker, right
// after typing a name) down under the keyboard. So they're only used while
// the keyboard is up; otherwise sheets fill the screen as usual. And an
// offsetTop that's stuck with no keyboard up is taken off what it says the
// next time the keyboard comes up.
const vv = window.visualViewport;
const html = document.documentElement;
const TYPING = 'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="hidden"]), textarea, select, [contenteditable="true"]';
const typingIn = (el) => !!(el && el.matches && el.matches(TYPING));
let leftoverTop = 0; // the offsetTop iOS still reports with no keyboard up
let viewTop = 0;
let viewHeight = window.innerHeight;
function fitViewport() {
  if (!vv) return;
  const typing = typingIn(document.activeElement);
  const kb = Math.max(0, Math.round(html.clientHeight - vv.height));
  const up = kb > 120 && typing;
  if (!typing && vv.scale < 1.01) leftoverTop = Math.max(0, vv.offsetTop);
  viewTop = up ? Math.max(0, vv.offsetTop - leftoverTop) : 0;
  viewHeight = up ? vv.height : window.innerHeight;
  html.style.setProperty('--vv-top', `${viewTop}px`);
  html.style.setProperty('--vv-height', `${viewHeight}px`);
  html.style.setProperty('--kb', `${kb}px`);
  html.classList.toggle('kb-up', up);
}

// The nearest box that scrolls (a sheet's body), or null for the page.
function scrollerOf(el) {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return null;
}

// Moves the field, with its label, so it sits just above the keyboard (or
// just under the top, if it's up there). A field that's already in view
// stays where it is.
const GAP = 16;
function keepInView(el) {
  if (!el.isConnected || document.activeElement !== el) return;
  let top = viewTop + GAP;
  let bottom = viewTop + viewHeight - GAP;
  const box = scrollerOf(el);
  if (box) {
    const b = box.getBoundingClientRect();
    top = Math.max(top, b.top + GAP / 2);
    bottom = Math.min(bottom, b.bottom - GAP / 2);
  }
  // A sheet's sticky footer (its Save or Done button, or the Add person
  // wizard's Next bar) covers fields too.
  const footer = el.closest('.sheet') && el.closest('.sheet').querySelector('.sheet-footer, .wiz-nav');
  if (footer && !footer.contains(el)) bottom = Math.min(bottom, footer.getBoundingClientRect().top - GAP / 2);
  const r = el.getBoundingClientRect();
  if (!r.height) return;
  const wrap = el.closest('.field');
  // An open dropdown under the field (your organizations) comes along too.
  const drop = wrap && wrap.querySelector('.suggest:not([hidden])');
  let want = { top: wrap ? Math.min(r.top, wrap.getBoundingClientRect().top) : r.top, bottom: drop ? Math.max(r.bottom, drop.getBoundingClientRect().bottom) : r.bottom };
  if (want.bottom - want.top > bottom - top) want = { top: r.top, bottom: r.bottom };
  let delta = 0;
  if (r.bottom - r.top > bottom - top) {
    // Taller than the space (a long note): show its top, unless enough of
    // it is in view already.
    if (r.top > bottom - 60 || r.bottom < top + 60) delta = r.top - top;
  } else if (want.bottom > bottom) delta = want.bottom - bottom;
  else if (want.top < top) delta = want.top - top;
  if (Math.abs(delta) < 2) return;
  if (box) {
    const before = box.scrollTop;
    box.scrollTop = before + delta;
    delta -= box.scrollTop - before;
  }
  // Sheets are pinned to the screen, so only page fields move the page.
  if (Math.abs(delta) >= 2 && !el.closest('.sheet-overlay')) window.scrollBy(0, delta);
}

let settleTimers = [];
function settle(el) {
  // Now, and again while the keyboard slides up and iOS finishes its own scroll.
  settleTimers.forEach(clearTimeout);
  settleTimers = [0, 120, 300, 600].map((ms) => setTimeout(() => { fitViewport(); keepInView(el); }, ms));
}
document.addEventListener('focusin', (e) => {
  if (typingIn(e.target)) settle(e.target);
});
// Leaving a field for the next one keeps the keyboard up, so wait a moment
// before deciding it's gone (taking the room away would jump the page).
document.addEventListener('focusout', () => setTimeout(fitViewport, 150));
// Typing can move a field down (a note growing a line), so check again.
document.addEventListener('input', (e) => {
  if (typingIn(e.target)) keepInView(e.target);
});
// So can the page changing while the keyboard stays up, like a circle just
// added to the list above the "New circle" box.
new MutationObserver(() => {
  if (typingIn(document.activeElement)) keepInView(document.activeElement);
}).observe(document.body, { childList: true, subtree: true });
// iOS zooms in on any field with text under 16px (a detail's label) and
// leaves the page zoomed. A scale limit stops that; pinching still zooms.
if (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
  const meta = document.querySelector('meta[name="viewport"]');
  if (meta && !/maximum-scale/.test(meta.content)) meta.content += ', maximum-scale=1';
}
if (vv) {
  vv.addEventListener('resize', () => {
    fitViewport();
    if (typingIn(document.activeElement)) keepInView(document.activeElement);
  });
  vv.addEventListener('scroll', fitViewport);
  fitViewport();
}

// iOS 26 home-screen app on an iPhone: right after it opens, iOS sometimes
// has the screen about a status bar short at the bottom, and keeps that
// until a page grows taller than the screen (going to Week did it). In that
// state it pins the tab bar to its short bottom (too high), and it doesn't
// draw anything pinned to the screen below that edge: moving the bar down
// to the real bottom (by the measured gap, or from the top) only cut it in
// half. So the bar stays on iOS's bottom, whole, and iOS is made to measure
// again the way Week does: for a moment the page is made taller than the
// screen and scrolled a pixel and back. As the app opens, comes back from
// the background or is shown again, and again a few times while a probe
// pinned to iOS's bottom still says it's short. Only when the page is
// drawn up under the status bar (a top safe area), so the screen's top is
// the page's top; never while typing.
const iPhoneApp = /iPhone|iPod/.test(navigator.userAgent) && (navigator.standalone === true || matchMedia('(display-mode: standalone)').matches);
let probe = null;
// How far short of the screen's real bottom iOS has its bottom edge, in px
// (0 when it's right). `full` stands in for the screen's height in tests.
export function screenGap(full = 0) {
  if (!document.body) return 0;
  if (!probe) {
    probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position: fixed; left: 0; bottom: 0; width: 1px; height: 0; visibility: hidden; pointer-events: none; padding-top: var(--test-safe-top, env(safe-area-inset-top));';
    document.body.appendChild(probe);
  }
  const portrait = Math.abs(window.innerWidth - screen.width) < 2;
  const real = full || (portrait ? screen.height : screen.width);
  html.style.setProperty('--screen-h', `${Math.round(real)}px`);
  const under = parseFloat(getComputedStyle(probe).paddingTop) > 0;
  const gap = Math.round(real - probe.getBoundingClientRect().bottom);
  return under && gap > 8 && gap < 120 ? gap : 0;
}
let nudging = false;
// For tests: `full` as in screenGap. Resolves with the gap left after it.
export function nudgeScreen(tries = 5, full = 0) {
  return new Promise((done) => {
    const go = (left) => {
      if (!left || !screenGap(full) || html.classList.contains('kb-up') || typingIn(document.activeElement)) {
        nudging = false;
        done(screenGap(full));
        return;
      }
      nudging = true;
      html.classList.add('ios-nudge');
      // Timers, not animation frames: those stop while the app is put away.
      setTimeout(() => {
        const y = window.scrollY;
        window.scrollTo(0, y + 1);
        setTimeout(() => {
          window.scrollTo(0, y);
          setTimeout(() => {
            html.classList.remove('ios-nudge');
            setTimeout(() => go(left - 1), 200);
          }, 120);
        }, 40);
      }, 30);
    };
    if (nudging) done(screenGap(full));
    else go(tries);
  });
}
if (iPhoneApp) {
  const soon = (ms) => setTimeout(() => nudgeScreen(), ms);
  window.addEventListener('load', () => soon(120));
  window.addEventListener('pageshow', () => soon(80));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) soon(80); });
  window.addEventListener('orientationchange', () => soon(300));
}

// Esc closes the top popup and nothing else (not the person beside Today).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !open.length) return;
  e.preventDefault();
  open[open.length - 1].close();
});

// A bottom sheet on phones, a centered panel on wide screens.
// Returns { el, body, close, setTitle }. `onClose` runs once, however it closes.
export function openSheet({ title, body = '', className = '', onClose } = {}) {
  const opener = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'sheet-overlay';
  overlay.style.zIndex = String(50 + open.length * 2);
  overlay.innerHTML = `
    <div class="sheet ${esc(className)}" role="dialog" aria-modal="true" aria-labelledby="sheetTitle${open.length}">
      <header class="sheet-header">
        <h2 id="sheetTitle${open.length}">${esc(title)}</h2>
        <button type="button" class="close-btn" data-close aria-label="Close">${X_ICON}</button>
      </header>
      <div class="sheet-body">${body}</div>
    </div>`;
  document.body.appendChild(overlay);
  document.body.classList.add('sheet-open');

  const el = overlay.querySelector('.sheet');
  const api = {
    el,
    overlay,
    body: el.querySelector('.sheet-body'),
    setTitle(t) {
      el.querySelector('.sheet-header h2').textContent = t;
    },
    close(result) {
      if (!overlay.isConnected) return;
      overlay.remove();
      open.splice(open.indexOf(api), 1);
      if (!open.length) document.body.classList.remove('sheet-open');
      if (opener && opener.isConnected && opener.focus) opener.focus({ preventScroll: true });
      if (onClose) onClose(result);
    },
  };
  open.push(api);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-close]')) api.close();
  });

  // Focus the sheet itself, not its first field: on phones a focused field
  // pops the keyboard over half the sheet before anyone asked to type.
  el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
  return api;
}

export function closeAllSheets() {
  while (open.length) open[open.length - 1].close();
}

// Resolves true when confirmed, false otherwise.
export function confirmSheet({ title, message = '', confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    const s = openSheet({
      title,
      className: 'sheet-small',
      body: `
        ${message ? `<p class="sheet-message">${message}</p>` : ''}
        <div class="sheet-actions">
          <button type="button" class="btn secondary" data-no>${esc(cancelLabel)}</button>
          <button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(confirmLabel)}</button>
        </div>`,
      onClose: () => resolve(answer),
    });
    s.body.querySelector('[data-no]').addEventListener('click', () => s.close());
    s.body.querySelector('[data-yes]').addEventListener('click', () => {
      answer = true;
      s.close();
    });
  });
}

// A list of choices; resolves with the chosen key, or null.
// options: [{ key, label, detail }]
// `extra` is HTML shown between the message and the choices; `onOpen` gets
// the sheet, to wire up anything in it.
export function choiceSheet({ title, message = '', extra = '', options, footer = '', onOpen }) {
  return new Promise((resolve) => {
    let answer = null;
    const s = openSheet({
      title,
      className: 'sheet-small',
      body: `
        ${message ? `<p class="sheet-message">${message}</p>` : ''}${extra}
        <div class="choice-list">
          ${options
            .map(
              (o) => `<button type="button" class="choice${o.current ? ' current' : ''}" data-key="${esc(o.key)}">
                ${o.icon || ''}<span class="choice-text"><span class="choice-label">${esc(o.label)}</span>
                ${o.detail ? `<span class="choice-detail">${esc(o.detail)}</span>` : ''}</span></button>`
            )
            .join('')}
        </div>${footer}`,
      onClose: () => resolve(answer),
    });
    s.body.querySelectorAll('.choice').forEach((b) =>
      b.addEventListener('click', () => {
        answer = b.dataset.key;
        s.close();
      })
    );
    if (onOpen) onOpen(s);
  });
}

let toastTimer;
export function toast(message, { action, ms = 3200 } = {}) {
  const el = document.getElementById('toast');
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button" class="toast-action">${esc(action.label)}</button>` : ''}`;
  el.hidden = false;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  if (action) {
    el.querySelector('.toast-action').addEventListener('click', () => {
      el.hidden = true;
      action.run();
    });
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, action ? ms + 2000 : ms);
}
