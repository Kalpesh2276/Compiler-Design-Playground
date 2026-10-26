import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frontEnd, outputsOf } from './helpers.js';
import { CORPUS } from './corpus.js';
import { runIR } from '../src/engine/irInterpreter.js';
import { optimizeIR } from '../src/engine/optimizer.js';
import { generateTargetCode } from '../src/engine/targetCodegen.js';
import { assemble, runProgram, initialState, step, formatTargetProgram } from '../src/engine/virtualCPU.js';

const R = (name) => ({ kind: 'reg', name });
const I = (value) => ({ kind: 'imm', value });
const M = (name) => ({ kind: 'mem', name });
const L = (name) => ({ kind: 'label', name });
const ins = (op, ...args) => ({ op, args });
const label = (name) => ({ op: 'LABEL', label: name });

// ----------------------------------------------------------------- ISA unit tests
test('cpu: arithmetic, memory and output', () => {
  const p = assemble([
    ins('LI', R('R0'), I(7)),
    ins('LI', R('R1'), I(-2)),
    ins('DIV', R('R2'), R('R0'), R('R1')),
    ins('ST', M('q'), R('R2')),
    ins('LD', R('R3'), M('q')),
    ins('MOD', R('R0'), R('R0'), R('R1')),
    ins('OUT', R('R3')),
    ins('OUT', R('R0')),
    ins('SLT', R('R1'), R('R1'), R('R0')),
    ins('OUTB', R('R1')),
    ins('HALT'),
  ]);
  const { state } = runProgram(p);
  assert.equal(state.status, 'halted');
  assert.deepEqual(state.output.map((o) => o.text), ['-3', '1', 'true']);
  assert.equal(state.memory.q, -3);
  assert.equal(state.steps, 11);
});

test('cpu: conditional and unconditional jumps (count down loop)', () => {
  const p = assemble([
    ins('LI', R('R0'), I(3)),
    ins('LI', R('R1'), I(0)),
    ins('LI', R('R2'), I(1)),
    label('top'),
    ins('BLE', R('R0'), R('R1'), L('done')),
    ins('OUT', R('R0')),
    ins('SUB', R('R0'), R('R0'), R('R2')),
    ins('JMP', L('top')),
    label('done'),
    ins('HALT'),
  ]);
  assert.deepEqual(runProgram(p).state.output.map((o) => o.text), ['3', '2', '1']);
  assert.equal(p.labels.top, 3);
});

test('cpu: division by zero is a structured error, not 0', () => {
  const p = assemble([ins('LI', R('R0'), I(1)), ins('LI', R('R1'), I(0)), ins('DIV', R('R2'), R('R0'), R('R1')), ins('HALT')]);
  const { state } = runProgram(p);
  assert.equal(state.status, 'error');
  assert.equal(state.error.kind, 'DivisionByZero');
  assert.equal(state.error.pc, 2);
  assert.equal(state.registers.R2, undefined);
});

test('cpu: step budget stops infinite loops', () => {
  const p = assemble([label('x'), ins('JMP', L('x'))]);
  const { state } = runProgram(p, { maxSteps: 50 });
  assert.equal(state.error.kind, 'StepLimitExceeded');
  assert.equal(state.steps, 50);
});

test('cpu: invalid programs are rejected before execution', () => {
  const bad = (code) => initialState(assemble(code));
  assert.match(bad([ins('FOO')]).error.message, /unknown opcode/);
  assert.match(bad([ins('ADD', R('R0'), R('R1'))]).error.message, /expects 3 operand/);
  assert.match(bad([ins('LI', R('R9'), I(1))]).error.message, /invalid register R9/);
  assert.match(bad([ins('LD', R('R0'), I(1))]).error.message, /must be a mem/);
  assert.match(bad([ins('JMP', L('nowhere'))]).error.message, /undefined label/);
  assert.equal(bad([ins('HALT')]).status, 'ready');
});

