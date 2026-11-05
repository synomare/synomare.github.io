import { RELATION_TYPES } from './traces.js';
import { usedTraceIds } from './folds.js';

const monthKey = value => String(value || '').slice(0, 7);

export function buildFieldMatrix(traces, { maxMotifs = 16, maxMonths = 12 } = {}) {
  const active = (traces || []).filter(trace => !trace.deleted);
  const monthCounts = new Map();
  const motifCounts = new Map();
  for (const trace of active) {
    const month = monthKey(trace.createdAt);
    monthCounts.set(month, (monthCounts.get(month) || 0) + 1);
    const motifs = trace.motifs?.length ? trace.motifs : ['∅ UNPLACED'];
    for (const motif of motifs) motifCounts.set(motif, (motifCounts.get(motif) || 0) + 1);
  }
  const months = [...monthCounts.keys()].sort().slice(-maxMonths);
  const motifOrder = [...motifCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'))
    .slice(0, maxMotifs)
    .map(([motif]) => motif);
  let maxCell = 0;
  const rows = motifOrder.map(motif => {
    const cells = months.map(month => {
      const ids = active.filter(trace => monthKey(trace.createdAt) === month && (trace.motifs?.length ? trace.motifs.includes(motif) : motif === '∅ UNPLACED')).map(trace => trace.id);
      maxCell = Math.max(maxCell, ids.length);
      return { month, ids, count: ids.length };
    });
    return { motif, total: motifCounts.get(motif) || 0, cells };
  });
  return { months, rows, maxCell: Math.max(1, maxCell), traceCount: active.length };
}

export function motifIntersection(traces, motifs = []) {
  const values = [...new Set((motifs || []).filter(Boolean))];
  if (!values.length) return [];
  return (traces || []).filter(trace => !trace.deleted && values.every(motif => (trace.motifs || []).includes(motif)));
}

export function relationStats(traces) {
  const activeIds = new Set((traces || []).filter(trace => !trace.deleted).map(trace => trace.id));
  const counts = new Map(RELATION_TYPES.map(type => [type.value, 0]));
  let total = 0;
  let unresolved = 0;
  for (const trace of traces || []) {
    if (trace.deleted) continue;
    for (const relation of trace.relations || []) {
      total += 1;
      counts.set(relation.type, (counts.get(relation.type) || 0) + 1);
      if (!activeIds.has(relation.target)) unresolved += 1;
    }
  }
  return {
    total,
    unresolved,
    rows: RELATION_TYPES.map(type => ({ ...type, count: counts.get(type.value) || 0 }))
  };
}

export function fieldSummary(traces, folds = []) {
  const active = (traces || []).filter(trace => !trace.deleted);
  const used = usedTraceIds(folds);
  const motifSet = new Set(active.flatMap(trace => trace.motifs || []));
  const relation = relationStats(active);
  return {
    traces: active.length,
    motifs: motifSet.size,
    relations: relation.total,
    folds: (folds || []).length,
    used: active.filter(trace => used.has(trace.id)).length,
    unused: active.filter(trace => !used.has(trace.id)).length,
    questions: active.filter(trace => trace.kind === 'question').length,
    revisions: active.reduce((sum, trace) => sum + (trace.revisions?.length || 0), 0)
  };
}
