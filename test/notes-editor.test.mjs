import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateSlug, parseOAuthMessage, serializeDocument } from '../notes-admin/src/lib.js';
import { publishAtomic } from '../notes-admin/src/github.js';
import { detectImageType, IMAGE_ACCEPT } from '../notes-admin/src/images.js';

test('エディターはJSTタイムスタンプslugと自動メタデータを生成する', () => {
  const slug = generateSlug([], new Date('2026-08-16T03:34:56Z'));
  assert.equal(slug, '20260816-123456');
  const markdown = serializeDocument({ title: '最小記事', date: '2026-08-16', summary: '', tags: [], aliases: [], cardSize: 'm', cardExcerpt: '', draft: false, body: '最初の段落です。 #日記' });
  assert.match(markdown, /summary: 最初の段落です。 日記/);
  assert.match(markdown, /- 日記/);
  assert.match(markdown, /card_size: m/);
});

test('OAuthメッセージは成功形式だけからtokenを読む', () => {
  assert.equal(parseOAuthMessage('authorization:github:success:{"token":"secret"}'), 'secret');
  assert.equal(parseOAuthMessage('authorization:github:error:{"token":"secret"}'), '');
  assert.equal(parseOAuthMessage('authorization:github:success:not-json'), '');
});

test('Markdown公開はmainのbase SHAを確認し単一commitをfast-forwardする', async t => {
  const originalFetch = globalThis.fetch; const calls = [];
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null; calls.push({ url: String(url), method: options.method || 'GET', body });
    if (String(url).endsWith('/git/ref/heads/main')) return Response.json({ object: { sha: 'base' } });
    if (String(url).endsWith('/git/commits/base')) return Response.json({ tree: { sha: 'tree-base' } });
    if (String(url).endsWith('/git/blobs')) return Response.json({ sha: 'blob' }, { status: 201 });
    if (String(url).endsWith('/git/trees')) return Response.json({ sha: 'tree-new' }, { status: 201 });
    if (String(url).endsWith('/git/commits')) return Response.json({ sha: 'commit-new' }, { status: 201 });
    if (String(url).endsWith('/git/refs/heads/main')) return Response.json({ object: { sha: 'commit-new' } });
    return Response.json({ message: 'unexpected' }, { status: 500 });
  };
  const sha = await publishAtomic({ token: 'memory-only', baseSha: 'base', slug: '20260816-123456', markdown: '# 本文', images: [{ path: 'assets/images/notes/test.png', file: new Blob(['image']) }], existing: false });
  assert.equal(sha, 'commit-new');
  const tree = calls.find(call => call.url.endsWith('/git/trees'));
  assert.equal(tree.body.tree[0].path, 'notes/content/20260816-123456.md');
  assert.equal(tree.body.tree[1].path, 'assets/images/notes/test.png');
  const update = calls.find(call => call.method === 'PATCH' && call.url.endsWith('/git/refs/heads/main'));
  assert.equal(update.body.force, false);
});

test('mainが進んでいたらblobやcommitを作らず競合にする', async t => {
  const originalFetch = globalThis.fetch; const calls = [];
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async url => { calls.push(String(url)); return Response.json({ object: { sha: 'newer-main' } }); };
  await assert.rejects(
    publishAtomic({ token: 'memory-only', baseSha: 'old-main', slug: 'note', markdown: '# 本文' }),
    error => error.code === 'CONFLICT'
  );
  assert.equal(calls.length, 1);
});

test('OAuth tokenを永続ストレージへ書き込むコードを含めない', async () => {
  const sources = await Promise.all([
    readFile(new URL('../notes-admin/src/App.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../notes-admin/src/drafts.js', import.meta.url), 'utf8')
  ]);
  assert.doesNotMatch(sources.join('\n'), /(?:localStorage|sessionStorage)[\s\S]{0,80}token/i);
});

test('画像は拡張子やMIME表記だけに頼らずファイル内容から判別する', async () => {
  const asFile = (bytes, name, type = '') => Object.assign(new Blob([Uint8Array.from(bytes)], { type }), { name });
  assert.equal(await detectImageType(asFile([0xff, 0xd8, 0xff, 0x00], '写真.BIN')), 'image/jpeg');
  assert.equal(await detectImageType(asFile([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'image')), 'image/png');
  assert.equal(await detectImageType(new Blob(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], { type: '' })), 'image/svg+xml');
  assert.match(IMAGE_ACCEPT, /\.heic/);
});
