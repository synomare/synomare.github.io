import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { loadTraceRepository, publishTraceBatch } from './traceGithub.js';
import TraceView from './TraceView.jsx';
import { OAUTH_ORIGIN, QA_PREVIEW, demoTraces, parseOAuthMessage } from './traceConfig.js';
import {
  createTrace,
  filterTracePlate,
  lexicalEchoes,
  markTraceDeleted,
  mergeRemoteTraces,
  motifStats,
  parseMotifInput,
  resolveTraceConflict,
  reviseTrace,
  selectResurfaceTrace,
  traceSignature
} from './traces.js';
import {
  listStoredTraces,
  removeStoredTrace,
  removeStoredTraces,
  saveStoredTrace,
  saveStoredTraces,
  setTraceMeta
} from './traceStore.js';

export default function TraceApp() {
  const [traces, setTraces] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [token, setToken] = useState('');
  const [status, setStatus] = useState(QA_PREVIEW ? 'LOCAL DESIGN PREVIEW' : 'LOCAL DATABASE LOADING…');
  const [busy, setBusy] = useState(false);
  const [content, setContent] = useState('');
  const [motifInput, setMotifInput] = useState('');
  const [visibility, setVisibility] = useState('local');
  const [kind, setKind] = useState('note');
  const [relation, setRelation] = useState(null);
  const [plate, setPlate] = useState('stream');
  const [query, setQuery] = useState('');
  const [selectedMotif, setSelectedMotif] = useState('');
  const [echoes, setEchoes] = useState([]);
  const [editing, setEditing] = useState(null);
  const [oauthError, setOauthError] = useState('');
  const composerRef = useRef(null);
  const importRef = useRef(null);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    let active = true;
    listStoredTraces().then(stored => {
      if (!active) return;
      const next = stored.length ? stored : QA_PREVIEW ? demoTraces() : [];
      setTraces(next);
      setLoaded(true);
      setStatus(stored.length ? `${stored.length} TRACES / LOCAL READY` : QA_PREVIEW ? 'DEMO TRACES / NOT PERSISTED' : 'EMPTY FIELD / WRITE THE FIRST TRACE');
    }).catch(error => {
      if (!active) return;
      setLoaded(true);
      setStatus(`ERROR — ${error.message}`);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const receive = event => {
      if (event.origin !== OAUTH_ORIGIN) return;
      if (event.data === 'authorizing:github') {
        event.source?.postMessage('authorizing:github', OAUTH_ORIGIN);
        return;
      }
      const nextToken = parseOAuthMessage(event.data);
      if (nextToken) {
        setToken(nextToken);
        setOauthError('');
        setStatus('GITHUB CONNECTED / TOKEN IS MEMORY-ONLY');
      }
    };
    addEventListener('message', receive);
    return () => removeEventListener('message', receive);
  }, []);

  const activeTraces = useMemo(() => traces.filter(trace => !trace.deleted), [traces]);
  const byId = useMemo(() => new Map(activeTraces.map(trace => [trace.id, trace])), [activeTraces]);
  const incoming = useMemo(() => {
    const map = new Map();
    for (const source of activeTraces) {
      for (const item of source.relations || []) {
        if (!map.has(item.target)) map.set(item.target, []);
        map.get(item.target).push(source);
      }
    }
    return map;
  }, [activeTraces]);
  const motifs = useMemo(() => motifStats(activeTraces), [activeTraces]);
  const filtered = useMemo(() => filterTracePlate(activeTraces, { plate, query: deferredQuery, motif: selectedMotif }), [activeTraces, plate, deferredQuery, selectedMotif]);
  const resurface = useMemo(() => selectResurfaceTrace(activeTraces), [activeTraces]);
  const syncCount = useMemo(() => traces.filter(trace => trace.syncStatus === 'queued' || trace.syncStatus === 'queued-delete').length, [traces]);
  const conflicts = useMemo(() => traces.filter(trace => trace.syncStatus === 'conflict').length, [traces]);
  const relationTarget = relation ? byId.get(relation.target) : null;

  const connectGithub = useCallback(() => {
    setOauthError('');
    const popup = open(`${OAUTH_ORIGIN}/auth?provider=github`, 'synomare-notes-oauth', 'width=720,height=760');
    if (!popup) setOauthError('ポップアップがブロックされました。許可して再試行してください。');
  }, []);

  const submitTrace = useCallback(async event => {
    event.preventDefault();
    if (!content.trim() || busy) return;
    try {
      const trace = createTrace({
        content,
        motifs: parseMotifInput(motifInput),
        visibility,
        kind,
        relation
      });
      if (!QA_PREVIEW) await saveStoredTrace(trace);
      setTraces(current => [trace, ...current]);
      setEchoes(lexicalEchoes(trace, activeTraces, 4));
      setContent('');
      setRelation(null);
      setStatus(trace.visibility === 'public' ? 'TRACE SAVED LOCALLY / PUBLIC SYNC QUEUED' : 'TRACE SAVED / LOCAL ONLY');
      requestAnimationFrame(() => composerRef.current?.focus());
    } catch (error) { setStatus(`ERROR — ${error.message}`); }
  }, [content, motifInput, visibility, kind, relation, busy, activeTraces]);

  const startRelation = useCallback((trace, type) => {
    setRelation({ target: trace.id, type });
    if (!motifInput.trim() && trace.motifs?.length) setMotifInput(trace.motifs.join(', '));
    document.getElementById('trace-composer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    requestAnimationFrame(() => composerRef.current?.focus());
  }, [motifInput]);

  const beginEdit = useCallback(trace => {
    setEditing({ id: trace.id, content: trace.content, motifs: (trace.motifs || []).join(', '), visibility: trace.visibility, kind: trace.kind });
  }, []);

  const saveEdit = useCallback(async () => {
    const current = traces.find(trace => trace.id === editing?.id);
    if (!current || !editing) return;
    try {
      const revised = reviseTrace(current, {
        content: editing.content,
        motifs: parseMotifInput(editing.motifs),
        visibility: editing.visibility,
        kind: editing.kind
      });
      if (!QA_PREVIEW) await saveStoredTrace(revised);
      setTraces(values => values.map(trace => trace.id === revised.id ? revised : trace));
      setEditing(null);
      setStatus(revised.syncStatus === 'queued-delete' ? 'REVISION SAVED / REMOTE DELETE QUEUED' : revised.visibility === 'public' ? 'REVISION SAVED / PUBLIC SYNC QUEUED' : 'REVISION SAVED LOCALLY');
    } catch (error) { setStatus(`ERROR — ${error.message}`); }
  }, [traces, editing]);

  const deleteTrace = useCallback(async trace => {
    if (!confirm('このTraceを削除しますか？ 公開済みの場合は次回同期で現在のremoteファイルも削除します。')) return;
    const deleted = markTraceDeleted(trace);
    try {
      if (!QA_PREVIEW) {
        if (deleted.remotePublished) await saveStoredTrace(deleted);
        else await removeStoredTrace(deleted.id);
      }
      setTraces(values => deleted.remotePublished ? values.map(value => value.id === deleted.id ? deleted : value) : values.filter(value => value.id !== deleted.id));
      setStatus(deleted.remotePublished ? 'LOCAL DELETE / REMOTE DELETE QUEUED' : 'TRACE DELETED');
    } catch (error) { setStatus(`ERROR — ${error.message}`); }
  }, []);

  const resolveConflict = useCallback(async (trace, resolution) => {
    const resolved = resolveTraceConflict(trace, resolution);
    if (!QA_PREVIEW) await saveStoredTrace(resolved);
    setTraces(values => values.map(value => value.id === resolved.id ? resolved : value));
    setStatus(resolution === 'remote' ? 'REMOTE VERSION ACCEPTED' : 'LOCAL VERSION QUEUED FOR REPUBLISH');
  }, []);

  const acceptRemoteDelete = useCallback(async trace => {
    if (!QA_PREVIEW) await removeStoredTrace(trace.id);
    setTraces(values => values.filter(value => value.id !== trace.id));
    setStatus('REMOTE DELETE ACCEPTED');
  }, []);

  const syncPublic = useCallback(async () => {
    if (!token) { connectGithub(); return; }
    if (busy) return;
    setBusy(true);
    setStatus('REMOTE TRACESを読み込み、差分を照合しています…');
    try {
      const remote = await loadTraceRepository(token);
      const merged = mergeRemoteTraces(traces, remote.traces);
      if (!QA_PREVIEW) await saveStoredTraces(merged);
      setTraces(merged);
      const conflictCount = merged.filter(trace => trace.syncStatus === 'conflict').length;
      if (conflictCount) {
        setStatus(`CONFLICT — ${conflictCount}仰c��解決してから再同期してください。`);
        return;
      }
      const toPublish = merged.filter(trace => trace.visibility === 'public' && !trace.deleted && !trace.pendingDelete && (trace.syncStatus === 'queued' || !trace.remotePublished));
      const toDelete = merged.filter(trace => trace.remotePublished && (trace.deleted || trace.pendingDelete));
      if (!toPublish.length && !toDelete.length) {
        await setTraceMeta('lastSync', { sha: remote.baseSha, at: new Date().toISOString() }).catch(() => {});
        setStatus(`REMOTE UP TO DATE / ${remote.traces.length} PUBLIC TRACES`);
        return;
      }
      const result = await publishTraceBatch({ token, baseSha: remote.baseSha, traces: toPublish, deletions: toDelete });
      const publishedIds = new Set(toPublish.map(trace => trace.id));
      const deletedIds = new Set(toDelete.filter(trace => trace.deleted).map(trace => trace.id));
      const hiddenIds = new Set(toDelete.filter(trace => !trace.deleted).map(trace => trace.id));
      const next = merged.flatMap(trace => {
        if (deletedIds.has(trace.id)) return [];
        if (hiddenIds.has(trace.id)) return [{ ...trace, visibility: 'local', remotePublished: false, pendingDelete: false, syncStatus: 'local', lastSyncedSignature: '', conflict: null }];
        if (publishedIds.has(trace.id)) {
          const synced = { ...trace, remotePublished: true, pendingDelete: false, syncStatus: 'synced', conflict: null };
          synced.lastSyncedSignature = traceSignature(synced);
          return [synced];
        }
        return [trace];
      });
      if (!QA_PREVIEW) {
        await saveStoredTraces(next);
        if (deletedIds.size) await removeStoredTraces([...deletedIds]);
        await setTraceMeta('lastSync', { sha: result.sha, at: new Date().toISOString() });
      }
      setTraces(next);
      setStatus(`SYNCED / +${toPublish.length} PUBLIC / -${toDelete.length} REMOTE`);
    } catch (error) {
      if (error.status === 401) setToken('');
      setStatus(`${error.code === 'CONFLICT' ? 'CONFLICT' : 'ERROR'} — ${error.message}`);
    } finally { setBusy(false); }
  }, [token, busy, traces, connectGithub]);

  const exportJson = useCallback(() => {
    const payload = JSON.stringify({ schema: 1, exportedAt: new Date().toISOString(), traces }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `synomare-traces-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus(`EXPORTED / ${traces.length} TRACES`);
  }, [traces]);

  const importJson = useCallback(async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      const imported = (Array.isArray(payload) ? payload : payload.traces).filter(trace => trace?.id && trace?.content);
      const merged = new Map(traces.map(trace => [trace.id, trace]));
      for (const trace of imported) {
        const current = merged.get(trace.id);
        if (!current || String(trace.updatedAt || '') > String(current.updatedAt || '')) merged.set(trace.id, trace);
      }
      const next = [...merged.values()];
      if (!QA_PREVIEW) await saveStoredTraces(next);
      setTraces(next);
      setStatus(`IMPORTED / ${imported.length} TRACES`);
    } catch (error) { setStatus(`ERROR — JSONを読み込めませんでした: ${error.message}`); }
  }, [traces]);

  if (!loaded) return <main className="trace-loading">{status}</main>;


  return <TraceView
    token={token}
    busy={busy}
    conflicts={conflicts}
    syncCount={syncCount}
    syncPublic={syncPublic}
    connectGithub={connectGithub}
    disconnectGithub={() => setToken('')}
    activeTraces={activeTraces}
    motifs={motifs}
    plate={plate}
    setPlate={setPlate}
    selectedMotif={selectedMotif}
    setSelectedMotif={setSelectedMotif}
    resurface={resurface}
    exportJson={exportJson}
    importRef={importRef}
    importJson={importJson}
    submitTrace={submitTrace}
    content={content}
    setContent={setContent}
    relation={relation}
    setRelation={setRelation}
    relationTarget={relationTarget}
    composerRef={composerRef}
    motifInput={motifInput}
    setMotifInput={setMotifInput}
    kind={kind}
    setKind={setKind}
    visibility={visibility}
    setVisibility={setVisibility}
    echoes={echoes}
    setEchoes={setEchoes}
    filtered={filtered}
    query={query}
    setQuery={setQuery}
    status={status}
    oauthError={oauthError}
    byId={byId}
    incoming={incoming}
    editing={editing}
    setEditing={setEditing}
    beginEdit={beginEdit}
    saveEdit={saveEdit}
    startRelation={startRelation}
    deleteTrace={deleteTrace}
    resolveConflict={resolveConflict}
    acceptRemoteDelete={acceptRemoteDelete}
  />;
}
