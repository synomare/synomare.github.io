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
