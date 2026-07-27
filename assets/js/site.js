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
    for (var i = 0; i < turb.length; i++) {
      turb[i].setAttribute('seed', String(2 + ((Math.random() * 9) | 0)));
    }
    t = setTimeout(tick, 380 + Math.random() * 420);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { clearTimeout(t); t = null; }
    else if (!t) tick();
  });
  tick();
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
