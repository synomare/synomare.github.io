import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateSlug, newNote, parseDocument, parseOAuthMessage, serializeDocument } from '../notes-admin/src/lib.js';
import { changeHeadingLevel, changeLineDepth, continueMarkdownBlock, documentStats, hierarchyDepthAt, noteCompletionOptions, outlineFromBody, preflightIssues, selectionSupportsHierarchyTab } from '../notes-admin/src/editorTools.js';
import { createLocalDraftKey, draftKeyFor } from '../notes-admin/src/drafts.js';
import { previewHtml } from '../notes-admin/src/preview.js';
import { articleFolios, collectTags, draftLibraryItems, duplicateDocument, filterDocuments, filterLocalDraftItems, localDraftIndex, unchangedDraftRecords } from '../notes-admin/src/articleLibrary.js';
import { publishAtomic, publishBatch } from '../notes-admin/src/github.js';
import { detectImageType, IMAGE_ACCEPT } from '../notes-admin/src/images.js';
import { analyzeLinks, collectImages, collectTagStats, renameTagInDocuments } from '../notes-admin/src/operations.js';
import { moveRelatedReference, relatedReferenceIssues, relatedState } from '../notes-admin/src/relatedNotes.js';

test('エディターはJSTタイムスタンプslugと自動メタデータを生成する', () => {
  const slug = generateSlug([], new Date('2026-08-16T03:34:56Z'));
  assert.equal(slug, '20260816-123456');
  const markdown = serializeDocument({ title: '最小記事', date: '2026-08-16', summary: '', tags: [], aliases: [], cardSize: 'm', cardExcerpt: '', draft: false, body: '最初の段落です。 #日記' });
  assert.match(markdown, /summary: 最初の段落です。 日記/);
  assert.match(markdown, /- 日記/);
  assert.match(markdown, /card_size: m/);
});

test('新規記事はslugを変えても変わらない独立したローカル下書きキーを使う', () => {
  const first = { ...newNote([]), slug: '20260830-120000' };
  const second = { ...newNote([first.slug]), slug: '20260830-120001' };
  const firstKey = createLocalDraftKey('first');
  assert.equal(firstKey, 'local:first');
  first.slug = 'renamed';
  assert.equal(firstKey, 'local:first');
  assert.notEqual(firstKey, createLocalDraftKey('second'));
  assert.equal(draftKeyFor(second), 'note:20260830-120001');
});

test('内部リンク補完は同名記事をslugで区別し公開状態も示す', () => {
  const options = noteCompletionOptions([
    { slug: 'one', title: '同名', aliases: [], draft: false },
    { slug: 'two', title: '同名', aliases: ['別名'], draft: true },
    { slug: 'unique', title: '固有名', aliases: [], draft: false }
  ], '名');
  assert.deepEqual(options.map(option => option.apply), ['one]]', 'two]]', '固有名]]']);
  assert.match(options[0].detail, /PUBLIC · one/);
  assert.match(options[1].detail, /DRAFT · two/);
});

test('Tabによる階層変更はリスト・引用・複数行だけで有効になる', () => {
  assert.equal(selectionSupportsHierarchyTab('通常の段落', 3, 3), false);
  assert.equal(selectionSupportsHierarchyTab('- 箇条書き', 4, 4), true);
  assert.equal(selectionSupportsHierarchyTab('> 引用', 2, 2), true);
  assert.equal(selectionSupportsHierarchyTab('一行目\n二行目', 0, 7), true);
});

test('関連記事の手動追加・除外をfrontmatterへ保存し、既存記事で復元する', () => {
  const note = { ...newNote([]), title: '関連記事テスト', body: '本文', relatedNotes: ['destination'], relatedExclude: ['archive'] };
  const markdown = serializeDocument(note);
  assert.match(markdown, /related_notes:\n  - destination/);
  assert.match(markdown, /related_exclude:\n  - archive/);
  const parsed = parseDocument(markdown, note.slug);
  assert.deepEqual(parsed.relatedNotes, ['destination']);
  assert.deepEqual(parsed.relatedExclude, ['archive']);
});

