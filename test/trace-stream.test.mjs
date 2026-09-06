import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { publishTraceBatch } from '../notes-admin/src/traceGithub.js';
import {
  createTrace,
  filterTracePlate,
  lexicalEchoes,
  mergeRemoteTraces,
  parseMotifInput,
  parseTraceMarkdown,
  resolveTraceConflict,
  reviseTrace,
  serializeTraceMarkdown,
  traceSignature
} from '../notes-admin/src/traces.js';

test('Traceは本文だけで作成でき、既定ではローカル保存になる', () => {
  const trace = createTrace({ content: 'タイトルなしの断片', date: new Date('2026-08-22T03:00:00Z') });
  assert.match(trace.id, /^tr_20260822030000_/);
  assert.equal(trace.visibility, 'local');
  assert.equal(trace.syncStatus, 'local');
  assert.equal(trace.kind, 'note');
});

test('Motif入力は読点・カンマ・改行を同じ境界として扱う', () => {
  assert.deepEqual(parseMotifInput('制御、身体, 保存\n制御'), ['制御', '身体', '保存']);
});

test('改稿は旧本文をrevisionへ残し、公開Traceを同期待ちにする', () => {
  const original = createTrace({ content: '旧本文', visibility: 'public', date: new Date('2026-08-01T00:00:00Z') });
  const revised = reviseTrace({ ...original, syncStatus: 'synced', remotePublished: true }, { content: '新本文' }, new Date('2026-08-22T00:00:00Z'));
  assert.equal(revised.content, '新本文');
  assert.equal(revised.revisions.length, 1);
  assert.equal(revised.revisions[0].content, '旧本文');
  assert.equal(revised.syncStatus, 'queued');
});

test('一度公開したTraceをローカルへ戻すとremote削除待ちになる', () => {
  const trace = { ...createTrace({ content: '公開済み', visibility: 'public' }), syncStatus: 'synced', remotePublished: true };
  const local = reviseTrace(trace, { visibility: 'local' });
  assert.equal(local.pendingDelete, true);
  assert.equal(local.syncStatus, 'queued-delete');
});

test('公開Markdownは現在本文・関係・履歴を往復できる', () => {
  const base = createTrace({
    id: 'tr_roundtrip',
    content: '現在の本文',
    visibility: 'public',
    motifs: ['圧縮と展開'],
    relation: { type: 'continues', target: 'tr_old' },
    date: new Date('2026-08-22T00:00:00Z')
  });
  const trace = reviseTrace(base, { content: '改稿された本文' }, new Date('2026-08-23T00:00:00Z'));
  const parsed = parseTraceMarkdown(serializeTraceMarkdown(trace), trace.id);
  assert.equal(parsed.content, '改稿された本文');
  assert.deepEqual(parsed.motifs, ['圧縮と展開']);
  assert.deepEqual(parsed.relations, [{ type: 'continues', target: 'tr_old' }]);
  assert.equal(parsed.revisions[0].content, '現在の本文');
});

test('語彙Echoは共通語と共通Motifを説明可能な形で返す', () => {
  const query = createTrace({ id: 'query', content: '短歌の語には映像のレイヤーが圧縮されている', motifs: ['短歌'] });
  const close = createTrace({ id: 'close', content: '短歌における複数の映像レイヤーを展開する', motifs: ['短歌'] });
  const far = createTrace({ id: 'far', content: '冷蔵庫を買い替える', motifs: ['生活'] });
  const echoes = lexicalEchoes(query, [close, far]);
  assert.equal(echoes[0].trace.id, 'close');
  assert.ok(echoes[0].sharedWords.length || echoes[0].sharedMotifs.length);
});

