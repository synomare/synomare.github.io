import { useDeferredValue, useMemo, useState } from 'react';
import { collectTags, filterDocuments } from './articleLibrary.js';

export default function ArticleLibrary({ open, entry = false, documents, activeSlug, onClose, onSelect, onNew, onDuplicate }) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [status, setStatus] = useState('all');
  const [tag, setTag] = useState('');
  const [sort, setSort] = useState('newest');
  const deferredQuery = useDeferredValue(query);
  const tags = useMemo(() => collectTags(documents), [documents]);
  const filtered = useMemo(() => filterDocuments(documents, { query: deferredQuery, type, status, tag, sort }), [documents, deferredQuery, type, status, tag, sort]);
  const publicCount = documents.filter(document => !document.draft).length;
  const content = <>
    <header><div><strong>{entry ? 'NOTES EDITOR' : 'ARTICLE LIBRARY'}</strong><span>{entry ? 'CHOOSE A NOTE OR START A NEW ONE' : `${documents.length} TOTAL · ${publicCount} PUBLIC · ${documents.length - publicCount} DRAFT`}</span></div>{entry ? <span className="library-entry-mark">S / N</span> : <button type="button" onClick={onClose} aria-label="記事ライブラリを閉じる">×</button>}</header>
    {entry ? <section className="library-entry-lede"><span>NOTES / WORKSPACE</span><h1>OPEN A NOTE</h1><p>過去の記事を選ぶか、新しい原稿を始めます。</p></section> : null}
    <div className="library-search"><label>SEARCH<input value={query} onChange={event => setQuery(event.target.value)} placeholder="タイトル、本文、slug、タグ" autoFocus={!entry}/></label><button type="button" className="primary" onClick={onNew}>＋ NEW NOTE</button></div>
    <div className="library-filters">
      <label>TYPE<select value={type} onChange={event => setType(event.target.value)}><option value="all">ALL</option><option value="text">TEXT</option><option value="photo">PHOTO</option></select></label>
      <label>STATUS<select value={status} onChange={event => setStatus(event.target.value)}><option value="all">ALL</option><option value="public">PUBLIC</option><option value="draft">DRAFT</option></select></label>
      <label>TAG<select value={tag} onChange={event => setTag(event.target.value)}><option value="">ALL TAGS</option>{tags.map(value => <option value={value} key={value}>{value}</option>)}</select></label>
      <label>SORT<select value={sort} onChange={event => setSort(event.target.value)}><option value="newest">NEWEST</option><option value="oldest">OLDEST</option><option value="title">TITLE</option></select></label>
    </div>
    <div className="library-results" aria-live="polite">
      <div className="library-result-count">{filtered.length} / {documents.length} ARTICLES</div>
      {filtered.length ? filtered.map(document => <article className={document.slug === activeSlug ? 'active' : ''} key={document.slug}>
        <button type="button" className="library-open" onClick={() => onSelect(document.slug)}>
          <span className="library-type">{document.postType.toUpperCase()} · {document.draft ? 'DRAFT' : 'PUBLIC'}</span>
          <strong>{document.title || `PHOTO / ${document.date}`}</strong>
          <small>{document.date} · {document.slug}</small>
          {document.summary ? <p>{document.summary}</p> : null}
          {document.tags?.length ? <div className="library-tags">{document.tags.map(value => <span key={value}>#{value}</span>)}</div> : null}
        </button>
        <div className="library-row-actions"><button type="button" onClick={() => onDuplicate(document)}>DUPLICATE</button>{!document.draft ? <a href={`/notes/${document.slug}.html`} target="_blank" rel="noreferrer">OPEN LIVE ↗</a> : null}</div>
      </article>) : <div className="library-empty">条件に一致する記事がありません。</div>}
    </div>
    <footer><a href="/admin/">DELETE / RECOVERY — DECAP CMS ↗</a></footer>
  </>;
  if (entry) return <main className="article-library-entry" aria-label="Notesを選ぶ">{content}</main>;
  if (!open) return null;
  return <><button type="button" className="library-backdrop" aria-label="記事ライブラリを閉じる" onClick={onClose}/><aside className="article-library" aria-label="記事ライブラリ">{content}</aside></>;
}
