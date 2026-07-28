/* ============================================================
   synomare — inversion controller
   The seam is not an event, it is a measurement: a rule travels
   the sheet and reports its position. --seamp drives the clip,
   the rule, the readout, and the realm flip. Lenis supplies the
   inertia; native scroll is the fallback.
   ============================================================ */
(function () {
  'use strict';

  var SYN = window.SYN = window.SYN || {};
  var reduced = SYN.prefersReduced;
  var body = document.body;
  var themeMeta = document.querySelector('meta[name="theme-color"]');

  var seam = document.getElementById('seam');
  var stage = seam && seam.querySelector('.seam-stage');
  var scanVal = document.getElementById('scanVal');
  var railSec = document.getElementById('railSec');
  var railPos = document.getElementById('railPos');

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

  var isUra = false;
  function setUra(v) {
    if (v === isUra) return;
    isUra = v;
    body.classList.toggle('is-ura', v);
    if (themeMeta) themeMeta.setAttribute('content', v ? '#0a0906' : '#f4f3ef');
  }

  /* ---------- the rail reports which section holds the viewport ---------- */
  var sections = [].slice.call(document.querySelectorAll('[data-sec]'));
  var railText = '';
  function reportSection() {
    if (!railSec || !sections.length) return;
    var mid = window.innerHeight * 0.42;
    var name = sections[0].getAttribute('data-sec');
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].getBoundingClientRect().top <= mid) name = sections[i].getAttribute('data-sec');
    }
    if (name !== railText) { railText = name; railSec.textContent = name; }
  }

  var posText = '';
  function reportPosition() {
    if (!railPos) return;
    var max = document.documentElement.scrollHeight - window.innerHeight;
    var f = max > 0 ? clamp01(window.scrollY / max) : 0;
    var s = f.toFixed(3);
    if (s !== posText) { posText = s; railPos.textContent = s; }
  }

  /* ---------- static fallback: the sheet is already turned ---------- */
  if (reduced) {
    if (stage) {
      stage.style.setProperty('--seamp', '1');
      seam.classList.add('seam-static');
      if (scanVal) scanVal.textContent = '1.0000';
    }
    if (SYN.seamVerso) SYN.seamVerso.lit(1);
    reportSection();
    reportPosition();
    window.addEventListener('scroll', function () { reportSection(); reportPosition(); }, { passive: true });
    if (seam && 'IntersectionObserver' in window) {
      new IntersectionObserver(function (e) {
        setUra(e[0].isIntersecting);
      }, { rootMargin: '-40% 0px -40% 0px' }).observe(seam);
    }
    return;
  }

  var lenis = null;
  if (window.Lenis) {
    lenis = new window.Lenis({ autoRaf: false, lerp: 0.115 });
    SYN.lenis = lenis;
  }

  var current = 0;
  var written = null;
  var scanText = null;
  var raf = null;
  var idleFrames = 0;

  /* A fixed full-viewport blended layer (the grain) recomposites on every
     frame the page paints, so an idle rAF loop is not free. Run only while
     something is actually moving. */
  function wake() {
    idleFrames = 0;
    if (!raf) raf = requestAnimationFrame(frame);
  }
  ['wheel', 'touchmove', 'touchstart', 'keydown', 'scroll', 'pointerdown', 'resize'].forEach(function (ev) {
    window.addEventListener(ev, wake, { passive: true });
  });

  function frame(t) {
    if (lenis) lenis.raf(t);

    reportSection();
    reportPosition();

    var p = 0;
    if (stage) {
      var r = seam.getBoundingClientRect();
      var vh = window.innerHeight;
      var total = r.height - vh;
      p = total > 0 ? clamp01(-r.top / total) : 0;

      /* the rule trails the scroll slightly — that lag is the choreography */
      current += (p - current) * 0.16;
      if (Math.abs(current - p) < 0.0008) current = p;

      /* --seamp feeds a clip and a position, so only write on change */
      var next = current.toFixed(4);
      if (next !== written) {
        stage.style.setProperty('--seamp', next);
        written = next;
        if (scanVal && next !== scanText) { scanVal.textContent = next; scanText = next; }
      }

      setUra(p > 0.5);
      body.classList.toggle('seam-active', p > 0.001 && p < 0.999);

      if (SYN.seamVerso) SYN.seamVerso.lit(clamp01(current * 1.3));
    }

    var moving = (stage && current !== p) || (lenis && lenis.isScrolling);
    idleFrames = moving ? 0 : idleFrames + 1;
    raf = idleFrames > 20 ? null : requestAnimationFrame(frame);
  }
  wake();

  window.addEventListener('pageshow', function (e) { if (e.persisted) wake(); });
})();
