const FIELD_DEFINITIONS = [
  ['postType', 'TYPE'],
  ['title', 'TITLE'],
  ['date', 'DATE'],
  ['summary', 'SUMMARY'],
  ['tags', 'TAGS'],
  ['aliases', 'ALIASES'],
  ['relatedNotes', 'RELATED'],
  ['relatedExclude', 'RELATED EXCLUDE'],
  ['cardSize', 'CARD SIZE'],
  ['cardExcerpt', 'CARD EXCERPT'],
  ['draft', 'STATUS'],
  ['photo', 'PHOTO']
];

const normalizedLines = value => {
  const normalized = String(value || '').replace(/\r\n?/g, '\n');
  return normalized ? normalized.split('\n') : [];
};

function sameValue(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) {
    const first = Array.isArray(left) ? left : [];
    const second = Array.isArray(right) ? right : [];
    return first.length === second.length && first.every((value, index) => value === second[index]);
  }
  return left === right;
}

export function formatChangeValue(key, value) {
  if (Array.isArray(value)) return value.join(', ') || '—';
  if (key === 'draft') return value ? 'GITHUB DRAFT' : 'PUBLIC';
  return String(value || '—');
}

function fallbackLineDiff(before, after) {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix += 1;
  const operations = [];
  before.slice(0, prefix).forEach(text => operations.push({ type: 'same', text }));
  before.slice(prefix, before.length - suffix).forEach(text => operations.push({ type: 'remove', text }));
  after.slice(prefix, after.length - suffix).forEach(text => operations.push({ type: 'add', text }));
  before.slice(before.length - suffix).forEach(text => operations.push({ type: 'same', text }));
  return operations;
}

function lcsLineDiff(before, after) {
  const matrix = Array.from({ length: before.length + 1 }, () => new Uint32Array(after.length + 1));
  for (let left = before.length - 1; left >= 0; left -= 1) {
    for (let right = after.length - 1; right >= 0; right -= 1) {
      matrix[left][right] = before[left] === after[right]
        ? matrix[left + 1][right + 1] + 1
        : Math.max(matrix[left + 1][right], matrix[left][right + 1]);
    }
  }
  const operations = [];
  let left = 0;
  let right = 0;
  while (left < before.length && right < after.length) {
    if (before[left] === after[right]) {
      operations.push({ type: 'same', text: before[left] });
      left += 1;
      right += 1;
    } else if (matrix[left + 1][right] >= matrix[left][right + 1]) {
      operations.push({ type: 'remove', text: before[left] });
      left += 1;
    } else {
      operations.push({ type: 'add', text: after[right] });
      right += 1;
    }
  }
  while (left < before.length) operations.push({ type: 'remove', text: before[left++] });
  while (right < after.length) operations.push({ type: 'add', text: after[right++] });
  return operations;
}

function compactOperations(operations, context = 2) {
  const changed = operations.map((operation, index) => operation.type === 'same' ? -1 : index).filter(index => index >= 0);
  if (!changed.length) return [];
  const visible = new Set();
  changed.forEach(index => {
    for (let cursor = Math.max(0, index - context); cursor <= Math.min(operations.length - 1, index + context); cursor += 1) visible.add(cursor);
  });
  const compact = [];
  let cursor = 0;
  while (cursor < operations.length) {
    if (visible.has(cursor)) {
      compact.push(operations[cursor]);
      cursor += 1;
      continue;
    }
    const start = cursor;
    while (cursor < operations.length && !visible.has(cursor)) cursor += 1;
    compact.push({ type: 'skip', count: cursor - start });
  }
  return compact;
}

export function diffLines(beforeValue, afterValue) {
  if (String(beforeValue || '') === String(afterValue || '')) return { changed: false, added: 0, removed: 0, operations: [] };
  const before = normalizedLines(beforeValue);
  const after = normalizedLines(afterValue);
  const operations = before.length * after.length <= 250000
    ? lcsLineDiff(before, after)
    : fallbackLineDiff(before, after);
  return {
    changed: true,
    added: operations.reduce((total, operation) => total + (operation.type === 'add' ? 1 : 0), 0),
    removed: operations.reduce((total, operation) => total + (operation.type === 'remove' ? 1 : 0), 0),
    operations: compactOperations(operations)
  };
}

export function compareNotes(base, current) {
  if (!current) return { kind: 'empty', changed: false, metadata: [], body: diffLines('', '') };
  if (!base) return { kind: 'new', changed: true, metadata: [], body: diffLines('', current.body) };
  const metadata = FIELD_DEFINITIONS.flatMap(([key, label]) => sameValue(base[key], current[key]) ? [] : [{
    key,
    label,
    before: formatChangeValue(key, base[key]),
    after: formatChangeValue(key, current[key])
  }]);
  const body = diffLines(base.body, current.body);
  return { kind: 'existing', changed: metadata.length > 0 || body.changed, metadata, body };
}

export function changeSummary(comparison) {
  if (!comparison || comparison.kind === 'empty') return 'NO NOTE';
  if (comparison.kind === 'new') return 'NEW NOTE';
  if (!comparison.changed) return 'NO CHANGES';
  const parts = [];
  if (comparison.metadata.length) parts.push(`${comparison.metadata.length} FIELD${comparison.metadata.length === 1 ? '' : 'S'}`);
  if (comparison.body.changed) parts.push(`+${comparison.body.added} / −${comparison.body.removed} LINES`);
  return parts.join(' · ');
}
