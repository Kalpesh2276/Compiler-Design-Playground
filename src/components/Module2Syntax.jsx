import React, { useMemo, useState } from 'react';
import { buildOperatorPrecedenceMatrix, parseOperatorPrecedence, simulateRecursiveDescent } from '../engine/syntaxEngines';
import { createSLR1Table, parseStringLR } from '../engine/lrParser';
import { ParseTreeVisualizer } from './Visualizer';
import { Tabs } from './ui';
import { Binary, Layers, Table, CheckCircle, XCircle } from 'lucide-react';

const EXPR_GRAMMAR = 'E -> E + T | T\nT -> T * F | F\nF -> ( E ) | id';
const INPUT_PRESETS = ['id + id * id', '( id + id ) * id', 'id * ( id', 'id + + id'];

function Verdict({ ok, yes, no }) {
  return (
    <div className={`verdict-banner ${ok ? 'accept' : 'reject'}`}>
      {ok ? <CheckCircle size={18} /> : <XCircle size={18} />} {ok ? yes : no}
    </div>
  );
}

export function Module2Syntax() {
  const [testInput, setTestInput] = useState('id + id * id');
  const [tab, setTab] = useState('top-down');

  const rd = useMemo(() => simulateRecursiveDescent(testInput), [testInput]);
  const op = useMemo(() => parseOperatorPrecedence(testInput), [testInput]);
  const opMatrix = useMemo(() => buildOperatorPrecedenceMatrix(), []);
  const slr = useMemo(() => createSLR1Table(EXPR_GRAMMAR), []);
  const lr = useMemo(() => parseStringLR(testInput, slr), [testInput, slr]);

  return (
    <div className="module-wrapper">
      <div className="input-card">
        <div className="field-group">
          <label htmlFor="parse-input">Token stream (space separated: id + * ( ))</label>
          <input id="parse-input" type="text" value={testInput} onChange={(e) => setTestInput(e.target.value)} />
        </div>
        <div className="preset-buttons mt-8">
          {INPUT_PRESETS.map((p) => (
            <button key={p} className="btn-secondary" onClick={() => setTestInput(p)}>
              {p}
            </button>
          ))}
        </div>
        <p className="small muted mt-8">
          All three parsers recognise the same expression language. Edit the grammar itself in “Grammars &amp; LL(1)” or “LR(0) items &amp; SLR(1)”.
        </p>
      </div>

      <Tabs
        label="Parsing techniques"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'top-down', label: 'Recursive descent', icon: Binary },
          { id: 'op-precedence', label: 'Operator precedence', icon: Table },
          { id: 'lr', label: 'Bottom-up SLR(1)', icon: Layers },
        ]}
      />

      {tab === 'top-down' && (
        <div className="grid-2col">
          <div className="panel-card">
            <h3 className="panel-title">Call trace</h3>
            <p className="explain">
              One procedure per non-terminal of the LL(1) grammar <code>E → T E&apos;, E&apos; → + T E&apos; | ε, T → F T&apos;, T&apos; → * F T&apos; | ε, F → ( E ) | id</code>.
              The single lookahead token chooses the production.
            </p>
            <div className="step-logs" style={{ maxHeight: 460, whiteSpace: 'pre' }}>
              {rd.trace.map((t, i) => (
                <div key={i} className="step-log-item">
                  {t}
                </div>
              ))}
            </div>
          </div>
          <div className="panel-card">
            <Verdict ok={rd.success} yes="Accepted by recursive descent" no="Rejected (see the last line of the trace)" />
            {rd.tree && <ParseTreeVisualizer tree={rd.tree} />}
          </div>
        </div>
      )}

      {tab === 'op-precedence' && (
        <div className="grid-2col">
          <div className="panel-card">
            <h3 className="panel-title">Precedence relations</h3>
            <p className="explain">
              Row = topmost terminal on the stack, column = next input. ⋖ shift, ≐ shift (same handle), ⋗ reduce. <code>*</code> ⋗ <code>+</code>{' '}
              because * binds tighter; <code>+</code> ⋗ <code>+</code> makes + left-associative.
            </p>
            <div className="table-wrapper">
              <table className="table-compact">
                <thead>
                  <tr>
                    <th>stack \ input</th>
                    {opMatrix.operators.map((o) => (
                      <th key={o}>{o}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {opMatrix.operators.map((a) => (
                    <tr key={a}>
                      <td>
                        <strong>{a}</strong>
                      </td>
                      {opMatrix.operators.map((b) => {
                        const rel = opMatrix.matrix[a][b];
                        const sym = { '<': '⋖', '>': '⋗', '=': '≐', acc: 'acc', err: '' }[rel];
                        return (
                          <td key={b}>{sym && <span className="symbol-tag">{sym}</span>}</td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {op.tree && (
              <>
                <h4>Parse tree</h4>
                <ParseTreeVisualizer tree={op.tree} />
              </>
            )}
          </div>
          <div className="panel-card">
            <Verdict ok={op.success} yes="Accepted by the operator-precedence parser" no="Rejected" />
            <div className="table-wrapper">
              <table className="table-compact">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Stack</th>
                    <th>Input</th>
                    <th>Rel.</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {op.steps.map((s) => (
                    <tr key={s.step}>
                      <td>{s.step}</td>
                      <td className="mono small">{s.stack}</td>
                      <td className="mono small">{s.input}</td>
                      <td>{s.relation}</td>
                      <td className="small">{s.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'lr' && (
        <div className="grid-2col">
          <div className="panel-card">
            <h3 className="panel-title">Shift-reduce trace</h3>
            <p className="explain">
              SLR(1) parser for <code>E → E + T | T, T → T * F | F, F → ( E ) | id</code> ({slr.itemSets.length} LR(0) states). Only SLR(1) is
              implemented; canonical LR(1) and LALR(1) are not.
            </p>
            <div className="table-wrapper" style={{ maxHeight: 460, overflow: 'auto' }}>
              <table className="table-compact">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>States</th>
                    <th>Symbols</th>
                    <th>Input</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {lr.steps.map((s) => (
                    <tr key={s.step}>
                      <td>{s.step}</td>
                      <td className="mono small">{s.stateStack}</td>
                      <td className="mono small">{s.symbolStack}</td>
                      <td className="mono small">{s.input}</td>
                      <td className="small">{s.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="panel-card">
            <Verdict ok={lr.success} yes="Accepted by the SLR(1) parser" no="Rejected" />
            {lr.success && <ParseTreeVisualizer tree={lr.parseTree} />}
          </div>
        </div>
      )}
    </div>
  );
}
