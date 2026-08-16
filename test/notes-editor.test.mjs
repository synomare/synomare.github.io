import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateSlug, newNote, parseDocument, parseOAuthMessage, serializeDocument } from '../notes-admin/src/lib.js';
import { documentStats, outlineFromBody, preflightIssues } from '../notes-admin/src/editorTools.js';
import { previewHtml } from '../notes-admin/src/preview.js';
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

test('写真投稿はタイトルと本文なしで画像をfrontmatterへ保存する', () => {
  const note = { ...newNote([]), postType: 'photo', photo: '/assets/images/notes/photo.jpg', date: '2026-08-16' };
  const markdown = serializeDocument(note);
  assert.match(markdown, /post_type: photo/);
  assert.match(markdown, /photo: \/assets\/images\/notes\/photo\.jpg/);
  assert.match(markdown, /card_size: auto/);
  assert.doesNotMatch(markdown, /^title:/m);
  const parsed = parseDocument(markdown, note.slug);
  assert.equal(parsed.postType, 'photo');
  assert.equal(parsed.photo, '/assets/images/notes/photo.jpg');
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

test('画像追加時のMarkdownへ元ファイル名を表示用テキストとして入れない', async () => {
  const source = await readFile(new URL('../notes-admin/src/App.jsx', import.meta.url), 'utf8');
  assert.match(source, /prepared\.images\.map\(image => `!\[\]\(\/\$\{image\.path\}\)`\)/);
  assert.doesNotMatch(source, /!\[\$\{image\.originalName/);
});

test('iPhone編集画面は記事選択、本文、固定公開操作を優先する', async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL('../notes-admin/src/App.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../notes-admin/src/overrides.css', import.meta.url), 'utf8')
  ]);
  assert.match(app, /className="editor-brand"/);
  assert.match(app, /className="editor-session"/);
  assert.ok(app.indexOf('className="details"') < app.indexOf('className="editor-actions"'));
  assert.match(app, /<details className="inspector"/);
  assert.match(styles, /@media \(max-width: 560px\)/);
  assert.match(styles, /safe-area-inset-bottom/);
  assert.match(styles, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(styles, /font-size: 16px !important/);
});

test('本文統計と見出しアウトラインを生成する', () => {
  const body = '導入です。\n\n## 最初の見出し\n\n本文です。\n\n### 小見出し';
  assert.deepEqual(outlineFromBody(body), [
    { level: 2, text: '最初の見出し', line: 3 },
    { level: 3, text: '小見出し', line: 7 }
  ]);
  const stats = documentStats(body);
  assert.equal(stats.headings, 2);
  assert.equal(stats.minutes, 1);
  assert.ok(stats.characters > 10);
});

test('公開前チェックは必須項目と未解決リンクを区別する', () => {
  const note = { ...newNote([]), title: '', body: '[[まだない記事]]' };
  const issues = preflightIssues(note, [], false);
  assert.ok(issues.some(issue => issue.level === 'error' && /タイトル/.test(issue.text)));
  assert.ok(issues.some(issue => issue.level === 'warning' && /未解決リンク/.test(issue.text)));
  const valid = { ...note, title: '記事', body: '[[既存]]' };
  assert.deepEqual(preflightIssues(valid, [{ slug: 'known', title: '既存', aliases: [] }], false), []);
});

test('Markdownプレビューは生HTMLを実行せず内部リンクを表示する', () => {
  const html = previewHtml('<script>alert(1)</script>\n\n[[記事|表示名]]');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, />表示名<\/a>/);
});

test('エディターは書式、プレビュー、貼り付け画像、コピーを提供する', async () => {
  const [app, editor, tools] = await Promise.all([
    readFile(new URL('../notes-admin/src/App.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../notes-admin/src/MarkdownEditor.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../notes-admin/src/EditorTools.jsx', import.meta.url), 'utf8')
  ]);
  assert.match(app, /COPY MD/);
  assert.match(app, /<MarkdownPreview/);
  assert.match(app, /<PublishCheck/);
  assert.match(editor, /paste: event/);
  assert.match(editor, /drop: event/);
  assert.match(editor, /Mod-Shift-k/);
  assert.match(tools, /\['edit', 'split', 'preview'\]/);
  assert.match(tools, /toUpperCase\(\)/);
  assert.match(tools, /OUTLINE/);
});

test('画像は拡張子やMIME表記だけに頼らずファイル内容から判別する', async () => {
  const asFile = (bytes, name, type = '') => Object.assign(new Blob([Uint8Array.from(bytes)], { type }), { name });
  assert.equal(await detectImageType(asFile([0xff, 0xd8, 0xff, 0x00], '写真.BIN')), 'image/jpeg');
  assert.equal(await detectImageType(asFile([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'image')), 'image/png');
  assert.equal(await detectImageType(new Blob(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], { type: '' })), 'image/svg+xml');
  assert.match(IMAGE_ACCEPT, /\.heic/);
});
