// Compilation pipeline orchestrator.
//
// compile(source, options) runs the phases in dependency order, passing each phase the
// structured output of the previous one:
//
//   lexical → syntax → semantic → ir → optimization → codegen → execution
//
// Result = {
//   source, options,
//   phases: { [id]: PhaseResult },   in PHASES order
//   diagnostics: Diagnostic[],       all phases, in order
//   ok: boolean,                     every enabled phase succeeded
//   stoppedAt: phase id | null       first phase that failed
// }
// PhaseResult = { id, title, status, output, diagnostics, durationMs, note }
//   status: 'success' | 'warning' | 'error' | 'skipped' | 'disabled'
//
// Rules:
//   * A failed phase stops every dependent phase (status 'skipped'); results of the
//     phases that already completed are kept.
//   * An exception thrown inside an engine is reported as an 'internal-error' diagnostic
//     on that phase instead of crashing the caller.
//   * Observable behaviour = output + run-time error (plus final variable values when
//     options.preserveVariables is set).
//   * Optimisation is validated by running the original and optimised IR on the same
//     inputs; execution is validated by comparing the CPU with the IR interpreter.
//     Both checks are translation validation *for this input*, not proofs.
//   * compile() is pure with respect to its arguments; every call builds fresh state.

import { tokenize } from '../engine/lexer.js';
import { parseProgram } from '../engine/parser.js';
import { analyzeProgram } from '../engine/semanticAnalyzer.js';
import { generateIR } from '../engine/irgen.js';
import { formatProgram, toQuadruples, toTriples, toIndirectTriples, validateIR } from '../engine/ir.js';
import { runIR } from '../engine/irInterpreter.js';
import { optimizeIR, DEFAULT_PASSES } from '../engine/optimizer.js';
import { buildBasicBlocksAndCFG } from '../engine/optimizationCFG.js';
import { generateTargetCode } from '../engine/targetCodegen.js';
import { assemble, runProgram, formatTargetProgram } from '../engine/virtualCPU.js';
import { MINIC_TOKEN_SPECS } from './language.js';
import { error, warning, makeDiagnostic, hasErrors } from './diagnostics.js';

export const PHASES = [
  { id: 'lexical', title: 'Lexical Analysis', short: 'Lexer' },
  { id: 'syntax', title: 'Syntax Analysis', short: 'Parser' },
  { id: 'semantic', title: 'Semantic Analysis', short: 'Semantics' },
  { id: 'ir', title: 'Intermediate Code', short: 'TAC' },
  { id: 'optimization', title: 'Optimization', short: 'Optimizer' },
  { id: 'codegen', title: 'Target Code Generation', short: 'Codegen' },
  { id: 'execution', title: 'Virtual CPU Execution', short: 'CPU' },
];

