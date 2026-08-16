import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(testDir, '..');
const generatorPath = path.join(sourceRoot, 'scripts', 'new-post.mjs');
const templatePath = path.join(sourceRoot, 'notes', 'post-template.html');

async function makeSite(files, assets = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'synomare-notes-'));
  await fs.mkdir(path.join(root, 'notes', 'content'), { recursive: true });
  await fs.copyFile(templatePath, path.join(root, 'notes', 'post-template.html'));
  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(root, 'notes', 'content', name), content, 'utf8');
  }
  for (const [name, content] of Object.entries(assets)) {
    const target = path.join(root, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  return root;
}

function runGenerator(root, mode = '--rebuild') {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [generatorPath, mode], {
      env: { ...process.env, SYNOMARE_REPO_ROOT: root },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

test('Markdownから記事、一覧、埋め込み、サムネイルを生成する', async t => {
  const root = await makeSite({
    'first-post.md': `---
title: 最初の記事
date: 2026-08-15
summary: 日本語の概要です。
tags:
  - diary
  - update
---

# 本文

![写真](/assets/images/notes/sample.jpg)

https://www.youtube.com/watch?v=dQw4w9WgXcQ

https://x.com/synomare/status/1234567890
`,
    'older-post.md': `---
title: 古い記事
date: 2026-01-02
summary: 古い記事の概要です。
tags:
  - archive
---

本文です。
`
  }, { 'assets/images/notes/sample.jpg': Buffer.from([0xff, 0xd8, 0xff, 0xd9]) });
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await runGenerator(root);
  assert.equal(result.code, 0, result.stderr);

  const posts = JSON.parse(await fs.readFile(path.join(root, 'notes', 'posts.json'), 'utf8'));
  assert.deepEqual(posts.map(post => post.slug), ['first-post', 'older-post']);
  assert.equal(posts[0].image, '/assets/images/notes/sample.jpg');
  assert.deepEqual(posts[0].tags, ['diary', 'update']);

  const html = await fs.readFile(path.join(root, 'notes', 'first-post.html'), 'utf8');
  assert.match(html, /youtube\.com\/embed\/dQw4w9WgXcQ/);
  assert.match(html, /twitter-tweet/);
  assert.match(html, /<h1>本文<\/h1>/);
  assert.match(html, /og:image/);
  assert.match(html, /twitter:card" content="summary_large_image/);
  assert.match(html, /caption\.textContent=img\.title\|\|''/);
  assert.doesNotMatch(html, /caption\.textContent=img\.title\|\|img\.alt/);
});

test('画像ファイル名を概要や画面上のキャプションとして扱わない', async t => {
  const root = await makeSite({
    'photo-note.md': `---
title: 写真の記事
date: 2026-08-16
---

![IMG_0203.HEIC](/assets/images/notes/photo.jpg)

写真のあとに続く本文です。
`
  }, { 'assets/images/notes/photo.jpg': Buffer.from([0xff, 0xd8, 0xff, 0xd9]) });
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await runGenerator(root);
  assert.equal(result.code, 0, result.stderr);
  const posts = JSON.parse(await fs.readFile(path.join(root, 'notes', 'posts.json'), 'utf8'));
  assert.equal(posts[0].summary, '写真のあとに続く本文です。');
  const html = await fs.readFile(path.join(root, 'notes', 'photo-note.html'), 'utf8');
  assert.match(html, /alt="IMG_0203\.HEIC"/);
  assert.match(html, /caption\.textContent=img\.title\|\|''/);
});

test('HEIC画像を公開用JPEGへ変換し記事と一覧の参照を差し替える', async t => {
  const sourceHeic = await fs.readFile(path.join(sourceRoot, 'assets', 'images', 'notes', '1786865741293-img_0203.heic'));
  const root = await makeSite({
    'heic-post.md': `---
title: HEICの記事
date: 2026-08-16
tags: [写真]
---

![iPhoneの写真](/assets/images/notes/photo.HEIC)
`
  }, { 'assets/images/notes/photo.HEIC': sourceHeic });
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await runGenerator(root);
  assert.equal(result.code, 0, result.stderr);
  const posts = JSON.parse(await fs.readFile(path.join(root, 'notes', 'posts.json'), 'utf8'));
  assert.match(posts[0].image, /^\/assets\/images\/notes\/generated\/photo-[a-f0-9]{12}\.jpg$/);
  const generated = await fs.readFile(path.join(root, posts[0].image.slice(1)));
  assert.deepEqual([...generated.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  const html = await fs.readFile(path.join(root, 'notes', 'heic-post.html'), 'utf8');
  assert.match(html, /generated\/photo-[a-f0-9]{12}\.jpg/);
});

test('存在しないローカル画像と非対応形式を公開前に拒否する', async t => {
  const missingRoot = await makeSite({
    'missing-image.md': `---
title: 画像なし
date: 2026-08-16
---

![見つからない](/assets/images/notes/missing.jpg)
`
  });
  const unsupportedRoot = await makeSite({
    'tiff-image.md': `---
title: TIFF
date: 2026-08-16
---

![TIFF](/assets/images/notes/sample.tiff)
`
  }, { 'assets/images/notes/sample.tiff': Buffer.from('not-a-web-image') });
  t.after(() => Promise.all([missingRoot, unsupportedRoot].map(root => fs.rm(root, { recursive: true, force: true }))));

  const missing = await runGenerator(missingRoot, '--check');
  assert.notEqual(missing.code, 0);
  assert.match(missing.stderr, /画像ファイルが見つかりません/);
  const unsupported = await runGenerator(unsupportedRoot, '--check');
  assert.notEqual(unsupported.code, 0);
  assert.match(unsupported.stderr, /画像はWeb表示に対応していません/);
});

test('不正なslugを拒否する', async t => {
  const root = await makeSite({
    'Bad_Slug.md': `---
title: 不正slug
date: 2026-08-15
summary: 概要です。
tags: [test]
---

本文です。
`
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await runGenerator(root, '--check');
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /slug は英小文字/);
});

test('slugの先頭末尾ハイフンを拒否する', async t => {
  const root = await makeSite({
    '-bad-slug-.md': `---
title: 不正slug
date: 2026-08-15
summary: 概要です。
tags: [test]
---

本文です。
`
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await runGenerator(root, '--check');
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /slug は英小文字/);
});

test('存在しない日付を拒否する', async t => {
  const root = await makeSite({
    'invalid-date.md': `---
title: 不正日付
date: 2026-02-30
summary: 概要です。
tags: [test]
---

本文です。
`
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await runGenerator(root, '--check');
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /date の値を解釈/);
});

test('空のタグ配列は本文タグまたは未分類で補完する', async t => {
  const root = await makeSite({
    'no-tags.md': `---
title: タグなし
date: 2026-08-15
summary: 概要です。
tags: []
---

本文です。
`
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await runGenerator(root);
  assert.equal(result.code, 0, result.stderr);
  const posts = JSON.parse(await fs.readFile(path.join(root, 'notes', 'posts.json'), 'utf8'));
  assert.deepEqual(posts[0].tags, ['未分類']);
});

test('必須メタデータ不足を拒否する', async t => {
  const root = await makeSite({
    'missing-title.md': `---
date: 2026-08-15
summary: 概要です。
tags: [test]
---

本文です。
`
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await runGenerator(root, '--check');
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /title は必須/);
});

test('壊れたfrontmatterを拒否する', async t => {
  const root = await makeSite({
    'broken.md': `---
title: [閉じていない
date: 2026-08-15
summary: 概要です。
tags: [test]
---

本文です。
`
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await runGenerator(root, '--check');
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Error:/);
});

test('Markdownを削除した記事の生成済みHTMLも削除する', async t => {
  const root = await makeSite({
    'delete-me.md': `---
title: 削除する記事
date: 2026-08-15
summary: 削除確認用です。
tags: [test]
---

本文です。
`
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const first = await runGenerator(root);
  assert.equal(first.code, 0, first.stderr);
  const generatedPath = path.join(root, 'notes', 'delete-me.html');
  await fs.access(generatedPath);

  await fs.rm(path.join(root, 'notes', 'content', 'delete-me.md'));
  const second = await runGenerator(root);
  assert.equal(second.code, 0, second.stderr);
  await assert.rejects(fs.access(generatedPath), error => error.code === 'ENOENT');
  const posts = JSON.parse(await fs.readFile(path.join(root, 'notes', 'posts.json'), 'utf8'));
  assert.deepEqual(posts, []);
});

test('下書き記事は検証されるが公開一覧とHTMLには出さない', async t => {
  const root = await makeSite({
    'draft-post.md': `---
title: 下書き記事
date: 2026-08-15
summary: 下書き確認用です。
tags: [draft]
draft: true
---

本文です。
`
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await runGenerator(root);
  assert.equal(result.code, 0, result.stderr);
  await assert.rejects(fs.access(path.join(root, 'notes', 'draft-post.html')), error => error.code === 'ENOENT');
  const posts = JSON.parse(await fs.readFile(path.join(root, 'notes', 'posts.json'), 'utf8'));
  assert.deepEqual(posts, []);
});

test('カード情報、内部リンク、バックリンク、関連記事を二段階で生成する', async t => {
  const root = await makeSite({
    'source-note.md': `---
title: 出発点
date: 2026-08-16
tags: [思考, web]
card_size: l
card_excerpt: カード専用の文章
---

[[destination|別の記事]]と[[まだない記事]]へ進みます。
`,
    'destination.md': `---
title: 到着点
aliases: [目的地]
date: 2026-08-15
tags: [思考]
---

リンク先の本文です。
`
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const result = await runGenerator(root);
  assert.equal(result.code, 0, result.stderr);
  const posts = JSON.parse(await fs.readFile(path.join(root, 'notes', 'posts.json'), 'utf8'));
  const source = posts.find(post => post.slug === 'source-note');
  const destination = posts.find(post => post.slug === 'destination');
  assert.equal(source.cardSize, 'l');
  assert.equal(source.cardExcerpt, 'カード専用の文章');
  assert.equal(source.outgoing[0].slug, 'destination');
  assert.equal(destination.incoming[0].slug, 'source-note');
  assert.equal(source.related[0].slug, 'destination');
  const html = await fs.readFile(path.join(root, 'notes', 'source-note.html'), 'utf8');
  assert.match(html, /class="wikilink" href="destination\.html"/);
  assert.match(html, /is-unresolved/);
  assert.match(html, /LOCAL GRAPH/);
});

test('不正なカードサイズを拒否する', async t => {
  const root = await makeSite({
    'bad-card.md': `---
title: 不正カード
date: 2026-08-16
card_size: huge
---

本文です。
`
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const result = await runGenerator(root, '--check');
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /card_size は s、m、l/);
});
