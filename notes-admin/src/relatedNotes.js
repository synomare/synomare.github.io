export function normalizeNoteReference(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('ja');
}

export function indexRelatedDocuments(documents) {
  const indexes = [new Map(), new Map(), new Map()];
  (documents || []).forEach(document => {
    [[document.slug], [document.title], document.aliases || []].forEach((values, index) => values.forEach(value => {
      const key = normalizeNoteReference(value);
      if (!key) return;
      const matches = indexes[index].get(key) || [];
      if (!matches.some(item => item.slug === document.slug)) matches.push(document);
      indexes[index].set(key, matches);
    }));
  });
  return indexes;
}

/**
 * Resolve a related-note reference without throwing away the reason it did
 * not resolve. The editor uses this richer result for repair affordances,
 * while the generator can keep using the small `resolveRelatedReference`
 * compatibility wrapper below.
 */
export function resolveRelatedReferenceDetailed(value, indexes) {
  const key = normalizeNoteReference(value);
  if (!key) return { status: 'unresolved', value: String(value || ''), matches: [] };
  for (const index of indexes || []) {
    const matches = index.get(key) || [];
    if (matches.length === 1) return { status: 'resolved', value, document: matches[0], matches };
    if (matches.length > 1) return { status: 'ambiguous', value, matches };
  }
  return { status: 'unresolved', value, matches: [] };
}

export function resolveRelatedReference(value, indexes) {
  const result = resolveRelatedReferenceDetailed(value, indexes);
  return result.status === 'resolved' ? result.document : null;
}

function publishedOrder(a, b) {
  return String(b.document.date || '').localeCompare(String(a.document.date || '')) || String(b.document.slug).localeCompare(String(a.document.slug));
}

export function relatedState(note, documents, limit = 6) {
  const sourceDocuments = Array.isArray(documents) ? documents : [];
  const allDocuments = note?.slug
    ? [...sourceDocuments.filter(document => document.slug !== note.slug), note]
    : sourceDocuments;
  const candidates = allDocuments.filter(document => document.slug !== note.slug);
  // `indexes` is intentionally built from every document so that draft-only
  // references can be diagnosed and repaired. Public/current resolution uses
  // the published subset, matching the static generator exactly.
  const indexes = indexRelatedDocuments(allDocuments);
  const publicIndexes = indexRelatedDocuments(allDocuments.filter(document => !document.draft));
  const manualValues = Array.isArray(note.relatedNotes) ? note.relatedNotes : [];
  const excludedValues = Array.isArray(note.relatedExclude) ? note.relatedExclude : [];
  const manualEntries = manualValues.map(value => {
    const publicResult = resolveRelatedReferenceDetailed(value, publicIndexes);
    const allResult = resolveRelatedReferenceDetailed(value, indexes);
    return { value, result: publicResult.status === 'resolved' ? publicResult : allResult, publicResult, allResult };
  });
  const excludedEntries = excludedValues.map(value => {
    const publicResult = resolveRelatedReferenceDetailed(value, publicIndexes);
    const allResult = resolveRelatedReferenceDetailed(value, indexes);
    return { value, result: publicResult.status === 'resolved' ? publicResult : allResult, publicResult, allResult };
  });
  const includedKeys = new Set(manualEntries.map(entry => {
    const result = entry.allResult;
    return result.status === 'resolved' ? result.document.slug : normalizeNoteReference(entry.value);
  }));
  const excludedKeys = new Set(excludedEntries.map(entry => {
    const result = entry.allResult;
    return result.status === 'resolved' ? result.document.slug : normalizeNoteReference(entry.value);
  }));
  const conflictKeys = new Set([...includedKeys].filter(key => key && excludedKeys.has(key)));
  const entryKey = entry => entry.result.status === 'resolved' ? entry.result.document.slug : normalizeNoteReference(entry.value);
  const isConflict = entry => conflictKeys.has(entryKey(entry));
  const isPublicDocument = entry => entry.result.status === 'resolved' && entry.result.document.slug !== note.slug && !entry.result.document.draft;
  const seenManual = new Set();
  const manual = manualEntries.filter(entry => {
    if (!isPublicDocument(entry)) return false;
    const slug = entry.result.document.slug;
    if (seenManual.has(slug)) return false;
    seenManual.add(slug);
    return true;
  }).map(entry => ({ ...entry, document: entry.result.document, kind: 'manual', shared: 0, conflict: isConflict(entry) }));
  const manualSlugs = new Set(manual.map(entry => entry.document.slug));
  const excludedSlugs = new Set(excludedEntries.map(entry => entry.publicResult.status === 'resolved' ? entry.publicResult.document.slug : '').filter(Boolean));
  const tags = new Set(note.tags || []);
  const automaticCandidates = candidates.filter(document => !document.draft && !manualSlugs.has(document.slug) && !excludedSlugs.has(document.slug))
    .map(document => ({ document, kind: 'automatic', shared: (document.tags || []).filter(tag => tags.has(tag)).length }))
    .filter(entry => entry.shared > 0)
    .sort((a, b) => b.shared - a.shared || publishedOrder(a, b));
  const automatic = automaticCandidates.slice(0, Math.max(0, limit - manual.length));
  const currentSlugs = new Set(automatic.map(entry => entry.document.slug));
  const available = candidates.filter(document => !manualSlugs.has(document.slug) && !excludedSlugs.has(document.slug) && !currentSlugs.has(document.slug))
    .map(document => ({ document, kind: 'candidate', shared: (document.tags || []).filter(tag => tags.has(tag)).length }))
    .sort((a, b) => b.shared - a.shared || publishedOrder(a, b));
  const attention = [];
  const addAttention = (entry, source) => {
    const result = entry.result;
    const conflict = isConflict(entry);
    // The manual side owns a conflict warning. The excluded side remains
    // visible under ADD / HIDDEN, so showing it here too would duplicate the
    // same repair task.
    if (conflict && source === 'excluded') return;
    const draftOnly = result.status === 'resolved' && result.document.draft && entry.publicResult.status !== 'resolved';
    const status = conflict ? 'conflict' : draftOnly ? 'draft' : result.status === 'resolved' && result.document.slug === note.slug ? 'self' : result.status;
    if (status === 'resolved' && !conflict) return;
    attention.push({
      ...entry,
      kind: 'attention',
      source,
      status,
      document: result.status === 'resolved' ? result.document : null,
      matches: result.matches || [],
      conflict,
      shared: 0
    });
  };
  manualEntries.forEach(entry => addAttention(entry, 'manual'));
  excludedEntries.forEach(entry => addAttention(entry, 'excluded'));
  return {
    indexes,
    publicIndexes,
    current: [...manual, ...automatic],
    available,
    excluded: excludedEntries.filter(entry => entry.publicResult.status === 'resolved' && entry.publicResult.document.slug !== note.slug).map(entry => ({ ...entry, kind: 'excluded', document: entry.publicResult.document, shared: 0 })),
    attention,
    unresolvedManual: attention.filter(entry => entry.source === 'manual' && ['unresolved', 'ambiguous'].includes(entry.status))
  };
}

