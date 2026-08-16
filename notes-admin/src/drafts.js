const DB_NAME = 'synomare-notes-editor'; const STORE = 'drafts';
function openDb() { return new Promise((resolve, reject) => { const request = indexedDB.open(DB_NAME, 1); request.onupgradeneeded = () => request.result.createObjectStore(STORE); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
async function transact(mode, action) { const db = await openDb(); return new Promise((resolve, reject) => { const tx = db.transaction(STORE, mode); const request = action(tx.objectStore(STORE)); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); tx.oncomplete = () => db.close(); }); }
export const saveDraft = (key, value) => transact('readwrite', store => store.put({ ...value, savedAt: Date.now() }, key));
export const loadDraft = key => transact('readonly', store => store.get(key));
export const deleteDraft = key => transact('readwrite', store => store.delete(key));
