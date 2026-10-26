// Inspector panels for each compilation phase. Every view renders the structured output
// of the actual compile() run it receives – nothing here is pre-written.
import React, { useMemo, useState } from 'react';
import { CheckCircle, AlertTriangle, ListTree, Network, BookOpen, Table, Code, GitBranch, Layers, Cpu } from 'lucide-react';
import { ParseTreeVisualizer, CFGVisualizer } from '../Visualizer';
import { Tabs, Listing, Stat, Empty } from '../ui';
import { toDisplayTree, nodeLabel, countNodes } from './astPresentation';
import { astChildren } from '../../engine/parser.js';
import { formatInstruction } from '../../engine/ir.js';
import { ISA } from '../../engine/virtualCPU.js';
import { PASS_DESCRIPTIONS } from '../../engine/optimizer.js';
import { irLines, cfgDisplay, annotatedTargetLines } from './irPresentation';
import { GRAMMAR_EBNF, LEXICAL_RULES, SEMANTIC_RULES } from '../../pipeline/language.js';

const TOKEN_COLORS = { KEYWORD: 'token-keyword', IDENTIFIER: 'token-identifier', NUMBER: 'token-number', OPERATOR: 'token-operator' };

// ------------------------------------------------------------------ lexical
export function LexicalView({ phase, onSelectSpan }) {
  const { tokens } = phase.output;
  const counts = tokens.reduce((acc, t) => ({ ...acc, [t.type]: (acc[t.type] || 0) + 1 }), {});
  return (
    <div>
      <p className="explain">
        The scanner reads characters left to right and, at each position, applies the first matching pattern of the MiniC
        lexical specification (comments and multi-character operators come first). Whitespace and comments are discarded.
      </p>
      <div className="stat-row">
        <Stat label="tokens" value={tokens.length} />
        {Object.entries(counts).map(([type, n]) => (
          <Stat key={type} label={type.toLowerCase()} value={n} />
        ))}
      </div>
      <div className="token-grid mb-16" aria-label="Token stream">
        {tokens.map((t, i) => (
          <button
            key={i}
            className={`token-badge ${TOKEN_COLORS[t.type] ?? ''}`}
            onClick={() => onSelectSpan(t)}
            title={`Line ${t.line}, column ${t.col}`}
            style={{ cursor: 'pointer', color: 'inherit' }}
          >
            <span className="token-type">{t.type}</span>
            <span className="token-val">{t.value}</span>
            <span className="token-pos">
              {t.line}:{t.col}
            </span>
          </button>
        ))}
      </div>
      <details className="options">
        <summary>Lexical rules</summary>
        <pre className="code-block">{LEXICAL_RULES}</pre>
      </details>
    </div>
  );
}

