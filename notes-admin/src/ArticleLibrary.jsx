import { useDeferredValue, useMemo, useState } from 'react';
import { articleFolios, collectTags, draftLibraryItems, filterDocuments, filterLocalDraftItems, localDraftIndex } from './articleLibrary.js';
import useDialogFocus from './useDialogFocus.js';

const savedTime = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
});

const localKindLabel = kind => ({
  new: 'NEW / THIS DEVICE',
  missing: 'REMOTE MISSING',
  conflict: 'SLUG CONFLICT',
  parallel: 'PARALLEL EDIT'
}[kind] || 'LOCAL');

function DraftDiscardDialog({ candidate, busy, error, onCancel, onConfirm }) {
  const open = Boolean(candidate);
  const { dialogRef, onDialogKeyDown } = useDialogFocus(open, '[data-dialog-initial-focus]', onCancel);
  if (!candidate) return null;
  const title = candidate.note?.title || (candidate.note?.postType === 'photo' ? 'PHOTO / ' + (candidate.note?.date || '') : 'UNTITLED NOTE');
  return <>
    <div className="draft-confirm-backdrop" aria-hidden="true" onClick={busy ? undefined : onCancel}/>
    <section ref={dialogRef} className="draft-confirm" role="alertdialog" aria-modal="true" aria-labelledby="draft-confirm-title" aria-describedby="draft-confirm-description" tabIndex={-1} onKeyDown={onDialogKeyDown}>
      <span>LOCAL DRAFT / DISCARD</span>
      <h2 id="draft-confirm-title">この端末の下書きを破棄しますか？</h2>
      <p id="draft-confirm-description">GitHub上の記事は削除されません。この端末だけにある本文と未送信画像は元に戻せません。</p>
      <dl>
        <div><dt>NOTE</dt><dd>{title}</dd></div>
        <div><dt>SLUG</dt><dd>{candidate.note?.slug || '—'}</dd></div>
        <div><dt>SAVED</dt><dd>{candidate.savedAt ? savedTime.format(new Date(candidate.savedAt)) : 'UNKNOWN'}</dd></div>
        <div><dt>IMAGES</dt><dd>{candidate.images?.length || 0}</dd></div>
      </dl>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <div className="draft-confirm-actions">
        <button type="button" onClick={onCancel} disabled={busy} data-dialog-initial-focus>KEEP DRAFT</button>
        <button type="button" className="danger" onClick={onConfirm} disabled={busy}>{busy ? 'DISCARDING…' : 'DISCARD LOCAL'}</button>
      </div>
    </section>
  </>;
}

function LocalDraftRail({ entry, items, activeDraftKey, disabled, onResume, onRequestDiscard }) {
  if (!items.length) return null;
  const rows = <div className="local-draft-list">
    {items.map((item, index) => {
      const active = item.localDraftKey === activeDraftKey;
      return <article className={'local-draft-row is-' + item.localDraftKind + (active ? ' active' : '')} key={item.localDraftKey}>
        <div className="local-draft-copy">
          <span className="local-draft-type">{'L.' + String(index + 1).padStart(3, '0') + ' / ' + localKindLabel(item.localDraftKind)}</span>
          <strong>{item.title || (item.postType === 'photo' ? 'PHOTO / ' + item.date : 'UNTITLED NOTE')}</strong>
          <small>{'SAVED ' + (item.localSavedAt ? savedTime.format(new Date(item.localSavedAt)) : 'UNKNOWN') + ' · ' + item.postType.toUpperCase() + ' · IMG ' + item.localImages.length}</small>
        </div>
        <div className="local-draft-actions">
          <button type="button" disabled={disabled || active} onClick={() => onResume(item.localDraftKey)}>{active ? 'EDITING' : 'RESUME'}</button>
          <button type="button" disabled={disabled || active} onClick={() => onRequestDiscard(item.localDraftKey)}>DISCARD</button>
        </div>
      </article>;
    })}
  </div>;
  if (entry) return <section className="local-drafts local-drafts--entry" aria-labelledby="local-drafts-title">
    <header className="local-drafts-head"><h2 id="local-drafts-title">LOCAL DRAFTS / {items.length}</h2><span>THIS DEVICE ONLY</span></header>
    {rows}
  </section>;
  return <details className="local-drafts local-drafts--drawer">
    <summary><span>LOCAL DRAFTS / {items.length}</span><small>THIS DEVICE ONLY</small></summary>
    {rows}
  </details>;
}