test('remoteが変化していなければローカル改稿を維持し、remoteも変化しいれば競合にする', () => {
  const remote = parseTraceMarkdown(serializeTraceMarkdown(createTrace({ id: 'same', content: 'remote v1', visibility: 'public' })), 'same');
  const localBase = { ...remote, lastSyncedSignature: traceSignature(remote) };
  const localEdit = reviseTrace(localBase, { content: 'local v2' });
  const safe = mergeRemoteTraces([localEdit], [remote]).find(trace => trace.id === 'same');
  assert.equal(safe.syncStatus, 'queued');

  const remoteEdit = reviseTrace(remote, { content: 'remote v2' });
  const conflict = mergeRemoteTraces([localEdit], [{ ...remoteEdit, syncStatus: 'synced', remotePublished: true }]).find(trace => trace.id === 'same');
  assert.equal(conflict.syncStatus, 'conflict');
  assert.equal(resolveTraceConflict(conflict, 'remote').content, 'remote v2');
  assert.equal(resolveTraceConflict(conflict, 'local').syncStatus, 'queued');
});

test('Plateは問いと対立関係を決定的に抽出する', () => {
  const a = createTrace({ id: 'a', content: 'これは問いか？', kind: 'question' });
  const b = createTrace({ id: 'b', content: '反対の主張', relation: { type: 'contrasts', target: 'a' } });
  assert.deepEqual(filterTracePlate([a, b], { plate: 'questions' }).map(trace => trace.id), ['a']);
  assert.deepEqual(new Set(filterTracePlate([a, b], { plate: 'tensions' }).map(trace => trace.id)), new Set(['a', 'b']));
});


test('Trace同期は公開Traceとremote削除を同一commitへ入れる', async t => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: String(url), method: options.method || 'GET', body });
    if (String(url).endsWith('/git/ref/heads/main')) return Response.json({ object: { sha: 'base' } });
    if (String(url).endsWith('/git/commits/base')) return Response.json({ tree: { sha: 'tree-base' } });
    if (String(url).endsWith('/git/blobs')) return Response.json({ sha: 'blob-new' }, { status: 201 });
    if (String(url).endsWith('/git/trees')) return Response.json({ sha: 'tree-new' }, { status: 201 });
    if (String(url).endsWith('/git/commits')) return Response.json({ sha: 'commit-new' }, { status: 201 });
    if (String(url).endsWith('/git/refs/heads/main')) return Response.json({ object: { sha: 'commit-new' } });
    return Response.json({ message: 'unexpected' }, { status: 500 });
  };
  const trace = createTrace({ id: 'tr_public', content: '公開するTrace', visibility: 'public' });
  const result = await publishTraceBatch({ token: 'memory-only', baseSha: 'base', traces: [trace], deletions: ['tr_deleted'] });
  assert.equal(result.sha, 'commit-new');
  const tree = calls.find(call => call.url.endsWith('/git/trees'));
  assert.deepEqual(tree.body.tree.map(entry => [entry.path, entry.sha]), [
    ['notes/traces/tr_public.md', 'blob-new'],
    ['notes/traces/tr_deleted.md', null]
  ]);
  const update = calls.find(call => call.method === 'PATCH' && call.url.endsWith('/git/refs/heads/main'));
  assert.equal(update.body.force, false);
});

test('Trace StreamはNotesと別chunkで読み込み、OAuth tokenを永続化しない', async () => {
  const [main, app, view, store] = await Promise.all([
    readFile(new URL('../notes-admin/src/main.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../notes-admin/src/TraceApp.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../notes-admin/src/TraceView.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../notes-admin/src/traceStore.js', import.meta.url), 'utf8')
  ]);
  assert.match(main, /lazy\(\(\) => import\('\.\/TraceApp\.jsx'\)\)/);
  assert.match(main, /get\('view'\) === 'stream'/);
  assert.doesNotMatch(`${app}\n${store}`, /(?:localStorage|sessionStorage)[\s\S]{0,80}token/i);
  assert.match(view, /PUBLIC REPOは公開リポジトリへMarkdownを書き込みます/);
});
