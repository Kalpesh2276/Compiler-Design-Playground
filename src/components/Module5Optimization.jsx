import React, { useMemo, useState } from 'react';
import { buildBlockDAG, computeReachingDefinitions, computeLiveness } from '../engine/optimizationCFG';
import { formatInstruction } from '../engine/ir';
import { CFGVisualizer, DAGVisualizer } from './Visualizer';
import { Tabs, Listing, Stat } from './ui';
import { LabSource, BlockPicker } from './lab/LabSource';
import { OptimizationView } from './studio/PhaseViews';
import { irLines, cfgDisplay } from './studio/irPresentation';
import { GitBranch, Layers, Activity, HeartPulse, Zap } from 'lucide-react';

export function Module5Optimization() {
  const [tab, setTab] = useState('cfg');
  return (
    <div className="module-wrapper">
      <Tabs
        label="Optimization views"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'cfg', label: 'Basic blocks & CFG', icon: GitBranch },
          { id: 'dag', label: 'DAG of a block', icon: Layers },
          { id: 'reaching', label: 'Reaching definitions', icon: Activity },
          { id: 'liveness', label: 'Live variables', icon: HeartPulse },
          { id: 'optimizer', label: 'Optimizer passes', icon: Zap },
        ]}
      />
      <LabSource initialId="optimizable">
        {(result) => {
          const ir = result.phases.ir.output;
          switch (tab) {
            case 'cfg':
              return <CfgPanel ir={ir} />;
            case 'dag':
              return <DagPanel ir={ir} />;
            case 'reaching':
              return <ReachingPanel ir={ir} />;
            case 'liveness':
              return <LivenessPanel ir={ir} />;
            default:
              return (
                <div className="panel-card">
                  <OptimizationView phase={result.phases.optimization} irPhase={result.phases.ir} />
                </div>
              );
          }
        }}
      </LabSource>
    </div>
  );
}

function CfgPanel({ ir }) {
  const cfg = ir.cfg;
  return (
    <div className="grid-2col">
      <div className="panel-card">
        <h3 className="panel-title">Leaders and basic blocks</h3>
        <p className="explain">
          A <strong>leader</strong> is (1) the first instruction, (2) any jump target (a label), or (3) any instruction right after a jump. Each block
          runs from a leader up to the next leader; control can only enter at the top and leave at the bottom.
        </p>
        <div className="stat-row">
          <Stat label="instructions" value={ir.instructions.length} />
          <Stat label="leaders" value={cfg.leaders.length} />
          <Stat label="blocks" value={cfg.blocks.length} />
          <Stat label="edges" value={cfg.edges.length} />
        </div>
        <Listing
          lines={ir.instructions.map((ins, i) => ({
            text: `${cfg.leaders.includes(i) ? '▶ ' : '  '}${ins.op === 'label' ? formatInstruction(ins) : `  ${formatInstruction(ins)}`}`,
            kind: ins.op === 'label' ? 'label' : undefined,
          }))}
          ariaLabel="Instructions with leaders marked"
        />
        <p className="small muted mt-8">▶ marks a leader.</p>
      </div>
      <div className="panel-card">
        <h3 className="panel-title">Control-flow graph</h3>
        <CFGVisualizer {...cfgDisplay(cfg)} />
      </div>
    </div>
  );
}

