const DB_NAME = 'synomare-trace-stream';
const DB_VERSION = 1;
const TRACE_STORE = 'traces';
const META_STORE = 'meta';

function openDb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('このブラウザではIndexedDBを利用できません。'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TRACE_STORE)) {
        const store = db.createObjectStore(TRACE_STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
        store.createIndex('updatedAt', 'updatedAt');
        store.createIndex('visibility', 'visibility');
        store.createIndex('syncStatus', 'syncStatus');
      }
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Traceデータベースを開けませんでした。'));
    request.onblocked = () => reject(new Error('別タブがTraceデータベースの更新を妨げています。'));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB操作に失敗しました。'));
  });
}

async function transact(storeNames, mode, operation) {
  const db = await openDb();
  try {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    const transaction = db.transaction(names, mode);
    const stores = Object.fromEntries(names.map(name => [name, transaction.objectStore(name)]));
    const completion = new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transactionに失敗しました。'));
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transactionが中断されました。'));
    });
    const result = await operation(stores, transaction);
    await completion;
    return result;
  } finally {
    db.close();
  }
}

export function listStoredTraces() {
  return transact(TRACE_STORE, 'readonly', ({ [TRACE_STORE]: store }) => requestResult(store.getAll()));
}

export function saveStoredTrace(trace) {
  return transact(TRACE_STORE, 'readwrite', ({ [TRACE_STORE]: store }) => requestResult(store.put(trace)));
}

export function saveStoredTraces(traces) {
  const values = Array.isArray(traces) ? traces : [];
  return transact(TRACE_STORE, 'readwrite', async ({ [TRACE_STORE]: store }) => {
    for (const trace of values) await requestResult(store.put(trace));
    return values.length;
  });
}

export function removeStoredTrace(id) {
  return transact(TRACE_STORE, 'readwrite', ({ [TRACE_STORE]: store }) => requestResult(store.delete(id)));
}

export function removeStoredTraces(ids) {
  const values = Array.isArray(ids) ? ids : [];
  return transact(TRACE_STORE, 'readwrite', async ({ [TRACE_STORE]: store }) => {
    for (const id of values) await requestResult(store.delete(id));
    return values.length;
  });
}

export function getTraceMeta(key) {
  return transact(META_STORE, 'readonly', async ({ [META_STORE]: store }) => {
    const result = await requestResult(store.get(key));
    return result?.value;
  });
}

export function setTraceMeta(key, value) {
  return transact(META_STORE, 'readwrite', ({ [META_STORE]: store }) => requestResult(store.put({ key, value })));
}
