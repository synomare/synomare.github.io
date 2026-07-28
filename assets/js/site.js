/* ============================================================
   synomare — shared page apparatus
   Designation stamps, entrance choreography, page transition.
   Nothing here decorates; everything here is part of the
   document's own instrumentation.
   ============================================================ */
(function () {
  'use strict';

  var SYN = window.SYN = window.SYN || {};
  SYN.prefersReduced = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function pad(n) { return n < 10 ? '0' + n : n; }

  var now = new Date(Date.now() + (9 * 60 + new Date().getTimezoneOffset()) * 60000);
  var stamp = now.getFullYear() + '.' + pad(now.getMonth() + 1) + '.' + pad(now.getDate());

  var d = document.getElementById('d');
  if (d) d.textContent = stamp;

  var y = document.getElementById('year');
  if (y) y.textContent = now.getFullYear();

  /* every [data-stamp] carries the sheet's own issue date */
  var stamps = document.querySelectorAll('[data-stamp]');
  for (var i = 0; i < stamps.length; i++) stamps[i].textContent = stamp;
})();

/* ------------------------------------------------------------
   entrance — rules draw themselves, blocks set
   ------------------------------------------------------------ */
(function () {
  document.documentElement.classList.add('js');
  var targets = document.querySelectorAll('.rule-head, .set, .thread');
  if (!targets.length) return;

  if (!('IntersectionObserver' in window) || window.SYN.prefersReduced) {
    for (var i = 0; i < targets.length; i++) targets[i].classList.add('in');
    return;
  }

  var io = new IntersectionObserver(function (entries) {
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].isIntersecting) {
        entries[i].target.classList.add('in');
        io.unobserve(entries[i].target);
      }
    }
  }, { threshold: 0.05, rootMargin: '0px 0px -6% 0px' });

  for (var j = 0; j < targets.length; j++) {
    /* threads are clipped to zero width, which zeroes their intersection
       box too — observe the parent and mark the children */
    io.observe(targets[j].classList.contains('thread') ? targets[j].parentElement : targets[j]);
  }
  /* parent observation marks its threads */
  var mo = new IntersectionObserver(function (entries) {
    for (var i = 0; i < entries.length; i++) {
      if (!entries[i].isIntersecting) continue;
      var kids = entries[i].target.querySelectorAll('.thread');
      for (var k = 0; k < kids.length; k++) kids[k].classList.add('in');
      mo.unobserve(entries[i].target);
    }
  }, { threshold: 0.05 });
  var threads = document.querySelectorAll('.thread');
  for (var m = 0; m < threads.length; m++) mo.observe(threads[m].parentElement);
})();

/* ------------------------------------------------------------
   page transition — the plate is exchanged, not dissolved
   ------------------------------------------------------------ */
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
    document.startViewTransition(function () { location.href = url.href; });
  });
})();
