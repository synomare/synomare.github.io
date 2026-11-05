import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addBridgeToFold,
  addTracesToFold,
  createFold,
  foldStats,
  moveFoldBlock,
  removeFoldBlock,
  serializeFoldMarkdown,
  toggleTraceBlockPin,
  updateBridgeBlock,
  usedTraceIds
} from '../notes-admin/src/folds.js';
import { buildFieldMatrix, fieldSummary, motifIntersection, relationStats } from '../notes-admin/src/field.js';
import { previewHtml } from '../notes-admin/src/preview.js';
import { readFile } from 'node:fs/promises';

const traces = [
  { id: 'a', content: 'A current', createdAt: '2026-06-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z', motifs: ['control', 'body'], relations: [], revisions: [], kind: 'note', deleted: false },
  { id: 'b', content: 'B current', createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z', motifs: ['control'], relations: [{ type: 'contrasts', target: 'a' }], revisions: [], kind: 'question', deleted: false },
  { id: 'c', content: 'C current', createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z', motifs: [], relations: [{ type: 'cites', target: 'missing' }], revisions: [{ id: 'r', content: 'old' }], kind: 'note', deleted: false }
];
const byId = new Map(traces.map(trace => [trace.id, trace]));

test('FoldはTraceの順序と出典を保持してMarkdownへ線形化する', () => {
  const fold = createFold({ id: 'fold_test', title: 'Test', traceIds: ['a', 'b'], date: new Date('2026-08-22T00:00:00Z') });
  const markdown = serializeFoldMarkdown(fold, byId);
  assert.match(markdown, /\[trace-source-1\]: trace:a "mode=live;/);
  assert.ok(markdown.indexOf('A current') < markdown.indexOf('B current'));
});

test('Foldのtrace-source参照定義はNotesプレビューへ可視表示されない', () => {
  const fold = createFold({ traceIds: ['a'] });
  const markdown = serializeFoldMarkdown(fold, byId);
  const html = previewHtml(markdown);
  assert.match(html, /A current/);
  assert.doesNotMatch(html, /trace-source-1/);
  assert.doesNotMatch(html, /mode=live/);
});

test('Pinned blockは元Traceが変化しても固定本文を使う', () => {
  let fold = createFold({ traceIds: ['a'] });
  fold = toggleTraceBlockPin(fold, fold.blocks[0].id, traces[0]);
  const changed = new Map(byId);
  changed.set('a', { ...traces[0], content: 'A later' });
  assert.match(serializeFoldMarkdown(fold, changed), /A current/);
  assert.doesNotMatch(serializeFoldMarkdown(fold, changed), /A later/);
});

test('Bridgeの追加・改稿・移動・削除を行える', () => {
  let fold = createFold({ traceIds: ['a'] });
  fold = addBridgeToFold(fold, '接続文');
  const bridge = fold.blocks[1];
  fold = updateBridgeBlock(fold, bridge.id, '改稿した接続文');
  fold = moveFoldBlock(fold, bridge.id, 'up');
  assert.equal(fold.blocks[0].content, '改稿した接続文');
  fold = removeFoldBlock(fold, bridge.id);
  assert.equal(fold.blocks.length, 1);
});

test('同じTraceはFoldへ重複追加せず使用済み集合を作る', () => {
  let fold = createFold({ traceIds: ['a'] });
  fold = addTracesToFold(fold, ['a', 'b']);
  assert.deepEqual(fold.blocks.filter(block => block.type === 'trace').map(block => block.traceId), ['a', 'b']);
  assert.deepEqual(usedTraceIds([fold]), new Set(['a', 'b']));
  assert.equal(foldStats(fold, byId).traceBlocks, 2);
});

test('Field matrixでは同じTraceが複数Motifの行へ現れる', () => {
  const matrix = buildFieldMatrix(traces);
  const control = matrix.rows.find(row => row.motif === 'control');
  const body = matrix.rows.find(row => row.motif === 'body');
  assert.ok(control.cells.some(cell => cell.ids.includes('a')));
  assert.ok(body.cells.some(cell => cell.ids.includes('a')));
  assert.ok(matrix.rows.some(row => row.motif === '∅ UNPLACED'));
});

test('Motif交差・関係集計・Field要約は決定的に計算される', () => {
  assert.deepEqual(motifIntersection(traces, ['control', 'body']).map(trace => trace.id), ['a']);
  const relations = relationStats(traces);
  assert.equal(relations.total, 2);
  assert.equal(relations.unresolved, 1);
  const fold = createFold({ traceIds: ['a'] });
  assert.deepEqual(fieldSummary(traces, [fold]), {
    traces: 3,
    motifs: 2,
    relations: 2,
    folds: 1,
    used: 1,
    unused: 2,
    questions: 1,
    revisions: 1
  });
});

test('FieldとFoldはTrace Stream内の独立Surfaceとして接続される', async () => {
  const [main, view, store] = await Promise.all([
    readFile(new URL('../notes-admin/src/main.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../notes-admin/src/TraceView.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../notes-admin/src/traceStore.js', import.meta.url), 'utf8')
  ]);
  assert.match(main, /field-fold\.css/);
  assert.match(view, /<FieldView/);
  assert.match(view, /<FoldStudio/);
  assert.match(view, /serializeFoldMarkdown/);
  assert.match(view, /saveDraft\('note:new'/);
  assert.match(store, /DB_VERSION = 2/);
  assert.match(store, /FOLD_STORE = 'folds'/);
});