export default function ArticleLibrary({
  open,
  entry = false,
  disabled = false,
  documents,
  localDrafts = [],
  localDraftsLoaded = true,
  localDraftError = '',
  activeSlug,
  activeDraftKey = '',
  onClose,
  onSelect,
  onNew,
  onDuplicate,
  onResumeDraft,
  onDiscardDraft
}) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [status, setStatus] = useState('all');
  const [tag, setTag] = useState('');
  const [sort, setSort] = useState('newest');
  const [discardKey, setDiscardKey] = useState('');
  const [discardBusy, setDiscardBusy] = useState(false);
  const [discardError, setDiscardError] = useState('');
  const deferredQuery = useDeferredValue(query);
  const draftItems = useMemo(() => draftLibraryItems(localDrafts, documents), [localDrafts, documents]);
  const localIndex = useMemo(() => localDraftIndex(draftItems), [draftItems]);
  const tags = useMemo(() => collectTags([...documents, ...draftItems.map(item => item.note)]), [documents, draftItems]);
  const displayDocuments = useMemo(() => documents.map(document => {
    const local = localIndex.get(document.slug);
    return local ? { ...document, ...local.note, slug: document.slug, existing: true, draft: document.draft, repoDraft: document.draft, localDraftValue: local.note.draft, localDraftKey: local.key, localImages: local.images || [] } : { ...document, repoDraft: document.draft, localImages: [] };
  }), [documents, localIndex]);
  const sourceDocuments = useMemo(() => status === 'local' ? displayDocuments.filter(document => document.localDraftKey) : displayDocuments, [displayDocuments, status]);
  const filtered = useMemo(() => filterDocuments(sourceDocuments, { query: deferredQuery, type, status: status === 'local' ? 'all' : status, tag, sort }), [sourceDocuments, deferredQuery, type, status, tag, sort]);
  const localOnly = useMemo(() => filterLocalDraftItems(draftItems, { query: deferredQuery, type, status, tag, sort }), [draftItems, deferredQuery, type, status, tag, sort]);
  const localOnlyTotal = useMemo(() => draftItems.reduce((total, item) => total + (item.kind === 'edit' ? 0 : 1), 0), [draftItems]);
  const folios = useMemo(() => articleFolios(documents), [documents]);
  const publicCount = useMemo(() => documents.reduce((total, document) => total + (document.draft ? 0 : 1), 0), [documents]);
  const discardCandidate = useMemo(() => draftItems.find(item => item.key === discardKey) || null, [draftItems, discardKey]);
  const { dialogRef, onDialogKeyDown } = useDialogFocus(open && !entry && !discardCandidate, '[data-dialog-initial-focus]', onClose);

  const requestDiscard = key => {
    setDiscardError('');
    setDiscardKey(key);
  };
  const cancelDiscard = () => {
    if (discardBusy) return;
    setDiscardError('');
    setDiscardKey('');
  };
  const confirmDiscard = async () => {
    if (!discardCandidate || discardBusy) return;
    setDiscardBusy(true);
    setDiscardError('');
    try {
      await onDiscardDraft(discardCandidate);
      setDiscardKey('');
    } catch (error) {
      setDiscardError(error?.message || 'ローカル下書きを破棄できませんでした。');
    } finally {
      setDiscardBusy(false);
    }
  };

  const content = <>
    <header><div><strong id={entry ? undefined : 'article-library-title'}>{entry ? 'NOTES EDITOR' : 'ARTICLE LIBRARY'}</strong><span id={entry ? undefined : 'article-library-description'}>{entry ? 'CHOOSE A NOTE OR START A NEW ONE' : documents.length + ' TOTAL · ' + publicCount + ' PUBLIC · ' + (documents.length - publicCount) + ' GITHUB DRAFT · ' + draftItems.length + ' LOCAL'}</span></div>{entry ? <span className="library-entry-mark">S / N</span> : <button type="button" onClick={onClose} aria-label="記事ライブラリを閉じる" data-dialog-initial-focus>×</button>}</header>
    {entry ? <div className={`library-entry-overview ${localOnly.length ? 'has-local-drafts' : ''}`}>
      <section className="library-entry-lede"><span>NOTES / WORKSPACE</span><h1>OPEN A NOTE</h1><p>過去の記事を選ぶか、新しい原稿を始めます。端末に保存中の原稿があれば、ここから続きを開けます。</p></section>
      <LocalDraftRail entry items={localOnly} activeDraftKey={activeDraftKey} disabled={disabled} onResume={onResumeDraft} onRequestDiscard={requestDiscard}/>
    </div> : null}
    {localDraftError ? <div className="local-drafts-error" role="alert"><strong>LOCAL DRAFTS UNAVAILABLE</strong><span>{localDraftError} この表示中は端末内の自動保存を確認できません。</span></div> : null}
    <div className="library-search"><label>SEARCH<input value={query} onChange={event => setQuery(event.target.value)} placeholder="タイトル、本文、slug、タグ"/></label><button type="button" className="primary" onClick={onNew} disabled={disabled}>＋ NEW NOTE</button></div>
    <div className="library-filters">
      <label>TYPE<select value={type} onChange={event => setType(event.target.value)}><option value="all">ALL</option><option value="text">TEXT</option><option value="photo">PHOTO</option></select></label>
      <label>STATUS<select value={status} onChange={event => setStatus(event.target.value)}><option value="all">ALL</option><option value="public">PUBLIC</option><option value="draft">GITHUB DRAFT</option><option value="local">LOCAL CHANGES</option></select></label>
      <label>TAG<select value={tag} onChange={event => setTag(event.target.value)}><option value="">ALL TAGS</option>{tags.map(value => <option value={value} key={value}>{value}</option>)}</select></label>
      <label>SORT<select value={sort} onChange={event => setSort(event.target.value)}><option value="newest">NEWEST</option><option value="oldest">OLDEST</option><option value="title">TITLE</option></select></label>
    </div>
    <div className="library-results">
      {!entry ? <LocalDraftRail items={localOnly} activeDraftKey={activeDraftKey} disabled={disabled} onResume={onResumeDraft} onRequestDiscard={requestDiscard}/> : null}
      <div className="library-result-count" role="status" aria-live="polite" aria-atomic="true">{localDraftError ? 'LOCAL DRAFTS UNAVAILABLE' : localDraftsLoaded ? filtered.length + localOnly.length + ' RESULTS · ' + draftItems.length + ' LOCAL' : 'LOCAL DRAFTS LOADING…'}</div>
      {filtered.length ? filtered.map(document => {
        const local = document.localDraftKey ? localIndex.get(document.slug) : null;
        return <article className={(document.slug === activeSlug ? 'active' : '') + (local ? ' has-local-draft' : '')} key={document.slug}>
          <button type="button" className="library-open" disabled={disabled} onClick={() => local ? onResumeDraft(local.key) : onSelect(document.slug)}>
            <span className="library-type">{(document.draft ? 'D' : document.postType === 'photo' ? 'P' : 'N') + '.' + String(folios.get(document.slug) || 0).padStart(3, '0') + ' / ' + document.postType.toUpperCase() + ' · ' + (document.draft ? 'GITHUB DRAFT' : 'PUBLIC') + (local ? ` · LOCAL CHANGES${document.localDraftValue !== document.repoDraft ? ` → ${document.localDraftValue ? 'GITHUB DRAFT' : 'PUBLIC'}` : ''}` : '')}</span>
            <strong>{document.title || 'PHOTO / ' + document.date}</strong>
            <small>{document.date} · {document.slug}</small>
            {document.summary ? <p>{document.summary}</p> : null}
            {document.tags?.length ? <div className="library-tags">{document.tags.map(value => <span key={value}>#{value}</span>)}</div> : null}
          </button>
          <div className="library-row-actions">
            <button type="button" disabled={disabled} onClick={() => onDuplicate(document)}>DUPLICATE</button>
            {!document.repoDraft ? <a href={'/notes/' + document.slug + '.html'} target="_blank" rel="noreferrer">OPEN LIVE ↗</a> : null}
            {local ? <button type="button" disabled={disabled || local.key === activeDraftKey} onClick={() => requestDiscard(local.key)}>{local.key === activeDraftKey ? 'EDITING' : 'DISCARD LOCAL'}</button> : null}
          </div>
        </article>;
      }) : (!localOnly.length ? <div className="library-empty">条件に一致する記事がありません。</div> : null)}
      {entry && localOnlyTotal && !localOnly.length ? <div className="library-local-filter-note">ローカル下書きは現在の絞り込み対象外です。</div> : null}
    </div>
    <footer><a href="/admin/">DELETE / RECOVERY — DECAP CMS ↗</a></footer>
  </>;

  if (entry) return <>
    <main className="article-library-entry" aria-label="Notesを選ぶ" inert={discardCandidate ? true : undefined} aria-hidden={discardCandidate ? 'true' : undefined}>{content}</main>
    <DraftDiscardDialog candidate={discardCandidate} busy={discardBusy} error={discardError} onCancel={cancelDiscard} onConfirm={confirmDiscard}/>
  </>;
  if (!open) return null;
  return <>
    <div className="library-backdrop" aria-hidden="true" onClick={discardCandidate ? undefined : onClose}/>
    <aside ref={dialogRef} className="article-library" role="dialog" aria-modal="true" aria-labelledby="article-library-title" aria-describedby="article-library-description" tabIndex={-1} onKeyDown={onDialogKeyDown} inert={discardCandidate ? true : undefined} aria-hidden={discardCandidate ? 'true' : undefined}>{content}</aside>
    <DraftDiscardDialog candidate={discardCandidate} busy={discardBusy} error={discardError} onCancel={cancelDiscard} onConfirm={confirmDiscard}/>
  </>;
}
