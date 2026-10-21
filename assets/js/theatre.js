// Tabula I: dissection lens, lettered leaders and the off-register name.
(() => {
  const theatre = document.querySelector('.theatre');
  const plate = theatre?.querySelector('.specimen');
  if (!plate) return;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = theatre.querySelector('.leaders');
  const ghost = theatre.querySelector('.ghost');
  const readKey = document.getElementById('readKey');
  const readPos = document.getElementById('readPos');
  const entries = [...theatre.querySelectorAll('.legend a[data-key]')];
  const markers = new Map([...plate.querySelectorAll('.marker')].map(m => [m.dataset.key, m]));
  const lines = new Map();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let frame = 0;
  let touchTimer = 0;

  function setLens(x, y, label) {
    const w = plate.clientWidth, h = plate.clientHeight;
    plate.style.setProperty('--lx', `${x}px`);
    plate.style.setProperty('--ly', `${y}px`);
    readPos.textContent = `x ${(x / w).toFixed(3).replace(/^0/, '')} · y ${(y / h).toFixed(3).replace(/^0/, '')}`;
    readKey.textContent = label || 'Tab. I';
  }

  function nearestLabel(x, y) {
    let best = null, bestDist = 48 * 48;
    for (const [key, marker] of markers) {
      const dx = marker.offsetLeft - x, dy = marker.offsetTop - y;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) { bestDist = dist; best = key; }
    }
    return best ? entryFor(best)?.querySelector('.lat')?.textContent : '';
  }

  const entryFor = key => entries.find(entry => entry.dataset.key === key);

  function activate(key, on) {
    entryFor(key)?.classList.toggle('is-active', on);
    markers.get(key)?.classList.toggle('is-active', on);
    lines.get(key)?.classList.toggle('is-active', on);
  }

  // Pointing from the explicatio: the glass travels to the lettered part.
  function point(key) {
    const marker = markers.get(key);
    if (!marker) return;
    plate.classList.add('is-pointing', 'is-lensed');
    setLens(marker.offsetLeft, marker.offsetTop, entryFor(key)?.querySelector('.lat')?.textContent);
    activate(key, true);
  }

  function release(key) {
    activate(key, false);
    if (!plate.matches(':hover')) plate.classList.remove('is-lensed');
  }

  for (const entry of entries) {
    const key = entry.dataset.key;
    entry.addEventListener('pointerenter', () => point(key));
    entry.addEventListener('pointerleave', () => release(key));
    entry.addEventListener('focus', () => point(key));
    entry.addEventListener('blur', () => release(key));
  }
  for (const [key, marker] of markers) {
    marker.addEventListener('pointerenter', () => activate(key, true));
    marker.addEventListener('pointerleave', () => activate(key, false));
  }

  plate.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
    const rect = plate.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    plate.classList.remove('is-pointing');
    plate.classList.add('is-lensed');
    setLens(x, y, nearestLabel(x, y));
  });
  plate.addEventListener('pointerleave', event => {
    if (event.pointerType === 'mouse' || event.pointerType === 'pen') plate.classList.remove('is-lensed');
  });
  // On touch, a tap lays the glass on the plate for a moment.
  plate.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch' || event.target.closest('.marker')) return;
    const rect = plate.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    plate.classList.remove('is-pointing');
    setLens(x, y, nearestLabel(x, y));
    plate.classList.add('is-lensed');
    clearTimeout(touchTimer);
    touchTimer = setTimeout(() => plate.classList.remove('is-lensed'), 1800);
  });

  // The red pull drifts against the black as the pointer crosses the sheet.
  if (ghost && !reduced) {
    theatre.addEventListener('pointermove', event => {
      if (event.pointerType !== 'mouse') return;
      const rect = theatre.getBoundingClientRect();
      const nx = (event.clientX - rect.left) / rect.width - .5;
      const ny = (event.clientY - rect.top) / rect.height - .5;
      ghost.style.setProperty('--mx', `${(3 + nx * 9).toFixed(1)}px`);
      ghost.style.setProperty('--my', `${(-2 + ny * 7).toFixed(1)}px`);
    });
  }

  function drawLeaders() {
    if (!svg) return;
    const box = theatre.getBoundingClientRect();
    const plateBox = plate.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    svg.replaceChildren();
    lines.clear();
    const sideBySide = entries.length && entries[0].getBoundingClientRect().right < plateBox.left;
    if (!sideBySide) return;
    const elbow = plateBox.left - box.left - 12;
    for (const entry of entries) {
      const marker = markers.get(entry.dataset.key);
      if (!marker) continue;
      const er = entry.getBoundingClientRect(), mr = marker.getBoundingClientRect();
      const sx = er.right - box.left + 6, sy = er.top - box.top + er.height / 2;
      const mx = mr.left - box.left + mr.width / 2, my = mr.top - box.top + mr.height / 2;
      // Stop at the rim of the marker so the line meets, not crosses, the letter.
      const dx = mx - elbow, dy = my - sy, len = Math.hypot(dx, dy) || 1;
      const ex = mx - dx / len * (mr.width / 2), ey = my - dy / len * (mr.height / 2);
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', `M ${sx} ${sy} H ${elbow} L ${ex} ${ey}`);
      path.setAttribute('pathLength', '1');
      path.style.transitionDelay = `${entries.indexOf(entry) * 90}ms`;
      if (entry.classList.contains('is-active')) path.classList.add('is-active');
      svg.append(path);
      lines.set(entry.dataset.key, path);
    }
  }

  function schedule() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      drawLeaders();
      if (!plate.classList.contains('is-lensed')) setLens(plate.clientWidth / 2, plate.clientHeight / 2);
    });
  }

  // Rule the leaders once the type has settled, then let them draw in.
  (document.fonts?.ready || Promise.resolve()).then(() => {
    schedule();
    requestAnimationFrame(() => requestAnimationFrame(() => svg?.classList.add('is-drawn')));
    new ResizeObserver(schedule).observe(theatre);
  });
})();
