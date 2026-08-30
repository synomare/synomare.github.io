import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MarkdownEditor from './MarkdownEditorLazy.jsx';
import MarkdownPreview from './MarkdownPreviewLazy.jsx';
import ArticleLibrary from './ArticleLibrary.jsx';
import OperationsPanel from './OperationsPanel.jsx';
import TokenEditor from './TokenEditor.jsx';
import RelatedNotesEditor from './RelatedNotesEditor.jsx';
import {
  createLocalDraftKey,
  deleteDraftIfUnchanged,
  draftFingerprint,
  draftKeyFor,
  hydrateDraftForResume,
  listDrafts,
  loadDraft,
  saveDraft,
  saveDraftReplacing
} from './drafts.js';
import { loadRepository, publishAtomic, publishBatch } from './github.js';
import { IMAGE_ACCEPT, prepareImageFiles } from './images.js';
import { excerptFromBody, newNote, outgoingFromBody, parseDocument, parseOAuthMessage, serializeDocument } from './lib.js';
import { preflightIssues } from './editorTools.js';
import { DocumentStatus, EditorToolbar, Outline, PublishCheck } from './EditorTools.jsx';
import { collectTags, duplicateDocument, unchangedDraftRecords } from './articleLibrary.js';
import { renameTagInDocuments } from './operations.js';
import { relatedState } from './relatedNotes.js';

const OAUTH_ORIGIN = 'https://synomare-notes-oauth.decap-oauth.workers.dev';
const QA_PREVIEW = ['127.0.0.1', 'localhost'].includes(location.hostname) && new URLSearchParams(location.search).has('demo');
const QA_DOCUMENTS = [
  { slug: 'field-notes', postType: 'text', photo: '', title: '境界に置かれた言葉', date: '2026-08-16', summary: '場所と文章の距離について。', tags: ['思考', '制作'], aliases: ['フィールドノート'], cardSize: 'l', cardExcerpt: '', draft: false, body: '![](/assets/images/notes/1786878777173-3828089f17bd-img-0487.webp)\n\n地図の縁に残った言葉を拾いながら、[[小さな信号]]について考える。\n\n## 境界について\n\n読むことと歩くことの間には、まだ名前のない編集がある。', existing: true },
  { slug: 'small-signals', postType: 'text', photo: '', title: '小さな信号', date: '2026-08-15', summary: '', tags: ['思考'], aliases: ['フィールドノート'], cardSize: 'auto', cardExcerpt: '', draft: false, body: '見落としそうな変化を記録する。[[フィールドノート]]と[[存在しない記事]]へ戻る。', existing: true },
  { slug: 'quiet-photo', postType: 'photo', photo: '/assets/images/notes/1786878777173-3828089f17bd-img-0487.webp', title: '静かな写真', date: '2026-08-14', summary: '', tags: ['写真'], aliases: [], cardSize: 'auto', cardExcerpt: '', draft: false, body: '', existing: true },
  { slug: 'future-draft', postType: 'text', photo: '', title: '公開前のメモ', date: '2026-08-13', summary: '', tags: ['準備中'], aliases: [], cardSize: 'auto', cardExcerpt: '', draft: true, body: '公開前の関連記事確認用です。', existing: true }
];

function Login({ onToken }) {
  const [error, setError] = useState('');
  useEffect(() => {
    const receive = event => {
      if (event.origin !== OAUTH_ORIGIN) return;
      if (event.data === 'authorizing:github') { event.source?.postMessage('authorizing:github', OAUTH_ORIGIN); return; }
      const token = parseOAuthMessage(event.data); if (token) onToken(token);
    };
    addEventListener('message', receive); return () => removeEventListener('message', receive);
  }, [onToken]);
  const login = () => { setError(''); const popup = open(`${OAUTH_ORIGIN}/auth?provider=github`, 'synomare-notes-oauth', 'width=720,height=760'); if (!popup) setError('ポップアップがブロックされました。許可してもう一度お試しください。'); };
  return <main className="login"><div><div className="login-mark">S / N</div><h1>Notes Editor</h1><p>文章を書き、つなぎ、公開するための管理画面です。認証情報はブラウザへ保存しません。</p><button className="primary" onClick={login}>LOGIN WITH GITHUB</button>{error ? <p className="error">{error}</p> : null}<a href="/admin/">DECAP CMS / DELETE & RECOVERY →</a></div></main>;
}

