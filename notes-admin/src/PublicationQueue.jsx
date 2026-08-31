import { publicationActivity } from './publicationQueue.js';

const LABELS = {
  queued: 'WAITING',
  publishing: 'PUBLISHING',
  done: 'PUBLISHED',
  error: 'STOPPED'
};

const ACCESSIBLE_STATES = {
  PUBLISHING: '処理中',
  WAITING: '順番待ち',
  STOPPED: '停止',
  COMPLETE: '完了'
};

export function PublicationQueueActivity({ items, paused, onOpen }) {
  const activity = publicationActivity(items, paused);
  if (!activity) return null;
  const count = activity.state === 'COMPLETE'
    ? `${activity.completed} DONE`
    : `${String(activity.position).padStart(2, '0')} / ${String(activity.total).padStart(2, '0')}`;
  const waiting = activity.waiting ? `${activity.waiting} WAITING` : '';
  const description = [ACCESSIBLE_STATES[activity.state], `${activity.position}件目 / 全${activity.total}件`, activity.waiting ? `${activity.waiting}件待機` : '', activity.title].filter(Boolean).join('、');
  return <button type="button" className={`publication-queue-activity is-${activity.state.toLowerCase()}`} onClick={onOpen} aria-label={`公開キューを確認: ${description}`} aria-live="polite">
    <span>QUEUE</span>
    <strong>{activity.state}</strong>
    <small>{count}{waiting ? ` · ${waiting}` : ''}</small>
    <em>{activity.title}</em>
  </button>;
}

function QueueStatus({ summary, paused }) {
  if (paused) return <span className="publication-queue-state is-error">PAUSED / {summary.queued} WAITING</span>;
  if (summary.publishing) return <span className="publication-queue-state">PUBLISHING / {summary.queued} WAITING</span>;
  if (summary.queued) return <span className="publication-queue-state">{summary.queued} WAITING</span>;
  return <span className="publication-queue-state">{summary.published} COMPLETE</span>;
}

export default function PublicationQueue({ items, paused, summary, onRetry, onCancel, onStop, onClear, detailsRef }) {
  if (!items.length) return null;
  return <details ref={detailsRef} id="publication-queue" className={`publication-queue ${paused ? 'is-paused' : ''}`} open={summary.active > 0}>
    <summary>
      <span>PUBLICATION QUEUE</span>
      <QueueStatus summary={summary} paused={paused}/>
    </summary>
    <div className="publication-queue-content">
      <ol>
        {items.map((item, index) => <li className={`is-${item.state}`} key={item.id}>
          <span className="publication-queue-order">{String(index + 1).padStart(2, '0')}</span>
          <span className="publication-queue-copy"><strong>{item.title}</strong><small>{item.slug}</small>{item.errorMessage ? <em>{item.errorMessage}</em> : null}</span>
          <span className="publication-queue-label">{LABELS[item.state]}</span>
          {item.state === 'queued' ? <button type="button" aria-label={`${item.title}を公開キューから外して下書きに残す`} onClick={() => onCancel(item.id)}>KEEP DRAFT</button> : null}
          {item.state === 'error' ? <button type="button" onClick={() => onRetry(item.id)}>RETRY</button> : null}
        </li>)}
      </ol>
      <footer>
        <p>{paused ? '後続の公開を止めました。原稿と未送信画像はLOCAL DRAFTSに残っています。' : '上から順に1件ずつGitHubへコミットします。処理中も別の記事を編集できます。'}</p>
        {paused ? <button type="button" onClick={onStop}>STOP &amp; KEEP DRAFTS</button> : null}
        {!summary.active && summary.published ? <button type="button" onClick={onClear}>CLEAR</button> : null}
      </footer>
    </div>
  </details>;
}
