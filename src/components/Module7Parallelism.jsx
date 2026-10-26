import React, { useMemo, useState } from 'react';
import { convertToSSA, scheduleInstructions, analyzeLoopVectorization, DEFAULT_LATENCY } from '../engine/parallelismSSA';
import { CFGVisualizer } from './Visualizer';
import { Tabs, Listing, Stat } from './ui';
import { LabSource, BlockPicker } from './lab/LabSource';
import { irLines } from './studio/irPresentation';
import { GitBranch, Layers, Zap, CheckCircle, XCircle } from 'lucide-react';

const LOOP_PRESETS = [
  { label: 'Element-wise add', code: 'for (i = 0; i < N; i++) {\n  A[i] = B[i] + C[i];\n}' },
  { label: 'Recurrence A[i-1]', code: 'for (i = 1; i < N; i++) {\n  A[i] = A[i - 1] + B[i];\n}' },
  { label: 'Distance-4 dependence', code: 'for (i = 0; i < N; i++) {\n  A[i + 4] = A[i] * 2;\n}' },
  { label: 'Forward dependence', code: 'for (i = 1; i < N; i++) {\n  A[i] = B[i] + 1;\n  C[i] = A[i - 1] * 2;\n}' },
  { label: 'Backward dependence', code: 'for (i = 1; i < N; i++) {\n  C[i] = A[i - 1] * 2;\n  A[i] = B[i] + 1;\n}' },
  { label: 'Sum reduction', code: 'for (i = 0; i < N; i++) {\n  s = s + A[i];\n}' },
];

export function Module7Parallelism() {
  const [tab, setTab] = useState('ssa');
  return (
    <div className="module-wrapper">
      <Tabs
        label="Advanced analyses"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'ssa', label: 'SSA form', icon: GitBranch },
          { id: 'schedule', label: 'Instruction scheduling', icon: Layers },
          { id: 'simd', label: 'Loop vectorisation', icon: Zap },
        ]}
      />
      {tab === 'simd' ? (
        <VectorPanel />
      ) : (
        <LabSource initialId="gcd">
          {(result) => (tab === 'ssa' ? <SSAPanel instructions={result.phases.ir.output.instructions} /> : <SchedulePanel cfg={result.phases.optimization.output.cfg} />)}
        </LabSource>
      )}
    </div>
  );
}

