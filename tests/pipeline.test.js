import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, PHASES } from '../src/pipeline/compile.js';
import { EXAMPLES, findExample } from '../src/pipeline/examples.js';

const statuses = (r) => PHASES.map((p) => r.phases[p.id].status);
const output = (r) => r.phases.execution.output.state.output.map((o) => o.text);
const errorCodes = (r) => r.diagnostics.filter((d) => d.severity === 'error').map((d) => d.code);

test('pipeline 1: simple arithmetic expression end to end', () => {
  const r = compile('print(2 + 3 * 4);');
  assert.equal(r.ok, true);
  assert.deepEqual(statuses(r), Array(7).fill('success'));
  assert.deepEqual(output(r), ['14']);
  // The output really comes from the CPU executing target code.
  assert.ok(r.phases.execution.output.trace.some((e) => e.text.startsWith('OUT')));
});

test('pipeline 2: multiple assignments and variable usage', () => {
  const r = compile('int a = 5; int b = a * 2; a = b - a; print(a); print(b);', { preserveVariables: true });
  assert.deepEqual(output(r), ['5', '10']);
  assert.equal(r.phases.execution.output.state.memory.a, 5);
  assert.equal(r.phases.execution.output.state.memory.b, 10);
});

test('pipeline: unused variables are dead by default and kept with preserveVariables', () => {
  const src = 'int x = input(); int unused = x * 99; print(x);';
  const lean = compile(src, { inputs: [2] });
  assert.ok(!lean.phases.optimization.output.text.includes('unused'));
  assert.equal(lean.phases.execution.output.state.memory.unused, undefined);
  const kept = compile(src, { inputs: [2], preserveVariables: true });
  assert.ok(kept.phases.optimization.output.text.includes('unused'));
  assert.equal(kept.phases.execution.output.state.memory.unused, 198);
  assert.deepEqual(output(lean), output(kept));
});

test('pipeline 3: nested arithmetic and parentheses', () => {
  assert.deepEqual(output(compile('int x = 3; print(((x + 1) * (x - 1)) / (x - 1) - -x);')), ['7']);
});

test('pipeline 4: syntax error stops dependent phases but keeps lexical output', () => {
  const r = compile('int a = 5\nprint(a);');
  assert.equal(r.ok, false);
  assert.equal(r.stoppedAt, 'syntax');
  assert.deepEqual(statuses(r), ['success', 'error', 'skipped', 'skipped', 'skipped', 'skipped', 'skipped']);
  assert.ok(r.phases.lexical.output.tokens.length > 0);
  assert.match(r.phases.semantic.note, /syntax analysis failed/);
  assert.equal(r.diagnostics[0].span.line, 2);
});

test('pipeline 5: semantic error', () => {
  const r = compile('int a = 1; print(b);');
  assert.equal(r.stoppedAt, 'semantic');
  assert.deepEqual(errorCodes(r), ['undeclared-variable']);
  assert.equal(r.phases.ir.status, 'skipped');
  assert.ok(r.phases.syntax.output.ast);
});

test('pipeline 6: optimisation example is transformed and validated', () => {
  const ex = findExample('optimizable');
  const r = compile(ex.source, { inputs: ex.inputs });
  const opt = r.phases.optimization.output;
  assert.equal(r.ok, true);
  assert.ok(opt.after < opt.before);
  assert.ok(opt.stats.constantPropagation > 0 && opt.stats.cse > 0 && opt.stats.deadCode > 0);
  assert.equal(opt.equivalence.equal, true);
  assert.deepEqual(output(r), ['59', '1']); // (3+4)^2 + 10
  // Disabling optimisation gives the same observable result.
  const plain = compile(ex.source, { inputs: ex.inputs, optimize: false });
  assert.equal(plain.phases.optimization.status, 'disabled');
  assert.deepEqual(output(plain), ['59', '1']);
  assert.ok(plain.phases.codegen.output.code.length > r.phases.codegen.output.code.length);
});

test('pipeline 7: conditional program', () => {
  const src = 'int n = input(); if (n % 2 == 0) print(0); else print(1);';
  assert.deepEqual(output(compile(src, { inputs: [10] })), ['0']);
  assert.deepEqual(output(compile(src, { inputs: [7] })), ['1']);
});

