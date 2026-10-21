// Works catalogue: class filters, year chapters, census, running head and the scale bar in the margin.
(() => {
  const list = document.getElementById('workList');
  const search = document.getElementById('workSearch');
  const classes = document.getElementById('workClasses');
  if (!list || !search || !classes) return;
  const count = document.getElementById('workCount');
  const noResults = document.getElementById('workNoResults');
  const ruler = document.getElementById('workRuler');
  const runningHead = document.getElementById('runningHead');
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

  // Each year is a chapter (Pars I, II…), newest first.
  let heads = [];
  function placeChapters() {
    heads.forEach(h => h.remove());
    heads = [];
    let last = null;
    for (const row of rows) {
      if (row.hidden || row.dataset.year === last) continue;
      last = row.dataset.year;
      const head = document.createElement('h3');
      head.className = 'year-head';
      const y = parseInt(last, 10);
      head.dataset.year = last;
      head.dataset.pars = roman(heads.length + 1);
      head.innerHTML = `<span class="pars">Pars ${head.dataset.pars}</span><span class="y">${last}</span><span class="roman">Anno ${y ? roman(y) : ''}</span>`;
      row.before(head);
      heads.push(head);
    }
  }

  // The scale bar: year marks at each chapter, one tick per entry.
  const ticks = new Map();
  function drawRuler() {
    if (!ruler) return;
    ruler.replaceChildren();
    ticks.clear();
    const top = list.getBoundingClientRect().top;
    for (const head of heads) {
      const mark = document.createElement('span');
      mark.className = 'yr';
      mark.textContent = head.dataset.year;
      mark.style.top = `${head.getBoundingClientRect().top - top + 14}px`;
      ruler.append(mark);
    }
    for (const row of rows) {
      if (row.hidden) continue;
      const title = row.querySelector('.w-title');
      const r = (title || row).getBoundingClientRect();
      const tick = document.createElement('span');
      tick.className = 'tick';
      tick.style.top = `${r.top - top + r.height * .62}px`;
      ruler.append(tick);
      ticks.set(row, tick);
    }
  }
  for (const row of rows) {
    const on = state => ticks.get(row)?.classList.toggle('is-on', state);
    row.addEventListener('pointerenter', () => on(true));
    row.addEventListener('pointerleave', () => on(false));
    row.addEventListener('focus', () => on(true));
    row.addEventListener('blur', () => on(false));
  }

  // Running head: the chapter you are reading, carried at the top of the page.
  const head = runningHead?.parentElement;
  function updateRunningHead() {
    if (!head) return;
    const limit = head.getBoundingClientRect().bottom + 4;
    let current = null;
    for (const h of heads) if (h.getBoundingClientRect().top < limit) current = h;
    const listBox = list.getBoundingClientRect();
    const show = current && listBox.bottom > limit + 40;
    head.classList.toggle('is-on', Boolean(show));
    if (current) runningHead.textContent = `Pars ${current.dataset.pars} — ${current.dataset.year}`;
  }
  addEventListener('scroll', updateRunningHead, { passive: true });

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
    placeChapters();
    drawRuler();
    updateRunningHead();
    writeParams();
  }
  readParams();
  render();
  search.addEventListener('input', render);
  document.getElementById('workFilters')?.addEventListener('submit', event => event.preventDefault());
  new ResizeObserver(() => drawRuler()).observe(list);
  document.fonts?.ready.then(drawRuler);
})();