test('関連記事の編集状態は手動追加を先頭にし、除外後の自動候補を共有タグ順で補完する', () => {
  const documents = [
    { slug: 'source', title: '起点', date: '2026-08-20', tags: ['共通'], aliases: [] },
    { slug: 'manual', title: '手動', date: '2026-08-15', tags: ['別'], aliases: ['手動alias'] },
    { slug: 'auto-new', title: '新しい自動', date: '2026-08-19', tags: ['共通'], aliases: [] },
    { slug: 'auto-old', title: '古い自動', date: '2026-08-18', tags: ['共通'], aliases: [] },
    { slug: 'excluded', title: '除外', date: '2026-08-17', tags: ['共通'], aliases: [] },
    { slug: 'available', title: 'タグなし候補', date: '2026-08-16', tags: ['別'], aliases: [] }
  ];
  const state = relatedState({ ...documents[0], relatedNotes: ['手動alias'], relatedExclude: ['除外'] }, documents);
  assert.deepEqual(state.current.map(item => [item.document.slug, item.kind]), [['manual', 'manual'], ['auto-new', 'automatic'], ['auto-old', 'automatic']]);
  assert.deepEqual(state.excluded.map(item => item.document.slug), ['excluded']);
  assert.ok(state.available.some(item => item.document.slug === 'available'));
});

test('関連記事の手動順序を移動でき、公開対象外の参照は現在欄へ混ぜない', () => {
  const documents = [
    { slug: 'source', title: '起点', date: '2026-08-20', tags: ['共通'], aliases: [], draft: false },
    { slug: 'one', title: '一つ', date: '2026-08-19', tags: [], aliases: [], draft: false },
    { slug: 'two', title: '二つ', date: '2026-08-18', tags: [], aliases: [], draft: false },
    { slug: 'draft', title: '下書き', date: '2026-08-17', tags: [], aliases: [], draft: true }
  ];
  assert.deepEqual(moveRelatedReference(['one', 'two'], 'two', -1), ['two', 'one']);
  assert.deepEqual(moveRelatedReference(['one', 'two'], 'one', -1), ['one', 'two']);
  const state = relatedState({ ...documents[0], relatedNotes: ['one', 'draft'], relatedExclude: [] }, documents);
  assert.deepEqual(state.current.map(item => item.document.slug), ['one']);
  assert.equal(state.attention[0].status, 'draft');
});

test('関連記事の不備は未解決・曖昧・自分自身・下書き・追加除外重複として警告できる', () => {
  const documents = [
    { slug: 'source', title: '起点', aliases: [], draft: false },
    { slug: 'one', title: '同名', aliases: [], draft: false },
    { slug: 'two', title: '同名', aliases: [], draft: false },
    { slug: 'draft', title: '下書き', aliases: [], draft: true }
  ];
  const issues = relatedReferenceIssues({ slug: 'source', relatedNotes: ['存在しない', '同名', 'source', 'draft', 'one'], relatedExclude: ['one'] }, documents);
  assert.deepEqual(new Set(issues.map(issue => issue.type)), new Set(['unresolved', 'ambiguous', 'self', 'draft', 'conflict']));
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
  assert.match(editor, /editor\.composing/);
  assert.match(editor, /compositionend/);
  assert.match(editor, /resetScroll/);
  assert.match(editor, /Transaction\.addToHistory\.of\(false\)/);
  assert.match(editor, /selectionSupportsHierarchyTab/);
  assert.match(app, /persistActiveDraft/);
  assert.match(app, /resetEditingPosition/);
  assert.match(app, /pagehide/);
  assert.match(app, /visibilitychange/);
  assert.match(app, /key=\{activeDraftKey\.current \|\| note\.slug\}/);
  assert.match(app, /className="file-input-proxy"/);
  assert.match(app, /BLOCKED —/);
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
  const folios = articleFolios([
    { slug: 'draft-newest', date: '2026-09-01', draft: true },
    { slug: 'published-old', date: '2026-01-01', draft: false },
    { slug: 'published-new', date: '2026-08-17', draft: false }
  ]);
  assert.deepEqual([folios.get('published-new'), folios.get('published-old'), folios.get('draft-newest')], [1, 2, 1]);
});

