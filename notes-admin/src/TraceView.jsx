import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { saveDraft } from './drafts.js';
import FieldView from './FieldView.jsx';
import FoldStudio from './FoldStudio.jsx';
import {
  addBridgeToFold,
  addTracesToFold,
  createFold as makeFold,
  moveFoldBlock,
  removeFoldBlock,
  reviseFold,
  serializeFoldMarkdown,
  toggleTraceBlockPin,
  updateBridgeBlock,
  usedTraceIds
} from './folds.js';
import { newNote } from './lib.js';
import TraceCard, { scrollToTrace } from './TraceCard.jsx';
import { DATE_TIME, PLATES, QA_PREVIEW, SURFACES } from './traceConfig.js';
import { filterTracePlate, traceExcerpt } from './traces.js';
import {
  listStoredFolds,
  removeStoredFold,
  saveStoredFold,
  saveStoredFolds
} from './traceStore.js';

const VALID_SURFACES = new Set(SURFACES.map(([value]) => value));
const initialSurface = () => {
  const value = new URLSearchParams(location.search).get('surface');
  return VALID_SURFACES.has(value) ? value : 'stream';
};

function TraceHeader({ surface, setSurface, token, busy, conflicts, syncCount, syncPublic, connectGithub, disconnectGithub }) {
  return <header className="trace-top">
    <div className="trace-brand"><a href="/">SYNOMARE</a><span>TRACE / FIELD / FOLD</span></div>
    <nav><a href="/admin/notes/">NOTES</a>{SURFACES.map(([value, label]) => <button type="button" key={value} className={surface === value ? 'active' : ''} onClick={() => setSurface(value)}>{label}</button>)}</nav>
    <div className="trace-session">
      {token ? <><button type="button" onClick={syncPublic} disabled={busy || conflicts > 0}>{busy ? 'SYNCING…' : `SYNC PUBLIC${syncCount ? ` / ${syncCount}` : ''}`}</button><button type="button" onClick={disconnectGithub}>DISCONNECT</button></> : <button type="button" onClick={connectGithub}>CONNECT GITHUB</button>}
    </div>
  </header>;
}

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
  const [surfaceState, setSurfaceState] = useState(initialSurface);
  const [folds, setFolds] = useState([]);
  const [foldsLoaded, setFoldsLoaded] = useState(false);
  const [activeFoldId, setActiveFoldId] = useState('');
  const [selectedTraceIds, setSelectedTraceIds] = useState([]);
  const [workspaceStatus, setWorkspaceStatus] = useState('');
  const foldImportRef = useRef(null);

  const setSurface = useCallback(next => {
    const value = VALID_SURFACES.has(next) ? next : 'stream';
    setSurfaceState(value);
    const url = new URL(location.href);
    url.searchParams.set('view', 'stream');
    if (value === 'stream') url.searchParams.delete('surface');
    else url.searchParams.set('surface', value);
    history.replaceState(null, '', url);
  }, []);

  useEffect(() => {
    let active = true;
    listStoredFolds().then(values => {
      if (!active) return;
      setFolds(values);
      setActiveFoldId(values[0]?.id || '');
      setFoldsLoaded(true);
    }).catch(error => {
      if (!active) return;
      setFoldsLoaded(true);
      setWorkspaceStatus(`FOLD ERROR — ${error.message}`);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const ids = new Set(activeTraces.map(trace => trace.id));
    setSelectedTraceIds(current => {
      const next = current.filter(id => ids.has(id));
      return next.length === current.length ? current : next;
    });
  }, [activeTraces]);

  useEffect(() => {
    if (!folds.length) {
      if (activeFoldId) setActiveFoldId('');
      return;
    }
    if (!folds.some(fold => fold.id === activeFoldId)) setActiveFoldId(folds[0].id);
  }, [folds, activeFoldId]);

  const tracesById = useMemo(() => new Map(activeTraces.map(trace => [trace.id, trace])), [activeTraces]);
  const selectedTraces = useMemo(() => selectedTraceIds.map(id => tracesById.get(id)).filter(Boolean), [selectedTraceIds, tracesById]);
  const activeFold = useMemo(() => folds.find(fold => fold.id === activeFoldId) || null, [folds, activeFoldId]);
  const foldUsedTraceIds = useMemo(() => usedTraceIds(folds), [folds]);
  const visibleTraces = useMemo(() => plate === 'unused' ? filtered.filter(trace => !foldUsedTraceIds.has(trace.id)) : filtered, [filtered, plate, foldUsedTraceIds]);
  const plateCounts = useMemo(() => Object.fromEntries(PLATES.map(([value]) => {
    const base = filterTracePlate(activeTraces, { plate: value === 'unused' ? 'stream' : value });
    return [value, value === 'unused' ? base.filter(trace => !foldUsedTraceIds.has(trace.id)).length : base.length];
  })), [activeTraces, foldUsedTraceIds]);

  const persistFold = useCallback(async next => {
    if (!QA_PREVIEW) await saveStoredFold(next);
    setFolds(current => current.some(fold => fold.id === next.id)
      ? current.map(fold => fold.id === next.id ? next : fold)
      : [next, ...current]);
    setActiveFoldId(next.id);
    return next;
  }, []);

  const toggleTraceSelection = useCallback(id => {
    setSelectedTraceIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  }, []);

  const selectManyTraces = useCallback(ids => {
    const values = [...new Set((ids || []).filter(Boolean))];
    if (!values.length) return;
    setSelectedTraceIds(current => {
      const set = new Set(current);
      const allSelected = values.every(id => set.has(id));
      for (const id of values) allSelected ? set.delete(id) : set.add(id);
      return [...set];
    });
  }, []);

  const clearTraceSelection = useCallback(() => setSelectedTraceIds([]), []);

  const createFold = useCallback(async () => {
    const fold = makeFold({ traceIds: selectedTraceIds });
    await persistFold(fold);
    setSurface('folds');
    setWorkspaceStatus(selectedTraceIds.length ? `FOLD CREATED / ${selectedTraceIds.length} TRACES` : 'EMPTY FOLD CREATED');
  }, [selectedTraceIds, persistFold, setSurface]);

  const addSelectionToFold = useCallback(async () => {
    if (!activeFold || !selectedTraceIds.length) return;
    await persistFold(addTracesToFold(activeFold, selectedTraceIds));
    setWorkspaceStatus(`FOLD UPDATED / ${selectedTraceIds.length} SELECTED TRACES CONSIDERED`);
  }, [activeFold, selectedTraceIds, persistFold]);

  const renameFold = useCallback(async title => {
    if (activeFold) await persistFold(reviseFold(activeFold, { title }));
  }, [activeFold, persistFold]);

  const addBridge = useCallback(async text => {
    if (!activeFold) return;
    await persistFold(addBridgeToFold(activeFold, text));
    setWorkspaceStatus('BRIDGE TEXT ADDED');
  }, [activeFold, persistFold]);

  const updateBridge = useCallback(async (blockId, text) => {
    if (activeFold) await persistFold(updateBridgeBlock(activeFold, blockId, text));
  }, [activeFold, persistFold]);

  const moveBlock = useCallback(async (blockId, direction) => {
    if (activeFold) await persistFold(moveFoldBlock(activeFold, blockId, direction));
  }, [activeFold, persistFold]);

  const removeBlock = useCallback(async blockId => {
    if (activeFold) await persistFold(removeFoldBlock(activeFold, blockId));
  }, [activeFold, persistFold]);

  const togglePin = useCallback(async (blockId, trace) => {
    if (activeFold) await persistFold(toggleTraceBlockPin(activeFold, blockId, trace));
  }, [activeFold, persistFold]);

  const deleteFold = useCallback(async fold => {
    if (!confirm(`Fold「${fold.title || 'Untitled Fold'}」を削除しますか？ Trace自体は削除されません。`)) return;
    if (!QA_PREVIEW) await removeStoredFold(fold.id);
    setFolds(current => current.filter(value => value.id !== fold.id));
    setWorkspaceStatus('FOLD DELETED / SOURCE TRACES PRESERVED');
  }, []);

  const copyFoldMarkdown = useCallback(async () => {
    if (!activeFold) return;
    try {
      await navigator.clipboard.writeText(serializeFoldMarkdown(activeFold, tracesById));
      setWorkspaceStatus('FOLD MARKDOWN COPIED / TRACE PROVENANCE PRESERVED');
    } catch (error) { setWorkspaceStatus(`ERROR — ${error.message}`); }
  }, [activeFold, tracesById]);

  const sendFoldToNotes = useCallback(async () => {
    if (!activeFold) return;
    const body = serializeFoldMarkdown(activeFold, tracesById).trim();
    if (!body) { setWorkspaceStatus('ERROR — Foldが空です。'); return; }
    const note = { ...newNote([]), title: activeFold.title.trim() || 'Untitled Fold', body, draft: true };
    try {
      await saveDraft('note:new', { note, images: [] });
      location.href = '/admin/notes/';
    } catch (error) { setWorkspaceStatus(`ERROR — Notes下書きを作成できませんでした: ${error.message}`); }
  }, [activeFold, tracesById]);

  const exportFolds = useCallback(() => {
    const payload = JSON.stringify({ schema: 1, type: 'synomare-folds', exportedAt: new Date().toISOString(), folds }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `synomare-folds-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setWorkspaceStatus(`FOLDS EXPORTED / ${folds.length}`);
  }, [folds]);

  const importFolds = useCallback(async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      const imported = (Array.isArray(payload) ? payload : payload.folds || []).filter(fold => fold?.id && Array.isArray(fold.blocks));
      const map = new Map(folds.map(fold => [fold.id, fold]));
      for (const fold of imported) {
        const current = map.get(fold.id);
        if (!current || String(fold.updatedAt || '') > String(current.updatedAt || '')) map.set(fold.id, fold);
      }
      const next = [...map.values()];
      if (!QA_PREVIEW) await saveStoredFolds(next);
      setFolds(next);
      setWorkspaceStatus(`FOLDS IMPORTED / ${imported.length}`);
    } catch (error) { setWorkspaceStatus(`ERROR — Fold JSONを読み込めませんでした: ${error.message}`); }
  }, [folds]);

  const openStream = ({ plate: nextPlate = 'stream', motif = '' } = {}) => {
    setPlate(nextPlate);
    setSelectedMotif(motif);
    setSurface('stream');
  };

  return <div className="trace-shell">
    <TraceHeader surface={surfaceState} setSurface={setSurface} token={token} busy={busy} conflicts={conflicts} syncCount={syncCount} syncPublic={syncPublic} connectGithub={connectGithub} disconnectGithub={disconnectGithub}/>

    {surfaceState === 'field' ? <FieldView
      traces={activeTraces}
      folds={folds}
      motifs={motifs}
      selectedTraceIds={selectedTraceIds}
      onToggleTrace={toggleTraceSelection}
      onSelectMany={selectManyTraces}
      onOpenStream={openStream}
    /> : null}

    {surfaceState === 'folds' ? <FoldStudio
      folds={folds}
      foldsLoaded={foldsLoaded}
      activeFold={activeFold}
      activeFoldId={activeFoldId}
      setActiveFoldId={setActiveFoldId}
      tracesById={tracesById}
      selectedTraces={selectedTraces}
      selectedTraceIds={selectedTraceIds}
      onToggleTrace={toggleTraceSelection}
      onClearSelection={clearTraceSelection}
      onCreateFold={createFold}
      onAddSelection={addSelectionToFold}
      onRenameFold={renameFold}
      onAddBridge={addBridge}
      onUpdateBridge={updateBridge}
      onMoveBlock={moveBlock}
      onRemoveBlock={removeBlock}
      onTogglePin={togglePin}
      onDeleteFold={deleteFold}
      onCopyMarkdown={copyFoldMarkdown}
      onSendToNotes={sendFoldToNotes}
      onOpenStream={() => setSurface('stream')}
      status={workspaceStatus}
      onExportFolds={exportFolds}
      onImportFolds={importFolds}
      importRef={foldImportRef}
    /> : null}

    {surfaceState === 'stream' ? <main className="trace-workspace">
      <aside className="trace-sidebar">
        <section><h2>PLATES</h2>{PLATES.map(([value, label]) => <button type="button" key={value} className={plate === value ? 'active' : ''} onClick={() => setPlate(value)}>{label}<span>{plateCounts[value] || 0}</span></button>)}</section>
        <section><h2>MOTIFS / {motifs.length}</h2><button type="button" className={!selectedMotif ? 'active' : ''} onClick={() => setSelectedMotif('')}>ALL<span>{activeTraces.length}</span></button>{motifs.slice(0, 24).map(item => <button type="button" key={item.motif} className={selectedMotif === item.motif ? 'active' : ''} onClick={() => setSelectedMotif(current => current === item.motif ? '' : item.motif)}>{item.motif}<span>{item.count}</span></button>)}</section>
        {resurface ? <section className="trace-resurface"><h2>RESURFACE</h2><button type="button" onClick={() => scrollToTrace(resurface.id)}><time>{DATE_TIME.format(new Date(resurface.createdAt))}</time>{traceExcerpt(resurface, 120)}</button></section> : null}
        <section className="trace-backup"><h2>LOCAL VAULT</h2><p>Traceはこの画面のJSON、FoldはFOLDS画面のJSONでバックアップします。</p><button type="button" onClick={exportJson}>EXPORT TRACES</button><button type="button" onClick={() => importRef.current?.click()}>IMPORT TRACES</button><input ref={importRef} type="file" accept="application/json" onChange={importJson}/></section>
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

        {echoes.length ? <section className="trace-echoes"><header><h2>ECHOES / {echoes.length}</h2><button type="button" onClick={() => setEchoes([])}>CLEAR</button></header>{echoes.map(result => <div key={result.trace.id}><button type="button" onClick={() => scrollToTrace(result.trace.id)}>{traceExcerpt(result.trace, 120)}</button><small>{result.sharedMotifs.length ? `MOTIF: ${result.sharedMotifs.join(', ')}` : ''}{result.sharedMotifs.length && result.sharedWords.length ? ' / ' : ''}{result.sharedWords.length ? `TERMS: ${result.sharedWords.join(', ')}` : ''}</small></div>)}</section> : null}

        <div className="trace-index-head">
          <div><strong>{visibleTraces.length}</strong> TRACES / {plate.toUpperCase()}{selectedMotif ? ` / ${selectedMotif}` : ''}</div>
          <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="SEARCH CONTENT / MOTIF / ID" aria-label="Traceを検索"/>
        </div>
        <div className="trace-status" aria-live="polite">{status}{workspaceStatus ? ` / ${workspaceStatus}` : ''}{oauthError ? ` / ${oauthError}` : ''}</div>

        <div className="trace-list">
          {visibleTraces.length ? visibleTraces.map(trace => <TraceCard
            key={trace.id}
            trace={trace}
            byId={byId}
            incoming={incoming.get(trace.id) || []}
            editing={editing}
            selected={selectedTraceIds.includes(trace.id)}
            onToggleSelection={toggleTraceSelection}
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
    </main> : null}

    {selectedTraceIds.length ? <div className="trace-fold-bar"><span>{selectedTraceIds.length} TRACES SELECTED</span><button type="button" onClick={() => setSurface('folds')}>OPEN FOLD STUDIO</button><button type="button" onClick={clearTraceSelection}>CLEAR</button></div> : null}
  </div>;
}
