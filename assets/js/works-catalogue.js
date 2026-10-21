// Works catalogue: class filters, year groups, census and the floating specimen card.
(() => {
  const list = document.getElementById('workList');
  const search = document.getElementById('workSearch');
  const classes = document.getElementById('workClasses');
  if (!list || !search || !classes) return;
  const count = document.getElementById('workCount');
  const noResults = document.getElementById('workNoResults');
  const rows = [...list.querySelectorAll('.work-row')];
  let currentType = '';

  const roman = n => [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
    .reduce((out, [v, s]) => { while (n >= v) { out += s; n -= v; } return out; }, '');
  const label = type => type.split('/')[0].trim();

  // Census
  const types = [...new Set(rows.map(r => r.dataset.type))].sort((a, b) => a.localeCompare(b, 'ja'));
  const years = rows.map(r => parseInt(r.dataset.year, 10)).filter(Boolean);
  const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  setText('censusCount', String(rows.length).padStart(2, '0'));
  setText('censusClasses', String(types.length).padStart(2, '0'));
  if (years.length) setText('censusYears', `${Math.min(...years)}–${String(Math.max(...years)).slice(2)}`);

  // Class chips
  for (const type of types) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.type = type;
    button.setAttribute('aria-pressed', 'false');
    button.innerHTML = `${label(type)}<span class="n">${rows.filter(r => r.dataset.type === type).length}</span>`;
    classes.append(button);
  }
  const chips = [...classes.querySelectorAll('button')];
  classes.addEventListener('click', event => {
    const chip = event.target.closest('button');
    if (!chip) return;
    currentType = chip.dataset.type;
    render();
  });

  // Year headings are woven in between entries.
  const heads = [];
  function placeYearHeads() {
    heads.forEach(h => h.remove());
    heads.length = 0;
    let last = null;
    for (const row of rows) {
      if (row.hidden || row.dataset.year === last) continue;
      last = row.dataset.year;
      const head = document.createElement('h3');
      head.className = 'year-head';
      const y = parseInt(last, 10);
      head.innerHTML = `<span class="y">${last}</span><span class="roman">Anno ${y ? roman(y) : ''}</span>`;
      row.before(head);
      heads.push(head);
    }
  }

  function readParams() {
    const params = new URLSearchParams(location.search);
    search.value = params.get('q') || '';
    currentType = types.includes(params.get('type')) ? params.get('type') : '';
  }
  function writeParams() {
    const params = new URLSearchParams();
    if (search.value.trim()) params.set('q', search.value.trim());
    if (currentType) params.set('type', currentType);
    const query = params.toString();
    history.replaceState(null, '', location.pathname + (query ? '?' + query : ''));
  }
  function render() {
    const query = search.value.trim().toLocaleLowerCase('ja');
    let visible = 0;
    for (const row of rows) {
      const match = (!query || (row.dataset.search || '').includes(query)) && (!currentType || row.dataset.type === currentType);
      row.hidden = !match;
      if (match) visible++;
    }
    chips.forEach(chip => chip.setAttribute('aria-pressed', String(chip.dataset.type === currentType)));
    if (noResults) noResults.hidden = visible !== 0 || rows.length === 0;
    if (count) count.textContent = `${visible} / ${rows.length} specimina`;
    placeYearHeads();
    writeParams();
  }
  readParams();
  render();
  search.addEventListener('input', render);
  document.getElementById('workFilters')?.addEventListener('submit', event => event.preventDefault());

  // Specimen card
  const card = document.getElementById('specimenCard');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  if (!card) return;
  const body = card.querySelector('.sc-body');
  const fill = row => {
    card.querySelector('.sc-no').textContent = `Specimen ${row.querySelector('.w-no')?.textContent || ''}`;
    card.querySelector('.sc-year').textContent = row.dataset.year;
    card.querySelector('.sc-type').textContent = label(row.dataset.type);
    let host = '';
    try { host = row.href ? new URL(row.href).hostname.replace(/^www\./, '') : ''; } catch (err) { }
    card.querySelector('.sc-host').textContent = host && host !== location.hostname ? `↗ ${host}` : '→ synomare';
    const img = row.querySelector('.w-thumb img');
    body.replaceChildren();
    body.classList.toggle('is-type', !img);
    if (img) {
      const clone = new Image();
      clone.src = img.currentSrc || img.src;
      clone.alt = '';
      body.append(clone);
    } else {
      const title = row.querySelector('.w-title')?.textContent || '';
      const word = document.createElement('span');
      word.className = 'sc-word' + (/[぀-ヿ一-鿿]/.test(title) ? ' is-jp' : '');
      word.textContent = title;
      body.append(word);
    }
  };
  let tx = 0, ty = 0, cx = 0, cy = 0, frame = 0, tilt = 0;
  // The card swings a little with the pointer's speed, then settles.
  const follow = () => {
    cx += (tx - cx) * .2; cy += (ty - cy) * .2; tilt *= .86;
    card.style.setProperty('--cx', `${cx.toFixed(1)}px`);
    card.style.setProperty('--cy', `${cy.toFixed(1)}px`);
    card.style.setProperty('--tilt', `${tilt.toFixed(2)}deg`);
    frame = Math.abs(tx - cx) + Math.abs(ty - cy) + Math.abs(tilt) > .3 ? requestAnimationFrame(follow) : 0;
  };
  const target = event => {
    const w = card.offsetWidth, h = card.offsetHeight;
    tx = Math.min(innerWidth - w - 12, event.clientX + 44);
    ty = Math.max(12, Math.min(innerHeight - h - 12, event.clientY - h * .55));
  };
  let shownRow = null;
  const show = (row, event) => {
    fill(row);
    target(event);
    cx = tx; cy = ty; tilt = 0;
    follow();
    card.classList.add('is-shown');
    shownRow = row;
  };
  for (const row of rows) {
    row.addEventListener('pointerenter', event => {
      if (fine.matches && event.pointerType === 'mouse') show(row, event);
    });
    row.addEventListener('pointermove', event => {
      if (!fine.matches || event.pointerType !== 'mouse') return;
      if (shownRow !== row) { show(row, event); return; }
      target(event);
      tilt = Math.max(-2.5, Math.min(2.5, tilt + (event.movementX || 0) * .08));
      if (!frame) frame = requestAnimationFrame(follow);
    });
    row.addEventListener('pointerleave', () => { card.classList.remove('is-shown'); shownRow = null; });
  }
  addEventListener('scroll', () => { card.classList.remove('is-shown'); shownRow = null; }, { passive: true });
})();
