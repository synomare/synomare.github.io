import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateSlug, newNote, parseDocument, parseOAuthMessage, serializeDocument } from '../notes-admin/src/lib.js';
import { changeHeadingLevel, changeLineDepth, continueMarkdownBlock, documentStats, hierarchyDepthAt, outlineFromBody, preflightIssues } from '../notes-admin/src/editorTools.js';
import { previewHtml } from '../notes-admin/src/preview.js';
import { collectTags, duplicateDocument, filterDocuments } from '../notes-admin/src/articleLibrary.js';
import { publishAtomic, publishBatch } from '../notes-admin/src/github.js';
import { detectImageType, IMAGE_ACCEPT } from '../notes-admin/src/images.js';
import { analyzeLinks, collectImages, collectTagStats, renameTagInDocuments } from '../notes-admin/src/operations.js';

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

test('本文の階層をMarkdown互換のまま行単位で調整できる', () => {
  assert.equal(changeLineDepth('- 親\n- 子', 0, 7, 1).text, '  - 親\n  - 子');
  assert.equal(changeLineDepth('  - 子', 0, 6, -1).text, '- 子');
  assert.equal(changeLineDepth('## 見出し', 0, 6, 1).text, '### 見出し');
  assert.equal(changeHeadingLevel('### 見出し', 0, 6, -1).text, '## 見出し');
  assert.equal(hierarchyDepthAt('## 見出し', 0), 1);
  assert.equal(hierarchyDepthAt('    - 子', 5), 2);
});

test('リスト入力はEnterで同じ階層を継承し空項目で階層を抜ける', () => {
  const calls = [];
  const view = (text, position) => ({
    state: { selection: { main: { from: position, to: position } }, doc: { lineAt: () => ({ from: 0, text }) } },
    dispatch: change => calls.push(change)
  });
  assert.equal(continueMarkdownBlock(view('  - 項目', 6)), true);
  assert.equal(calls.at(-1).changes.insert, '\n  - ');
  assert.equal(continueMarkdownBlock(view('  - ', 4)), true);
  assert.equal(calls.at(-1).changes.insert, '\n');
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
  const [app, editor, tools, operations] = await Promise.all([
    readFile(new URL('../notes-admin/src/App.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../notes-admin/src/MarkdownEditor.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../notes-admin/src/EditorTools.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../notes-admin/src/OperationsPanel.jsx', import.meta.url), 'utf8')
  ]);
  assert.match(app, /COPY MD/);
  assert.match(app, /<MarkdownPreview/);
  assert.match(app, /<PublishCheck/);
  assert.match(editor, /paste: event/);
  assert.match(editor, /drop: event/);
  assert.match(editor, /Mod-Shift-k/);
  assert.match(editor, /key: 'Tab'/);
  assert.match(editor, /key: 'Shift-Tab'/);
  assert.match(editor, /continueMarkdownBlock/);
  assert.match(editor, /insertMarkdown/);
  assert.match(tools, /\['edit', 'split', 'preview'\]/);
  assert.match(tools, /toUpperCase\(\)/);
  assert.match(tools, /OUTLINE/);
  assert.match(tools, /DEPTH −/);
  assert.match(tools, /LEVEL \+/);
  assert.match(app, /<OperationsPanel/);
  assert.match(operations, /TAG MANAGEMENT/);
  assert.match(operations, /IMAGE LIBRARY/);
  assert.match(operations, /LINK MAINTENANCE/);
});

test('記事ライブラリは本文・タグ・公開状態で絞り込み並べ替える', () => {
  const documents = [
    { slug: 'old', title: '古い記録', date: '2026-01-01', postType: 'text', draft: false, summary: '', body: '庭の本文', tags: ['庭'], aliases: [] },
    { slug: 'new', title: '新しい写真', date: '2026-08-17', postType: 'photo', draft: true, summary: '海辺', body: '', tags: ['写真', '海'], aliases: [] }
  ];
  assert.deepEqual(collectTags(documents), ['海', '写真', '庭']);
  assert.deepEqual(filterDocuments(documents, { query: '庭' }).map(document => document.slug), ['old']);
  assert.deepEqual(filterDocuments(documents, { type: 'photo', status: 'draft', tag: '海' }).map(document => document.slug), ['new']);
  assert.deepEqual(filterDocuments(documents, { sort: 'oldest' }).map(document => document.slug), ['old', 'new']);
});

