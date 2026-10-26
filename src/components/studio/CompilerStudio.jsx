// Compiler Studio: edit a MiniC program, compile it through every phase, and inspect
// each phase's real output. All compiler work happens in pipeline/compile.js.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Play, RotateCcw, Trash2, ChevronLeft, ChevronRight, Settings2, FilePlus, Save, Copy, FolderOpen, Download, X } from 'lucide-react';
import { compile, PHASES, DEFAULT_OPTIONS } from '../../pipeline/compile.js';
import { EXAMPLES, findExample } from '../../pipeline/examples.js';
import { PASS_DESCRIPTIONS } from '../../engine/optimizer.js';
import { SourceEditor } from './SourceEditor';
import { StatusPill, DiagnosticList, Empty } from '../ui';
import { LexicalView, SyntaxView, SemanticView, IRView, OptimizationView, CodegenView } from './PhaseViews';
import { CPUView } from './CPUView';
import { parseInputs } from './inputParsing';
import { STARTER_PROGRAM, loadPrograms, savePrograms, upsertProgram, newProgramId, loadDraft, saveDraft, uniqueName } from './programStore';

const DEFAULT_EXAMPLE = findExample('optimizable');
const MAX_FILE_BYTES = 200 * 1024;

// What the editor currently holds:
//   { kind: 'example', id }  a bundled example (edits are allowed but not saved over it)
//   { kind: 'saved', id }    one of the user's saved programs
//   { kind: 'scratch' }      a new, not-yet-saved program
// The editor contents are auto-saved as a draft, so work survives a page reload.
function initialState() {
  const draft = loadDraft();
  if (draft) {
    return { current: draft.current ?? { kind: 'scratch' }, name: draft.name ?? 'My program', source: draft.source, inputsText: draft.inputsText ?? '' };
  }
  return { current: { kind: 'example', id: DEFAULT_EXAMPLE.id }, name: '', source: DEFAULT_EXAMPLE.source, inputsText: DEFAULT_EXAMPLE.inputs.join(', ') };
}

