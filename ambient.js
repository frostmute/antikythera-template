/* Ambient layer: drifting dust, cursor reticle, glyph transliteration,
   station clock, and the Umbra/Vellum mode switch. */
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* ---------- dust ---------- */
  var cv = document.getElementById('dust');
  var ctx = cv.getContext('2d');
  var dots = [];
  var W = 0,
    H = 0,
    dpr = Math.min(window.devicePixelRatio || 1, 2);
  var px = 0,
    py = 0,
    tx = 0,
    ty = 0;

  function rgb() {
    var v = getComputedStyle(document.documentElement)
      .getPropertyValue('--dust-rgb')
      .trim();
    return v || '228,223,207';
  }
  var colour = rgb();

  function seed() {
    W = cv.width = Math.floor(window.innerWidth * dpr);
    H = cv.height = Math.floor(window.innerHeight * dpr);
    cv.style.width = window.innerWidth + 'px';
    cv.style.height = window.innerHeight + 'px';
    var target = Math.min(
      190,
      Math.round((window.innerWidth * window.innerHeight) / 11000),
    );
    dots = [];
    for (var i = 0; i < target; i++) {
      var depth = Math.random();
      dots.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: (0.35 + depth * 1.25) * dpr,
        a: 0.06 + depth * 0.4,
        vx: (Math.random() - 0.5) * 0.055 * dpr,
        vy: (-0.02 - Math.random() * 0.075) * dpr,
        d: depth,
        tw: Math.random() * Math.PI * 2,
        tws: 0.006 + Math.random() * 0.016,
      });
    }
  }

  function paint(t) {
    ctx.clearRect(0, 0, W, H);
    px += (tx - px) * 0.045;
    py += (ty - py) * 0.045;
    for (var i = 0; i < dots.length; i++) {
      var p = dots[i];
      if (!reduced) {
        p.x += p.vx;
        p.y += p.vy;
        p.tw += p.tws;
        if (p.y < -8) {
          p.y = H + 8;
          p.x = Math.random() * W;
        }
        if (p.x < -8) p.x = W + 8;
        if (p.x > W + 8) p.x = -8;
      }
      var ox = px * p.d * 26 * dpr;
      var oy = py * p.d * 26 * dpr;
      var alpha = p.a * (reduced ? 1 : 0.62 + 0.38 * Math.sin(p.tw));
      ctx.beginPath();
      ctx.fillStyle = 'rgba(' + colour + ',' + alpha.toFixed(3) + ')';
      ctx.arc(p.x + ox, p.y + oy, p.r, 0, 6.2832);
      ctx.fill();
    }
    if (!reduced) raf = requestAnimationFrame(paint);
  }

  var raf = null;
  seed();
  paint();

  var rt;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () {
      seed();
      if (reduced) paint();
    }, 180);
  });

  /* ---------- reticle ---------- */
  var ret = document.getElementById('reticle');
  if (canHover && !reduced) {
    var rx = 0,
      ry = 0,
      cxp = 0,
      cyp = 0,
      moving = false;
    window.addEventListener(
      'pointermove',
      function (e) {
        if (e.pointerType && e.pointerType !== 'mouse') return;
        rx = e.clientX;
        ry = e.clientY;
        tx = (e.clientX / window.innerWidth - 0.5) * 2;
        ty = (e.clientY / window.innerHeight - 0.5) * 2;
        if (!moving) {
          moving = true;
          document.body.classList.add('has-reticle');
        }
      },
      { passive: true },
    );
    (function follow() {
      cxp += (rx - cxp) * 0.16;
      cyp += (ry - cyp) * 0.16;
      ret.style.transform = 'translate(' + cxp.toFixed(1) + 'px,' + cyp.toFixed(1) + 'px)';
      requestAnimationFrame(follow);
    })();
    document.addEventListener('pointerleave', function () {
      document.body.classList.remove('has-reticle');
    });
  }

  /* ---------- glyph transliteration ---------- */
  var GLYPHS = 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ0123456789';
  function scramble(el, text, ms) {
    if (!el) return;
    if (reduced) {
      el.textContent = text;
      return;
    }
    var frames = Math.max(8, Math.round((ms || 520) / 32));
    var chars = text.split('');
    var lock = chars.map(function () {
      return Math.floor(Math.random() * frames * 0.7);
    });
    var f = 0;
    if (el._scr) cancelAnimationFrame(el._scr);
    function tick() {
      var out = '';
      for (var i = 0; i < chars.length; i++) {
        if (chars[i] === ' ' || f > lock[i]) out += chars[i];
        else out += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      }
      el.textContent = out;
      f++;
      if (f <= frames) el._scr = requestAnimationFrame(tick);
      else el.textContent = text;
    }
    tick();
  }

  document.querySelectorAll('.nav-link span').forEach(function (s) {
    var label = s.textContent;
    s.parentElement.addEventListener('pointerenter', function () {
      scramble(s, label, 380);
    });
  });

  /* ---------- station clock ---------- */
  var clock = document.getElementById('foot-clock');
  function tickClock() {
    var d = new Date();
    var p = function (n) {
      return String(n).padStart(2, '0');
    };
    clock.textContent =
      p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + ' CT';
  }
  tickClock();
  setInterval(tickClock, 1000);

  /* ---------- mode switch ---------- */
  var SUN =
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="12" cy="12" r="4.6"/><path d="M12 1.5v3M12 19.5v3M2.6 12h3M18.4 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/></svg>';
  var MOON =
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

  var root = document.documentElement;
  var btn = document.getElementById('theme-toggle');
  var mode = 'umbra'; /* the instrument is read in the dark by default */

  function apply() {
    root.setAttribute('data-theme', mode);
    btn.innerHTML =
      (mode === 'umbra' ? MOON : SUN) +
      '<span class="theme-name">' +
      (mode === 'umbra' ? 'UMBRA' : 'VELLUM') +
      '</span>';
    btn.setAttribute(
      'aria-label',
      'Switch to ' + (mode === 'umbra' ? 'Vellum (light)' : 'Umbra (dark)') + ' mode',
    );
    colour = rgb();
  }
  apply();
  btn.addEventListener('click', function () {
    mode = mode === 'umbra' ? 'vellum' : 'umbra';
    apply();
    var n = btn.querySelector('.theme-name');
    if (n) scramble(n, mode === 'umbra' ? 'UMBRA' : 'VELLUM', 420);
  });

  window.Ambient = { scramble: scramble, reduced: reduced };
})();
