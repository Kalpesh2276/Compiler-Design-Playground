import React, { useMemo, useState } from 'react';
import { evaluateSDT, S_ATTRIBUTED_RULES, L_ATTRIBUTED_RULES } from '../engine/semantics';
import { ParseTreeVisualizer } from './Visualizer';
import { Tabs } from './ui';
import { LabSource } from './lab/LabSource';
import { Sigma, ArrowDownUp, ShieldCheck } from 'lucide-react';

const PRESETS = ['3 + 5 * 2', '(3 + 5) * 2', '20 - 4 - 6', '2 * (3 + 4) / 5'];

export function Module3Semantics() {
  const [expr, setExpr] = useState('3 + 5 * 2');
  const [tab, setTab] = useState('s-attr');

  const { result, error } = useMemo(() => {
    try {
      return { result: evaluateSDT(expr), error: '' };
    } catch (e) {
      return { result: null, error: e.message };
    }
  }, [expr]);

  return (
    <div className="module-wrapper">
      <Tabs
        label="Semantics views"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 's-attr', label: 'S-attributed (bottom-up)', icon: Sigma },
          { id: 'l-attr', label: 'L-attributed (top-down)', icon: ArrowDownUp },
          { id: 'types', label: 'MiniC type checking', icon: ShieldCheck },
        ]}
      />

      {tab !== 'types' && (
        <div className="input-card">
          <div className="field-group">
            <label htmlFor="sdt-expr">Integer expression (+ − * / and parentheses)</label>
            <input id="sdt-expr" type="text" value={expr} onChange={(e) => setExpr(e.target.value)} placeholder="e.g. 3 + 5 * 2" />
          </div>
          <div className="preset-buttons mt-8">
            {PRESETS.map((p) => (
              <button key={p} className="btn-secondary" onClick={() => setExpr(p)}>
                {p}
              </button>
            ))}
          </div>
          {error && <div className="error-banner">{error}</div>}
        </div>
      )}

      {tab === 's-attr' && result && (
        <div className="grid-2col">
          <div className="panel-card">
            <h3 className="panel-title">Annotated parse tree · E.val = {result.evaluatedValue}</h3>
            <p className="explain">
              Parse tree for the left-recursive grammar. Every attribute is <strong>synthesized</strong>: a node&apos;s value depends only on its
              children, so the values can be computed in one bottom-up pass – exactly when an LR parser reduces.
            </p>
            <ParseTreeVisualizer tree={result.annotatedTree} />
          </div>
          <div className="panel-card">
            <h3 className="panel-title">Semantic rules</h3>
            <pre className="code-block">{S_ATTRIBUTED_RULES.join('\n')}</pre>
            <h4>Evaluation order (post-order = order of reductions)</h4>
            <div className="step-logs">
              {result.stepLogs.map((log, i) => (
                <div key={i} className="step-log-item">
                  {i + 1}. {log}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'l-attr' && result && (
        <div className="grid-2col">
          <div className="panel-card">
            <h3 className="panel-title">Annotated parse tree · E.val = {result.lAttributed.value}</h3>
            <p className="explain">
              The same expression parsed with the LL(1) grammar. Because the left recursion is gone, the value computed so far is passed
              <strong> down and to the right</strong> as the inherited attribute <code>inh</code>, and the final result travels back up as the
              synthesized attribute <code>syn</code>.
            </p>
            <ParseTreeVisualizer tree={result.lAttributed.tree} />
          </div>
          <div className="panel-card">
            <h3 className="panel-title">Translation scheme</h3>
            <pre className="code-block">{L_ATTRIBUTED_RULES.join('\n')}</pre>
            <h4>Evaluation order (depth-first, left to right)</h4>
            <div className="step-logs">
              {result.lAttributed.logs.map((log, i) => (
                <div key={i} className="step-log-item">
                  {i + 1}. {log}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'types' && (
        <LabSource initialId="scopes" label="MiniC program" requirePhase="semantic">
          {(r) => <TypeCheckView result={r} />}
        </LabSource>
      )}
    </div>
  );
}

function TypeCheckView({ result }) {
  const sem = result.phases.semantic;
  return (
    <div className="panel-card">
      <h3 className="panel-title">Symbol table from the MiniC semantic analyser</h3>
      <p className="explain">
        Attribute evaluation above is one ingredient of semantic analysis. The Studio&apos;s analyser additionally resolves names through nested
        scopes and type-checks every expression; edit the program to see undeclared names, duplicate declarations and type errors reported.
      </p>
      <div className="table-wrapper">
        <table className="table-compact">
          <thead>
            <tr>
              <th>Name</th>
              <th>Internal name</th>
              <th>Type</th>
              <th>Scope depth</th>
              <th>Declared at</th>
              <th>Reads</th>
            </tr>
          </thead>
          <tbody>
            {sem.output.symbols.map((s) => (
              <tr key={s.id}>
                <td>
                  <strong>{s.name}</strong>
                </td>
                <td>
                  <code>{s.uniqueName}</code>
                </td>
                <td>
                  <span className="symbol-tag">{s.type}</span>
                </td>
                <td>{s.depth}</td>
                <td>
                  {s.declaredAt.line}:{s.declaredAt.col}
                </td>
                <td>{s.references}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sem.diagnostics.length > 0 && (
        <ul className="small">
          {sem.diagnostics.map((d, i) => (
            <li key={i}>
              {d.severity}: {d.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
