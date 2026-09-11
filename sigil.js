/* Procedural sigils — one unique mark per entry, derived from its seed.
   Deterministic: the same seed always yields the same glyph. */
(function () {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pt(cx, cy, r, a) {
    return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  }
  function f(n) {
    return Math.round(n * 100) / 100;
  }

  /* Returns SVG markup (viewBox 0 0 100 100) for a seed. */
  function sigil(seed) {
    var r = mulberry32((seed || 1) >>> 0);
    var cx = 50,
      cy = 50,
      R = 40;
    var n = 5 + Math.floor(r() * 5); // 5..9 vertices
    var phase = r() * Math.PI * 2;
    var parts = [];

    var v = [];
    for (var i = 0; i < n; i++) v.push(pt(cx, cy, R, phase + (i / n) * Math.PI * 2));

    /* 1. outer limb — full circle or a broken arc */
    if (r() < 0.55) {
      parts.push('<circle class="sigil-stroke" cx="50" cy="50" r="' + f(R + 6) + '"/>');
    } else {
      var a0 = r() * Math.PI * 2;
      var a1 = a0 + 1.2 + r() * 3.4;
      var p0 = pt(cx, cy, R + 6, a0);
      var p1 = pt(cx, cy, R + 6, a1);
      parts.push(
        '<path class="sigil-stroke" d="M' +
          f(p0[0]) +
          ' ' +
          f(p0[1]) +
          'A' +
          f(R + 6) +
          ' ' +
          f(R + 6) +
          ' 0 ' +
          (a1 - a0 > Math.PI ? 1 : 0) +
          ' 1 ' +
          f(p1[0]) +
          ' ' +
          f(p1[1]) +
          '"/>',
      );
    }

    /* 2. the star / chord figure */
    var step = 2 + Math.floor(r() * Math.max(1, Math.floor((n - 1) / 2)));
    if (step >= n) step = 2;
    var d = '',
      idx = 0,
      visited = {};
    for (var k = 0; k < n + 1; k++) {
      if (visited[idx]) break;
      visited[idx] = 1;
      d += (k === 0 ? 'M' : 'L') + f(v[idx][0]) + ' ' + f(v[idx][1]);
      idx = (idx + step) % n;
    }
    d += 'Z';
    parts.push('<path class="sigil-stroke" d="' + d + '"/>');

    /* 3. spokes from the centre to a subset of vertices */
    var spokes = '';
    for (var s = 0; s < n; s++) {
      if (r() < 0.45) spokes += 'M50 50L' + f(v[s][0]) + ' ' + f(v[s][1]);
    }
    if (!spokes) spokes = 'M50 50L' + f(v[0][0]) + ' ' + f(v[0][1]);
    parts.push('<path class="sigil-stroke" d="' + spokes + '"/>');

    /* 4. nodes on the figure */
    var dots = '';
    for (var q = 0; q < n; q++) {
      if (r() < 0.4)
        dots +=
          '<circle class="sigil-stroke" cx="' +
          f(v[q][0]) +
          '" cy="' +
          f(v[q][1]) +
          '" r="' +
          f(2.4 + r() * 2.2) +
          '"/>';
    }
    if (dots) parts.push(dots);

    /* 5. the core */
    var coreKind = Math.floor(r() * 3);
    if (coreKind === 0) {
      parts.push('<circle class="sigil-stroke" cx="50" cy="50" r="' + f(5 + r() * 5) + '"/>');
    } else if (coreKind === 1) {
      var t = 7 + r() * 4;
      parts.push(
        '<path class="sigil-stroke" d="M' +
          f(50 - t) +
          ' 50L50 ' +
          f(50 - t) +
          'L' +
          f(50 + t) +
          ' 50L50 ' +
          f(50 + t) +
          'Z"/>',
      );
    } else {
      var w = 6 + r() * 5;
      parts.push(
        '<path class="sigil-stroke" d="M' +
          f(50 - w) +
          ' ' +
          f(50 - w) +
          'h' +
          f(w * 2) +
          'v' +
          f(w * 2) +
          'h' +
          f(-w * 2) +
          'Z"/>',
      );
    }

    return parts.join('');
  }

  function sigilSVG(seed, cls) {
    return (
      '<svg viewBox="0 0 100 100" class="' +
      (cls || '') +
      '" aria-hidden="true" fill="none">' +
      sigil(seed) +
      '</svg>'
    );
  }

  window.Sigil = { markup: sigil, svg: sigilSVG, rng: mulberry32 };
})();
