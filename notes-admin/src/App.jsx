import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MarkdownEditor from './MarkdownEditorLazy.jsx';
import { deleteDraft, loadDraft, saveDraft } from './drafts.js';
import { loadRepository, publishAtomic } from './github.js';
import { IMAGE_ACCEPT, prepareImageFiles } from './images.js';
import { excerptFromBody, newNote, outgoingFromBody, parseDocument, parseOAuthMessage, serializeDocument } from './lib.js';

const OAUTH_ORIGIN = 'https://synomare-notes-oauth.decap-oauth.workers.dev';
const draftKey = note => note?.existing ? `note:${note.slug}` : 'note:new';
const splitList = value => [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))].slice(0, 20);
const QA_PREVIEW = ['127.0.0.1', 'localhost'].includes(location.hostname) && new URLSearchParams(location.search).has('demo');
const QA_DOCUMENTS = [
  { slug: 'field-notes', title: '境界に置かれた言葉', date: '2026-08-16', summary: '場所と文章の距離について。', tags: ['思考', '制作'], aliases: ['フィールドノート'], cardSize: 'l', cardExcerpt: '', draft: false, body: '地図の縁に残った言葉を拾いながら、[[小さな信号]]について考える。\n\n## 境界について\n\n読むことと歩くことの間には、まだ名前のない編集がある。', existing: true },
  { slug: 'small-signals', title: '小さな信号', date: '2026-08-15', summary: '', tags: ['思考'], aliases: [], cardSize: 's', cardExcerpt: '', draft: false, body: '見落としそうな変化を記録する。[[フィールドノート]]へ戻る。', existing: true }
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

function Inspector({ note, documents }) {
  const links = outgoingFromBody(note.body);
  const resolved = links.map(link => ({ ...link, note: documents.find(doc => [doc.slug, doc.title, ...(doc.aliases || [])].some(value => value.normalize('NFKC').toLocaleLowerCase('ja') === link.target.normalize('NFKC').toLocaleLowerCase('ja'))) }));
  const backlinks = documents.filter(doc => outgoingFromBody(doc.body).some(link => [note.slug, note.title, ...note.aliases].includes(link.target)));
  const related = documents.filter(doc => doc.slug !== note.slug).map(doc => ({ ...doc, shared: doc.tags.filter(tag => note.tags.includes(tag)).length })).filter(doc => doc.shared).sort((a, b) => b.shared - a.shared).slice(0, 6);
  return <aside className="inspector"><section><h2>OUTGOING / {resolved.length}</h2>{resolved.length ? resolved.map((link, index) => <div className={`relation-row ${link.note ? '' : 'unresolved'}`} key={`${link.target}-${index}`}><span>{link.note ? '●' : '○'}</span><div><strong>{link.label}</strong><small>{link.note?.slug || 'UNRESOLVED'}</small></div></div>) : <p className="muted">[[記事名]] を書くと、ここにリンクが現れます。</p>}</section><section><h2>BACKLINKS / {backlinks.length}</h2>{backlinks.map(doc => <div className="relation-row" key={doc.slug}><span>←</span><div><strong>{doc.title}</strong><small>{doc.slug}</small></div></div>)}</section><section><h2>RELATED / {related.length}</h2>{related.map(doc => <div className="relation-row" key={doc.slug}><span>{doc.shared}</span><div><strong>{doc.title}</strong><small>SHARED TAGS</small></div></div>)}</section></aside>;
}

function ImageQueue({ images }) {
  const [previews, setPreviews] = useState([]);
  useEffect(() => {
    const next = images.map(image => ({ ...image, url: URL.createObjectURL(image.file) }));
    setPreviews(next);
    return () => next.forEach(image => URL.revokeObjectURL(image.url));
  }, [images]);
  if (!previews.length) return null;
  return <div className="image-queue" aria-label="公開待ちの画像">{previews.map(image => <figure key={image.path}>{image.needsBuildConversion ? <div className="image-preview-placeholder">HEIC<br/>公開時変換</div> : <img src={image.url} alt=""/>}<figcaption><strong>{image.originalName || image.file.name}</strong><span>{image.file.type.replace('image/', '').toUpperCase()} / {(image.file.size / 1024 / 1024).toFixed(1)}MB</span></figcaption></figure>)}</div>;
}

export default function App() {
  const [token, setToken] = useState(QA_PREVIEW ? 'qa-preview' : ''); const [baseSha, setBaseSha] = useState(QA_PREVIEW ? 'qa-base' : ''); const [documents, setDocuments] = useState(QA_PREVIEW ? QA_DOCUMENTS : []); const [note, setNote] = useState(QA_PREVIEW ? QA_DOCUMENTS[0] : null); const [images, setImages] = useState([]); const [status, setStatus] = useState(QA_PREVIEW ? 'LOCAL DESIGN PREVIEW' : ''); const [busy, setBusy] = useState(false); const [imageProcessing, setImageProcessing] = useState(false); const [advanced, setAdvanced] = useState(false); const suppressAutosaveUntil = useRef(0);
  const refresh = useCallback(async activeToken => {
    setBusy(true); setStatus('GitHubから記事を読み込んでいます…');
    try { const repo = await loadRepository(activeToken); const docs = repo.documents.map(doc => parseDocument(doc.source, doc.slug)); setDocuments(docs); setBaseSha(repo.baseSha); setNote(current => docs.find(doc => doc.slug === current?.slug) || (current && !current.existing ? current : (docs[0] || newNote(docs.map(doc => doc.slug))))); setStatus(`${docs.length}件の記事を読み込みました。`); }
    catch (error) { setStatus(error.message); if (/push権限/.test(error.message) || error.status === 401) setToken(''); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { if (token && !QA_PREVIEW) refresh(token); }, [token, refresh]);
  useEffect(() => { if (!note || Date.now() < suppressAutosaveUntil.current) return; const timer = setTimeout(() => { saveDraft(draftKey(note), { note, images }).then(() => setStatus(previous => previous.includes('公開') ? previous : 'LOCAL DRAFT SAVED')).catch(() => {}); }, 500); return () => clearTimeout(timer); }, [note, images]);
  const selectNote = async slug => { const selected = slug === '__new__' ? newNote(documents.map(doc => doc.slug)) : documents.find(doc => doc.slug === slug); const recovered = await loadDraft(draftKey(selected)).catch(() => null); setNote(recovered?.note || selected); setImages(recovered?.images || []); setStatus(recovered ? 'ローカル下書きを復元しました。' : ''); };
  const update = patch => setNote(current => ({ ...current, ...patch }));
  const publish = useCallback(async () => {
    if (!note || busy || imageProcessing) return; if (QA_PREVIEW) { setStatus('DESIGN PREVIEW — 公開処理は実行しません。'); return; } if (!note.title.trim() || !note.body.trim()) { setStatus('タイトルと本文を入力してください。'); return; }
    setBusy(true); setStatus(note.draft ? '下書きをGitHubへ保存しています…' : '公開コミットを作成しています…');
    try { const success = note.draft ? 'GitHub下書きを保存しました。' : '公開しました。数分後にサイトへ反映されます。'; await publishAtomic({ token, baseSha, slug: note.slug, markdown: serializeDocument(note), images, existing: note.existing }); suppressAutosaveUntil.current = Date.now() + 2000; await deleteDraft(draftKey(note)); setImages([]); await refresh(token); setStatus(success); }
    catch (error) { setStatus(error.code === 'CONFLICT' ? `CONFLICT — ${error.message}` : `ERROR — ${error.message}`); }
    finally { setBusy(false); }
  }, [note, busy, imageProcessing, token, baseSha, images, refresh]);
  const imageInput = async event => {
    const files = [...event.target.files]; event.target.value = ''; if (!files.length) return;
    setImageProcessing(true); setStatus(`${files.length}件の画像を確認・変換しています…`);
    try {
      const prepared = await prepareImageFiles(files);
      setImages(current => [...current, ...prepared.images]);
      setNote(current => ({ ...current, body: `${current.body}${current.body.endsWith('\n') || !current.body ? '' : '\n'}\n${prepared.images.map(image => `![](/${image.path})`).join('\n\n')}\n` }));
      setStatus(prepared.messages.length ? prepared.messages.join(' ') : `${prepared.images.length}件の画像を公開待ちへ追加しました。`);
    } catch (error) { setStatus(`ERROR — ${error.message}`); }
    finally { setImageProcessing(false); }
  };
  const relationNotes = useMemo(() => documents.filter(doc => doc.slug !== note?.slug), [documents, note?.slug]);
  if (!token) return <Login onToken={setToken} />;
  if (!note) return <main className="login"><p>{status || 'LOADING…'}</p></main>;
  return <div className="app-shell"><header className="editor-top"><a href="/">SYNOMARE</a><span>NOTES EDITOR</span><select aria-label="記事を選ぶ" value={note.existing ? note.slug : '__new__'} onChange={event => selectNote(event.target.value)}><option value="__new__">＋ NEW NOTE</option>{documents.map(doc => <option key={doc.slug} value={doc.slug}>{doc.title || doc.slug}</option>)}</select><button onClick={() => refresh(token)} disabled={busy}>RELOAD</button><button onClick={() => setToken('')}>LOG OUT</button></header><main className="workspace"><section className="writing"><div className="document-head"><input className="title-input" aria-label="タイトル" value={note.title} placeholder="Untitled note" onChange={event => update({ title: event.target.value })}/><div className="document-meta"><span>{note.date}</span><span>{note.slug}</span><span>CARD {note.cardSize.toUpperCase()}</span></div></div><MarkdownEditor value={note.body} onChange={body => update({ body })} notes={relationNotes} onPublish={publish}/><ImageQueue images={images}/><div className="editor-actions"><label className={`upload ${imageProcessing ? 'is-busy' : ''}`}>＋ {imageProcessing ? 'PROCESSING…' : 'IMAGE'}<input type="file" accept={IMAGE_ACCEPT} multiple disabled={imageProcessing || busy} onChange={imageInput}/></label><button onClick={() => setAdvanced(value => !value)} aria-expanded={advanced}>DETAILS {advanced ? '−' : '+'}</button><span className={`save-status ${status.startsWith('ERROR') || status.startsWith('CONFLICT') ? 'error' : ''}`} aria-live="polite">{status}</span><button className="primary" onClick={publish} disabled={busy || imageProcessing}>{busy ? 'SAVING…' : imageProcessing ? 'PROCESSING…' : note.draft ? 'SAVE DRAFT' : 'PUBLISH'} <span>⌘↵</span></button></div>{advanced ? <section className="details"><label>SLUG<input value={note.slug} readOnly={note.existing} onChange={event => update({ slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}/></label><label>DATE<input type="date" value={note.date} onChange={event => update({ date: event.target.value })}/></label><label>CARD SIZE<select value={note.cardSize} onChange={event => update({ cardSize: event.target.value })}><option value="s">S / SMALL</option><option value="m">M / MEDIUM</option><option value="l">L / LARGE</option></select></label><label>VISIBILITY<select value={note.draft ? 'draft' : 'public'} onChange={event => update({ draft: event.target.value === 'draft' })}><option value="public">PUBLIC</option><option value="draft">GITHUB DRAFT</option></select></label><label className="wide">SUMMARY<input value={note.summary} placeholder={excerptFromBody(note.body)} onChange={event => update({ summary: event.target.value })}/></label><label className="wide">CARD EXCERPT<input value={note.cardExcerpt} placeholder="概要を使用" onChange={event => update({ cardExcerpt: event.target.value })}/></label><label>TAGS<input value={note.tags.join(', ')} placeholder="未分類" onChange={event => update({ tags: splitList(event.target.value) })}/></label><label>ALIASES<input value={note.aliases.join(', ')} onChange={event => update({ aliases: splitList(event.target.value) })}/></label></section> : null}</section><Inspector note={note} documents={documents}/></main></div>;
}
