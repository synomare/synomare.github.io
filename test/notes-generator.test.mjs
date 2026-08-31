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
`,
    'draft-post.md': `---
title: 非公開の記事
date: 2026-09-01
draft: true
---

下書き本文です。
`
  }, { 'assets/images/notes/sample.jpg': Buffer.from([0xff, 0xd8, 0xff, 0xd9]) });
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await runGenerator(root);
  assert.equal(result.code, 0, result.stderr);

  const posts = JSON.parse(await fs.readFile(path.join(root, 'notes', 'posts.json'), 'utf8'));
  assert.deepEqual(posts.map(post => post.slug), ['first-post', 'older-post']);
  assert.deepEqual(posts.map(post => post.archiveNumber), [1, 2]);
  assert.equal(posts[0].image, '/assets/images/notes/sample.jpg');
  assert.deepEqual(posts[0].tags, ['diary', 'update']);
  const postsScript = await fs.readFile(path.join(root, 'notes', 'posts.js'), 'utf8');
  assert.match(postsScript, /"archiveNumber": 1/);

  const html = await fs.readFile(path.join(root, 'notes', 'first-post.html'), 'utf8');
  assert.match(html, /youtube\.com\/embed\/dQw4w9WgXcQ/);
  assert.match(html, /twitter-tweet/);
  assert.match(html, /<h1>本文<\/h1>/);
  assert.match(html, /og:image/);
  assert.match(html, /twitter:card" content="summary_large_image/);
  assert.match(html, /caption\.textContent=img\.title\|\|''/);
  assert.doesNotMatch(html, /caption\.textContent=img\.title\|\|img\.alt/);
  assert.match(html, /class="breadcrumb-current" aria-current="page">最初の記事/);
  assert.match(html, /class="entry-meta"/);
  assert.match(html, /class="entry-folio">N\.001 \/ TEXT/);
  assert.match(html, /\.topbar nav a\{min-height:44px/);
  assert.match(html, /\.topbar nav a:hover,\.topbar nav a:focus-visible/);
  assert.match(html, /nav\.replaceChildren\(\.\.\.links\)/);
  assert.match(html, /copy\.textContent=title/);
  assert.match(html, /className=`nav-\$\{kind\}`/);
  assert.doesNotMatch(html, /nav\.innerHTML/);
});

test('エディタのテキスト階層を公開HTMLのブロック構造へ反映する', async t => {
  const root = await makeSite({
    'hierarchy-note.md': `---
title: 階層のある記事
date: 2026-08-16
---

親ブロック
  子ブロック
  > 孫ブロック
  > > 曾孫ブロック
  https://www.youtube.com/watch?v=dQw4w9WgXcQ

    インデントコード

> 通常の引用
- 親リスト
  - 子リスト
`
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await runGenerator(root);
  assert.equal(result.code, 0, result.stderr);
  const html = await fs.readFile(path.join(root, 'notes', 'hierarchy-note.html'), 'utf8');
  assert.match(html, /<p>親ブロック<\/p>/);
  assert.match(html, /<div class="note-block note-depth-1" data-depth="1" style="--note-depth:1"><p>子ブロック<\/p>\s*<\/div>/);
  assert.match(html, /<div class="note-block note-depth-2" data-depth="2" style="--note-depth:2"><p>孫ブロック<\/p>\s*<\/div>/);
  assert.match(html, /<div class="note-block note-depth-3" data-depth="3" style="--note-depth:3"><p>曾孫ブロック<\/p>\s*<\/div>/);
  assert.match(html, /<div class="note-block note-depth-1" data-depth="1" style="--note-depth:1">\s*<div class="video-container"><iframe src="https:\/\/www\.youtube\.com\/embed\/dQw4w9WgXcQ"/);
  assert.match(html, /<blockquote>\s*<p>通常の引用<\/p>\s*<\/blockquote>/);
  assert.match(html, /<ul>\s*<li>親リスト<ul>\s*<li>子リスト<\/li>/);
  assert.match(html, /<pre><code>インデントコード\n<\/code><\/pre>/);
  const article = html.match(/<article class="entry[\s\S]*?<\/article>/)?.[0] || '';
  assert.doesNotMatch(article, /親ブロック\s*子ブロック/);
});

test('画像と同じMarkdown段落の文章を独立ブロックへ分離する', async t => {
  const root = await makeSite({
    'mixed-media.md': `---
title: 画像と文章
date: 2026-08-16
---

前の文章 ![作品写真](/assets/images/notes/sample.jpg "展示風景") 後ろの文章

