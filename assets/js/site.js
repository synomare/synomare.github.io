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
