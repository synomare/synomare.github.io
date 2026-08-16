import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(testDir, '..');
const generatorPath = path.join(sourceRoot, 'scripts', 'build-works.mjs');

async function makeSite(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'synomare-works-'));
  await fs.mkdir(path.join(root, 'works', 'content'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'works.html'),
    '<main>\n<!-- WORKS:START -->\nold\n<!-- WORKS:END -->\n</main>\n',
    'utf8'
  );
  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(root, 'works', 'content', name), content, 'utf8');
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

test('作品Markdownから一覧HTMLとJSONを生成する', async t => {
  const root = await makeSite({
    'sample-work.md': `---
title: サンプル作品
year: "2026"
summary: 日本語の作品説明です。
type: グラフィック / Graphic
url: https://example.com/work
image: /assets/images/works/sample.jpg
priority: 5
---
`
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const result = await runGenerator(root);
  assert.equal(result.code, 0, result.stderr);
  const html = await fs.readFile(path.join(root, 'works.html'), 'utf8');
  assert.match(html, /サンプル作品/);
  assert.match(html, /class="work-row has-image"/);
  assert.match(html, /target="_blank" rel="noopener"/);
  const works = JSON.parse(await fs.readFile(path.join(root, 'works', 'works.json'), 'utf8'));
  assert.equal(works[0].slug, 'sample-work');
});

test('作品削除後は一覧からも消える', async t => {
  const root = await makeSite({
    'remove-me.md': `---
title: 削除作品
year: "2025"
summary: 削除確認用です。
type: Text
---
`
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  assert.equal((await runGenerator(root)).code, 0);
  await fs.rm(path.join(root, 'works', 'content', 'remove-me.md'));
  const result = await runGenerator(root);
  assert.equal(result.code, 0, result.stderr);
  const html = await fs.readFile(path.join(root, 'works.html'), 'utf8');
  assert.doesNotMatch(html, /削除作品/);
  assert.match(html, /まだ作品が登録されていません/);
});

test('下書き作品は一覧とJSONに出さない', async t => {
  const root = await makeSite({
    'draft-work.md': `---
title: 下書き作品
year: "2026"
summary: 下書き確認用です。
type: Text
draft: true
---
`
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const result = await runGenerator(root);
  assert.equal(result.code, 0, result.stderr);
  const html = await fs.readFile(path.join(root, 'works.html'), 'utf8');
  assert.doesNotMatch(html, /下書き作品/);
  const works = JSON.parse(await fs.readFile(path.join(root, 'works', 'works.json'), 'utf8'));
  assert.deepEqual(works, []);
});

test('不正な作品slugを拒否する', async t => {
  const root = await makeSite({
    'Bad_Work.md': `---
title: 不正作品
year: "2025"
summary: 概要です。
type: Text
---
`
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const result = await runGenerator(root, '--check');
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /slug は英小文字/);
});

test('危険な作品画像URLを拒否する', async t => {
  const root = await makeSite({
    'bad-image.md': `---
title: 不正画像
year: "2025"
summary: 概要です。
type: Text
image: javascript:alert(1)
---
`
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const result = await runGenerator(root, '--check');
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /image は \/ から始まる/);
});
