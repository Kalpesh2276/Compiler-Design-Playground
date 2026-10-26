import React, { useState, useEffect } from 'react';
import { createSLR1Table, parseStringLR, itemToString, rhsToString } from '../engine/lrParser';
import { ItemSetVisualizer, ParseTreeVisualizer } from './Visualizer';
import { Layers, Table, Play, Pause, RotateCcw, AlertTriangle } from 'lucide-react';

const LR_PRESETS = [
  {
    name: 'SLR(1) Expression Grammar',
    grammarText: `E -> E + T | T\nT -> T * F | F\nF -> ( E ) | id`,
    testInput: 'id + id * id',
  },
  {
    name: 'Simple Parentheses Grammar',
    grammarText: `S -> ( S ) | a`,
    testInput: '( ( a ) )',
  },
];

export function LRParserModule() {
  const [grammarText, setGrammarText] = useState(LR_PRESETS[0].grammarText);
  const [testInput, setTestInput] = useState(LR_PRESETS[0].testInput);
  const [activeTab, setActiveTab] = useState('item-sets');

  const [slrRes, setSlrRes] = useState(null);
  const [parseRes, setParseRes] = useState(null);
  const [error, setError] = useState('');

  // Simulation step state
  const [simStep, setSimStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    try {
      setError('');
      const res = createSLR1Table(grammarText);
      setSlrRes(res);
    } catch (err) {
      setError(err.message || 'Invalid LR grammar syntax.');
      setSlrRes(null);
    }
  }, [grammarText]);

  useEffect(() => {
    if (slrRes && testInput) {
      try {
        const res = parseStringLR(testInput, slrRes);
        setParseRes(res);
        setSimStep(0);
        setIsPlaying(false);
      } catch (err) {
        setParseRes(null);
      }
    }
  }, [slrRes, testInput]);

  useEffect(() => {
    let interval = null;
    if (isPlaying && parseRes && parseRes.steps.length > 0) {
      interval = setInterval(() => {
        setSimStep((prev) => {
          if (prev < parseRes.steps.length - 1) return prev + 1;
          setIsPlaying(false);
          return prev;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying, parseRes]);

  const currentStepData = parseRes?.steps[simStep] || null;

  return (
    <div className="module-wrapper">
      {/* Top Input Card */}
      <div className="input-card">
        <div className="input-row">
          <div className="field-group flex-1">
            <label>Context-Free Production Rules</label>
            <textarea
              rows="5"
              value={grammarText}
              onChange={(e) => setGrammarText(e.target.value)}
              placeholder="e.g. E -> E + T | T"
            />
          </div>

          <div className="field-group">
            <label>Load LR Example Preset</label>
            <div className="preset-buttons vertical">
              {LR_PRESETS.map((preset, idx) => (
                <button
                  key={`lr-preset-${idx}`}
                  className="btn-secondary"
                  onClick={() => {
                    setGrammarText(preset.grammarText);
                    setTestInput(preset.testInput);
                  }}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}

        {slrRes && slrRes.conflicts.length > 0 && (
          <div className="error-banner warning">
            <AlertTriangle size={16} /> Conflicts Detected (Not SLR(1)):{' '}
            {slrRes.conflicts.join(' | ')}
          </div>
        )}
      </div>

      {/* Sub Tabs */}
      <div className="sub-tabs">
        <button
          className={activeTab === 'item-sets' ? 'sub-tab active' : 'sub-tab'}
          onClick={() => setActiveTab('item-sets')}
        >
          <Layers size={16} /> 1. Canonical Item Sets ($I_0..I_n$)
        </button>
        <button
          className={activeTab === 'action-goto' ? 'sub-tab active' : 'sub-tab'}
          onClick={() => setActiveTab('action-goto')}
        >
          <Table size={16} /> 2. SLR(1) Action & Goto Table
        </button>
        <button
          className={activeTab === 'shift-reduce' ? 'sub-tab active' : 'sub-tab'}
          onClick={() => setActiveTab('shift-reduce')}
        >
          <Play size={16} /> 3. Shift-Reduce Parser Trace
        </button>
      </div>

      {/* Grid Content */}
      {slrRes && (
        <div className="grid-2col">
          {/* Left Column */}
          <div className="panel-card">
            {activeTab === 'item-sets' && (
              <div>
                <h3 className="panel-title">Item Set Transition Diagram</h3>
                <ItemSetVisualizer
                  itemSets={slrRes.itemSets}
                  gotoTransitions={slrRes.gotoTransitions}
                />
              </div>
            )}

            {activeTab === 'action-goto' && (
              <div>
                <h3 className="panel-title">SLR(1) Parsing Table Overview</h3>
                <div className="meta-badge-row">
                  <span className={`badge ${slrRes.isSLR1 ? 'badge-success' : 'badge-danger'}`}>
                    {slrRes.isSLR1 ? 'Valid SLR(1) Grammar' : 'Has Conflicts'}
                  </span>
                  <span className="badge">States: {slrRes.itemSets.length}</span>
                </div>

                <div className="table-wrapper mt-12">
                  <table className="lr-table">
                    <thead>
                      <tr>
                        <th rowSpan="2">State</th>
                        <th colSpan={slrRes.terminalCols.length}>ACTION</th>
                        <th colSpan={slrRes.nonTerminalCols.length}>GOTO</th>
                      </tr>
                      <tr>
                        {slrRes.terminalCols.map((t) => (
                          <th key={`th-act-${t}`}>{t}</th>
                        ))}
                        {slrRes.nonTerminalCols.map((nt) => (
                          <th key={`th-goto-${nt}`}>{nt}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {slrRes.itemSets.map((_, stateIdx) => (
                        <tr key={`lr-row-${stateIdx}`}>
                          <td>
                            <strong>I{stateIdx}</strong>
                          </td>
                          {slrRes.terminalCols.map((t) => {
                            const actList = slrRes.actionTable[stateIdx][t] || [];
                            return (
                              <td key={`act-${stateIdx}-${t}`}>
                                {actList.map((a, i) => (
                                  <span
                                    key={i}
                                    className={`action-tag ${
                                      a.startsWith('S')
                                        ? 'act-shift'
                                        : a.startsWith('R')
                                        ? 'act-reduce'
                                        : 'act-acc'
                                    }`}
                                  >
                                    {a}
                                  </span>
                                ))}
                              </td>
                            );
                          })}
                          {slrRes.nonTerminalCols.map((nt) => {
                            const gState = slrRes.gotoTable[stateIdx][nt];
                            return (
                              <td key={`goto-${stateIdx}-${nt}`}>
                                {gState !== null ? `I${gState}` : '-'}
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

            {activeTab === 'shift-reduce' && parseRes && (
              <div>
                <h3 className="panel-title">Parse Tree Result</h3>
                {parseRes.success ? (
                  <ParseTreeVisualizer tree={parseRes.parseTree} />
                ) : (
                  <div className="placeholder-text">Parsing failed. Parse tree not available.</div>
                )}
              </div>
            )}
          </div>

          {/* Right Column */}
          <div className="panel-card">
            {activeTab === 'item-sets' && (
              <div>
                <h3 className="panel-title">Item Set Definitions</h3>
                <div className="item-sets-list">
                  {slrRes.itemSets.map((itemSet, sIdx) => (
                    <div key={`itemset-card-${sIdx}`} className="itemset-card">
                      <h4>State I{sIdx}</h4>
                      <ul>
                        {itemSet.map((item, itIdx) => (
                          <li key={`it-${sIdx}-${itIdx}`}>{itemToString(item)}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'action-goto' && (
              <div>
                <h3 className="panel-title">Production Rules Index</h3>
                <ol className="rules-list">
                  {slrRes.grammar.productions.map((p, idx) => (
                    <li key={`rule-idx-${idx}`}>
                      <span className="rule-idx">[{idx}]</span> {p.lhs} -&gt; {rhsToString(p.rhs)}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {activeTab === 'shift-reduce' && (
              <div>
                <h3 className="panel-title">Shift-Reduce Execution Trace</h3>

                <div className="input-group-inline mb-12">
                  <label>Test Input Token Sequence</label>
                  <input
                    type="text"
                    value={testInput}
                    onChange={(e) => setTestInput(e.target.value)}
                    placeholder="e.g. id + id * id"
                  />
                </div>

                {parseRes && (
                  <div>
                    <div className="playback-controls mb-12">
                      <button
                        className="btn-primary"
                        onClick={() => setIsPlaying(!isPlaying)}
                      >
                        {isPlaying ? <Pause size={16} /> : <Play size={16} />}{' '}
                        {isPlaying ? 'Pause' : 'Play Simulation'}
                      </button>
                      <button
                        className="btn-secondary"
                        onClick={() => {
                          setSimStep((s) => Math.min(s + 1, parseRes.steps.length - 1));
                          setIsPlaying(false);
                        }}
                      >
                        Step Next
                      </button>
                      <button
                        className="btn-secondary"
                        onClick={() => {
                          setSimStep(0);
                          setIsPlaying(false);
                        }}
                      >
                        <RotateCcw size={16} /> Reset
                      </button>
                    </div>

                    <div className="table-wrapper">
                      <table>
                        <thead>
                          <tr>
                            <th>Step</th>
                            <th>State Stack</th>
                            <th>Symbol Stack</th>
                            <th>Remaining Input</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {parseRes.steps.map((st, idx) => (
                            <tr
                              key={`sr-step-${idx}`}
                              className={idx === simStep ? 'row-active' : ''}
                            >
                              <td>{st.step}</td>
                              <td>{st.stateStack}</td>
                              <td>{st.symbolStack}</td>
                              <td>{st.input}</td>
                              <td>
                                <strong
                                  className={
                                    st.action.includes('Shift')
                                      ? 'text-accent'
                                      : st.action.includes('Reduce')
                                      ? 'text-warning'
                                      : st.action.includes('Accept')
                                      ? 'text-success'
                                      : ''
                                  }
                                >
                                  {st.action}
                                </strong>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
