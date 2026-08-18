import { useMemo, useState } from 'react';
import { analyzeLinks, collectImages, collectTagStats } from './operations.js';

const tabs = [
  ['tags', 'TAGS'],
  ['media', 'MEDIA'],
  ['links', 'LINKS']
];

function ArticlePills({ articles, onSelect }) {
  if (!articles?.length) return null;
  return <div className="ops-article-pills">{articles.slice(0, 8).map(article => <button type="button" key={article.slug} onClick={() => onSelect(article.slug)}>{article.title || article.slug}</button>)}{articles.length > 8 ? <span>+{articles.length - 8}</span> : null}</div>;
}

function MediaThumb({ path }) {
  const [broken, setBroken] = useState(false);
  return broken ? <div className="ops-media-fallback">NO PREVIEW</div> : <img src={path} alt="" loading="lazy" onError={() => setBroken(true)}/>;
}

function TagsTab({ documents, onSelect, onRenameTag, pendingTagChanges, onSaveTagChanges, onDiscardTagChanges }) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState('');
  const [replacement, setReplacement] = useState('');
  const stats = useMemo(() => collectTagStats(documents).filter(tag => !query || tag.name.normalize('NFKC').toLocaleLowerCase('ja').includes(query.normalize('NFKC').toLocaleLowerCase('ja'))), [documents, query]);
  const beginRename = name => { setEditing(name); setReplacement(name); };
  const applyRename = () => {
    const value = replacement.trim();
    if (!value || value === editing) { setEditing(''); return; }
    onRenameTag(editing, value); setEditing(''); setReplacement('');
  };
  return <section className="ops-section">
    <div className="ops-intro"><strong>TAG MANAGEMENT</strong><span>タグの使用状況を確認し、表記ゆれをまとめます。</span></div>
    {pendingTagChanges ? <div className="ops-pending"><span>{pendingTagChanges} ARTICLES CHANGED LOCALLY</span><div><button type="button" onClick={onDiscardTagChanges}>DISCARD</button><button type="button" className="primary" onClick={onSaveTagChanges}>SAVE TAG CHANGES</button></div></div> : null}
    <label className="ops-search">SEARCH<input value={query} onChange={event => setQuery(event.target.value)} placeholder="タグ名を検索"/></label>
    <div className="ops-count">{stats.length} TAGS · {documents.length} ARTICLES</div>
    <div className="ops-list">{stats.length ? stats.map(tag => <div className="ops-tag-row" key={tag.name}>
      <div className="ops-row-main"><strong>#{tag.name}</strong><small>{tag.count} ARTICLES · {tag.publicCount} PUBLIC · {tag.draftCount} DRAFT</small><ArticlePills articles={tag.slugs.map(slug => { const article = documents.find(document => document.slug === slug); return { slug, title: article?.title || slug }; })} onSelect={onSelect}/></div>
      {editing === tag.name ? <div className="ops-inline-edit"><input autoFocus value={replacement} onChange={event => setReplacement(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') applyRename(); if (event.key === 'Escape') setEditing(''); }}/><button type="button" onClick={applyRename}>APPLY</button><button type="button" onClick={() => setEditing('')}>×</button></div> : <button type="button" className="ops-row-action" onClick={() => beginRename(tag.name)}>RENAME</button>}
    </div>) : <p className="ops-empty">条件に一致するタグがありません。</p>}</div>
    <p className="ops-note">RENAMEはこの画面で変更対象をまとめ、SAVE TAG CHANGESで1コミットに保存します。記事本文や画像は変更しません。</p>
  </section>;
}

function MediaTab({ documents, onSelect, onUseImage }) {
  const [query, setQuery] = useState('');
  const images = useMemo(() => collectImages(documents).filter(image => !query || image.path.toLocaleLowerCase().includes(query.toLocaleLowerCase()) || image.articles.some(article => article.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()))), [documents, query]);
  return <section className="ops-section">
    <div className="ops-intro"><strong>IMAGE LIBRARY</strong><span>公開済み記事で使われている画像を再利用できます。</span></div>
    <label className="ops-search">SEARCH<input value={query} onChange={event => setQuery(event.target.value)} placeholder="ファイル名、記事名を検索"/></label>
    <div className="ops-count">{images.length} IMAGES · {images.reduce((sum, image) => sum + image.uses, 0)} USES</div>
    <div className="ops-media-grid">{images.length ? images.map(image => <article className="ops-media-card" key={image.path}><div className="ops-media-thumb"><MediaThumb path={image.path}/></div><div className="ops-media-info"><strong>{image.path.split('/').pop()}</strong><small>{image.kinds.join(' / ')} · {image.uses} USE{image.uses === 1 ? '' : 'S'}</small><ArticlePills articles={image.articles} onSelect={onSelect}/><div className="ops-media-actions"><button type="button" onClick={() => navigator.clipboard?.writeText(image.path)}>COPY PATH</button><button type="button" className="primary" onClick={() => onUseImage(image.path)}>USE IN ARTICLE</button></div></div></article>) : <p className="ops-empty">記事内で使用されている画像がありません。</p>}</div>
    <p className="ops-note">画像ファイル自体は削除しません。未使用画像の整理は、使用記事を確認してからDecap／Git履歴で行ってください。</p>
  </section>;
}

function LinkIssueRow({ issue, kind, onSelect }) {
  return <article className={`ops-link-row ${kind}`}><div className="ops-row-main"><strong>{kind === 'orphan' ? issue.title : `[[${issue.target}]]`}</strong><small>{kind === 'orphan' ? 'INCOMING 0 · OUTGOING 0' : `${issue.sourceTitle} · LINE ${issue.context.line}`}</small>{issue.context?.text ? <p>{issue.context.text}</p> : null}{issue.matches ? <div className="ops-match-list">{issue.matches.map(match => <span key={match.slug}>{match.title || match.slug}</span>)}</div> : null}</div><button type="button" className="ops-row-action" onClick={() => onSelect(kind === 'orphan' ? issue.slug : issue.sourceSlug)}>OPEN</button></article>;
}

function LinksTab({ documents, onSelect }) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const analysis = useMemo(() => analyzeLinks(documents), [documents]);
  const rows = useMemo(() => {
    const unresolved = analysis.unresolved.map(issue => ({ ...issue, kind: 'unresolved' }));
    const ambiguous = analysis.ambiguous.map(issue => ({ ...issue, kind: 'ambiguous' }));
    const orphans = analysis.orphans.map(issue => ({ ...issue, kind: 'orphan' }));
    return [...unresolved, ...ambiguous, ...orphans].filter(issue => filter === 'all' || issue.kind === filter).filter(issue => !query || JSON.stringify(issue).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  }, [analysis, filter, query]);
  return <section className="ops-section">
    <div className="ops-intro"><strong>LINK MAINTENANCE</strong><span>未解決・曖昧・孤立した記事を見つけます。</span></div>
    <div className="ops-link-summary"><button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>ALL <b>{analysis.total}</b></button><button type="button" className={filter === 'unresolved' ? 'active' : ''} onClick={() => setFilter('unresolved')}>UNRESOLVED <b>{analysis.unresolved.length}</b></button><button type="button" className={filter === 'ambiguous' ? 'active' : ''} onClick={() => setFilter('ambiguous')}>AMBIGUOUS <b>{analysis.ambiguous.length}</b></button><button type="button" className={filter === 'orphan' ? 'active' : ''} onClick={() => setFilter('orphan')}>ORPHAN <b>{analysis.orphans.length}</b></button></div>
    <label className="ops-search">SEARCH<input value={query} onChange={event => setQuery(event.target.value)} placeholder="記事名、リンク先を検索"/></label>
    <div className="ops-list">{rows.length ? rows.map((issue, index) => <LinkIssueRow issue={issue} kind={issue.kind} onSelect={onSelect} key={`${issue.kind}-${issue.sourceSlug || issue.slug}-${issue.target || index}`}/>) : <p className="ops-empty">保守が必要なリンクはありません。</p>}</div>
    <p className="ops-note">UNRESOLVEDはリンク元を開いて記事名・slug・aliasを修正してください。AMBIGUOUSは同名記事のalias整理が必要です。</p>
  </section>;
}

export default function OperationsPanel({ open, tab, onTabChange, documents, onClose, onSelect, onUseImage, onRenameTag, pendingTagChanges, onSaveTagChanges, onDiscardTagChanges }) {
  if (!open) return null;
  return <><button type="button" className="operations-backdrop" aria-label="記事運用ツールを閉じる" onClick={onClose}/><aside className="operations-panel" aria-label="記事運用ツール">
    <header><div><strong>CONTENT TOOLS</strong><span>TAG / IMAGE / LINK MAINTENANCE</span></div><button type="button" aria-label="記事運用ツールを閉じる" onClick={onClose}>×</button></header>
    <nav className="operations-tabs" aria-label="記事運用ツールのタブ">{tabs.map(([value, label]) => <button type="button" key={value} className={tab === value ? 'active' : ''} aria-selected={tab === value} onClick={() => onTabChange(value)}>{label}</button>)}</nav>
    <div className="operations-scroll">{tab === 'tags' ? <TagsTab documents={documents} onSelect={onSelect} onRenameTag={onRenameTag} pendingTagChanges={pendingTagChanges} onSaveTagChanges={onSaveTagChanges} onDiscardTagChanges={onDiscardTagChanges}/> : tab === 'media' ? <MediaTab documents={documents} onSelect={onSelect} onUseImage={onUseImage}/> : <LinksTab documents={documents} onSelect={onSelect}/>}</div>
  </aside></>;
}
