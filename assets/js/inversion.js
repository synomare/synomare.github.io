/* ============================================================
   synomare — realm + rail
   No transition machinery. The paper stops and the mass begins;
   the chrome flips hard when the black block takes the viewport.
   The rail reports which section holds the page and how far down
   the sheet you are. Lenis supplies the inertia.
   ============================================================ */
(function () {
  'use strict';

  var SYN = window.SYN = window.SYN || {};
  var reduced = SYN.prefersReduced;
  var body = document.body;
  var themeMeta = document.querySelector('meta[name="theme-color"]');

  var railSec = document.getElementById('railSec');
  var railPos = document.getElementById('railPos');
  var sections = [].slice.call(document.querySelectorAll('[data-sec]'));

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

  /* ---------- realm — a hard cut, no interpolation ---------- */
  var darks = document.querySelectorAll('.slab, .register-verso');
  var isUra = false;
  function setUra(v) {
    if (v === isUra) return;
    isUra = v;
    body.classList.toggle('is-ura', v);
    if (themeMeta) themeMeta.setAttribute('content', v ? '#0a0906' : '#f4f3ef');
  }
  if (darks.length && 'IntersectionObserver' in window) {
    /* how many dark blocks currently cross the middle band of the viewport */
    var lit = 0;
    var io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) lit += entries[i].isIntersecting ? 1 : -1;
      if (lit < 0) lit = 0;
      setUra(lit > 0);
    }, { rootMargin: '-45% 0px -45% 0px' });
    for (var k = 0; k < darks.length; k++) io.observe(darks[k]);
  }

  /* ---------- rail ---------- */
  var railText = '', posText = '';
  function report() {
    if (railSec && sections.length) {
      var mid = window.innerHeight * 0.42;
      var name = sections[0].getAttribute('data-sec');
      for (var i = 0; i < sections.length; i++) {
        if (sections[i].getBoundingClientRect().top <= mid) name = sections[i].getAttribute('data-sec');
      }
      if (name !== railText) { railText = name; railSec.textContent = name; }
    }
    if (railPos) {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      var s = (max > 0 ? clamp01(window.scrollY / max) : 0).toFixed(3);
      if (s !== posText) { posText = s; railPos.textContent = s; }
    }
  }

  if (reduced) {
    report();
    window.addEventListener('scroll', report, { passive: true });
    return;
  }

  /* ---------- inertia ---------- */
  var lenis = window.Lenis ? new window.Lenis({ autoRaf: false, lerp: 0.115 }) : null;
  if (lenis) SYN.lenis = lenis;

  /* A fixed full-viewport blended layer (the grain) recomposites on every
     frame the page paints, so an idle rAF loop is not free. Run only while
     something is actually moving. */
  var raf = null, idleFrames = 0;
  function wake() {
    idleFrames = 0;
    if (!raf) raf = requestAnimationFrame(frame);
  }
  ['wheel', 'touchmove', 'touchstart', 'keydown', 'scroll', 'pointerdown', 'resize'].forEach(function (ev) {
    window.addEventListener(ev, wake, { passive: true });
  });

  function frame(t) {
    if (lenis) lenis.raf(t);
    report();
    idleFrames = (lenis && lenis.isScrolling) ? 0 : idleFrames + 1;
    raf = idleFrames > 20 ? null : requestAnimationFrame(frame);
  }
  wake();

  window.addEventListener('pageshow', function (e) { if (e.persisted) wake(); });
})();
