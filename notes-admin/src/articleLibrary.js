import { newNote } from './lib.js';

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
