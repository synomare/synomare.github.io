/* ============================================================
   synomare — rail + inertia
   The sheet reports which section holds the viewport and how far
   down it you are. Lenis supplies the inertia. Nothing else.
   ============================================================ */
(function () {
  'use strict';

  var SYN = window.SYN = window.SYN || {};
  var railSec = document.getElementById('railSec');
  var railPos = document.getElementById('railPos');
  var sections = [].slice.call(document.querySelectorAll('[data-sec]'));

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

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

  if (SYN.prefersReduced) {
    report();
    window.addEventListener('scroll', report, { passive: true });
    return;
  }

  var lenis = window.Lenis ? new window.Lenis({ autoRaf: false, lerp: 0.115 }) : null;
  if (lenis) SYN.lenis = lenis;

  /* The fixed full-viewport grain layer recomposites on every frame the
     page paints, so an idle rAF loop is not free. Run only while
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
