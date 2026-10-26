import React, { useState, useEffect } from 'react';
import {
  generate3AC,
  optimizeCode,
  generateAssembly,
  simulateCPU,
} from '../engine/codegen';
import { Cpu, Zap, Code, Terminal, Play, Pause, RotateCcw } from 'lucide-react';

const CODEGEN_PRESETS = [
  {
    name: 'Arithmetic Expressions',
    code: `x = a + b * c\ny = x - 5`,
  },
  {
    name: 'Optimization Candidate (Const Folding & Prop)',
    code: `a = 4 + 5\nb = a * 2\nc = b + 10`,
  },
  {
    name: 'Multi-variable Pipeline',
    code: `val1 = 10\nval2 = 20\ntotal = val1 + val2\nresult = total * 2`,
  },
];

export function CodeGenModule() {
  const [sourceCode, setSourceCode] = useState(CODEGEN_PRESETS[0].code);
  const [activeTab, setActiveTab] = useState('tac-quads');

  const [tacRes, setTacRes] = useState(null);
  const [optRes, setOptRes] = useState(null);
  const [assembly, setAssembly] = useState([]);
  const [cpuSimRes, setCpuSimRes] = useState(null);

  // CPU simulation playback state
  const [cpuStep, setCpuStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    try {
      const tacData = generate3AC(sourceCode);
      setTacRes(tacData);

      const optData = optimizeCode(tacData.tac);
      setOptRes(optData);

      const asmData = generateAssembly(optData.optimizedTac);
      setAssembly(asmData);

      const cpuData = simulateCPU(asmData);
      setCpuSimRes(cpuData);
      setCpuStep(0);
      setIsPlaying(false);
    } catch (err) {
      setTacRes(null);
      setOptRes(null);
      setAssembly([]);
      setCpuSimRes(null);
    }
  }, [sourceCode]);

  useEffect(() => {
    let interval = null;
    if (isPlaying && cpuSimRes && cpuSimRes.executionSteps.length > 0) {
      interval = setInterval(() => {
        setCpuStep((prev) => {
          if (prev < cpuSimRes.executionSteps.length - 1) return prev + 1;
          setIsPlaying(false);
          return prev;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying, cpuSimRes]);

  const currentCpuState = cpuSimRes?.executionSteps[cpuStep] || null;

  return (
    <div className="module-wrapper">
      {/* Top Input Card */}
      <div className="input-card">
        <div className="input-row">
          <div className="field-group flex-1">
            <label>High-Level Code Input (Statements / Expressions)</label>
            <textarea
              rows="4"
              value={sourceCode}
              onChange={(e) => setSourceCode(e.target.value)}
              placeholder="e.g. x = a + b * c"
            />
          </div>

          <div className="field-group">
            <label>Load Example Program</label>
            <div className="preset-buttons vertical">
              {CODEGEN_PRESETS.map((p, idx) => (
                <button
                  key={`cg-preset-${idx}`}
                  className="btn-secondary"
                  onClick={() => setSourceCode(p.code)}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Sub Tabs */}
      <div className="sub-tabs">
        <button
          className={activeTab === 'tac-quads' ? 'sub-tab active' : 'sub-tab'}
          onClick={() => setActiveTab('tac-quads')}
        >
          <Code size={16} /> 1. 3AC & Quadruples
        </button>
        <button
          className={activeTab === 'optimizations' ? 'sub-tab active' : 'sub-tab'}
          onClick={() => setActiveTab('optimizations')}
        >
          <Zap size={16} /> 2. Code Optimizations
        </button>
        <button
          className={activeTab === 'assembly' ? 'sub-tab active' : 'sub-tab'}
          onClick={() => setActiveTab('assembly')}
        >
          <Terminal size={16} /> 3. Target Assembly
        </button>
        <button
          className={activeTab === 'cpu-sim' ? 'sub-tab active' : 'sub-tab'}
          onClick={() => setActiveTab('cpu-sim')}
        >
          <Cpu size={16} /> 4. Virtual CPU Simulator
        </button>
      </div>

      {/* Main Grid View */}
      <div className="grid-2col">
        {/* Left Column */}
        <div className="panel-card">
          {activeTab === 'tac-quads' && tacRes && (
            <div>
              <h3 className="panel-title">Three-Address Code (3AC)</h3>
              <pre className="code-block">{tacRes.tac.join('\n')}</pre>

              <h3 className="panel-title mt-16">Postfix Notation</h3>
              <ul>
                {tacRes.postfixList.map((p, idx) => (
                  <li key={`post-${idx}`}>
                    <strong>{p.target}</strong> = {p.postfix}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {activeTab === 'optimizations' && optRes && tacRes && (
            <div>
              <h3 className="panel-title">Before vs After Optimization</h3>
              <div className="grid-2col gap-12">
                <div>
                  <label>Original 3AC</label>
                  <pre className="code-block text-muted">{tacRes.tac.join('\n')}</pre>
                </div>
                <div>
                  <label>Optimized 3AC</label>
                  <pre className="code-block text-success">{optRes.optimizedTac.join('\n')}</pre>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'assembly' && (
            <div>
              <h3 className="panel-title">Generated Assembly Code</h3>
              <pre className="code-block">{assembly.join('\n')}</pre>
            </div>
          )}

          {activeTab === 'cpu-sim' && currentCpuState && (
            <div>
              <h3 className="panel-title">Virtual CPU Registers & Memory</h3>

              <div className="register-grid mb-16">
                {Object.entries(currentCpuState.registers).map(([reg, val]) => (
                  <div key={reg} className="register-card">
                    <span className="reg-name">{reg}</span>
                    <span className="reg-val">{val}</span>
                  </div>
                ))}
              </div>

              <h4 className="mb-8">Memory Variables Map</h4>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Variable</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.keys(currentCpuState.memory).length === 0 ? (
                      <tr>
                        <td colSpan="2" className="text-muted">
                          No memory variables stored yet.
                        </td>
                      </tr>
                    ) : (
                      Object.entries(currentCpuState.memory).map(([varName, val]) => (
                        <tr key={`mem-${varName}`}>
                          <td>
                            <strong>{varName}</strong>
                          </td>
                          <td>{val}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Right Column */}
        <div className="panel-card">
          {activeTab === 'tac-quads' && tacRes && (
            <div>
              <h3 className="panel-title">Quadruples Table (Op, Arg1, Arg2, Result)</h3>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Op</th>
                      <th>Arg 1</th>
                      <th>Arg 2</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tacRes.quadruples.map((q, idx) => (
                      <tr key={`quad-${idx}`}>
                        <td>{idx}</td>
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
            </div>
          )}

          {activeTab === 'optimizations' && optRes && (
            <div>
              <h3 className="panel-title">Optimization Transformation Logs</h3>
              <div className="step-logs">
                {optRes.stepLogs.map((log, idx) => (
                  <div key={`opt-log-${idx}`} className="step-log-item">
                    {log}
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'assembly' && (
            <div>
              <h3 className="panel-title">Instruction Breakdown</h3>
              <ul className="assembly-breakdown">
                <li>
                  <code>LOAD R0, X</code> - Load variable X into Register R0
                </li>
                <li>
                  <code>ADD R0, R1</code> - Add contents of R1 to R0
                </li>
                <li>
                  <code>STORE Y, R0</code> - Write Register R0 back to Memory Y
                </li>
                <li>
                  <code>HALT</code> - Terminate virtual machine execution
                </li>
              </ul>
            </div>
          )}

          {activeTab === 'cpu-sim' && cpuSimRes && (
            <div>
              <h3 className="panel-title">Step Execution Timeline</h3>

              <div className="playback-controls mb-12">
                <button
                  className="btn-primary"
                  onClick={() => setIsPlaying(!isPlaying)}
                >
                  {isPlaying ? <Pause size={16} /> : <Play size={16} />}{' '}
                  {isPlaying ? 'Pause' : 'Run CPU'}
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => {
                    setCpuStep((s) => Math.min(s + 1, cpuSimRes.executionSteps.length - 1));
                    setIsPlaying(false);
                  }}
                >
                  Step Next
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => {
                    setCpuStep(0);
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
                      <th>PC</th>
                      <th>Instruction</th>
                      <th>Action Summary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cpuSimRes.executionSteps.map((st, idx) => (
                      <tr
                        key={`cpu-step-${idx}`}
                        className={idx === cpuStep ? 'row-active' : ''}
                      >
                        <td>{st.step}</td>
                        <td>{st.pc}</td>
                        <td>
                          <code>{st.instruction}</code>
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