![](/assets/images/notes/sample.jpg)
二枚目の続き
`
  }, { 'assets/images/notes/sample.jpg': Buffer.from([0xff, 0xd8, 0xff, 0xd9]) });
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await runGenerator(root);
  assert.equal(result.code, 0, result.stderr);
  const html = await fs.readFile(path.join(root, 'notes', 'mixed-media.html'), 'utf8');
  assert.match(html, /<p>前の文章<\/p><figure class="note-media"><img[^>]+loading="eager"[^>]*><figcaption>展示風景<\/figcaption>/);
  assert.match(html, /<\/figure><p>後ろの文章<\/p>/);
  assert.match(html, /<figure class="note-media"><img[^>]+loading="lazy"[^>]*><div class="note-media-error"/);
  assert.match(html, /<\/figure><p>二枚目の続き<\/p>/);
  assert.equal((html.match(/<figure class="note-media">/g) || []).length, 2);
  assert.doesNotMatch(html, /<p>\s*<figure class="note-media">/);
  assert.doesNotMatch(html, /<figcaption>作品写真<\/figcaption>/);
});

test('同じ公開日の記事はタイムスタンプslugの新しい順に並べる', async t => {
  const root = await makeSite({
    '20260816-090000.md': `---
title: 朝の記事
date: 2026-08-16
---

朝の本文です。
`,
    '20260816-163440.md': `---
title: 夜の記事
date: 2026-08-16
---

夜の本文です。
`
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await runGenerator(root);
  assert.equal(result.code, 0, result.stderr);
  const posts = JSON.parse(await fs.readFile(path.join(root, 'notes', 'posts.json'), 'utf8'));
  assert.deepEqual(posts.map(post => post.slug), ['20260816-163440', '20260816-090000']);
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
  assert.doesNotMatch(html, /LOCAL GRAPH|mini-graph|entry-side/);
  assert.match(html, /\.entry-layout\{display:block;width:100%;max-width:1180px;margin:0 auto\}/);
  assert.match(html, /\.text-entry>p,[^}]+width:min\(100%,48em\);margin-left:auto;margin-right:auto/);
  assert.match(html, /\.text-entry>\.note-media,\.text-entry>\.video-container,\.text-entry>\.twitter-tweet\{width:100%;max-width:none\}/);
  assert.match(html, /\.entry \.note-block \{ position: relative; margin: \.5rem auto 1\.15rem;/);
  assert.match(html, /class="relations"/);
  assert.match(html, /Links — この記事から/);
  assert.match(html, /Related — 関連記事/);
  assert.doesNotMatch(html, /Backlinks — この記事へ/);
});

test('関連記事はfrontmatterで手動追加・除外でき、タグ自動候補と併用する', async t => {
  const root = await makeSite({
    'source.md': `---
title: 起点
date: 2026-08-16
tags: [共通]
related_notes: [目的地, manual-note]
related_exclude: [除外記事]
---

本文です。
`,
    'manual-note.md': `---
title: 手動追加
date: 2026-08-15
tags: [別のタグ]
---

手動でつなぐ記事です。
`,
    'alias-target.md': `---
title: 到着記事
aliases: [目的地]
date: 2026-08-14
tags: [別のタグ]
---

aliasで解決する記事です。
`,
    'auto-note.md': `---
title: 自動候補
date: 2026-08-13
tags: [共通]
---

タグでつながる記事です。
`,
    'excluded.md': `---
title: 除外記事
date: 2026-08-12
tags: [共通]
---

除外される記事です。
`
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const result = await runGenerator(root);
  assert.equal(result.code, 0, result.stderr);
  const posts = JSON.parse(await fs.readFile(path.join(root, 'notes', 'posts.json'), 'utf8'));
  const source = posts.find(post => post.slug === 'source');
  assert.deepEqual(source.relatedNotes, ['目的地', 'manual-note']);
  assert.deepEqual(source.relatedExclude, ['除外記事']);
  assert.deepEqual(source.related.map(item => item.slug), ['alias-target', 'manual-note', 'auto-note']);
  assert.deepEqual(source.related.slice(0, 2).map(item => item.manual), [true, true]);
  assert.equal(source.related.at(-1).manual, false);
  assert.doesNotMatch(JSON.stringify(source.related), /excluded/);
});

test('関連記事の未解決・曖昧な参照は警告し、公開を止めない', async t => {
  const root = await makeSite({
    'source.md': `---
title: 起点
date: 2026-08-16
related_notes: [存在しない, 同名]
---

本文です。
`,
    'one.md': `---
title: 同名
date: 2026-08-15
---

本文です。
`,
    'two.md': `---
title: 同名
date: 2026-08-14
---

