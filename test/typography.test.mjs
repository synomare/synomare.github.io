import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('OTTOは大見出し用の表示書体として読み込まれる', async () => {
  const fontPath = path.join(repoRoot, 'assets', 'fonts', 'OTTOATTACTYPE.ttf');
  const typeCssPath = path.join(repoRoot, 'assets', 'css', 'type.css');
  const font = await fs.stat(fontPath);
  const typeCss = await fs.readFile(typeCssPath, 'utf8');
  assert.ok(font.size > 1000);
  assert.match(typeCss, /font-family:\s*["']OTTO ATTACTYPE["']/);
  assert.match(typeCss, /OTTOATTACTYPE\.ttf/);

  const pages = [
    ['index.html', 'assets/css/type.css'],
    ['works.html', 'assets/css/type.css'],
    ['links.html', 'assets/css/type.css'],
    ['profile.html', 'assets/css/type.css'],
    ['notes/index.html', '../assets/css/type.css'],
    ['notes/post-template.html', '../assets/css/type.css']
  ];
  for (const [relativePath, href] of pages) {
    const source = await fs.readFile(path.join(repoRoot, relativePath), 'utf8');
    assert.match(source, new RegExp(`rel="stylesheet" href="${href.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}"`), relativePath);
  }
  assert.match(await fs.readFile(path.join(repoRoot, 'index.html'), 'utf8'), /\.ghost[\s\S]*font-family: var\(--display\)/);
  assert.match(await fs.readFile(path.join(repoRoot, 'notes', 'index.html'), 'utf8'), /\.display\{[^}]*var\(--display\)/);
});
