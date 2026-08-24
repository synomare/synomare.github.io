import { useMemo, useState } from 'react';
import { moveRelatedReference, normalizeNoteReference, relatedState, resolveRelatedReference, uniqueRelatedReferences } from './relatedNotes.js';

function matchesQuery(row, query) {
  if (!query.trim()) return true;
  const value = row.document ? `${row.document.title} ${row.document.slug} ${(row.document.aliases || []).join(' ')}` : row.value;
  return normalizeNoteReference(value).includes(normalizeNoteReference(query));
}

function statusLabel(row) {
  if (row.kind === 'attention') {
    if (row.status === 'ambiguous') return `AMBIGUOUS / ${(row.matches || []).length} MATCHES`;
    if (row.status === 'draft') return 'DRAFT — NOT PUBLIC';
    if (row.status === 'self') return 'SELF REFERENCE';
    if (row.status === 'conflict') return 'IN ADD + EXCLUDE';
    return 'UNRESOLVED';
  }
  if (row.kind === 'manual') return row.conflict ? 'MANUAL / ALSO EXCLUDED' : 'MANUAL';
  if (row.kind === 'excluded') return row.document?.draft ? 'EXCLUDED / DRAFT' : 'EXCLUDED';
  if (row.kind === 'automatic') return `AUTO / ${row.shared} SHARED TAG${row.shared === 1 ? '' : 'S'}`;
  if (row.document?.draft) return 'DRAFT — NOT PUBLIC';
  return row.shared ? `AUTO CANDIDATE / ${row.shared} SHARED TAG${row.shared === 1 ? '' : 'S'}` : 'AVAILABLE';
}

function RelatedRow({ row, onAdd, onRemove, onRestore, onMove, onRepair }) {
  const label = row.document?.title || row.value || row.document?.slug || 'UNRESOLVED';
  const slug = row.document?.slug || row.value;
  const status = statusLabel(row);
  const repairMatches = row.kind === 'attention' && row.status === 'ambiguous' ? (row.matches || []) : [];
  return <div className={`related-row is-${row.kind} is-${row.status || ''}`}>
    <div><strong>{label}</strong><small>{slug || 'UNRESOLVED'} · {status}</small>{row.kind === 'attention' && repairMatches.length ? <div className="related-repair-list">{repairMatches.map(match => <button type="button" className="related-repair" key={match.slug} onClick={() => onRepair(row, match)}>REPAIR → {match.title || match.slug}</button>)}</div> : null}</div>
    <div className="related-row-actions">
      {row.kind === 'manual' ? <><button type="button" title="MOVE UP" onClick={() => onMove(row.value, -1)} aria-label={`${label}を上へ移動`}>↑</button><button type="button" title="MOVE DOWN" onClick={() => onMove(row.value, 1)} aria-label={`${label}を下へ移動`}>↓</button><button type="button" onClick={() => onRemove(row.value || row.document.slug)}>REMOVE</button></> : row.kind === 'automatic' ? <button type="button" onClick={() => onRemove(row.value || row.document.slug)}>REMOVE</button> : row.kind === 'excluded' ? <button type="button" onClick={() => onRestore(row.value)}>RESTORE</button> : row.kind === 'attention' ? <button type="button" onClick={() => onRemove(row.value, row.source)}>REMOVE</button> : <button type="button" onClick={() => onAdd(row.document)}>ADD</button>}
    </div>
  </div>;
}

