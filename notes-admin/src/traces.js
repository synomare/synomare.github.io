const DAY = 86_400_000;
const STOP_WORDS = new Set([
  'これ', 'それ', 'あれ', 'こと', 'もの', 'ため', 'よう', 'ところ', 'そして', 'しかし', 'また', 'から', 'まで',
  'する', 'した', 'して', 'いる', 'ある', 'なる', 'という', 'the', 'and', 'for', 'with', 'that', 'this', 'from'
]);

export const RELATION_TYPES = [
  { value: 'continues', label: 'CONTINUE' },
  { value: 'contrasts', label: 'CONTRAST' },
  { value: 'exemplifies', label: 'EXAMPLE' },
  { value: 'answers', label: 'ANSWER' },
  { value: 'cites', label: 'CITE' }
];

const canonicalRelation = relation => ({
  type: RELATION_TYPES.some(option => option.value === relation?.type) ? relation.type : 'continues',
  target: String(relation?.target || '').trim()
});

const cleanMotifs = motifs => [...new Set((Array.isArray(motifs) ? motifs : [])
  .map(value => String(value).normalize('NFKC').trim())
  .filter(Boolean))].slice(0, 24);

const randomPart = () => {
  if (globalThis.crypto?.getRandomValues) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(4));
    return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  return Math.random().toString(36).slice(2, 10).padEnd(8, '0');
};

export function generateTraceId(date = new Date()) {
  const stamp = date.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `tr_${stamp}_${randomPart()}`;
}

export function parseMotifInput(value) {
  return cleanMotifs(String(value || '').split(/[,、\n]/));
}

export function createTrace({
  id,
  content,
  motifs = [],
  visibility = 'local',
  kind = 'note',
  relation = null,
  date = new Date()
} = {}) {
  const text = String(content || '').trim();
  if (!text) throw new Error('Trace本文が空です。');
  const createdAt = date.toISOString();
  const relations = relation?.target ? [canonicalRelation(relation)] : [];
  const isPublic = visibility === 'public';
  return {
    id: id || generateTraceId(date),
    createdAt,
    updatedAt: createdAt,
    content: text,
    visibility: isPublic ? 'public' : 'local',
    kind: kind === 'question' ? 'question' : 'note',
    motifs: cleanMotifs(motifs),
    relations,
    revisions: [],
    syncStatus: isPublic ? 'queued' : 'local',
    remotePublished: false,
    pendingDelete: false,
    deleted: false,
    lastSyncedSignature: ''
  };
}

function comparable(trace) {
  return {
    id: trace.id,
    createdAt: trace.createdAt,
    updatedAt: trace.updatedAt,
    content: trace.content,
    kind: trace.kind === 'question' ? 'question' : 'note',
    motifs: cleanMotifs(trace.motifs),
    relations: (trace.relations || []).map(canonicalRelation).filter(relation => relation.target),
    revisions: (trace.revisions || []).map(revision => ({
      id: String(revision.id || ''),
      createdAt: String(revision.createdAt || ''),
      content: String(revision.content || '')
    }))
  };
}

export function traceSignature(trace) {
  return JSON.stringify(comparable(trace));
}

export function reviseTrace(trace, patch = {}, date = new Date()) {
  const nextContent = patch.content === undefined ? trace.content : String(patch.content).trim();
  if (!nextContent) throw new Error('Trace本文が空です。');
  const nextVisibility = patch.visibility === 'public' ? 'public' : patch.visibility === 'local' ? 'local' : trace.visibility;
  const nextKind = patch.kind === 'question' ? 'question' : patch.kind === 'note' ? 'note' : trace.kind;
  const nextMotifs = patch.motifs === undefined ? cleanMotifs(trace.motifs) : cleanMotifs(patch.motifs);
  const nextRelations = patch.relations === undefined
    ? (trace.relations || []).map(canonicalRelation).filter(relation => relation.target)
    : (patch.relations || []).map(canonicalRelation).filter(relation => relation.target);
  const contentChanged = nextContent !== trace.content;
  const changed = contentChanged
    || nextVisibility !== trace.visibility
    || nextKind !== trace.kind
    || JSON.stringify(nextMotifs) !== JSON.stringify(cleanMotifs(trace.motifs))
    || JSON.stringify(nextRelations) !== JSON.stringify((trace.relations || []).map(canonicalRelation).filter(relation => relation.target));
  if (!changed) return trace;

  const updatedAt = date.toISOString();
  const revisions = contentChanged
    ? [...(trace.revisions || []), {
        id: `rev_${updatedAt.replace(/[-:.TZ]/g, '')}_${randomPart()}`,
        createdAt: trace.updatedAt || trace.createdAt,
        content: trace.content
      }]
    : [...(trace.revisions || [])];

  let syncStatus = trace.syncStatus || 'local';
  let pendingDelete = Boolean(trace.pendingDelete);
  if (nextVisibility === 'public') {
    syncStatus = 'queued';
    pendingDelete = false;
  } else if (trace.remotePublished) {
    syncStatus = 'queued-delete';
    pendingDelete = true;
  } else {
    syncStatus = 'local';
    pendingDelete = false;
  }

  return {
    ...trace,
    content: nextContent,
    visibility: nextVisibility,
    kind: nextKind,
    motifs: nextMotifs,
    relations: nextRelations,
    revisions,
    updatedAt,
    syncStatus,
    pendingDelete,
    deleted: false,
    conflict: null
  };
}

