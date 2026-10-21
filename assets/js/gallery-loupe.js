// Gallery: plates are pulled from the press on arrival and can be examined under a loupe.
(() => {
  const grid = document.querySelector('.graphics-grid');
  if (!grid) return;
  const plates = [...grid.querySelectorAll('.graphic')];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const roman = n => [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
    .reduce((out, [v, s]) => { while (n >= v) { out += s; n -= v; } return out; }, '');

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

  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const toggle = document.getElementById('loupeToggle');
  const viewer = document.getElementById('graphicViewer');
  const viewerImage = document.getElementById('graphicImage');
  const loupe = document.createElement('span');
  loupe.className = 'loupe gallery-loupe';
  loupe.setAttribute('aria-hidden', 'true');
  const mag = document.createElement('span');
  mag.className = 'mag';
  loupe.append(mag);
  let enabled = true;
  try { enabled = localStorage.getItem('synomare-loupe') !== 'off'; } catch (err) { }

  function setEnabled(on) {
    enabled = on;
    toggle?.setAttribute('aria-pressed', String(on));
    try { localStorage.setItem('synomare-loupe', on ? 'on' : 'off'); } catch (err) { }
    if (!on) hide();
  }
  toggle?.addEventListener('click', () => setEnabled(!enabled));
  setEnabled(enabled);

  let host = null;
  function hide() {
    loupe.classList.remove('is-on');
    grid.classList.remove('is-examining');
    viewer?.classList.remove('is-examining');
    host = null;
  }

  // Zoom is measured against the image's own pixels, so the glass never magnifies past the source.
  function examine(img, event, zoom, label, container) {
    if (!enabled || !fine.matches || event.pointerType !== 'mouse' || !img.complete || !img.naturalWidth) return hide();
    const parent = container || document.body;
    if (loupe.parentNode !== parent) parent.append(loupe);
    const rect = img.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return hide();
    const z = Math.max(1.4, Math.min(zoom, img.naturalWidth / rect.width * 1.25));
    const r = Math.round(Math.min(110, Math.max(64, rect.width * .16)));
    loupe.style.setProperty('--lr', `${r}px`);
    loupe.style.setProperty('--lx', `${event.clientX}px`);
    loupe.style.setProperty('--ly', `${event.clientY}px`);
    if (host !== img) {
      loupe.style.backgroundImage = `url("${img.currentSrc || img.src}")`;
      host = img;
    }
    loupe.style.backgroundSize = `${rect.width * z}px ${rect.height * z}px`;
    loupe.style.backgroundPosition = `${r - x * z}px ${r - y * z}px`;
    mag.textContent = `${label} · ×${z.toFixed(1)}`;
    loupe.classList.add('is-on');
  }

  for (const [index, plate] of plates.entries()) {
    const img = plate.querySelector('img');
    const label = `Tab. ${roman(index + 1)}`;
    plate.addEventListener('pointermove', event => {
      examine(img, event, 2.5, label);
      grid.classList.toggle('is-examining', loupe.classList.contains('is-on'));
    });
    plate.addEventListener('pointerleave', hide);
  }

  // Inside the viewer the loupe must live in the dialog's top layer to be visible.
  if (viewer && viewerImage) {
    viewerImage.addEventListener('pointermove', event => {
      const n = viewer.querySelector('#graphicPosition')?.textContent.split('/')[0].trim();
      examine(viewerImage, event, 2.2, `Tab. ${n ? roman(Number(n)) : ''}`, viewer);
      viewer.classList.toggle('is-examining', loupe.classList.contains('is-on'));
    });
    viewerImage.addEventListener('pointerleave', hide);
    viewer.addEventListener('close', hide);
    viewerImage.addEventListener('load', () => { host = null; });
  }
  addEventListener('scroll', hide, { passive: true });
})();
