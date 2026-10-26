import React, { useMemo, useState } from 'react';
import { computeNextUse, buildInterferenceGraph, colorInterferenceGraph, generateActivationRecord } from '../engine/codeGenModule6';
import { computeLiveness } from '../engine/optimizationCFG';
import { generateTargetCode } from '../engine/targetCodegen';
import { UndirectedGraph } from './Visualizer';
import { GRAPH_PALETTE } from './graphPalette';
import { Tabs, Listing, Stat } from './ui';
import { LabSource, BlockPicker } from './lab/LabSource';
import { annotatedTargetLines } from './studio/irPresentation';
import { Database, Cpu, Terminal, Layers } from 'lucide-react';

export function Module6CodeGen() {
  const [tab, setTab] = useState('next-use');
  return (
    <div className="module-wrapper">
      <Tabs
        label="Code generation views"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'next-use', label: 'Next-use information', icon: Database },
          { id: 'coloring', label: 'Register allocation (graph colouring)', icon: Cpu },
          { id: 'target', label: 'Target code: naive vs descriptors', icon: Terminal },
          { id: 'frame', label: 'Activation record', icon: Layers },
        ]}
      />
      <LabSource initialId="primes">
        {(result) => {
          // Analyses run on the optimised IR – the same code the target generator sees.
          const instructions = result.phases.optimization.output.instructions;
          const cfg = result.phases.optimization.output.cfg;
          switch (tab) {
            case 'next-use':
              return <NextUsePanel cfg={cfg} />;
            case 'coloring':
              return <ColoringPanel instructions={instructions} />;
            case 'target':
              return <TargetPanel instructions={instructions} />;
            default:
              return <FramePanel result={result} instructions={instructions} />;
          }
        }}
      </LabSource>
    </div>
  );
}

