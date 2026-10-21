// Gallery: the plates are bound by one red thread. Each plate has four holes along its foot;
// the thread runs over, under, over, then is slung to the next plate. It is sewn in order as you scroll.
(() => {
  const section = document.querySelector('.graphics');
  const grid = section?.querySelector('.graphics-grid');
  const svg = document.getElementById('binding');
  if (!grid || !svg) return;
  const ns = 'http://www.w3.org/2000/svg';
  const plates = [...grid.querySelectorAll('.graphic')];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Pull each sheet as it enters the viewport.
  if (!reduced && 'IntersectionObserver' in window) {
    grid.classList.add('can-pull');
    const io = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-pulled');
        io.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -8% 0px' });
    plates.forEach(plate => io.observe(plate));
  }

  const HOLES = [.12, .37, .63, .88];
  let segments = [];   // { el, shadow, len, y }
  let total = 0, sewn = 0, target = 0, frame = 0, last = 0;

  const el = (name, attrs) => {
    const node = document.createElementNS(ns, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  };

  function build() {
    const box = section.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    svg.replaceChildren();
    const shadows = el('g', {}), threads = el('g', {}), holes = el('g', {});
    svg.append(shadows, threads, holes);
    const fraction = total ? sewn / total : 0;
    segments = [];
    total = 0;

    const add = (d, y) => {
      const shadow = el('path', { d, class: 'thread shadow' });
      const path = el('path', { d, class: 'thread' });
      shadows.append(shadow);
      threads.append(path);
      const len = path.getTotalLength();
      segments.push({ el: path, shadow, len, y, start: total });
      total += len;
    };

    // Rounded polyline: the thread is led around corners rather than across the work.
    const lead = (pts, r = 14) => {
      let d = `M ${pts[0][0]} ${pts[0][1]}`;
      for (let i = 1; i < pts.length - 1; i++) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
        const l1 = Math.hypot(x1 - x0, y1 - y0) || 1, l2 = Math.hypot(x2 - x1, y2 - y1) || 1;
        const k1 = Math.min(r, l1 / 2) / l1, k2 = Math.min(r, l2 / 2) / l2;
        d += ` L ${x1 - (x1 - x0) * k1} ${y1 - (y1 - y0) * k1} Q ${x1} ${y1} ${x1 + (x2 - x1) * k2} ${y1 + (y2 - y1) * k2}`;
      }
      const [xn, yn] = pts[pts.length - 1];
      return `${d} L ${xn} ${yn}`;
    };

    let prev = null;
    for (const plate of plates) {
      const r = plate.querySelector('img').getBoundingClientRect();
      const frame = { left: r.left - box.left - 8, right: r.right - box.left + 8, top: r.top - box.top - 8, foot: r.bottom - box.top + 8 };
      const y = frame.foot;
      const xs = HOLES.map(f => r.left - box.left + r.width * f);
      xs.forEach(x => holes.append(el('circle', { cx: x, cy: y, r: 2.6, class: 'hole' })));
      if (!prev) {
        // The loose end where sewing begins.
        add(`M ${xs[0] - 4} ${y + 52} C ${xs[0] - 10} ${y + 30}, ${xs[0] - 2} ${y + 12}, ${xs[0]} ${y}`, y);
      } else if (frame.left > prev.frame.right - 1) {
        // Neighbours on one row: slung across the gutter, sagging into the space beneath the plates.
        const [px, py] = prev.exit, nx = xs[0];
        const low = Math.max(py, y) + Math.min(44, 14 + Math.abs(nx - px) * .12);
        add(`M ${px} ${py} C ${px + (nx - px) * .3} ${low}, ${px + (nx - px) * .7} ${low}, ${nx} ${y}`, Math.min(py, y));
      } else {
        // A new row: led down the margin, along the gutter between rows, and up the spine of the next plate.
        const [px, py] = prev.exit;
        const outer = Math.min(prev.frame.right + 18, box.width + 9), inner = Math.max(frame.left - 18, -9);
        const gutter = frame.top - Math.max(24, (frame.top - prev.rowFoot) / 2);
        add(lead([[px, py], [outer, py + 10], [outer, gutter], [inner, gutter], [inner, y - 10], [xs[0], y]]), py);
      }
      // Over from the first hole to the second, under to the third (hidden), over to the fourth.
      add(`M ${xs[0]} ${y} L ${xs[1]} ${y}`, y);
      add(`M ${xs[2]} ${y} L ${xs[3]} ${y}`, y);
      const sameRow = prev && frame.left > prev.frame.right - 1;
      prev = { exit: [xs[3], y], frame, rowFoot: Math.max(sameRow ? prev.rowFoot : 0, frame.foot + 34) };
    }
    if (prev) {
      // Finished with a knot and a short hanging end.
      const [x, y] = prev.exit;
      add(`M ${x} ${y} c 10 -4 14 6 8 10 c -6 4 -12 -4 -6 -8 C ${x + 18} ${y + 10}, ${x + 16} ${y + 40}, ${x + 22} ${y + 72}`, y);
    }
    sewn = reduced ? total : fraction * total;
    paint();
    update();
  }

  function paint() {
    for (const s of segments) {
      const shown = Math.max(0, Math.min(s.len, sewn - s.start));
      const offset = s.len - shown;
      for (const p of [s.el, s.shadow]) {
        p.style.strokeDasharray = `${s.len} ${s.len}`;
        p.style.strokeDashoffset = offset;
      }
    }
  }

  // How far the needle should have got: up to the last segment whose start has come into view.
  function update() {
    const box = section.getBoundingClientRect();
    const line = innerHeight * .78 - box.top;
    let reach = 0;
    for (const s of segments) {
      if (s.y <= line) reach = s.start + s.len;
      else break;
    }
    target = reduced ? total : Math.max(target, reach);
    if (reduced) { sewn = total; paint(); return; }
    if (!frame && sewn < target) { last = performance.now(); frame = requestAnimationFrame(sew); }
  }

  // The needle runs at a steady pace, so a whole row is sewn stitch by stitch rather than at once.
  function sew(now) {
    const dt = Math.min(48, now - last);
    last = now;
    sewn = Math.min(target, sewn + dt * 1.6);
    paint();
    frame = sewn < target ? requestAnimationFrame(sew) : 0;
  }

  addEventListener('scroll', update, { passive: true });
  let resizeFrame = 0;
  new ResizeObserver(() => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(build); }).observe(grid);
  (document.fonts?.ready || Promise.resolve()).then(build);
})();