test('過去記事の複製は新slugの下書きとして作る', () => {
  const source = { ...newNote([]), slug: 'original', title: '原稿', date: '2026-01-01', body: '本文', draft: false, existing: true };
  const duplicated = duplicateDocument(source, ['original']);
  assert.notEqual(duplicated.slug, source.slug);
  assert.equal(duplicated.title, '原稿 — copy');
  assert.equal(duplicated.body, '本文');
  assert.equal(duplicated.draft, true);
  assert.equal(duplicated.existing, false);
});

test('専用エディターは記事ライブラリと複数タグUIを持つ', async () => {
  const [app, library, tokens] = await Promise.all([
    readFile(new URL('../notes-admin/src/App.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../notes-admin/src/ArticleLibrary.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../notes-admin/src/TokenEditor.jsx', import.meta.url), 'utf8')
  ]);
  assert.match(app, /<ArticleLibrary/);
  assert.match(app, /<TokenEditor label="TAGS"/);
  assert.match(library, /SEARCH/);
  assert.match(library, /DUPLICATE/);
  assert.match(library, /OPEN LIVE/);
  assert.match(library, /article-library-entry/);
  assert.match(tokens, /event\.key === 'Enter'/);
  assert.match(tokens, /nativeEvent\.isComposing/);
  assert.match(tokens, /currentValues\.map/);
  assert.match(tokens, /className="token-add"/);
});

test('記事運用ツールはタグ・画像・リンクの保守データを作る', () => {
  const documents = [
    { slug: 'one', title: '一つ目', date: '2026-08-17', draft: false, tags: ['制作', '記録'], aliases: ['最初'], postType: 'text', photo: '', body: '![](\/assets\/images\/notes\/one.webp)\n\n[[最初]] [[存在しない]]' },
    { slug: 'two', title: '二つ目', date: '2026-08-16', draft: false, tags: ['制作'], aliases: ['最初'], postType: 'text', photo: '', body: '' },
    { slug: 'photo', title: '写真', date: '2026-08-15', draft: true, tags: ['写真'], aliases: [], postType: 'photo', photo: '/assets/images/notes/photo.webp', body: '' }
  ];
  assert.equal(collectTagStats(documents).find(tag => tag.name === '制作').count, 2);
  assert.equal(collectImages(documents).length, 2);
  const links = analyzeLinks(documents);
  assert.equal(links.unresolved[0].target, '存在しない');
  assert.equal(links.ambiguous[0].target, '最初');
  assert.ok(links.orphans.some(article => article.slug === 'photo'));
  const renamed = renameTagInDocuments(documents, '制作', '展示');
  assert.deepEqual(renamed.changedSlugs, ['one', 'two']);
  assert.deepEqual(renamed.documents.find(document => document.slug === 'one').tags, ['展示', '記録']);
});

test('複数記事のタグ変更を一つのGit commitへ保存する', async t => {
  const originalFetch = globalThis.fetch; const calls = [];
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options = {}) => { const body = options.body ? JSON.parse(options.body) : null; calls.push({ url: String(url), method: options.method || 'GET', body });
    if (String(url).endsWith('/git/ref/heads/main')) return Response.json({ object: { sha: 'base' } });
    if (String(url).endsWith('/git/commits/base')) return Response.json({ tree: { sha: 'tree-base' } });
    if (String(url).endsWith('/git/blobs')) return Response.json({ sha: `blob-${calls.length}` }, { status: 201 });
    if (String(url).endsWith('/git/trees')) return Response.json({ sha: 'tree-new' }, { status: 201 });
    if (String(url).endsWith('/git/commits')) return Response.json({ sha: 'commit-new' }, { status: 201 });
    if (String(url).endsWith('/git/refs/heads/main')) return Response.json({ object: { sha: 'commit-new' } });
    return Response.json({ message: 'unexpected' }, { status: 500 });
  };
  const sha = await publishBatch({ token: 'memory-only', baseSha: 'base', entries: [{ slug: 'one', markdown: '# 1' }, { slug: 'two', markdown: '# 2' }] });
  assert.equal(sha, 'commit-new');
  const tree = calls.find(call => call.url.endsWith('/git/trees'));
  assert.deepEqual(tree.body.tree.map(item => item.path), ['notes/content/one.md', 'notes/content/two.md']);
});

test('画像は拡張子やMIME表記だけに頼らずファイル内容から判別する', async () => {
  const asFile = (bytes, name, type = '') => Object.assign(new Blob([Uint8Array.from(bytes)], { type }), { name });
  assert.equal(await detectImageType(asFile([0xff, 0xd8, 0xff, 0x00], '写真.BIN')), 'image/jpeg');
  assert.equal(await detectImageType(asFile([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'image')), 'image/png');
  assert.equal(await detectImageType(new Blob(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], { type: '' })), 'image/svg+xml');
  assert.match(IMAGE_ACCEPT, /\.heic/);
});