test('ローカル下書きはGitHub記事の変更、新規、削除済み、slug競合を区別する', () => {
  const documents = [
    { slug: 'edit', title: '公開版', date: '2026-08-17', postType: 'text', draft: false, body: '本文', tags: [], aliases: [] },
    { slug: 'collision', title: '先に公開', date: '2026-08-16', postType: 'text', draft: false, body: '', tags: [], aliases: [] }
  ];
  const records = [
    { key: 'note:edit', note: { ...documents[0], title: '端末で変更', existing: true }, images: [], sourceSlug: 'edit', savedAt: 4 },
    { key: 'local:parallel-edit', note: { ...documents[0], title: '別タブの変更', existing: true }, images: [], sourceSlug: 'edit', savedAt: 3.5 },
    { key: 'local:new', note: { slug: 'new', title: '新規', date: '2026-08-18', postType: 'text', draft: false, body: '', tags: [], aliases: [], existing: false }, images: [], sourceSlug: '', savedAt: 3 },
    { key: 'note:missing', note: { slug: 'missing', title: '復旧候補', date: '2026-08-15', postType: 'text', draft: false, body: '', tags: [], aliases: [], existing: true }, images: [], sourceSlug: 'missing', savedAt: 2 },
    { key: 'local:collision', note: { slug: 'collision', title: '衝突', date: '2026-08-14', postType: 'text', draft: false, body: '', tags: [], aliases: [], existing: false }, images: [], sourceSlug: '', savedAt: 1 }
  ];
  const items = draftLibraryItems(records, documents);
  assert.deepEqual(items.map(item => item.kind), ['edit', 'parallel', 'new', 'missing', 'conflict']);
  assert.equal(localDraftIndex(items).get('edit').key, 'note:edit');
  assert.deepEqual(filterLocalDraftItems(items, { status: 'all', sort: 'newest' }).map(item => item.slug), ['edit', 'new', 'missing', 'collision']);
  assert.deepEqual(filterLocalDraftItems(items, { status: 'public' }), []);
  const legacy = draftLibraryItems([{ key: 'note:new', note: { slug: 'legacy', title: '旧式' }, savedAt: 5 }], documents);
  assert.deepEqual(filterLocalDraftItems(legacy, { status: 'all', sort: 'newest' }).map(item => [item.slug, item.postType, item.date]), [['legacy', 'text', '']]);
});

