/* synomare — shared page chrome (JST date stamp, year) */
(function () {
  'use strict';

  window.SYN = window.SYN || {};
  window.SYN.prefersReduced = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function pad(n) { return n < 10 ? '0' + n : n; }

  var d = document.getElementById('d');
  if (d) {
    var now = new Date(Date.now() + (9 * 60 + new Date().getTimezoneOffset()) * 60000);
    d.textContent = now.getFullYear() + '.' + pad(now.getMonth() + 1) + '.' + pad(now.getDate());
  }

  var y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();
})();

/* scroll-entrance choreography — rulers draw, threads string themselves */
(function () {
  document.documentElement.classList.add('js');
  var targets = document.querySelectorAll('.sec-head, [data-flicker]');
  var threads = document.querySelectorAll('.thread');
  if (!targets.length && !threads.length) return;
  function markAll() {
    for (var i = 0; i < targets.length; i++) targets[i].classList.add('drawn');
    for (var j = 0; j < threads.length; j++) threads[j].classList.add('drawn');
  }
  if (!('IntersectionObserver' in window) || window.SYN.prefersReduced) {
    markAll();
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].isIntersecting) {
        entries[i].target.classList.add('drawn');
        io.unobserve(entries[i].target);
      }
    }
  }, { threshold: 0.1 });
  for (var k = 0; k < targets.length; k++) io.observe(targets[k]);

  /* threads are clipped to zero width, which zeroes their intersection
     area too — observe their parent section instead */
  var parents = [];
  for (var m = 0; m < threads.length; m++) {
    var parent = threads[m].parentElement;
    if (parents.indexOf(parent) === -1) parents.push(parent);
  }
  var tio = new IntersectionObserver(function (entries) {
    for (var i = 0; i < entries.length; i++) {
      if (!entries[i].isIntersecting) continue;
      var kids = entries[i].target.children;
      for (var j = 0; j < kids.length; j++) {
        if (kids[j].classList && kids[j].classList.contains('thread')) {
          kids[j].classList.add('drawn');
        }
      }
      tio.unobserve(entries[i].target);
    }
  }, { threshold: 0.12 });
  for (var n = 0; n < parents.length; n++) tio.observe(parents[n]);
})();

/* hover scramble — latin chrome text flickers through katakana/marks, then settles */
(function () {
  if (window.SYN.prefersReduced) return;
  var POOL = 'アカサタナハマヤラワイキシチニヒミリウクスツヌフムユルエケセテネヘメレオ0123456789/*+-=<>#%&';
  function scramble(el) {
    if (!el || el.dataset.scrambling) return;
    var orig = el.dataset.orig || (el.dataset.orig = el.textContent);
    if (!/[A-Za-z0-9]/.test(orig)) return;
    if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', orig);
    el.dataset.scrambling = '1';
    var frames = 9, f = 0;
    var iv = setInterval(function () {
      f++;
      var lock = Math.floor(orig.length * (f / frames));
      var out = '';
      for (var i = 0; i < orig.length; i++) {
        var ch = orig.charAt(i);
        if (i < lock || !/[A-Za-z0-9]/.test(ch)) out += ch;
        else out += POOL.charAt((Math.random() * POOL.length) | 0);
      }
      el.textContent = out;
      if (f >= frames) {
        clearInterval(iv);
        el.textContent = orig;
        delete el.dataset.scrambling;
      }
    }, 32);
  }
  var navLinks = document.querySelectorAll('.topbar nav a, .topbar .brand');
  for (var i = 0; i < navLinks.length; i++) {
    (function (el) {
      el.addEventListener('pointerenter', function () { scramble(el); });
    })(navLinks[i]);
  }
  var tags = document.querySelectorAll('.tag');
  for (var j = 0; j < tags.length; j++) {
    (function (tag) {
      tag.addEventListener('pointerenter', function () { scramble(tag.querySelector('.en')); });
    })(tags[j]);
  }
})();

/* living engraving — reseed the etch displacement so engraved lines shiver */
(function () {
  if (window.SYN.prefersReduced) return;
  var turb = document.querySelectorAll('#etch feTurbulence, #etch-deep feTurbulence');
  if (!turb.length) return;
  var t = null;
  function tick() {
    /* reseeding invalidates every element using the filter, so keep it
       infrequent and skip it while the seam is animating */
    if (!document.body.classList.contains('seam-active')) {
      for (var i = 0; i < turb.length; i++) {
        turb[i].setAttribute('seed', String(2 + ((Math.random() * 9) | 0)));
      }
    }
    t = setTimeout(tick, 900 + Math.random() * 900);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { clearTimeout(t); t = null; }
    else if (!t) tick();
  });
  tick();
})();