export const DEFAULT_OPTIONS = {
  inputs: [],
  optimize: true,
  passes: { ...DEFAULT_PASSES },
  strategy: 'local',
  registerCount: 4,
  maxSteps: 100000,
  traceLimit: 5000,
  execute: true,
  preserveVariables: false,
};

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function compile(source, userOptions = {}) {
  const options = { ...DEFAULT_OPTIONS, ...userOptions, passes: { ...DEFAULT_PASSES, ...(userOptions.passes || {}) } };
  if (typeof source !== 'string') throw new TypeError('compile(source): source must be a string.');
  if (!Array.isArray(options.inputs) || options.inputs.some((v) => !Number.isInteger(v))) {
    throw new TypeError('compile: options.inputs must be an array of integers.');
  }

  const phases = {};
  let stoppedAt = null;

  const run = (id, fn) => {
    const meta = PHASES.find((p) => p.id === id);
    if (stoppedAt) {
      phases[id] = { ...meta, status: 'skipped', output: null, diagnostics: [], durationMs: 0, note: `Not run: ${PHASES.find((p) => p.id === stoppedAt).title.toLowerCase()} failed.` };
      return null;
    }
    const t0 = now();
    let result;
    try {
      result = fn();
    } catch (e) {
      result = {
        output: null,
        diagnostics: [makeDiagnostic('error', id, 'internal-error', `Internal compiler error in ${meta.title.toLowerCase()}: ${e.message}`)],
      };
    }
    const diagnostics = result.diagnostics || [];
    const failed = result.failed ?? hasErrors(diagnostics);
    const status = result.status ?? (failed ? 'error' : diagnostics.some((d) => d.severity === 'warning') ? 'warning' : 'success');
    phases[id] = { ...meta, status, output: result.output ?? null, diagnostics, durationMs: now() - t0, note: result.note ?? null };
    if (status === 'error') stoppedAt = id;
    return result.output ?? null;
  };

  // 1. Lexical analysis -------------------------------------------------------
  const lexical = run('lexical', () => {
    const { tokens, symbolTable, errors } = tokenize(source, MINIC_TOKEN_SPECS);
    return {
      output: { tokens, identifiers: symbolTable },
      diagnostics: errors.map((e) => error('lexical', 'invalid-token', e.message, e)),
    };
  });

  // 2. Syntax analysis --------------------------------------------------------
  const syntax = run('syntax', () => {
    const { ast, diagnostics, nodeCount } = parseProgram(lexical.tokens);
    return { output: { ast, nodeCount }, diagnostics };
  });

  // 3. Semantic analysis ------------------------------------------------------
  const semantic = run('semantic', () => {
    const result = analyzeProgram(syntax.ast);
    const { diagnostics, ...output } = result;
    return { output, diagnostics };
  });

  // 4. Intermediate code ------------------------------------------------------
  const ir = run('ir', () => {
    const generated = generateIR(syntax.ast, semantic);
    const problems = validateIR(generated.instructions);
    if (problems.length) {
      return { output: generated, diagnostics: [makeDiagnostic('error', 'ir', 'invalid-ir', `Generated IR is invalid: ${problems[0]}`)] };
    }
    const triples = toTriples(generated.instructions);
    return {
      output: {
        ...generated,
        text: formatProgram(generated.instructions),
        quadruples: toQuadruples(generated.instructions),
        triples,
        indirectTriples: toIndirectTriples(triples),
        cfg: buildBasicBlocksAndCFG(generated.instructions),
      },
      diagnostics: [],
    };
  });

  // Observable behaviour is the program's output and run-time errors. With
  // preserveVariables the final values of user variables are observable too, so they
  // are treated as live at exit and compared by the validation checks.
  const liveAtExit = ir && options.preserveVariables ? ir.variables.map((v) => v.name) : [];

  // 5. Optimization -------------------------------------------------------------
  const optimization = run('optimization', () => {
    if (!options.optimize) {
      return {
        status: 'disabled',
        output: { enabled: false, instructions: ir.instructions, log: [], stats: {}, before: ir.instructions.length, after: ir.instructions.length, cfg: ir.cfg, text: ir.text, equivalence: null },
        diagnostics: [],
        note: 'Optimization disabled: target code is generated from the unoptimized IR.',
      };
    }
    const result = optimizeIR(ir.instructions, { liveAtExit, passes: options.passes });
    const original = runIR(ir.instructions, { inputs: options.inputs, maxSteps: options.maxSteps });
    const optimized = runIR(result.instructions, { inputs: options.inputs, maxSteps: options.maxSteps });
    const equivalence = compareRuns(original, optimized, liveAtExit);
    const diagnostics = equivalence.equal
      ? []
      : [makeDiagnostic('error', 'optimization', 'optimization-changed-behaviour', `Optimised IR behaves differently from the original for these inputs: ${equivalence.difference}`)];
    return {
      output: {
        enabled: true,
        ...result,
        text: formatProgram(result.instructions),
        cfg: buildBasicBlocksAndCFG(result.instructions),
        equivalence: { ...equivalence, inputs: [...options.inputs], original: summarizeRun(original), optimized: summarizeRun(optimized) },
      },
      diagnostics,
    };
  });

  // 6. Target code generation -------------------------------------------------
  const codegen = run('codegen', () => {
    const source = optimization.instructions;
    const gen = generateTargetCode(source, { liveAtExit, registerCount: options.registerCount, strategy: options.strategy });
    const program = assemble(gen.code, options.registerCount);
    const diagnostics = program.problems.map((p) => makeDiagnostic('error', 'codegen', 'invalid-target-code', `Generated target code is invalid: ${p}`));
    return {
      output: {
        ...gen,
        program,
        listing: formatTargetProgram(gen.code),
        strategy: options.strategy,
        registerCount: options.registerCount,
        fromIR: source,
      },
      diagnostics,
    };
  });

  // 7. Execution on the virtual CPU ------------------------------------------
  run('execution', () => {
    if (!options.execute) {
      return { status: 'disabled', output: null, diagnostics: [], note: 'Execution disabled.' };
    }
    const { state, trace, truncated } = runProgram(codegen.program, { inputs: options.inputs, maxSteps: options.maxSteps, traceLimit: options.traceLimit });
    const reference = runIR(optimization.instructions, { inputs: options.inputs, maxSteps: options.maxSteps });
    const cpuRun = {
      status: state.status === 'halted' ? 'halted' : 'error',
      output: state.output,
      error: state.error,
      memory: state.memory,
    };
    const agreement = compareRuns(reference, cpuRun, liveAtExit);
    const diagnostics = [];
    if (state.status === 'error') {
      diagnostics.push(makeDiagnostic('error', 'execution', `runtime-${state.error.kind}`, `Run-time error at address ${state.error.pc}: ${state.error.message}`));
    }
    if (!agreement.equal) {
      diagnostics.push(makeDiagnostic('error', 'execution', 'cpu-ir-mismatch', `Virtual CPU disagrees with the IR interpreter: ${agreement.difference}`));
    }
    if (state.status === 'halted' && options.inputs.length > state.inputPos) {
      diagnostics.push(warning('execution', 'unused-input', `${options.inputs.length - state.inputPos} input value(s) were not read.`));
    }
    return {
      output: { state, trace, truncated, reference: summarizeRun(reference), agreement },
      diagnostics,
    };
  });

  const diagnostics = PHASES.flatMap((p) => phases[p.id].diagnostics);
  const ok = PHASES.every((p) => ['success', 'warning', 'disabled'].includes(phases[p.id].status));
  return { source, options, phases, diagnostics, ok, stoppedAt };
}

