import { DATE_TIME, PLATES } from './traceConfig.js';
import TraceCard, { scrollToTrace } from './TraceCard.jsx';
import { filterTracePlate, traceExcerpt } from './traces.js';

export default function TraceView({
  token,
  busy,
  conflicts,
  syncCount,
  syncPublic,
  connectGithub,
  disconnectGithub,
  activeTraces,
  motifs,
  plate,
  setPlate,
  selectedMotif,
  setSelectedMotif,
  resurface,
  exportJson,
  importRef,
  importJson,
  submitTrace,
  content,
  setContent,
  relation,
  setRelation,
  relationTarget,
  composerRef,
  motifInput,
  setMotifInput,
  kind,
  setKind,
  visibility,
  setVisibility,
  echoes,
  setEchoes,
  filtered,
  query,
  setQuery,
  status,
  oauthError,
  byId,
  incoming,
  editing,
  setEditing,
  beginEdit,
  saveEdit,
  startRelation,
  deleteTrace,
  resolveConflict,
  acceptRemoteDelete
}) {
  return <div className="trace-shell">
    <header className="trace-top">
      <div className="trace-brand"><a href="/">SYNOMARE</a><span>TRACE / FIELD</span></div>
      <nav><a href="/admin/notes/">NOTES</a><span>STREAM</span></nav>
      <div className="trace-session">
        {token ? <><button onClick={syncPublic} disabled={busy || conflicts > 0}>{busy ? 'SYNCING…' : `SYNC PUBLIC${syncCount ? ` / ${syncCount}` : ''}`}</button><button onClick={disconnectGithub}>DISCONNECT</button></> : <button onClick={connectGithub}>CONNECT GITHUB</button>}
      </div>
    </header>

    <main className="trace-workspace">
      <aside className="trace-sidebar">
        <section><h2>PLATES</h2>{PLATES.map(([value, label]) => <button key={value} className={plate === value ? 'active' : ''} onClick={() => setPlate(value)}>{label}<span>{filterTracePlate(activeTraces, { plate: value }).length}</span></button>)}</section>
        <section><h2>MOTIFS / {motifs.length}</h2><button className={!selectedMotif ? 'active' : ''} onClick={() => setSelectedMotif('')}>ALL<span>{activeTraces.length}</span></button>{motifs.slice(0, 24).map(item => <button key={item.motif} className={selectedMotif === item.motif ? 'active' : ''} onClick={() => setSelectedMotif(current => current === item.motif ? '' : item.motif)}>{item.motif}<span>{item.count}</span></button>)}</section>
        {resurface ? <section className="trace-resurface"><h2>RESURFACE</h2><button onClick={() => scrollToTrace(resurface.id)}><time>{DATE_TIME.format(new Date(resurface.createdAt))}</time>{traceExcerpt(resurface, 120)}</button></section> : null}
        <section className="trace-backup"><h2>LOCAL VAULT</h2><p>LOCAL ONLYはこのブラウザのIndexedDBに保存されます。定期的にJSONを書き出してください。</p><button onClick={exportJson}>EXPORT JSON</button><button onClick={() => importRef.current?.click()}>IMPORT JSON</button><input ref={importRef} type="file" accept="application/json" onChange={importJson}/></section>
        <section className="trace-warning"><h2>PUBLIC REPO</h2><p>PUBLIC REPOは公開リポジトリへMarkdownを書き込みます。後から削除してもGit履歴には残り得ます。</p></section>
      </aside>

      <section className="trace-stream">
        <form id="trace-composer" className="trace-composer" onSubmit={submitTrace}>
          <div className="trace-composer-label"><span>DROP A TRACE</span><span>{content.length} CHARACTERS</span></div>
          {relation ? <div className="trace-replying"><span>{relation.type.toUpperCase()} →</span><button type="button" onClick={() => relationTarget && scrollToTrace(relationTarget.id)}>{relationTarget ? traceExcerpt(relationTarget, 100) : relation.target}</button><button type="button" onClick={() => setRelation(null)}>×</button></div> : null}
          <textarea ref={composerRef} value={content} onChange={event => setContent(event.target.value)} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submitTrace(event); }} placeholder="タイトルも分類も決めずに書く。⌘ / Ctrl + Enter で保存。" aria-label="新しいTrace"/>
          <div className="trace-composer-meta">
            <input value={motifInput} onChange={event => setMotifInput(event.target.value)} placeholder="MOTIFS / optional / comma separated" aria-label="Motif" list="trace-motif-list"/>
            <datalist id="trace-motif-list">{motifs.map(item => <option key={item.motif} value={item.motif}/>)}</datalist>
            <div className="trace-segment"><button type="button" className={kind === 'note' ? 'active' : ''} onClick={() => setKind('note')}>NOTE</button><button type="button" className={kind === 'question' ? 'active' : ''} onClick={() => setKind('question')}>QUESTION</button></div>
            <div className="trace-segment"><button type="button" className={visibility === 'local' ? 'active' : ''} onClick={() => setVisibility('local')}>LOCAL ONLY</button><button type="button" className={visibility === 'public' ? 'active' : ''} onClick={() => setVisibility('public')}>PUBLIC REPO</button></div>
            <button className="primary" type="submit" disabled={!content.trim() || busy}>DROP <span>⌘↵</span></button>
          </div>
        </form>

        {echoes.length ? <section className="trace-echoes"><header><h2>ECHOES / {echoes.length}</h2><button onClick={() => setEchoes([])}>CLEAR</button></header>{echoes.map(result => <div key={result.trace.id}><button onClick={() => scrollToTrace(result.trace.id)}>{traceExcerpt(result.trace, 120)}</button><small>{result.sharedMotifs.length ? `MOTIF: ${result.sharedMotifs.join(', ')}` : ''}{result.sharedMotifs.length && result.sharedWords.length ? ' / ' : ''}{result.sharedWords.length ? `TERMS: ${result.sharedWords.join(', ')}` : ''}</small></div>)}</section> : null}

        <div className="trace-index-head">
          <div><strong>{filtered.length}</strong> TRACES / {plate.toUpperCase()}{selectedMotif ? ` / ${selectedMotif}` : ''}</div>
          <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="SEARCH CONTENT / MOTIF / ID" aria-label="Traceを検索"/>
        </div>
        <div className="trace-status" aria-live="polite">{status}{oauthError ? ` / ${oauthError}` : ''}</div>

        <div className="trace-list">
          {filtered.length ? filtered.map(trace => <TraceCard
            key={trace.id}
            trace={trace}
            byId={byId}
            incoming={incoming.get(trace.id) || []}
            editing={editing}
            onEdit={beginEdit}
            onEditChange={patch => setEditing(current => ({ ...current, ...patch }))}
            onEditCancel={() => setEditing(null)}
            onEditSave={saveEdit}
            onRelation={startRelation}
            onDelete={deleteTrace}
            onResolve={resolveConflict}
            onAcceptDelete={acceptRemoteDelete}
          />) : <div className="trace-empty"><strong>NO TRACE ON THIS PLATE</strong><p>条件を外すか、新しい断片を投下してください。</p></div>}
        </div>
      </section>
    </main>
  </div>;
}
