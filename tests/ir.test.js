import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frontEnd, outputsOf } from './helpers.js';
import { formatInstruction, validateIR, toQuadruples, toTriples } from '../src/engine/ir.js';
import { runIR } from '../src/engine/irInterpreter.js';
import { evalBinary } from '../src/engine/intArith.js';

const tac = (src) => frontEnd(src).instructions.map(formatInstruction);
const run = (src, inputs = []) => runIR(frontEnd(src).instructions, { inputs });

// --------------------------------------------------------------- arithmetic
test('intArith: C division/modulo semantics and 32-bit wrap-around', () => {
  assert.equal(evalBinary('/', 7, 2), 3);
  assert.equal(evalBinary('/', -7, 2), -3);
  assert.equal(evalBinary('%', -7, 2), -1);
  assert.equal(evalBinary('%', 7, -2), 1);
  assert.equal(evalBinary('+', 2147483647, 1), -2147483648);
  assert.equal(evalBinary('*', 65536, 65536), 0);
  assert.equal(evalBinary('/', -2147483648, -1), -2147483648);
  assert.throws(() => evalBinary('/', 1, 0), /Division by zero/);
  assert.throws(() => evalBinary('%', 1, 0), /Modulo by zero/);
});

// ------------------------------------------------------------ IR generation
test('irgen: nested arithmetic respects precedence and writes the result directly', () => {
  assert.deepEqual(tac('int a = 1; int b = 2; int c = 3; int x = a + b * c;').slice(3), [
    't1 = b * c',
    'x = a + t1',
  ]);
  assert.deepEqual(tac('int a = 1; int x = (a - 2) * -a;').slice(1), ['t1 = a - 2', 't2 = -a', 'x = t1 * t2']);
});

test('irgen: declarations without initializer store 0; shadowed variables get unique names', () => {
  assert.deepEqual(tac('int x; { int x = 5; print(x); } print(x);'), ['x = 0', 'x.2 = 5', 'print x.2', 'print x']);
});

test('irgen: temporaries never collide with user variables named like temps', () => {
  const lines = tac('int t1 = 2; int t2 = 3; print(t1 * t2 + 1);');
  assert.deepEqual(lines, ['t1 = 2', 't2 = 3', 't3 = t1 * t2', 't4 = t3 + 1', 'print t4']);
});

test('irgen: if/else uses a negated test that falls through into the then-branch', () => {
  assert.deepEqual(tac('int a = 1; if (a < 5) print(1); else print(2);'), [
    'a = 1',
    'if a >= 5 goto L1',
    'print 1',
    'goto L2',
    'L1:',
    'print 2',
    'L2:',
  ]);
});

test('irgen: while loop layout', () => {
  assert.deepEqual(tac('int i = 0; while (i < 3) i = i + 1;'), [
    'i = 0',
    'L1:',
    'if i >= 3 goto L2',
    'i = i + 1',
    'goto L1',
    'L2:',
  ]);
});

test('irgen: && and || in conditions use short-circuit jumping code', () => {
  assert.deepEqual(tac('int a = 1; int b = 2; if (a < b && b < 9 || a == 0) print(a);'), [
    'a = 1',
    'b = 2',
    'if a >= b goto L3',
    'if b < 9 goto L2',
    'L3:',
    'if a != 0 goto L1',
    'L2:',
    'print a',
    'L1:',
  ]);
});

test('irgen: bool values in value context', () => {
  assert.deepEqual(tac('int a = 1; bool f = a < 2; print(!f);'), ['a = 1', 'f = a < 2', 't1 = !f', 'print t1  (bool)']);
  assert.deepEqual(tac('bool p = true; bool q = p && false;').slice(1), [
    'if p == 0 goto L1',
    'goto L1',
    'q = 1',
    'goto L2',
    'L1:',
    'q = 0',
    'L2:',
  ]);
});

test('irgen: generated IR is structurally valid', () => {
  const ir = frontEnd('int n = input(); int f = 1; while (n > 1 && f < 1000) { f = f * n; n = n - 1; } print(f);');
  assert.deepEqual(validateIR(ir.instructions), []);
});

test('validateIR catches dangling branch targets and bad operands', () => {
  const bad = [
    { op: 'goto', target: 'L9' },
    { op: 'binary', operator: '+', dest: { kind: 'const', value: 1 }, left: { kind: 'const', value: 1 }, right: { kind: 'const', value: 2 } },
  ];
  const problems = validateIR(bad);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /undefined label L9/);
});

// ------------------------------------------------------------- interpreter
test('interpreter: arithmetic, C division semantics and bool printing', () => {
  const r = run('int a = 7; int b = 3; print(a / b); print(a % b); print(-a / b); print(-a % b); print(a > b);');
  assert.equal(r.status, 'halted');
  assert.deepEqual(outputsOf(r), ['2', '1', '-2', '-1', 'true']);
});

test('interpreter: factorial with input', () => {
  const src = 'int n = input(); int f = 1; while (n > 1) { f = f * n; n = n - 1; } print(f);';
  assert.deepEqual(outputsOf(run(src, [5])), ['120']);
  assert.deepEqual(outputsOf(run(src, [10])), ['3628800']);
  assert.deepEqual(outputsOf(run(src, [0])), ['1']);
});

test('interpreter: short-circuit && avoids a division by zero', () => {
  const r = run('int d = 0; if (d != 0 && 10 / d > 1) print(1); else print(0);');
  assert.deepEqual(outputsOf(r), ['0']);
});

test('interpreter: run-time errors are structured', () => {
  const div = run('int z = 0; print(5 / z);');
  assert.equal(div.status, 'error');
  assert.equal(div.error.kind, 'DivisionByZero');
  assert.equal(div.error.instruction, 't1 = 5 / z');

  const loop = runIR(frontEnd('while (true) { }').instructions, { maxSteps: 500 });
  assert.equal(loop.error.kind, 'StepLimitExceeded');

  assert.equal(run('print(input());').error.kind, 'InputExhausted');
});

test('interpreter: 32-bit overflow wraps', () => {
  assert.deepEqual(outputsOf(run('print(2147483647 + 1);')), ['-2147483648']);
});

// ------------------------------------------------------- quadruples/triples
test('quadruples mirror the TAC', () => {
  const q = toQuadruples(frontEnd('int a = 2; int x = a + 3 * a;').instructions);
  assert.deepEqual(q[1], { op: '*', arg1: '3', arg2: 'a', result: 't1' });
  assert.deepEqual(q[2], { op: '+', arg1: 'a', arg2: 't1', result: 'x' });
});

test('triples refer to single-definition temporaries by position', () => {
  const t = toTriples(frontEnd('int a = 2; int x = a + 3 * a;').instructions);
  assert.deepEqual(t.map((r) => `${r.op} ${r.arg1} ${r.arg2}`.trim()), ['= a 2', '* 3 a', '+ a (1)', '= x (2)']);
});

test('triples resolve jump targets to triple positions', () => {
  const t = toTriples(frontEnd('int i = 0; while (i < 2) i = i + 1;').instructions);
  const text = t.map((r) => `(${r.index}) ${r.op} ${r.arg1} ${r.arg2}`.trim());
  assert.deepEqual(text, [
    '(0) = i 0',
    '(1) >= i 2',
    '(2) iftrue (1) (end)',
    '(3) + i 1',
    '(4) = i (3)',
    '(5) goto (1)',
  ]);
});
