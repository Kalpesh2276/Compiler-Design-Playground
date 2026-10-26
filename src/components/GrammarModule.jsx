import React, { useState, useEffect } from 'react';
import {
  parseGrammar,
  computeFirstSets,
  computeFollowSets,
  eliminateLeftRecursion,
  eliminateLeftFactoring,
  createLL1Table,
  parseStringLL1,
} from '../engine/grammar';
import { ParseTreeVisualizer } from './Visualizer';
import { CheckCircle, AlertTriangle } from 'lucide-react';

const GRAMMAR_PRESETS = [
  {
    name: 'Arithmetic Grammar (Left-Recursive)',
    grammarText: `E -> E + T | T\nT -> T * F | F\nF -> ( E ) | id`,
    testInput: 'id + id * id',
  },
  {
    name: 'LL(1) Arithmetic Grammar (Refactored)',
    grammarText: `E -> T E'\nE' -> + T E' | ε\nT -> F T'\nT' -> * F T' | ε\nF -> ( E ) | id`,
    testInput: 'id + id * id',
  },
  {
    name: 'Dangling Else (Left Factoring needed)',
    grammarText: `S -> i E t S | i E t S e S | a\nE -> b`,
    testInput: 'i b t a',
  },
];

export function GrammarModule() {
  const [grammarText, setGrammarText] = useState(GRAMMAR_PRESETS[1].grammarText);
  const [activeTab, setActiveTab] = useState('first-follow');
  const [testInput, setTestInput] = useState('id + id * id');

  const [parsed, setParsed] = useState(null);
  const [firstRes, setFirstRes] = useState(null);
  const [followRes, setFollowRes] = useState(null);
  const [recursionRes, setRecursionRes] = useState(null);
  const [factoringRes, setFactoringRes] = useState(null);
  const [ll1Res, setLL1Res] = useState(null);
  const [parseStringRes, setParseStringRes] = useState(null);
  const [error, setError] = useState('');

  // Process Grammar on input change
  useEffect(() => {
    try {
      setError('');
      const parsedG = parseGrammar(grammarText);
      setParsed(parsedG);

      const fSets = computeFirstSets(parsedG);
      setFirstRes(fSets);

      const folSets = computeFollowSets(parsedG, fSets.firstSets);
      setFollowRes(folSets);

      const lr = eliminateLeftRecursion(parsedG);
      setRecursionRes(lr);

      const lf = eliminateLeftFactoring(parsedG);
      setFactoringRes(lf);

      const tableRes = createLL1Table(parsedG, fSets.firstSets, folSets.followSets);
      setLL1Res(tableRes);
    } catch (err) {
      setError(err.message || 'Invalid grammar syntax.');
      setParsed(null);
      setFirstRes(null);
      setFollowRes(null);
      setRecursionRes(null);
      setFactoringRes(null);
      setLL1Res(null);
    }
  }, [grammarText]);

  // Run LL(1) Parse Tree simulation on string change
  useEffect(() => {
    if (parsed && ll1Res && testInput) {
      try {
        const res = parseStringLL1(testInput, parsed, ll1Res);
        setParseStringRes(res);
      } catch (e) {
        setParseStringRes(null);
      }
    }
  }, [parsed, ll1Res, testInput]);

  return (
    <div className="module-wrapper">
      {/* Top Input Card */}
      <div className="input-card">
        <div className="input-row">
          <div className="field-group flex-1">
            <label>Context-Free Production Rules (One rule per line)</label>
            <textarea
              rows="5"
              value={grammarText}
              onChange={(e) => setGrammarText(e.target.value)}
              placeholder="e.g. E -> E + T | T"
            />
          </div>

          <div className="field-group">
            <label>Load Example Grammar</label>
            <div className="preset-buttons vertical">
              {GRAMMAR_PRESETS.map((gp, idx) => (
                <button
                  key={`gpreset-${idx}`}
                  className="btn-secondary"
                  onClick={() => {
                    setGrammarText(gp.grammarText);
                    setTestInput(gp.testInput);
                  }}
                >
                  {gp.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}
      </div>

      {/* Sub-tabs */}
      <div className="sub-tabs">
        <button
          className={activeTab === 'first-follow' ? 'sub-tab active' : 'sub-tab'}
          onClick={() => setActiveTab('first-follow')}
        >
          1. FIRST & FOLLOW Sets
        </button>
        <button
          className={activeTab === 'left-recursion' ? 'sub-tab active' : 'sub-tab'}
          onClick={() => setActiveTab('left-recursion')}
        >
          2. Left Recursion Elimination
        </button>
        <button
          className={activeTab === 'left-factoring' ? 'sub-tab active' : 'sub-tab'}
          onClick={() => setActiveTab('left-factoring')}
        >
          3. Left Factoring
        </button>
        <button
          className={activeTab === 'll1-table' ? 'sub-tab active' : 'sub-tab'}
          onClick={() => setActiveTab('ll1-table')}
        >
          4. LL(1) Table & Parse Tree
        </button>
      </div>

      {/* Main Grid View */}
      <div className="grid-2col">
        {/* Left Column */}
        <div className="panel-card">
          {activeTab === 'first-follow' && firstRes && followRes && (
            <div>
              <h3 className="panel-title">FIRST and FOLLOW Set Summary</h3>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Non-Terminal</th>
                      <th>FIRST Set</th>
                      <th>FOLLOW Set</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.nonTerminals.map((nt) => (
                      <tr key={`ff-${nt}`}>
                        <td>
                          <strong>{nt}</strong>
                        </td>
                        <td>{`{ ${firstRes.firstSets[nt]?.join(', ')} }`}</td>
                        <td>{`{ ${followRes.followSets[nt]?.join(', ')} }`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'left-recursion' && recursionRes && (
            <div>
              <h3 className="panel-title">Refactored Grammar (No Left Recursion)</h3>
              <pre className="code-block">{recursionRes.transformedGrammarText}</pre>

              <button
                className="btn-primary mt-12"
                onClick={() => setGrammarText(recursionRes.transformedGrammarText)}
              >
                Apply Transformed Grammar
              </button>
            </div>
          )}

          {activeTab === 'left-factoring' && factoringRes && (
            <div>
              <h3 className="panel-title">Refactored Grammar (Left Factored)</h3>
              <pre className="code-block">{factoringRes.transformedGrammarText}</pre>

              <button
                className="btn-primary mt-12"
                onClick={() => setGrammarText(factoringRes.transformedGrammarText)}
              >
                Apply Transformed Grammar
              </button>
            </div>
          )}

          {activeTab === 'll1-table' && ll1Res && (
            <div>
              <h3 className="panel-title">LL(1) Parsing Table</h3>

              {ll1Res.isLL1 ? (
                <div className="verdict-banner accept mb-12">
                  <CheckCircle size={20} /> Valid LL(1) Grammar (No Parsing Conflicts)
                </div>
              ) : (
                <div className="verdict-banner reject mb-12">
                  <AlertTriangle size={20} /> Non-LL(1) Grammar Detected ({ll1Res.conflicts.length} conflict(s))
                </div>
              )}

              <div className="table-wrapper overflow-x">
                <table>
                  <thead>
                    <tr>
                      <th>NT</th>
                      {ll1Res.columns.map((col) => (
                        <th key={`col-${col}`}>{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.nonTerminals.map((nt) => (
                      <tr key={`ll1-row-${nt}`}>
                        <td>
                          <strong>{nt}</strong>
                        </td>
                        {ll1Res.columns.map((col) => {
                          const cell = ll1Res.table[nt][col];
                          return (
                            <td key={`cell-${nt}-${col}`}>
                              {cell ? <span className="rule-badge">{`${nt} -> ${cell}`}</span> : '-'}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Right Column */}
        <div className="panel-card">
          {activeTab === 'first-follow' && (
            <div>
              <h3 className="panel-title">Computation Logs</h3>
              <h4>FIRST Set Logs</h4>
              <ul className="log-list">
                {firstRes?.stepLogs.map((l, i) => (
                  <li key={`fl-${i}`}>{l}</li>
                ))}
              </ul>

              <h4>FOLLOW Set Logs</h4>
              <ul className="log-list">
                {followRes?.stepLogs.map((l, i) => (
                  <li key={`fol-${i}`}>{l}</li>
                ))}
              </ul>
            </div>
          )}

          {activeTab === 'left-recursion' && recursionRes && (
            <div>
              <h3 className="panel-title">Algorithm Transformation Logs</h3>
              <ul className="log-list">
                {recursionRes.stepLogs.map((l, i) => (
                  <li key={`lrl-${i}`}>{l}</li>
                ))}
              </ul>
            </div>
          )}

          {activeTab === 'left-factoring' && factoringRes && (
            <div>
              <h3 className="panel-title">Algorithm Transformation Logs</h3>
              <ul className="log-list">
                {factoringRes.stepLogs.map((l, i) => (
                  <li key={`lfl-${i}`}>{l}</li>
                ))}
              </ul>
            </div>
          )}

          {activeTab === 'll1-table' && parseStringRes && (
            <div>
              <h3 className="panel-title">Interactive LL(1) String Parser & Parse Tree</h3>
              <div className="field-group mb-12">
                <label>Input Token Sequence (space separated)</label>
                <input
                  type="text"
                  value={testInput}
                  onChange={(e) => setTestInput(e.target.value)}
                  placeholder="e.g. id + id * id"
                />
              </div>

              <h4>Visual Parse Tree</h4>
              <ParseTreeVisualizer tree={parseStringRes.parseTree} />

              <h4>LL(1) Stack Trace</h4>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Step</th>
                      <th>Stack</th>
                      <th>Input Buffer</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parseStringRes.steps.map((st, idx) => (
                      <tr key={`ll-step-${idx}`}>
                        <td>{st.step}</td>
                        <td>
                          <code>{st.stack}</code>
                        </td>
                        <td>
                          <code>{st.input}</code>
                        </td>
                        <td>{st.action}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
