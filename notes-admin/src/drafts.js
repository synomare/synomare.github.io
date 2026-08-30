const DB_NAME = 'synomare-notes-editor';
const STORE = 'drafts';
const SCHEMA_VERSION = 2;
const NOTE_FIELDS = [
  'slug', 'postType', 'photo', 'title', 'date', 'summary', 'tags', 'aliases',
  'relatedNotes', 'relatedExclude', 'cardSize', 'cardExcerpt', 'draft', 'body', 'existing'
];
const IMAGE_FIELDS = ['file', 'originalName', 'path', 'needsBuildConversion'];

export const draftKeyFor = note => `note:${String(note?.slug || 'untitled')}`;

export function createLocalDraftKey(id = '') {
  if (id) return `local:${String(id)}`;
  if (typeof globalThis.crypto?.randomUUID === 'function') return `local:${globalThis.crypto.randomUUID()}`;
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return `local:${[...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function pickFields(source, fields) {
  if (!source || typeof source !== 'object') return null;
  return Object.fromEntries(fields.filter(field => Object.hasOwn(source, field)).map(field => [field, source[field]]));
}

function stringArray(value) {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return [...new Set(values.map(item => String(item).trim()).filter(Boolean))];
}

function safeNote(source) {
  const note = pickFields(source, NOTE_FIELDS);
  if (!note) return null;
  return {
    slug: String(note.slug || ''),
    postType: note.postType === 'photo' ? 'photo' : 'text',
    photo: String(note.photo || ''),
    title: String(note.title || ''),
    date: String(note.date || ''),
    summary: String(note.summary || ''),
    tags: stringArray(note.tags),
    aliases: stringArray(note.aliases),
    relatedNotes: stringArray(note.relatedNotes),
    relatedExclude: stringArray(note.relatedExclude),
    cardSize: ['auto', 's', 'm', 'l'].includes(note.cardSize) ? note.cardSize : 'auto',
    cardExcerpt: String(note.cardExcerpt || ''),
    draft: note.draft === true,
    body: String(note.body || ''),
    existing: note.existing === true
  };
}

function safeImage(source) {
  const image = pickFields(source, IMAGE_FIELDS);
  if (!image) return null;
  return {
    ...(image.file ? { file: image.file } : {}),
    originalName: String(image.originalName || image.file?.name || ''),
    path: String(image.path || ''),
    needsBuildConversion: image.needsBuildConversion === true
  };
}

export function draftPayload(value = {}, savedAt = Date.now()) {
  const note = safeNote(value.note);
  const images = Array.isArray(value.images)
    ? value.images.map(safeImage).filter(Boolean)
    : [];
  return {
    schemaVersion: SCHEMA_VERSION,
    note,
    images,
    sourceSlug: typeof value.sourceSlug === 'string' ? value.sourceSlug : (note?.existing ? String(note.slug || '') : ''),
    sourceBaseSha: typeof value.sourceBaseSha === 'string' ? value.sourceBaseSha : '',
    savedAt: Number.isFinite(savedAt) ? savedAt : Date.now()
  };
}

export function normalizeDraftRecord(key, value) {
  if (!value || typeof value !== 'object' || !value.note || typeof value.note !== 'object') return null;
  const safe = draftPayload(value, Number(value.savedAt) || 0);
  const slug = String(safe.note?.slug || '').trim();
  if (!slug) return null;
  return { key: String(key), ...safe };
}

export function draftFingerprint(note, images = []) {
  const safe = draftPayload({ note, images }, 0);
  return JSON.stringify({
    note: safe.note,
    images: safe.images.map(image => ({
      path: image.path || '',
      name: image.file?.name || '',
      type: image.file?.type || '',
      size: Number(image.file?.size) || 0,
      lastModified: Number(image.file?.lastModified) || 0,
      needsBuildConversion: image.needsBuildConversion === true
    }))
  });
}

export function hydrateDraftForResume(record, documents = [], currentBaseSha = '') {
  if (!record?.note) return null;
  const sourceSlug = record.sourceSlug || (record.note.existing ? record.note.slug : '');
  const source = sourceSlug ? documents.find(document => document.slug === sourceSlug) : null;
  const collision = !sourceSlug ? documents.find(document => document.slug === record.note.slug) : null;
  const note = {
    postType: 'text', photo: '', title: '', date: '', summary: '', tags: [], aliases: [],
    relatedNotes: [], relatedExclude: [], cardSize: 'auto', cardExcerpt: '', draft: false, body: '',
    ...record.note,
    existing: Boolean(source)
  };
  return {
    note,
    images: record.images || [],
    sourceSlug,
    sourceBaseSha: record.sourceBaseSha || currentBaseSha,
    baseKnown: Boolean(record.sourceBaseSha),
    state: source ? 'edit' : sourceSlug ? 'missing' : collision ? 'conflict' : 'new'
  };
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transact(mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    let result;
    let request;
    try { request = action(tx.objectStore(STORE)); }
    catch (error) { db.close(); reject(error); return; }
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => { /* transaction handlers report the durable result */ };
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onerror = () => { db.close(); reject(tx.error || request.error); };
    tx.onabort = () => { db.close(); reject(tx.error || request.error || new Error('ローカル下書きの処理が中断されました。')); };
  });
}

export async function saveDraft(key, value) {
  const payload = draftPayload(value);
  await transact('readwrite', store => store.put(payload, key));
  return normalizeDraftRecord(key, payload);
}

export async function saveDraftReplacing(previousKey, nextKey, value) {
  const from = String(previousKey || '');
  const to = String(nextKey || '');
  if (!to) throw new Error('ローカル下書きの保存先がありません。');
  const payload = draftPayload(value);
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    let operationError = null;
    const write = () => {
      store.put(payload, to);
      if (from && from !== to) store.delete(from);
    };
    if (from === to) write();
    else {
      const existing = store.get(to);
      existing.onsuccess = () => {
        if (existing.result !== undefined) {
          operationError = Object.assign(new Error('同じslugの別のローカル下書きがあります。slugを変更してください。'), { code: 'DRAFT_KEY_CONFLICT' });
          tx.abort();
          return;
        }
        write();
      };
      existing.onerror = () => { operationError = existing.error; };
    }
    tx.oncomplete = () => { db.close(); resolve(normalizeDraftRecord(to, payload)); };
    tx.onerror = () => { if (!operationError) operationError = tx.error; };
    tx.onabort = () => { db.close(); reject(operationError || tx.error || new Error('ローカル下書きの移行に失敗しました。')); };
  });
}

export async function loadDraft(key) {
  const value = await transact('readonly', store => store.get(key));
  return normalizeDraftRecord(key, value);
}

export async function listDrafts() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).openCursor();
    const records = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const record = normalizeDraftRecord(cursor.primaryKey, cursor.value);
      if (record) records.push(record);
      cursor.continue();
    };
    request.onerror = () => { /* transaction handlers report the durable result */ };
    tx.oncomplete = () => {
      db.close();
      resolve(records.sort((a, b) => b.savedAt - a.savedAt || a.key.localeCompare(b.key)));
    };
    tx.onerror = () => { db.close(); reject(tx.error || request.error); };
    tx.onabort = () => { db.close(); reject(tx.error || request.error || new Error('ローカル下書きを読み込めませんでした。')); };
  });
}

export async function deleteDraftIfUnchanged(key, expectedSavedAt, expectedFingerprint) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const request = store.get(key);
    let deleted = false;
    request.onsuccess = () => {
      const current = normalizeDraftRecord(key, request.result);
      if (!current || current.savedAt !== expectedSavedAt || draftFingerprint(current.note, current.images) !== expectedFingerprint) return;
      store.delete(key);
      deleted = true;
    };
    request.onerror = () => { /* transaction handlers report the durable result */ };
    tx.oncomplete = () => { db.close(); resolve(deleted); };
    tx.onerror = () => { db.close(); reject(tx.error || request.error); };
    tx.onabort = () => { db.close(); reject(tx.error || request.error || new Error('ローカル下書きの整理に失敗しました。')); };
  });
}

export const deleteDraft = key => transact('readwrite', store => store.delete(key));
