import { DATE_TIME } from './traceConfig.js';
import { traceExcerpt } from './traces.js';

function syncLabel(trace) {
  if (trace.syncStatus === 'conflict') return 'CONFLICT';
  if (trace.syncStatus === 'queued-delete') return 'DELETE QUEUED';
  if (trace.syncStatus === 'queued') return 'SYNC QUEUED';
  if (trace.syncStatus === 'synced') return 'SYNCED';
  return 'LOCAL';
}

export function scrollToTrace(id) {
  document.getElementById(`trace-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function TraceEditor({ editing, onChange, onCancel, onSave }) {
  return <form className="trace-edit" onSubmit={event => { event.preventDefault(); onSave(); }}>
    <textarea value={editing.content} onChange={event => onChange({ content: event.target.value })} aria-label="Trace本文を編集" autoFocus/>
    <div className="trace-edit-grid">
      <label>MOTIFS<input value={editing.motifs} onChange={event => onChange({ motifs: event.target.value })}/></label>
      <label>TYPE<select value={editing.kind} onChange={event => onChange({ kind: event.target.value })}><option value="note">NOTE</option><option value="question">QUESTION</option></select></label>
      <label>STORAGE<select value={editing.visibility} onChange={event => onChange({ visibility: event.target.value })}><option value="local">LOCAL ONLY</option><option value="public">PUBLIC REPO</option></select></label>
    </div>
    <div className="trace-edit-actions"><button type="button" onClick={onCancel}>CANCEL</button><button className="primary" type="submit">SAVE REVISION</button></div>
  </form>;
}

function TraceConflict({ trace, onResolve, onAcceptDelete }) {
  const remote = trace.conflict?.remote;
  return <section className="trace-conflict">
    <strong>REMOTE CONFLICT</strong>
    <p>{remote ? remote.content : 'Remote側でこのTraceが削除されています。'}</p>
    <div>
      <button onClick={() => onResolve(trace, 'local')}>KEEP LOCAL / REPUBLISH</button>
      {remote ? <button onClick={() => onResolve(trace, 'remote')}>USE REMOTE</button> : <button onClick={() => onAcceptDelete(trace)}>ACCEPT REMOTE DELETE</button>}
    </div>
  </section>;
}

export default function TraceCard({ trace, byId, incoming, editing, selected, onToggleSelection, onEdit, onEditChange, onEditCancel, onEditSave, onRelation, onDelete, onResolve, onAcceptDelete }) {
  return <article id={`trace-${trace.id}`} className={`trace-card is-${trace.kind} sync-${trace.syncStatus} ${selected ? 'is-selected' : ''}`}>
    <header className="trace-card-meta">
      <time dateTime={trace.createdAt}>{DATE_TIME.format(new Date(trace.createdAt))}</time>
      <span>{trace.visibility === 'public' ? 'PUBLIC REPO' : 'LOCAL ONLY'}</span>
      <span>{syncLabel(trace)}</span>
      {trace.kind === 'question' ? <span className="trace-kind">QUESTION</span> : null}
    </header>
    {editing?.id === trace.id
      ? <TraceEditor editing={editing} onChange={onEditChange} onCancel={onEditCancel} onSave={onEditSave}/>
      : <p className="trace-content">{trace.content}</p>}
    {trace.motifs?.length ? <div className="trace-motifs">{trace.motifs.map(motif => <span key={motif}>⌁ {motif}</span>)}</div> : null}
    {trace.relations?.length ? <div className="trace-relations">{trace.relations.map((relation, index) => {
      const target = byId.get(relation.target);
      return <button key={`${relation.type}-${relation.target}-${index}`} onClick={() => scrollToTrace(relation.target)} disabled={!target}>→ {relation.type.toUpperCase()} / {target ? traceExcerpt(target, 58) : relation.target}</button>;
    })}</div> : null}
    {incoming?.length ? <details className="trace-incoming"><summary>INCOMING / {incoming.length}</summary>{incoming.map(source => <button key={source.id} onClick={() => scrollToTrace(source.id)}>← {traceExcerpt(source, 62)}</button>)}</details> : null}
    {trace.revisions?.length ? <details className="trace-history"><summary>REVISION HISTORY / {trace.revisions.length}</summary>{[...trace.revisions].reverse().map(revision => <div key={revision.id}><time>{DATE_TIME.format(new Date(revision.createdAt))}</time><p>{revision.content}</p></div>)}</details> : null}
    {trace.conflict ? <TraceConflict trace={trace} onResolve={onResolve} onAcceptDelete={onAcceptDelete}/> : null}
    {editing?.id === trace.id ? null : <footer className="trace-card-actions">
      <button className={selected ? 'selected' : ''} onClick={() => onToggleSelection(trace.id)}>{selected ? 'SELECTED' : 'SELECT'}</button>
      <button onClick={() => onRelation(trace, 'continues')}>CONTINUE</button>
      <button onClick={() => onRelation(trace, 'contrasts')}>CONTRAST</button>
      <details><summary>CONNECT</summary><button onClick={() => onRelation(trace, 'exemplifies')}>EXAMPLE</button><button onClick={() => onRelation(trace, 'answers')}>ANSWER</button><button onClick={() => onRelation(trace, 'cites')}>CITE</button></details>
      <button onClick={() => onEdit(trace)} disabled={trace.syncStatus === 'conflict'}>EDIT</button>
      <button className="danger" onClick={() => onDelete(trace)}>DELETE</button>
    </footer>}
  </article>;
}