export function markTraceDeleted(trace, date = new Date()) {
  if (trace.remotePublished) {
    return {
      ...trace,
      deleted: true,
      pendingDelete: true,
      syncStatus: 'queued-delete',
      updatedAt: date.toISOString(),
      conflict: null
    };
  }
  return { ...trace, deleted: true, pendingDelete: false, syncStatus: 'local', updatedAt: date.toISOString() };
}

export function serializeTraceMarkdown(trace) {
  const data = {
    schema: 1,
    id: trace.id,
    created_at: trace.createdAt,
    updated_at: trace.updatedAt,
    visibility: 'public',
    kind: trace.kind === 'question' ? 'question' : 'note',
    motifs: cleanMotifs(trace.motifs),
    relations: (trace.relations || []).map(canonicalRelation).filter(relation => relation.target),
    revisions: (trace.revisions || []).map(revision => ({
      id: String(revision.id || ''),
      created_at: String(revision.createdAt || ''),
      content: String(revision.content || '')
    }))
  };
  return `---\n${JSON.stringify(data, null, 2)}\n---\n\n${String(trace.content || '').trim()}\n`;
}

export function parseTraceMarkdown(source, fallbackId = '') {
  const text = String(source || '');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) throw new Error(`Trace ${fallbackId || ''} にfrontmatterがありません。`.trim());
  let data;
  try { data = JSON.parse(match[1]); }
  catch { throw new Error(`Trace ${fallbackId || ''} のfrontmatterを解析できません。`.trim()); }
  const createdAt = String(data.created_at || new Date(0).toISOString());
  const updatedAt = String(data.updated_at || createdAt);
  const trace = {
    id: String(data.id || fallbackId),
    createdAt,
    updatedAt,
    content: text.slice(match[0].length).trim(),
    visibility: 'public',
    kind: data.kind === 'question' ? 'question' : 'note',
    motifs: cleanMotifs(data.motifs),
    relations: (Array.isArray(data.relations) ? data.relations : []).map(canonicalRelation).filter(relation => relation.target),
    revisions: (Array.isArray(data.revisions) ? data.revisions : []).map(revision => ({
      id: String(revision.id || ''),
      createdAt: String(revision.created_at || revision.createdAt || createdAt),
      content: String(revision.content || '')
    })),
    syncStatus: 'synced',
    remotePublished: true,
    pendingDelete: false,
    deleted: false,
    conflict: null,
    lastSyncedSignature: ''
  };
  trace.lastSyncedSignature = traceSignature(trace);
  return trace;
}

export function mergeRemoteTraces(localTraces, remoteTraces) {
  const merged = new Map((localTraces || []).map(trace => [trace.id, trace]));
  const remoteIds = new Set();
  for (const remote of remoteTraces || []) {
    remoteIds.add(remote.id);
    const local = merged.get(remote.id);
    const remoteSignature = traceSignature(remote);
    if (!local) {
      merged.set(remote.id, { ...remote, lastSyncedSignature: remoteSignature });
      continue;
    }
    if (local.pendingDelete || local.deleted) continue;
    const localSignature = traceSignature(local);
    if (localSignature === remoteSignature) {
      merged.set(remote.id, {
        ...local,
        syncStatus: local.visibility === 'public' ? 'synced' : local.syncStatus,
        remotePublished: true,
        lastSyncedSignature: remoteSignature,
        conflict: null
      });
      continue;
    }
    if (local.syncStatus === 'queued') {
      if (local.lastSyncedSignature && local.lastSyncedSignature !== remoteSignature) {
        merged.set(remote.id, { ...local, syncStatus: 'conflict', remotePublished: true, conflict: { remote, remoteSignature } });
      } else {
        merged.set(remote.id, { ...local, remotePublished: true, lastSyncedSignature: remoteSignature });
      }
      continue;
    }
    if (local.syncStatus === 'conflict') continue;
    merged.set(remote.id, { ...remote, lastSyncedSignature: remoteSignature });
  }

  for (const [id, local] of merged) {
    if (!remoteIds.has(id) && local.remotePublished && local.syncStatus === 'synced' && !local.deleted) {
      merged.set(id, { ...local, syncStatus: 'conflict', conflict: { remote: null, remoteSignature: '' } });
    }
  }
  return [...merged.values()];
}

export function resolveTraceConflict(trace, resolution) {
  if (!trace.conflict) return trace;
  if (resolution === 'remote' && trace.conflict.remote) {
    const remote = trace.conflict.remote;
    return { ...remote, conflict: null, syncStatus: 'synced', remotePublished: true, lastSyncedSignature: traceSignature(remote) };
  }
  return {
    ...trace,
    conflict: null,
    syncStatus: trace.visibility === 'public' ? 'queued' : trace.remotePublished ? 'queued-delete' : 'local',
    lastSyncedSignature: trace.conflict.remoteSignature || trace.lastSyncedSignature || ''
  };
}

