const ACTIVE_STATES = new Set(['queued', 'publishing', 'error']);

function publicationId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `publish-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function copyNote(note) {
  return {
    ...note,
    tags: [...(note.tags || [])],
    aliases: [...(note.aliases || [])],
    relatedNotes: [...(note.relatedNotes || [])],
    relatedExclude: [...(note.relatedExclude || [])]
  };
}

export function createPublicationJob({ id = publicationId(), note, images = [], markdown, draftRecord, enqueuedAt = Date.now() }) {
  if (!note?.slug) throw new Error('公開キューへ追加する記事のslugがありません。');
  return {
    id,
    slug: note.slug,
    title: note.title || (note.postType === 'photo' ? `PHOTO / ${note.date}` : note.slug),
    note: copyNote(note),
    images: images.map(image => ({ ...image })),
    markdown: String(markdown || ''),
    existing: note.existing === true,
    draftKey: String(draftRecord?.key || ''),
    draftSavedAt: Number(draftRecord?.savedAt) || 0,
    draftFingerprint: String(draftRecord?.fingerprint || ''),
    enqueuedAt,
    state: 'queued',
    errorCode: '',
    errorMessage: '',
    committedSha: ''
  };
}

export const isActivePublication = item => ACTIVE_STATES.has(item?.state);

export const nextPublication = items => items.find(item => item.state === 'queued') || null;

export const hasQueuedSlug = (items, slug) => items.some(item => item.slug === slug && isActivePublication(item));

export const hasQueuedDraft = (items, draftKey) => Boolean(draftKey) && items.some(item => item.draftKey === draftKey && isActivePublication(item));

export function publicationSummary(items) {
  const counts = { queued: 0, publishing: 0, error: 0, published: 0, active: 0, total: items.length };
  items.forEach(item => {
    if (item.state === 'done') counts.published += 1;
    else if (Object.hasOwn(counts, item.state)) counts[item.state] += 1;
    if (isActivePublication(item)) counts.active += 1;
  });
  return counts;
}

export function publicationActivity(items, paused = false) {
  if (!items.length) return null;
  const active = items.find(item => item.state === 'publishing')
    || items.find(item => item.state === 'error')
    || items.find(item => item.state === 'queued')
    || items.at(-1);
  const position = Math.max(1, items.findIndex(item => item.id === active.id) + 1);
  const waiting = items.filter(item => item.state === 'queued').length;
  const completed = items.filter(item => item.state === 'done').length;
  const state = paused || active.state === 'error'
    ? 'STOPPED'
    : active.state === 'publishing'
      ? 'PUBLISHING'
      : active.state === 'queued'
        ? 'WAITING'
        : 'COMPLETE';
  return {
    state,
    position,
    total: items.length,
    waiting,
    completed,
    title: active.title || active.slug || ''
  };
}

export function replacePublication(items, id, patch) {
  return items.map(item => item.id === id ? { ...item, ...patch } : item);
}

export function removeQueuedPublication(items, id) {
  return items.filter(item => item.id !== id || item.state !== 'queued');
}

export function stopPublicationQueue(items) {
  return items.filter(item => item.state === 'done');
}

export function removePublishedImages(images, publishedImages) {
  const paths = new Set((publishedImages || []).map(image => image.path).filter(Boolean));
  return (images || []).filter(image => !paths.has(image.path));
}
