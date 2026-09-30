import { useMemo, useState } from 'react';
import { foldStats, resolveFoldBlock } from './folds.js';
import { DATE_TIME } from './traceConfig.js';
import { traceExcerpt } from './traces.js';

function FoldBlock({ block, index, total, trace, resolved, onMove, onRemove, onTogglePin, onUpdateBridge }) {
  if (block.type === 'bridge') {
    return <article className="fold-block is-bridge">
      <header><span>BRIDGE TEXT / {index + 1}</span><div><button disabled={index === 0} onClick={() => onMove(block.id, 'up')}>↑</button><button disabled={index === total - 1} onClick={() => onMove(block.id, 'down')}>↓</button><button onClick={() => onRemove(block.id)}>REMOVE</button></div></header>
      <textarea value={block.content} onChange={event => onUpdateBridge(block.id, event.target.value)} aria-label="Bridge text"/>
    </article>;
  }
  return <article className={`fold-block is-trace ${resolved.missing ? 'is-missing' : ''}`}>
    <header><span>TRACE / {index + 1} / {block.mode.toUpperCase()}</span><div><button disabled={index === 0} onClick={() => onMove(block.id, 'up')}>↑</button><button disabled={index === total - 1} onClick={() => onMove(block.id, 'down')}>↓</button><button disabled={!trace} onClick={() => onTogglePin(block.id, trace)}>{block.mode === 'pinned' ? 'MAKE LIVE' : 'PIN REVISION'}</button><button onClick={() => onRemove(block.id)}>REMOVE</button></div></header>
    <p>{resolved.missing ? `Missing Trace: ${block.traceId}` : resolved.content}</p>
    <footer><span>{block.traceId}</span>{trace ? <time>{DATE_TIME.format(new Date(trace.updatedAt || trace.createdAt))}</time> : null}</footer>
  </article>;
}

export default function FoldStudio({
  folds,
  activeFold,
  activeFoldId,
  setActiveFoldId,
  tracesById,
  selectedTraces,
  selectedTraceIds,
  onToggleTrace,
  onClearSelection,
  onCreateFold,
  onAddSelection,
  onRenameFold,
  onAddBridge,
  onUpdateBridge,
  onMoveBlock,
  onRemoveBlock,
  onTogglePin,
  onDeleteFold,
  onCopyMarkdown,
  onSendToNotes,
  onOpenStream,
  status,
  onExportFolds,
  onImportFolds,
  importRef,
  foldsLoaded
}) {
  const [bridge, setBridge] = useState('');
  const stats = useMemo(() => activeFold ? foldStats(activeFold, tracesById) : null, [activeFold, tracesById]);

  const addBridge = () => {
    if (!bridge.trim()) return;
    onAddBridge(bridge);
    setBridge('');
  };

  return <section className="fold-surface">
    <aside className="fold-library">
      <header><h1>FOLDS</h1><button onClick={onCreateFold}>＋ NEW FOLD</button></header>
      <div className="fold-vault-actions"><button onClick={onExportFolds}>EXPORT FOLDS</button><button onClick={() => importRef.current?.click()}>IMPORT FOLDS</button><input ref={importRef} type="file" accept="application/json" onChange={onImportFolds}/></div>
      <div className="fold-library-list">{!foldsLoaded ? <p>LOADING FOLDS…</p> : folds.length ? folds.map(fold => <button key={fold.id} className={fold.id === activeFoldId ? 'active' : ''} onClick={() => setActiveFoldId(fold.id)}><strong>{fold.title || 'Untitled Fold'}</strong><span>{fold.blocks?.length || 0} BLOCKS</span></button>) : <p>まだFoldはありません。StreamまたはFieldでTraceを選択してください。</p>}</div>
    </aside>

    <main className="fold-editor">
      {activeFold ? <>
        <header className="fold-head">
          <input value={activeFold.title} onChange={event => onRenameFold(event.target.value)} placeholder="Untitled Fold" aria-label="Fold title"/>
          <div><span>{stats.blocks} BLOCKS</span><span>{stats.traceBlocks} TRACES</span><span>{stats.bridgeBlocks} BRIDGES</span><span>{stats.pinned} PINNED</span><span>{stats.characters} CHARACTERS</span>{stats.missing ? <span className="error">{stats.missing} MISSING</span> : null}</div>
        </header>

        <section className="fold-blocks">
          {activeFold.blocks?.length ? activeFold.blocks.map((block, index) => {
            const trace = block.type === 'trace' ? tracesById.get(block.traceId) : null;
            return <FoldBlock
              key={block.id}
              block={block}
              index={index}
              total={activeFold.blocks.length}
              trace={trace}
              resolved={resolveFoldBlock(block, tracesById)}
              onMove={onMoveBlock}
              onRemove={onRemoveBlock}
              onTogglePin={onTogglePin}
              onUpdateBridge={onUpdateBridge}
            />;
          }) : <div className="fold-empty"><strong>EMPTY FOLD</strong><p>右側の選択Traceを追加するか、Bridge Textを書いてください。</p></div>}
        </section>

        <section className="fold-bridge-composer">
          <textarea value={bridge} onChange={event => setBridge(event.target.value)} placeholder="Trace同士を接続する文章、反論、注釈を書く。" aria-label="新しいBridge text"/>
          <button disabled={!bridge.trim()} onClick={addBridge}>ADD BRIDGE TEXT</button>
        </section>

        {status ? <div className="fold-status" aria-live="polite">{status}</div> : null}
        <footer className="fold-actions">
          <button onClick={onCopyMarkdown}>COPY MARKDOWN</button>
          <button onClick={onSendToNotes}>SEND TO LOCAL NOTES DRAFT</button>
          <button className="danger" onClick={() => onDeleteFold(activeFold)}>DELETE FOLD</button>
        </footer>
      </> : <div className="fold-welcome"><h2>TRACE → FOLD</h2><p>断片を複製せず参照し、並べ替え、Bridge Textを加え、必要な箇所だけrevisionを固定する。ここで初めて線形な文章が生まれる。</p><button onClick={onCreateFold}>CREATE FIRST FOLD</button></div>}
    </main>

    <aside className="fold-source">
      <header><h2>SELECTION / {selectedTraceIds.length}</h2><div><button disabled={!selectedTraceIds.length || !activeFold} onClick={onAddSelection}>ADD TO FOLD</button><button disabled={!selectedTraceIds.length} onClick={onClearSelection}>CLEAR</button></div></header>
      <div>{selectedTraces.length ? selectedTraces.map(trace => <button key={trace.id} onClick={() => onToggleTrace(trace.id)}><span>{traceExcerpt(trace, 130)}</span><small>{trace.motifs?.join(' / ') || 'NO MOTIF'}</small></button>) : <p>StreamのSELECT、またはFieldのセルからTraceを選択できます。</p>}</div>
      <button className="fold-open-stream" onClick={onOpenStream}>RETURN TO STREAM</button>
    </aside>
  </section>;
}
