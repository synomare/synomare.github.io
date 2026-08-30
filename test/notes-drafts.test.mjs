import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {
  createLocalDraftKey,
  deleteDraft,
  deleteDraftIfUnchanged,
  draftFingerprint,
  hydrateDraftForResume,
  listDrafts,
  loadDraft,
  saveDraft,
  saveDraftReplacing
} from '../notes-admin/src/drafts.js';

const DB_NAME = 'synomare-notes-editor';
const STORE = 'drafts';

function resetDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('test database deletion was blocked'));
  });
}

function putRawDraft(key, value) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error || new Error('raw test write aborted')); };
    };
  });
}

const note = (slug, overrides = {}) => ({
  slug,
  postType: 'text',
  title: '日本語の原稿',
  date: '2026-08-31',
  summary: '',
  tags: ['日記', '制作メモ'],
  aliases: [],
  relatedNotes: [],
  relatedExclude: [],
  cardSize: 'auto',
  cardExcerpt: '',
  draft: false,
  body: '本文です。',
  existing: false,
  ...overrides
});

beforeEach(resetDatabase);

test('IndexedDB下書きは日本語メタデータと画像Blobを完了後に復元しtokenを保存しない', async t => {
  const originalTransaction = IDBDatabase.prototype.transaction;
  let transactionCompleted = false;
  IDBDatabase.prototype.transaction = function patchedTransaction(...args) {
    const tx = originalTransaction.apply(this, args);
    tx.addEventListener('complete', () => { transactionCompleted = true; });
    return tx;
  };
  t.after(() => { IDBDatabase.prototype.transaction = originalTransaction; });

  const image = new File([new Uint8Array([0x52, 0x49, 0x46, 0x46])], '写真.webp', {
    type: 'image/webp',
    lastModified: 1_788_105_600_000
  });
  const key = 'local:roundtrip';
  const saved = await saveDraft(key, {
    token: 'top-secret',
    note: { ...note('20260831-120000'), token: 'nested-secret' },
    images: [{
      file: image,
      originalName: image.name,
      path: 'assets/images/notes/20260831-120000.webp',
      needsBuildConversion: false,
      token: 'image-secret'
    }],
    sourceBaseSha: 'base-sha'
  });

  assert.equal(transactionCompleted, true, 'saveDraft resolves only after the write transaction completes');
  assert.equal(saved.key, key);
  const loaded = await loadDraft(key);
  assert.deepEqual(loaded.note.tags, ['日記', '制作メモ']);
  assert.equal(loaded.note.title, '日本語の原稿');
  assert.equal(loaded.sourceBaseSha, 'base-sha');
  assert.equal(loaded.images[0].originalName, '写真.webp');
  assert.equal(loaded.images[0].file instanceof Blob, true);
  assert.equal(loaded.images[0].file.type, 'image/webp');
  assert.equal(loaded.images[0].file.size, 4);
  assert.doesNotMatch(JSON.stringify(loaded), /top-secret|nested-secret|image-secret/);
  assert.equal(Object.hasOwn(loaded.note, 'token'), false);
  assert.equal(Object.hasOwn(loaded.images[0], 'token'), false);

  const listed = await listDrafts();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].key, key);
  assert.equal(listed[0].schemaVersion, 2);
});

test('createLocalDraftKeyは指定IDを安定した不変キーにし自動IDは衝突しない', () => {
  assert.equal(createLocalDraftKey('fixed-id'), 'local:fixed-id');
  assert.equal(createLocalDraftKey('fixed-id'), 'local:fixed-id');
  const first = createLocalDraftKey();
  const second = createLocalDraftKey();
  assert.match(first, /^local:[0-9a-f-]+$/i);
  assert.match(second, /^local:[0-9a-f-]+$/i);
  assert.notEqual(first, second);
});

test('deleteDraftは指定したキーだけを削除し他の下書きを残す', async () => {
  await saveDraft('local:first', { note: note('first') });
  await saveDraft('local:second', { note: note('second', { title: '残す原稿' }) });

  await deleteDraft('local:first');

  assert.equal(await loadDraft('local:first'), null);
  assert.equal((await loadDraft('local:second')).note.title, '残す原稿');
  assert.deepEqual((await listDrafts()).map(record => record.key), ['local:second']);
});