export default function RelatedNotesEditor({ note, documents, onChange }) {
  const [query, setQuery] = useState('');
  const [resetBackup, setResetBackup] = useState(null);
  const state = useMemo(() => relatedState(note, documents), [note, documents]);
  const relatedNotes = Array.isArray(note.relatedNotes) ? note.relatedNotes : [];
  const relatedExclude = Array.isArray(note.relatedExclude) ? note.relatedExclude : [];
  const current = useMemo(() => state.current.filter(row => matchesQuery(row, query)), [state, query]);
  const addOrHidden = useMemo(() => {
    const rows = [...state.excluded, ...state.available].filter(row => matchesQuery(row, query));
    return query.trim() ? rows : rows.slice(0, Math.max(8, state.excluded.length));
  }, [state, query]);
  const addManual = document => {
    if (!document) return;
    onChange({ relatedNotes: uniqueRelatedReferences([...relatedNotes, document.slug]), relatedExclude: relatedExclude.filter(value => resolveRelatedReference(value, state.indexes)?.slug !== document.slug && normalizeNoteReference(value) !== normalizeNoteReference(document.slug)) });
  };
  const remove = (value, source) => {
    const document = resolveRelatedReference(value, state.indexes);
    // Attention rows are repairable data, not an instruction to add a new
    // exclusion. Removing one clears the exact source and keeps the other
    // list intact unless the same resolved target was present in both lists.
    if (source === 'manual') {
      onChange({ relatedNotes: relatedNotes.filter(item => item !== value) });
      return;
    }
    if (source === 'excluded') {
      onChange({ relatedExclude: relatedExclude.filter(item => item !== value) });
      return;
    }
    const excluded = document?.slug || value;
    onChange({ relatedNotes: relatedNotes.filter(item => item !== value), relatedExclude: uniqueRelatedReferences([...relatedExclude, excluded]) });
  };
  const restore = value => {
    const document = resolveRelatedReference(value, state.indexes);
    onChange({ relatedExclude: relatedExclude.filter(item => item !== value && (!document || resolveRelatedReference(item, state.indexes)?.slug !== document.slug)) });
  };
  const move = (value, delta) => onChange({ relatedNotes: moveRelatedReference(relatedNotes, value, delta) });
  const repair = (row, document) => {
    if (!document) return;
    const field = row.source === 'excluded' ? 'relatedExclude' : 'relatedNotes';
    const values = field === 'relatedExclude' ? relatedExclude : relatedNotes;
    onChange({ [field]: values.map(item => item === row.value ? document.slug : item) });
  };
  const resetAuto = () => {
    if (!relatedNotes.length && !relatedExclude.length) return;
    setResetBackup({ relatedNotes, relatedExclude });
    onChange({ relatedNotes: [], relatedExclude: [] });
  };
  const undoReset = () => {
    if (!resetBackup) return;
    onChange(resetBackup);
    setResetBackup(null);
  };

  return <section className="related-editor">
    <div className="related-editor-head"><span className="token-label">RELATED NOTES <small>{state.current.filter(row => row.kind === 'manual').length} MANUAL · AUTO TAGS</small></span><div className="related-editor-head-actions"><p>タグの自動候補に、任意の記事を追加／除外できます。</p><button type="button" className="related-reset" onClick={resetAuto} disabled={!relatedNotes.length && !relatedExclude.length}>RESET AUTO</button>{resetBackup ? <button type="button" className="related-reset related-undo" onClick={undoReset}>UNDO RESET</button> : null}</div></div>
    <input className="related-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="記事名、slug、aliasを検索" aria-label="関連記事を検索"/>
    <div className="related-group-label">CURRENT RELATED / {state.current.length}</div>
    <div className="related-list">{current.length ? current.map(row => <RelatedRow row={row} onAdd={addManual} onRemove={remove} onRestore={restore} onMove={move} onRepair={repair} key={`${row.kind}-${row.document?.slug || row.value}`}/>) : <p className="related-empty">現在表示される関連記事はありません。</p>}</div>
    {state.attention.length ? <><div className="related-group-label related-attention-label">ATTENTION / {state.attention.length}</div><div className="related-list related-attention-list">{state.attention.filter(row => matchesQuery(row, query)).map(row => <RelatedRow row={row} onAdd={addManual} onRemove={remove} onRestore={restore} onMove={move} onRepair={repair} key={`${row.source}-${row.status}-${row.value}`}/>)}</div></> : null}
    <div className="related-group-label">ADD / HIDDEN</div>
    <div className="related-list">{addOrHidden.length ? addOrHidden.map(row => <RelatedRow row={row} onAdd={addManual} onRemove={remove} onRestore={restore} onMove={move} onRepair={repair} key={`${row.kind}-${row.document?.slug || row.value}`}/>) : <p className="related-empty">一致する追加候補はありません。</p>}</div>
    <small className="related-help">REMOVEはタグによる自動再追加も防ぎます。RESTOREで自動候補へ戻ります。↑↓で手動関連記事の順序を変更できます。RESET AUTOはGitHubへ公開せず、ローカル下書きとして保存します。</small>
  </section>;
}
