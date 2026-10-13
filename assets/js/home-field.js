(() => {
  const field = document.querySelector('.field');
  const svg = field?.querySelector('.thread-field');
  if (!svg) return;
  const ns = 'http://www.w3.org/2000/svg';
  const cards = [...field.querySelectorAll('[data-thread]')];
  const groups = new Map();
  let frame;
  function draw() {
    const rect = field.getBoundingClientRect();
    const narrow = rect.width <= 700;
    const anchor = selector => {
      const r = field.querySelector(`${selector} .thread-pin`).getBoundingClientRect();
      return [r.left - rect.left + r.width / 2, r.top - rect.top + r.height / 2];
    };
    const hello = anchor('.intro');
    const notes = anchor('.tag-notes');
    const works = anchor('.tag-works');
    const gallery = anchor('.tag-gallery');
    const profile = anchor('.tag-profile');
    const links = anchor('.tag-links');
    const edge = [rect.width * (narrow ? .95 : .96), rect.height * (narrow ? .82 : .04)];
    const routes = [
      ['works', hello, works, narrow ? 8 : 24, 7],
      ['gallery', works, gallery, narrow ? 12 : 29, 6],
      ['gallery', hello, gallery, narrow ? -13 : -30, 4],
      ['notes', notes, profile, narrow ? 13 : 30, 7],
      ['links', links, notes, narrow ? 8 : -17, 5],
      ['profile', gallery, profile, narrow ? 9 : 18, 5],
      ['works', works, edge, 12, 5]
    ];
    svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
    svg.replaceChildren();
    groups.clear();
    for (const [routeIndex, [name, a, b, spread, count]] of routes.entries()) {
      const group = document.createElementNS(ns, 'g');
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const length = Math.hypot(dx, dy) || 1;
      const horizontal = Math.abs(dx) / length;
      const baseSag = Math.min(narrow ? 66 : 145, 20 + length * .2) * (.5 + horizontal * .5);
      const sideBow = (1 - horizontal) * (narrow ? 22 : 38) * (dx < 0 ? -1 : 1);
      for (let i = 0; i < count; i++) {
        // Unequal slack gives each strand its own fall between shared anchors.
        const variation = Math.sin(i * 2.17 + routeIndex * 1.41);
        const sag = baseSag * (.65 + i / (count - 1) * .68 + variation * .09);
        const offset = (i / (count - 1) - .5) * spread * .35;
        const c1 = [a[0] + dx * .28 - dy / length * offset + sideBow,
          a[1] + dy * .28 + sag * (.94 + variation * .08)];
        const c2 = [a[0] + dx * .72 - dy / length * offset * .35 + sideBow * .7,
          a[1] + dy * .72 + sag * (1.06 - variation * .06)];
        const line = document.createElementNS(ns, 'path');
        line.setAttribute('d', `M ${a[0]} ${a[1]} C ${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${b[0]} ${b[1]}`);
        if (i === Math.floor(count / 2)) line.setAttribute('class', 'thread-core');
        group.append(line);
      }
      svg.append(group);
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(group);
    }
    for (const [cx,cy] of [edge]) {
      const dot = document.createElementNS(ns,'circle');
      dot.setAttribute('cx',cx); dot.setAttribute('cy',cy); dot.setAttribute('r','2.5'); svg.append(dot);
    }
  }
  function schedule() { cancelAnimationFrame(frame); frame = requestAnimationFrame(draw); }
  for (const card of cards) {
    const highlight = active => (groups.get(card.dataset.thread) || []).forEach(group => group.classList.toggle('is-active',active));
    card.addEventListener('pointerenter',()=>highlight(true));
    card.addEventListener('pointerleave',()=>highlight(document.activeElement === card));
    card.addEventListener('focus',()=>highlight(true));
    card.addEventListener('blur',()=>highlight(false));
  }
  new ResizeObserver(schedule).observe(field);
  document.fonts?.ready.then(schedule);
  schedule();
})();
