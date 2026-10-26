import React, { useState, useEffect } from 'react';
import { regexToNFA, nfaToDFA, minimizeDFA, simulateString } from '../engine/automata';
import { AutomataVisualizer } from './Visualizer';
import { Play, Pause, SkipForward, RotateCcw, CheckCircle, XCircle } from 'lucide-react';

const PRESETS = [
  { name: 'Regex: (a|b)*abb', regex: '(a|b)*abb', testStr: 'ababb' },
  { name: 'Regex: (0|1)*10', regex: '(0|1)*10', testStr: '0110' },
  { name: 'Regex: a*b+', regex: 'a*b+', testStr: 'aaabb' },
];

export function AutomataModule() {
  const [regex, setRegex] = useState('(a|b)*abb');
  const [activeTab, setActiveTab] = useState('regex-nfa');
  const [testString, setTestString] = useState('ababb');

  const [nfa, setNFA] = useState(null);
  const [dfa, setDFA] = useState(null);
  const [minDFA, setMinDFA] = useState(null);
  const [error, setError] = useState('');

  // Simulation playback state
  const [simResult, setSimResult] = useState(null);
  const [simStep, setSimStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Compute Automata on regex change
  useEffect(() => {
    try {
      setError('');
      const nfaRes = regexToNFA(regex);
      setNFA(nfaRes);

      const dfaRes = nfaToDFA(nfaRes);
      setDFA(dfaRes);

      const minRes = minimizeDFA(dfaRes);
      setMinDFA(minRes);
    } catch (err) {
      setError(err.message || 'Error compiling automaton.');
      setNFA(null);
      setDFA(null);
      setMinDFA(null);
    }
  }, [regex]);

  // Run simulation on test string or automaton update
  useEffect(() => {
    if (minDFA && testString !== undefined) {
      const res = simulateString(minDFA, testString);
      setSimResult(res);
      setSimStep(0);
      setIsPlaying(false);
    }
  }, [minDFA, testString]);

  // Auto playback interval
  useEffect(() => {
    let interval = null;
    if (isPlaying && simResult) {
      interval = setInterval(() => {
        setSimStep((prev) => {
          if (prev < simResult.steps.length - 1) {
            return prev + 1;
          } else {
            setIsPlaying(false);
            return prev;
          }
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying, simResult]);

  const activeAutomaton =
    activeTab === 'regex-nfa'
      ? nfa
      : activeTab === 'nfa-dfa'
      ? dfa
      : activeTab === 'dfa-min' || activeTab === 'simulator'
      ? minDFA
      : minDFA;

  const currentSimStepData = simResult?.steps[simStep] || null;

  return (
    <div className="module-wrapper">
      {/* Top Input Bar */}
      <div className="input-card">
        <div className="input-row">
          <div className="field-group">
            <label>Regular Expression</label>
            <input
              type="text"
              value={regex}
              onChange={(e) => setRegex(e.target.value)}
              placeholder="e.g. (a|b)*abb"
            />
          </div>

          <div className="field-group">
            <label>Load Example Preset</label>
            <div className="preset-buttons">
              {PRESETS.map((p, idx) => (
                <button
                  key={`preset-${idx}`}
                  className="btn-secondary"
                  onClick={() => {
                    setRegex(p.regex);
                    setTestString(p.testStr);
                  }}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}
      </div>

      {/* Sub-module Tabs */}
      <div className="sub-tabs">
        <button
          className={activeTab === 'regex-nfa' ? 'sub-tab active' : 'sub-tab'}
          onClick={() => setActiveTab('regex-nfa')}
        >
          1. Regex → NFA
        </button>
        <button
          className={activeTab === 'nfa-dfa' ? 'sub-tab active' : 'sub-tab'}
          onClick={() => setActiveTab('nfa-dfa')}
        >
          2. NFA → DFA
        </button>
        <button
          className={activeTab === 'dfa-min' ? 'sub-tab active' : 'sub-tab'}
          onClick={() => setActiveTab('dfa-min')}
        >
          3. DFA Minimization
        </button>
        <button
          className={activeTab === 'simulator' ? 'sub-tab active' : 'sub-tab'}
          onClick={() => setActiveTab('simulator')}
        >
          4. String Simulator
        </button>
      </div>

      {/* Main Grid View */}
      <div className="grid-2col">
        {/* Left Col: Visualizer */}
        <div className="panel-card">
          <h3 className="panel-title">
            {activeTab === 'regex-nfa' && 'NFA State Transition Graph'}
            {activeTab === 'nfa-dfa' && 'DFA State Transition Graph'}
            {activeTab === 'dfa-min' && 'Minimized DFA Graph'}
            {activeTab === 'simulator' && 'String Execution Simulation'}
          </h3>

          <AutomataVisualizer
            automaton={activeAutomaton}
            activeStates={
              activeTab === 'simulator' && currentSimStepData
                ? currentSimStepData.activeStates
                : []
            }
          />
        </div>

        {/* Right Col: Details & Step Logs */}
        <div className="panel-card">
          {activeTab === 'regex-nfa' && nfa && (
            <div>
              <h3 className="panel-title">Thompson Construction Steps</h3>
              <div className="meta-badge-row">
                <span className="badge">States: {nfa.states.length}</span>
                <span className="badge">Start: {nfa.startState}</span>
                <span className="badge">Accept: {nfa.acceptStates.join(', ')}</span>
              </div>

              <div className="table-wrapper">
                <h4>NFA Transition Table</h4>
                <table>
                  <thead>
                    <tr>
                      <th>From</th>
                      <th>Symbol</th>
                      <th>To</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nfa.transitions.map((tr, idx) => (
                      <tr key={`nfa-tr-${idx}`}>
                        <td>{tr.from}</td>
                        <td>
                          <span className="symbol-tag">{tr.symbol}</span>
                        </td>
                        <td>{tr.to}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h4>Algorithm Logs</h4>
              <ul className="log-list">
                {nfa.stepLogs.map((log, idx) => (
                  <li key={`log-${idx}`}>{log}</li>
                ))}
              </ul>
            </div>
          )}

          {activeTab === 'nfa-dfa' && dfa && (
            <div>
              <h3 className="panel-title">Subset Construction Table</h3>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>DFA State</th>
                      <th>NFA Subset</th>
                      <th>Start?</th>
                      <th>Accept?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dfa.subsetMappingTable.map((row, idx) => (
                      <tr key={`dfa-sub-${idx}`}>
                        <td>
                          <strong>{row.dfaState}</strong>
                        </td>
                        <td>{`{ ${row.nfaStates} }`}</td>
                        <td>{row.isStart ? 'Yes' : '-'}</td>
                        <td>{row.isAccept ? 'Yes' : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h4>Algorithm Logs</h4>
              <ul className="log-list">
                {dfa.stepLogs.map((log, idx) => (
                  <li key={`log-${idx}`}>{log}</li>
                ))}
              </ul>
            </div>
          )}

          {activeTab === 'dfa-min' && minDFA && (
            <div>
              <h3 className="panel-title">Hopcroft Minimization Summary</h3>
              <div className="meta-badge-row">
                <span className="badge">Original States: {dfa?.states.length}</span>
                <span className="badge highlight">Minimized States: {minDFA.states.length}</span>
              </div>

              <h4>Minimized Transitions</h4>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>From</th>
                      <th>Symbol</th>
                      <th>To</th>
                    </tr>
                  </thead>
                  <tbody>
                    {minDFA.transitions.map((tr, idx) => (
                      <tr key={`min-tr-${idx}`}>
                        <td>{tr.from}</td>
                        <td>
                          <span className="symbol-tag">{tr.symbol}</span>
                        </td>
                        <td>{tr.to}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h4>Partitioning Steps</h4>
              <ul className="log-list">
                {minDFA.stepLogs.map((log, idx) => (
                  <li key={`log-${idx}`}>{log}</li>
                ))}
              </ul>
            </div>
          )}

          {activeTab === 'simulator' && simResult && (
            <div>
              <h3 className="panel-title">DFA String Simulator</h3>
              <div className="field-group mb-12">
                <label>Input Test String</label>
                <input
                  type="text"
                  value={testString}
                  onChange={(e) => setTestString(e.target.value)}
                  placeholder="e.g. ababb"
                />
              </div>

              {/* Tape Visualization */}
              <div className="tape-container">
                <div className="tape-label">Input Tape:</div>
                <div className="tape-cells">
                  {testString.split('').map((ch, idx) => {
                    const isProcessed = currentSimStepData && idx < currentSimStepData.processed.length - 1;
                    const isCurrent = currentSimStepData && idx === currentSimStepData.processed.length - 1;
                    return (
                      <span
                        key={`tape-${idx}`}
                        className={`tape-cell ${isCurrent ? 'current' : isProcessed ? 'processed' : ''}`}
                      >
                        {ch}
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* Playback Controls */}
              <div className="playback-controls">
                <button onClick={() => setSimStep(0)} title="Reset">
                  <RotateCcw size={16} /> Reset
                </button>
                <button onClick={() => setIsPlaying(!isPlaying)}>
                  {isPlaying ? <Pause size={16} /> : <Play size={16} />} {isPlaying ? 'Pause' : 'Play'}
                </button>
                <button
                  onClick={() => setSimStep((s) => Math.min(s + 1, simResult.steps.length - 1))}
                  disabled={simStep >= simResult.steps.length - 1}
                >
                  <SkipForward size={16} /> Next Step
                </button>
              </div>

              {/* Verdict Banner */}
              <div className={`verdict-banner ${simResult.isAccepted ? 'accept' : 'reject'}`}>
                {simResult.isAccepted ? (
                  <>
                    <CheckCircle size={20} /> String Accepted by Automaton
                  </>
                ) : (
                  <>
                    <XCircle size={20} /> String Rejected by Automaton
                  </>
                )}
              </div>

              <h4>Step Trace Log</h4>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Step</th>
                      <th>Input Read</th>
                      <th>Active States</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {simResult.steps.map((st, idx) => (
                      <tr key={`sim-step-${idx}`} className={idx === simStep ? 'row-active' : ''}>
                        <td>{st.step}</td>
                        <td>{st.char || '-'}</td>
                        <td>{`{ ${st.activeStates.join(', ')} }`}</td>
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
