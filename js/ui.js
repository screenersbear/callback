// Interface pieces shared by every screen: bottom sheets, confirmations,
// choices and the toast.
import { esc } from './util.js';

export const X_ICON =
  '<svg class="x-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

const open = [];

// On an iPhone the keyboard covers the bottom of the screen without
// shrinking the page, so a bottom sheet would slide under it. The visible
// height is tracked here (as --vv-height) and sheets keep inside it. While
// the keyboard is up, html gets .kb-up and --kb (the keyboard's height),
// which gives the page room at the bottom and tucks the tab bar away, and
// whatever is being typed in is moved to sit just above the keyboard.
// Android resizes the page itself, so --kb stays near 0 there.
//
// Typing in a sheet on a phone also gives html .sheet-typing: the sheet
// moves to the top of the screen and shrinks to the room the keyboard will
// leave, before the keyboard is even up, so the field is never where the
// keyboard lands. Sheets used to sit at the bottom and follow the keyboard
// with visualViewport.offsetTop, but iOS 26 and 27 often report that wrong
// (it stays put after the keyboard goes), which pushed the sheet's bottom,
// and the New circle box with it, under the keyboard.
const vv = window.visualViewport;
const html = document.documentElement;
const TYPING = 'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="hidden"]), textarea, select, [contenteditable="true"]';
const typingIn = (el) => !!(el && el.matches && el.matches(TYPING));
const inSheet = (el) => !!(el && el.closest && el.closest('.sheet-overlay'));
const phone = () => matchMedia('(pointer: coarse)').matches;
// The keyboard's height the last time it was up (a guess until then).
let kbSeen = 0;
try { kbSeen = Number(localStorage.getItem('callback-kb')) || 0; } catch {}
let kbExpectedUntil = 0;
let visibleHeight = html.clientHeight;
function fitViewport() {
  if (!vv) return;
  const full = html.clientHeight;
  const kb = Math.max(0, Math.round(full - vv.height));
  const typing = typingIn(document.activeElement);
  let h = vv.height;
  if (kb > 120 && typing && Math.abs(kb - kbSeen) > 4) {
    kbSeen = kb;
    try { localStorage.setItem('callback-kb', String(kb)); } catch {}
  } else if (kb <= 120 && html.classList.contains('sheet-typing') && Date.now() < kbExpectedUntil) {
    // The keyboard is on its way: make room for it now.
    h = Math.min(h, full - (kbSeen || Math.round(full * 0.46)));
  }
  visibleHeight = h;
  html.style.setProperty('--vv-height', `${h}px`);
  html.style.setProperty('--kb', `${kb}px`);
  html.classList.toggle('kb-up', kb > 120 && typing);
}
// Leaving a sheet's fields (or closing the sheet) puts it back at the bottom.
function endSheetTyping() {
  const el = document.activeElement;
  if (typingIn(el) && inSheet(el)) return;
  html.classList.remove('sheet-typing');
  fitViewport();
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
  // Sheets sit from the top of the screen (see fitViewport), so their
  // fields are measured from there, not from iOS's offsetTop.
  const sheetField = inSheet(el);
  let top = (vv && !sheetField ? vv.offsetTop : 0) + GAP;
  let bottom = (sheetField ? visibleHeight : vv ? vv.offsetTop + vv.height : html.clientHeight) - GAP;
  const box = scrollerOf(el);
  if (box) {
    const b = box.getBoundingClientRect();
    top = Math.max(top, b.top + GAP / 2);
    bottom = Math.min(bottom, b.bottom - GAP / 2);
  }
  // A sheet's sticky footer (its Save or Done button) covers fields too.
  const footer = el.closest('.sheet') && el.closest('.sheet').querySelector('.sheet-footer');
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
  if (!typingIn(e.target)) return;
  if (inSheet(e.target) && phone()) {
    // Right away, before iOS decides where to scroll for the keyboard.
    html.classList.add('sheet-typing');
    kbExpectedUntil = Date.now() + 2000;
    fitViewport();
    keepInView(e.target);
  }
  settle(e.target);
});
// Leaving a field for the next one keeps the keyboard up, so wait a moment
// before deciding it's gone (taking the room away would jump the page).
document.addEventListener('focusout', () => setTimeout(endSheetTyping, 150));
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

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && open.length) open[open.length - 1].close();
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
      endSheetTyping();
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
export function choiceSheet({ title, message = '', options, footer = '' }) {
  return new Promise((resolve) => {
    let answer = null;
    const s = openSheet({
      title,
      className: 'sheet-small',
      body: `
        ${message ? `<p class="sheet-message">${message}</p>` : ''}
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