function normalizedWords(value) {
  const text = String(value || '').normalize('NFKC').toLocaleLowerCase('ja').replace(/https?:\/\/\S+/g, ' ');
  const words = [];
  if (typeof Intl?.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter('ja', { granularity: 'word' });
    for (const segment of segmenter.segment(text)) {
      const word = segment.segment.trim();
      if (segment.isWordLike && word.length > 1 && !STOP_WORDS.has(word)) words.push(word);
    }
  }
  if (words.length < 3) {
    const compact = text.replace(/[\s\p{P}\p{S}]+/gu, '');
    for (let index = 0; index < compact.length - 1; index += 1) words.push(compact.slice(index, index + 2));
  }
  return new Set(words);
}

export function lexicalEchoes(queryTrace, traces, limit = 5) {
  const queryWords = normalizedWords(queryTrace?.content);
  const queryMotifs = new Set(cleanMotifs(queryTrace?.motifs));
  const results = [];
  for (const trace of traces || []) {
    if (!trace || trace.id === queryTrace?.id || trace.deleted) continue;
    const words = normalizedWords(trace.content);
    const sharedWords = [...queryWords].filter(word => words.has(word));
    const sharedMotifs = cleanMotifs(trace.motifs).filter(motif => queryMotifs.has(motif));
    if (!sharedWords.length && !sharedMotifs.length) continue;
    const lexical = sharedWords.length / Math.max(1, Math.sqrt(queryWords.size * words.size));
    const score = lexical + sharedMotifs.length * 0.25;
    results.push({
      trace,
      score,
      sharedWords: sharedWords.slice(0, 5),
      sharedMotifs: sharedMotifs.slice(0, 4)
    });
  }
  return results.sort((a, b) => b.score - a.score || b.trace.updatedAt.localeCompare(a.trace.updatedAt)).slice(0, limit);
}

export function motifStats(traces) {
  const counts = new Map();
  for (const trace of traces || []) {
    if (trace.deleted) continue;
    for (const motif of cleanMotifs(trace.motifs)) counts.set(motif, (counts.get(motif) || 0) + 1);
  }
  return [...counts].map(([motif, count]) => ({ motif, count })).sort((a, b) => b.count - a.count || a.motif.localeCompare(b.motif, 'ja'));
}

function returnedIds(traces) {
  const ids = new Set();
  const byId = new Map((traces || []).map(trace => [trace.id, trace]));
  for (const trace of traces || []) {
    if ((trace.revisions || []).some(revision => new Date(trace.updatedAt) - new Date(revision.createdAt) >= 7 * DAY)) ids.add(trace.id);
    for (const relation of trace.relations || []) {
      const target = byId.get(relation.target);
      if (target && new Date(trace.createdAt) - new Date(target.createdAt) >= 7 * DAY) {
        ids.add(trace.id);
        ids.add(target.id);
      }
    }
  }
  return ids;
}

export function filterTracePlate(traces, { plate = 'stream', query = '', motif = '' } = {}) {
  const active = (traces || []).filter(trace => !trace.deleted);
  const tensions = new Set();
  for (const trace of active) {
    for (const relation of trace.relations || []) {
      if (relation.type === 'contrasts') {
        tensions.add(trace.id);
        tensions.add(relation.target);
      }
    }
  }
  const returned = returnedIds(active);
  const normalizedQuery = String(query || '').normalize('NFKC').toLocaleLowerCase('ja').trim();
  return active.filter(trace => {
    if (plate === 'questions' && trace.kind !== 'question') return false;
    if (plate === 'tensions' && !tensions.has(trace.id)) return false;
    if (plate === 'returned' && !returned.has(trace.id)) return false;
    if (motif && !cleanMotifs(trace.motifs).includes(motif)) return false;
    if (!normalizedQuery) return true;
    return [trace.id, trace.content, ...(trace.motifs || [])].join('\n').normalize('NFKC').toLocaleLowerCase('ja').includes(normalizedQuery);
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function selectResurfaceTrace(traces, now = new Date()) {
  const current = now.getTime();
  const incoming = new Map();
  for (const trace of traces || []) {
    for (const relation of trace.relations || []) incoming.set(relation.target, (incoming.get(relation.target) || 0) + 1);
  }
  const candidates = (traces || []).filter(trace => !trace.deleted && current - new Date(trace.updatedAt).getTime() >= 14 * DAY);
  candidates.sort((a, b) => {
    const aRelations = (a.relations?.length || 0) + (incoming.get(a.id) || 0);
    const bRelations = (b.relations?.length || 0) + (incoming.get(b.id) || 0);
    return aRelations - bRelations || a.updatedAt.localeCompare(b.updatedAt);
  });
  return candidates[0] || null;
}

export function traceExcerpt(trace, max = 96) {
  const text = String(trace?.content || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