test('deleteDraftIfUnchangedは別タブで更新された下書きを消さず同一snapshotだけ整理する', async () => {
  const first = await saveDraft('local:compare', { note: note('compare', { title: '最初の原稿' }) });
  const firstFingerprint = draftFingerprint(first.note, first.images);
  await saveDraft('local:compare', { note: note('compare', { title: '別タブで更新' }) });

  assert.equal(await deleteDraftIfUnchanged('local:compare', first.savedAt, firstFingerprint), false);
  const current = await loadDraft('local:compare');
  assert.equal(current.note.title, '別タブで更新');
  assert.equal(await deleteDraftIfUnchanged(current.key, current.savedAt, draftFingerprint(current.note, current.images)), true);
  assert.equal(await loadDraft('local:compare'), null);
});

test('saveDraftReplacingは旧キーから新キーへ一つのtransactionで移行する', async () => {
  await saveDraft('local:before', { note: note('before', { title: '移行前' }) });

  const moved = await saveDraftReplacing('local:before', 'local:after', {
    note: note('after', { title: '移行後' }),
    sourceBaseSha: 'base-after'
  });

  assert.equal(moved.key, 'local:after');
  assert.equal(await loadDraft('local:before'), null);
  assert.equal((await loadDraft('local:after')).note.title, '移行後');
  assert.deepEqual((await listDrafts()).map(record => record.key), ['local:after']);
});

test('同じsnapshotを二つの編集タブが再開しても別々のsession keyへ分岐する', async () => {
  await saveDraft('local:shared', { note: note('shared', { title: '共有時点' }), sourceBaseSha: 'base' });
  const tabA = await loadDraft('local:shared');
  const tabB = await loadDraft('local:shared');

  await saveDraftReplacing(tabA.key, 'local:tab-a', tabA);
  await saveDraftReplacing(tabB.key, 'local:tab-b', tabB);
  await saveDraft('local:tab-a', { ...tabA, note: { ...tabA.note, title: 'Aの原稿' } });
  await saveDraft('local:tab-b', { ...tabB, note: { ...tabB.note, title: 'Bの原稿' } });

  const records = await listDrafts();
  assert.deepEqual(new Set(records.map(record => record.key)), new Set(['local:tab-a', 'local:tab-b']));
  assert.deepEqual(new Set(records.map(record => record.note.title)), new Set(['Aの原稿', 'Bの原稿']));
});

test('saveDraftReplacingの移行先が使用中なら衝突とし、旧キーと既存先の両方を保存する', async () => {
  await saveDraft('local:source', { note: note('source', { title: '移行元' }) });
  await saveDraft('local:occupied', { note: note('occupied', { title: '既存先' }) });

  await assert.rejects(
    saveDraftReplacing('local:source', 'local:occupied', { note: note('replacement', { title: '上書き候補' }) }),
    error => error.code === 'DRAFT_KEY_CONFLICT'
  );

  assert.equal((await loadDraft('local:source')).note.title, '移行元');
  assert.equal((await loadDraft('local:occupied')).note.title, '既存先');
  assert.deepEqual(new Set((await listDrafts()).map(record => record.key)), new Set(['local:source', 'local:occupied']));
});

test('旧式note:newレコードを削除・改名せず一覧と再開用データへ正規化する', async () => {
  await putRawDraft('note:new', {
    note: {
      slug: 'legacy-draft',
      title: '旧式ローカル下書き',
      tags: ['古いタグ'],
      body: '復元する本文',
      existing: false,
      token: 'legacy-secret'
    },
    images: [{ originalName: '古い写真.jpg', path: 'assets/images/notes/legacy.jpg' }],
    savedAt: 1234
  });

  const records = await listDrafts();
  assert.equal(records.length, 1);
  assert.equal(records[0].key, 'note:new');
  assert.equal(records[0].schemaVersion, 2);
  assert.equal(records[0].sourceSlug, '');
  assert.equal(Object.hasOwn(records[0].note, 'token'), false);

  const resumed = hydrateDraftForResume(records[0], [], 'current-main-sha');
  assert.equal(resumed.state, 'new');
  assert.equal(resumed.baseKnown, false);
  assert.equal(resumed.sourceBaseSha, 'current-main-sha');
  assert.equal(resumed.note.slug, 'legacy-draft');
  assert.equal(resumed.note.title, '旧式ローカル下書き');
  assert.deepEqual(resumed.note.tags, ['古いタグ']);
  assert.equal(resumed.images[0].originalName, '古い写真.jpg');
  assert.equal((await listDrafts())[0].key, 'note:new', 'legacy key remains untouched until the user resumes or discards it');
});
