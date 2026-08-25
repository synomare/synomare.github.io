import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('トップページはSNS共有用の画像と絶対URLを公開する', async () => {
  const source = await fs.readFile(path.join(repoRoot, 'index.html'), 'utf8');
  const imagePath = path.join(repoRoot, 'assets', 'images', 'og-default-v2.jpg');
  const image = await fs.readFile(imagePath);

  assert.ok(image.length > 1000);
  assert.ok(image.includes(Buffer.from([0xff, 0xc0])), 'JPEGはベースライン形式である');
  assert.equal(image.includes(Buffer.from([0xff, 0xc2])), false, 'プログレッシブJPEGを使わない');
  assert.match(source, /<meta property="og:url" content="https:\/\/synomare\.github\.io\/">/);
  assert.match(source, /<meta property="og:image" content="https:\/\/synomare\.github\.io\/assets\/images\/og-default-v2\.jpg">/);
  assert.match(source, /<meta property="og:image:type" content="image\/jpeg">/);
  assert.match(source, /<meta property="og:image:width" content="1200">/);
  assert.match(source, /<meta property="og:image:height" content="630">/);
  assert.match(source, /<meta property="og:image:alt" content="SYNOMAREの文字と複数のコラージュを組み合わせた共有カード">/);
  assert.match(source, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(source, /<meta name="twitter:image" content="https:\/\/synomare\.github\.io\/assets\/images\/og-default-v2\.jpg">/);
  assert.match(source, /<meta name="twitter:image:alt" content="SYNOMAREの文字と複数のコラージュを組み合わせた共有カード">/);
  assert.match(source, /<link rel="canonical" href="https:\/\/synomare\.github\.io\/">/);
});