// ------------------------------------------------------------------ syntax
function AstOutline({ node, types, onSelectSpan }) {
  const kids = astChildren(node);
  const t = types?.get(node.id);
  return (
    <li>
      <button className="ast-node-btn" onClick={() => onSelectSpan(node.span)}>
        <span className="ast-kind">{node.kind}</span> {node.kind !== 'Program' && <span>{nodeLabel(node)}</span>}
        {t && <span className="ast-type"> : {t}</span>} <span className="ast-pos">@{node.span.line}:{node.span.col}</span>
      </button>
      {kids.length > 0 && (
        <ul>
          {kids.map((k) => (
            <AstOutline key={k.id} node={k} types={types} onSelectSpan={onSelectSpan} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function SyntaxView({ phase, onSelectSpan }) {
  const [tab, setTab] = useState('tree');
  const ast = phase.output?.ast;
  const tree = useMemo(() => (ast ? toDisplayTree(ast) : null), [ast]);
  if (!ast) return <Empty>No syntax tree.</Empty>;
  return (
    <div>
      <p className="explain">
        A <strong>recursive-descent parser</strong> with one function per grammar rule builds the abstract syntax tree. Each
        binary-operator precedence level is a loop, which makes operators left-associative. After a syntax error the parser
        skips to the next <code>;</code> or <code>{'}'}</code> (panic-mode recovery) so several errors can be reported at once.
      </p>
      {phase.status === 'error' && (
        <div className="error-banner warning mb-12">The tree below contains only the statements that parsed successfully.</div>
      )}
      <Tabs
        label="Syntax views"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'tree', label: 'AST diagram', icon: Network },
          { id: 'outline', label: 'Outline', icon: ListTree },
          { id: 'grammar', label: 'Grammar', icon: BookOpen },
        ]}
      />
      <div className="mt-12">
        {tab === 'tree' && <ParseTreeVisualizer tree={tree} />}
        {tab === 'outline' && (
          <div className="ast-tree">
            <ul>
              <AstOutline node={ast} onSelectSpan={onSelectSpan} />
            </ul>
          </div>
        )}
        {tab === 'grammar' && <pre className="code-block">{GRAMMAR_EBNF}</pre>}
      </div>
      <p className="small muted mt-8">{countNodes(ast)} AST nodes.</p>
    </div>
  );
}

// ------------------------------------------------------------------ semantic
export function SemanticView({ phase, ast, onSelectSpan }) {
  const [tab, setTab] = useState('symbols');
  const out = phase.output;
  const typedTree = useMemo(() => (out && ast ? toDisplayTree(ast, out.types) : null), [out, ast]);
  if (!out) return <Empty>No semantic information.</Empty>;
  const scopeName = (id) => {
    const s = out.scopes[id];
    return s.kind === 'global' ? 'global' : `block @${s.span.line}`;
  };
  return (
    <div>
      <p className="explain">
        Names are resolved through a stack of scopes (one per <code>{'{ }'}</code> block) and every expression is given a type
        (<code>int</code> or <code>bool</code>). Shadowed variables receive a unique internal name so that later phases can
        treat all variables as globals.
      </p>
      <Tabs
        label="Semantic views"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'symbols', label: 'Symbol table', icon: Table },
          { id: 'typed', label: 'Annotated AST', icon: Network },
          { id: 'rules', label: 'Checks performed', icon: BookOpen },
        ]}
      />
      <div className="mt-12">
        {tab === 'symbols' && (
          <div className="table-wrapper">
            {out.symbols.length === 0 ? (
              <Empty>No variables declared.</Empty>
            ) : (
              <table className="table-compact">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Internal name</th>
                    <th>Type</th>
                    <th>Scope</th>
                    <th>Depth</th>
                    <th>Declared</th>
                    <th>Reads</th>
                    <th>Writes</th>
                  </tr>
                </thead>
                <tbody>
                  {out.symbols.map((s) => (
                    <tr key={s.id} onClick={() => onSelectSpan(s.declaredAt)} style={{ cursor: 'pointer' }}>
                      <td>
                        <strong>{s.name}</strong>
                      </td>
                      <td>
                        <code>{s.uniqueName}</code>
                      </td>
                      <td>
                        <span className="symbol-tag">{s.type}</span>
                      </td>
                      <td>{scopeName(s.scopeId)}</td>
                      <td>{s.depth}</td>
                      <td>
                        {s.declaredAt.line}:{s.declaredAt.col}
                      </td>
                      <td>{s.references}</td>
                      <td>{s.assignments}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
        {tab === 'typed' && <ParseTreeVisualizer tree={typedTree} />}
        {tab === 'rules' && (
          <ul>
            {SEMANTIC_RULES.map((r) => (
              <li key={r} className="small">
                {r}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ IR
export function IRView({ phase }) {
  const [tab, setTab] = useState('tac');
  const out = phase.output;
  if (!out) return <Empty>No intermediate code.</Empty>;
  return (
    <div>
      <p className="explain">
        Syntax-directed translation turns the typed AST into <strong>three-address code</strong>. Conditions use{' '}
        <strong>jumping code</strong>: <code>&amp;&amp;</code> and <code>||</code> short-circuit through branches, and
        <code> if</code>/<code>while</code> branch on the negated test so the true case falls through.
      </p>
      <div className="stat-row">
        <Stat label="instructions" value={out.instructions.length} />
        <Stat label="temporaries" value={out.temps.length} />
        <Stat label="labels" value={out.labels.length} />
        <Stat label="basic blocks" value={out.cfg.blocks.length} />
      </div>
      <Tabs
        label="IR views"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'tac', label: 'Three-address code', icon: Code },
          { id: 'quads', label: 'Quadruples', icon: Table },
          { id: 'triples', label: 'Triples', icon: Table },
          { id: 'indirect', label: 'Indirect triples', icon: Layers },
          { id: 'cfg', label: 'Basic blocks & CFG', icon: GitBranch },
        ]}
      />
      <div className="mt-12">
        {tab === 'tac' && <Listing lines={irLines(out.instructions)} ariaLabel="Three-address code" />}
        {tab === 'quads' && <QuadTable quads={out.quadruples} />}
        {tab === 'triples' && <TripleTable triples={out.triples} />}
        {tab === 'indirect' && (
          <div className="grid-2col gap-12">
            <div className="table-wrapper">
              <table className="table-compact">
                <thead>
                  <tr>
                    <th>Statement</th>
                    <th>Points to</th>
                  </tr>
                </thead>
                <tbody>
                  {out.indirectTriples.statements.map((s) => (
                    <tr key={s.position}>
                      <td>{s.position}</td>
                      <td>({s.pointsTo})</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TripleTable triples={out.triples} />
          </div>
        )}
        {tab === 'cfg' && <CFGVisualizer {...cfgDisplay(out.cfg)} />}
      </div>
    </div>
  );
}

export function QuadTable({ quads }) {
  return (
    <div className="table-wrapper">
      <table className="table-compact">
        <thead>
          <tr>
            <th>#</th>
            <th>op</th>
            <th>arg1</th>
            <th>arg2</th>
            <th>result</th>
          </tr>
        </thead>
        <tbody>
          {quads.map((q, i) => (
            <tr key={i}>
              <td>{i}</td>
              <td>
                <span className="symbol-tag">{q.op}</span>
              </td>
              <td>{q.arg1}</td>
              <td>{q.arg2}</td>
              <td>
                <strong>{q.result}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TripleTable({ triples }) {
  return (
    <div className="table-wrapper">
      <table className="table-compact">
        <thead>
          <tr>
            <th>#</th>
            <th>op</th>
            <th>arg1</th>
            <th>arg2</th>
          </tr>
        </thead>
        <tbody>
          {triples.map((t) => (
            <tr key={t.index}>
              <td>({t.index})</td>
              <td>
                <span className="symbol-tag">{t.op}</span>
              </td>
              <td>{t.arg1}</td>
              <td>{t.arg2}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ optimization
export function OptimizationView({ phase, irPhase }) {
  const [tab, setTab] = useState('compare');
  const out = phase.output;
  if (!out) return <Empty>No optimisation result.</Empty>;
  if (!out.enabled) {
    return <div className="info-banner">{phase.note}</div>;
  }
  const eq = out.equivalence;
  return (
    <div>
      <p className="explain">
        Passes run repeatedly until nothing changes: global constant propagation &amp; folding (data-flow over the CFG), local copy
        propagation, local common-subexpression elimination, liveness-based dead-code elimination and control-flow cleanup.
        Instructions with side effects (<code>input</code>, <code>print</code>, branches, possibly-trapping division) are never removed.
      </p>
      <div className={`verdict-banner ${eq.equal ? 'accept' : 'reject'}`}>
        {eq.equal ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
        {eq.equal
          ? `Validated: original and optimised IR produce the same result for inputs [${eq.inputs.join(', ')}] (${eq.original.status === 'error' ? `both stop with ${eq.original.error.kind}` : `output: ${eq.original.output.join(', ') || 'none'}`}).`
          : `Mismatch: ${eq.difference}`}
      </div>
      <p className="small muted mb-12">Checked by running both versions on the current inputs – evidence for this run, not a proof for all inputs.</p>
      <div className="stat-row">
        <Stat label="before" value={out.before} />
        <Stat label="after" value={out.after} />
        <Stat label="rounds" value={out.rounds} />
        {Object.entries(out.stats).map(([pass, n]) => (
          <Stat key={pass} label={pass.replace(/([A-Z])/g, ' $1').toLowerCase()} value={n} />
        ))}
      </div>
      <Tabs
        label="Optimisation views"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'compare', label: 'Before / after', icon: Code },
          { id: 'log', label: `Transformations (${out.log.length})`, icon: ListTree },
          { id: 'cfg', label: 'Optimised CFG', icon: GitBranch },
        ]}
      />
      <div className="mt-12">
        {tab === 'compare' && (
          <div className="grid-2col gap-12">
            <div>
              <label>Original TAC</label>
              <Listing lines={irLines(irPhase.output.instructions)} ariaLabel="Original IR" />
            </div>
            <div>
              <label>Optimised TAC</label>
              <Listing lines={irLines(out.instructions)} ariaLabel="Optimised IR" />
            </div>
          </div>
        )}
        {tab === 'log' &&
          (out.log.length === 0 ? (
            <Empty>No transformation applied – the program was already optimal for these passes.</Empty>
          ) : (
            <div className="table-wrapper" style={{ maxHeight: 460, overflow: 'auto' }}>
              <table className="table-compact">
                <thead>
                  <tr>
                    <th>Round</th>
                    <th>Pass</th>
                    <th>What happened</th>
                    <th>Before</th>
                    <th>After</th>
                  </tr>
                </thead>
                <tbody>
                  {out.log.map((e, i) => (
                    <tr key={i}>
                      <td>{e.round}</td>
                      <td title={PASS_DESCRIPTIONS[e.pass]}>
                        <span className="symbol-tag">{e.pass}</span>
                      </td>
                      <td>{e.action}</td>
                      <td>
                        <code>{e.before}</code>
                      </td>
                      <td>
                        <code className={e.after === '(removed)' ? 'text-muted' : 'text-success'}>{e.after}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        {tab === 'cfg' && <CFGVisualizer {...cfgDisplay(out.cfg)} />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ codegen
export function CodegenView({ phase }) {
  const [tab, setTab] = useState('listing');
  const out = phase.output;
  if (!out) return <Empty>No target code.</Empty>;
  const executable = out.code.filter((c) => c.op !== 'LABEL').length;
  return (
    <div>
      <p className="explain">
        {out.strategy === 'local' ? (
          <>
            The <strong>simple code generator</strong> (Dragon Book §8.6) keeps register and address descriptors per basic block,
            reuses values already in registers and, when all {out.registerCount} registers are busy, spills the one whose value is
            needed furthest in the future (next-use). Live values are stored back at the end of every block.
          </>
        ) : (
          <>
            The <strong>naive</strong> strategy loads every operand from memory and stores every result immediately – a baseline to
            compare with the register-descriptor strategy.
          </>
        )}
      </p>
      <div className="stat-row">
        <Stat label="instructions" value={executable} />
        <Stat label="loads" value={out.stats.loads} />
        <Stat label="stores" value={out.stats.stores} />
        <Stat label="immediates" value={out.stats.immediates} />
        <Stat label="spills" value={out.stats.spills} />
        <Stat label="registers" value={out.registerCount} />
      </div>
      <Tabs
        label="Code generation views"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'listing', label: 'Annotated assembly', icon: Code },
          { id: 'alloc', label: 'Register decisions', icon: Cpu },
          { id: 'isa', label: 'Instruction set', icon: BookOpen },
        ]}
      />
      <div className="mt-12">
        {tab === 'listing' && <Listing lines={annotatedTargetLines(out.code, out.fromIR)} ariaLabel="Target assembly" />}
        {tab === 'alloc' &&
          (out.allocationLog.length === 0 ? (
            <Empty>The naive strategy makes no allocation decisions.</Empty>
          ) : (
            <div className="table-wrapper" style={{ maxHeight: 460, overflow: 'auto' }}>
              <table className="table-compact">
                <thead>
                  <tr>
                    <th>IR #</th>
                    <th>IR instruction</th>
                    <th>Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {out.allocationLog.map((e, i) => (
                    <tr key={i}>
                      <td>{e.irIndex}</td>
                      <td>
                        <code>{out.fromIR[e.irIndex] ? formatInstruction(out.fromIR[e.irIndex]) : ''}</code>
                      </td>
                      <td className={e.event.startsWith('spill') ? 'text-warning' : ''}>{e.event}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        {tab === 'isa' && <ISATable />}
      </div>
    </div>
  );
}

export function ISATable() {
  return (
    <div className="table-wrapper">
      <table className="table-compact">
        <thead>
          <tr>
            <th>Opcode</th>
            <th>Operands</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(ISA).map(([op, spec]) => (
            <tr key={op}>
              <td>
                <code>{op}</code>
              </td>
              <td className="mono small">{spec.sig.split('').map((c) => ({ R: 'reg', I: '#imm', M: 'mem', L: 'label' })[c]).join(', ') || '—'}</td>
              <td>{spec.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