本文です。
`
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const result = await runGenerator(root);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stderr, /related_notes/);
  const posts = JSON.parse(await fs.readFile(path.join(root, 'notes', 'posts.json'), 'utf8'));
  assert.deepEqual(posts.find(post => post.slug === 'source').related.map(item => item.slug), ['one', 'two']);
  assert.ok(posts.find(post => post.slug === 'source').related.every(item => item.manual === false));
});

test('関連記事の順序を保持し、自己参照・下書き・追加除外重複を警告する', async t => {
  const root = await makeSite({
    'source.md': `---
title: 起点
date: 2026-08-16
related_notes: [second, draft-note, source]
related_exclude: [second]
---

本文です。
`,
    'second.md': `---
title: 二つ目
date: 2026-08-15
---

二つ目です。
`,
    'draft-note.md': `---
title: 下書き
date: 2026-08-14
draft: true
---

公開されません。
`
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const result = await runGenerator(root);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stderr, /下書き/);
  assert.match(result.stderr, /自分自身/);
  assert.match(result.stderr, /追加と除外/);
  const posts = JSON.parse(await fs.readFile(path.join(root, 'notes', 'posts.json'), 'utf8'));
  assert.deepEqual(posts.find(post => post.slug === 'source').related.map(item => item.slug), ['second']);
});

test('未指定カードサイズを内容別に決め、明示指定を優先する', async t => {
  const root = await makeSite({
    'text-only.md': `---
title: 小さなテキスト
date: 2026-08-16
---

本文だけの記事です。
`,
    'text-image.md': `---
title: 画像入りテキスト
date: 2026-08-16
---

![掲載写真](/assets/images/notes/text.jpg)

写真を含む本文です。
`,
    'photo-only.md': `---
post_type: photo
date: 2026-08-16
photo: /assets/images/notes/photo.jpg
---
`,
    'photo-small.md': `---
post_type: photo
date: 2026-08-16
photo: /assets/images/notes/photo.jpg
card_size: s
---
`
  }, {
    'assets/images/notes/text.jpg': Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    'assets/images/notes/photo.jpg': Buffer.from([0xff, 0xd8, 0xff, 0xd9])
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const result = await runGenerator(root);
  assert.equal(result.code, 0, result.stderr);
  const posts = JSON.parse(await fs.readFile(path.join(root, 'notes', 'posts.json'), 'utf8'));
  const bySlug = Object.fromEntries(posts.map(post => [post.slug, post]));
  assert.equal(bySlug['text-only'].cardSize, 's');
  assert.equal(bySlug['text-image'].cardSize, 'm');
  assert.equal(bySlug['photo-only'].cardSize, 'l');
  assert.equal(bySlug['photo-only'].postType, 'photo');
  assert.equal(bySlug['photo-small'].cardSize, 's');
  assert.equal(bySlug['photo-small'].cardSizeMode, 's');
});

test('写真単体はタイトルと本文なしで公開し専用詳細を生成する', async t => {
  const root = await makeSite({
    'single-photo.md': `---
post_type: photo
date: 2026-08-16
photo: /assets/images/notes/photo.jpg
---
`
  }, { 'assets/images/notes/photo.jpg': Buffer.from([0xff, 0xd8, 0xff, 0xd9]) });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const result = await runGenerator(root);
  assert.equal(result.code, 0, result.stderr);
  const html = await fs.readFile(path.join(root, 'notes', 'single-photo.html'), 'utf8');
  assert.match(html, /class="photo-page"/);
  assert.match(html, /class="photo-detail"/);
  assert.match(html, /data-post-type="photo"/);
  assert.match(html, /<h1 class="sr-only">Photo 2026\.08\.16<\/h1>/);
  assert.match(html, /class="entry-folio">P\.001 \/ PHOTO/);
  assert.match(html, /alt="写真 2026\.08\.16"/);
  assert.match(html, /max-height:min\(82svh,980px\);object-fit:contain/);
  assert.match(html, /\.photo-page \.entry-nav a:focus-visible/);
  assert.doesNotMatch(html, /LOCAL GRAPH/);
});

test('写真投稿で画像がない場合は公開を拒否する', async t => {
  const root = await makeSite({
    'photo-missing.md': `---
