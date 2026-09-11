/* ============================================================
   ANTIKYTHERA — loader, dial, router
   ============================================================ */
(function () {
  'use strict';

  var view = document.getElementById('view');
  var TAU = Math.PI * 2;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var INTRO_SEEN_KEY = 'antikythera:intro:v1';

  var state = {
    manifest: null,
    entries: [],
    bySlug: {},
    spheres: {},
    rot: 0,
    rotTarget: 0,
    sel: 0,
    raf: null,
    route: null,
    introSeen: false,
  };

  function hasSeenIntro() {
    if (state.introSeen) return true;
    try {
      return localStorage.getItem(INTRO_SEEN_KEY) === '1';
    } catch (err) {
      return false;
    }
  }

  function rememberIntro() {
    state.introSeen = true;
    try {
      localStorage.setItem(INTRO_SEEN_KEY, '1');
    } catch (err) {
      /* Persistence is optional; in-memory state still prevents repeats. */
    }
  }

  /* ---------------------------------------------------------
     frontmatter
     --------------------------------------------------------- */
  function unquote(s) {
    s = s.trim();
    if (
      (s[0] === '"' && s[s.length - 1] === '"') ||
      (s[0] === "'" && s[s.length - 1] === "'")
    )
      return s.slice(1, -1);
    return s;
  }

  function parseFrontmatter(raw) {
    var text = raw.replace(/^\uFEFF/, '');
    var m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
    if (!m) return { data: {}, body: text };
    var data = {};
    m[1].split(/\r?\n/).forEach(function (line) {
      if (!line.trim() || /^\s*#/.test(line)) return;
      var kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
      if (!kv) return;
      var key = kv[1];
      var val = kv[2].trim();
      if (val === '') {
        data[key] = '';
      } else if (val[0] === '[' && val[val.length - 1] === ']') {
        var inner = val.slice(1, -1).trim();
        data[key] = inner
          ? inner.split(',').map(function (x) {
              return unquote(x);
            })
          : [];
      } else if (/^-?\d+$/.test(val)) {
        data[key] = parseInt(val, 10);
      } else {
        data[key] = unquote(val);
      }
    });
    return { data: data, body: m[2] };
  }

  /* ---------------------------------------------------------
     formatting helpers
     --------------------------------------------------------- */
  var MON = [
    'JAN',
    'FEB',
    'MAR',
    'APR',
    'MAY',
    'JUN',
    'JUL',
    'AUG',
    'SEP',
    'OCT',
    'NOV',
    'DEC',
  ];
  var ROMAN = [
    'I',
    'II',
    'III',
    'IV',
    'V',
    'VI',
    'VII',
    'VIII',
    'IX',
    'X',
    'XI',
    'XII',
  ];

  function toDate(s) {
    var p = String(s).split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function fmtDate(s) {
    if (!s) return '—';
    var d = toDate(s);
    return String(d.getDate()).padStart(2, '0') + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear();
  }
  function dayFraction(s) {
    var d = toDate(s);
    var start = new Date(d.getFullYear(), 0, 0);
    var days = (d - start) / 86400000;
    return days / 365.25;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function list(v) {
    return Array.isArray(v) ? v : v ? [v] : [];
  }

  /* ---------------------------------------------------------
     load
     --------------------------------------------------------- */
  function loadAll() {
    return fetch('./content/manifest.json')
      .then(function (r) {
        if (!r.ok) throw new Error('manifest ' + r.status);
        return r.json();
      })
      .then(function (mf) {
        state.manifest = mf;
        mf.spheres.forEach(function (s) {
          state.spheres[s.id] = s;
        });
        return Promise.all(
          mf.entries.map(function (f) {
            return fetch('./content/' + f)
              .then(function (r) {
                if (!r.ok) throw new Error(f + ' ' + r.status);
                return r.text();
              })
              .then(function (t) {
                var p = parseFrontmatter(t);
                p.data.body = p.body;
                p.data.file = f;
                return p.data;
              });
          }),
        );
      })
      .then(function (entries) {
        entries.sort(function (a, b) {
          return toDate(b.date) - toDate(a.date);
        });
        var years = {};
        entries.forEach(function (e) {
          years[toDate(e.date).getFullYear()] = 1;
        });
        var yl = Object.keys(years)
          .map(Number)
          .sort(function (a, b) {
            return a - b;
          });

        entries.forEach(function (e) {
          var sp = state.spheres[e.sphere] || { radius: 260, label: '—' };
          var yi = yl.indexOf(toDate(e.date).getFullYear());
          e.theta = dayFraction(e.date) * TAU;
          e.radius = sp.radius + (yi - (yl.length - 1) / 2) * 30;
          e.sphereLabel = sp.label;
          state.bySlug[e.slug] = e;
        });
        
        var order = entries.slice().sort(function(a, b) { return a.theta - b.theta; });
        for (var i = 1; i < order.length; i++) {
          if (order[i].theta - order[i - 1].theta < 0.005) {
            order[i].theta = order[i - 1].theta + 0.005;
          }
        }

        state.entries = entries;
        state.years = yl;
        document.getElementById('foot-count').textContent =
          entries.length + ' entries bound';
        return entries;
      });
  }

  /* ---------------------------------------------------------
     boot sequence
     --------------------------------------------------------- */
  function boot() {
    var el = document.getElementById('boot');
    var log = document.getElementById('boot-log');
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      el.classList.add('done');
      setTimeout(function () {
        el.classList.add('gone');
      }, 750);
    }
    if (reduced) {
      finish();
      return Promise.resolve();
    }
    var lines = [
      'ANTIKYTHERA  ·  MECHANISM ATTENDING',
      'CALIBRATING LIMB ················· <b>OK</b>',
      'INDEXING SPHERES ················· <b>3</b>',
      'BINDING ENTRIES ·················· <b>' + state.manifest.entries.length + '</b>',
      'MERIDIAN ZEROED AT <b>29.4241° N</b>',
      '',
      'TURN THE DIAL.',
    ];
    var i = 0;
    el.addEventListener('click', finish);
    window.addEventListener('keydown', finish, { once: true });
    return new Promise(function (res) {
      (function step() {
        if (done || i >= lines.length) {
          setTimeout(function () {
            finish();
            res();
          }, 320);
          return;
        }
        log.innerHTML += lines[i] + '\n';
        i++;
        setTimeout(step, 190);
      })();
    });
  }

  /* ---------------------------------------------------------
     DIAL
     --------------------------------------------------------- */
  function buildDial() {
    var p = [];
    p.push(
      '<svg id="dial" viewBox="-500 -500 1000 1000" role="application" ' +
        'aria-label="Entry dial. Use the left and right arrow keys to step between entries, Enter to open." tabindex="0">',
    );

    /* outer graduated limb */
    var limb = ['<g class="spin-slow">'];
    limb.push('<circle class="d-hair-2" r="470"/><circle class="d-hair" r="452"/>');
    for (var t = 0; t < 120; t++) {
      var a = (t / 120) * TAU;
      var long = t % 10 === 0;
      var r0 = long ? 452 : 461;
      limb.push(
        '<line class="' +
          (long ? 'd-hair-2' : 'd-hair') +
          '" x1="' +
          (r0 * Math.sin(a)).toFixed(1) +
          '" y1="' +
          (-r0 * Math.cos(a)).toFixed(1) +
          '" x2="' +
          (470 * Math.sin(a)).toFixed(1) +
          '" y2="' +
          (-470 * Math.cos(a)).toFixed(1) +
          '"/>',
      );
    }
    for (var mi = 0; mi < 12; mi++) {
      var ma = (mi / 12) * TAU;
      limb.push(
        '<text class="d-num" transform="translate(' +
          (430 * Math.sin(ma)).toFixed(1) +
          ',' +
          (-430 * Math.cos(ma)).toFixed(1) +
          ') rotate(' + (mi * 30) + ')">' +
          ROMAN[mi] +
          '</text>',
      );
    }
    limb.push('</g>');
    p.push(limb.join(''));

    /* inner graduated ring */
    p.push(
      '<g class="spin-rev"><circle class="d-hair" r="404"/>' +
        (function () {
          var s = '';
          for (var i = 0; i < 60; i++) {
            var a = (i / 60) * TAU;
            s +=
              '<line class="d-hair" x1="' +
              (398 * Math.sin(a)).toFixed(1) +
              '" y1="' +
              (-398 * Math.cos(a)).toFixed(1) +
              '" x2="' +
              (404 * Math.sin(a)).toFixed(1) +
              '" y2="' +
              (-404 * Math.cos(a)).toFixed(1) +
              '"/>';
          }
          return s;
        })() +
        '</g>',
    );


    /* sphere tracks */
    var tracks = ['<g>'];
    state.manifest.spheres.forEach(function (s) {
      tracks.push('<circle class="d-hair" r="' + s.radius + '" opacity="0.5"/>');
      state.years.forEach(function (y, yi) {
        var r = s.radius + (yi - (state.years.length - 1) / 2) * 30;
        tracks.push('<circle class="d-track" data-sphere="' + s.id + '" data-r="' + r + '" r="' + r + '"/>');
      });
    });
    tracks.push('</g>');
    p.push(tracks.join(''));

    /* core */
    p.push(
      '<g class="spin-core"><g id="d-core" transform="translate(-72,-72) scale(1.44)" opacity="0.42"></g></g>',
    );
    p.push('<circle class="d-hair-2" r="112"/><circle class="d-hair" r="104"/>');

    /* resonance + nodes */
    p.push('<g id="d-res"></g><g id="d-nodes"></g>');

    /* meridian + index mark */
    p.push(
      '<line class="d-meridian" x1="0" y1="-124" x2="0" y2="-486"/>' +
        '<path class="d-index" d="M0 -434l11 -19h-22z"/>' +
        '<circle class="d-index" cy="-492" r="4"/>',
    );

    p.push('</svg>');
    return p.join('');
  }

  function nodesMarkup() {
    return state.entries
      .map(function (e, i) {
        return (
          '<g class="d-node" data-sphere="' + e.sphere + '" data-i="' +
          i +
          '" tabindex="0" role="button" aria-label="' +
          esc(e.designation + ': ' + e.title) +
          '">' +
          '<circle class="halo" r="19"/>' +
          '<circle class="ring" r="9.5"/>' +
          '<circle class="pip" r="3.2"/>' +
          '<text class="tag" y="6">' +
          esc(e.designation) +
          '</text>' +
          '</g>'
        );
      })
      .join('');
  }

  function wrapPi(a) {
    a = a % TAU;
    if (a > Math.PI) a -= TAU;
    if (a < -Math.PI) a += TAU;
    return a;
  }

  function nodePos(e) {
    var a = e.theta + state.rot;
    return [e.radius * Math.sin(a), -e.radius * Math.cos(a)];
  }

  function renderDialFrame() {
    var nodes = view.querySelectorAll('.d-node');
    var best = 0,
      bestD = Infinity;
    for (var i = 0; i < state.entries.length; i++) {
      var e = state.entries[i];
      var d = Math.abs(wrapPi(e.theta + state.rot));
      if (d < bestD) {
        bestD = d;
        best = i;
      }
      var pos = nodePos(e);
      var g = nodes[i];
      if (!g) continue;
      g.setAttribute('transform', 'translate(' + pos[0].toFixed(1) + ',' + pos[1].toFixed(1) + ')');
      var tag = g.querySelector('.tag');
      if (pos[0] < 0) {
        tag.setAttribute('x', '-17');
        tag.setAttribute('text-anchor', 'end');
      } else {
        tag.setAttribute('x', '17');
        tag.setAttribute('text-anchor', 'start');
      }
    }
    if (best !== state.sel) {
      state.sel = best;
      onSelect();
    }
    drawResonance();
  }

  function drawResonance() {
    var g = view.querySelector('#d-res');
    if (!g) return;
    var e = state.entries[state.sel];
    if (!e) return;
    var from = nodePos(e);
    var rel = list(e.resonance)
      .map(function (s) {
        return state.bySlug[s];
      })
      .filter(Boolean);
    var want = rel.length;
    while (g.children.length < want) {
      var l = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      l.setAttribute('class', 'd-res');
      g.appendChild(l);
    }
    for (var i = 0; i < g.children.length; i++) {
      var el = g.children[i];
      if (i < want) {
        var to = nodePos(rel[i]);
        el.setAttribute(
          'd',
          'M' + from[0].toFixed(1) + ' ' + from[1].toFixed(1) + 'L' + to[0].toFixed(1) + ' ' + to[1].toFixed(1),
        );
        el.classList.add('on');
        el.setAttribute('data-sphere', e.sphere);
      } else {
        el.classList.remove('on');
      }
    }
  }

  function onSelect() {
    var nodes = view.querySelectorAll('.d-node');
    for (var i = 0; i < nodes.length; i++) nodes[i].classList.toggle('sel', i === state.sel);
    
    var e = state.entries[state.sel];
    var tracks = view.querySelectorAll('.d-track');
    for (var i = 0; i < tracks.length; i++) {
      tracks[i].classList.toggle('sel', e && tracks[i].getAttribute('data-r') == e.radius && tracks[i].getAttribute('data-sphere') === e.sphere);
    }
    
    paintReadout();
    var core = view.querySelector('#d-core');
    var e = state.entries[state.sel];
    if (core && e) {
      core.innerHTML = window.Sigil.markup(e.sigil);
      core.classList.remove('sigil-anim');
      void core.getBoundingClientRect();
      core.classList.add('sigil-anim');
    }
  }

  function paintReadout() {
    var box = view.querySelector('#readout');
    var e = state.entries[state.sel];
    if (!box || !e) return;
    var tags = list(e.tags).slice(0, 5).join('  ·  ');
    box.innerHTML =
      '<div class="ro-top">' +
      '<div><div class="ro-desig" data-scr>' +
      esc(e.designation) +
      '</div><div class="ro-sphere">' +
      esc(e.sphereLabel) +
      ' · ' +
      esc(String(e.kind).toUpperCase()) +
      '</div></div>' +
      '<div class="ro-sigil sigil-anim">' +
      window.Sigil.svg(e.sigil) +
      '</div>' +
      '</div>' +
      '<h1 class="ro-title">' +
      esc(e.title) +
      '</h1>' +
      '<p class="ro-epi">' +
      esc(e.epigraph) +
      '</p>' +
      '<dl class="ro-meta">' +
      row('Recorded', fmtDate(e.date)) +
      row('Revised', fmtDate(e.revised)) +
      row(
        'Status',
        '<span class="st" data-st="' + esc(e.status) + '">' + esc(String(e.status).toUpperCase()) + '</span>',
      ) +
      row('Reading', e.reading + ' min') +
      row('Tags', esc(tags)) +
      '</dl>' +
      '<div class="ro-actions">' +
      '<a class="btn" href="#/e/' +
      esc(e.slug) +
      '">Open entry</a>' +
      (e.external
        ? '<a class="btn btn-ghost" href="' +
          esc(e.external) +
          '" target="_blank" rel="noopener noreferrer">' +
          esc(e.external_label || 'Source') +
          ' &#8599;</a>'
        : '') +
      '</div>';
    var scr = box.querySelector('[data-scr]');
    if (window.Ambient) window.Ambient.scramble(scr, e.designation, 420);
  }

  function row(k, v) {
    return (
      '<div class="ro-row"><dt>' +
      k +
      '</dt><span class="leader"></span><dd>' +
      v +
      '</dd></div>'
    );
  }

  function tick() {
    var diff = state.rotTarget - state.rot;
    if (Math.abs(diff) < 0.0002) {
      state.rot = state.rotTarget;
      renderDialFrame();
      state.raf = null;
      return;
    }
    state.rot += diff * 0.14;
    renderDialFrame();
    state.raf = requestAnimationFrame(tick);
  }
  function kick() {
    if (!state.raf) state.raf = requestAnimationFrame(tick);
  }

  function snap(from) {
    var base = from == null ? state.rotTarget : from;
    var best = null,
      bestD = Infinity;
    state.entries.forEach(function (e) {
      var target = -e.theta;
      var k = Math.round((base - target) / TAU);
      var cand = target + k * TAU;
      var d = Math.abs(cand - base);
      if (d < bestD) {
        bestD = d;
        best = cand;
      }
    });
    if (best != null) state.rotTarget = best;
    kick();
  }

  function step(dir) {
    var order = state.entries
      .map(function (e, i) {
        return { i: i, theta: e.theta };
      })
      .sort(function (a, b) {
        return a.theta - b.theta;
      });
    var at = order.findIndex(function (o) {
      return o.i === state.sel;
    });
    var next = order[(at + dir + order.length) % order.length];
    var target = -next.theta;
    var k = Math.round((state.rotTarget - target) / TAU);
    var cand = target + k * TAU;
    if (dir > 0 && cand >= state.rotTarget) cand -= TAU;
    if (dir < 0 && cand <= state.rotTarget) cand += TAU;
    state.rotTarget = cand;
    kick();
  }

  function wireDial() {
    var svg = view.querySelector('#dial');
    if (!svg) return;
    var dragging = false,
      lastA = 0,
      vel = 0,
      moved = 0,
      pid = null;

    function angleAt(ev) {
      var r = svg.getBoundingClientRect();
      return Math.atan2(ev.clientX - (r.left + r.width / 2), -(ev.clientY - (r.top + r.height / 2)));
    }

    svg.addEventListener('pointerdown', function (ev) {
      dragging = true;
      moved = 0;
      vel = 0;
      pid = ev.pointerId;
      lastA = angleAt(ev);
      svg.classList.add('dragging');
      svg.setPointerCapture(pid);
    });
    svg.addEventListener('pointermove', function (ev) {
      if (!dragging || ev.pointerId !== pid) return;
      var a = angleAt(ev);
      var d = wrapPi(a - lastA);
      lastA = a;
      moved += Math.abs(d);
      vel = vel * 0.6 + d * 0.4;
      state.rot += d;
      state.rotTarget = state.rot;
      renderDialFrame();
    });
    function release(ev) {
      if (!dragging) return;
      dragging = false;
      svg.classList.remove('dragging');
      try {
        svg.releasePointerCapture(pid);
      } catch (e) {}
      snap(state.rot + vel * 7);
    }
    svg.addEventListener('pointerup', release);
    svg.addEventListener('pointercancel', release);

    var wt;
    svg.addEventListener(
      'wheel',
      function (ev) {
        ev.preventDefault();
        state.rot += (ev.deltaY + ev.deltaX) * 0.0024;
        state.rotTarget = state.rot;
        renderDialFrame();
        clearTimeout(wt);
        wt = setTimeout(function () {
          snap(state.rot);
        }, 130);
      },
      { passive: false },
    );

    svg.addEventListener('click', function (ev) {
      var g = ev.target.closest('.d-node');
      if (!g) return;
      if (moved > 0.06) return;
      var i = +g.getAttribute('data-i');
      if (i === state.sel) {
        location.hash = '#/e/' + state.entries[i].slug;
      } else {
        var target = -state.entries[i].theta;
        var k = Math.round((state.rotTarget - target) / TAU);
        state.rotTarget = target + k * TAU;
        kick();
      }
    });

    view.querySelectorAll('.d-node').forEach(function (g) {
      g.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          location.hash = '#/e/' + state.entries[+g.getAttribute('data-i')].slug;
        }
      });
    });
  }

  function dialKeys(ev) {
    if (state.route !== 'dial') return;
    if (view.querySelector('#site-intro[open]')) return;
    var t = ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (ev.key === 'ArrowRight' || ev.key === ']') {
      ev.preventDefault();
      step(1);
    } else if (ev.key === 'ArrowLeft' || ev.key === '[') {
      ev.preventDefault();
      step(-1);
    } else if (ev.key === 'Enter' && !t.closest('a,button,.d-node')) {
      location.hash = '#/e/' + state.entries[state.sel].slug;
    }
  }
  window.addEventListener('keydown', dialKeys);

  /* ---------------------------------------------------------
     VIEWS
     --------------------------------------------------------- */
  function introMarkup() {
    return (
      '<dialog id="site-intro" class="intro-dialog" aria-labelledby="site-intro-title" aria-describedby="site-intro-copy">' +
      '<p class="intro-kicker">YOUR NAME &middot; PORTFOLIO / BLOG</p>' +
      '<h2 class="intro-title" id="site-intro-title">Welcome to Your Archive.</h2>' +
      '<div class="intro-copy" id="site-intro-copy">' +
      '<p>An experimental, math-driven portfolio and blog. Replace this text in app.js.</p>' +
      '<p>The interface is an instrument rather than a feed: each mark is a project or essay, placed by its metadata. Turn the dial to browse, or open the index to search directly.</p>' +
      '' +
      '</div>' +
      '<div class="intro-actions">' +
      '<button class="btn" type="button" data-intro-dismiss>Turn the dial</button>' +
      '<a class="btn btn-ghost" href="#/index" data-intro-index>Open the index</a>' +
      '</div>' +
      '</dialog>'
    );
  }

  function wireIntro() {
    var dialog = view.querySelector('#site-intro');
    var trigger = view.querySelector('[data-intro-open]');
    var dismiss = view.querySelector('[data-intro-dismiss]');
    var index = view.querySelector('[data-intro-index]');
    var returnFocus = null;
    var automatic = false;
    if (!dialog || !trigger || !dismiss || !index) return;

    function openIntro(isAutomatic) {
      if (dialog.open) return;
      automatic = isAutomatic;
      returnFocus = isAutomatic ? null : document.activeElement;
      dialog.showModal();
    }

    function closeIntro() {
      rememberIntro();
      dialog.close();
    }

    dismiss.addEventListener('click', closeIntro);
    index.addEventListener('click', rememberIntro);
    trigger.addEventListener('click', function () {
      openIntro(false);
    });
    dialog.addEventListener('cancel', function (ev) {
      ev.preventDefault();
      closeIntro();
    });
    dialog.addEventListener('click', function (ev) {
      if (ev.target === dialog) closeIntro();
    });
    dialog.addEventListener('close', function () {
      if (state.route !== 'dial') return;
      var target =
        !automatic && returnFocus && returnFocus.isConnected
          ? returnFocus
          : view.querySelector('#dial');
      automatic = false;
      returnFocus = null;
      if (target) target.focus();
    });

    if (!hasSeenIntro()) openIntro(true);
  }

  function viewDial() {
    view.innerHTML =
      '<section class="stage">' +
      '<aside class="readout" id="readout" aria-live="polite"></aside>' +
      '<div class="dial-wrap">' +
      buildDial() +
      '<ul class="dial-legend" aria-label="Spheres on the dial">' +
      state.manifest.spheres
        .map(function (s) {
          return (
            '<li data-sphere="' + s.id + '"><span class="dl-mark"></span><span class="dl-name">' +
            esc(s.label) +
            '</span><span class="dl-gloss">' +
            esc(s.gloss) +
            '</span></li>'
          );
        })
        .join('') +
      '</ul>' +
      '</div>' +
      '<p class="stage-hint">' +
      '<span>Drag the limb</span><span><kbd>&larr;</kbd> <kbd>&rarr;</kbd> step</span>' +
      '<span><kbd>&crarr;</kbd> open</span><span>or use the <a href="#/index" style="color:var(--color-primary)">index</a></span>' +
      '<button class="intro-trigger" type="button" data-intro-open>What is this?</button>' +
      '</p>' +
      introMarkup() +
      '</section>';
    view.querySelector('#d-nodes').innerHTML = nodesMarkup();
    state.sel = -1;
    snap(state.rotTarget);
    renderDialFrame();
    wireDial();
    wireIntro();
  }

  /* ----- index ----- */
  var ledger = { sort: 'date', dir: -1, sphere: 'all', q: '' };

  function viewIndex() {
    var chips = [{ id: 'all', label: 'All' }].concat(
      state.manifest.spheres.map(function (s) {
        return { id: s.id, label: s.label };
      }),
    );
    view.innerHTML =
      '<div class="page">' +
      '<header class="page-head">' +
      '<p class="eyebrow">Register of entries</p>' +
      '<h1 class="page-title">The Index</h1>' +
      '<p class="page-lede">Everything on the dial, flattened into a ledger. ' +
      'Sort it, filter it, or read the whole shelf in order. Each mark is generated from the entry&rsquo;s own identifier &mdash; no two are alike.</p>' +
      '</header>' +
      '<div class="filters" role="group" aria-label="Filter entries">' +
      chips
        .map(function (c) {
          return (
            '<button class="chip" type="button" data-sphere="' +
            c.id +
            '" aria-pressed="' +
            (ledger.sphere === c.id) +
            '">' +
            c.label +
            '</button>'
          );
        })
        .join('') +
      '<input class="filter-search" id="q" type="search" placeholder="Search titles, tags, summaries" value="' +
      esc(ledger.q) +
      '" aria-label="Search entries">' +
      '</div>' +
      '<div id="ledger-host"></div>' +
      '</div>';

    view.querySelectorAll('.chip').forEach(function (b) {
      b.addEventListener('click', function () {
        ledger.sphere = b.getAttribute('data-sphere');
        view.querySelectorAll('.chip').forEach(function (o) {
          o.setAttribute('aria-pressed', String(o === b));
        });
        paintLedger();
      });
    });
    var q = view.querySelector('#q');
    q.addEventListener('input', function () {
      ledger.q = q.value.trim().toLowerCase();
      paintLedger();
    });
    paintLedger();
  }

  function ledgerRows() {
    var out = state.entries.filter(function (e) {
      if (ledger.sphere !== 'all' && e.sphere !== ledger.sphere) return false;
      if (!ledger.q) return true;
      var hay = (
        e.title +
        ' ' +
        e.designation +
        ' ' +
        e.summary +
        ' ' +
        list(e.tags).join(' ') +
        ' ' +
        e.status
      ).toLowerCase();
      return hay.indexOf(ledger.q) > -1;
    });
    var s = ledger.sort,
      d = ledger.dir;
    out.sort(function (a, b) {
      var x, y;
      if (s === 'date') {
        x = toDate(a.date);
        y = toDate(b.date);
      } else {
        x = String(a[s] || '').toLowerCase();
        y = String(b[s] || '').toLowerCase();
      }
      return x < y ? -d : x > y ? d : 0;
    });
    return out;
  }

  function paintLedger() {
    var host = view.querySelector('#ledger-host');
    if (!host) return;
    var rows = ledgerRows();
    if (!rows.length) {
      host.innerHTML =
        '<div class="empty-state">' +
        '<div class="es-glyph">' +
        window.Sigil.svg(919191) +
        '</div>' +
        '<h3>Nothing answers to that</h3>' +
        '<p>No entry in the register matches the current filter. Widen the sphere, or clear the search field.</p>' +
        '<button class="btn btn-ghost" type="button" id="es-reset">Reset the register</button>' +
        '</div>';
      var r = host.querySelector('#es-reset');
      r.addEventListener('click', function () {
        ledger.q = '';
        ledger.sphere = 'all';
        viewIndex();
      });
      return;
    }
    function th(key, label, cls) {
      var active = ledger.sort === key;
      return (
        '<th' +
        (active ? ' aria-sort="' + (ledger.dir === 1 ? 'ascending' : 'descending') + '"' : '') +
        (cls ? ' class="' + cls + '"' : '') +
        '><button type="button" data-sort="' +
        key +
        '">' +
        label +
        '<span class="arrow">' +
        (active && ledger.dir === 1 ? '&uarr;' : '&darr;') +
        '</span></button></th>'
      );
    }
    host.innerHTML =
      '<table class="ledger"><caption class="sr-only">Register of entries</caption><thead><tr>' +
      '<th><span class="sr-only">Sigil</span></th>' +
      th('designation', 'Desig.') +
      th('title', 'Entry') +
      th('sphere', 'Sphere', 'hide-sm') +
      th('date', 'Recorded') +
      th('status', 'Status', 'hide-sm') +
      '<th class="hide-sm">Tags</th>' +
      '</tr></thead><tbody>' +
      rows
        .map(function (e) {
          return (
            '<tr data-slug="' +
            esc(e.slug) +
            '">' +
            '<td class="c-sigil"><span>' +
            window.Sigil.svg(e.sigil) +
            '</span></td>' +
            '<td class="c-desig">' +
            esc(e.designation) +
            '</td>' +
            '<td class="c-title"><a href="#/e/' +
            esc(e.slug) +
            '">' +
            esc(e.title) +
            '</a></td>' +
            '<td class="hide-sm">' +
            esc(e.sphereLabel) +
            '</td>' +
            '<td class="c-date">' +
            fmtDate(e.date) +
            '</td>' +
            '<td class="hide-sm"><span class="st" data-st="' +
            esc(e.status) +
            '">' +
            esc(String(e.status).toUpperCase()) +
            '</span></td>' +
            '<td class="c-tags hide-sm">' +
            esc(list(e.tags).slice(0, 3).join(' · ')) +
            '</td>' +
            '</tr>'
          );
        })
        .join('') +
      '</tbody></table>';

    host.querySelectorAll('[data-sort]').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-sort');
        if (ledger.sort === k) ledger.dir = -ledger.dir;
        else {
          ledger.sort = k;
          ledger.dir = k === 'date' ? -1 : 1;
        }
        paintLedger();
      });
    });
    host.querySelectorAll('tbody tr').forEach(function (tr) {
      tr.addEventListener('click', function (ev) {
        if (ev.target.closest('a')) return;
        location.hash = '#/e/' + tr.getAttribute('data-slug');
      });
    });
  }

  /* ----- entry ----- */
  function appRow(k, v) {
    return (
      '<div class="app-row"><span class="k">' +
      k +
      '</span><span class="leader"></span><span class="v">' +
      v +
      '</span></div>'
    );
  }

  function viewEntry(slug) {
    var e = state.bySlug[slug];
    if (!e) return view404();

    var html = window.marked.parse(e.body);
    var holder = document.createElement('div');
    holder.innerHTML = html;

    if (e.plate) {
      var kids = Array.prototype.slice.call(holder.children);
      var at = Math.max(2, Math.floor(kids.length * 0.42));
      var fig = document.createElement('figure');
      fig.className = 'plate plate-bleed';
      fig.innerHTML =
        '<img src="./' +
        esc(e.plate) +
        '" alt="' +
        esc(e.plate_caption || e.title) +
        '" loading="lazy" decoding="async" width="1600" height="900">' +
        '<figcaption>' +
        esc(e.plate_caption || '') +
        '</figcaption>';
      if (kids[at]) holder.insertBefore(fig, kids[at]);
      else holder.appendChild(fig);
    }

    var order = state.entries;
    var idx = order.indexOf(e);
    var prev = order[(idx - 1 + order.length) % order.length];
    var next = order[(idx + 1) % order.length];
    var rel = list(e.resonance)
      .map(function (s) {
        return state.bySlug[s];
      })
      .filter(Boolean);

    view.innerHTML =
      '<article class="entry">' +
      '<header class="entry-head">' +
      '<p class="entry-desig"><span>' +
      esc(e.designation) +
      '</span><span class="hr"></span><span class="dim">' +
      esc(e.sphereLabel) +
      ' · ' +
      esc(String(e.kind).toUpperCase()) +
      '</span></p>' +
      '<h1 class="entry-title">' +
      esc(e.title) +
      '</h1>' +
      '<p class="entry-epi">' +
      esc(e.epigraph) +
      '</p>' +
      '</header>' +
      '<div class="entry-body">' +
      '<aside class="apparatus">' +
      '<div class="app-sigil sigil-anim">' +
      window.Sigil.svg(e.sigil) +
      '</div>' +
      '<div class="app-block"><h3>Record</h3>' +
      appRow('Recorded', fmtDate(e.date)) +
      appRow('Revised', fmtDate(e.revised)) +
      appRow(
        'Status',
        '<span class="st" data-st="' + esc(e.status) + '">' + esc(String(e.status).toUpperCase()) + '</span>',
      ) +
      appRow('Reading', e.reading + ' min') +
      (e.license ? appRow('Licence', esc(e.license)) : '') +
      '</div>' +
      (list(e.stack).length
        ? '<div class="app-block"><h3>Instrumentation</h3><div class="app-tags">' +
          list(e.stack)
            .map(function (s) {
              return '<span>' + esc(s) + '</span>';
            })
            .join('') +
          '</div></div>'
        : '') +
      '<div class="app-block"><h3>Tags</h3><div class="app-tags">' +
      list(e.tags)
        .map(function (s) {
          return '<span>' + esc(s) + '</span>';
        })
        .join('') +
      '</div></div>' +
      (e.status_note
        ? '<div class="app-block"><h3>Note</h3><p style="color:var(--color-text-muted);line-height:1.6;max-width:none">' +
          esc(e.status_note) +
          '</p></div>'
        : '') +
      (e.external
        ? '<div class="app-block"><h3>Elsewhere</h3>' +
      '<a class="app-link" href="https://github.com" target="_blank" rel="noopener noreferrer">github.com &#8599;</a>' +
      '</div>' +
      '</div>' +
      (rel.length
        ? '<section class="resonance"><h2>Resonance</h2><div class="res-grid">' +
          rel
            .map(function (r) {
              return (
                '<a class="res-card" href="#/e/' +
                esc(r.slug) +
                '"><span class="rc-sigil">' +
                window.Sigil.svg(r.sigil) +
                '</span><span class="rc-desig">' +
                esc(r.designation) +
                '</span><span class="rc-title">' +
                esc(r.title) +
                '</span><span class="rc-sum">' +
                esc(r.summary) +
                '</span></a>'
              );
            })
            .join('') +
          '</div></section>'
        : '') +
      '<nav class="entry-nav" aria-label="Entry navigation">' +
      '<a class="btn btn-ghost" href="#/e/' +
      esc(prev.slug) +
      '">&larr; ' +
      esc(prev.designation) +
      '</a>' +
      '<a class="btn btn-ghost" href="#/">Back to the dial</a>' +
      '<a class="btn btn-ghost" href="#/e/' +
      esc(next.slug) +
      '">' +
      esc(next.designation) +
      ' &rarr;</a>' +
      '</nav>' +
      '<div id="progress" aria-hidden="true"><svg viewBox="0 0 44 44">' +
      '<circle class="bg" cx="22" cy="22" r="20"/>' +
      '<circle class="arc" cx="22" cy="22" r="17" transform="rotate(-90 22 22)" stroke-dasharray="106.8" stroke-dashoffset="106.8"/>' +
      '<text x="22" y="23">0</text></svg></div>' +
      '</article>';

    document.title = e.title + ' — Antikythera';
    wireProgress();
  }

  function wireProgress() {
    var box = view.querySelector('#progress');
    if (!box) return;
    var arc = box.querySelector('.arc');
    var num = box.querySelector('text');
    var C = 106.8;
    function upd() {
      var h = document.documentElement;
      var max = h.scrollHeight - h.clientHeight;
      var p = max > 0 ? Math.min(1, Math.max(0, h.scrollTop / max)) : 0;
      arc.setAttribute('stroke-dashoffset', String(C * (1 - p)));
      num.textContent = Math.round(p * 100);
      box.classList.toggle('on', max > 200);
    }
    if (state._prog) window.removeEventListener('scroll', state._prog);
    state._prog = upd;
    window.addEventListener('scroll', upd, { passive: true });
    upd();
  }

  /* ----- operator ----- */
  function viewOperator() {
    view.innerHTML =
      '<div class="page">' +
      '<header class="page-head">' +
      '' + (state.manifest.operator.station ? '<p class="eyebrow">' + esc(state.manifest.operator.station) + '</p>' : '') + '' +
      '<h1 class="page-title">The Operator</h1>' +
      '<p class="page-lede">Jonathan J. Wagner. Dual-specialized Creative Designer and Technology Expert in San Antonio. ' +
      '20+ years delivering visual, technical, and AI-driven solutions: from open-source local-first tools and IT infrastructure to ' +
      'bespoke artwork for Google Data Centers and the USAF.</p>' +
      '</header>' +
      '<figure class="plate plate-bleed">' +
      '<img src="./assets/plate-operator.png" alt="An engraved plate of a brass astrolabe and armillary sphere on an instrument-maker&rsquo;s workbench, lit from the left." loading="lazy" decoding="async" width="1600" height="828">' +
      '<figcaption>The bench, as it would have been drawn... Mine just has more cables.</figcaption>' +
      '</figure>' +
      '<div class="op-grid">' +
      '<aside class="op-side">' +
      '<div class="app-block"><h3>Working range</h3><ul class="op-list" role="list">' +
      [
        'AI Training, Annotation, & Model Evaluation',
        'Open-Source Development & Architecture',
        'Local-first systems and data bridges',
        'Hardware Repair & Network Troubleshooting',
        'Active Directory & Help Desk Systems',
        'Visual Design, Typography, & Art Direction',
        'Motion Graphics & Video Editing',
        'Brand Development & Social Media',
        'Team Leadership & Process Optimization',
      ]
        .map(function (s) {
          return '<li>' + s + '</li>';
        })
        .join('') +
      '</ul></div>' +
      '<div class="app-block"><h3>Instruments in hand</h3><div class="app-tags">' +
      [
        'Python',
        'TypeScript / JavaScript',
        'Linux, Windows, MacOS',
        'Virtualization Tools',
        'Remote Support Platforms',
        'Help Desk Systems',
        'Active Directory',
        'Google Search Console',
        'Square POS',
        'Open-Source Web Tools',
        'Adobe Photoshop',
        'Adobe Illustrator',
      ]
        .map(function (s) {
          return '<span>' + s + '</span>';
        })
        .join('') +
      '</div></div>' +
      '<div class="app-block"><h3>Currently reading toward</h3><ul class="op-list" role="list">' +
      [
        'AAS, AI Software Development -> MBA, Computer Science — in progress',
        'Machine Learning Fundamentals',
        'AI Systems Architecture',
        'Data Structures & Algorithms',
        'Python Programming',
      ]
        .map(function (s) {
          return '<li>' + s + '</li>';
        })
        .join('') +
      '</ul></div>' +
      '<div class="app-block"><h3>Certified</h3><ul class="op-list" role="list">' +
      [
        'CompTIA A+',
        'Google IT Support Professional',
        'Adobe Certified Professional — Photoshop, Illustrator',
        'App Brewery Web Development',
      ]
        .map(function (s) {
          return '<li>' + s + '</li>';
        })
        .join('') +
      '</ul></div>' +
      '<div class="app-block"><h3>Elsewhere</h3>' +
      '<a class="app-link" href="https://github.com" target="_blank" rel="noopener noreferrer">github.com &#8599;</a>' +
      '</div>' +
      '</aside>' +
      '<div class="op-col">' +
      '<div class="op-prose">' +
      '<p>I build tools for the part of thinking that happens outside your head. Mostly that means knowledge management &mdash; plugins, importers, schemas, agent systems &mdash; and mostly it means working against the grain of software that wants to own your data rather than hand it back.</p>' +
      '<p>The career did not start there. It began in hands-on hardware repair and IT infrastructure, moved through a decade of high-stakes physical manufacturing and art direction, and expanded into open-source software and AI systems architecture. The common thread is not a medium. Whether evaluating machine learning models, designing visual brand systems, or standing up local-first pipelines, the work is always about taking a messy system apart, finding what actually matters, and building a version that is clearer, more useful, and rigorously correct.</p>' +
      '<h2>How I work</h2>' +
      '<p>Measure twice, cut once. That is not a slogan I picked up from software &mdash; it is what eight years of die-struck production does to a person. Once the die is cut, the design is what it is. There is no hotfix for five hundred coins.</p>' +
      '<p>So: write the metadata at creation time rather than promising yourself you will backfill it. Prefer plain text. Prefer formats that outlive their tooling. Show the write before you make it. Assume every dependency will eventually be withdrawn and ask what remains when it is.</p>' +
      '<p>I would rather ship one instrument that does a narrow thing exactly and keeps working for a decade than a platform that does nine things approximately for eighteen months.</p>' +
      '<h2>Record of service</h2>' +
      '</div>' +
      '<ol class="op-timeline" role="list">' +
      [
        {
          span: '2024 &ndash; present',
          role: 'AI Data Analyst &amp; Annotator',
          org: 'DataAnnotation.Tech',
          note: 'Train and refine AI/ML systems through high-accuracy data annotation, labeling, and quality review. Configure annotation environments, collaborate with engineers to improve model performance and dataset consistency, and escalate blockers to ensure timely delivery.',
        },
        {
          span: '2022 &ndash; present',
          role: 'Visual Design &amp; Technology Consultant',
          org: 'Freelance',
          note: 'Deliver dual creative and technical solutions: graphic design, web design, motion graphics, and IT support. Build brand systems and custom open-source web tools alongside network administration and process-optimization consulting.',
        },
        {
          span: '2020 &ndash; present',
          role: 'Owner / Designer / Technical Operator',
          org: 'DeepspaceGhost',
          note: 'Create original apparel, print designs, and merchandise. Manage online storefront, POS operations, digital assets, and social media while overseeing daily retail workflows and inventory.',
        },
        {
          span: '2013 &ndash; 2021',
          role: 'Production Manager',
          org: 'Celebrate Excellence',
          note: 'Led creative production team delivering bespoke artwork for Google Data Centers, Cisco, The Ellen Show, the Spurs, and USAF Command Chiefs. Managed full product lifecycle for high-detail regulated insignia, improving workflows and expanding e-commerce SEO reach.',
        },
        {
          span: '2010 &ndash; 2013',
          role: 'Technical Support &amp; Repair Technician',
          org: '210Geeks',
          note: 'Delivered comprehensive IT support: diagnostics, hardware repair, network setup, and cross-platform system deployment. Reduced turnaround time through optimized repair processes and new documentation standards.',
        },
        {
          span: '2004 &ndash; 2010',
          role: 'Design / Manufacturing / Web',
          org: 'Accessible Designs, Inc.',
          note: 'Custom accessibility-product design and manufacturing, product photography, website production, brochures, signage, and trade-show media.',
        },
      ]
        .map(function (t) {
          return (
            '<li class="tl-row">' +
            '<span class="tl-span">' +
            t.span +
            '</span>' +
            '<span class="tl-mark" aria-hidden="true"></span>' +
            '<div class="tl-body">' +
            '<h3 class="tl-role">' +
            t.role +
            '</h3>' +
            '<p class="tl-org">' +
            t.org +
            '</p>' +
            '<p class="tl-note">' +
            t.note +
            '</p>' +
            '</div>' +
            '</li>'
          );
        })
        .join('') +
      '</ol>' +
      '<div class="op-prose">' +
      '<h2>What this site is</h2>' +
      '<p>A dial, a register, and a shelf. Each entry is a Markdown file with a YAML header, and everything you see &mdash; the position of a mark on the dial, the sigil beside its name, the order of the ledger &mdash; is computed from that header. Nothing here is maintained by hand. That is the whole argument, demonstrated rather than described.</p>' +
      '<p>Start at the <a href="#/">dial</a> if you want to wander, or the <a href="#/index">index</a> if you know what you are after.</p>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>';
    document.title = 'The Operator — Antikythera';
  }

  function view404() {
    view.innerHTML =
      '<div class="page"><div class="empty-state">' +
      '<div class="es-glyph">' +
      window.Sigil.svg(404404) +
      '</div>' +
      '<h3>No such entry is bound</h3>' +
      '<p>The mechanism has nothing at that address. Every entry is reachable from the dial or the register.</p>' +
      '<a class="btn" href="#/">Return to the dial</a>' +
      '</div></div>';
    document.title = 'Not bound — Antikythera';
  }

  /* ---------------------------------------------------------
     router
     --------------------------------------------------------- */
  function route() {
    var h = location.hash.replace(/^#\/?/, '');
    var parts = h.split('/').filter(Boolean);
    var r = 'dial';
    if (state.raf) {
      cancelAnimationFrame(state.raf);
      state.raf = null;
    }
    if (state._prog) {
      window.removeEventListener('scroll', state._prog);
      state._prog = null;
    }

    if (!parts.length) {
      r = 'dial';
      viewDial();
      document.title = 'Antikythera Template';
    } else if (parts[0] === 'index') {
      r = 'index';
      viewIndex();
      document.title = 'The Index — Antikythera';
    } else if (parts[0] === 'operator') {
      r = 'operator';
      viewOperator();
    } else if (parts[0] === 'e' && parts[1]) {
      r = 'entry';
      viewEntry(decodeURIComponent(parts[1]));
    } else {
      r = '404';
      view404();
    }
    state.route = r;
    view.setAttribute('data-route', r);

    document.querySelectorAll('.nav-link').forEach(function (a) {
      var mine =
        (r === 'dial' && a.dataset.route === 'dial') ||
        (r === 'index' && a.dataset.route === 'index') ||
        (r === 'operator' && a.dataset.route === 'operator') ||
        (r === 'entry' && a.dataset.route === 'index');
      if (mine) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });

    window.scrollTo(0, 0);
  }

  /* ---------------------------------------------------------
     start
     --------------------------------------------------------- */
  function skeleton() {
    view.innerHTML =
      '<div class="page"><div class="sk-wrap">' +
      '<div class="skeleton sk-line" style="width:24%"></div>' +
      '<div class="skeleton sk-line" style="height:2.4em;width:56%"></div>' +
      '<div class="skeleton sk-line" style="width:88%"></div>' +
      '<div class="skeleton sk-line" style="width:74%"></div>' +
      '<div class="skeleton sk-line" style="width:60%"></div>' +
      '</div></div>';
  }

  function fatal(err) {
    view.innerHTML =
      '<div class="page"><div class="empty-state">' +
      '<div class="es-glyph">' +
      window.Sigil.svg(13131) +
      '</div>' +
      '<h3>The mechanism will not turn</h3>' +
      '<p>The entry register could not be read, so there is nothing to place on the dial. Reloading usually settles it.</p>' +
      '<button class="btn" type="button" onclick="location.reload()">Re-attune</button>' +
      '</div></div>';
    document.getElementById('boot').classList.add('done', 'gone');
    console.error(err);
  }

  function ready() {
    if (!window.marked || !window.Sigil) {
      setTimeout(ready, 40);
      return;
    }
    window.marked.use({ mangle: false, headerIds: false, breaks: false });
    skeleton();
    loadAll()
      .then(function () {
        return boot();
      })
      .then(function () {
        window.addEventListener('hashchange', route);
        route();
      })
      .catch(fatal);
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', ready);
  else ready();
})();