test('GitHub版と一致した非画像下書きだけを安全な整理候補にする', () => {
  const source = { slug: 'same', title: '同じ原稿', date: '2026-08-17', postType: 'text', draft: false, body: '本文', tags: ['記録'], aliases: [] };
  const records = [
    { key: 'local:same', note: { ...source, existing: true }, images: [], sourceSlug: 'same', savedAt: 3 },
    { key: 'local:changed', note: { ...source, title: '変更あり', existing: true }, images: [], sourceSlug: 'same', savedAt: 2 },
    { key: 'local:image', note: { ...source, existing: true }, images: [{ path: 'assets/images/notes/new.webp' }], sourceSlug: 'same', savedAt: 1 }
  ];
  assert.deepEqual(unchangedDraftRecords(records, [source]).map(record => record.key), ['local:same']);
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
  const [app, library, tokens, related] = await Promise.all([
    readFile(new URL('../notes-admin/src/App.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../notes-admin/src/ArticleLibrary.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../notes-admin/src/TokenEditor.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../notes-admin/src/RelatedNotesEditor.jsx', import.meta.url), 'utf8')
  ]);
  assert.match(app, /<ArticleLibrary/);
  assert.match(app, /<TokenEditor label="TAGS"/);
  assert.match(library, /SEARCH/);
  assert.match(library, /DUPLICATE/);
  assert.match(library, /OPEN LIVE/);
  assert.match(library, /article-library-entry/);
  assert.match(library, /LOCAL DRAFTS/);
  assert.match(library, /role="alertdialog"/);
  assert.match(library, /GitHub上の記事は削除されません/);
  assert.match(app, /onResumeDraft=\{resumeLocalDraft\}/);
  assert.match(app, /onDiscardDraft=\{discardLocalDraft\}/);
  assert.match(app, /deleteDraftIfUnchanged/);
  assert.match(app, /saveDraftReplacing\(record\.key, sessionKey/);
  assert.match(app, /PARALLEL DRAFT KEPT/);
  assert.match(app, /別のタブで下書きが更新されました/);
  assert.match(library, /onDiscardDraft\(discardCandidate\)/);
  assert.match(app, /hydrated\.sourceBaseSha !== baseSha/);
  assert.match(app, /差分を確認し、ローカル原稿を採用する/);
  assert.match(app, /タグ変更はGitHubへ保存済みです。端末下書きの後処理だけ失敗/);
  assert.match(app, /if \(baseReview \|\| \(note\?\.existing && editingBaseSha\.current !== baseSha\)\)/);
  assert.match(app, /editingBaseSha\.current !== baseSha/);
  assert.match(app, /タグ変更は画面内に保持しています。DISCARDで取り消してからRELOAD/);
  assert.match(app, /noteSnapshot\.key === activeDraftKey\.current/);
  assert.match(app, /const sourceUnchanged = previousRemote && remote/);
  assert.match(library, /localDraftValue/);
  assert.match(library, /localImages: local\.images \|\| \[\]/);
  assert.match(library, /LOCAL DRAFTS UNAVAILABLE/);
  assert.match(app, /note\?\.existing && source\.slug === activeSourceSlug\.current/);
  assert.match(app, /sourceImages\.map\(image => \(\{ \.\.\.image \}\)\)/);
  assert.match(tokens, /event\.key === 'Enter'/);
  assert.match(tokens, /nativeEvent\.isComposing/);
  assert.match(tokens, /onCompositionStart/);
  assert.match(tokens, /if \(!composing\.current\) add\(input\)/);
  assert.match(tokens, /currentValues\.map/);
  assert.match(tokens, /className="token-add"/);
  assert.match(app, /<RelatedNotesEditor/);
  assert.match(app, /relatedState\(note, documents\)\.current/);
  assert.match(related, /AUTO TAGS/);
  assert.match(related, /REMOVE/);
  assert.match(related, /kind === 'automatic'/);
  assert.match(related, /CURRENT RELATED/);
  assert.match(related, /ADD \/ HIDDEN/);
  assert.match(related, /RESTORE/);
  assert.match(related, /relatedExclude/);
  assert.match(related, /MOVE|onMove|moveRelatedReference/);
  assert.match(related, /RESET AUTO/);
  assert.match(related, /REPAIR/);
});

test('記事ライブラリと運用ツールはモーダルとしてフォーカスとEscapeを管理する', async () => {
  const [app, library, operations, dialogFocus] = await Promise.all([
    readFile(new URL('../notes-admin/src/App.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../notes-admin/src/ArticleLibrary.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../notes-admin/src/OperationsPanel.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../notes-admin/src/useDialogFocus.js', import.meta.url), 'utf8')
  ]);
  assert.match(library, /role="dialog"/);
  assert.match(library, /aria-modal="true"/);
  assert.match(library, /aria-describedby="article-library-description"/);
  assert.match(library, /className="library-backdrop" aria-hidden="true"/);
  assert.match(operations, /aria-controls="operations-panel-content"/);
  assert.match(operations, /event\.stopPropagation\(\)/);
  assert.match(dialogFocus, /event\.defaultPrevented/);
  assert.match(dialogFocus, /event\.nativeEvent\?\.isComposing/);
  assert.match(dialogFocus, /document\.addEventListener\('focusin'/);
  assert.match(dialogFocus, /activeIndex <= 0/);
  assert.match(dialogFocus, /previousFocus\?\.isConnected/);
  assert.match(dialogFocus, /remainingDialog\.contains\(previousFocus\)/);
  assert.match(app, /inert=\{modalOpen \? true : undefined\}/);
  assert.match(app, /aria-hidden=\{modalOpen \? 'true' : undefined\}/);
});

test('操作通知とローカル保存状態を分離し、処理中の原稿切替を止める', async () => {
  const [app, operations, styles] = await Promise.all([
    readFile(new URL('../notes-admin/src/App.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../notes-admin/src/OperationsPanel.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../notes-admin/src/overrides.css', import.meta.url), 'utf8')
  ]);
  assert.match(app, /\[draftStatus, setDraftStatus\]/);
  assert.match(app, /setDraftStatus\('LOCAL CHANGES'\)/);
  assert.match(app, /setDraftStatus\('LOCAL DRAFT SAVED'\)/);
  assert.match(app, /setDraftStatus\('LOCAL DRAFT ERROR'\)/);
  assert.doesNotMatch(app, /setStatus\(previous => previous\.includes\('公開'\)/);
  assert.match(app, /const interactionLocked = busy \|\| imageProcessing/);
  assert.match(app, /if \(!note \|\| busy \|\| exclusiveActionActive\.current \|\| publicationActive\.current \|\| imageProcessing\) return/);
  assert.match(app, /if \(!bulkTagSlugs\.length \|\| interactionLocked \|\| exclusiveActionActive\.current \|\| publicationActive\.current\) return/);
  assert.match(app, /publicationActive\.current = true;[\s\S]*activeDraftSnapshot = await persistDraftSnapshot\(note, images, true\)/);
  assert.match(app, /const runExclusiveAction = useCallback\(async action => \{[\s\S]*exclusiveActionActive\.current = true;[\s\S]*finally \{ exclusiveActionActive\.current = false; setBusy\(false\); \}/);
  assert.match(app, /const selectNote = async slug => \{\s+if \(interactionLocked \|\| exclusiveActionActive\.current\) return;[\s\S]*return runExclusiveAction/);
  assert.match(app, /const resumeLocalDraft = async key => \{\s+if \(interactionLocked \|\| exclusiveActionActive\.current\) return;[\s\S]*return runExclusiveAction/);
  assert.match(app, /const duplicate = async source => \{\s+if \(interactionLocked \|\| exclusiveActionActive\.current\) return;[\s\S]*return runExclusiveAction/);
  assert.match(app, /const reloadRepository = async \(\) => \{\s+if \(interactionLocked \|\| exclusiveActionActive\.current\) return;[\s\S]*return runExclusiveAction/);
  assert.match(app, /const logout = async \(\) => \{\s+if \(interactionLocked \|\| exclusiveActionActive\.current\) return;[\s\S]*return runExclusiveAction/);
  assert.match(app, /refresh\(token, \{ manageBusy: false \}\)/);
  assert.match(app, /<ArticleLibrary entry disabled=\{interactionLocked\}/);
  assert.ok((app.match(/disabled=\{interactionLocked\}/g) || []).length >= 7);
  assert.match(app, /inert=\{modalOpen \|\| interactionLocked \? true : undefined\}/);
  assert.match(operations, /disabled=\{disabled\}/);
  assert.match(styles, /min-height: calc\(107px \+ env\(safe-area-inset-top\)\)/);
  assert.match(styles, /\.editor-top button \{[\s\S]*height: 44px/);
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
