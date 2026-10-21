// Threads on the index plate: Verlet-integrated red threads slung between the pinned labels.
// Every glyph cut in the Lectio below adds one more strand to a bundle; strands added while the
// reader is down in the text are hung taut and fall slack when the plate is seen again.
(() => {
  const field = document.querySelector('.field');
  const canvas = field?.querySelector('.thread-canvas');
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const GRAVITY = .34, DAMPING = .985, SEGMENT = 14;
  // A small sheet has short routes; it holds fewer strands and finer twists before bundles turn to rope.
  const maxAdded = () => (W <= 700 ? 36 : 160);
  const scale = () => Math.max(.45, Math.min(1, W / 1200));
  // Dye lots: the same red never comes off the spool twice.
  const DYES = [[196, 31, 31], [178, 22, 30], [210, 48, 38], [158, 20, 28], [188, 36, 44]];
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
  let added = 0, serial = 0;
  let visible = true, running = false, time = 0;
  let lastScroll = scrollY;
  const pointer = { x: -1e4, y: -1e4, vx: 0, vy: 0, inside: false };
  const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  // Shadows are drawn small and scaled up: the resampling softens them like a blur, for almost nothing.
  const shade = document.createElement('canvas');
  const sctx = shade.getContext('2d');
  const SHADE = 1 / 3;

  /* ---------- geometry ---------- */
  function measure() {
    const rect = field.getBoundingClientRect();
    W = rect.width; H = rect.height;
    dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    shade.width = Math.max(1, Math.round(W * SHADE));
    shade.height = Math.max(1, Math.round(H * SHADE));
    pins = {};
    for (const el of field.querySelectorAll('[data-pin]')) {
      const r = el.getBoundingClientRect();
      pins[el.dataset.pin] = [r.left - rect.left + r.width / 2, r.top - rect.top + r.height / 2];
    }
    const narrow = W <= 700;
    pins.edge = [W * (narrow ? .95 : .96), H * (narrow ? .82 : .04)];
  }
  // Threads are tied on along the label's edge, not into a single point.
  const tie = (key, seed) => {
    const [x, y] = pins[key] || [0, 0];
    if (key === 'edge') return [x + (hash(seed) - .5) * 8, y + (hash(seed + 1) - .5) * 8];
    return [x + (hash(seed) - .5) * 3, y + (hash(seed + 1) - .5) * 22];
  };

  function routeSag(a, b) {
    const [ax, ay] = pins[a] || [0, 0], [bx, by] = pins[b] || [0, 0];
    const L = Math.hypot(bx - ax, by - ay) || 1;
    const horizontal = Math.abs(bx - ax) / L;
    return Math.min(W <= 700 ? 66 : 145, 20 + L * .2) * (.5 + horizontal * .5);
  }

  function makeStrand(route, id, sagFactor, extra = {}) {
    const [group, a, b] = route;
    const oa = tie(a, id * 7.1), ob = tie(b, id * 3.7 + 40);
    const L = Math.hypot(ob[0] - oa[0], ob[1] - oa[1]) || 1;
    const sag = routeSag(a, b) * sagFactor;
    const rest = L + 8 * sag * sag / (3 * L);
    const n = Math.max(10, Math.min(48, Math.round(rest / SEGMENT)));
    const dye = DYES[Math.floor(hash(id + 91) * DYES.length)];
    const s = {
      group, a, b, rest, n, id, seg: rest / (n - 1),
      ta: [oa[0] - pins[a][0], oa[1] - pins[a][1]], tb: [ob[0] - pins[b][0], ob[1] - pins[b][1]],
      x: new Float32Array(n), y: new Float32Array(n), px: new Float32Array(n), py: new Float32Array(n),
      tension: 1, target: 1, alpha: 1,
      width: .55 + Math.pow(hash(id + 13), 2) * .75,
      opacity: .5 + hash(id + 29) * .42,
      dye,
      // A loose twist with its neighbours, as in a hand-wound cord.
      twist: (1 + hash(id + 47) * 2.6) * scale(), turns: 1.5 + hash(id + 53) * 3, phase: hash(id + 59) * 6.283,
      drift: hash(id + 61) * 6.283,
      ...extra
    };
    const start = extra.taut && !reduced ? 0 : sag;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      s.x[i] = oa[0] + (ob[0] - oa[0]) * t;
      s.y[i] = oa[1] + (ob[1] - oa[1]) * t + 4 * start * t * (1 - t);
    }
    s.px.set(s.x); s.py.set(s.y);
    return s;
  }

  // Slack is drawn from a bundle-like spread: most strands hang together, a few hang loose.
  const slack = id => {
    const near = .62 + (hash(id + 3) + hash(id + 5) + hash(id + 9)) / 3 * .62;
    return hash(id + 17) > .88 ? near + .35 + hash(id + 19) * .3 : near;
  };

  function addedStrand(k, taut) {
    const route = ROUTES[Math.floor(hash(k * 1.3 + 400) * ROUTES.length)];
    return makeStrand(route, 1000 + k, slack(1000 + k), { added: true, k, taut });
  }

  function build() {
    strands = [];
    serial = 0;
    for (const route of ROUTES) {
      for (let i = 0; i < route[3]; i++) { serial++; strands.push(makeStrand(route, serial, slack(serial))); }
    }
    for (let k = 0; k < Math.min(added, maxAdded()); k++) strands.push(addedStrand(k, false));
  }

  /* ---------- simulation ---------- */
  function step() {
    time += 1;
    const R = 56, R2 = R * R;
    // A faint draught through the room: two slow swells that never quite repeat.
    const gust = reduced ? 0 : .018 * (Math.sin(time * .011) + .6 * Math.sin(time * .027 + 1.3) + .3 * Math.sin(time * .061 + 4));
    for (const s of strands) {
      const { x, y, px, py, n } = s;
      s.tension += (s.target - s.tension) * .08;
      const straight = Math.hypot(x[n - 1] - x[0], y[n - 1] - y[0]);
      s.seg = (straight + (s.rest - straight) * s.tension) / (n - 1);
      if (s.leaving) s.alpha -= .035;
      const sway = gust * (.7 + .6 * Math.sin(s.drift + time * .004));
      for (let i = 1; i < n - 1; i++) {
        const vx = (x[i] - px[i]) * DAMPING, vy = (y[i] - py[i]) * DAMPING;
        px[i] = x[i]; py[i] = y[i];
        const belly = Math.sin(Math.PI * i / (n - 1));
        x[i] += vx + sway * belly;
        y[i] += vy + GRAVITY;
        if (pointer.inside) {
          // Brushing through threads: they are carried by the hand's motion, and part around the fingertip.
          const dx = x[i] - pointer.x, dy = y[i] - pointer.y, d2 = dx * dx + dy * dy;
          if (d2 < R2) {
            const d = Math.sqrt(d2) || .001, f = 1 - d / R;
            x[i] += pointer.vx * f * .32;
            y[i] += pointer.vy * f * .22;
            if (d < 10) { x[i] += dx / d * (10 - d) * .5; y[i] += dy / d * (10 - d) * .5; }
          }
        }
      }
      const pa = pins[s.a], pb = pins[s.b];
      const ax = pa[0] + s.ta[0], ay = pa[1] + s.ta[1], bx = pb[0] + s.tb[0], by = pb[1] + s.tb[1];
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
    pointer.vx *= .55; pointer.vy *= .55;
  }

  /* ---------- drawing ---------- */
  // The rendered path carries the twist and, for the shadow, the throw away from the plate.
  const rx = new Float32Array(64), ry = new Float32Array(64);
  function shape(s, shadow, fresh = true, c = ctx) {
    const { x, y, n } = s;
    const k = scale();
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), belly = Math.sin(Math.PI * t);
      const j = Math.min(n - 1, i + 1), h = Math.max(0, i - 1);
      let tx = x[j] - x[h], ty = y[j] - y[h];
      const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      const off = s.twist * Math.sin(t * Math.PI * s.turns + s.phase) * belly;
      rx[i] = x[i] - ty * off;
      ry[i] = y[i] + tx * off;
      if (shadow) {
        // The further the thread falls from the plate, the further and softer its shadow.
        rx[i] += (1 + belly * 5) * k;
        ry[i] += (2 + belly * 9) * k;
      }
    }
    if (fresh) c.beginPath();
    c.moveTo(rx[0], ry[0]);
    for (let i = 1; i < n - 1; i++) c.quadraticCurveTo(rx[i], ry[i], (rx[i] + rx[i + 1]) / 2, (ry[i] + ry[i + 1]) / 2);
    c.lineTo(rx[n - 1], ry[n - 1]);
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    sctx.setTransform(SHADE, 0, 0, SHADE, 0, 0);
    sctx.clearRect(0, 0, W, H);
    sctx.lineCap = 'round';
    sctx.beginPath();
    for (const s of strands) shape(s, true, false, sctx);
    sctx.strokeStyle = `rgba(23, 20, 15, ${(.22 * scale()).toFixed(3)})`;
    sctx.lineWidth = 2.4;
    sctx.stroke();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(shade, 0, 0, W, H);

    // Back to front by weight, so finer strands sit behind the heavier ones.
    const order = strands.slice().sort((p, q) => p.width - q.width);
    for (const s of order) {
      const active = s.target < 1;
      const [r, g, b] = s.dye;
      shape(s, false);
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${(active ? 1 : s.opacity) * s.alpha})`;
      ctx.lineWidth = active ? s.width + .35 : s.width;
      ctx.stroke();
      if (s.width > .95) {
        // Silk catches the light along the top of a heavier strand.
        ctx.save();
        ctx.translate(-.25, -.35);
        ctx.strokeStyle = `rgba(255, 196, 180, ${.32 * s.alpha})`;
        ctx.lineWidth = .35;
        ctx.stroke();
        ctx.restore();
      }
    }

    // Pins: a lacquered head with a small highlight.
    for (const key of new Set(strands.flatMap(s => [s.a, s.b]))) {
      const [px, py] = pins[key] || [0, 0];
      ctx.beginPath(); ctx.arc(px + .8, py + 1.4, 4.2, 0, 6.283); ctx.fillStyle = 'rgba(23, 20, 15, .18)'; ctx.fill();
      ctx.beginPath(); ctx.arc(px, py, 3.6, 0, 6.283); ctx.fillStyle = '#a8181d'; ctx.fill();
      ctx.beginPath(); ctx.arc(px - 1.1, py - 1.2, 1.1, 0, 6.283); ctx.fillStyle = 'rgba(255, 220, 210, .85)'; ctx.fill();
    }
  }

  /* ---------- loop ---------- */
  // The draught keeps the threads breathing while the plate is on screen; otherwise everything sleeps.
  function tick() {
    if (!visible || document.hidden) { running = false; return; }
    step();
    draw();
    requestAnimationFrame(tick);
  }
  function wake() {
    if (reduced) { settle(); return; }
    if (!running && visible && !document.hidden) { running = true; requestAnimationFrame(tick); }
  }
  function settle() {
    for (let i = 0; i < 260; i++) step();
    draw();
  }

  /* ---------- sync with the Lectio ---------- */
  function setAdded(count) {
    const want = Math.min(maxAdded(), count);
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
    for (const s of strands) for (let i = 1; i < s.n - 1; i++) s.py[i] += delta * .07 * Math.sin(Math.PI * i / (s.n - 1));
  }, { passive: true });

  new IntersectionObserver(entries => {
    visible = entries.some(e => e.isIntersecting);
    if (visible) wake();
  }).observe(field);
  document.addEventListener('visibilitychange', wake);

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
