// Differential fuzzing: random well-typed MiniC programs must behave identically
// (output, run-time error kind) under the reference IR interpreter, after optimisation,
// and on the virtual CPU with both code-generation strategies and few registers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frontEnd, outputsOf } from './helpers.js';
import { runIR } from '../src/engine/irInterpreter.js';
import { optimizeIR } from '../src/engine/optimizer.js';
import { generateTargetCode } from '../src/engine/targetCodegen.js';
import { assemble, runProgram } from '../src/engine/virtualCPU.js';
import { validateIR } from '../src/engine/ir.js';

// Small deterministic PRNG (mulberry32).
function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateProgram(seed) {
  const r = rng(seed);
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const chance = (p) => r() < p;
  const ints = [];
  const bools = [];
  let loopId = 0;
  const lines = [];

  const intExpr = (depth) => {
    if (depth <= 0 || chance(0.3)) {
      if (ints.length && chance(0.6)) return pick(ints);
      if (chance(0.15)) return 'input()';
      return String(Math.floor(r() * 25) - 5);
    }
    if (chance(0.1)) return `-(${intExpr(depth - 1)})`;
    const op = pick(['+', '-', '*', '+', '-', '/', '%']);
    return `(${intExpr(depth - 1)} ${op} ${intExpr(depth - 1)})`;
  };
  const boolExpr = (depth) => {
    if (depth <= 0 || chance(0.25)) {
      if (bools.length && chance(0.5)) return pick(bools);
      if (chance(0.2)) return pick(['true', 'false']);
      return `(${intExpr(1)} ${pick(['<', '<=', '>', '>=', '==', '!='])} ${intExpr(1)})`;
    }
    const k = Math.floor(r() * 4);
    if (k === 0) return `!(${boolExpr(depth - 1)})`;
    if (k === 1) return `(${boolExpr(depth - 1)} && ${boolExpr(depth - 1)})`;
    if (k === 2) return `(${boolExpr(depth - 1)} || ${boolExpr(depth - 1)})`;
    return `(${boolExpr(depth - 1)} == ${boolExpr(depth - 1)})`;
  };

  const statements = (n, depth, indent) => {
    for (let i = 0; i < n; i++) {
      const k = Math.floor(r() * 10);
      if (k <= 1) {
        const name = `v${ints.length}`;
        lines.push(`${indent}int ${name} = ${intExpr(2)};`);
        ints.push(name);
      } else if (k === 2) {
        const name = `b${bools.length}`;
        lines.push(`${indent}bool ${name} = ${boolExpr(2)};`);
        bools.push(name);
      } else if (k <= 4 && ints.length) {
        lines.push(`${indent}${pick(ints)} = ${intExpr(3)};`);
      } else if (k === 5 && bools.length) {
        lines.push(`${indent}${pick(bools)} = ${boolExpr(2)};`);
      } else if (k === 6) {
        lines.push(`${indent}print(${chance(0.7) ? intExpr(2) : boolExpr(2)});`);
      } else if (k === 9 && ints.length >= 2) {
        // Plain copies followed by a write to the source stress copy propagation.
        const [dst, src] = [pick(ints), pick(ints)];
        lines.push(`${indent}${dst} = ${src};`);
        if (chance(0.5)) lines.push(`${indent}${src} = ${intExpr(1)};`);
        lines.push(`${indent}print(${dst});`);
      } else if (k === 7 && depth < 2) {
        lines.push(`${indent}if (${boolExpr(2)}) {`);
        const saved = [ints.length, bools.length];
        statements(1 + Math.floor(r() * 3), depth + 1, indent + '  ');
        ints.length = saved[0];
        bools.length = saved[1];
        if (chance(0.5)) {
          lines.push(`${indent}} else {`);
          statements(1 + Math.floor(r() * 3), depth + 1, indent + '  ');
          ints.length = saved[0];
          bools.length = saved[1];
        }
        lines.push(`${indent}}`);
      } else if (k === 8 && depth < 2) {
        // Bounded loop: the counter is never assigned by random statements.
        const c = `c${loopId++}`;
        lines.push(`${indent}int ${c} = 0;`);
        lines.push(`${indent}while (${c} < ${1 + Math.floor(r() * 4)}${chance(0.3) ? ` && ${boolExpr(1)}` : ''}) {`);
        const saved = [ints.length, bools.length];
        statements(1 + Math.floor(r() * 3), depth + 1, indent + '  ');
        ints.length = saved[0];
        bools.length = saved[1];
        lines.push(`${indent}  ${c} = ${c} + 1;`);
        lines.push(`${indent}}`);
      } else {
        lines.push(`${indent}print(${intExpr(2)});`);
      }
    }
  };

  statements(4 + Math.floor(r() * 8), 0, '');
  return lines.join('\n');
}