post_type: photo
date: 2026-08-16
---
`
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const result = await runGenerator(root, '--check');
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /写真投稿では photo は必須/);
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
  assert.match(result.stderr, /card_size は auto、s、m、l/);
});

test('Notes一覧は内容別サイズと順序を守る空き詰めレイアウトを持つ', async () => {
  const source = await fs.readFile(path.join(sourceRoot, 'notes', 'index.html'), 'utf8');
  assert.match(source, /data-type="\$\{type\}"/);
  assert.match(source, /const spans=\{s:\{s:2,m:3,l:4\},m:\{s:3,m:4,l:5\},l:\{s:4,m:5,l:7\}\}/);
  assert.match(source, /data-copy="\$\{copy\}"/);
  assert.match(source, /autoSpans=\{s:\{brief:2,standard:2,long:3,image:3,photo:4\},m:\{brief:2,standard:3,long:3,image:3,photo:5\},l:\{brief:3,standard:4,long:4,image:4,photo:6\}\}/);
  assert.match(source, /compactAutoSpans=\{s:\{brief:3,standard:3,long:4,image:4,photo:5\},m:\{brief:3,standard:4,long:4,image:4,photo:6\},l:\{brief:4,standard:5,long:5,image:5,photo:8\}\}/);
  assert.match(source, /card\.dataset\.sizeMode==='auto'/);
  assert.match(source, /mode==='auto'\?\(type==='photo'\?'l':post\.image\?'m':'s'\)/);
  assert.match(source, /let sequenceFloor=0/);
  assert.match(source, /index===cards\.length-1&&cards\.length>1&&span<=6/);
  assert.match(source, /terminalTolerance=Math\.max\(1,Math\.ceil\(48\/row\)\)/);
  assert.match(source, /distance=Math\.abs\(start-center\)/);
  assert.match(source, /top<=terminalTop\+terminalTolerance&&distance<centerDistance/);
  assert.match(source, /new ResizeObserver\(queueLayout\)/);
  assert.match(source, /observeCardSizes\(\)/);
  assert.match(source, /<summary aria-controls="filterOptions"><span>FILTERS<\/span>/);
  assert.match(source, /if\(filterMore\.open&&!filterMore\.contains\(event\.target\)\)filterMore\.open=false/);
  assert.match(source, /event\.key==='Escape'&&filterMore\.open/);
  assert.match(source, /filterMore\.open=false;filterSummary\.focus\(\)/);
  assert.match(source, /filterMore\.open=false;updateUrl\(\);search\.focus\(\)/);
  assert.match(source, /data-has-image=/);
  assert.match(source, /post\.postType==='photo'/);
  assert.match(source, /post-card\[data-type="photo"\]/);
  assert.match(source, /max-height:min\(68vh,560px\)/);
  assert.match(source, /`\$\{img\.naturalWidth\}\/\$\{img\.naturalHeight\}`/);
  assert.match(source, /loading="\$\{priority\?'eager':'lazy'\}"/);
  assert.match(source, /--column-gap:clamp\(18px,2\.2vw,34px\)/);
  assert.match(source, /\.post-card>a:focus-visible\{outline:1px solid var\(--red\)/);
  assert.match(source, /\.post-card:hover>a::before,\.post-card:focus-within>a::before\{opacity:1/);
  assert.match(source, /\.post-card:hover \.card-media::after,\.post-card:focus-within \.card-media::after/);
  assert.match(source, /:root\{--dim:#756e62\}/);
  assert.match(source, /\.card-excerpt\{font-size:\.78rem\}/);
  assert.match(source, /Number\.isInteger\(post\.archiveNumber\)\?post\.archiveNumber:posts\.indexOf\(post\)\+1/);
  assert.match(source, /String\(archiveNumber\)\.padStart\(3,'0'\)/);
  assert.doesNotMatch(source, /String\(index\+1\)\.padStart\(3,'0'\)/);
  assert.match(source, /id="filterState"/);
  assert.match(source, /id="clearFilters"/);
  assert.match(source, /clearFilters\.hidden=!active/);
  assert.match(source, /filters\.addEventListener\('submit',event=>event\.preventDefault\(\)\)/);
  assert.match(source, /clearFilters\.addEventListener\('click',\(\)=>\{clearTimeout\(timer\);search\.value='';tag\.value='';year\.value='';filterMore\.open=false;updateUrl\(\);search\.focus\(\)\}\)/);
  assert.match(source, /\.filter-options\{left:-1px;right:auto;min-width:0;width:min\(88vw,360px\);max-width:calc\(100vw - 24px\)\}/);
  assert.match(source, /filter-more\[open\] \.filter-options\{position:static/);
  assert.match(source, /id="postGrid" aria-label="投稿一覧"/);
  assert.doesNotMatch(source, /id="postGrid" aria-live=/);
  assert.doesNotMatch(source, /\.post-card\{[^}]*border-top:/);
  assert.doesNotMatch(source, /\.card-media\{[^}]*border:/);
});
