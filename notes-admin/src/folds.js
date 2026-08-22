const randomPart = () => {
  if (globalThis.crypto?.getRandomValues) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(4));
    return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  return Math.random().toString(36).slice(2, 10).padEnd(8, '0');
};

const iso = date => (date instanceof Date ? date : new Date(date)).toISOString();
const blockId = (date = new Date()) => `fb_${iso(date).replace(/[-:.TZ]/g, '')}_${randomPart()}`;

export function generateFoldId(date = new Date()) {
  return `fold_${iso(date).replace(/[-:.TZ]/g, '')}_${randomPart()}`;
}

export function createTraceBlock(traceId, date = new Date()) {
  const id = String(traceId || '').trim();
  if (!id) throw new Error('Foldへ追加するTrace IDがありません。');
  return { id: blockId(date), type: 'trace', traceId: id, mode: 'live', pinned: null };
}

export function createBridgeBlock(content = '', date = new Date()) {
  return { id: blockId(date), type: 'bridge', content: String(content || '') };
}

export function createFold({ id, title = '', traceIds = [], date = new Date() } = {}) {
  const timestamp = iso(date);
  const unique = [...new Set((traceIds || []).map(value => String(value || '').trim()).filter(Boolean))];
  return {
    id: id || generateFoldId(date),
    title: String(title || ''),
    createdAt: timestamp,
    updatedAt: timestamp,
    blocks: unique.map((traceId, index) => createTraceBlock(traceId, new Date(new Date(timestamp).getTime() + index))),
    edition: 0
  };
}

export function reviseFold(fold, patch = {}, date = new Date()) {
  return {
    ...fold,
    ...patch,
    title: patch.title === undefined ? fold.title : String(patch.title || ''),
    blocks: patch.blocks === undefined ? [...(fold.blocks || [])] : [...patch.blocks],
    updatedAt: iso(date)
  };
}

export function addTracesToFold(fold, traceIds = [], date = new Date()) {
  const existing = new Set((fold.blocks || []).filter(block => block.type === 'trace').map(block => block.traceId));
  const additions = [...new Set((traceIds || []).map(value => String(value || '').trim()).filter(id => id && !existing.has(id)))];
  if (!additions.length) return fold;
  const base = new Date(date).getTime();
  return reviseFold(fold, {
    blocks: [...(fold.blocks || []), ...additions.map((traceId, index) => createTraceBlock(traceId, new Date(base + index)))]
  }, date);
}

export function addBridgeToFold(fold, content = '', date = new Date()) {
  const text = String(content || '').trim();
  if (!text) return fold;
  return reviseFold(fold, { blocks: [...(fold.blocks || []), createBridgeBlock(text, date)] }, date);
}

export function updateBridgeBlock(fold, blockIdValue, content, date = new Date()) {
  return reviseFold(fold, {
    blocks: (fold.blocks || []).map(block => block.id === blockIdValue && block.type === 'bridge' ? { ...block, content: String(content || '') } : block)
  }, date);
}

export function toggleTraceBlockPin(fold, blockIdValue, trace, date = new Date()) {
  return reviseFold(fold, {
    blocks: (fold.blocks || []).map(block => {
      if (block.id !== blockIdValue || block.type !== 'trace') return block;
      if (block.mode === 'pinned') return { ...block, mode: 'live', pinned: null };
      if (!trace) return block;
      return {
        ...block,
        mode: 'pinned',
        pinned: {
          content: String(trace.content || ''),
          updatedAt: String(trace.updatedAt || trace.createdAt || ''),
          revisionCount: Array.isArray(trace.revisions) ? trace.revisions.length : 0
        }
      };
    })
  }, date);
}

export function moveFoldBlock(fold, blockIdValue, direction, date = new Date()) {
  const blocks = [...(fold.blocks || [])];
  const index = blocks.findIndex(block => block.id === blockIdValue);
  const nextIndex = direction === 'up' ? index - 1 : direction === 'down' ? index + 1 : index;
  if (index < 0 || nextIndex < 0 || nextIndex >= blocks.length || nextIndex === index) return fold;
  [blocks[index], blocks[nextIndex]] = [blocks[nextIndex], blocks[index]];
  return reviseFold(fold, { blocks }, date);
}

export function removeFoldBlock(fold, blockIdValue, date = new Date()) {
  const blocks = (fold.blocks || []).filter(block => block.id !== blockIdValue);
  if (blocks.length === (fold.blocks || []).length) return fold;
  return reviseFold(fold, { blocks }, date);
}

export function resolveFoldBlock(block, tracesById) {
  if (block.type === 'bridge') return { content: String(block.content || ''), missing: false, source: null };
  if (block.mode === 'pinned' && block.pinned) return { content: String(block.pinned.content || ''), missing: false, source: block.pinned };
  const trace = tracesById instanceof Map ? tracesById.get(block.traceId) : tracesById?.[block.traceId];
  return trace
    ? { content: String(trace.content || ''), missing: false, source: trace }
    : { content: '', missing: true, source: null };
}

export function serializeFoldMarkdown(fold, tracesById) {
  const sections = [];
  const sources = [];
  for (const block of fold.blocks || []) {
    const resolved = resolveFoldBlock(block, tracesById);
    if (block.type === 'bridge') {
      if (resolved.content.trim()) sections.push(resolved.content.trim());
      continue;
    }
    const mode = block.mode === 'pinned' ? 'pinned' : 'live';
    const updatedAt = String(resolved.source?.updatedAt || 'missing');
    sections.push(resolved.missing ? `[Missing Trace: ${block.traceId}]` : resolved.content.trim());
    sources.push(`[trace-source-${sources.length + 1}]: trace:${block.traceId} "mode=${mode}; updated=${updatedAt}"`);
  }
  const body = sections.filter(Boolean).join('\n\n');
  return `${body}${sources.length ? `\n\n${sources.join('\n')}` : ''}\n`;
}

export function foldTraceIds(fold) {
  return [...new Set((fold?.blocks || []).filter(block => block.type === 'trace').map(block => block.traceId))];
}

export function usedTraceIds(folds) {
  return new Set((folds || []).flatMap(foldTraceIds));
}

export function foldStats(fold, tracesById) {
  let characters = 0;
  let missing = 0;
  let traceBlocks = 0;
  let bridgeBlocks = 0;
  let pinned = 0;
  for (const block of fold?.blocks || []) {
    const resolved = resolveFoldBlock(block, tracesById);
    characters += resolved.content.replace(/\s/g, '').length;
    if (resolved.missing) missing += 1;
    if (block.type === 'trace') {
      traceBlocks += 1;
      if (block.mode === 'pinned') pinned += 1;
    } else bridgeBlocks += 1;
  }
  return { characters, missing, traceBlocks, bridgeBlocks, pinned, blocks: (fold?.blocks || []).length };
}
