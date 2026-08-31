import { changeSummary } from './changeReview.js';

export default function ChangeReview({ comparison }) {
  if (!comparison || comparison.kind === 'empty') return null;
  const summary = changeSummary(comparison);
  return <details className={`change-review ${comparison.changed ? 'is-dirty' : 'is-clean'}`}>
    <summary><span>CHANGES FROM GITHUB</span><span>{summary}</span></summary>
    <div className="change-review-content">
      {comparison.kind === 'new' ? <p className="change-review-message">新規記事です。PUBLISHすると、現在の本文・設定・画像を一つの新しいGitHubコミットへまとめます。</p> : null}
      {comparison.kind === 'existing' && !comparison.changed ? <p className="change-review-message">読み込んだGitHub版から変更はありません。</p> : null}
      {comparison.metadata.length ? <section className="change-review-meta" aria-label="メタデータの変更">
        <h2>METADATA / {comparison.metadata.length}</h2>
        <div role="table" aria-label="GitHub版と現在の原稿の比較">
          <div className="change-review-meta-head" role="row"><span role="columnheader">FIELD</span><span role="columnheader">GITHUB</span><span role="columnheader">CURRENT</span></div>
          {comparison.metadata.map(row => <div role="row" key={row.key}><strong role="rowheader">{row.label}</strong><span role="cell">{row.before}</span><span role="cell">{row.after}</span></div>)}
        </div>
      </section> : null}
      {comparison.kind === 'existing' && comparison.body.changed ? <section className="change-review-body" aria-label="本文の変更">
        <h2>BODY / +{comparison.body.added} −{comparison.body.removed}</h2>
        <pre>{comparison.body.operations.map((operation, index) => operation.type === 'skip'
          ? <span className="is-skip" key={`skip-${index}`}>··· {operation.count} unchanged lines ···</span>
          : <span className={`is-${operation.type}`} key={`${operation.type}-${index}`}><i>{operation.type === 'add' ? '+' : operation.type === 'remove' ? '−' : ' '}</i>{operation.text || ' '}</span>)}</pre>
      </section> : null}
    </div>
  </details>;
}
