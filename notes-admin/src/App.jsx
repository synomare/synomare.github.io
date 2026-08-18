import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MarkdownEditor from './MarkdownEditorLazy.jsx';
import MarkdownPreview from './MarkdownPreviewLazy.jsx';
import ArticleLibrary from './ArticleLibrary.jsx';
import OperationsPanel from './OperationsPanel.jsx';
import TokenEditor from './TokenEditor.jsx';
import { deleteDraft, loadDraft, saveDraft } from './drafts.js';
import { loadRepository, publishAtomic, publishBatch } from './github.js';
import { IMAGE_ACCEPT, prepareImageFiles } from './images.js';
import { excerptFromBody, newNote, outgoingFromBody, parseDocument, parseOAuthMessage, serializeDocument } from './lib.js';
import { preflightIssues } from './editorTools.js';
import { DocumentStatus, EditorToolbar, Outline, PublishCheck } from './EditorTools.jsx';
import { collectTags, duplicateDocument } from './articleLibrary.js';
import { renameTagInDocuments } from './operations.js';

const OAUTH_ORIGIN = 'https://synomare-notes-oauth.decap-oauth.workers.dev';
const draftKey = note => note?.existing ? `note:${note.slug}` : 'note:new';
const QA_PREVIEW = ['127.0.0.1', 'localhost'].includes(location.hostname) && new URLSearchParams(location.search).has('demo');
const QA_DOCUMENTS = [
  { slug: 'field-notes', postType: 'text', photo: '', title: '境界に置かれた言葉', date: '2026-08-16', summary: '場所と文章の距離について。', tags: ['思考', '制作'], aliases: ['フィールドノート'], cardSize: 'l', cardExcerpt: '', draft: false, body: '![](/assets/images/notes/1786878777173-3828089f17bd-img-0487.webp)\n\n地図の縁に残った言葉を拾いながら、[[小さな信号]]について考える。\n\n## 境界について\n\n読むことと歩くことの間には、まだ名前のない編集がある。', existing: true },
  { slug: 'small-signals', postType: 'text', photo: '', title: '小さな信号', date: '2026-08-15', summary: '', tags: ['思考'], aliases: ['フィールドノート'], cardSize: 'auto', cardExcerpt: '', draft: false, body: '見落としそうな変化を記録する。[[フィールドノート]]と[[存在しない記事]]へ戻る。', existing: true },
  { slug: 'quiet-photo', postType: 'photo', photo: '/assets/images/notes/1786878777173-3828089f17bd-img-0487.webp', title: '静かな写真', date: '2026-08-14', summary: '', tags: ['写真'], aliases: [], cardSize: 'auto', cardExcerpt: '', draft: false, body: '', existing: true }
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
  const links = outgoingFromBody(note.body);
  const resolved = links.map(link => ({ ...link, note: documents.find(doc => [doc.slug, doc.title, ...(doc.aliases || [])].some(value => value.normalize('NFKC').toLocaleLowerCase('ja') === link.target.normalize('NFKC').toLocaleLowerCase('ja'))) }));
  const backlinks = documents.filter(doc => outgoingFromBody(doc.body).some(link => [note.slug, note.title, ...note.aliases].includes(link.target)));
  const related = documents.filter(doc => doc.slug !== note.slug).map(doc => ({ ...doc, shared: doc.tags.filter(tag => note.tags.includes(tag)).length })).filter(doc => doc.shared).sort((a, b) => b.shared - a.shared).slice(0, 6);
  return <details className="inspector" open={compact ? undefined : true}><summary><span>DOCUMENT / CONNECTIONS</span><span>{resolved.length + backlinks.length + related.length}</span></summary><div className="inspector-content"><Outline note={note} onJump={onJump}/><section><h2>OUTGOING / {resolved.length}</h2>{resolved.length ? resolved.map((link, index) => <div className={`relation-row ${link.note ? '' : 'unresolved'}`} key={`${link.target}-${index}`}><span>{link.note ? '●' : '○'}</span><div><strong>{link.label}</strong><small>{link.note?.slug || 'UNRESOLVED'}</small></div></div>) : <p className="muted">[[記事名]] を書くと、ここにリンクが現れます。</p>}</section><section><h2>BACKLINKS / {backlinks.length}</h2>{backlinks.map(doc => <div className="relation-row" key={doc.slug}><span>←</span><div><strong>{doc.title}</strong><small>{doc.slug}</small></div></div>)}</section><section><h2>RELATED / {related.length}</h2>{related.map(doc => <div className="relation-row" key={doc.slug}><span>{doc.shared}</span><div><strong>{doc.title}</strong><small>SHARED TAGS</small></div></div>)}</section></div></details>;
}

