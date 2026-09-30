import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/js/graphics-gallery.js', import.meta.url), 'utf8');
function setup(supported = true) {
  function element() {
    return { handlers: {}, addEventListener(name, callback) { this.handlers[name] = callback; },
      removeAttribute(name) { delete this[name]; }, focus() { this.focused = true; } };
  }
  const links = Array.from({ length: 8 }, (_, index) => Object.assign(element(), {
    href: `https://example.com/${index + 1}.webp`, querySelector() { return { alt: `作品 ${index + 1}` }; }
  }));
  const ids = Object.fromEntries(['graphicViewer', 'graphicImage', 'graphicOriginal', 'graphicPosition', 'graphicClose', 'graphicPrevious', 'graphicNext'].map(id => [id, element()]));
  const classes = new Set();
  if (supported) ids.graphicViewer.showModal = function () { this.open = true; };
  ids.graphicViewer.close = function () { this.open = false; this.handlers.close(); };
  vm.runInNewContext(source, { document: { querySelectorAll: () => links, getElementById: id => ids[id], documentElement: { classList: { add: s => classes.add(s), remove: s => classes.delete(s) } } } });
  const click = (index, modifiers = {}) => {
    const event = { button: 0, preventDefault() { this.prevented = true; }, ...modifiers };
    links[index].handlers.click?.(event);
    return event;
  };
  return { links, ids, classes, click };
}

test('gallery opens display image with position and accessible label', () => {
  const { ids, click, classes } = setup();
  assert.equal(click(3).prevented, true);
  assert.equal(ids.graphicViewer.open, true);
  assert.equal(ids.graphicImage.src, 'https://example.com/4.webp');
  assert.equal(ids.graphicImage.alt, '作品 4');
  assert.equal(ids.graphicPosition.textContent, '4 / 8');
  assert.equal(classes.has('graphic-viewer-open'), true);
});

test('gallery navigation wraps and closes with focus restored', () => {
  const { ids, links, click, classes } = setup();
  click(0);
  ids.graphicPrevious.handlers.click();
  assert.equal(ids.graphicPosition.textContent, '8 / 8');
  ids.graphicNext.handlers.click();
  assert.equal(ids.graphicPosition.textContent, '1 / 8');
  ids.graphicViewer.handlers.keydown({ key: 'ArrowRight', preventDefault() {} });
  assert.equal(ids.graphicPosition.textContent, '2 / 8');
  ids.graphicClose.handlers.click();
  assert.equal(ids.graphicViewer.open, false);
  assert.equal(links[0].focused, true);
  assert.equal(classes.size, 0);
  assert.equal(ids.graphicImage.src, undefined);
  click(7);
  assert.equal(ids.graphicPosition.textContent, '8 / 8');
});

test('modified clicks and unsupported dialogs retain normal image links', () => {
  assert.equal(setup().click(0, { ctrlKey: true }).prevented, undefined);
  assert.equal(setup(false).click(0).prevented, undefined);
});

test('all twenty uncropped images exist with intrinsic dimensions and no visible invented titles', () => {
  const html = fs.readFileSync(new URL('../gallery.html', import.meta.url), 'utf8');
  const gallery = html.match(/<div class="graphics-grid">([\s\S]*?)<\/div>/)[1];
  const images = [...gallery.matchAll(/<img src="([^"]+)" alt="([^"]+)" width="(\d+)" height="(\d+)"/g)];
  assert.equal(images.length, 20);
  assert.equal((gallery.match(/class="graphic"/g) || []).length, 20);
  for (const [, src, alt, width, height] of images) {
    assert.ok(fs.statSync(new URL(`../${src}`, import.meta.url)).size > 0);
    assert.ok(Number(width) > 0 && Number(height) > 0 && alt);
  }
  assert.doesNotMatch(gallery, /figcaption|w-title|w-desc/);
});
