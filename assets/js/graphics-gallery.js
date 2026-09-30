(() => {
  const links = Array.from(document.querySelectorAll('.graphic'));
  const dialog = document.getElementById('graphicViewer');
  // The image links remain useful without JavaScript or dialog support.
  if (!links.length || !dialog || typeof dialog.showModal !== 'function') return;
  const image = document.getElementById('graphicImage');
  const original = document.getElementById('graphicOriginal');
  const position = document.getElementById('graphicPosition');
  let current = 0;
  let trigger = null;

  function show(index) {
    current = (index + links.length) % links.length;
    const link = links[current];
    image.src = link.href;
    image.alt = link.querySelector('img').alt;
    original.href = link.href;
    position.textContent = `${current + 1} / ${links.length}`;
  }

  links.forEach((link, index) => {
    link.addEventListener('click', event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      trigger = link;
      show(index);
      dialog.showModal();
      document.documentElement.classList.add('graphic-viewer-open');
    });
  });
  document.getElementById('graphicClose').addEventListener('click', () => dialog.close());
  document.getElementById('graphicPrevious').addEventListener('click', () => show(current - 1));
  document.getElementById('graphicNext').addEventListener('click', () => show(current + 1));
  dialog.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      show(current + (event.key === 'ArrowRight' ? 1 : -1));
    }
  });
  dialog.addEventListener('close', () => {
    document.documentElement.classList.remove('graphic-viewer-open');
    image.removeAttribute('src');
    if (trigger) trigger.focus({ preventScroll: true });
  });
})();
