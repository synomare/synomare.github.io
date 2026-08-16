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

async function makeSite(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'synomare-notes-'));
  await fs.mkdir(path.join(root, 'notes', 'content'), { recursive: true });
  await fs.copyFile(templatePath, path.join(root, 'notes', 'post-template.html'));
  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(root, 'notes', 'content', name), content, 'utf8');
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
  });
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
