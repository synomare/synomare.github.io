// Threads on the index plate: Verlet-integrated red threads.
// - Bundles slung between the pinned labels (the plate's graphic).
// - Loose threads that hang from pins, one for every glyph cut in the Lectio below.
//   They are added while the reader is down in the text and fall into place when the plate is seen again.
(() => {
  const field = document.querySelector('.field');
  const canvas = field?.querySelector('.thread-canvas');
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const GRAVITY = .34, DAMPING = .986, SEGMENT = 15, MAX_CUT_THREADS = 320, DRY_MS = 4600;
  const FRESH = [232, 52, 31], DRIED = [150, 50, 38];
  // Pins pressed straight into the plate (fractions of the field), in addition to the labels' pins.
  const PLATE_PINS = [[.17, .05], [.29, .13], [.41, .07], [.53, .15], [.63, .04], [.74, .12], [.86, .07], [.94, .18], [.48, .27], [.35, .22], [.69, .25], [.22, .31]];
  const ROUTES = [
    ['works', 'hello', 'works', 7],
    ['gallery', 'works', 'gallery', 6],
    ['gallery', 'hello', 'gallery', 4],
    ['notes', 'notes', 'profile', 7],
    ['links', 'links', 'notes', 5],
    ['profile', 'gallery', 'profile', 5],
    ['works', 'works', 'edge', 5]
  ];

  let W = 0, H = 0, dpr = 1;
  let pins = {};
  let strands = [];
  let visible = true, running = false, calm = 0, frame = 0;
  let lastScroll = scrollY;
  let wantedCuts = 0;
  const pointer = { x: -1e4, y: -1e4, vx: 0, vy: 0, inside: false };
  const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

  /* ---------- geometry ---------- */
  function measure() {
    const rect = field.getBoundingClientRect();
    W = rect.width; H = rect.height;
    dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    pins = {};
    for (const el of field.querySelectorAll('[data-pin]')) {
      const r = el.getBoundingClientRect();
      pins[el.dataset.pin] = [r.left - rect.left + r.width / 2, r.top - rect.top + r.height / 2];
    }
    const narrow = W <= 700;
    pins.edge = [W * (narrow ? .95 : .96), H * (narrow ? .82 : .04)];
    PLATE_PINS.forEach(([fx, fy], i) => { pins[`plate${i}`] = [W * fx, H * fy]; });
  }
  const at = key => pins[key] || [0, 0];
  const hangAnchors = () => ['hello', 'works', 'gallery', 'notes', 'profile', 'links', ...PLATE_PINS.map((_, i) => `plate${i}`)];

  function makeStrand(kind, a, b, rest, extra) {
    const [ax, ay] = at(a);
    const n = Math.max(8, Math.min(46, Math.round(rest / SEGMENT)));
    const s = { kind, a, b, rest, n, seg: rest / (n - 1), x: new Float32Array(n), y: new Float32Array(n), px: new Float32Array(n), py: new Float32Array(n), tension: 1, target: 1, ...extra };
    if (b) {
      // Start on the parabola the strand will settle into, so the plate never opens in a tangle.
      const [bx, by] = at(b);
      const L = Math.hypot(bx - ax, by - ay) || 1;
      const sag = Math.sqrt(Math.max(0, (rest - L) * 3 * L / 8));
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        s.x[i] = ax + (bx - ax) * t;
        s.y[i] = ay + (by - ay) * t + 4 * sag * t * (1 - t);
      }
    } else if (extra?.drop && !reduced) {
      // Coiled at the pin; gravity pays it out.
      for (let i = 0; i < n; i++) { s.x[i] = ax + Math.sin(i * 1.7) * 2.5; s.y[i] = ay + i * .7; }
    } else {
      for (let i = 0; i < n; i++) { s.x[i] = ax + Math.sin(i * .9 + rest) * 1.5; s.y[i] = ay + i * s.seg * .985; }
    }
    s.px.set(s.x); s.py.set(s.y);
    return s;
  }

  function buildSpans() {
    strands = strands.filter(s => s.kind !== 'span');
    ROUTES.forEach(([group, a, b, count], r) => {
      const [ax, ay] = at(a), [bx, by] = at(b);
      const L = Math.hypot(bx - ax, by - ay) || 1;
      const horizontal = Math.abs(bx - ax) / L;
      const baseSag = Math.min(W <= 700 ? 66 : 145, 20 + L * .2) * (.5 + horizontal * .5);
      for (let i = 0; i < count; i++) {
        // Unequal slack gives each strand its own fall between shared pins.
        const variation = Math.sin(i * 2.17 + r * 1.41);
        const sag = baseSag * (.65 + i / (count - 1) * .68 + variation * .09);
        const rest = L + 8 * sag * sag / (3 * L);
        strands.push(makeStrand('span', a, b, rest, { group, core: i === Math.floor(count / 2), straight: L }));
      }
    });
  }

  function addHang(index, base) {
    const anchors = hangAnchors();
    const a = anchors[Math.floor(hash(index + (base ? 900 : 0)) * anchors.length)];
    const r = hash(index * 3.3 + 17);
    const rest = H * (base ? .16 + r * .2 : .12 + r * .5);
    // Sewing thread keeps the kinks of the spool: each strand remembers its own gentle waves.
    strands.push(makeStrand('hang', a, null, rest, {
      base, born: base ? 0 : performance.now(), drop: !base,
      fan: (hash(index + 5) - .5) * 9,
      kinkAmp: .08 + hash(index + 11) * .22, kinkFreq: .35 + hash(index + 23) * .5, kinkPhase: hash(index + 31) * 6.28
    }));
  }

  /* ---------- simulation ---------- */
  function step() {
    const R = 80, R2 = R * R;
    for (const s of strands) {
      const { x, y, px, py, n } = s;
      // Hovered bundles draw taut; released ones fall slack again.
      s.tension += (s.target - s.tension) * .08;
      let rest = s.rest;
      if (s.kind === 'span') rest = s.straight + (s.rest - s.straight) * s.tension;
      if (s.dying) { s.rest *= .9; rest = s.rest; }
      s.seg = rest / (n - 1);
      for (let i = 1; i < n; i++) {
        if (s.b && i === n - 1) continue;
        const vx = (x[i] - px[i]) * DAMPING, vy = (y[i] - py[i]) * DAMPING;
        px[i] = x[i]; py[i] = y[i];
        x[i] += vx; y[i] += vy + GRAVITY;
        if (pointer.inside) {
          const dx = x[i] - pointer.x, dy = y[i] - pointer.y, d2 = dx * dx + dy * dy;
          if (d2 < R2 && d2 > .01) {
            const d = Math.sqrt(d2), f = 1 - d / R;
            x[i] += dx / d * f * 1.2 + pointer.vx * f * .09;
            y[i] += dy / d * f * .6 + pointer.vy * f * .05;
          }
        }
      }
      const [ax0, ay] = at(s.a);
      const ax = ax0 + (s.fan || 0);
      const iterations = s.kind === 'span' ? 8 : 6;
      for (let k = 0; k < iterations; k++) {
        x[0] = ax; y[0] = ay;
        if (s.b) { const [bx, by] = at(s.b); x[n - 1] = bx; y[n - 1] = by; }
        for (let i = 0; i < n - 1; i++) {
          const dx = x[i + 1] - x[i], dy = y[i + 1] - y[i];
          const d = Math.sqrt(dx * dx + dy * dy) || .0001;
          const diff = (d - s.seg) / d;
          const firstPinned = i === 0, lastPinned = s.b && i + 1 === n - 1;
          if (firstPinned && !lastPinned) { x[i + 1] -= dx * diff; y[i + 1] -= dy * diff; }
          else if (lastPinned && !firstPinned) { x[i] += dx * diff; y[i] += dy * diff; }
          else if (!firstPinned) { x[i] += dx * diff * .5; y[i] += dy * diff * .5; x[i + 1] -= dx * diff * .5; y[i + 1] -= dy * diff * .5; }
        }
        if (s.kinkAmp) {
          // Bending memory: hold every second neighbour at a slightly shortened chord.
          for (let i = 1; i < n - 2; i++) {
            const bend = s.kinkAmp * Math.sin(i * s.kinkFreq + s.kinkPhase);
            const target = 2 * s.seg * Math.cos(bend);
            const dx = x[i + 2] - x[i], dy = y[i + 2] - y[i];
            const d = Math.sqrt(dx * dx + dy * dy) || .0001;
            const diff = (d - target) / d * .25;
            x[i] += dx * diff; y[i] += dy * diff; x[i + 2] -= dx * diff; y[i + 2] -= dy * diff;
            // Bend to the side the wave asks for, not whichever side gravity happens to choose.
            const side = Math.sign(bend) * .18 * Math.abs(diff) * d;
            x[i + 1] += side * (dy / d);
            y[i + 1] -= side * (dx / d);
          }
        }
      }
      x[0] = ax; y[0] = ay;
    }
    strands = strands.filter(s => !(s.dying && s.rest < 3));
    pointer.vx *= .6; pointer.vy *= .6;
  }

  function energy() {
    let e = 0, count = 0;
    for (const s of strands) {
      for (let i = 1; i < s.n; i += 3) { e += Math.abs(s.x[i] - s.px[i]) + Math.abs(s.y[i] - s.py[i]); count++; }
      if (s.dying || Math.abs(s.target - s.tension) > .01) e += 10;
    }
    return count ? e / count : 0;
  }

  /* ---------- drawing ---------- */
  const mix = (a, b, t) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;
  function trace(s, ox = 0, oy = 0) {
    const { x, y, n } = s;
    ctx.beginPath();
    ctx.moveTo(x[0] + ox, y[0] + oy);
    for (let i = 1; i < n - 1; i++) ctx.quadraticCurveTo(x[i] + ox, y[i] + oy, (x[i] + x[i + 1]) / 2 + ox, (y[i] + y[i + 1]) / 2 + oy);
    ctx.lineTo(x[n - 1] + ox, y[n - 1] + oy);
  }
  function draw(now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // A faint cast shadow lifts the thread off the colour plate.
    ctx.strokeStyle = 'rgba(23, 20, 15, .22)';
    ctx.lineWidth = 1.1;
    for (const s of strands) { trace(s, .9, 1.6); ctx.stroke(); }
    for (const s of strands) {
      const active = s.target < 1;
      if (s.kind === 'span') {
        ctx.strokeStyle = `rgba(196, 31, 31, ${active ? 1 : s.core ? .88 : .6})`;
        ctx.lineWidth = active ? 1.25 : s.core ? 1.25 : .85;
      } else if (s.base) {
        ctx.strokeStyle = 'rgba(196, 31, 31, .8)';
        ctx.lineWidth = .9;
      } else {
        ctx.strokeStyle = mix(FRESH, DRIED, Math.min(1, (now - s.born) / DRY_MS));
        ctx.lineWidth = .9;
      }
      trace(s);
      ctx.stroke();
    }
    // Pin heads: only where something hangs or is slung.
    const used = new Set(strands.flatMap(s => s.b ? [s.a, s.b] : [s.a]));
    for (const key of used) {
      const [px, py] = at(key);
      ctx.beginPath(); ctx.arc(px, py, 4, 0, 6.283); ctx.fillStyle = 'rgba(244, 243, 239, .95)'; ctx.fill();
      ctx.beginPath(); ctx.arc(px, py, 2.6, 0, 6.283); ctx.fillStyle = '#c41f1f'; ctx.fill();
    }
  }

  /* ---------- loop ---------- */
  function tick(now) {
    frame = 0;
    if (!visible) { running = false; return; }
    step();
    draw(now);
    const drying = strands.some(s => s.kind === 'hang' && !s.base && now - s.born < DRY_MS);
    calm = energy() < .02 && !pointer.inside && !drying ? calm + 1 : 0;
    if (calm > 45) { running = false; return; }
    frame = requestAnimationFrame(tick);
  }
  function wake() {
    calm = 0;
    if (reduced) { settle(); return; }
    if (!running && visible) { running = true; frame = requestAnimationFrame(tick); }
  }
  function settle() {
    for (let i = 0; i < 240; i++) step();
    draw(performance.now() + DRY_MS);
  }

  /* ---------- sync with the Lectio ---------- */
  function sync() {
    const live = strands.filter(s => s.kind === 'hang' && !s.base && !s.dying);
    const want = Math.min(MAX_CUT_THREADS, wantedCuts);
    let total = strands.filter(s => s.kind === 'hang' && !s.base).length;
    for (let i = live.length; i < want; i++) addHang(total++, false);
    for (let i = live.length - 1; i >= want; i--) live[i].dying = true;
    wake();
  }
  document.addEventListener('lectio:cut', event => { wantedCuts = event.detail.count; sync(); });
  document.addEventListener('lectio:suture', () => { wantedCuts = 0; sync(); });

  /* ---------- input ---------- */
  field.addEventListener('pointermove', event => {
    const rect = field.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    if (pointer.inside) { pointer.vx = x - pointer.x; pointer.vy = y - pointer.y; }
    pointer.x = x; pointer.y = y; pointer.inside = true;
    if (!field.classList.contains('is-registering') && event.pointerType === 'mouse') {
      field.style.setProperty('--mx', `${(5 + (x / W - .5) * 8).toFixed(1)}px`);
      field.style.setProperty('--my', `${(3 + (y / H - .5) * 6).toFixed(1)}px`);
    }
    wake();
  });
  field.addEventListener('pointerleave', () => { pointer.inside = false; pointer.x = pointer.y = -1e4; });

  for (const card of field.querySelectorAll('[data-thread]')) {
    const group = card.dataset.thread;
    const pull = on => { for (const s of strands) if (s.group === group) s.target = on ? .3 : 1; wake(); };
    card.addEventListener('pointerenter', () => pull(true));
    card.addEventListener('pointerleave', () => pull(document.activeElement === card));
    card.addEventListener('focus', () => pull(true));
    card.addEventListener('blur', () => pull(false));
  }

  // The plate lags behind the page for a moment as it scrolls, so the threads swing.
  addEventListener('scroll', () => {
    const delta = Math.max(-50, Math.min(50, scrollY - lastScroll));
    lastScroll = scrollY;
    if (!visible || reduced) return;
    for (const s of strands) for (let i = 1; i < s.n; i++) s.py[i] += delta * .1 * (i / s.n);
    wake();
  }, { passive: true });

  new IntersectionObserver(entries => {
    visible = entries.some(e => e.isIntersecting);
    if (visible) wake();
  }).observe(field);

  function layout() {
    const old = { ...pins };
    measure();
    // Loose threads travel with their pin; slung bundles are re-hung.
    for (const s of strands) {
      if (s.kind !== 'hang' || !old[s.a]) continue;
      const dx = pins[s.a][0] - old[s.a][0], dy = pins[s.a][1] - old[s.a][1];
      for (let i = 0; i < s.n; i++) { s.x[i] += dx; s.px[i] += dx; s.y[i] += dy; s.py[i] += dy; }
    }
    buildSpans();
    reduced ? settle() : (draw(performance.now()), wake());
  }

  let resizeFrame = 0;
  const onResize = () => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(layout); };
  (document.fonts?.ready || Promise.resolve()).then(() => {
    measure();
    buildSpans();
    for (let i = 0; i < 7; i++) addHang(i, true);
    reduced ? settle() : wake();
    new ResizeObserver(onResize).observe(field);
    // Bring the vermilion plate into register with the ink.
    setTimeout(() => field.classList.remove('is-registering'), reduced ? 0 : 350);
  });
})();