function NextUsePanel({ cfg }) {
  const [blockIndex, setBlockIndex] = useState(0);
  const block = cfg.blocks[Math.min(blockIndex, cfg.blocks.length - 1)];
  const liveness = useMemo(() => computeLiveness(cfg, []), [cfg]);
  if (!block) return <div className="info-banner">The optimised program is empty.</div>;
  const { rows, entry } = computeNextUse(block.instructions, { liveOut: liveness.blocks[block.index].out, startIndex: block.start });
  return (
    <div className="panel-card">
      <div className="row mb-12">
        <h3 className="panel-title" style={{ margin: 0 }}>
          Next-use table for {block.id}
        </h3>
        <span className="spacer" />
        <BlockPicker cfg={cfg} value={block.index} onChange={setBlockIndex} id="nu-block" />
      </div>
      <p className="explain">
        Scanning the block <strong>backwards</strong>: for <code>x = y op z</code> at instruction i, first record what is currently known about x, y
        and z, then mark x dead (no next use) and y, z live with next use i. Names live on exit from the block start as live:{' '}
        <code>{`{${liveness.blocks[block.index].out.join(', ')}}`}</code>. The code generator uses this to decide which register to free.
      </p>
      <div className="table-wrapper">
        <table className="table-compact">
          <thead>
            <tr>
              <th>#</th>
              <th>Instruction</th>
              <th>Name</th>
              <th>Role</th>
              <th>Live after?</th>
              <th>Next use</th>
            </tr>
          </thead>
          <tbody>
            {rows.flatMap((r) =>
              (r.info.length ? r.info : [null]).map((info, k) => (
                <tr key={`${r.index}-${k}`}>
                  {k === 0 && <td rowSpan={Math.max(1, r.info.length)}>{r.index}</td>}
                  {k === 0 && (
                    <td rowSpan={Math.max(1, r.info.length)}>
                      <code>{r.text}</code>
                    </td>
                  )}
                  {info ? (
                    <>
                      <td>
                        <strong>{info.name}</strong>
                      </td>
                      <td>{info.role}</td>
                      <td>
                        <span className={`badge ${info.live ? 'badge-success' : 'badge-danger'}`}>{info.live ? 'live' : 'dead'}</span>
                      </td>
                      <td>{info.nextUse === null ? (info.live ? 'after block' : '—') : `#${info.nextUse}`}</td>
                    </>
                  ) : (
                    <td colSpan={4} className="muted">
                      (no names)
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        At block entry: {entry.filter((e) => e.live).map((e) => `${e.name} (next use ${e.nextUse === null ? 'after block' : `#${e.nextUse}`})`).join(', ') || 'nothing live'}
      </p>
    </div>
  );
}

function ColoringPanel({ instructions }) {
  const [k, setK] = useState(3);
  const graph = useMemo(() => buildInterferenceGraph(instructions), [instructions]);
  const result = useMemo(() => colorInterferenceGraph(graph, k), [graph, k]);
  const colorIndex = Object.fromEntries(Object.entries(result.coloring).filter(([, c]) => c !== null));
  return (
    <div className="grid-2col">
      <div className="panel-card">
        <div className="row mb-12">
          <h3 className="panel-title" style={{ margin: 0 }}>
            Interference graph
          </h3>
          <span className="spacer" />
          <label className="check">
            Registers (k)
            <select value={k} onChange={(e) => setK(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="explain">
          An edge joins two names that are live at the same time (one is defined while the other is live), so they need different registers. A
          copy <code>x = y</code> adds no edge between x and y.
        </p>
        <UndirectedGraph nodes={graph.nodes.map((n) => ({ id: n, dashed: result.coloring[n] === null, sub: result.coloring[n] === null ? 'spill' : `R${result.coloring[n]}` }))} edges={graph.edges} colorIndex={colorIndex} />
        <div className="graph-legend">
          {Array.from({ length: k }, (_, i) => (
            <span key={i}>
              <span className="legend-swatch" style={{ background: GRAPH_PALETTE[i % GRAPH_PALETTE.length] }} />R{i}
            </span>
          ))}
          <span>dashed = spilled to memory</span>
        </div>
      </div>
      <div className="panel-card">
        <h3 className="panel-title">Simplify / select</h3>
        <div className="stat-row">
          <Stat label="names" value={graph.nodes.length} />
          <Stat label="edges" value={graph.edges.length} />
          <Stat label="registers used" value={result.colorsUsed} />
          <Stat label="spilled" value={result.spilled.length} />
        </div>
        <div className="step-logs" style={{ maxHeight: 360 }}>
          {result.log.map((l, i) => (
            <div key={i} className="step-log-item">
              {l}
            </div>
          ))}
        </div>
        <p className="small muted mt-8">
          This global allocator is shown for comparison. The Studio emits code with the block-local register-descriptor allocator (Dragon Book
          §8.6), which reloads values at block boundaries instead.
        </p>
      </div>
    </div>
  );
}

function TargetPanel({ instructions }) {
  const [registers, setRegisters] = useState(4);
  const variants = useMemo(
    () => ['naive', 'local'].map((strategy) => ({ strategy, ...generateTargetCode(instructions, { strategy, registerCount: registers }) })),
    [instructions, registers]
  );
  return (
    <div className="module-wrapper">
      <div className="row">
        <label className="check">
          Registers
          <select value={registers} onChange={(e) => setRegisters(Number(e.target.value))}>
            {[3, 4, 6, 8].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid-2col">
        {variants.map((v) => (
          <div key={v.strategy} className="panel-card">
            <h3 className="panel-title">{v.strategy === 'naive' ? 'Naive: load/compute/store per instruction' : 'Register & address descriptors'}</h3>
            <div className="stat-row">
              <Stat label="instructions" value={v.code.filter((c) => c.op !== 'LABEL').length} />
              <Stat label="loads" value={v.stats.loads} />
              <Stat label="stores" value={v.stats.stores} />
              <Stat label="spills" value={v.stats.spills} />
            </div>
            <Listing lines={annotatedTargetLines(v.code, instructions)} ariaLabel={`${v.strategy} target code`} />
          </div>
        ))}
      </div>
    </div>
  );
}

function FramePanel({ result, instructions }) {
  const vars = result.phases.ir.output.variables;
  // Temporaries that must live in memory: those live across a basic-block boundary.
  const liveness = computeLiveness(result.phases.optimization.output.cfg, []);
  const crossBlockTemps = [...new Set(liveness.blocks.flatMap((b) => b.out))].filter((n) => !vars.some((v) => v.name === n));
  const usedNames = new Set(instructions.flatMap((ins) => [ins.dest?.name, ins.src?.name, ins.left?.name, ins.right?.name]).filter(Boolean));
  const record = generateActivationRecord({ variables: vars.filter((v) => usedNames.has(v.name)), spillTemps: crossBlockTemps });
  return (
    <div className="grid-2col">
      <div className="panel-card">
        <h3 className="panel-title">Stack frame of {record.funcName}()</h3>
        <div className="table-wrapper">
          <table className="table-compact">
            <thead>
              <tr>
                <th>FP offset</th>
                <th>Field</th>
                <th>Bytes</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {record.stackFrame.map((r, i) => (
                <tr key={i}>
                  <td>
                    <code>{r.offset}</code>
                  </td>
                  <td>
                    <strong>{r.field}</strong>
                  </td>
                  <td>{r.size}</td>
                  <td className="small">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">Frame size: {record.frameSize} bytes ({record.wordSize}-byte words).</p>
      </div>
      <div className="panel-card">
        <h3 className="panel-title">How to read this</h3>
        <ul>
          <li>The caller pushes the return address; the callee saves the caller&apos;s frame pointer (control link) and sets FP to point at it.</li>
          <li>Locals of the optimised program get fixed negative offsets, so a variable is addressed as <code>offset(FP)</code>.</li>
          <li>Temporaries that are live across basic-block boundaries need memory too (spill slots); block-local temporaries stay in registers.</li>
        </ul>
        <div className="info-banner mt-12">
          MiniC has no functions and the virtual CPU addresses memory by name, so this is the layout these variables <em>would</em> have under a
          conventional stack-based calling convention – it is derived from the program, but not used by the CPU.
        </div>
      </div>
    </div>
  );
}
