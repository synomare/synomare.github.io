// Lectio: every glyph is a specimen. Tracing over a glyph opens (dilates) it; tracing again closes it.
(() => {
  const root = document.querySelector('.copy');
  if (!root) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 1. split text into glyph spans, keeping 禁則 and Latin words intact ---------- */
  const noStart = '、。，．！？!?,.:;：；）」』】〕〉》〙〗’”ー…‥・ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ々〻';
  const noEnd = '（「『【〔〈《〘〖‘“(';
  const punct = '、。，．！？・：；（）［］｛｝「」『』—…‥,.!?;:(){}[]–';
  const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('ja', { granularity: 'grapheme' }) : null;
  const graphemes = text => segmenter ? Array.from(segmenter.segment(text), s => s.segment) : Array.from(text);
  const classify = cp => {
    if ((cp >= 0x41 && cp <= 0x24f) || (cp >= 0x30 && cp <= 0x39)) return 'latin';
    if (cp >= 0x3040 && cp <= 0x309f) return 'hira';
    if (cp >= 0x30a0 && cp <= 0x30ff) return 'kata';
    if (cp >= 0x4e00 && cp <= 0x9fff) return 'kanji';
    return 'other';
  };
  const hash = (seed, k, m) => (Math.abs(Math.sin(seed * k)) * m) % 1;
  const quant = (x, step) => Math.round(x / step) * step;

  function intentFactor(start) {
    let ax = 1, ay = 1, at = 1;
    for (let el = start; el && el !== root; el = el.parentNode) {
      if (el.classList?.contains('muted')) { ax *= .75; ay *= .8; at *= .8; }
      if (el.nodeName === 'A') { ax *= .95; ay *= .95; }
    }
    return { ax, ay, at };
  }

  function makeGlyph(ch, j, index, factor) {
    const cp = ch.codePointAt(0);
    const cls = classify(cp);
    const isPunct = punct.includes(ch);
    const seed = (j + 1) * (cp + 1);
    const r1 = hash(seed, 12.9898, 43758.5453), r2 = hash(seed, 78.233, 96485.3321);
    const r3 = hash(seed, 192.456, 83521.123), r4 = hash(seed, 421.887, 274922.522);
    let sx0 = .78, sxr = .56, sy0 = .82, syr = .4;
    if (isPunct) { sx0 = .97; sxr = .06; sy0 = .97; syr = .06; }
    else if (cls === 'latin') { sx0 = .86; sxr = .38; sy0 = .88; syr = .3; }
    else if (cls === 'hira' || cls === 'kata') { sx0 = .76; sxr = .52; sy0 = .84; syr = .36; }
    else if (cls === 'kanji') { sx0 = .72; sxr = .56; sy0 = .8; syr = .4; }
    const span = document.createElement('span');
    span.className = 'c' + (isPunct ? ' punct' : '') + (cls === 'latin' ? ' latin' : '');
    span.textContent = ch;
    span.style.setProperty('--sx', quant(sx0 + sxr * factor.ax * r1, .005).toFixed(3));
    span.style.setProperty('--sy', quant(sy0 + syr * factor.ay * r2, .005).toFixed(3));
    span.style.setProperty('--tx', quant((r1 - .5) * .026 * factor.ax, .002).toFixed(3) + 'em');
    span.style.setProperty('--ty', quant((r2 - .5) * .056 * factor.at, .002).toFixed(3) + 'em');
    span.style.setProperty('--i', index);
    const geo = r3 > .68;
    return {
      el: span, latin: cls === 'latin',
      seedX: r1 * 2 - 1, seedY: r2 * 2 - 1, mode: geo ? 'geo' : 'organic',
      stepX: geo ? .22 + r3 * .28 : .16 + r3 * .1,
      stepY: geo ? .26 + r4 * .32 : .2 + r4 * .12,
      blend: geo ? .58 + r4 * .24 : .18 + r4 * .2
    };
  }

  const glyphs = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const factor = intentFactor(node.parentNode);
    const frag = document.createDocumentFragment();
    let group = null, holdOpen = false;
    const flush = () => {
      if (!group) return;
      if (group.length === 1) frag.append(group[0]);
      else { const nb = document.createElement('span'); nb.className = 'nb'; nb.append(...group); frag.append(nb); }
      group = null;
    };
    graphemes(node.nodeValue).forEach((ch, j) => {
      if (/\s/.test(ch)) { flush(); holdOpen = false; frag.append(ch); return; }
      const glyph = makeGlyph(ch, j, glyphs.length, factor);
      glyphs.push(glyph);
      const prev = group && group[group.length - 1];
      const joinLatin = glyph.latin && prev?.classList.contains('latin');
      if (group && (holdOpen || noStart.includes(ch) || joinLatin)) group.push(glyph.el);
      else { flush(); group = [glyph.el]; }
      holdOpen = noEnd.includes(ch);
    });
    flush();
    node.parentNode.replaceChild(frag, node);
  }

  /* ---------- 2. the incision counter and suture ---------- */
  const countEl = document.getElementById('cutCount');
  const totalEl = document.getElementById('glyphTotal');
  const suture = document.getElementById('suture');
  let cut = 0;
  const pad = n => String(n).padStart(3, '0');
  if (totalEl) totalEl.textContent = pad(glyphs.length);
  function setCut(glyph, on) {
    if (glyph.toggled === on) return;
    glyph.toggled = on;
    cut += on ? 1 : -1;
    if (countEl) countEl.textContent = pad(cut);
    if (suture) suture.disabled = cut === 0;
    document.dispatchEvent(new CustomEvent('lectio:cut', { detail: { count: cut } }));
  }

  /* ---------- 3. pointer lens ---------- */
  const pointer = { x: 0, y: 0, targetX: 0, targetY: 0, active: false, type: 'mouse' };
  let metricsDirty = true, raf = 0, activePointerId = null, touched = false;

  function measure() {
    const sx = scrollX, sy = scrollY;
    for (const g of glyphs) {
      const r = g.el.getBoundingClientRect();
      g.absX = r.left + r.width / 2 + sx;
      g.absY = r.top + r.height / 2 + sy;
      g.intensity ??= 0;
      g.hovered ??= false;
    }
    metricsDirty = false;
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };
  const scheduleMeasure = () => { metricsDirty = true; schedule(); };

  function stretchFor(g) {
    const t = g.intensity, dir = g.seedX * .5;
    let x = 1 + t * (1.48 + g.seedX * .85 + dir * .42);
    let y = 1 + t * (1.82 + g.seedY * 1.05 - dir * .36);
    const stepped = (v, s) => 1 + Math.round((v - 1) / s) * s;
    if (g.mode === 'geo') {
      const b = Math.min(.94, Math.max(.42, g.blend + t * .35));
      x = x * (1 - b) + stepped(x, g.stepX) * b + (g.seedX * .12 + g.seedY * .08) * t;
      y = y * (1 - b) + stepped(y, g.stepY) * b + (g.seedY * .14 - g.seedX * .05) * t;
    } else {
      const b = Math.max(0, Math.min(.55, g.blend * t));
      if (b > .02) { x = x * (1 - b) + stepped(x, g.stepX) * b; y = y * (1 - b) + stepped(y, g.stepY) * b; }
    }
    return [Math.min(8, Math.max(1, x)), Math.min(9, Math.max(1, y))];
  }

  function update() {
    raf = 0;
    if (metricsDirty) measure();
    pointer.x += (pointer.targetX - pointer.x) * .22;
    pointer.y += (pointer.targetY - pointer.y) * .22;
    const radius = pointer.type === 'touch' ? 60 : 45, rsq = radius * radius;
    const sx = scrollX, sy = scrollY;
    let moving = pointer.active;
    for (const g of glyphs) {
      if (pointer.active) {
        const dx = pointer.x - (g.absX - sx), dy = pointer.y - (g.absY - sy);
        if (dx * dx + dy * dy < rsq) { if (!g.hovered) { g.hovered = true; setCut(g, !g.toggled); } }
        else g.hovered = false;
      }
      const target = g.toggled ? 1 : 0;
      g.intensity += (target - g.intensity) * .08;
      if (Math.abs(target - g.intensity) < .001) g.intensity = target;
      if (g.intensity === 0) {
        if (g.styled) { g.el.style.removeProperty('--ix'); g.el.style.removeProperty('--iy'); g.styled = false; }
        continue;
      }
      if (g.intensity !== target) moving = true;
      const [ix, iy] = stretchFor(g);
      g.el.style.setProperty('--ix', ix.toFixed(3));
      g.el.style.setProperty('--iy', iy.toFixed(3));
      g.styled = true;
    }
    if (moving) schedule();
  }

  const fromEvent = e => { pointer.targetX = e.clientX; pointer.targetY = e.clientY; if (e.pointerType) pointer.type = e.pointerType; };
  root.addEventListener('pointerenter', e => { touched = true; fromEvent(e); pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true; schedule(); });
  root.addEventListener('pointermove', e => {
    if (activePointerId !== null && e.pointerId !== activePointerId && e.pointerType !== 'mouse') return;
    fromEvent(e);
    if (e.pointerType === 'mouse') pointer.active = true;
    schedule();
  });
  root.addEventListener('pointerdown', e => {
    touched = true;
    activePointerId = e.pointerId;
    fromEvent(e);
    pointer.x = e.clientX; pointer.y = e.clientY;
    pointer.active = true;
    if (e.pointerType === 'touch') { try { root.setPointerCapture(e.pointerId); } catch (err) { } }
    schedule();
  });
  const end = e => {
    if (activePointerId !== null && e.pointerId !== activePointerId && e.pointerType !== 'mouse') return;
    if (e.pointerId === activePointerId) activePointerId = null;
    pointer.active = false;
    for (const g of glyphs) g.hovered = false;
    schedule();
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
  root.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') end(e); });

  suture?.addEventListener('click', () => {
    for (const g of glyphs) setCut(g, false);
    document.dispatchEvent(new CustomEvent('lectio:suture'));
    schedule();
  });

  addEventListener('resize', scheduleMeasure, { passive: true });
  document.fonts?.ready.then(scheduleMeasure);
  document.fonts?.addEventListener?.('loadingdone', scheduleMeasure);

  /* ---------- 4. one demonstrative incision across § I when it first comes into view ---------- */
  const first = root.querySelector('p');
  if (!reduced && first && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return;
      io.disconnect();
      setTimeout(() => {
        if (touched) return;
        metricsDirty = true;
        const r = first.getBoundingClientRect();
        const y = r.top + Math.min(r.height, 60) * .5;
        const x0 = r.left, x1 = r.left + r.width * .42, t0 = performance.now(), dur = 1300;
        pointer.type = 'mouse';
        pointer.x = pointer.targetX = x0; pointer.y = pointer.targetY = y;
        pointer.active = true;
        const step = now => {
          if (touched) return;
          const t = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - t, 3);
          pointer.targetX = x0 + (x1 - x0) * e;
          pointer.targetY = y + Math.sin(e * Math.PI * 2) * 6;
          schedule();
          if (t < 1) requestAnimationFrame(step);
          else { pointer.active = false; for (const g of glyphs) g.hovered = false; schedule(); }
        };
        requestAnimationFrame(step);
      }, 1400);
    }, { threshold: .45 });
    io.observe(first);
  }
})();