function DagPanel({ ir }) {
  const [blockIndex, setBlockIndex] = useState(0);
  const block = ir.cfg.blocks[Math.min(blockIndex, ir.cfg.blocks.length - 1)];
  const dag = useMemo(() => buildBlockDAG(block.instructions), [block]);
  const reused = dag.commonSubexpressions.map((c) => c.reusedNode);
  return (
    <div className="grid-2col">
      <div className="panel-card">
        <div className="row mb-12">
          <h3 className="panel-title" style={{ margin: 0 }}>
            DAG of {block.id}
          </h3>
          <span className="spacer" />
          <BlockPicker cfg={ir.cfg} value={block.index} onChange={setBlockIndex} id="dag-block" />
        </div>
        <DAGVisualizer nodes={dag.dagNodes} highlightIds={reused} />
        <p className="small muted mt-8">
          Boxes are initial values (<code>a0</code>) and constants; circles are operators labelled (in green) with the names holding their value
          at the end of the block. Orange circles have side effects and are never shared.
        </p>
      </div>
      <div className="panel-card">
        <h3 className="panel-title">Block instructions</h3>
        <Listing lines={irLines(block.instructions)} ariaLabel={`Instructions of ${block.id}`} />
        <h4>Common subexpressions found</h4>
        {dag.commonSubexpressions.length === 0 ? (
          <p className="small muted">None in this block – every operator node is new. Try the “Optimization showcase” example, block B1.</p>
        ) : (
          <ul>
            {dag.commonSubexpressions.map((c, i) => (
              <li key={i} className="small">
                <code>{c.instruction}</code> reuses node n{c.reusedNode}
                {c.heldBy.length ? ` (already held by ${c.heldBy.join(', ')})` : ''}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ReachingPanel({ ir }) {
  const rd = useMemo(() => computeReachingDefinitions(ir.cfg), [ir]);
  return (
    <div className="grid-2col">
      <div className="panel-card">
        <h3 className="panel-title">Definitions</h3>
        <p className="explain">
          Every instruction that assigns a name is a definition <code>dN</code>. A definition <em>reaches</em> a point if some path leads from it to
          that point without another assignment to the same name.
        </p>
        <div className="table-wrapper">
          <table className="table-compact">
            <thead>
              <tr>
                <th>Def</th>
                <th>Block</th>
                <th>Instruction</th>
              </tr>
            </thead>
            <tbody>
              {rd.definitions.map((d) => (
                <tr key={d.id}>
                  <td>
                    <strong>{d.id}</strong>
                  </td>
                  <td>{d.block}</td>
                  <td>
                    <code>{d.text}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="panel-card">
        <h3 className="panel-title">GEN, KILL, IN, OUT</h3>
        <pre className="code-block mb-12">{'OUT[B] = GEN[B] ∪ (IN[B] − KILL[B])\nIN[B]  = ∪ OUT[P]  for predecessors P'}</pre>
        <p className="small muted mb-8">Converged after {rd.iterations} iteration(s) in reverse post-order.</p>
        <SetTable rows={rd.blocks} columns={['gen', 'kill', 'in', 'out']} />
      </div>
    </div>
  );
}

function LivenessPanel({ ir }) {
  const live = useMemo(() => computeLiveness(ir.cfg, []), [ir]);
  return (
    <div className="grid-2col">
      <div className="panel-card">
        <h3 className="panel-title">Live variables per block</h3>
        <pre className="code-block mb-12">{'IN[B]  = USE[B] ∪ (OUT[B] − DEF[B])\nOUT[B] = ∪ IN[S]  for successors S'}</pre>
        <p className="small muted mb-8">
          Backward analysis; converged after {live.iterations} iteration(s). USE = read before written in the block. Nothing is live at program exit
          (only output is observable).
        </p>
        <SetTable rows={live.blocks} columns={['use', 'def', 'in', 'out']} />
      </div>
      <div className="panel-card">
        <h3 className="panel-title">Live after each instruction</h3>
        <Listing
          lines={ir.instructions.map((ins, i) => ({
            text: `${(ins.op === 'label' ? formatInstruction(ins) : `  ${formatInstruction(ins)}`).padEnd(28)} ${ins.op === 'label' ? '' : `{${[...(live.liveAfter[i] ?? [])].sort().join(', ')}}`}`,
            kind: ins.op === 'label' ? 'label' : undefined,
          }))}
          ariaLabel="Liveness after each instruction"
        />
        <p className="small muted mt-8">An assignment whose target is not live afterwards is dead code (unless it has a side effect).</p>
      </div>
    </div>
  );
}

function SetTable({ rows, columns }) {
  return (
    <div className="table-wrapper">
      <table className="table-compact">
        <thead>
          <tr>
            <th>Block</th>
            {columns.map((c) => (
              <th key={c}>{c.toUpperCase()}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.blockId}>
              <td>
                <strong>{r.blockId}</strong>
              </td>
              {columns.map((c) => (
                <td key={c} className="mono small">{`{${r[c].join(', ')}}`}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
