import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frontEnd } from './helpers.js';
import { CORPUS } from './corpus.js';
import { buildBasicBlocksAndCFG } from '../src/engine/optimizationCFG.js';
import { convertToSSA, scheduleInstructions, analyzeLoopVectorization } from '../src/engine/parallelismSSA.js';
import { computeNextUse, buildInterferenceGraph, colorInterferenceGraph, generateActivationRecord } from '../src/engine/codeGenModule6.js';

// ------------------------------------------------------------------- SSA
test('SSA: φ at the join of an if/else', () => {
  const ssa = convertToSSA(frontEnd('int x = input(); if (x > 0) x = 1; else x = 2; print(x);').instructions);
  assert.equal(ssa.verified, true);
  assert.equal(ssa.phiCount, 1);
  const join = ssa.blocks.find((b) => b.phis.length);
  assert.equal(join.phis[0].variable, 'x');
  assert.deepEqual(join.phis[0].args.map((a) => a.value).sort(), ['x_2', 'x_3']);
  assert.match(join.lines.at(-1), /^print x_4$/);
});

test('SSA: loop header φ merges the initial and the loop-carried value', () => {
  const ssa = convertToSSA(frontEnd('int i = 0; while (i < 3) i = i + 1; print(i);').instructions);
  const header = ssa.blocks.find((b) => b.id === 'B2');
  assert.deepEqual(header.phis.map((p) => `${p.dest} = φ(${p.args.map((a) => `${a.from}:${a.value}`).join(', ')})`), ['i_2 = φ(B1:i_1, B3:i_3)']);
  const dom = Object.fromEntries(ssa.dominators.map((d) => [d.block, d]));
  assert.equal(dom.B3.idom, 'B2');
  assert.equal(dom.B4.idom, 'B2');
  assert.deepEqual(dom.B3.frontier, ['B2']);
});

test('SSA is pruned: no φ for a variable that is dead at the join', () => {
  const ssa = convertToSSA(frontEnd('int x = input(); int y = 0; if (x > 0) y = 1; else y = 2; print(x);').instructions);
  assert.equal(ssa.phiCount, 0);
});

test('SSA: every corpus program converts with a single definition per name', () => {
  for (const p of CORPUS) {
    const ssa = convertToSSA(frontEnd(p.source).instructions);
    assert.equal(ssa.verified, true, p.name);
  }
});

// ------------------------------------------------------------- scheduling
test('scheduling respects every dependence and the issue width (all corpus blocks)', () => {
  for (const p of CORPUS) {
    const cfg = buildBasicBlocksAndCFG(frontEnd(p.source).instructions);
    for (const block of cfg.blocks) {
      for (const units of [1, 2, 3]) {
        const s = scheduleInstructions(block.instructions, { units });
        const cycleOf = Object.fromEntries(s.nodes.map((n) => [n.index, n.cycle]));
        for (const e of s.edges) {
          assert.ok(cycleOf[e.toIndex] >= cycleOf[e.fromIndex] + e.latency, `${p.name} ${block.id}: ${e.type} ${e.fromIndex}->${e.toIndex}`);
          if (e.latency === 0) assert.ok(cycleOf[e.toIndex] >= cycleOf[e.fromIndex]);
        }
        for (const row of s.schedule) assert.ok(row.slots.length <= units);
        assert.equal(s.nodes.filter((n) => n.cycle === null).length, 0);
        assert.ok(s.totalCycles <= s.sequentialCycles || units === 1, `${p.name}: ${s.totalCycles} > ${s.sequentialCycles}`);
        // A block-ending jump is issued in the last cycle.
        const last = block.instructions.at(-1);
        if (last.op === 'goto' || last.op === 'if') {
          const jump = s.nodes.find((n) => n.index === block.instructions.length - 1); // block-local index
          assert.equal(jump.cycle, Math.max(...s.nodes.map((n) => n.cycle)), `${p.name} ${block.id}`);
        }
      }
    }
  }
});

test('scheduling overlaps independent work with a long-latency multiply', () => {
  // In program order the use of p directly follows the multiply, so an in-order machine
  // stalls; the list scheduler moves the independent additions into the stall.
  const ir = frontEnd('int a = input(); int b = input(); int p = a * b; int s = p + 1; int q = a + 1; int r = b + 2; print(s + q + r);');
  const block = buildBasicBlocksAndCFG(ir.instructions).blocks[0];
  const s = scheduleInstructions(block.instructions, { units: 2 });
  const mul = s.nodes.find((n) => n.text === 'p = a * b');
  const add = s.nodes.find((n) => n.text === 'q = a + 1');
  assert.ok(add.cycle <= mul.cycle + 1, 'independent add runs while the multiply is in flight');
  assert.ok(s.totalCycles < s.sequentialCycles);
});

// ----------------------------------------------------------- vectorisation
test('vectorisation: independent element-wise loop', () => {
  const r = analyzeLoopVectorization('for (i = 0; i < N; i++) A[i] = B[i] + C[i];');
  assert.equal(r.vectorizable, true);
  assert.equal(r.maxVF, Infinity);
  assert.match(r.vectorCode, /A\[i : i \+ 4\] = B\[i : i \+ 4\] \+ C\[i : i \+ 4\]/);
});

