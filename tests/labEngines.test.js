import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSDT } from '../src/engine/semantics.js';
import { generateBackpatching, translateSwitchCase, parseSwitchCases } from '../src/engine/icgEngine.js';

// --------------------------------------------------------------------- SDT
test('SDT evaluates with correct precedence (legacy bug B2: 3 + 5 * 2 was 10)', () => {
  assert.equal(evaluateSDT('3 + 5 * 2').evaluatedValue, 13);
  assert.equal(evaluateSDT('(3 + 5) * 2').evaluatedValue, 16);
  assert.equal(evaluateSDT('20 - 4 - 6').evaluatedValue, 10); // left-associative
  assert.equal(evaluateSDT('7 / 2').evaluatedValue, 3);
  assert.equal(evaluateSDT('42').evaluatedValue, 42);
});

test('S-attributed tree follows the left-recursive grammar and is annotated bottom-up', () => {
  const r = evaluateSDT('2 * 3 + 4');
  const root = r.annotatedTree;
  assert.equal(root.label, 'E');
  assert.equal(root.sublabel, 'val=10');
  assert.deepEqual(root.children.map((c) => c.label), ['E', '+', 'T']);
  // Post-order: the first reduction computed is F → num for the leftmost number.
  assert.match(r.stepLogs[0], /^F → num\s+F.val = num.lexval = 2$/);
  assert.match(r.stepLogs.at(-1), /^E → E1 \+ T\s+E.val = 6 \+ 4 = 10$/);
});

test('L-attributed evaluation passes the running value down as an inherited attribute', () => {
  const r = evaluateSDT('8 - 3 - 1');
  assert.equal(r.lAttributed.value, 4);
  assert.ok(r.lAttributed.logs.some((l) => l.startsWith("E'1.inh = E'.inh − T.val = 8 − 3 = 5")));
  assert.ok(r.lAttributed.logs.some((l) => l === "E' → ε: E'.syn = E'.inh = 4"));
});

test('SDT reports syntax errors and division by zero', () => {
  assert.throws(() => evaluateSDT('3 +'), /Expected a number/);
  assert.throws(() => evaluateSDT('(1 + 2'), /Expected '\)'/);
  assert.throws(() => evaluateSDT('2 $ 3'), /Unexpected character/);
  assert.throws(() => evaluateSDT('1 / (2 - 2)'), /Division by zero/);
});

// ------------------------------------------------------------- backpatching
test('backpatching reproduces the Dragon Book example a < b || c < d && e < f (legacy bug B14)', () => {
  const r = generateBackpatching('a < b || c < d && e < f');
  assert.deepEqual(r.backpatchedCode.map((q) => `${q.quad}: ${q.instruction}`), [
    '100: if a < b goto _',
    '101: goto 102',
    '102: if c < d goto 104',
    '103: goto _',
    '104: if e < f goto _',
    '105: goto _',
  ]);
  assert.deepEqual(r.truelist, [100, 104]);
  assert.deepEqual(r.falselist, [103, 105]);
  assert.ok(r.originalCode.every((q) => q.instruction.endsWith('_')));
});

test('backpatching depends on the input expression', () => {
  const r = generateBackpatching('not (x > 0) and y == 1');
  // !(x > 0) swaps lists: its falselist (the goto) is the true exit of the operand.
  assert.deepEqual(r.backpatchedCode.map((q) => `${q.quad}: ${q.instruction}`), [
    '100: if x > 0 goto _',
    '101: goto 102',
    '102: if y == 1 goto _',
    '103: goto _',
  ]);
  assert.deepEqual(r.truelist, [102]);
  assert.deepEqual(r.falselist, [100, 103]);
});

test('backpatching rejects malformed expressions', () => {
  assert.throws(() => generateBackpatching('a <'), /identifier or number/);
  assert.throws(() => generateBackpatching('a b'), /relational operator/);
  assert.throws(() => generateBackpatching('(a < b'), /Expected '\)'/);
});

// --------------------------------------------------------------------- switch
test('switch translation jumps to default, or out of the switch when there is none (legacy bug B15)', () => {
  const withDefault = translateSwitchCase('ch', [{ val: 1, action: 'r = 10' }, { val: 2, action: 'r = 20' }], 'r = 0').tac;
  assert.equal(withDefault.at(-2).trim(), 'goto Ld');
  assert.ok(withDefault.includes('Ld:'));
  const noDefault = translateSwitchCase('ch', [{ val: 1, action: 'r = 10' }]).tac;
  assert.match(noDefault.at(-2), /goto next/);
});

test('switch case parsing', () => {
  const { cases, defaultAction } = parseSwitchCases("1: x = 10\n2: x = 20\ndefault: x = 0");
  assert.equal(cases.length, 2);
  assert.equal(defaultAction, 'x = 0');
  assert.throws(() => parseSwitchCases('oops'), /Line 1/);
  assert.throws(() => translateSwitchCase('c', [{ val: 1, action: 'a' }, { val: 1, action: 'b' }]), /Duplicate case/);
});
