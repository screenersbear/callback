// A phone keeps Callback upright (11-11). The installed app asks for
// portrait (manifest.json), which Android keeps to, and the screen lock is
// asked for here too. An iPhone turns web apps anyway, so when a phone is
// held sideways the page is turned back a quarter turn (html.is-turned,
// with .turn-left or .turn-right) at its upright size: on the phone it looks
// as if nothing turned, with no note about it.
//
// While it's turned, the page scrolls inside #app, and the rest of the app
// is handed upright numbers, so none of it has to know: the window's size,
// finger and mouse positions, element boxes, the page's scroll, and the
// width rules in the style sheet and in matchMedia (a sideways phone is as
// wide as a small laptop). Safe edges come from the upright phone too.
//
// Only touch phones get any of this: not the Mac app, desktops or iPads.
// For tests, ?turn=left or ?turn=right turns any window, and
// __turnTest(90, -90 or 0) turns it again.
(function () {
  var root = document.documentElement;
  var test = /[?&]turn=(left|right|up)\b/.exec(location.search);
  var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)');
  var phone = !!test || (Math.min(screen.width, screen.height) < 500 && !!(coarse && coarse.matches));
  if (!phone) return;
  try {
    if (screen.orientation && screen.orientation.lock) screen.orientation.lock('portrait').catch(function () {});
  } catch (e) {}

  var forced = test ? { left: 90, right: -90, up: 0 }[test[1]] : null;
  var turned = 0; // 90: the phone's top is to the left, -90: to the right
  var vw = 0; // the upright page's width and height
  var vh = 0;

  function desc(obj, name) {
    for (var o = obj; o; o = Object.getPrototypeOf(o)) {
      var d = Object.getOwnPropertyDescriptor(o, name);
      if (d) return { on: o, d: d };
    }
    return null;
  }
  var iw = desc(window, 'innerWidth');
  var ih = desc(window, 'innerHeight');
  var realW = function () { return iw.d.get.call(window); };
  var realH = function () { return ih.d.get.call(window); };

  // Which way the phone is held, from the phone's own turn, never the
  // window's shape (an open keyboard squashes that).
  function angle() {
    if (forced !== null) return forced;
    var so = screen.orientation;
    if (so && so.type && so.type.indexOf('landscape') === 0) return so.angle === 270 ? -90 : 90;
    var o = window.orientation;
    return o === 90 || o === -90 ? o : 0;
  }

  // A point on the screen, as it is on the upright page.
  function upright(x, y) {
    return turned === 90 ? [vw - y, x] : [y, vh - x];
  }
  function uprightRect(r) {
    if (turned === 90) return new DOMRect(vw - r.bottom, r.left, r.bottom - r.top, r.right - r.left);
    return new DOMRect(r.top, vh - r.right, r.bottom - r.top, r.right - r.left);
  }

  // The window's size.
  function swapGetter(found, name, fn) {
    if (!found || !found.d.get) return;
    var d = found.d;
    Object.defineProperty(found.on, name, {
      configurable: true,
      enumerable: d.enumerable,
      get: function () { return turned ? fn.call(this, d.get) : d.get.call(this); },
      set: d.set,
    });
  }
  swapGetter(iw, 'innerWidth', function () { return vw; });
  swapGetter(ih, 'innerHeight', function () { return vh; });

  // Finger and mouse positions (pointer and touch events too).
  [window.MouseEvent && MouseEvent.prototype, window.Touch && Touch.prototype].forEach(function (p) {
    if (!p) return;
    var cx = desc(p, 'clientX');
    var cy = desc(p, 'clientY');
    if (!cx || !cy || !cx.d.get || !cy.d.get) return;
    var gx = cx.d.get;
    var gy = cy.d.get;
    swapGetter(cx, 'clientX', function () { return upright(gx.call(this), gy.call(this))[0]; });
    swapGetter(cy, 'clientY', function () { return upright(gx.call(this), gy.call(this))[1]; });
  });

  // Element boxes.
  var box = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    var r = box.call(this);
    if (!turned) return r;
    if (this === root) return new DOMRect(0, 0, vw, vh);
    return uprightRect(r);
  };

  // The page's scroll, which is #app's while turned.
  var page = function () { return document.getElementById('app'); };
  var sy = desc(window, 'scrollY');
  var realY = function () { return sy && sy.d.get ? sy.d.get.call(window) : 0; };
  swapGetter(sy, 'scrollY', function () { var a = page(); return a ? a.scrollTop : 0; });
  swapGetter(desc(window, 'pageYOffset'), 'pageYOffset', function () { var a = page(); return a ? a.scrollTop : 0; });
  swapGetter(desc(window, 'scrollX'), 'scrollX', function () { return 0; });
  swapGetter(desc(window, 'pageXOffset'), 'pageXOffset', function () { return 0; });
  var scrollTo = window.scrollTo;
  var scrollBy = window.scrollBy;
  function pageTo(x, y) {
    if (!turned) return scrollTo.apply(window, arguments);
    var a = page();
    if (!a) return;
    if (x && typeof x === 'object') a.scrollTo({ top: x.top || 0, behavior: x.behavior });
    else a.scrollTop = y || 0;
  }
  window.scrollTo = pageTo;
  window.scroll = pageTo;
  window.scrollBy = function (x, y) {
    if (!turned) return scrollBy.apply(window, arguments);
    var a = page();
    if (!a) return;
    if (x && typeof x === 'object') a.scrollBy({ top: x.top || 0, behavior: x.behavior });
    else a.scrollTop += y || 0;
  };
  // #app's scroll tells the window, as the page's own scroll does.
  document.addEventListener('scroll', function (e) {
    if (turned && e.target && e.target.id === 'app') window.dispatchEvent(new Event('scroll'));
  }, true);

  // Width rules: each (min-width: …) or (max-width: …) is swapped for one
  // that's always or never true, measured against the upright width.
  var WIDTH = /\((min|max)-width:\s*([\d.]+)px\)/g;
  function forWidth(text) {
    return text.replace(WIDTH, function (all, kind, n) {
      var ok = kind === 'min' ? vw >= +n : vw <= +n;
      return ok ? '(min-width: 0px)' : '(min-width: 99999px)';
    });
  }
  var matches = window.MediaQueryList && desc(MediaQueryList.prototype, 'matches');
  var matchMedia = window.matchMedia;
  if (matches && matches.d.get) {
    swapGetter(matches, 'matches', function (get) {
      var m = this.media || '';
      WIDTH.lastIndex = 0;
      if (!WIDTH.test(m)) return get.call(this);
      return get.call(matchMedia.call(window, forWidth(m)));
    });
  }
  var rules = []; // [rule, its own text]
  function collect(list) {
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (r.media && r.cssRules && /(min|max)-width/.test(r.media.mediaText)) rules.push([r, r.media.mediaText]);
      if (r.cssRules) collect(r.cssRules);
    }
  }
  function sheetRules() {
    if (rules.length) return;
    for (var i = 0; i < document.styleSheets.length; i++) {
      try { collect(document.styleSheets[i].cssRules); } catch (e) {}
    }
  }
  function widthRules() {
    sheetRules();
    rules.forEach(function (x) {
      var want = turned ? forWidth(x[1]) : x[1];
      if (x[0].media.mediaText !== want) x[0].media.mediaText = want;
    });
  }

  // The safe edges of the upright phone (the notch at the top, the home bar
  // at the bottom), noted while it's upright; until then, the sides'.
  var probe = null;
  function safeUpright() {
    if (turned || !document.body) return;
    if (!probe) {
      probe = document.createElement('div');
      probe.setAttribute('aria-hidden', 'true');
      probe.style.cssText = 'position: fixed; left: 0; top: 0; width: 1px; height: 0; visibility: hidden; pointer-events: none; padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom);';
      document.body.appendChild(probe);
    }
    var cs = getComputedStyle(probe);
    var top = Math.round(parseFloat(cs.paddingTop) || 0);
    var bottom = Math.round(parseFloat(cs.paddingBottom) || 0);
    if (top || bottom) {
      try { localStorage.setItem('callback-safe', top + ',' + bottom); } catch (e) {}
    }
  }
  function safeTurned() {
    var kept = null;
    try { kept = (localStorage.getItem('callback-safe') || '').split(',').map(Number); } catch (e) {}
    if (kept && kept.length === 2 && !isNaN(kept[0]) && !isNaN(kept[1])) return [kept[0] + 'px', kept[1] + 'px'];
    var l = 'env(safe-area-inset-left)';
    var r = 'env(safe-area-inset-right)';
    return turned === 90 ? [l, r] : [r, l];
  }

  function apply() {
    var a = angle();
    var w = realW();
    var h = realH();
    var was = turned;
    var y = 0;
    if (a !== was) {
      if (was) { var p = page(); y = p ? p.scrollTop : 0; } else y = realY();
    }
    if (!was) safeUpright();
    if (a && w < h) { var t = w; w = h; h = t; } // mid-turn: the window hasn't caught up yet
    turned = a;
    vw = a ? h : w;
    vh = a ? w : h;
    root.classList.toggle('is-turned', !!a);
    root.classList.toggle('turn-left', a === 90);
    root.classList.toggle('turn-right', a === -90);
    if (a) {
      var safe = safeTurned();
      root.style.setProperty('--turn-w', vw + 'px');
      root.style.setProperty('--turn-h', vh + 'px');
      root.style.setProperty('--safe-top', safe[0]);
      root.style.setProperty('--safe-bottom', safe[1]);
    } else {
      ['--turn-w', '--turn-h', '--safe-top', '--safe-bottom'].forEach(function (k) { root.style.removeProperty(k); });
    }
    widthRules();
    if (a !== was) {
      if (a) { var app = page(); if (app) app.scrollTop = y; } else scrollTo.call(window, 0, y);
    }
  }

  apply();
  if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', apply);
  window.addEventListener('orientationchange', apply);
  window.addEventListener('resize', apply);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', apply);
  document.addEventListener('DOMContentLoaded', apply);
  window.__turnTest = function (a) { forced = a; apply(); return { turned: turned, w: vw, h: vh }; };
})();