function summarizeRun(r) {
  return {
    status: r.status,
    output: r.output.map((o) => o.text),
    error: r.error ? { kind: r.error.kind, message: r.error.message } : null,
    steps: r.steps,
  };
}

/** Compare two executions by observable behaviour: status, error kind, output, final variables. */
export function compareRuns(a, b, variables) {
  const outA = a.output.map((o) => o.text);
  const outB = b.output.map((o) => o.text);
  if (a.status !== b.status) return { equal: false, difference: `one run ${a.status === 'error' ? 'failed' : 'halted'}, the other ${b.status === 'error' ? 'failed' : 'halted'}` };
  if ((a.error?.kind ?? null) !== (b.error?.kind ?? null)) return { equal: false, difference: `different errors (${a.error?.kind} vs ${b.error?.kind})` };
  if (outA.length !== outB.length || outA.some((v, i) => v !== outB[i])) {
    return { equal: false, difference: `outputs differ ([${outA.join(', ')}] vs [${outB.join(', ')}])` };
  }
  if (a.status === 'halted') {
    for (const v of variables) {
      if (a.memory[v] !== b.memory[v]) return { equal: false, difference: `final value of '${v}' differs (${a.memory[v]} vs ${b.memory[v]})` };
    }
  }
  return { equal: true, difference: null };
}
