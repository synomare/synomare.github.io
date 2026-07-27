/* ============================================================
   synomare — inversion controller (裏写り)
   Drives the seam: scroll progress → --seamp (torn-edge
   clip-path uniform), realm flip (body.is-ura + theme-color),
   recital wear (forgetting) and verso lighting (phosphor).
   Lenis provides inertial time; native scroll is the fallback.
   ============================================================ */
(function () {
  'use strict';

  var SYN = window.SYN = window.SYN || {};
  var reduced = SYN.prefersReduced;
  var seam = document.getElementById('seam');
  if (!seam) return;
  var stage = seam.querySelector('.seam-stage');
  if (!stage) return;
  var body = document.body;
  var themeMeta = document.querySelector('meta[name="theme-color"]');

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

  var isUra = false;
  function setUra(v) {
    if (v === isUra) return;
    isUra = v;
    body.classList.toggle('is-ura', v);
    if (themeMeta) themeMeta.setAttribute('content', v ? '#0a0906' : '#f4f3ef');
  }

  /* static fallback — the sheet is already torn */
  if (reduced) {
    stage.style.setProperty('--seamp', '1');
    seam.classList.add('seam-static');
    if (SYN.seamVerso) SYN.seamVerso.lit(1);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        setUra(entries[0].isIntersecting);
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
  var raf = null;

  function frame(t) {
    if (lenis) lenis.raf(t);

    var r = seam.getBoundingClientRect();
    var vh = window.innerHeight;
    var total = r.height - vh;
    var p = total > 0 ? clamp01(-r.top / total) : 0;

    /* lag = choreography: the tear trails the scroll slightly */
    current += (p - current) * 0.16;
    if (Math.abs(current - p) < 0.0008) current = p;
    stage.style.setProperty('--seamp', current.toFixed(4));

    setUra(p > 0.55);

    /* the recital erodes as the seam approaches */
    if (SYN.recital) {
      SYN.recital.wear(clamp01((vh * 1.7 - r.top) / (vh * 1.5)) * 0.8);
    }
    /* the verso copy ignites, seed order, as the tear crosses */
    if (SYN.seamVerso) {
      SYN.seamVerso.lit(clamp01(current * 1.35));
    }

    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  /* keep the loop honest across bfcache restores */
  window.addEventListener('pageshow', function (e) {
    if (e.persisted && !raf) raf = requestAnimationFrame(frame);
  });
})();