export function uniqueRelatedReferences(values) {
  return [...new Set(values.map(value => String(value).trim()).filter(Boolean))];
}

export function moveRelatedReference(values, value, delta) {
  const next = [...(Array.isArray(values) ? values : [])];
  const index = next.findIndex(item => item === value);
  if (index < 0) return next;
  const target = Math.max(0, Math.min(next.length - 1, index + (delta < 0 ? -1 : 1)));
  if (target === index) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function relatedReferenceIssues(note, documents = []) {
  if (!note) return [];
  const sourceDocuments = Array.isArray(documents) ? documents : [];
  const all = note.slug
    ? [...sourceDocuments.filter(document => document.slug !== note.slug), note]
    : sourceDocuments;
  const allIndexes = indexRelatedDocuments(all);
  const publicIndexes = indexRelatedDocuments(all.filter(document => !document.draft));
  const includes = Array.isArray(note.relatedNotes) ? note.relatedNotes : [];
  const excludes = Array.isArray(note.relatedExclude) ? note.relatedExclude : [];
  const issues = [];
  const resolve = value => {
    const publicResult = resolveRelatedReferenceDetailed(value, publicIndexes);
    const allResult = resolveRelatedReferenceDetailed(value, allIndexes);
    return { publicResult, allResult, effective: publicResult.status === 'resolved' ? publicResult : allResult };
  };
  const includedKeys = new Map(); const excludedKeys = new Map();
  includes.forEach(value => {
    const result = resolve(value); const key = result.allResult.status === 'resolved' ? result.allResult.document.slug : normalizeNoteReference(value);
    if (key) includedKeys.set(key, value);
    if (result.effective.status === 'unresolved') issues.push({ type: 'unresolved', source: 'related_notes', value, text: `関連記事の参照先が見つかりません：${value}` });
    else if (result.effective.status === 'ambiguous') issues.push({ type: 'ambiguous', source: 'related_notes', value, matches: result.effective.matches, text: `関連記事の参照先が曖昧です：${value}` });
    else if (result.effective.document.slug === note.slug) issues.push({ type: 'self', source: 'related_notes', value, text: `関連記事に自分自身を指定しています：${value}` });
    else if (result.publicResult.status !== 'resolved' && result.allResult.status === 'resolved' && result.allResult.document.draft) issues.push({ type: 'draft', source: 'related_notes', value, document: result.allResult.document, text: `関連記事の参照先が下書きです：${value}` });
  });
  excludes.forEach(value => {
    const result = resolve(value); const key = result.allResult.status === 'resolved' ? result.allResult.document.slug : normalizeNoteReference(value);
    if (key) excludedKeys.set(key, value);
    if (result.effective.status === 'unresolved') issues.push({ type: 'unresolved', source: 'related_exclude', value, text: `除外対象の参照先が見つかりません：${value}` });
    else if (result.effective.status === 'ambiguous') issues.push({ type: 'ambiguous', source: 'related_exclude', value, matches: result.effective.matches, text: `除外対象の参照先が曖昧です：${value}` });
    else if (result.effective.document.slug === note.slug) issues.push({ type: 'self', source: 'related_exclude', value, text: `関連記事の除外対象に自分自身を指定しています：${value}` });
    else if (result.publicResult.status !== 'resolved' && result.allResult.status === 'resolved' && result.allResult.document.draft) issues.push({ type: 'draft', source: 'related_exclude', value, document: result.allResult.document, text: `除外対象の参照先が下書きです：${value}` });
  });
  for (const [key, value] of includedKeys) if (excludedKeys.has(key)) issues.push({ type: 'conflict', source: 'related_notes', value, otherValue: excludedKeys.get(key), text: `関連記事の追加と除外の両方に指定しています：${value}` });
  return issues;
}