function ImageQueue({ images, onRemove }) {
  const [previews, setPreviews] = useState([]);
  useEffect(() => {
    const next = images.map(image => ({ ...image, url: URL.createObjectURL(image.file) }));
    setPreviews(next);
    return () => next.forEach(image => URL.revokeObjectURL(image.url));
  }, [images]);
  if (!previews.length) return null;
  return <div className="image-queue" aria-label="公開待ちの画像">{previews.map(image => <figure key={image.path}>{image.needsBuildConversion ? <div className="image-preview-placeholder">HEIC<br/>公開時変換</div> : <img src={image.url} alt=""/>}<figcaption><strong>{image.originalName || image.file.name}</strong><span>{image.file.type.replace('image/', '').toUpperCase()} / {(image.file.size / 1024 / 1024).toFixed(1)}MB</span></figcaption><button type="button" aria-label={`${image.originalName || image.file.name}を取り消す`} onClick={() => onRemove(image)}>×</button></figure>)}</div>;
}

function PhotoStage({ note, images }) {
  const pending = images.at(-1);
  const [preview, setPreview] = useState('');
  useEffect(() => {
    if (!pending || pending.needsBuildConversion) { setPreview(''); return; }
    const url = URL.createObjectURL(pending.file); setPreview(url); return () => URL.revokeObjectURL(url);
  }, [pending]);
  const source = preview || (!pending ? note.photo : '');
  return <div className={`photo-stage ${source ? 'has-photo' : ''}`}>
    {source ? <img src={source} alt=""/> : pending?.needsBuildConversion ? <div className="photo-stage-placeholder">HEIC<br/><small>公開時にJPEGへ変換します</small></div> : <div className="photo-stage-placeholder">PHOTO ONLY<br/><small>下の IMAGE から写真を1枚選択</small></div>}
  </div>;
}

