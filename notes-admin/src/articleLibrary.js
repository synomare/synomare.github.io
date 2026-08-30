import { newNote } from './lib.js';

const DRAFT_COMPARE_FIELDS = [
  'postType', 'photo', 'title', 'date', 'summary', 'tags', 'aliases', 'relatedNotes',
  'relatedExclude', 'cardSize', 'cardExcerpt', 'draft', 'body'
];

function comparableNote(note = {}) {
  return Object.fromEntries(DRAFT_COMPARE_FIELDS.map(field => [field, note[field] ?? (['tags', 'aliases', 'relatedNotes', 'relatedExclude'].includes(field) ? [] : '')]));
}

export function draftLibraryItems(records = [], documents = []) {
  const documentsBySlug = new Map(documents.map(document => [document.slug, document]));
  const items = records.flatMap(record => {
    if (!record?.note?.slug || !record.key) return [];
    const note = {
      postType: 'text', photo: '', title: '', date: '', summary: '', tags: [], aliases: [],
      relatedNotes: [], relatedExclude: [], cardSize: 'auto', cardExcerpt: '', draft: false, body: '',
      ...record.note
    };
    const sourceSlug = record.sourceSlug || (note.existing ? note.slug : '');
    const source = sourceSlug ? documentsBySlug.get(sourceSlug) : null;
    const collision = !sourceSlug ? documentsBySlug.get(note.slug) : null;
    const hasImages = Boolean(record.images?.length);
    const hasChanges = !source || hasImages || JSON.stringify(comparableNote(note)) !== JSON.stringify(comparableNote(source));
    if (source && !hasChanges) return [];
    const kind = source ? 'edit' : sourceSlug ? 'missing' : collision ? 'conflict' : 'new';
    return [{ ...record, note, sourceSlug, source, collision, kind, hasChanges }];
  }).sort((a, b) => b.savedAt - a.savedAt || a.key.localeCompare(b.key));
  const seenEdits = new Set();
  return items.map(item => {
    if (item.kind !== 'edit') return item;
    if (seenEdits.has(item.sourceSlug)) return { ...item, kind: 'parallel' };
    seenEdits.add(item.sourceSlug);
    return item;
  });
}

export function localDraftIndex(items = []) {
  const index = new Map();
  for (const item of items) {
    if (item.kind !== 'edit' || index.has(item.sourceSlug)) continue;
    index.set(item.sourceSlug, item);
  }
  return index;
}

export function unchangedDraftRecords(records = [], documents = []) {
  const documentsBySlug = new Map(documents.map(document => [document.slug, document]));
  return records.filter(record => {
    const sourceSlug = record?.sourceSlug || (record?.note?.existing ? record.note.slug : '');
    const source = sourceSlug ? documentsBySlug.get(sourceSlug) : null;
    return Boolean(source && !record.images?.length && JSON.stringify(comparableNote(record.note)) === JSON.stringify(comparableNote(source)));
  });
}

export function filterLocalDraftItems(items = [], filters = {}) {
  if (!['all', 'local'].includes(filters.status || 'all')) return [];
  const localOnly = items.filter(item => item.kind !== 'edit').map(item => ({
    ...item.note,
    localDraftKey: item.key,
    localDraftKind: item.kind,
    localSavedAt: item.savedAt,
    localImages: item.images || [],
    localSourceBaseSha: item.sourceBaseSha || ''
  }));
  const filtered = filterDocuments(localOnly, { ...filters, status: 'all' });
  if (filters.sort === 'title') return filtered;
  return [...filtered].sort((a, b) => (filters.sort === 'oldest' ? a.localSavedAt - b.localSavedAt : b.localSavedAt - a.localSavedAt) || a.slug.localeCompare(b.slug));
}

export function collectTags(documents) {
  return [...new Set(documents.flatMap(document => document.tags || []))].sort((a, b) => a.localeCompare(b, 'ja'));
}

export function filterDocuments(documents, filters = {}) {
  const query = String(filters.query || '').normalize('NFKC').toLocaleLowerCase('ja').trim();
  const type = filters.type || 'all';
  const status = filters.status || 'all';
  const tag = filters.tag || '';
  const sort = filters.sort || 'newest';
  const filtered = documents.filter(document => {
    if (type !== 'all' && document.postType !== type) return false;
    if (status === 'public' && document.draft) return false;
    if (status === 'draft' && !document.draft) return false;
    if (tag && !(document.tags || []).includes(tag)) return false;
    if (!query) return true;
    return [document.title, document.summary, document.body, document.slug, ...(document.tags || []), ...(document.aliases || [])]
      .join(' ').normalize('NFKC').toLocaleLowerCase('ja').includes(query);
  });
  return [...filtered].sort((a, b) => {
    if (sort === 'oldest') return a.date.localeCompare(b.date) || a.slug.localeCompare(b.slug);
    if (sort === 'title') return (a.title || a.slug).localeCompare(b.title || b.slug, 'ja');
    return b.date.localeCompare(a.date) || b.slug.localeCompare(a.slug);
  });
}

export function articleFolios(documents) {
  const newestFirst = (a, b) => b.date.localeCompare(a.date) || b.slug.localeCompare(a.slug);
  const published = documents.filter(document => !document.draft).sort(newestFirst);
  const drafts = documents.filter(document => document.draft).sort(newestFirst);
  return new Map([
    ...published.map((document, index) => [document.slug, index + 1]),
    ...drafts.map((document, index) => [document.slug, index + 1])
  ]);
}

export function duplicateDocument(source, existingSlugs = []) {
  const fresh = newNote(existingSlugs);
  return {
    ...source,
    slug: fresh.slug,
    date: fresh.date,
    title: source.title ? `${source.title} — copy` : '',
    draft: true,
    existing: false
  };
}