test('vectorisation: a loop-carried true dependence of distance 1 blocks it', () => {
  const r = analyzeLoopVectorization('for (i = 1; i < N; i++) { A[i] = A[i - 1] + 1; }');
  assert.equal(r.maxVF, 1);
  assert.equal(r.vectorizable, false);
  assert.equal(r.dependences[0].kind, 'flow (true)');
  assert.equal(r.dependences[0].distance, 1);
});

test('vectorisation: reading ahead (anti dependence) is legal; distance-4 dependence allows VF 4 only', () => {
  assert.equal(analyzeLoopVectorization('for (i = 0; i < N; i++) A[i] = A[i + 1] * 2;').vectorizable, true);
  const d4 = 'for (i = 0; i < N; i++) A[i + 4] = A[i] * 2;';
  assert.equal(analyzeLoopVectorization(d4, { vectorWidth: 4 }).vectorizable, true);
  assert.equal(analyzeLoopVectorization(d4, { vectorWidth: 8 }).vectorizable, false);
});

test('vectorisation: forward cross-statement dependence is fine, backward is not', () => {
  const forward = analyzeLoopVectorization('for (i = 1; i < N; i++) { A[i] = B[i] + 1; C[i] = A[i - 1] * 2; }');
  assert.equal(forward.vectorizable, true);
  const backward = analyzeLoopVectorization('for (i = 1; i < N; i++) { C[i] = A[i - 1] * 2; A[i] = B[i] + 1; }');
  assert.equal(backward.vectorizable, false);
  assert.equal(backward.maxVF, 1);
});

test('vectorisation: scalar recurrences (reductions) are reported', () => {
  const r = analyzeLoopVectorization('for (i = 0; i < N; i++) { s = s + A[i]; }');
  assert.deepEqual(r.recurrences, [{ statement: 'S1', variable: 's' }]);
  assert.equal(r.vectorizable, false);
});

test('vectorisation: unsupported loops are rejected with a message', () => {
  assert.throws(() => analyzeLoopVectorization('while (x) {}'), /Expected a loop of the form/);
  assert.throws(() => analyzeLoopVectorization('for (i = 0; i < N; i++) A[2*i] = 1;'), /not of the form i ± constant/);
});

// ------------------------------------------------------------- next-use
test('next-use information follows the backward-scan algorithm', () => {
  const ir = frontEnd('int a = input(); int b = input(); int c = input(); int d = (a + b) * c - a; print(d);');
  const block = buildBasicBlocksAndCFG(ir.instructions).blocks[0];
  const { rows } = computeNextUse(block.instructions, { liveOut: [] });
  const at = (text) => rows.find((r) => r.text === text);
  const sum = at('t1 = a + b');
  assert.deepEqual(sum.info.find((x) => x.name === 't1'), { name: 't1', role: 'def', live: true, nextUse: 4 });
  assert.deepEqual(sum.info.find((x) => x.name === 'a'), { name: 'a', role: 'use', live: true, nextUse: 5 });
  const last = at('d = t2 - a');
  assert.deepEqual(last.info.find((x) => x.name === 'a'), { name: 'a', role: 'use', live: false, nextUse: null });
});

// ---------------------------------------------------------- graph colouring
test('graph colouring never gives interfering names the same register (all corpus programs)', () => {
  for (const p of CORPUS) {
    const graph = buildInterferenceGraph(frontEnd(p.source).instructions);
    for (const k of [2, 3, 4]) {
      const { coloring } = colorInterferenceGraph(graph, k);
      for (const [a, b] of graph.edges) {
        if (coloring[a] !== null && coloring[b] !== null) assert.notEqual(coloring[a], coloring[b], `${p.name}: ${a}-${b}`);
      }
    }
  }
});

test('graph colouring spills when registers are scarce', () => {
  const graph = buildInterferenceGraph(frontEnd(CORPUS.find((p) => p.name === 'register pressure').source).instructions);
  assert.ok(colorInterferenceGraph(graph, 1).spilled.length > 0);
  assert.equal(colorInterferenceGraph(graph, 8).spilled.length, 0);
});

test('copies do not create interference (x = y may share a register)', () => {
  const graph = buildInterferenceGraph(frontEnd('int y = input(); int x = y; print(x + y);').instructions);
  assert.ok(!graph.edges.some(([a, b]) => (a === 'x' && b === 'y') || (a === 'y' && b === 'x')));
});

test('activation record lays out locals at negative offsets', () => {
  const ar = generateActivationRecord({ variables: [{ name: 'a', type: 'int' }, { name: 'b', type: 'bool' }], spillTemps: ['t1'] });
  assert.deepEqual(ar.stackFrame.map((r) => r.offset), ['+4', '0', '-4', '-8', '-12']);
  assert.equal(ar.frameSize, 20);
});
