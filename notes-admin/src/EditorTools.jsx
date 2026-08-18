import { documentStats, outlineFromBody } from './editorTools.js';

const tools = [
  ['H2', 'h2', '見出し2'], ['H3', 'h3', '見出し3'], ['B', 'bold', '太字（⌘B）'], ['LINK', 'link', 'リンク（⌘K）'],
  ['[[ ]]', 'wikilink', '内部リンク（⌘⇧K）'], ['❯', 'quote', '引用'], ['•', 'bullet', '箇条書き'], ['1.', 'ordered', '番号付きリスト'],
  ['[ ]', 'task', 'タスクリスト'], ['` `', 'code', 'コード'], ['—', 'divider', '区切り線'], ['↶', 'undo', '元に戻す'], ['↷', 'redo', 'やり直す']
];

const hierarchyTools = [
  ['DEPTH −', 'outdent', '選択行を一段浅く（Shift + Tab）'],
  ['DEPTH +', 'indent', '選択行を一段深く（Tab）'],
  ['LEVEL −', 'headingDown', '見出しレベルを浅く'],
  ['LEVEL +', 'headingUp', '見出しレベルを深く']
];

export function EditorToolbar({ mode, onMode, focusMode, onFocusMode, onCommand }) {
  return <div className="editor-toolbar" role="toolbar" aria-label="Markdown書式">
    <div className="format-tools">
      <div className="format-group hierarchy-tools" aria-label="テキスト階層">{hierarchyTools.map(([label, action, title]) => <button type="button" key={action} title={title} aria-label={title} onMouseDown={event => event.preventDefault()} onClick={() => onCommand(action)}>{label}</button>)}</div>
      <div className="format-group">{tools.map(([label, action, title]) => <button type="button" key={action} title={title} aria-label={title} onMouseDown={event => event.preventDefault()} onClick={() => onCommand(action)}>{label}</button>)}</div>
    </div>
    <div className="editor-modes" aria-label="表示モード">{['edit', 'split', 'preview'].map(value => <button type="button" key={value} className={mode === value ? 'active' : ''} aria-pressed={mode === value} onClick={() => onMode(value)}>{value.toUpperCase()}</button>)}<button type="button" className={focusMode ? 'active' : ''} aria-pressed={focusMode} onClick={onFocusMode}>FOCUS</button></div>
  </div>;
}

export function DocumentStatus({ body, status, depth = 0 }) {
  const stats = documentStats(body);
  return <div className="document-status"><span>{stats.characters} CHARS</span><span>{stats.minutes} MIN READ</span><span>{stats.headings} HEADINGS</span><span>BLOCK DEPTH {depth}</span><span className="document-save-state">{status || 'READY'}</span></div>;
}

export function Outline({ note, onJump }) {
  const outline = outlineFromBody(note.body);
  return <section className="outline-section"><h2>OUTLINE / {outline.length + 1}</h2><button type="button" onClick={() => onJump(1)}><span>1</span><strong>{note.title || 'UNTITLED'}</strong></button>{outline.map(item => <button type="button" style={{ '--level': item.level }} key={`${item.line}-${item.text}`} onClick={() => onJump(item.line)}><span>{item.level}</span><strong>{item.text}</strong></button>)}</section>;
}

export function PublishCheck({ issues }) {
  const errors = issues.filter(issue => issue.level === 'error').length;
  return <details className={`publish-check ${errors ? 'has-errors' : ''}`}><summary><span>PUBLISH CHECK · {issues.length} {issues.length === 1 ? 'ISSUE' : 'ISSUES'}</span><span>{errors ? `${errors} BLOCKING` : 'READY'}</span></summary>{issues.length ? <ul>{issues.map((issue, index) => <li className={issue.level} key={`${issue.text}-${index}`}>{issue.level === 'error' ? '×' : '△'} {issue.text}</li>)}</ul> : <p>公開に必要な項目が揃っています。</p>}</details>;
}