const observable = (status, errorKind, output) => ({ status, error: errorKind ?? null, output });

const PROGRAMS = 300;

test(`fuzz: ${PROGRAMS} random programs agree across interpreter, optimiser and CPU`, () => {
  let erroring = 0;
  for (let seed = 1; seed <= PROGRAMS; seed++) {
    const source = generateProgram(seed);
    const inputs = Array.from({ length: 40 }, (_, i) => ((i * 7 + seed) % 23) - 6);
    let ir;
    try {
      ir = frontEnd(source);
    } catch (e) {
      assert.fail(`seed ${seed}: generator produced an invalid program (${e.message})\n${source}`);
    }
    const vars = ir.variables.map((v) => v.name);
    const ref = runIR(ir.instructions, { inputs });
    const expected = observable(ref.status, ref.error?.kind, outputsOf(ref));
    if (ref.status === 'error') erroring++;

    const opt = optimizeIR(ir.instructions, { liveAtExit: vars }).instructions;
    assert.deepEqual(validateIR(opt), [], `seed ${seed}`);
    const optRun = runIR(opt, { inputs });
    assert.deepEqual(observable(optRun.status, optRun.error?.kind, outputsOf(optRun)), expected, `seed ${seed} optimised IR\n${source}`);

    // Default pipeline mode: only output/errors are observable (nothing live at exit).
    const lean = optimizeIR(ir.instructions, { liveAtExit: [] }).instructions;
    const leanRun = runIR(lean, { inputs });
    assert.deepEqual(observable(leanRun.status, leanRun.error?.kind, outputsOf(leanRun)), expected, `seed ${seed} lean optimised IR
${source}`);
    const leanGen = generateTargetCode(lean, { liveAtExit: [], strategy: 'local', registerCount: 3 });
    const leanCpu = runProgram(assemble(leanGen.code, 3), { inputs }).state;
    assert.deepEqual(observable(leanCpu.status, leanCpu.error?.kind, leanCpu.output.map((o) => o.text)), expected, `seed ${seed} lean CPU
${source}`);

    for (const [instrs, strategy, registerCount] of [[opt, 'local', 3], [opt, 'local', 4], [ir.instructions, 'naive', 3], [ir.instructions, 'local', 5]]) {
      const gen = generateTargetCode(instrs, { liveAtExit: vars, strategy, registerCount });
      assert.deepEqual(gen.problems, [], `seed ${seed}`);
      const { state } = runProgram(assemble(gen.code, registerCount), { inputs });
      const got = observable(state.status, state.error?.kind, state.output.map((o) => o.text));
      assert.deepEqual(got, expected, `seed ${seed} CPU ${strategy}/${registerCount}\n${source}`);
      if (state.status === 'halted') {
        for (const v of vars) assert.equal(state.memory[v], ref.memory[v], `seed ${seed}: ${v} (${strategy}/${registerCount})`);
      }
    }
  }
  // Sanity: the generator must exercise run-time errors but mostly produce terminating programs.
  assert.ok(erroring > 0 && erroring < PROGRAMS / 2, `erroring programs: ${erroring}`);
});