function SSAPanel({ instructions }) {
  const ssa = useMemo(() => convertToSSA(instructions), [instructions]);
  if (!ssa.blocks.length) return <div className="info-banner">The program is empty.</div>;
  return (
    <div className="grid-2col">
      <div className="panel-card">
        <h3 className="panel-title">CFG in SSA form</h3>
        <p className="explain">
          Every name is assigned exactly once. Where different definitions of a variable meet, a <strong>φ-function</strong> selects the value from the
          predecessor control came from (arguments are listed in predecessor order).
        </p>
        <div className={`verdict-banner ${ssa.verified ? 'accept' : 'reject'}`}>
          {ssa.verified ? <CheckCircle size={18} /> : <XCircle size={18} />}
          {ssa.verified ? `Verified: every SSA name has exactly one definition · ${ssa.phiCount} φ-function(s)` : 'SSA property violated'}
        </div>
        <CFGVisualizer blocks={ssa.blocks.map((b) => ({ id: b.id, lines: b.lines.map((l) => (l.endsWith(':') ? l : `  ${l}`)) }))} edges={ssa.cfg.edges.filter((e) => e.to === 'EXIT' || ssa.blocks.some((b) => b.id === e.to))} />
      </div>
      <div className="panel-card">
        <h3 className="panel-title">Dominators and dominance frontiers</h3>
        <p className="explain">
          Block D <strong>dominates</strong> B if every path from the entry to B passes through D. The <strong>dominance frontier</strong> of D is where
          D&apos;s dominance ends – exactly where a φ for a variable defined in D may be needed. Immediate dominators are computed with the
          Cooper–Harvey–Kennedy algorithm; φs are placed on the iterated frontier only where the variable is live (pruned SSA).
        </p>
        <div className="table-wrapper">
          <table className="table-compact">
            <thead>
              <tr>
                <th>Block</th>
                <th>idom</th>
                <th>Dominators</th>
                <th>Frontier</th>
              </tr>
            </thead>
            <tbody>
              {ssa.dominators.map((d) => (
                <tr key={d.block}>
                  <td>
                    <strong>{d.block}</strong>
                  </td>
                  <td>{d.idom}</td>
                  <td className="mono small">{`{${d.dominators.join(', ')}}`}</td>
                  <td className="mono small">{`{${d.frontier.join(', ')}}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h4>φ-functions</h4>
        {ssa.phiCount === 0 ? (
          <p className="small muted">None needed – no variable with several definitions is live where control paths merge.</p>
        ) : (
          <ul>
            {ssa.blocks.flatMap((b) =>
              b.phis.map((p) => (
                <li key={`${b.id}-${p.dest}`} className="small">
                  <strong>{b.id}</strong>: <code>{p.dest} = φ({p.args.map((a) => `${a.value} from ${a.from}`).join(', ')})</code>
                </li>
              ))
            )}
          </ul>
        )}
        <p className="small muted">Renamed (multiply-defined) names: {ssa.versioned.join(', ') || 'none'}. Single-definition names keep their original name.</p>
      </div>
    </div>
  );
}

function SchedulePanel({ cfg }) {
  const [blockIndex, setBlockIndex] = useState(() => largestBlock(cfg));
  const [units, setUnits] = useState(2);
  const block = cfg.blocks[Math.min(blockIndex, cfg.blocks.length - 1)];
  const s = useMemo(() => (block ? scheduleInstructions(block.instructions, { units }) : null), [block, units]);
  if (!block) return <div className="info-banner">The optimised program is empty.</div>;
  return (
    <div className="grid-2col">
      <div className="panel-card">
        <div className="row mb-12">
          <BlockPicker cfg={cfg} value={block.index} onChange={setBlockIndex} id="sched-block" />
          <label className="check">
            Issue width
            <select value={units} onChange={(e) => setUnits(Number(e.target.value))}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="explain">
          Latencies: <code>*</code> {DEFAULT_LATENCY['*']} cycles, <code>/ %</code> {DEFAULT_LATENCY['/']} cycles, everything else 1. The list scheduler
          issues up to {units} ready instruction(s) per cycle, choosing the one on the longest remaining (critical) path first.
        </p>
        <div className="stat-row">
          <Stat label="scheduled cycles" value={s.totalCycles} />
          <Stat label="in-order cycles" value={s.sequentialCycles} />
          <Stat label="speed-up" value={s.totalCycles ? `${(s.sequentialCycles / s.totalCycles).toFixed(2)}×` : '—'} />
        </div>
        <div className="table-wrapper">
          <table className="table-compact">
            <thead>
              <tr>
                <th>Cycle</th>
                {Array.from({ length: units }, (_, i) => (
                  <th key={i}>Unit {i}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.schedule.map((row) => (
                <tr key={row.cycle}>
                  <td>{row.cycle}</td>
                  {Array.from({ length: units }, (_, i) => (
                    <td key={i} className="mono small">
                      {row.slots[i]?.text ?? (i === 0 && row.slots.length === 0 ? <span className="muted">stall</span> : '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="panel-card">
        <h3 className="panel-title">Dependence DAG of {block.id}</h3>
        <Listing lines={irLines(block.instructions)} numberFrom={0} ariaLabel={`Instructions of ${block.id}`} />
        <div className="table-wrapper mt-12" style={{ maxHeight: 300, overflow: 'auto' }}>
          <table className="table-compact">
            <thead>
              <tr>
                <th>From</th>
                <th>To</th>
                <th>Type</th>
                <th>Latency</th>
              </tr>
            </thead>
            <tbody>
              {s.edges.map((e, i) => (
                <tr key={i}>
                  <td className="mono small">{s.nodes.find((n) => n.index === e.fromIndex).text}</td>
                  <td className="mono small">{s.nodes.find((n) => n.index === e.toIndex).text}</td>
                  <td>
                    <span className="symbol-tag">{e.type}</span> {e.on}
                  </td>
                  <td>{e.latency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">
          RAW = true dependence; WAR/WAW = name dependences (they only constrain order); I/O keeps input and print in order; the block&apos;s jump
          issues last.
        </p>
      </div>
    </div>
  );
}

function largestBlock(cfg) {
  return cfg.blocks.reduce((best, b) => (b.instructions.length > (cfg.blocks[best]?.instructions.length ?? -1) ? b.index : best), 0);
}

function VectorPanel() {
  const [code, setCode] = useState(LOOP_PRESETS[0].code);
  const [vf, setVf] = useState(4);
  const { result, error } = useMemo(() => {
    try {
      return { result: analyzeLoopVectorization(code, { vectorWidth: vf }), error: '' };
    } catch (e) {
      return { result: null, error: e.message };
    }
  }, [code, vf]);
  return (
    <div className="grid-2col">
      <div className="panel-card">
        <div className="field-group">
          <label htmlFor="loop-code">Loop (subscripts must be i ± constant)</label>
          <textarea id="loop-code" rows={6} value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        <div className="preset-buttons mt-8">
          {LOOP_PRESETS.map((p) => (
            <button key={p.label} className="btn-secondary" onClick={() => setCode(p.code)}>
              {p.label}
            </button>
          ))}
        </div>
        <label className="check mt-12">
          Vector width (lanes)
          <select value={vf} onChange={(e) => setVf(Number(e.target.value))}>
            {[2, 4, 8, 16].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {error && <div className="error-banner">{error}</div>}
        <p className="explain mt-12">
          Vector execution runs each statement for {vf} consecutive iterations before the next statement. That is only correct if no dependence would
          see its order reversed inside such a window. MiniC has no arrays, so this analysis works on its own small loop language.
        </p>
      </div>
      <div className="panel-card">
        {result && (
          <>
            <div className={`verdict-banner ${result.vectorizable ? 'accept' : 'reject'}`}>
              {result.vectorizable ? <CheckCircle size={18} /> : <XCircle size={18} />}
              {result.vectorizable
                ? `Vectorisable with ${result.vectorWidth} lanes (largest legal width: ${result.maxVF === Infinity ? 'unbounded' : result.maxVF})`
                : `Not vectorisable with ${result.vectorWidth} lanes (largest legal width: ${result.maxVF})`}
            </div>
            <h4>Dependences</h4>
            {result.dependences.length === 0 ? (
              <p className="small muted">No two accesses touch the same array element across iterations.</p>
            ) : (
              <div className="table-wrapper">
                <table className="table-compact">
                  <thead>
                    <tr>
                      <th>Accesses</th>
                      <th>Kind</th>
                      <th>Distance</th>
                      <th>Max width</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.dependences.map((d, i) => (
                      <tr key={i}>
                        <td className="small">{d.description}</td>
                        <td>{d.kind}</td>
                        <td>{d.distance}</td>
                        <td>{d.maxVF === Infinity ? 'any' : d.maxVF}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {result.recurrences.length > 0 && (
              <div className="error-banner warning">
                Scalar recurrence: {result.recurrences.map((r) => `${r.variable} in ${r.statement}`).join(', ')} is read and written every iteration.
                Vectorising it would require a reduction transformation (reassociating the sum), which is not performed.
              </div>
            )}
            {result.vectorCode && (
              <>
                <h4>Vectorised (strip-mined) loop</h4>
                <pre className="code-block">{result.vectorCode}</pre>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
