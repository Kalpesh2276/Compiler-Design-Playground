import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frontEnd, outputsOf } from './helpers.js';
import { CORPUS } from './corpus.js';
import { formatInstruction, validateIR } from '../src/engine/ir.js';
import { runIR } from '../src/engine/irInterpreter.js';
import { optimizeIR, DEFAULT_PASSES } from '../src/engine/optimizer.js';
import {
  buildBasicBlocksAndCFG,
  computeReachingDefinitions,
  computeLiveness,
  buildBlockDAG,
} from '../src/engine/optimizationCFG.js';

const userVars = (ir) => ir.variables.map((v) => v.name);
const optimize = (ir, passes) => optimizeIR(ir.instructions, { liveAtExit: userVars(ir), passes });
const text = (instrs) => instrs.map(formatInstruction);

function observable(result, ir) {
  if (result.status === 'error') return { error: result.error.kind, output: outputsOf(result) };
  const vars = Object.fromEntries(userVars(ir).map((v) => [v, result.memory[v]]));
  return { output: outputsOf(result), vars };
}

// --------------------------------------------------------------- corpus
for (const program of CORPUS) {
  test(`corpus: reference interpreter gives the expected result – ${program.name}`, () => {
    const ir = frontEnd(program.source);
    for (const [inputs, expected] of program.runs) {
      const r = runIR(ir.instructions, { inputs });
      if (expected.error) assert.equal(r.error?.kind, expected.error, `inputs ${inputs}`);
      else {
        assert.equal(r.status, 'halted', r.error?.message);
        assert.deepEqual(outputsOf(r), expected, `inputs ${inputs}`);
      }
    }
  });
}

const PASS_CONFIGS = [
  ['all passes', {}],
  ...Object.keys(DEFAULT_PASSES).map((only) => [
    `only ${only}`,
    Object.fromEntries(Object.keys(DEFAULT_PASSES).map((k) => [k, k === only])),
  ]),
];

for (const program of CORPUS) {
  test(`corpus: optimisation preserves output, errors and final variables – ${program.name}`, () => {
    const ir = frontEnd(program.source);
    for (const [label, passes] of PASS_CONFIGS) {
      const opt = optimize(ir, passes);
      assert.deepEqual(validateIR(opt.instructions), [], label);
      for (const [inputs] of program.runs) {
        const original = observable(runIR(ir.instructions, { inputs }), ir);
        const optimized = observable(runIR(opt.instructions, { inputs }), ir);
        assert.deepEqual(optimized, original, `${label}, inputs ${inputs}`);
      }
    }
  });
}

// ------------------------------------------------------- specific passes
test('constant propagation + folding collapse a straight-line computation', () => {
  const ir = frontEnd('int a = 4 + 5; int b = a * 2; int c = b + 10; print(c);');
  const opt = optimize(ir);
  assert.deepEqual(text(opt.instructions), ['a = 9', 'b = 18', 'c = 28', 'print 28']);
  assert.ok(opt.log.some((e) => e.action === 'constant folding'));
});

test('constant propagation is not fooled by reassignment (legacy bug B5)', () => {
  const ir = frontEnd('int b = input(); int a = 5; a = b + 1; int c = a; print(c);');
  const opt = optimize(ir);
  assert.ok(!text(opt.instructions).includes('print 5'));
  assert.deepEqual(outputsOf(runIR(opt.instructions, { inputs: [10] })), ['11']);
});

test('constants merge correctly at control-flow joins', () => {
  // x is 1 on one path and 2 on the other: it must NOT be treated as a constant after the join.
  const ir = frontEnd('int x = 0; if (input() > 0) x = 1; else x = 2; print(x);');
  const opt = optimize(ir);
  assert.ok(text(opt.instructions).includes('print x'));
  // Same value on both paths: it IS a constant.
  const same = optimize(frontEnd('int x = 0; if (input() > 0) x = 7; else x = 7; print(x);'));
  assert.ok(text(same.instructions).includes('print 7'));
});

test('loop-carried variables are not treated as constants', () => {
  const ir = frontEnd('int i = 0; while (i < 3) { i = i + 1; } print(i);');
  const opt = optimize(ir);
  assert.ok(text(opt.instructions).includes('i = i + 1'));
  assert.deepEqual(outputsOf(runIR(opt.instructions)), ['3']);
});

test('division by zero is never folded away or removed as dead code', () => {
  const ir = frontEnd('int z = 0; int unused = 10 / z; print(1);');
  const opt = optimize(ir);
  assert.ok(text(opt.instructions).some((l) => l.includes('10 / 0')));
  assert.equal(runIR(opt.instructions).error.kind, 'DivisionByZero');
});

test('dead-code elimination keeps prints and inputs, removes unused temporaries', () => {
  const ir = frontEnd('int a = input(); int b = a * 2; int c = b + 1; b = 5; print(b);');
  const opt = optimize(ir);
  const lines = text(opt.instructions);
  assert.ok(lines.includes('a = input()'));
  assert.ok(lines.some((l) => l.startsWith('print')));
  // the first value of b (a * 2) is overwritten before use, except through c, which is live at exit
  assert.equal(new Set(lines).size, lines.length);
});