export default function App() {
  const [token, setToken] = useState(QA_PREVIEW ? 'qa-preview' : ''); const [baseSha, setBaseSha] = useState(QA_PREVIEW ? 'qa-base' : ''); const [documents, setDocuments] = useState(QA_PREVIEW ? QA_DOCUMENTS : []); const [note, setNote] = useState(null); const [repositoryLoaded, setRepositoryLoaded] = useState(QA_PREVIEW); const [images, setImages] = useState([]); const [status, setStatus] = useState(QA_PREVIEW ? 'LOCAL DESIGN PREVIEW' : ''); const [busy, setBusy] = useState(false); const [imageProcessing, setImageProcessing] = useState(false); const [advanced, setAdvanced] = useState(false); const [viewMode, setViewMode] = useState('edit'); const [focusMode, setFocusMode] = useState(false); const [libraryOpen, setLibraryOpen] = useState(false); const [operationsOpen, setOperationsOpen] = useState(false); const [operationsTab, setOperationsTab] = useState('tags'); const [bulkTagSlugs, setBulkTagSlugs] = useState([]); const [bulkTagSnapshot, setBulkTagSnapshot] = useState(null); const [copied, setCopied] = useState(false); const [hierarchyDepth, setHierarchyDepth] = useState(0); const suppressAutosaveUntil = useRef(0); const editorRef = useRef(null);
  const refresh = useCallback(async activeToken => {
    setBusy(true); setStatus('GitHubから記事を読み込んでいます…');
    try { const repo = await loadRepository(activeToken); const docs = repo.documents.map(doc => parseDocument(doc.source, doc.slug)); setDocuments(docs); setBaseSha(repo.baseSha); setBulkTagSlugs([]); setBulkTagSnapshot(null); setRepositoryLoaded(true); setNote(current => { if (current && !current.existing) return current; if (current?.slug) return docs.find(doc => doc.slug === current.slug) || null; return null; }); setStatus(`${docs.length}件の記事を読み込みました。`); }
    catch (error) { setStatus(error.message); if (/push権限/.test(error.message) || error.status === 401) setToken(''); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { if (token && !QA_PREVIEW) refresh(token); }, [token, refresh]);
  useEffect(() => { if (!note || Date.now() < suppressAutosaveUntil.current) return; const timer = setTimeout(() => { saveDraft(draftKey(note), { note, images }).then(() => setStatus(previous => previous.includes('公開') ? previous : 'LOCAL DRAFT SAVED')).catch(() => {}); }, 500); return () => clearTimeout(timer); }, [note, images]);
  useEffect(() => { const exitPanels = event => { if (event.key === 'Escape') { setFocusMode(false); setLibraryOpen(false); setOperationsOpen(false); } }; addEventListener('keydown', exitPanels); return () => removeEventListener('keydown', exitPanels); }, []);
  const selectNote = async slug => { const selected = slug === '__new__' ? newNote(documents.map(doc => doc.slug)) : documents.find(doc => doc.slug === slug); if (!selected) return; const recovered = await loadDraft(draftKey(selected)).catch(() => null); const next = recovered?.note ? { postType: 'text', photo: '', ...recovered.note } : selected; setNote(next); if (next?.existing && recovered?.note) setDocuments(current => current.map(doc => doc.slug === next.slug ? next : doc)); setImages(recovered?.images || []); setViewMode('edit'); setLibraryOpen(false); setOperationsOpen(false); setStatus(recovered ? 'ローカル下書きを復元しました。' : slug === '__new__' ? 'NEW NOTE' : `${selected.title || selected.slug}を編集中です。`); };
  const update = patch => { const activeSlug = note?.slug; setNote(current => ({ ...current, ...patch })); if (note?.existing) setDocuments(current => current.map(doc => doc.slug === activeSlug ? { ...doc, ...patch } : doc)); };
  const issues = useMemo(() => preflightIssues(note, documents, imageProcessing), [note, documents, imageProcessing]);
  const publish = useCallback(async () => {
    if (!note || busy || imageProcessing) return; if (QA_PREVIEW) { setStatus('DESIGN PREVIEW — 公開処理は実行しません。'); return; }
    if (bulkTagSlugs.length) { setStatus('先にTOOLS / TAGSから一括変更を保存してください。'); setOperationsOpen(true); setOperationsTab('tags'); return; }
    const blocking = issues.find(issue => issue.level === 'error'); if (blocking) { setStatus(`ERROR — ${blocking.text}`); return; }
    setBusy(true); setStatus(note.draft ? '下書きをGitHubへ保存しています…' : '公開コミットを作成しています…');
    try { const success = note.draft ? 'GitHub下書きを保存しました。' : '公開しました。数分後にサイトへ反映されます。'; await publishAtomic({ token, baseSha, slug: note.slug, markdown: serializeDocument(note), images, existing: note.existing }); suppressAutosaveUntil.current = Date.now() + 2000; await deleteDraft(draftKey(note)); setImages([]); await refresh(token); setStatus(success); }
    catch (error) { setStatus(error.code === 'CONFLICT' ? `CONFLICT — ${error.message}` : `ERROR — ${error.message}`); }
    finally { setBusy(false); }
  }, [note, busy, imageProcessing, issues, token, baseSha, images, refresh, bulkTagSlugs]);
  const publishBulkTags = useCallback(async () => {
    if (!bulkTagSlugs.length || busy) return;
    if (QA_PREVIEW) { setStatus('DESIGN PREVIEW — 一括保存は実行しません。'); return; }
    setBusy(true); setStatus(`${bulkTagSlugs.length}件の記事を一括保存しています…`);
    try {
      await publishBatch({ token, baseSha, entries: documents.filter(document => bulkTagSlugs.includes(document.slug)).map(document => ({ slug: document.slug, markdown: serializeDocument(document) })), message: `content: rename tags (${bulkTagSlugs.length} Notes)` });
      await refresh(token); setStatus('タグの一括変更を保存しました。');
    } catch (error) { setStatus(error.code === 'CONFLICT' ? `CONFLICT — ${error.message}` : `ERROR — ${error.message}`); }
    finally { setBusy(false); }
  }, [bulkTagSlugs, busy, token, baseSha, documents, refresh]);
  const renameTag = (from, to) => {
    const current = note?.existing ? documents.map(document => document.slug === note.slug ? note : document) : documents;
    const result = renameTagInDocuments(current, from, to);
    if (!result.changedSlugs.length) return;
    if (!bulkTagSnapshot) setBulkTagSnapshot(documents);
    setDocuments(result.documents);
    if (note?.existing) setNote(result.documents.find(document => document.slug === note.slug));
    setBulkTagSlugs(previous => [...new Set([...previous, ...result.changedSlugs])]);
    setStatus(`タグを ${from} → ${to} に変更しました。保存待ちです。`);
  };
  const discardTagChanges = () => {
    if (!bulkTagSnapshot) return;
    setDocuments(bulkTagSnapshot); if (note?.existing) setNote(bulkTagSnapshot.find(document => document.slug === note.slug) || note); setBulkTagSlugs([]); setBulkTagSnapshot(null); setStatus('タグの一括変更を取り消しました。');
  };
  const handleImageFiles = useCallback(async inputFiles => {
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
  }, [note?.postType]);
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
  const duplicate = source => { const copy = duplicateDocument(source, documents.map(document => document.slug)); setNote(copy); setImages([]); setViewMode('edit'); setAdvanced(true); setLibraryOpen(false); setStatus('記事を下書きとして複製しました。タイトルと内容を確認してください。'); };
  const useImage = path => {
    if (note.postType === 'photo') { update({ photo: path }); setStatus('既存画像を写真投稿へ設定しました。'); }
    else if (editorRef.current?.insertMarkdown) { editorRef.current.insertMarkdown(`\n\n![](${path})\n\n`); setStatus('本文へ既存画像を挿入しました。'); }
    else { update({ body: `${note.body}${note.body.endsWith('\n') || !note.body ? '' : '\n'}\n![](${path})\n` }); setStatus('本文へ既存画像を挿入しました。'); }
    setOperationsOpen(false);
  };
  const logout = () => { setToken(''); setNote(null); setRepositoryLoaded(false); setLibraryOpen(false); setOperationsOpen(false); };
  if (!token) return <Login onToken={setToken} />;
  if (!note) {
    if (!repositoryLoaded) return <main className="login"><p>{status || 'LOADING…'}</p></main>;
    return <ArticleLibrary entry documents={documents} activeSlug="" onClose={() => {}} onSelect={selectNote} onNew={() => selectNote('__new__')} onDuplicate={duplicate}/>;
  }
  return <div className={`app-shell ${focusMode ? 'is-focus' : ''}`}>
    <ArticleLibrary open={libraryOpen} documents={documents} activeSlug={note.slug} onClose={() => setLibraryOpen(false)} onSelect={selectNote} onNew={() => selectNote('__new__')} onDuplicate={duplicate}/>
    <OperationsPanel open={operationsOpen} tab={operationsTab} onTabChange={setOperationsTab} documents={toolDocuments} onClose={() => setOperationsOpen(false)} onSelect={selectNote} onUseImage={useImage} onRenameTag={renameTag} pendingTagChanges={bulkTagSlugs.length} onSaveTagChanges={publishBulkTags} onDiscardTagChanges={discardTagChanges}/>
    <header className="editor-top">
      <div className="editor-brand"><a href="/">SYNOMARE</a><span>NOTES</span></div>
      <select aria-label="記事を選ぶ" value={note.existing ? note.slug : '__new__'} onChange={event => selectNote(event.target.value)}><option value="__new__">＋ NEW NOTE</option>{documents.map(doc => <option key={doc.slug} value={doc.slug}>{doc.title || (doc.postType === 'photo' ? `PHOTO / ${doc.date}` : doc.slug)}</option>)}</select>
      <div className="editor-session"><button aria-label="記事ライブラリを開く" onClick={() => { setOperationsOpen(false); setLibraryOpen(true); }}>LIBRARY</button><button aria-label="記事運用ツールを開く" onClick={() => { setLibraryOpen(false); setOperationsOpen(true); }}>TOOLS</button><button aria-label="GitHubから記事を再読み込み" onClick={() => refresh(token)} disabled={busy}>RELOAD</button><button aria-label="ログアウト" onClick={logout}>LOG OUT</button></div>
    </header>
    <main className={`workspace is-${note.postType} mode-${viewMode}`}>
      <section className="writing">
        <div className="document-head">
          <div className="type-switch" aria-label="投稿タイプ"><button type="button" className={note.postType === 'text' ? 'active' : ''} onClick={() => update({ postType: 'text' })}>TEXT</button><button type="button" className={note.postType === 'photo' ? 'active' : ''} onClick={() => update({ postType: 'photo' })}>PHOTO</button></div>
          <input className="title-input" aria-label="タイトル" value={note.title} placeholder={note.postType === 'photo' ? 'Title / optional' : 'Untitled note'} onChange={event => update({ title: event.target.value })}/>
          <div className="document-meta"><span>{note.date}</span><span>{note.slug}</span><span>{note.postType.toUpperCase()} / CARD {note.cardSize === 'auto' ? `AUTO → ${note.postType === 'photo' ? 'L' : 'S / M'}` : note.cardSize.toUpperCase()}</span></div>
        </div>
        {note.postType === 'photo' ? <PhotoStage note={note} images={images}/> : <>
          <EditorToolbar mode={viewMode} onMode={setViewMode} focusMode={focusMode} onFocusMode={() => setFocusMode(value => !value)} onCommand={command => editorRef.current?.command(command)}/>
          <div className="editor-surface">
            <MarkdownEditor ref={editorRef} value={note.body} onChange={body => update({ body })} onDepthChange={setHierarchyDepth} notes={relationNotes} onPublish={publish} onFiles={handleImageFiles}/>
            {viewMode !== 'edit' ? <MarkdownPreview body={note.body}/> : null}
          </div>
          <DocumentStatus body={note.body} depth={hierarchyDepth} status={status}/>
          <ImageQueue images={images} onRemove={removeImage}/>
        </>}
        {advanced ? <section className="details"><label>SLUG<input value={note.slug} readOnly={note.existing} onChange={event => update({ slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}/></label><label>DATE<input type="date" value={note.date} onChange={event => update({ date: event.target.value })}/></label><label>CARD SIZE<select value={note.cardSize} onChange={event => update({ cardSize: event.target.value })}><option value="auto">AUTO / CONTENT</option><option value="s">S / SMALL</option><option value="m">M / MEDIUM</option><option value="l">L / LARGE</option></select></label><label>VISIBILITY<select value={note.draft ? 'draft' : 'public'} onChange={event => update({ draft: event.target.value === 'draft' })}><option value="public">PUBLIC</option><option value="draft">GITHUB DRAFT</option></select></label><label className="wide">{note.postType === 'photo' ? 'CAPTION / DESCRIPTION' : 'SUMMARY'}<input value={note.summary} placeholder={note.postType === 'photo' ? '未入力でも公開できます' : excerptFromBody(note.body)} onChange={event => update({ summary: event.target.value })}/></label>{note.postType === 'text' ? <label className="wide">CARD EXCERPT<input value={note.cardExcerpt} placeholder="概要を使用" onChange={event => update({ cardExcerpt: event.target.value })}/></label> : null}<TokenEditor label="TAGS" values={note.tags} suggestions={tagSuggestions} placeholder={note.postType === 'photo' ? '写真' : 'タグを入力してEnter'} onChange={tags => update({ tags })}/><TokenEditor label="ALIASES" values={note.aliases} suggestions={aliasSuggestions} placeholder="別名を入力してEnter" onChange={aliases => update({ aliases })}/></section> : null}
        <PublishCheck issues={issues}/>
        <div className="editor-actions">
          <span className={`save-status ${status.startsWith('ERROR') || status.startsWith('CONFLICT') ? 'error' : ''}`} aria-live="polite">{status}</span>
          <label className={`upload ${imageProcessing ? 'is-busy' : ''}`}>＋ {imageProcessing ? 'PROCESSING…' : note.postType === 'photo' && note.photo ? 'REPLACE PHOTO' : 'IMAGE'}<input type="file" accept={IMAGE_ACCEPT} multiple={note.postType === 'text'} disabled={imageProcessing || busy} onChange={imageInput}/></label>
          <button onClick={() => setAdvanced(value => !value)} aria-expanded={advanced}>DETAILS {advanced ? '−' : '+'}</button>
          <button onClick={copyMarkdown}>{copied ? 'COPIED' : 'COPY MD'}</button>
          <button className="primary" onClick={publish} disabled={busy || imageProcessing || issues.some(issue => issue.level === 'error')}>{busy ? 'SAVING…' : imageProcessing ? 'PROCESSING…' : note.draft ? 'SAVE DRAFT' : 'PUBLISH'} <span>⌘↵</span></button>
        </div>
      </section>
      {note.postType === 'text' ? <Inspector note={note} documents={documents} onJump={jumpToLine}/> : null}
    </main>
  </div>;
}