test('pipeline 8: loop program', () => {
  const ex = findExample('factorial');
  assert.deepEqual(output(compile(ex.source, { inputs: [6] })), ['720']);
});

test('pipeline: lexical error stops everything after the lexer', () => {
  const r = compile('int a = 3 $ 4;');
  assert.equal(r.stoppedAt, 'lexical');
  assert.equal(r.diagnostics[0].phase, 'lexical');
  assert.equal(r.diagnostics[0].span.col, 11);
});

test('pipeline: run-time error is reported by the execution phase with earlier phases intact', () => {
  const r = compile('int d = input(); print(100 / d);', { inputs: [0] });
  assert.equal(r.phases.codegen.status, 'success');
  assert.equal(r.phases.execution.status, 'error');
  assert.deepEqual(errorCodes(r), ['runtime-DivisionByZero']);
  assert.equal(r.phases.execution.output.agreement.equal, true); // CPU and IR agree on the error
});

test('pipeline: infinite loops hit the step budget instead of hanging', () => {
  const r = compile('int x = input(); while (x > 0) { x = x + 1; }', { inputs: [1], maxSteps: 2000 });
  assert.equal(r.phases.execution.output.state.error.kind, 'StepLimitExceeded');
});

test('pipeline: missing inputs are a run-time error; unused inputs are a warning', () => {
  assert.deepEqual(errorCodes(compile('print(input());')), ['runtime-InputExhausted']);
  const extra = compile('print(input());', { inputs: [1, 2] });
  assert.equal(extra.ok, true);
  assert.equal(extra.phases.execution.status, 'warning');
});

test('pipeline: internal engine exceptions become diagnostics, not crashes', () => {
  const r = compile('print(1);', { registerCount: 2 });
  assert.equal(r.phases.codegen.status, 'error');
  assert.deepEqual(errorCodes(r), ['internal-error']);
  assert.equal(r.phases.execution.status, 'skipped');
});

test('pipeline: options are validated at the boundary', () => {
  assert.throws(() => compile(42), /source must be a string/);
  assert.throws(() => compile('', { inputs: ['x'] }), /inputs must be an array of integers/);
});

test('pipeline: empty program compiles to HALT', () => {
  const r = compile('// nothing\n');
  assert.equal(r.ok, true);
  assert.equal(r.phases.codegen.output.listing.trim(), 'HALT');
});

test('pipeline: each compile() is independent and deterministic', () => {
  const ex = findExample('gcd');
  const a = compile(ex.source, { inputs: ex.inputs });
  const b = compile(ex.source, { inputs: ex.inputs });
  assert.deepEqual(output(a), ['12']);
  assert.deepEqual(a.phases.execution.output.state, b.phases.execution.output.state);
  assert.equal(a.phases.codegen.output.listing, b.phases.codegen.output.listing);
});

// ----------------------------------------------------------- bundled examples
const EXPECTED = {
  arithmetic: { ok: true, output: ['13', '20', '2', '-1'] },
  factorial: { ok: true, output: ['120'] },
  gcd: { ok: true, output: ['12'] },
  optimizable: { ok: true, output: ['59', '1'] },
  primes: { ok: true, output: ['2', '3', '5', '7', '11', '13', '17', '19', '23', '29'] },
  pressure: { ok: true, output: ['51'] },
  booleans: { ok: true, output: ['false', 'true', 'false'] },
  scopes: { ok: true, output: ['20', '1'] },
  'syntax-error': { ok: false, stoppedAt: 'syntax', errors: 2 },
  'semantic-error': { ok: false, stoppedAt: 'semantic', errors: 4 },
  'runtime-error': { ok: false, stoppedAt: 'execution', errors: 1 },
};

for (const ex of EXAMPLES) {
  test(`example '${ex.title}' behaves as documented`, () => {
    const want = EXPECTED[ex.id];
    assert.ok(want, `no expectation for example ${ex.id}`);
    const r = compile(ex.source, { inputs: ex.inputs });
    assert.equal(r.ok, want.ok, JSON.stringify(r.diagnostics, null, 1));
    if (want.output) assert.deepEqual(output(r), want.output);
    if (want.stoppedAt) assert.equal(r.stoppedAt, want.stoppedAt);
    if (want.errors) assert.equal(errorCodes(r).length, want.errors, errorCodes(r).join());
  });
}
