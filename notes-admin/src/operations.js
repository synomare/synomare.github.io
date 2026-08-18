import { outgoingFromBody } from './lib.js';

export function normalizeOperationValue(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('ja').trim();
}

export function collectTagStats(documents = []) {
  const stats = new Map();
  documents.forEach(document => (document.tags || []).forEach(tag => {
    const key = String(tag).trim();
    if (!key) return;
    const current = stats.get(key) || { name: key, count: 0, publicCount: 0, draftCount: 0, slugs: [] };
    current.count += 1;
    if (document.draft) current.draftCount += 1;
    else current.publicCount += 1;
    current.slugs.push(document.slug);
    stats.set(key, current);
  }));
  return [...stats.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ja'));
}

export function renameTagInDocuments(documents = [], from, to) {
  const source = String(from || '').trim();
  const target = String(to || '').trim();
  if (!source || !target || source === target) return { documents, changedSlugs: [] };
  const next = documents.map(document => {
    if (!(document.tags || []).includes(source)) return document;
    const tags = [...new Set(document.tags.map(tag => tag === source ? target : tag))];
    return { ...document, tags };
  });
  return { documents: next, changedSlugs: next.filter((document, index) => document !== documents[index]).map(document => document.slug) };
}

function cleanImagePath(value) {
  const path = String(value || '').trim().replace(/^<|>$/g, '');
  return path.split(/[?#]/, 1)[0];
}

export function collectImages(documents = []) {
  const images = new Map();
  const add = (path, document, kind, alt = '') => {
    const clean = cleanImagePath(path);
    if (!clean) return;
    const current = images.get(clean) || { path: clean, uses: 0, articles: [], alts: [], kinds: new Set() };
    current.uses += 1;
    current.kinds.add(kind);
    if (alt && !current.alts.includes(alt)) current.alts.push(alt);
    if (!current.articles.some(article => article.slug === document.slug)) current.articles.push({ slug: document.slug, title: document.title || document.slug });
    images.set(clean, current);
  };
  documents.forEach(document => {
    if (document.photo) add(document.photo, document, 'PHOTO');
    const body = String(document.body || '');
    for (const match of body.matchAll(/!\[([^\]]*)\]\((?:<([^>]+)>|([^\s)]+))(?:\s+["']([^"']*)["'])?\)/g)) add(match[2] || match[3], document, 'TEXT', match[1] || match[4] || '');
  });
  return [...images.values()].map(image => ({ ...image, kinds: [...image.kinds] })).sort((a, b) => b.uses - a.uses || a.path.localeCompare(b.path));
}

function linkIndex(documents) {
  const index = new Map();
  documents.forEach(document => [document.slug, document.title, ...(document.aliases || [])].filter(Boolean).forEach(value => {
    const key = normalizeOperationValue(value);
    const matches = index.get(key) || [];
    if (!matches.some(item => item.slug === document.slug)) matches.push(document);
    index.set(key, matches);
  }));
  return index;
}

function contextFor(body, offset) {
  const before = body.slice(0, offset);
  return { line: before.split(/\r?\n/).length, text: body.split(/\r?\n/)[before.split(/\r?\n/).length - 1]?.trim() || '' };
}

export function analyzeLinks(documents = []) {
  const index = linkIndex(documents);
  const unresolved = [];
  const ambiguous = [];
  const incoming = new Set();
  documents.forEach(document => {
    const body = String(document.body || '');
    for (const match of body.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)) {
      const target = match[1].trim();
      const matches = index.get(normalizeOperationValue(target)) || [];
      const item = { sourceSlug: document.slug, sourceTitle: document.title || document.slug, target, label: (match[2] || target).trim(), context: contextFor(body, match.index || 0) };
      if (!matches.length) unresolved.push(item);
      else if (matches.length > 1) ambiguous.push({ ...item, matches: matches.map(note => ({ slug: note.slug, title: note.title || note.slug })) });
      else if (matches[0].slug !== document.slug) incoming.add(matches[0].slug);
    }
  });
  const linkedOut = new Set(documents.filter(document => outgoingFromBody(document.body).length).map(document => document.slug));
  const orphans = documents.filter(document => !incoming.has(document.slug) && !linkedOut.has(document.slug)).map(document => ({ slug: document.slug, title: document.title || document.slug, draft: document.draft }));
  return { unresolved, ambiguous, orphans, total: unresolved.length + ambiguous.length + orphans.length };
}