function Inspector({ note, documents, onJump }) {
  const [compact, setCompact] = useState(() => matchMedia('(max-width: 850px)').matches);
  useEffect(() => {
    const media = matchMedia('(max-width: 850px)');
    const change = event => setCompact(event.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  const normalize = value => String(value || '').normalize('NFKC').toLocaleLowerCase('ja');
  const links = useMemo(() => outgoingFromBody(note.body), [note.body]);
  const resolutionIndex = useMemo(() => {
    const index = new Map();
    documents.forEach(document => [document.slug, document.title, ...(document.aliases || [])].forEach(value => {
      const key = normalize(value);
      if (key && !index.has(key)) index.set(key, document);
    }));
    return index;
  }, [documents]);
  const resolved = useMemo(() => links.map(link => ({ ...link, note: resolutionIndex.get(normalize(link.target)) })), [links, resolutionIndex]);
  const backlinkTargets = useMemo(() => new Set([note.slug, note.title, ...(note.aliases || [])].map(normalize).filter(Boolean)), [note.slug, note.title, note.aliases]);
  const backlinks = useMemo(() => documents.filter(document => outgoingFromBody(document.body).some(link => backlinkTargets.has(normalize(link.target)))), [documents, backlinkTargets]);
  const related = useMemo(() => relatedState(note, documents).current, [note, documents]);
  return <details className="inspector" open={compact ? undefined : true}><summary><span>DOCUMENT / CONNECTIONS</span><span>{resolved.length + backlinks.length + related.length}</span></summary><div className="inspector-content"><Outline note={note} onJump={onJump}/><section><h2>OUTGOING / {resolved.length}</h2>{resolved.length ? resolved.map((link, index) => <div className={`relation-row ${link.note ? '' : 'unresolved'}`} key={`${link.target}-${index}`}><span>{link.note ? '●' : '○'}</span><div><strong>{link.label}</strong><small>{link.note?.slug || 'UNRESOLVED'}</small></div></div>) : <p className="muted">[[記事名]] を書くと、ここにリンクが現れます。</p>}</section><section><h2>BACKLINKS / {backlinks.length}</h2>{backlinks.map(doc => <div className="relation-row" key={doc.slug}><span>←</span><div><strong>{doc.title}</strong><small>{doc.slug}</small></div></div>)}</section><section><h2>RELATED / {related.length}</h2>{related.map(item => <div className="relation-row" key={item.document.slug}><span>{item.kind === 'manual' ? 'M' : item.shared}</span><div><strong>{item.document.title}</strong><small>{item.kind === 'manual' ? 'MANUAL' : 'SHARED TAGS'}</small></div></div>)}</section></div></details>;
}

function ImageQueue({ images, onRemove }) {
  const [previews, setPreviews] = useState([]);
  useEffect(() => {
    const next = images.map(image => ({ ...image, url: image.file ? URL.createObjectURL(image.file) : '' }));
    setPreviews(next);
    return () => next.forEach(image => { if (image.url) URL.revokeObjectURL(image.url); });
  }, [images]);
  if (!previews.length) return null;
  return <div className="image-queue" aria-label="公開待ちの画像">{previews.map(image => {
    const name = image.originalName || image.file?.name || 'LOCAL FILE MISSING';
    return <figure key={image.path || name}>{!image.file ? <div className="image-preview-placeholder">FILE<br/>MISSING</div> : image.needsBuildConversion ? <div className="image-preview-placeholder">HEIC<br/>公開時変換</div> : <img src={image.url} alt=""/>}<figcaption><strong>{name}</strong><span>{image.file ? `${image.file.type.replace('image/', '').toUpperCase()} / ${(image.file.size / 1024 / 1024).toFixed(1)}MB` : 'SELECT AGAIN'}</span></figcaption><button type="button" aria-label={`${name}を取り消す`} onClick={() => onRemove(image)}>×</button></figure>;
  })}</div>;
}

function PhotoStage({ note, images }) {
  const pending = images.at(-1);
  const [preview, setPreview] = useState('');
  useEffect(() => {
    if (!pending?.file || pending.needsBuildConversion) { setPreview(''); return; }
    const url = URL.createObjectURL(pending.file); setPreview(url); return () => URL.revokeObjectURL(url);
  }, [pending]);
  const source = preview || (!pending ? note.photo : '');
  return <div className={`photo-stage ${source ? 'has-photo' : ''}`}>
    {source ? <img src={source} alt=""/> : pending && !pending.file ? <div className="photo-stage-placeholder">FILE MISSING<br/><small>IMAGEから写真を選び直してください</small></div> : pending?.needsBuildConversion ? <div className="photo-stage-placeholder">HEIC<br/><small>公開時にJPEGへ変換します</small></div> : <div className="photo-stage-placeholder">PHOTO ONLY<br/><small>下の IMAGE から写真を1枚選択</small></div>}
  </div>;
}

function BaseReview({ review, onAccept }) {
  if (!review) return null;
  const remote = review.remote;
  const local = review.local;
  const metadata = [
    ['TYPE', 'postType'], ['TITLE', 'title'], ['DATE', 'date'], ['SUMMARY', 'summary'],
    ['TAGS', 'tags'], ['ALIASES', 'aliases'], ['RELATED', 'relatedNotes'],
    ['RELATED EXCLUDE', 'relatedExclude'], ['CARD SIZE', 'cardSize'],
    ['CARD EXCERPT', 'cardExcerpt'], ['PHOTO', 'photo'], ['STATUS', 'draft']
  ].map(([label, key]) => {
    const format = value => Array.isArray(value) ? value.join(', ') || '—' : key === 'draft' ? (value ? 'GITHUB DRAFT' : 'PUBLIC') : String(value || '—');
    const remoteValue = format(remote?.[key]);
    const localValue = format(local?.[key]);
    return { label, remoteValue, localValue, changed: remoteValue !== localValue };
  });
  return <section className="base-review" role="alert" aria-labelledby="base-review-title">
    <span>{review.reason === 'legacy' ? 'LEGACY DRAFT / BASE UNKNOWN' : 'CONFLICT / REMOTE UPDATED'}</span>
    <h2 id="base-review-title">GitHubの最新版とローカル原稿を確認してください</h2>
    <p>現在のエディターにはローカル原稿を残しています。差分を確認して基準を更新すると、次のPUBLISHではローカル原稿の本文と全メタデータがGitHub版を置き換えます。</p>
    <details open>
      <summary>GITHUB VERSION / {remote?.slug || 'ARTICLE REMOVED'}</summary>
      {remote ? <div className="base-review-remote">
        <div className="base-review-meta" role="table" aria-label="GitHub版とローカル原稿のメタデータ比較">
          <div className="base-review-meta-head" role="row"><span role="columnheader">FIELD</span><span role="columnheader">GITHUB</span><span role="columnheader">LOCAL</span></div>
          {metadata.map(row => <div className={row.changed ? 'is-changed' : ''} role="row" key={row.label}><strong role="rowheader">{row.label}</strong><span role="cell">{row.remoteValue}</span><span role="cell">{row.localValue}</span></div>)}
        </div>
        <div className="base-review-content"><section><strong>GITHUB CONTENT</strong><pre>{remote.postType === 'photo' ? remote.photo || 'NO PHOTO' : remote.body || 'NO BODY'}</pre></section><section><strong>LOCAL CONTENT</strong><pre>{local?.postType === 'photo' ? local.photo || 'NO PHOTO' : local?.body || 'NO BODY'}</pre></section></div>
      </div> : <p className="base-review-missing">GitHubの最新版には元の記事がありません。続行すると同じslugで作り直します。</p>}
    </details>
    <button type="button" onClick={onAccept} disabled={!review.baseSha}>差分を確認し、ローカル原稿を採用する</button>
    {!review.baseSha ? <small>最新版を読み込めませんでした。RELOADしてから再確認してください。</small> : null}
  </section>;
}

export default function App() {
  const [token, setToken] = useState(QA_PREVIEW ? 'qa-preview' : ''); const [baseSha, setBaseSha] = useState(QA_PREVIEW ? 'qa-base' : ''); const [documents, setDocuments] = useState(QA_PREVIEW ? QA_DOCUMENTS : []); const [localDrafts, setLocalDrafts] = useState([]); const [localDraftsLoaded, setLocalDraftsLoaded] = useState(false); const [localDraftError, setLocalDraftError] = useState(''); const [note, setNote] = useState(null); const [repositoryLoaded, setRepositoryLoaded] = useState(QA_PREVIEW); const [images, setImages] = useState([]); const [status, setStatus] = useState(QA_PREVIEW ? 'LOCAL DESIGN PREVIEW' : ''); const [draftStatus, setDraftStatus] = useState(QA_PREVIEW ? 'READY' : ''); const [baseReview, setBaseReview] = useState(null); const [busy, setBusy] = useState(false); const [imageProcessing, setImageProcessing] = useState(false); const [advanced, setAdvanced] = useState(false); const [viewMode, setViewMode] = useState('edit'); const [focusMode, setFocusMode] = useState(false); const [libraryOpen, setLibraryOpen] = useState(false); const [operationsOpen, setOperationsOpen] = useState(false); const [operationsTab, setOperationsTab] = useState('tags'); const [bulkTagSlugs, setBulkTagSlugs] = useState([]); const [bulkTagSnapshot, setBulkTagSnapshot] = useState(null); const [copied, setCopied] = useState(false); const [hierarchyDepth, setHierarchyDepth] = useState(0); const draftEpoch = useRef(0); const activeDraftKey = useRef(''); const activeSourceSlug = useRef(''); const editingBaseSha = useRef(QA_PREVIEW ? 'qa-base' : ''); const persistedDraftFingerprint = useRef(''); const draftWriteQueue = useRef(Promise.resolve()); const publicationActive = useRef(false); const exclusiveActionActive = useRef(false); const bulkTagNoteSnapshot = useRef(null); const editorRef = useRef(null); const imageInputRef = useRef(null);
  const interactionLocked = busy || imageProcessing;
  const runExclusiveAction = useCallback(async action => {
    if (busy || imageProcessing || publicationActive.current || exclusiveActionActive.current) return false;
    exclusiveActionActive.current = true;
    setBusy(true);
    try { await action(); return true; }
    finally { exclusiveActionActive.current = false; setBusy(false); }
  }, [busy, imageProcessing]);
  const queueDraftOperation = useCallback(operation => {
    const pending = draftWriteQueue.current.then(operation, operation);
    draftWriteQueue.current = pending.catch(() => {});
    return pending;
  }, []);
  const mergeLocalDraft = useCallback(record => {
    if (!record) return;
    setLocalDrafts(current => [record, ...current.filter(item => item.key !== record.key)].sort((a, b) => b.savedAt - a.savedAt || a.key.localeCompare(b.key)));
  }, []);
  const refreshLocalDrafts = useCallback(async () => {
    try {
      const records = await listDrafts();
      setLocalDrafts(records);
      setLocalDraftError('');
      return records;
    } catch (error) {
      setLocalDraftError(error?.message || 'この端末のローカル下書きを読み込めませんでした。');
      throw error;
    } finally {
      setLocalDraftsLoaded(true);
    }
  }, []);
  const persistDraftSnapshot = useCallback((noteSnapshot, imageSnapshot, force = false) => {
    const key = activeDraftKey.current;
    if (!noteSnapshot || !key || (publicationActive.current && !force)) return Promise.resolve(null);
    const fingerprint = draftFingerprint(noteSnapshot, imageSnapshot);
    if (!force && fingerprint === persistedDraftFingerprint.current) return Promise.resolve(null);
    const sourceSlug = activeSourceSlug.current;
    const sourceBaseSha = editingBaseSha.current;
    return queueDraftOperation(async () => {
      const record = await saveDraft(key, { note: noteSnapshot, images: imageSnapshot, sourceSlug, sourceBaseSha });
      if (activeDraftKey.current === key) persistedDraftFingerprint.current = fingerprint;
      mergeLocalDraft(record);
      return record;
    });
  }, [mergeLocalDraft, queueDraftOperation]);
  const refresh = useCallback(async (activeToken, { replaceActive = false, manageBusy = true } = {}) => {
    if (manageBusy) setBusy(true); setStatus('GitHubから記事を読み込んでいます…');
    try {
      const repo = await loadRepository(activeToken);
      const docs = repo.documents.map(doc => parseDocument(doc.source, doc.slug));
      setDocuments(docs); setBaseSha(repo.baseSha); setBulkTagSlugs([]); setBulkTagSnapshot(null); bulkTagNoteSnapshot.current = null; setRepositoryLoaded(true);
      if (replaceActive) {
        setImages([]);
        setNote(current => {
          if (!current) return null;
          const found = docs.find(doc => doc.slug === (activeSourceSlug.current || current.slug)) || docs.find(doc => doc.slug === current.slug) || null;
          if (found) {
            activeDraftKey.current = createLocalDraftKey();
            activeSourceSlug.current = found.slug;
            editingBaseSha.current = repo.baseSha;
            persistedDraftFingerprint.current = draftFingerprint(found, []);
          }
          return found;
        });
      }
      setStatus(`${docs.length}件の記事を読み込みました。`);
      return { baseSha: repo.baseSha, documents: docs };
    }
    catch (error) { setStatus(error.message); if (/push権限/.test(error.message) || error.status === 401) setToken(''); return null; }
    finally { if (manageBusy) setBusy(false); }
  }, []);
  useEffect(() => { if (token && !QA_PREVIEW) refresh(token); }, [token, refresh]);
  useEffect(() => {
    if (!token) return;
    setLocalDraftsLoaded(false);
    refreshLocalDrafts().catch(() => setDraftStatus('LOCAL DRAFT ERROR'));
  }, [token, refreshLocalDrafts]);
  useEffect(() => {
    if (!repositoryLoaded || !localDraftsLoaded || bulkTagSlugs.length || publicationActive.current) return undefined;
    const candidates = unchangedDraftRecords(localDrafts, documents).filter(record => record.key !== activeDraftKey.current);
    if (!candidates.length) return undefined;
    let cancelled = false;
    queueDraftOperation(async () => {
      const removed = [];
      for (const record of candidates) {
        const didDelete = await deleteDraftIfUnchanged(record.key, record.savedAt, draftFingerprint(record.note, record.images));
        if (didDelete) removed.push(record.key);
      }
      if (!cancelled && removed.length) setLocalDrafts(current => current.filter(record => !removed.includes(record.key)));
    }).catch(error => {
      if (!cancelled) setLocalDraftError(error?.message || '不要なローカル下書きを整理できませんでした。');
    });
    return () => { cancelled = true; };
  }, [bulkTagSlugs.length, documents, localDrafts, localDraftsLoaded, repositoryLoaded, queueDraftOperation]);
  useEffect(() => {
    if (!note || !activeDraftKey.current || publicationActive.current) return undefined;
    const fingerprint = draftFingerprint(note, images);
    if (fingerprint === persistedDraftFingerprint.current) return undefined;
    const epoch = draftEpoch.current;
    setDraftStatus('LOCAL CHANGES');
    const timer = setTimeout(() => {
      if (draftEpoch.current !== epoch || publicationActive.current) return;
      persistDraftSnapshot(note, images)
        .then(() => { if (draftEpoch.current === epoch && activeDraftKey.current) setDraftStatus('LOCAL DRAFT SAVED'); })
        .catch(() => { if (draftEpoch.current === epoch) setDraftStatus('LOCAL DRAFT ERROR'); });
    }, 500);
    return () => clearTimeout(timer);
  }, [note, images, persistDraftSnapshot]);
  useEffect(() => {
    const exitFocusMode = event => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || libraryOpen || operationsOpen) return;
      setFocusMode(false);
    };
    addEventListener('keydown', exitFocusMode);
    return () => removeEventListener('keydown', exitFocusMode);
  }, [libraryOpen, operationsOpen]);
  const persistActiveDraft = useCallback(async () => {
    if (!note || publicationActive.current) return;
    return persistDraftSnapshot(note, images);
  }, [note, images, persistDraftSnapshot]);
  useEffect(() => {
    const flushDraft = () => { persistActiveDraft().catch(() => {}); };
    const flushHiddenDraft = () => { if (document.visibilityState === 'hidden') flushDraft(); };
    addEventListener('pagehide', flushDraft);
    document.addEventListener('visibilitychange', flushHiddenDraft);
    return () => { removeEventListener('pagehide', flushDraft); document.removeEventListener('visibilitychange', flushHiddenDraft); };
  }, [persistActiveDraft]);
  const resetEditingPosition = () => requestAnimationFrame(() => {
    scrollTo({ top: 0, left: 0, behavior: 'auto' });
    editorRef.current?.resetScroll?.();
  });
  const selectNote = async slug => {
    if (interactionLocked || exclusiveActionActive.current) return;
    if (bulkTagSlugs.length) { setStatus('先にTOOLS / TAGSで一括変更を保存または取り消してください。'); setLibraryOpen(false); setOperationsOpen(true); setOperationsTab('tags'); return; }
    return runExclusiveAction(async () => {
      try { await persistActiveDraft(); }
      catch { setStatus('ERROR — 現在の原稿をローカル保存できなかったため、記事の切替を中止しました。'); return; }
      draftEpoch.current += 1;
      const usedSlugs = [...documents.map(doc => doc.slug), ...localDrafts.map(record => record.note?.slug).filter(Boolean), ...(!note?.existing && note?.slug ? [note.slug] : [])];
      const selected = slug === '__new__' ? newNote(usedSlugs) : documents.find(doc => doc.slug === slug); if (!selected) return;
      let recovered = null;
      let hydrated = null;
      if (slug === '__new__') {
        activeDraftKey.current = createLocalDraftKey();
        activeSourceSlug.current = '';
        editingBaseSha.current = baseSha;
        persistedDraftFingerprint.current = '';
      } else {
        const candidate = localDrafts.find(record => (record.sourceSlug || (record.note?.existing ? record.note.slug : '')) === selected.slug);
        recovered = await loadDraft(candidate?.key || draftKeyFor(selected)).catch(() => null);
        hydrated = recovered ? hydrateDraftForResume(recovered, documents, baseSha) : null;
        if (recovered && hydrated) {
          const previousKey = recovered.key;
          const sessionKey = createLocalDraftKey();
          try {
            recovered = await saveDraftReplacing(previousKey, sessionKey, { note: hydrated.note, images: hydrated.images, sourceSlug: hydrated.sourceSlug, sourceBaseSha: recovered.sourceBaseSha });
            setLocalDrafts(current => [recovered, ...current.filter(record => record.key !== previousKey && record.key !== sessionKey)].sort((a, b) => b.savedAt - a.savedAt || a.key.localeCompare(b.key)));
          } catch { setStatus('ERROR — ローカル下書きをこの編集タブ用に分離できませんでした。'); return; }
        }
        activeDraftKey.current = recovered?.key || createLocalDraftKey();
        activeSourceSlug.current = selected.slug;
        editingBaseSha.current = hydrated ? (hydrated.baseKnown ? hydrated.sourceBaseSha : '') : baseSha;
      }
      const next = hydrated?.note || selected;
      const nextImages = hydrated?.images || [];
      if (slug !== '__new__') persistedDraftFingerprint.current = draftFingerprint(next, nextImages);
      const needsBaseReview = Boolean(hydrated?.sourceSlug && (!hydrated.baseKnown || hydrated.sourceBaseSha !== baseSha));
      setBaseReview(needsBaseReview ? { reason: hydrated.baseKnown ? 'conflict' : 'legacy', baseSha, remote: documents.find(document => document.slug === hydrated.sourceSlug) || null, local: next } : null);
      setNote(next); setImages(nextImages); setViewMode('edit'); setLibraryOpen(false); setOperationsOpen(false); setStatus(recovered ? `ローカル下書きを復元しました。${needsBaseReview ? ' GitHub版との差分を確認して基準を選んでください。' : ''}` : slug === '__new__' ? 'NEW NOTE' : `${selected.title || selected.slug}を編集中です。`); setDraftStatus(recovered ? 'LOCAL DRAFT RESTORED' : 'READY'); resetEditingPosition();
    });
  };
  const resumeLocalDraft = async key => {
    if (interactionLocked || exclusiveActionActive.current) return;
    if (bulkTagSlugs.length) { setStatus('先にTOOLS / TAGSで一括変更を保存または取り消してください。'); setLibraryOpen(false); setOperationsOpen(true); setOperationsTab('tags'); return; }
    return runExclusiveAction(async () => {
      try { await persistActiveDraft(); }
      catch { setStatus('ERROR — 現在の原稿をローカル保存できなかったため、切替を中止しました。'); return; }
      const record = await loadDraft(key).catch(() => null);
      const hydrated = hydrateDraftForResume(record, documents, baseSha);
      if (!record || !hydrated) { setStatus('ERROR — ローカル下書きを読み込めませんでした。'); await refreshLocalDrafts().catch(() => {}); return; }
      const sessionKey = createLocalDraftKey();
      let sessionRecord;
      try {
        sessionRecord = await saveDraftReplacing(record.key, sessionKey, { note: hydrated.note, images: hydrated.images, sourceSlug: hydrated.sourceSlug, sourceBaseSha: record.sourceBaseSha });
        setLocalDrafts(current => [sessionRecord, ...current.filter(item => item.key !== record.key && item.key !== sessionKey)].sort((a, b) => b.savedAt - a.savedAt || a.key.localeCompare(b.key)));
      } catch { setStatus('ERROR — ローカル下書きをこの編集タブ用に分離できませんでした。'); return; }
      draftEpoch.current += 1;
      activeDraftKey.current = sessionRecord.key;
      activeSourceSlug.current = hydrated.sourceSlug;
      editingBaseSha.current = hydrated.baseKnown ? hydrated.sourceBaseSha : '';
      persistedDraftFingerprint.current = draftFingerprint(hydrated.note, hydrated.images);
      const needsBaseReview = Boolean(hydrated.sourceSlug && (!hydrated.baseKnown || hydrated.sourceBaseSha !== baseSha));
      setBaseReview(needsBaseReview ? { reason: hydrated.baseKnown ? 'conflict' : 'legacy', baseSha, remote: documents.find(document => document.slug === hydrated.sourceSlug) || null, local: hydrated.note } : null);
      setNote(hydrated.note); setImages(hydrated.images); setViewMode('edit'); setLibraryOpen(false); setOperationsOpen(false); setStatus(`ローカル下書きを復元しました。${needsBaseReview ? ' GitHub版との差分を確認して基準を選んでください。' : ''}`); setDraftStatus(hydrated.state === 'conflict' ? 'SLUG CONFLICT' : hydrated.state === 'missing' ? 'REMOTE MISSING' : 'LOCAL DRAFT RESTORED'); resetEditingPosition();
    });
  };
  const discardLocalDraft = async candidate => {
    const key = candidate?.key;
    if (!key) return;
    if (key === activeDraftKey.current) throw new Error('編集中の下書きは破棄できません。別の記事へ移動してから操作してください。');
    const deleted = await queueDraftOperation(() => deleteDraftIfUnchanged(key, candidate.savedAt, draftFingerprint(candidate.note, candidate.images)));
    if (!deleted) { await refreshLocalDrafts().catch(() => {}); throw new Error('別のタブで下書きが更新されました。一覧を更新したので、内容を確認してもう一度破棄してください。'); }
    setLocalDrafts(current => current.filter(record => record.key !== key));
    setStatus('この端末のローカル下書きを破棄しました。GitHub上の記事は変更していません。');
  };
  const update = patch => { setNote(current => ({ ...current, ...patch })); };
  const issues = useMemo(() => {
    const result = preflightIssues(note, documents, imageProcessing);
    if (images.some(image => !image?.file)) result.unshift({ level: 'error', text: '端末内の画像ファイルを復元できません。画像を選び直してください。' });
    if (baseReview) result.unshift({ level: 'error', text: 'GitHub版との比較が必要です。確認後に最新mainを基準として選んでください。' });
    if (note && !note.existing && documents.some(document => document.slug === note.slug)) result.unshift({ level: 'error', text: '同じslugの記事がGitHubにあります。別のslugを指定してください。' });
    if (note && !note.existing && localDrafts.some(record => record.key !== activeDraftKey.current && record.note?.slug === note.slug)) result.unshift({ level: 'error', text: '同じslugの別のローカル下書きがあります。別のslugを指定してください。' });
    return result;
  }, [note, documents, localDrafts, images, imageProcessing, baseReview]);
  const blockingIssue = issues.find(issue => issue.level === 'error') || null;
  const publish = useCallback(async () => {
    if (!note || busy || exclusiveActionActive.current || publicationActive.current || imageProcessing) return; if (QA_PREVIEW) { setStatus('DESIGN PREVIEW — 公開処理は実行しません。'); return; }
    if (bulkTagSlugs.length) { setStatus('先にTOOLS / TAGSから一括変更を保存してください。'); setOperationsOpen(true); setOperationsTab('tags'); return; }
    const blocking = issues.find(issue => issue.level === 'error'); if (blocking) { setStatus(`ERROR — ${blocking.text}`); return; }
    const key = activeDraftKey.current;
    const publishBaseSha = editingBaseSha.current || baseSha;
    draftEpoch.current += 1;
    exclusiveActionActive.current = true;
    publicationActive.current = true;
    setBusy(true); setStatus(note.draft ? '下書きをGitHubへ保存しています…' : '公開コミットを作成しています…');
    try {
      const publishedDraftRecord = await persistDraftSnapshot(note, images, true);
      const success = note.draft ? 'GitHub下書きを保存しました。' : '公開しました。数分後にサイトへ反映されます。';
      const committedSha = await publishAtomic({ token, baseSha: publishBaseSha, slug: note.slug, markdown: serializeDocument(note), images, existing: note.existing });
      const publishedNote = { ...note, existing: true };
      let cleanupState = 'clean';
      try {
        const deleted = publishedDraftRecord ? await queueDraftOperation(() => deleteDraftIfUnchanged(key, publishedDraftRecord.savedAt, draftFingerprint(publishedDraftRecord.note, publishedDraftRecord.images))) : false;
        if (deleted) setLocalDrafts(current => current.filter(record => record.key !== key));
        else { cleanupState = 'preserved'; await refreshLocalDrafts().catch(() => {}); }
      } catch { cleanupState = 'error'; }
      activeDraftKey.current = createLocalDraftKey();
      activeSourceSlug.current = note.slug;
      editingBaseSha.current = committedSha;
      persistedDraftFingerprint.current = draftFingerprint(publishedNote, []);
      setBaseSha(committedSha); setNote(publishedNote); setImages([]); setBaseReview(null);
      setDocuments(current => {
        const exists = current.some(document => document.slug === publishedNote.slug);
        return exists ? current.map(document => document.slug === publishedNote.slug ? publishedNote : document) : [publishedNote, ...current];
      });
      const reloaded = await refresh(token, { replaceActive: true, manageBusy: false });
      setStatus(cleanupState === 'error' ? `${success} 端末内下書きの後片付けだけ失敗したため、次回一覧で破棄してください。` : cleanupState === 'preserved' ? `${success} 別タブで更新された端末下書きは削除せずLOCAL DRAFTSへ残しました。` : reloaded ? success : `${success} GitHubからの再読み込みだけ失敗しました。`); setDraftStatus(cleanupState === 'error' ? 'LOCAL CLEANUP ERROR' : cleanupState === 'preserved' ? 'PARALLEL DRAFT KEPT' : 'SYNCED');
    }
    catch (error) {
      if (error.code === 'CONFLICT') {
        const latest = await refresh(token, { manageBusy: false });
        const sourceSlug = activeSourceSlug.current || note.slug;
        setBaseReview({ reason: 'conflict', baseSha: latest?.baseSha || '', remote: latest?.documents.find(document => document.slug === sourceSlug) || null, local: note });
        setStatus(`CONFLICT — ${error.message} GitHub版を比較して基準を選んでください。`);
      } else setStatus(`ERROR — ${error.message}`);
    }
    finally { publicationActive.current = false; exclusiveActionActive.current = false; setBusy(false); }
  }, [note, busy, imageProcessing, issues, token, baseSha, images, refresh, bulkTagSlugs, persistDraftSnapshot, queueDraftOperation]);
  const publishBulkTags = useCallback(async () => {
    if (!bulkTagSlugs.length || interactionLocked || exclusiveActionActive.current || publicationActive.current) return;
    if (baseReview || (note?.existing && editingBaseSha.current !== baseSha)) {
      const sourceSlug = activeSourceSlug.current || note?.slug;
      setBaseReview(current => current || { reason: 'conflict', baseSha, remote: documents.find(document => document.slug === sourceSlug) || null, local: note });
      setOperationsOpen(false); setStatus('CONFLICT — 先にGitHub版との差分を確認し、公開基準を選んでください。'); return;
    }
    if (QA_PREVIEW) { setStatus('DESIGN PREVIEW — 一括保存は実行しません。'); return; }
    const key = activeDraftKey.current;
    let activeDraftSnapshot = null;
    draftEpoch.current += 1;
    exclusiveActionActive.current = true;
    publicationActive.current = true;
    setBusy(true); setStatus(`${bulkTagSlugs.length}件の記事を一括保存しています…`);
    try {
      try {
        activeDraftSnapshot = await persistDraftSnapshot(note, images, true);
        if (!activeDraftSnapshot && key) activeDraftSnapshot = await loadDraft(key);
      } catch {
        setStatus('ERROR — 現在の原稿をローカル保存できなかったため、タグ保存を中止しました。');
        return;
      }
      const committedSha = await publishBatch({ token, baseSha, entries: documents.filter(document => bulkTagSlugs.includes(document.slug)).map(document => ({ slug: document.slug, markdown: serializeDocument(document) })), message: `content: rename tags (${bulkTagSlugs.length} Notes)` });
      setBaseSha(committedSha); editingBaseSha.current = committedSha; setBulkTagSlugs([]); setBulkTagSnapshot(null); bulkTagNoteSnapshot.current = null;
      let localAftercareFailed = false;
      let parallelDraftPreserved = false;
      const remoteVersion = note?.existing ? documents.find(document => document.slug === note.slug) : null;
      try {
        if (note && remoteVersion && draftFingerprint(note, images) === draftFingerprint(remoteVersion, [])) {
          const deleted = activeDraftSnapshot ? await queueDraftOperation(() => deleteDraftIfUnchanged(key, activeDraftSnapshot.savedAt, draftFingerprint(activeDraftSnapshot.note, activeDraftSnapshot.images))) : false;
          if (deleted) setLocalDrafts(current => current.filter(record => record.key !== key));
          else if (activeDraftSnapshot) {
            parallelDraftPreserved = true;
            activeDraftKey.current = createLocalDraftKey();
            await refreshLocalDrafts().catch(() => {});
          }
          persistedDraftFingerprint.current = draftFingerprint(note, images);
          setDraftStatus(parallelDraftPreserved ? 'PARALLEL DRAFT KEPT' : 'SYNCED');
        } else if (note) {
          await persistDraftSnapshot(note, images, true);
          setDraftStatus('LOCAL DRAFT SAVED');
        }
      } catch {
        localAftercareFailed = true;
        setDraftStatus('LOCAL DRAFT ERROR');
      }
      const reloaded = await refresh(token, { manageBusy: false });
      setStatus(localAftercareFailed ? 'タグ変更はGitHubへ保存済みです。端末下書きの後処理だけ失敗したため、この画面を閉じずに再度保存してください。' : parallelDraftPreserved ? 'タグ変更をGitHubへ保存しました。別タブで更新された端末下書きはLOCAL DRAFTSへ残しています。' : reloaded ? 'タグの一括変更を保存しました。' : 'タグ変更はGitHubへ保存済みです。GitHubからの再読み込みだけ失敗しました。');
    } catch (error) {
      if (error.code === 'CONFLICT') setStatus(`CONFLICT — ${error.message} タグ変更は画面内に保持しています。DISCARDで取り消してからRELOADし、最新版へ変更をやり直してください。`);
      else setStatus(`ERROR — ${error.message}`);
    }
    finally { publicationActive.current = false; exclusiveActionActive.current = false; setBusy(false); }
  }, [bulkTagSlugs, interactionLocked, baseReview, token, baseSha, documents, note, images, refresh, persistDraftSnapshot, queueDraftOperation]);
  const renameTag = (from, to) => {
    if (interactionLocked) return;
    const result = renameTagInDocuments(documents, from, to);
    if (!result.changedSlugs.length) return;
    if (!bulkTagSnapshot) { setBulkTagSnapshot(documents); bulkTagNoteSnapshot.current = note ? { key: activeDraftKey.current, slug: note.slug, tags: [...(note.tags || [])] } : null; }
    setDocuments(result.documents);
    if (note) setNote(current => renameTagInDocuments([current], from, to).documents[0]);
    setBulkTagSlugs(previous => [...new Set([...previous, ...result.changedSlugs])]);
    setStatus(`タグを ${from} → ${to} に変更しました。保存待ちです。`);
  };
  const discardTagChanges = () => {
    if (interactionLocked) return;
    if (!bulkTagSnapshot) return;
    setDocuments(bulkTagSnapshot);
    const noteSnapshot = bulkTagNoteSnapshot.current;
    if (note && noteSnapshot && noteSnapshot.key === activeDraftKey.current && noteSnapshot.slug === note.slug) setNote(current => ({ ...current, tags: noteSnapshot.tags }));
    bulkTagNoteSnapshot.current = null; setBulkTagSlugs([]); setBulkTagSnapshot(null); setStatus('タグの一括変更を取り消しました。');
  };
  const handleImageFiles = useCallback(async inputFiles => {
    if (!note || interactionLocked) return;
    const files = [...inputFiles]; if (!files.length) return;
    setImageProcessing(true); setStatus(`${files.length}件の画像を確認・変換しています…`);
    try {
      const prepared = await prepareImageFiles(files);
      if (note.postType === 'photo') {
        const image = prepared.images[0]; setImages([image]); setNote(current => ({ ...current, photo: `/${image.path}` }));
        setStatus(prepared.messages.length ? prepared.messages.join(' ') : '写真投稿の画像を公開待ちへ追加しました。');
      } else {
        setImages(current => [...current, ...prepared.images]);
        setNote(current => ({ ...current, body: `${current.body}${current.body.endsWith('\n') || !current.body ? '' : '\n'}\n${prepared.images.map(image => `![](/${image.path})`).join('\n\n')}\n` }));
        setStatus(prepared.messages.length ? prepared.messages.join(' ') : `${prepared.images.length}件の画像を公開待ちへ追加しました。`);
      }
    } catch (error) { setStatus(`ERROR — ${error.message}`); }
    finally { setImageProcessing(false); }
  }, [note, interactionLocked]);
  const imageInput = event => { const files = [...event.target.files]; event.target.value = ''; handleImageFiles(files); };
  const removeImage = image => {
    setImages(current => current.filter(item => item.path !== image.path));
    setNote(current => {
      if (current.postType === 'photo') return { ...current, photo: '' };
      const escaped = image.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return { ...current, body: current.body.replace(new RegExp(`\\n?!\\[[^\\]]*\\]\\(\\/${escaped}\\)\\n?`, 'g'), '\n').replace(/\n{3,}/g, '\n\n') };
    });
    setStatus('公開待ちの画像を取り消しました。');
  };
  const copyMarkdown = async () => {
    try { await navigator.clipboard.writeText(serializeDocument(note)); setCopied(true); setStatus('MARKDOWN COPIED'); setTimeout(() => setCopied(false), 1600); }
    catch { setStatus('ERROR — クリップボードへコピーできませんでした。'); }
  };
  const jumpToLine = line => { setViewMode('edit'); requestAnimationFrame(() => editorRef.current?.goToLine(line)); };
  const relationNotes = useMemo(() => documents.filter(doc => doc.slug !== note?.slug), [documents, note?.slug]);
  const toolDocuments = useMemo(() => note?.existing ? documents.map(document => document.slug === note.slug ? note : document) : documents, [documents, note]);
  const tagSuggestions = useMemo(() => collectTags(documents), [documents]);
  const aliasSuggestions = useMemo(() => [...new Set(documents.flatMap(document => document.aliases || []))].sort((a, b) => a.localeCompare(b, 'ja')), [documents]);
  const duplicate = async source => {
    if (interactionLocked || exclusiveActionActive.current) return;
    if (bulkTagSlugs.length) { setStatus('先にTOOLS / TAGSで一括変更を保存または取り消してください。'); setLibraryOpen(false); setOperationsOpen(true); setOperationsTab('tags'); return; }
    return runExclusiveAction(async () => {
      try { await persistActiveDraft(); }
      catch { setStatus('ERROR — 現在の原稿をローカル保存できなかったため、複製を中止しました。'); return; }
      let sourceNote = source;
      let sourceImages = [];
      if (note?.existing && source.slug === activeSourceSlug.current) {
        sourceNote = note;
        sourceImages = images;
      } else if (source.localDraftKey) {
        const latestLocal = await loadDraft(source.localDraftKey).catch(() => null);
        if (!latestLocal) { setStatus('ERROR — 複製元のローカル下書きを読み込めませんでした。'); await refreshLocalDrafts().catch(() => {}); return; }
        sourceNote = latestLocal.note;
        sourceImages = latestLocal.images;
      }
      const usedSlugs = [...documents.map(document => document.slug), ...localDrafts.map(record => record.note?.slug).filter(Boolean), ...(!note?.existing && note?.slug ? [note.slug] : [])];
      const copy = duplicateDocument(sourceNote, usedSlugs);
      draftEpoch.current += 1;
      activeDraftKey.current = createLocalDraftKey();
      activeSourceSlug.current = '';
      editingBaseSha.current = baseSha;
      persistedDraftFingerprint.current = '';
      setBaseReview(null); setNote(copy); setImages(sourceImages.map(image => ({ ...image }))); setViewMode('edit'); setAdvanced(true); setLibraryOpen(false); setStatus(`記事を下書きとして複製しました。${sourceImages.length ? `未送信画像${sourceImages.length}点もコピーしています。` : ''}タイトルと内容を確認してください。`); setDraftStatus('LOCAL CHANGES'); resetEditingPosition();
    });
  };
  const useImage = path => {
    if (interactionLocked) return;
    if (note.postType === 'photo') { update({ photo: path }); setStatus('既存画像を写真投稿へ設定しました。'); }
    else if (editorRef.current?.insertMarkdown) { editorRef.current.insertMarkdown(`\n\n![](${path})\n\n`); setStatus('本文へ既存画像を挿入しました。'); }
    else { update({ body: `${note.body}${note.body.endsWith('\n') || !note.body ? '' : '\n'}\n![](${path})\n` }); setStatus('本文へ既存画像を挿入しました。'); }
    setOperationsOpen(false);
  };
  const reloadRepository = async () => {
    if (interactionLocked || exclusiveActionActive.current) return;
    if (bulkTagSlugs.length) { setStatus('先にTOOLS / TAGSで一括変更を保存または取り消してください。'); setOperationsOpen(true); setOperationsTab('tags'); return; }
    return runExclusiveAction(async () => {
      try { await persistActiveDraft(); }
      catch { setStatus('ERROR — 現在の原稿をローカル保存できなかったため、再読み込みを中止しました。'); return; }
      const sourceSlug = activeSourceSlug.current || note?.slug;
      const previousRemote = note?.existing ? documents.find(document => document.slug === sourceSlug) || null : null;
      const previousBaseSha = editingBaseSha.current;
      const hadLocalState = localDrafts.some(record => record.key === activeDraftKey.current) || Boolean(images.length) || (previousRemote && draftFingerprint(note, images) !== draftFingerprint(previousRemote, []));
      const latest = await refresh(token, { manageBusy: false });
      if (!latest) return;
      const remote = note?.existing ? latest.documents.find(document => document.slug === sourceSlug) || null : null;
      if (baseReview) { setBaseReview({ ...baseReview, baseSha: latest.baseSha, remote, local: note }); setStatus('GitHub版を更新しました。内容を比較して基準を選んでください。'); return; }
      if (note?.existing && previousBaseSha && previousBaseSha !== latest.baseSha) {
        const sourceUnchanged = previousRemote && remote && draftFingerprint(previousRemote, []) === draftFingerprint(remote, []);
        if (!sourceUnchanged) { setBaseReview({ reason: 'conflict', baseSha: latest.baseSha, remote, local: note }); setStatus('CONFLICT — GitHub側の記事が更新されています。差分を確認して公開基準を選んでください。'); return; }
        editingBaseSha.current = latest.baseSha;
        if (hadLocalState) {
          try { await persistDraftSnapshot(note, images, true); }
          catch { editingBaseSha.current = previousBaseSha; setBaseReview({ reason: 'conflict', baseSha: latest.baseSha, remote, local: note }); setStatus('ERROR — 最新mainをローカル下書きへ反映できませんでした。差分を確認してください。'); return; }
        }
        setStatus('GitHubを再読み込みしました。編集中の記事は変更されていないため、ローカル原稿の公開基準だけ更新しました。');
      } else if (!note?.existing && previousBaseSha !== latest.baseSha) {
        editingBaseSha.current = latest.baseSha;
        try { await persistDraftSnapshot(note, images, true); }
        catch { editingBaseSha.current = previousBaseSha; setStatus('ERROR — 最新mainを新規下書きへ反映できませんでした。'); }
      }
    });
  };
  const acceptLatestBase = async () => {
    if (!baseReview?.baseSha || !note || interactionLocked || exclusiveActionActive.current) return;
    return runExclusiveAction(async () => {
      const previousBaseSha = editingBaseSha.current;
      editingBaseSha.current = baseReview.baseSha;
      try {
        await persistDraftSnapshot(note, images, true);
        setBaseReview(null); setDraftStatus('LOCAL DRAFT SAVED'); setStatus('GitHub版を確認済みとして、最新mainを公開基準にしました。');
      } catch {
        editingBaseSha.current = previousBaseSha;
        setStatus('ERROR — 公開基準をローカル下書きへ保存できませんでした。');
      }
    });
  };
  const logout = async () => {
    if (interactionLocked || exclusiveActionActive.current) return;
    if (bulkTagSlugs.length) { setStatus('先にTOOLS / TAGSで一括変更を保存または取り消してください。'); setOperationsOpen(true); setOperationsTab('tags'); return; }
    return runExclusiveAction(async () => {
      try { await persistActiveDraft(); }
      catch { setStatus('ERROR — 現在の原稿をローカル保存できなかったため、ログアウトを中止しました。'); return; }
      draftEpoch.current += 1; activeDraftKey.current = ''; activeSourceSlug.current = ''; editingBaseSha.current = ''; persistedDraftFingerprint.current = ''; setBaseReview(null); setLocalDrafts([]); setLocalDraftsLoaded(false); setLocalDraftError(''); setToken(''); setNote(null); setRepositoryLoaded(false); setLibraryOpen(false); setOperationsOpen(false);
    });
  };
  if (!token) return <Login onToken={setToken} />;
  if (!note) {
    if (!repositoryLoaded) return <main className="login"><p>{status || 'LOADING…'}</p></main>;
    return <ArticleLibrary entry disabled={interactionLocked} documents={documents} localDrafts={localDrafts} localDraftsLoaded={localDraftsLoaded} localDraftError={localDraftError} activeSlug="" activeDraftKey="" onClose={() => {}} onSelect={selectNote} onNew={() => selectNote('__new__')} onDuplicate={duplicate} onResumeDraft={resumeLocalDraft} onDiscardDraft={discardLocalDraft}/>;
  }
  const modalOpen = libraryOpen || operationsOpen;
  const openLibrary = () => { if (!interactionLocked) { setOperationsOpen(false); setLibraryOpen(true); } };
  const openOperations = () => { if (!interactionLocked) { setLibraryOpen(false); setOperationsOpen(true); } };
  return <div className={`app-shell ${focusMode ? 'is-focus' : ''}`}>
    {interactionLocked ? <span className="sr-only" role="status" aria-live="polite">{status}</span> : null}
    {libraryOpen ? <ArticleLibrary open disabled={interactionLocked} documents={documents} localDrafts={localDrafts} localDraftsLoaded={localDraftsLoaded} localDraftError={localDraftError} activeSlug={note.slug} activeDraftKey={activeDraftKey.current} onClose={() => setLibraryOpen(false)} onSelect={selectNote} onNew={() => selectNote('__new__')} onDuplicate={duplicate} onResumeDraft={resumeLocalDraft} onDiscardDraft={discardLocalDraft}/> : null}
    {operationsOpen ? <OperationsPanel open disabled={interactionLocked} tab={operationsTab} onTabChange={setOperationsTab} documents={toolDocuments} onClose={() => setOperationsOpen(false)} onSelect={selectNote} onUseImage={useImage} onRenameTag={renameTag} pendingTagChanges={bulkTagSlugs.length} onSaveTagChanges={publishBulkTags} onDiscardTagChanges={discardTagChanges}/> : null}
    <header className="editor-top" inert={modalOpen ? true : undefined} aria-hidden={modalOpen ? 'true' : undefined} aria-busy={interactionLocked}>
      <div className="editor-brand"><a href="/" data-dialog-return-fallback>SYNOMARE</a><span>NOTES</span></div>
      <select aria-label="記事を選ぶ" value={note.existing ? note.slug : '__new__'} disabled={interactionLocked} onChange={event => selectNote(event.target.value)}><option value="__new__">＋ NEW NOTE</option>{documents.map(doc => <option key={doc.slug} value={doc.slug}>{doc.title || (doc.postType === 'photo' ? `PHOTO / ${doc.date}` : doc.slug)}</option>)}</select>
      <div className="editor-session"><button aria-label="記事ライブラリを開く" onClick={openLibrary} disabled={interactionLocked}>LIBRARY</button><button aria-label="記事運用ツールを開く" onClick={openOperations} disabled={interactionLocked}>TOOLS</button><button aria-label="GitHubから記事を再読み込み" onClick={reloadRepository} disabled={interactionLocked}>RELOAD</button><button aria-label="ログアウト" onClick={logout} disabled={interactionLocked}>LOG OUT</button></div>
    </header>
    <main className={`workspace is-${note.postType} mode-${viewMode} ${interactionLocked ? 'is-locked' : ''}`} inert={modalOpen || interactionLocked ? true : undefined} aria-hidden={modalOpen ? 'true' : undefined} aria-busy={interactionLocked}>
      <section className="writing">
        <div className="document-head">
          <div className="type-switch" aria-label="投稿タイプ"><button type="button" className={note.postType === 'text' ? 'active' : ''} onClick={() => update({ postType: 'text' })}>TEXT</button><button type="button" className={note.postType === 'photo' ? 'active' : ''} onClick={() => update({ postType: 'photo' })}>PHOTO</button></div>
          <input className="title-input" aria-label="タイトル" value={note.title} placeholder={note.postType === 'photo' ? 'Title / optional' : 'Untitled note'} onChange={event => update({ title: event.target.value })}/>
          <div className="document-meta"><span>{note.date}</span><span>{note.slug}</span><span>{note.postType.toUpperCase()} / CARD {note.cardSize === 'auto' ? `AUTO → ${note.postType === 'photo' ? 'L' : 'S / M'}` : note.cardSize.toUpperCase()}</span></div>
        </div>
        {note.postType === 'photo' ? <PhotoStage note={note} images={images}/> : <>
          <EditorToolbar mode={viewMode} onMode={setViewMode} focusMode={focusMode} onFocusMode={() => setFocusMode(value => !value)} onCommand={command => editorRef.current?.command(command)}/>
          <div className="editor-surface">
            <MarkdownEditor key={activeDraftKey.current || note.slug} ref={editorRef} value={note.body} onChange={body => update({ body })} onDepthChange={setHierarchyDepth} notes={relationNotes} onPublish={publish} onFiles={handleImageFiles}/>
            {viewMode !== 'edit' ? <MarkdownPreview body={note.body}/> : null}
          </div>
          <DocumentStatus body={note.body} depth={hierarchyDepth} status={draftStatus}/>
          <ImageQueue images={images} onRemove={removeImage}/>
        </>}
        {advanced ? <section className="details"><label>SLUG<input value={note.slug} readOnly={note.existing} onChange={event => update({ slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}/></label><label>DATE<input type="date" value={note.date} onChange={event => update({ date: event.target.value })}/></label><label>CARD SIZE<select value={note.cardSize} onChange={event => update({ cardSize: event.target.value })}><option value="auto">AUTO / CONTENT</option><option value="s">S / SMALL</option><option value="m">M / MEDIUM</option><option value="l">L / LARGE</option></select></label><label>VISIBILITY<select value={note.draft ? 'draft' : 'public'} onChange={event => update({ draft: event.target.value === 'draft' })}><option value="public">PUBLIC</option><option value="draft">GITHUB DRAFT</option></select></label><label className="wide">{note.postType === 'photo' ? 'CAPTION / DESCRIPTION' : 'SUMMARY'}<input value={note.summary} placeholder={note.postType === 'photo' ? '未入力でも公開できます' : excerptFromBody(note.body)} onChange={event => update({ summary: event.target.value })}/></label>{note.postType === 'text' ? <label className="wide">CARD EXCERPT<input value={note.cardExcerpt} placeholder="概要を使用" onChange={event => update({ cardExcerpt: event.target.value })}/></label> : null}<TokenEditor label="TAGS" values={note.tags} suggestions={tagSuggestions} placeholder={note.postType === 'photo' ? '写真' : 'タグを入力してEnter'} onChange={tags => update({ tags })}/><TokenEditor label="ALIASES" values={note.aliases} suggestions={aliasSuggestions} placeholder="別名を入力してEnter" onChange={aliases => update({ aliases })}/>{note.postType === 'text' ? <RelatedNotesEditor note={note} documents={toolDocuments} onChange={update}/> : null}</section> : null}
    <BaseReview review={baseReview ? { ...baseReview, local: note } : null} onAccept={acceptLatestBase}/>
        <PublishCheck issues={issues}/>
        <div className="editor-actions">
          <span className={`save-status ${status.startsWith('ERROR') || status.startsWith('CONFLICT') || blockingIssue ? 'error' : ''}`} role="status" aria-live="polite" aria-atomic="true"><span>{blockingIssue ? `BLOCKED — ${blockingIssue.text}` : status}</span>{draftStatus ? <small className={draftStatus.endsWith('ERROR') ? 'error' : ''}>{draftStatus}</small> : null}</span>
          <button type="button" className={`upload ${imageProcessing ? 'is-busy' : ''}`} disabled={imageProcessing || busy} onClick={() => imageInputRef.current?.click()}>＋ {imageProcessing ? 'PROCESSING…' : note.postType === 'photo' && note.photo ? 'REPLACE PHOTO' : 'IMAGE'}</button><input ref={imageInputRef} className="file-input-proxy" type="file" accept={IMAGE_ACCEPT} multiple={note.postType === 'text'} disabled={imageProcessing || busy} onChange={imageInput}/>
          <button onClick={() => setAdvanced(value => !value)} aria-expanded={advanced} disabled={interactionLocked}>DETAILS {advanced ? '−' : '+'}</button>
          <button onClick={copyMarkdown} disabled={interactionLocked}>{copied ? 'COPIED' : 'COPY MD'}</button>
          <button className="primary" onClick={publish} disabled={busy || imageProcessing || Boolean(blockingIssue)}>{busy ? 'SAVING…' : imageProcessing ? 'PROCESSING…' : note.draft ? 'SAVE DRAFT' : 'PUBLISH'} <span>⌘↵</span></button>
        </div>
      </section>
      {note.postType === 'text' ? <Inspector note={note} documents={documents} onJump={jumpToLine}/> : null}
    </main>
  </div>;
}
