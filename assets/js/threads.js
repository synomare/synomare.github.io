// Threads on the index plate: Verlet-integrated red threads slung between the pinned labels.
// Every glyph cut in the Lectio below adds one more strand to a bundle; strands added while the
// reader is down in the text are hung taut and fall slack when the plate is seen again.
(() => {
  const field = document.querySelector('.field');
  const canvas = field?.querySelector('.thread-canvas');
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const GRAVITY = .34, DAMPING = .986, SEGMENT = 15, MAX_ADDED = 160;
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
  let added = 0;
  let visible = true, running = false, calm = 0;
  let lastScroll = scrollY;
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
  }
  const at = key => pins[key] || [0, 0];

  // The natural sag of a route, as the original plate drew it; arc length follows from the sag.
  function routeSag(a, b) {
    const [ax, ay] = at(a), [bx, by] = at(b);
    const L = Math.hypot(bx - ax, by - ay) || 1;
    const horizontal = Math.abs(bx - ax) / L;
    return { L, base: Math.min(W <= 700 ? 66 : 145, 20 + L * .2) * (.5 + horizontal * .5) };
  }

  function makeStrand(route, sag, extra) {
    const [group, a, b] = route;
    const [ax, ay] = at(a), [bx, by] = at(b);
    const L = Math.hypot(bx - ax, by - ay) || 1;
    const rest = L + 8 * sag * sag / (3 * L);
    const n = Math.max(8, Math.min(46, Math.round(rest / SEGMENT)));
    const s = { group, a, b, rest, straight: L, n, seg: rest / (n - 1), x: new Float32Array(n), y: new Float32Array(n), px: new Float32Array(n), py: new Float32Array(n), tension: 1, target: 1, alpha: 1, ...extra };
    // Hung taut (a fresh strand) or already resting on its parabola.
    const start = extra.taut && !reduced ? 0 : sag;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      s.x[i] = ax + (bx - ax) * t;
      s.y[i] = ay + (by - ay) * t + 4 * start * t * (1 - t);
    }
    s.px.set(s.x); s.py.set(s.y);
    return s;
  }

  function addedStrand(k, taut) {
    const route = ROUTES[k % ROUTES.length];
    const { base } = routeSag(route[1], route[2]);
    // Each added strand takes its own slack, a little looser or tighter than the bundle.
    const sag = base * (.45 + hash(k + 3) * 1.05);
    return makeStrand(route, sag, { added: true, k, taut, weight: .45 + hash(k + 7) * .3 });
  }

  function build() {
    strands = [];
    ROUTES.forEach((route, r) => {
      const [, a, b, count] = route;
      const { base } = routeSag(a, b);
      for (let i = 0; i < count; i++) {
        // Unequal slack gives each strand its own fall between shared pins.
        const variation = Math.sin(i * 2.17 + r * 1.41);
        const sag = base * (.65 + i / (count - 1) * .68 + variation * .09);
        strands.push(makeStrand(route, sag, { core: i === Math.floor(count / 2) }));
      }
    });
    for (let k = 0; k < Math.min(added, MAX_ADDED); k++) strands.push(addedStrand(k, false));
  }

  /* ---------- simulation ---------- */
  function step() {
    const R = 80, R2 = R * R;
    for (const s of strands) {
      const { x, y, px, py, n } = s;
      // Hovered bundles draw taut; released ones fall slack again.
      s.tension += (s.target - s.tension) * .08;
      s.seg = (s.straight + (s.rest - s.straight) * s.tension) / (n - 1);
      if (s.leaving) s.alpha -= .04;
      for (let i = 1; i < n - 1; i++) {
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
      const [ax, ay] = at(s.a), [bx, by] = at(s.b);
      for (let k = 0; k < 8; k++) {
        x[0] = ax; y[0] = ay; x[n - 1] = bx; y[n - 1] = by;
        for (let i = 0; i < n - 1; i++) {
          const dx = x[i + 1] - x[i], dy = y[i + 1] - y[i];
          const d = Math.sqrt(dx * dx + dy * dy) || .0001;
          const diff = (d - s.seg) / d;
          if (i === 0) { x[1] -= dx * diff; y[1] -= dy * diff; }
          else if (i + 1 === n - 1) { x[i] += dx * diff; y[i] += dy * diff; }
          else { x[i] += dx * diff * .5; y[i] += dy * diff * .5; x[i + 1] -= dx * diff * .5; y[i + 1] -= dy * diff * .5; }
        }
      }
      x[0] = ax; y[0] = ay; x[n - 1] = bx; y[n - 1] = by;
    }
    strands = strands.filter(s => s.alpha > 0);
    pointer.vx *= .6; pointer.vy *= .6;
  }

  function energy() {
    let e = 0, count = 0;
    for (const s of strands) {
      for (let i = 1; i < s.n; i += 3) { e += Math.abs(s.x[i] - s.px[i]) + Math.abs(s.y[i] - s.py[i]); count++; }
      if (s.leaving || Math.abs(s.target - s.tension) > .01) e += 10;
    }
    return count ? e / count : 0;
  }

  /* ---------- drawing ---------- */
  function trace(s, ox = 0, oy = 0) {
    const { x, y, n } = s;
    ctx.beginPath();
    ctx.moveTo(x[0] + ox, y[0] + oy);
    for (let i = 1; i < n - 1; i++) ctx.quadraticCurveTo(x[i] + ox, y[i] + oy, (x[i] + x[i + 1]) / 2 + ox, (y[i] + y[i + 1]) / 2 + oy);
    ctx.lineTo(x[n - 1] + ox, y[n - 1] + oy);
  }
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // A faint cast shadow lifts the thread off the colour plate.
    ctx.lineWidth = 1.1;
    for (const s of strands) { ctx.strokeStyle = `rgba(23, 20, 15, ${.2 * s.alpha})`; trace(s, .9, 1.6); ctx.stroke(); }
    for (const s of strands) {
      const active = s.target < 1;
      const alpha = active ? 1 : s.added ? s.weight : s.core ? .88 : .6;
      ctx.strokeStyle = `rgba(196, 31, 31, ${alpha * s.alpha})`;
      ctx.lineWidth = active || s.core ? 1.25 : s.added ? .75 : .85;
      trace(s);
      ctx.stroke();
    }
    for (const key of new Set(strands.flatMap(s => [s.a, s.b]))) {
      const [px, py] = at(key);
      ctx.beginPath(); ctx.arc(px, py, 4, 0, 6.283); ctx.fillStyle = 'rgba(244, 243, 239, .95)'; ctx.fill();
      ctx.beginPath(); ctx.arc(px, py, 2.6, 0, 6.283); ctx.fillStyle = '#c41f1f'; ctx.fill();
    }
  }

  /* ---------- loop ---------- */
  function tick() {
    if (!visible) { running = false; return; }
    step();
    draw();
    calm = energy() < .02 && !pointer.inside ? calm + 1 : 0;
    if (calm > 45) { running = false; return; }
    requestAnimationFrame(tick);
  }
  function wake() {
    calm = 0;
    if (reduced) { settle(); return; }
    if (!running && visible) { running = true; requestAnimationFrame(tick); }
  }
  function settle() {
    for (let i = 0; i < 240; i++) step();
    draw();
  }

  /* ---------- sync with the Lectio ---------- */
  function setAdded(count) {
    const want = Math.min(MAX_ADDED, count);
    const live = strands.filter(s => s.added && !s.leaving).sort((p, q) => p.k - q.k);
    for (let k = live.length; k < want; k++) strands.push(addedStrand(k, true));
    for (let i = live.length - 1; i >= want; i--) live[i].leaving = true;
    added = count;
    wake();
  }
  document.addEventListener('lectio:cut', event => setAdded(event.detail.count));
  document.addEventListener('lectio:suture', () => setAdded(0));

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
    for (const s of strands) for (let i = 1; i < s.n - 1; i++) s.py[i] += delta * .08 * Math.sin(Math.PI * i / (s.n - 1));
    wake();
  }, { passive: true });

  new IntersectionObserver(entries => {
    visible = entries.some(e => e.isIntersecting);
    if (visible) wake();
  }).observe(field);

  function layout() {
    measure();
    build();
    reduced ? settle() : (draw(), wake());
  }
  let resizeFrame = 0;
  (document.fonts?.ready || Promise.resolve()).then(() => {
    layout();
    new ResizeObserver(() => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(layout); }).observe(field);
    // Bring the vermilion plate into register with the ink.
    setTimeout(() => field.classList.remove('is-registering'), reduced ? 0 : 350);
  });
})();