test('a user variable whose name starts with t is not deleted (legacy bug B6)', () => {
  const ir = frontEnd('int total = 5; print(1);');
  assert.ok(text(optimize(ir).instructions).includes('total = 5'));
});

test('common subexpression elimination reuses an earlier result within a block', () => {
  const ir = frontEnd('int x = input(); int y = input(); int p = (x + y) * (y + x); print(p);');
  const opt = optimize(ir, { constantPropagation: false });
  const lines = text(opt.instructions);
  assert.equal(lines.filter((l) => / = x \+ y$| = y \+ x$/.test(l)).length, 1);
  assert.ok(opt.log.some((e) => e.pass === 'cse'));
  assert.deepEqual(outputsOf(runIR(opt.instructions, { inputs: [2, 3] })), ['25']);
});

test('CSE is invalidated when an operand is reassigned', () => {
  const ir = frontEnd('int x = input(); int a = x + 1; x = 7; int b = x + 1; print(a); print(b);');
  const opt = optimize(ir, { constantPropagation: false });
  assert.deepEqual(outputsOf(runIR(opt.instructions, { inputs: [1] })), ['2', '8']);
});

test('constant branches are folded and unreachable code removed with valid targets', () => {
  const ir = frontEnd('if (3 > 5) print(1); else print(2); while (false) print(9);');
  const opt = optimize(ir);
  assert.deepEqual(text(opt.instructions), ['print 2']);
});

test('optimisation never increases the instruction count on the corpus', () => {
  for (const p of CORPUS) {
    const ir = frontEnd(p.source);
    assert.ok(optimize(ir).instructions.length <= ir.instructions.length, p.name);
  }
});

test('optimizeIR does not mutate its input', () => {
  const ir = frontEnd('int a = 1 + 2; print(a);');
  const snapshot = JSON.stringify(ir.instructions);
  optimize(ir);
  assert.equal(JSON.stringify(ir.instructions), snapshot);
});

// ------------------------------------------------------------- CFG / data flow
test('basic blocks: leaders are first instruction, labels, and instructions after jumps', () => {
  const ir = frontEnd('int i = 0; while (i < 3) i = i + 1; print(i);');
  // i = 0 | L1: if i >= 3 goto L2 | i = i + 1; goto L1 | L2: print i
  const cfg = buildBasicBlocksAndCFG(ir.instructions);
  assert.deepEqual(cfg.blocks.map((b) => text(b.instructions).join('; ')), [
    'i = 0',
    'L1:; if i >= 3 goto L2',
    'i = i + 1; goto L1',
    'L2:; print i',
  ]);
  const edges = cfg.edges.map((e) => `${e.from}->${e.to}:${e.kind}`);
  assert.deepEqual(edges, ['B1->B2:fallthrough', 'B2->B4:branch', 'B2->B3:fallthrough', 'B3->B2:jump', 'B4->EXIT:fallthrough']);
});

test('reaching definitions on a loop', () => {
  const ir = frontEnd('int i = 0; while (i < 3) i = i + 1; print(i);');
  const rd = computeReachingDefinitions(buildBasicBlocksAndCFG(ir.instructions));
  // d1: i = 0 (B1), d2: i = i + 1 (B3)
  const b = Object.fromEntries(rd.blocks.map((r) => [r.blockId, r]));
  assert.deepEqual(b.B1.gen, ['d1']);
  assert.deepEqual(b.B1.kill, ['d2']);
  assert.deepEqual(b.B2.in, ['d1', 'd2']);
  assert.deepEqual(b.B3.out, ['d2']);
  assert.deepEqual(b.B4.in, ['d1', 'd2']);
});

test('liveness on a loop', () => {
  const ir = frontEnd('int i = 0; int s = 0; while (i < 3) { s = s + i; i = i + 1; } print(s);');
  const live = computeLiveness(buildBasicBlocksAndCFG(ir.instructions), []);
  const b = Object.fromEntries(live.blocks.map((r) => [r.blockId, r]));
  assert.deepEqual(b.B2.in, ['i', 's']); // loop header
  assert.deepEqual(b.B4.in, ['s']); // after the loop only s is needed
  assert.deepEqual(b.B4.out, []);
});

test('DAG of a block detects the common subexpression', () => {
  const ir = frontEnd('int a = input(); int b = input(); int x = a + b; int y = b + a; print(x * y);');
  const { dagNodes, commonSubexpressions } = buildBlockDAG(ir.instructions);
  assert.equal(commonSubexpressions.length, 1);
  const plus = dagNodes.filter((n) => n.label === '+');
  assert.equal(plus.length, 1);
  assert.deepEqual(plus[0].labels, ['x', 'y']);
});

test('copy propagation stops when the copied-from variable is reassigned', () => {
  // y = x; x = 5; print(y) must print the ORIGINAL x, not 5.
  const ir = frontEnd('int x = input(); int y = x; x = 5; print(y); print(x);');
  for (const passes of [{}, { constantPropagation: false, cse: false, deadCode: false }]) {
    const opt = optimize(ir, passes);
    assert.deepEqual(outputsOf(runIR(opt.instructions, { inputs: [9] })), ['9', '5']);
  }
});