export function CompilerStudio() {
  const [init] = useState(initialState);
  const [current, setCurrent] = useState(init.current);
  const [programName, setProgramName] = useState(init.name);
  const [programs, setPrograms] = useState(loadPrograms);
  const [notice, setNotice] = useState('');
  const fileRef = useRef(null);
  const [source, setSource] = useState(init.source);
  const [inputsText, setInputsText] = useState(init.inputsText);
  const [options, setOptions] = useState({
    optimize: true,
    passes: { ...DEFAULT_OPTIONS.passes },
    strategy: DEFAULT_OPTIONS.strategy,
    registerCount: DEFAULT_OPTIONS.registerCount,
    preserveVariables: false,
  });
  const [result, setResult] = useState(() => compile(init.source, { inputs: parseInputs(init.inputsText).values ?? [] }));
  const [compiledSource, setCompiledSource] = useState(init.source);
  const [selected, setSelected] = useState('optimization');
  const editorRef = useRef(null);

  const parsedInputs = useMemo(() => parseInputs(inputsText), [inputsText]);
  const stale = source !== compiledSource;

  const runCompile = (src = source, opts = options, inputs = parsedInputs.values) => {
    if (!inputs) return;
    const r = compile(src, { ...opts, inputs });
    setResult(r);
    setCompiledSource(src);
    // Jump to the first failing phase so the user sees the problem immediately.
    if (r.stoppedAt && r.stoppedAt !== 'execution') setSelected(r.stoppedAt);
  };

  // Auto-save the editor as a draft (browser-local).
  useEffect(() => {
    saveDraft({ current, name: programName, source, inputsText });
  }, [current, programName, source, inputsText]);

  const flash = (msg) => {
    setNotice(msg);
    setTimeout(() => setNotice((n) => (n === msg ? '' : n)), 3000);
  };

  const openProgram = (next, src, inputs, name = '') => {
    setCurrent(next);
    setProgramName(name);
    setSource(src);
    setInputsText(inputs);
    const parsed = parseInputs(inputs);
    runCompile(src, options, parsed.values ?? []);
  };

  const loadExample = (id) => {
    const ex = findExample(id);
    openProgram({ kind: 'example', id }, ex.source, ex.inputs.join(', '));
  };

  const onSelectProgram = (value) => {
    const [kind, id] = value.split(':');
    if (kind === 'ex') loadExample(id);
    else if (kind === 'my') {
      const p = programs.find((x) => x.id === id);
      if (p) openProgram({ kind: 'saved', id }, p.source, p.inputs ?? '', p.name);
    }
  };

  const newProgram = () => {
    openProgram({ kind: 'scratch' }, STARTER_PROGRAM, '3, 4', uniqueName(programs));
  };

  const persist = (list, msg) => {
    setPrograms(list);
    flash(savePrograms(list) ? msg : 'Could not save: browser storage is unavailable.');
  };

  const saveProgram = () => {
    if (current.kind === 'saved') {
      const name = programName.trim() || uniqueName(programs);
      persist(upsertProgram(programs, { id: current.id, name, source, inputs: inputsText }), `Saved “${name}”.`);
      setProgramName(name);
      return;
    }
    // Example or scratch: create a new saved program.
    const base = current.kind === 'example' ? `${findExample(current.id).title} (my copy)` : programName.trim() || 'My program';
    const name = uniqueName(programs, base);
    const id = newProgramId();
    persist(upsertProgram(programs, { id, name, source, inputs: inputsText }), `Saved as “${name}”.`);
    setCurrent({ kind: 'saved', id });
    setProgramName(name);
  };

  const saveAsCopy = () => {
    const name = uniqueName(programs, `${programName.trim() || 'My program'} copy`);
    const id = newProgramId();
    persist(upsertProgram(programs, { id, name, source, inputs: inputsText }), `Saved as “${name}”.`);
    setCurrent({ kind: 'saved', id });
    setProgramName(name);
  };

  const deleteProgram = () => {
    const p = programs.find((x) => x.id === current.id);
    if (!p || !window.confirm(`Delete “${p.name}” from this browser? This cannot be undone.`)) return;
    persist(programs.filter((x) => x.id !== p.id), `Deleted “${p.name}”. The code is still in the editor as an unsaved program.`);
    setCurrent({ kind: 'scratch' });
  };

  const resetProgram = () => {
    if (current.kind === 'example') loadExample(current.id);
    else if (current.kind === 'saved') onSelectProgram(`my:${current.id}`);
    else openProgram({ kind: 'scratch' }, STARTER_PROGRAM, '3, 4', programName);
  };

  const openFile = (file) => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      flash(`“${file.name}” is larger than ${MAX_FILE_BYTES / 1024} KB.`);
      return;
    }
    file.text().then((text) => {
      openProgram({ kind: 'scratch' }, text.replace(/\r\n/g, '\n'), '', file.name.replace(/\.[^.]+$/, ''));
      flash(`Opened “${file.name}”. Save it to keep it in your programs.`);
    });
  };

  const downloadProgram = () => {
    const name = (current.kind === 'example' ? current.id : programName.trim() || 'program').replace(/[^\w.-]+/g, '_');
    const url = URL.createObjectURL(new Blob([source], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.mc`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const loadedSource =
    current.kind === 'example' ? findExample(current.id)?.source : current.kind === 'saved' ? programs.find((p) => p.id === current.id)?.source : null;
  const modified = loadedSource !== null && loadedSource !== undefined && loadedSource !== source;
  const selectValue = current.kind === 'example' ? `ex:${current.id}` : current.kind === 'saved' ? `my:${current.id}` : 'scratch';

  const updateOptions = (patch) => {
    const next = { ...options, ...patch };
    setOptions(next);
    if (!stale) runCompile(source, next);
  };

  const phaseIndex = PHASES.findIndex((p) => p.id === selected);
  const phase = result.phases[selected];
  const revealSpan = (span) => editorRef.current?.revealSpan(span);

  return (
    <div className="module-wrapper">
      <div className="page-heading">
        <div className="breadcrumb">
          Compiler Studio › <strong>{PHASES[phaseIndex].title}</strong>
        </div>
        <h1>Compiler Studio</h1>
        <p>
          Write a MiniC program – or open an example – and see what every compiler phase produces, down to the instructions the virtual CPU
          executes. <kbd>Ctrl</kbd> + <kbd>Enter</kbd> compiles. <a href="#/reference">Language reference</a>
        </p>
      </div>

      {/* Phase pipeline */}
      <nav className="phase-bar" aria-label="Compilation phases">
        {PHASES.map((p, i) => {
          const status = result.phases[p.id].status;
          return (
            <button
              key={p.id}
              className={`phase-chip state-${status} ${selected === p.id ? 'active' : ''}`}
              onClick={() => setSelected(p.id)}
              aria-current={selected === p.id ? 'step' : undefined}
            >
              <span className="phase-num">Phase {i + 1}</span>
              <span className="phase-name">{p.short}</span>
              <StatusPill status={status} />
            </button>
          );
        })}
      </nav>

      <div className="studio-grid">
        {/* ---------------------------------------------------- editor column */}
        <section className="panel-card" aria-label="Source program">
          <div className="row mb-8">
            <label htmlFor="program-select" style={{ margin: 0 }}>
              Program
            </label>
            <select id="program-select" value={selectValue} onChange={(e) => onSelectProgram(e.target.value)} style={{ flex: 1, minWidth: 0 }}>
              <optgroup label="My programs">
                {current.kind === 'scratch' && <option value="scratch">{programName || 'Untitled'} (not saved)</option>}
                {programs.map((p) => (
                  <option key={p.id} value={`my:${p.id}`}>
                    {p.name}
                  </option>
                ))}
                {programs.length === 0 && current.kind !== 'scratch' && (
                  <option value="none" disabled>
                    (none yet – press New or Save)
                  </option>
                )}
              </optgroup>
              <optgroup label="Examples">
                {EXAMPLES.map((ex) => (
                  <option key={ex.id} value={`ex:${ex.id}`}>
                    {ex.title}
                  </option>
                ))}
              </optgroup>
            </select>
            {modified && <span className="status-pill status-pending">modified</span>}
          </div>

          <div className="toolbar mb-8" role="toolbar" aria-label="Program file actions">
            <button className="btn small" onClick={newProgram}>
              <FilePlus size={14} /> New
            </button>
            <button className="btn small" onClick={saveProgram}>
              <Save size={14} /> {current.kind === 'saved' ? 'Save' : 'Save to my programs'}
            </button>
            {current.kind === 'saved' && (
              <>
                <button className="btn small" onClick={saveAsCopy}>
                  <Copy size={14} /> Save as copy
                </button>
                <button className="btn small" onClick={deleteProgram}>
                  <X size={14} /> Delete
                </button>
              </>
            )}
            <button className="btn small" onClick={() => fileRef.current?.click()}>
              <FolderOpen size={14} /> Open file
            </button>
            <button className="btn small" onClick={downloadProgram}>
              <Download size={14} /> Download
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".mc,.c,.txt,text/plain"
              hidden
              onChange={(e) => {
                openFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>

          {current.kind !== 'example' && (
            <div className="field-group mb-8">
              <label htmlFor="program-name">Program name</label>
              <input id="program-name" type="text" value={programName} onChange={(e) => setProgramName(e.target.value)} placeholder="My program" maxLength={60} />
            </div>
          )}
          {notice && (
            <div className="info-banner mb-8" role="status">
              {notice}
            </div>
          )}

          <SourceEditor ref={editorRef} value={source} onChange={setSource} onSubmit={() => runCompile()} diagnostics={stale ? [] : result.diagnostics} />

          <div className="field-group mt-12">
            <label htmlFor="inputs">Program input (values returned by input(), comma separated)</label>
            <input id="inputs" type="text" value={inputsText} onChange={(e) => setInputsText(e.target.value)} placeholder="e.g. 5, 3" aria-invalid={!!parsedInputs.error} />
            {parsedInputs.error && <span className="small" style={{ color: 'var(--danger-text)' }}>{parsedInputs.error}</span>}
          </div>

          <div className="toolbar mt-12">
            <button className="btn primary" onClick={() => runCompile()} disabled={!!parsedInputs.error}>
              <Play size={15} /> Compile &amp; run
            </button>
            <button className="btn" onClick={resetProgram} disabled={current.kind !== 'scratch' && !modified}>
              <RotateCcw size={15} /> {current.kind === 'scratch' ? 'Reset' : 'Revert'}
            </button>
            <button className="btn" onClick={() => setSource('')}>
              <Trash2 size={15} /> Clear
            </button>
            <span className="spacer" />
            {stale ? <span className="status-pill status-pending">edited – not compiled</span> : <StatusPill status={result.ok ? 'success' : 'error'} />}
          </div>

          <details className="options mt-12">
            <summary>
              <Settings2 size={13} style={{ verticalAlign: -2 }} /> Compiler options
            </summary>
            <div className="options-grid">
              <label className="check">
                <input type="checkbox" checked={options.optimize} onChange={(e) => updateOptions({ optimize: e.target.checked })} />
                Optimise
              </label>
              {Object.keys(PASS_DESCRIPTIONS).map((pass) => (
                <label key={pass} className="check" title={PASS_DESCRIPTIONS[pass]}>
                  <input
                    type="checkbox"
                    disabled={!options.optimize}
                    checked={options.passes[pass]}
                    onChange={(e) => updateOptions({ passes: { ...options.passes, [pass]: e.target.checked } })}
                  />
                  {pass}
                </label>
              ))}
              <label className="check" title="Treat the final values of all variables as observable, so the optimiser keeps them">
                <input type="checkbox" checked={options.preserveVariables} onChange={(e) => updateOptions({ preserveVariables: e.target.checked })} />
                Keep final variable values
              </label>
              <label className="check">
                Code generator
                <select value={options.strategy} onChange={(e) => updateOptions({ strategy: e.target.value })}>
                  <option value="local">register descriptors</option>
                  <option value="naive">naive (load/store each)</option>
                </select>
              </label>
              <label className="check">
                Registers
                <select value={options.registerCount} onChange={(e) => updateOptions({ registerCount: Number(e.target.value) })}>
                  {[3, 4, 5, 6, 8].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </details>

          {!stale && result.diagnostics.length > 0 && (
            <div className="mt-16">
              <h4>
                Diagnostics ({result.diagnostics.filter((d) => d.severity === 'error').length} errors,{' '}
                {result.diagnostics.filter((d) => d.severity === 'warning').length} warnings)
              </h4>
              <DiagnosticList diagnostics={result.diagnostics} onSelect={(d) => revealSpan(d.span)} />
            </div>
          )}
        </section>

        {/* ---------------------------------------------------- inspector column */}
        <section className="panel-card" aria-label={`${PHASES[phaseIndex].title} inspector`}>
          <div className="row mb-12">
            <h2 className="panel-title" style={{ margin: 0 }}>
              {phaseIndex + 1}. {PHASES[phaseIndex].title}
            </h2>
            <StatusPill status={phase.status} />
            <span className="spacer" />
            <button className="btn small" onClick={() => setSelected(PHASES[phaseIndex - 1].id)} disabled={phaseIndex === 0} aria-label="Previous phase">
              <ChevronLeft size={14} /> Prev
            </button>
            <button className="btn small" onClick={() => setSelected(PHASES[phaseIndex + 1].id)} disabled={phaseIndex === PHASES.length - 1} aria-label="Next phase">
              Next <ChevronRight size={14} />
            </button>
          </div>
          {stale && <div className="info-banner mb-12">The source has changed since the last compilation. Compile again to update these results.</div>}
          {phase.note && phase.status !== 'disabled' && <div className="info-banner mb-12">{phase.note}</div>}
          {phase.diagnostics.length > 0 && selected !== 'execution' && (
            <div className="mb-12">
              <DiagnosticList diagnostics={phase.diagnostics} onSelect={(d) => revealSpan(d.span)} />
            </div>
          )}
          <PhaseBody id={selected} result={result} revealSpan={revealSpan} />
        </section>
      </div>
    </div>
  );
}

function PhaseBody({ id, result, revealSpan }) {
  const phase = result.phases[id];
  if (phase.status === 'skipped') return <Empty>This phase did not run because an earlier phase failed.</Empty>;
  if (!phase.output && phase.status !== 'disabled') return <Empty>No output.</Empty>;
  switch (id) {
    case 'lexical':
      return <LexicalView phase={phase} onSelectSpan={revealSpan} />;
    case 'syntax':
      return <SyntaxView phase={phase} onSelectSpan={revealSpan} />;
    case 'semantic':
      return <SemanticView phase={phase} ast={result.phases.syntax.output?.ast} onSelectSpan={revealSpan} />;
    case 'ir':
      return <IRView phase={phase} />;
    case 'optimization':
      return <OptimizationView phase={phase} irPhase={result.phases.ir} />;
    case 'codegen':
      return <CodegenView phase={phase} />;
    case 'execution':
      return <CPUView phase={phase} codegen={result.phases.codegen} inputs={result.options.inputs} maxSteps={result.options.maxSteps} />;
    default:
      return null;
  }
}
