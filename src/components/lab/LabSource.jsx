// MiniC source editor used by the Algorithm Lab modules that analyse intermediate code.
// It compiles with the real pipeline (without executing) and hands the result to the
// module through `children(result)`.
import React, { useMemo, useState } from 'react';
import { compile } from '../../pipeline/compile.js';
import { EXAMPLES } from '../../pipeline/examples.js';
import { SourceEditor } from '../studio/SourceEditor';
import { DiagnosticList } from '../ui';

const USABLE = EXAMPLES.filter((e) => !e.id.endsWith('error'));

export function LabSource({ initialId = 'gcd', label = 'MiniC program', children, compileOptions = {}, requirePhase = 'ir' }) {
  const initial = USABLE.find((e) => e.id === initialId) ?? USABLE[0];
  const [exampleId, setExampleId] = useState(initial.id);
  const [source, setSource] = useState(initial.source);
  const optionsKey = JSON.stringify(compileOptions);
  // compile() is fast (well under a millisecond for these programs), so recompiling on
  // every edit keeps the lab views live without a separate "compile" step.
  const result = useMemo(() => compile(source, { ...JSON.parse(optionsKey), execute: false }), [source, optionsKey]);
  const errors = result.diagnostics.filter((d) => d.severity === 'error');
  // The analysis needs `requirePhase` to have run. Semantic output is still useful when it
  // reports errors (it lists them); later phases must have succeeded.
  const phase = result.phases[requirePhase];
  const ready = !!phase.output && phase.status !== 'skipped' && (phase.status !== 'error' || requirePhase === 'semantic');

  return (
    <>
      <div className="input-card">
        <div className="row mb-8">
          <label htmlFor={`lab-example-${initialId}`} style={{ margin: 0 }}>
            {label}
          </label>
          <span className="spacer" />
          <select
            id={`lab-example-${initialId}`}
            value={exampleId}
            onChange={(e) => {
              const ex = USABLE.find((x) => x.id === e.target.value);
              setExampleId(ex.id);
              setSource(ex.source);
            }}
            aria-label="Load example program"
          >
            {USABLE.map((ex) => (
              <option key={ex.id} value={ex.id}>
                {ex.title}
              </option>
            ))}
          </select>
        </div>
        <SourceEditor value={source} onChange={setSource} diagnostics={result.diagnostics} label={label} />
        {errors.length > 0 && (
          <div className="mt-12">
            <DiagnosticList diagnostics={errors} />
          </div>
        )}
      </div>
      {ready ? (
        children(result)
      ) : (
        <div className="info-banner">Fix the errors above to see the analysis.</div>
      )}
    </>
  );
}

/** Basic-block selector shared by block-level analyses. */
export function BlockPicker({ cfg, value, onChange, id = 'block-picker' }) {
  return (
    <label className="check" htmlFor={id}>
      Basic block
      <select id={id} value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {cfg.blocks.map((b) => (
          <option key={b.id} value={b.index}>
            {b.id} ({b.instructions.length} instr.)
          </option>
        ))}
      </select>
    </label>
  );
}