test('cpu: reading uninitialised memory or registers faults', () => {
  assert.equal(runProgram(assemble([ins('LD', R('R0'), M('x')), ins('HALT')])).state.error.kind, 'UninitializedMemory');
  assert.equal(runProgram(assemble([ins('OUT', R('R1')), ins('HALT')])).state.error.kind, 'UninitializedRegister');
});

test('cpu: running off the end without HALT faults', () => {
  assert.equal(runProgram(assemble([ins('LI', R('R0'), I(1))])).state.error.kind, 'PCOutOfRange');
});

test('cpu: step() is pure and reset is deterministic', () => {
  const p = assemble([ins('IN', R('R0')), ins('OUT', R('R0')), ins('HALT')]);
  const s0 = initialState(p, { inputs: [42] });
  const { state: s1 } = step(p, s0);
  assert.equal(s0.registers.R0, undefined);
  assert.equal(s1.registers.R0, 42);
  assert.equal(s1.pc, 1);
  const a = runProgram(p, { inputs: [42] });
  const b = runProgram(p, { inputs: [42] });
  assert.deepEqual(a.state, b.state);
});

// ------------------------------------------------------------ code generation
test('codegen: simple expression uses registers and stores the result', () => {
  const ir = frontEnd('int a = input(); int b = a * 2 + 1; print(b);');
  const { code, problems } = generateTargetCode(ir.instructions, { liveAtExit: ['a', 'b'] });
  assert.deepEqual(problems, []);
  const listing = formatTargetProgram(code);
  assert.match(listing, /IN {3}R0/);
  assert.match(listing, /MUL/);
  assert.match(listing, /ST {3}b, /);
  assert.match(listing, /HALT$/);
});

test('codegen: local strategy issues fewer memory operations than naive', () => {
  const ir = frontEnd(CORPUS.find((p) => p.name === 'register pressure').source);
  const vars = ir.variables.map((v) => v.name);
  const naive = generateTargetCode(ir.instructions, { liveAtExit: vars, strategy: 'naive' });
  const local = generateTargetCode(ir.instructions, { liveAtExit: vars, strategy: 'local' });
  assert.ok(local.stats.loads + local.stats.stores < naive.stats.loads + naive.stats.stores);
});

test('codegen: needs at least three registers', () => {
  assert.throws(() => generateTargetCode([], { registerCount: 2 }), /at least 3 registers/);
});

// -------------------------------------------- differential: CPU vs reference IR
for (const program of CORPUS) {
  test(`differential: CPU output matches the IR interpreter – ${program.name}`, () => {
    const ir = frontEnd(program.source);
    const vars = ir.variables.map((v) => v.name);
    const optimized = optimizeIR(ir.instructions, { liveAtExit: vars }).instructions;
    for (const [irLabel, instrs] of [['unoptimized', ir.instructions], ['optimized', optimized]]) {
      for (const strategy of ['naive', 'local']) {
        for (const registerCount of [3, 4, 6]) {
          const where = `${irLabel}/${strategy}/${registerCount} regs`;
          const gen = generateTargetCode(instrs, { liveAtExit: vars, strategy, registerCount });
          assert.deepEqual(gen.problems, [], where);
          const program2 = assemble(gen.code, registerCount);
          for (const [inputs, expected] of program.runs) {
            const ref = runIR(instrs, { inputs });
            const { state } = runProgram(program2, { inputs });
            if (expected.error) {
              assert.equal(state.error?.kind, expected.error, `${where} inputs ${inputs}`);
              continue;
            }
            assert.equal(state.status, 'halted', `${where} inputs ${inputs}: ${state.error?.message}`);
            assert.deepEqual(state.output.map((o) => o.text), outputsOf(ref), `${where} inputs ${inputs}`);
            assert.deepEqual(state.output.map((o) => o.text), expected, `${where} inputs ${inputs}`);
            for (const v of vars) assert.equal(state.memory[v], ref.memory[v], `${where}: final value of ${v}`);
          }
        }
      }
    }
  });
}