/* registration-cross cursor — expands and magnetises over links */
(function () {
  if (window.SYN.prefersReduced) return;
  if (!(window.matchMedia && window.matchMedia('(pointer: fine)').matches)) return;

  var cur = document.createElement('div');
  cur.className = 'syn-cursor';
  cur.setAttribute('aria-hidden', 'true');
  cur.innerHTML = '<span class="cx-h"></span><span class="cx-v"></span><span class="cx-ring"></span>';
  document.body.appendChild(cur);
  document.documentElement.classList.add('has-cursor');

  var tx = window.innerWidth / 2, ty = window.innerHeight / 2, cx = tx, cy = ty;
  var magnet = null, raf = null;

  function step() {
    raf = null;
    var gx = tx, gy = ty;
    if (magnet) {
      var r = magnet.getBoundingClientRect();
      var mx = r.left + r.width / 2, my = r.top + r.height / 2;
      gx += (mx - tx) * 0.22;
      gy += (my - ty) * 0.22;
    }
    cx += (gx - cx) * 0.28;
    cy += (gy - cy) * 0.28;
    cur.style.transform = 'translate3d(' + cx.toFixed(1) + 'px,' + cy.toFixed(1) + 'px,0) translate(-50%,-50%)';
    if (Math.abs(gx - cx) > 0.1 || Math.abs(gy - cy) > 0.1) raf = requestAnimationFrame(step);
  }
  function wake() { if (!raf) raf = requestAnimationFrame(step); }

  window.addEventListener('pointermove', function (e) {
    if (e.pointerType !== 'mouse') return;
    tx = e.clientX; ty = e.clientY;
    cur.classList.add('on');
    var hit = e.target.closest && e.target.closest('a, button, .tag, .work-row, .vault-row, .link-row');
    if (hit !== magnet) {
      magnet = hit && hit.getBoundingClientRect().width < 420 ? hit : null;
      cur.classList.toggle('over', !!hit);
    }
    wake();
  }, { passive: true });

  document.addEventListener('pointerleave', function () { cur.classList.remove('on'); });
  window.addEventListener('blur', function () { cur.classList.remove('on'); });
})();

/* page transition — the sheet lifts, the next one is already printed */
(function () {
  if (window.SYN.prefersReduced) return;
  if (!document.startViewTransition) return;
  document.documentElement.classList.add('has-vt');

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
    var url;
    try { url = new URL(a.href, location.href); } catch (err) { return; }
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname && url.hash) return;
    if (!/\.html?$|\/$/.test(url.pathname)) return;

    e.preventDefault();
    var toDark = !!a.closest('.ura');
    document.documentElement.dataset.vt = toDark ? 'dark' : 'paper';
    document.startViewTransition(function () { location.href = url.href; });
  });
})();

/* pointer parallax for [data-parallax] ghosts */
(function () {
  if (window.SYN.prefersReduced) return;
  if (!(window.matchMedia && window.matchMedia('(pointer: fine)').matches)) return;
  var els = document.querySelectorAll('[data-parallax]');
  if (!els.length) return;
  var raf = null, tx = 0, ty = 0, cx = 0, cy = 0;
  function step() {
    raf = null;
    cx += (tx - cx) * 0.06;
    cy += (ty - cy) * 0.06;
    for (var i = 0; i < els.length; i++) {
      var depth = parseFloat(els[i].getAttribute('data-parallax')) || 1;
      els[i].style.setProperty('--gpx', (cx * depth * 14).toFixed(2) + 'px');
      els[i].style.setProperty('--gpy', (cy * depth * 8).toFixed(2) + 'px');
    }
    if (Math.abs(tx - cx) > 0.001 || Math.abs(ty - cy) > 0.001) raf = requestAnimationFrame(step);
  }
  window.addEventListener('pointermove', function (e) {
    tx = (e.clientX / window.innerWidth - 0.5) * 2;
    ty = (e.clientY / window.innerHeight - 0.5) * 2;
    if (!raf) raf = requestAnimationFrame(step);
  }, { passive: true });
})();
