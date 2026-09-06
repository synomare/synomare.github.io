import { useEffect, useMemo, useState } from 'react';
import { buildFieldMatrix, fieldSummary, motifIntersection, relationStats } from './field.js';
import { traceExcerpt } from './traces.js';

function Metric({ value, label }) {
  return <div className="field-metric"><strong>{value}</strong><span>{label}</span></div>;
}

export default function FieldView({
  traces,
  folds,
  motifs,
  selectedTraceIds,
  onToggleTrace,
  onSelectMany,
  onOpenStream
}) {
  const matrix = useMemo(() => buildFieldMatrix(traces), [traces]);
  const summary = useMemo(() => fieldSummary(traces, folds), [traces, folds]);
  const relations = useMemo(() => relationStats(traces), [traces]);
  const [motifA, setMotifA] = useState('');
  const [motifB, setMotifB] = useState('');

  useEffect(() => {
    if (!motifA && motifs[0]?.motif) setMotifA(motifs[0].motif);
    if (!motifB && motifs[1]?.motif) setMotifB(motifs[1].motif);
  }, [motifs, motifA, motifB]);

  const intersection = useMemo(() => motifIntersection(traces, [motifA, motifB].filter(Boolean)), [traces, motifA, motifB]);
  const selected = new Set(selectedTraceIds);

  return <section className="field-surface">
    <header className="field-intro">
      <div><h1>FIELD</h1><p>一つの正しい地図ではなく、同じTraceが時間・Motif・関係・Foldにまたがって反復出現する複数の射影。</p></div>
      <button onClick={() => onOpenStream({ plate: 'stream', motif: '' })}>OPEN STREAM</button>
    </header>

    <div className="field-metrics" aria-label="Field summary">
      <Metric value={summary.traces} label="TRACES"/>
      <Metric value={summary.motifs} label="MOTIFS"/>
      <Metric value={summary.relations} label="RELATIONS"/>
      <Metric value={summary.folds} label="FOLDS"/>
      <Metric value={summary.used} label="USED"/>
      <Metric value={summary.unused} label="UNUSED"/>
      <Metric value={summary.questions} label="QUESTIONS"/>
      <Metric value={summary.revisions} label="REVISIONS"/>
    </div>

    <section className="field-panel field-matrix-panel">
      <header><div><h2>MOTIF × TIME</h2><p>濃度は月内のTrace数。同じTraceは複数のMotif行へ同時に現れる。</p></div><span>{matrix.months.length} MONTHS / {matrix.rows.length} MOTIFS</span></header>
      {matrix.rows.length && matrix.months.length ? <div className="field-matrix-scroll">
        <div className="field-matrix" style={{ '--month-count': matrix.months.length }}>
          <div className="field-matrix-corner">MOTIF</div>
          {matrix.months.map(month => <div className="field-month" key={month}>{month}</div>)}
          {matrix.rows.flatMap(row => [
            <button className="field-motif-label" key={`${row.motif}-label`} onClick={() => onOpenStream({ plate: 'stream', motif: row.motif === '∅ UNPLACED' ? '' : row.motif })}><span>{row.motif}</span><strong>{row.total}</strong></button>,
            ...row.cells.map(cell => <button
              key={`${row.motif}-${cell.month}`}
              className={`field-cell ${cell.ids.some(id => selected.has(id)) ? 'is-selected' : ''}`}
              style={{ '--density': cell.count / matrix.maxCell }}
              disabled={!cell.count}
              title={`${row.motif} / ${cell.month} / ${cell.count} traces`}
              onClick={() => onSelectMany(cell.ids)}
            ><span>{cell.count || ''}</span></button>)
          ])}
        </div>
      </div> : <div className="field-empty">MotifとTraceが増えると、ここに時間断面が現れます。</div>}
    </section>

    <div className="field-columns">
      <section className="field-panel field-overprint">
        <header><div><h2>OVERPRINT</h2><p>二つのMotifを重ね、その両方に現れるTraceだけを抽出する。</p></div><span>{intersection.length} INTERSECTION</span></header>
        <div className="field-overprint-controls">
          <select value={motifA} onChange={event => setMotifA(event.target.value)} aria-label="第一Motif"><option value="">MOTIF A</option>{motifs.map(item => <option key={`a-${item.motif}`} value={item.motif}>{item.motif}</option>)}</select>
          <span>×</span>
          <select value={motifB} onChange={event => setMotifB(event.target.value)} aria-label="第二Motif"><option value="">MOTIF B</option>{motifs.map(item => <option key={`b-${item.motif}`} value={item.motif}>{item.motif}</option>)}</select>
        </div>
        <div className="field-intersection-list">
          {intersection.length ? intersection.map(trace => <button key={trace.id} className={selected.has(trace.id) ? 'is-selected' : ''} onClick={() => onToggleTrace(trace.id)}><span>{traceExcerpt(trace, 140)}</span><small>{trace.motifs.join(' × ')}</small></button>) : <p>この重なりにはまだTraceがありません。</p>}
        </div>
      </section>

      <section className="field-panel field-relations">
        <header><div><h2>RELATION PLATE</h2><p>意味の推定ではなく、実際に行った接続操作の集積。</p></div><span>{relations.total} EDGES</span></header>
        <div>{relations.rows.map(row => <div className="field-relation-row" key={row.value}><span>{row.label}</span><div><i style={{ '--ratio': relations.total ? row.count / relations.total : 0 }}/></div><strong>{row.count}</strong></div>)}</div>
        {relations.unresolved ? <p className="field-unresolved">UNRESOLVED TARGETS / {relations.unresolved}</p> : null}
      </section>
    </div>

    {selectedTraceIds.length ? <footer className="field-selection"><span>{selectedTraceIds.length} TRACES SELECTED ACROSS PLATES</span><button onClick={() => onOpenStream({ plate: 'stream', motif: '' })}>INSPECT IN STREAM</button></footer> : null}
  </section>;
}
