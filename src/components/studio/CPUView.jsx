// Interactive virtual CPU: steps the assembled target program instruction by instruction
// using the engine's pure step() function. The summary banner shows the result of the
// pipeline's full run and its comparison with the IR interpreter.
import React, { useEffect, useMemo, useState } from 'react';
import { Play, Pause, SkipForward, RotateCcw, FastForward, CheckCircle, AlertTriangle } from 'lucide-react';
import { initialState, step } from '../../engine/virtualCPU.js';
import { Listing, Stat, Empty } from '../ui';
import { annotatedTargetLines } from './irPresentation';

const SPEEDS = { slow: 800, normal: 300, fast: 60 };

export function CPUView({ phase, codegen, inputs, maxSteps }) {
  const program = codegen?.output?.program;
  const [state, setState] = useState(() => (program ? initialState(program, { inputs }) : null));
  const [prevRegs, setPrevRegs] = useState({});
  const [events, setEvents] = useState([]);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState('normal');

  // Reset whenever a new program or input list arrives.
  useEffect(() => {
    setState(program ? initialState(program, { inputs }) : null);
    setEvents([]);
    setPrevRegs({});
    setPlaying(false);
  }, [program, inputs]);

  const done = !state || state.status === 'halted' || state.status === 'error';

  const doStep = () => {
    if (!program || done) return;
    const { state: next, event } = step(program, state, { maxSteps });
    setPrevRegs(state.registers);
    setState(next);
    if (event) setEvents((ev) => [...ev.slice(-199), { ...event, step: next.steps }]);
  };

  const runToEnd = () => {
    if (!program) return;
    let s = state;
    const tail = [];
    let before = s.registers;
    while (s.status === 'ready' || s.status === 'running') {
      before = s.registers;
      const { state: next, event } = step(program, s, { maxSteps });
      if (event) {
        tail.push({ ...event, step: next.steps });
        if (tail.length > 200) tail.shift();
      }
      s = next;
    }
    setPrevRegs(before);
    setState(s);
    setEvents((ev) => [...ev, ...tail].slice(-200));
    setPlaying(false);
  };

  const reset = () => {
    setState(initialState(program, { inputs }));
    setEvents([]);
    setPrevRegs({});
    setPlaying(false);
  };

  useEffect(() => {
    if (!playing) return undefined;
    if (done) {
      setPlaying(false);
      return undefined;
    }
    const id = setTimeout(doStep, SPEEDS[speed]);
    return () => clearTimeout(id);
    // doStep reads the current `state`; re-arming on every state change paces playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, done, speed, state]);

  const lines = useMemo(() => (codegen?.output ? annotatedTargetLines(codegen.output.code, codegen.output.fromIR) : []), [codegen]);

  if (!program || !state) return <Empty>No executable program (an earlier phase failed).</Empty>;

  // Map the program counter to the listing line that shows that instruction.
  const codeIndex = program.sourceIndex[state.pc];
  const currentLine = state.status === 'halted' ? -1 : lines.findIndex((l) => l.key === codeIndex);
  const final = phase.output;

  return (
    <div>
      {final && (
        <div className={`verdict-banner ${final.agreement.equal && final.state.status === 'halted' ? 'accept' : 'reject'}`}>
          {final.agreement.equal && final.state.status === 'halted' ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
          {final.state.status === 'halted'
            ? `Program halted after ${final.state.steps} instructions. Output: ${final.state.output.map((o) => o.text).join(', ') || '(none)'}`
            : `Run-time error: ${final.state.error.message}`}
          {final.agreement.equal ? ' · matches the IR interpreter' : ` · MISMATCH with IR interpreter: ${final.agreement.difference}`}
        </div>
      )}

      <div className="row mb-12" role="toolbar" aria-label="CPU controls">
        <button className="btn" onClick={reset}>
          <RotateCcw size={15} /> Reset
        </button>
        <button className="btn primary" onClick={doStep} disabled={done}>
          <SkipForward size={15} /> Step
        </button>
        <button className="btn" onClick={() => setPlaying((p) => !p)} disabled={done}>
          {playing ? <Pause size={15} /> : <Play size={15} />} {playing ? 'Pause' : 'Play'}
        </button>
        <button className="btn" onClick={runToEnd} disabled={done}>
          <FastForward size={15} /> Run to end
        </button>
        <label className="check" style={{ gap: 6 }}>
          Speed
          <select value={speed} onChange={(e) => setSpeed(e.target.value)} aria-label="Playback speed">
            <option value="slow">slow</option>
            <option value="normal">normal</option>
            <option value="fast">fast</option>
          </select>
        </label>
      </div>

      <div className="stat-row">
        <Stat label="PC" value={state.status === 'halted' ? '—' : state.pc} />
        <Stat label="steps" value={state.steps} />
        <Stat label="inputs read" value={`${state.inputPos}/${state.inputs.length}`} />
        <Stat label="status" value={state.status} />
      </div>
      {state.status === 'error' && <div className="error-banner mb-12">{`${state.error.kind}: ${state.error.message}`}</div>}

      <div className="cpu-grid">
        <div>
          <label>Program (current instruction highlighted)</label>
          <Listing lines={lines} current={currentLine} ariaLabel="Target program" />
        </div>
        <div>
          <label>Registers</label>
          <div className="register-grid mb-12">
            {Object.entries(state.registers).map(([r, v]) => (
              <div key={r} className={`register-card ${prevRegs[r] !== v && events.length ? 'changed' : ''}`}>
                <span className="reg-name">{r}</span>
                <span className="reg-val">{v === undefined ? '–' : v}</span>
              </div>
            ))}
          </div>

          <label>Memory</label>
          <div className="table-wrapper" style={{ maxHeight: 180, overflow: 'auto' }}>
            {Object.keys(state.memory).length === 0 ? (
              <p className="small muted">Nothing stored yet.</p>
            ) : (
              <table className="table-compact">
                <thead>
                  <tr>
                    <th>Address</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(state.memory).map(([k, v]) => (
                    <tr key={k}>
                      <td>
                        <code>{k}</code>
                      </td>
                      <td>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <label>Output</label>
          <div className="console" aria-live="polite">
            {state.output.length === 0 ? <span className="console-empty">(no output yet)</span> : state.output.map((o, i) => <div key={i}>{o.text}</div>)}
            {state.status === 'error' && <div className="console-error">✖ {state.error.kind}</div>}
          </div>
        </div>
      </div>

      <h4>Execution trace (most recent last)</h4>
      {events.length === 0 ? (
        <p className="small muted">Press Step, Play or Run to end to execute the program.</p>
      ) : (
        <div className="table-wrapper" style={{ maxHeight: 240, overflow: 'auto' }}>
          <table className="table-compact">
            <thead>
              <tr>
                <th>Step</th>
                <th>PC</th>
                <th>Instruction</th>
                <th>Effect</th>
              </tr>
            </thead>
            <tbody>
              {events.slice(-60).map((e) => (
                <tr key={`${e.step}-${e.pc}`} className={e.error ? 'text-warning' : ''}>
                  <td>{e.step}</td>
                  <td>{e.pc}</td>
                  <td>
                    <code>{e.text}</code>
                  </td>
                  <td>{e.effect}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
