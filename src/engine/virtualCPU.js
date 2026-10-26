// Virtual CPU: a small load/store register machine that executes the target code
// produced by targetCodegen.js. It interprets instructions one at a time; it never
// evaluates source code or IR directly.
//
// Target instruction = { op, args: Arg[] , label?: string }
//   Arg = { kind: 'reg', name: 'R0' } | { kind: 'imm', value } | { kind: 'mem', name } | { kind: 'label', name }
// A pseudo-instruction { op: 'LABEL', label } marks a jump target; it occupies no address.
//
// CPU state = { pc, registers: { R0: number|undefined, … }, memory: { name: number },
//               output: [{ value, valueType, text }], inputPos, steps, status, error }
//   status: 'ready' | 'running' | 'halted' | 'error'
//
// Every step validates the instruction and its operands, so malformed programs produce
// structured errors instead of undefined behaviour.

import { evalBinary, evalUnary, ArithmeticError } from './intArith.js';

/** The documented instruction set. Operand signature letters: R register, I immediate, M memory, L label. */
export const ISA = {
  LI: { sig: 'RI', desc: 'Rd ← imm (load immediate)' },
  LD: { sig: 'RM', desc: 'Rd ← Mem[x] (load)' },
  ST: { sig: 'MR', desc: 'Mem[x] ← Rs (store)' },
  MOV: { sig: 'RR', desc: 'Rd ← Rs' },
  ADD: { sig: 'RRR', desc: 'Rd ← Rs + Rt', alu: '+' },
  SUB: { sig: 'RRR', desc: 'Rd ← Rs − Rt', alu: '-' },
  MUL: { sig: 'RRR', desc: 'Rd ← Rs × Rt', alu: '*' },
  DIV: { sig: 'RRR', desc: 'Rd ← Rs ÷ Rt (truncates; traps on 0)', alu: '/' },
  MOD: { sig: 'RRR', desc: 'Rd ← Rs mod Rt (traps on 0)', alu: '%' },
  SLT: { sig: 'RRR', desc: 'Rd ← (Rs < Rt) ? 1 : 0', alu: '<' },
  SLE: { sig: 'RRR', desc: 'Rd ← (Rs ≤ Rt) ? 1 : 0', alu: '<=' },
  SGT: { sig: 'RRR', desc: 'Rd ← (Rs > Rt) ? 1 : 0', alu: '>' },
  SGE: { sig: 'RRR', desc: 'Rd ← (Rs ≥ Rt) ? 1 : 0', alu: '>=' },
  SEQ: { sig: 'RRR', desc: 'Rd ← (Rs = Rt) ? 1 : 0', alu: '==' },
  SNE: { sig: 'RRR', desc: 'Rd ← (Rs ≠ Rt) ? 1 : 0', alu: '!=' },
  NEG: { sig: 'RR', desc: 'Rd ← −Rs', unary: '-' },
  NOT: { sig: 'RR', desc: 'Rd ← (Rs = 0) ? 1 : 0', unary: '!' },
  IN: { sig: 'R', desc: 'Rd ← next input value' },
  OUT: { sig: 'R', desc: 'print Rs as an integer' },
  OUTB: { sig: 'R', desc: 'print Rs as a boolean' },
  JMP: { sig: 'L', desc: 'pc ← label' },
  BLT: { sig: 'RRL', desc: 'if Rs < Rt goto label', cmp: '<' },
  BLE: { sig: 'RRL', desc: 'if Rs ≤ Rt goto label', cmp: '<=' },
  BGT: { sig: 'RRL', desc: 'if Rs > Rt goto label', cmp: '>' },
  BGE: { sig: 'RRL', desc: 'if Rs ≥ Rt goto label', cmp: '>=' },
  BEQ: { sig: 'RRL', desc: 'if Rs = Rt goto label', cmp: '==' },
  BNE: { sig: 'RRL', desc: 'if Rs ≠ Rt goto label', cmp: '!=' },
  HALT: { sig: '', desc: 'stop execution' },
};

const SIG_KIND = { R: 'reg', I: 'imm', M: 'mem', L: 'label' };

// ------------------------------------------------------------------ formatting
export function formatArg(a) {
  switch (a.kind) {
    case 'reg':
      return a.name;
    case 'imm':
      return `#${a.value}`;
    case 'mem':
    case 'label':
      return a.name;
    default:
      return '?';
  }
}

export function formatTargetInstruction(ins) {
  if (ins.op === 'LABEL') return `${ins.label}:`;
  return ins.args.length ? `${ins.op.padEnd(5)}${ins.args.map(formatArg).join(', ')}` : ins.op;
}

export function formatTargetProgram(code) {
  return code.map((ins) => (ins.op === 'LABEL' ? formatTargetInstruction(ins) : `    ${formatTargetInstruction(ins)}`)).join('\n');
}

// ------------------------------------------------------------------ loading
/**
 * Resolve labels to addresses and validate every instruction against the ISA.
 * Returns { instructions, labels: {name: address}, sourceIndex: [index in `code`], problems }.
 */
export function assemble(code, registerCount = 4) {
  const instructions = [];
  const sourceIndex = [];
  const labels = {};
  const problems = [];
  code.forEach((ins, i) => {
    if (ins.op === 'LABEL') {
      if (labels[ins.label] !== undefined) problems.push(`duplicate label ${ins.label}`);
      labels[ins.label] = instructions.length;
    } else {
      instructions.push(ins);
      sourceIndex.push(i);
    }
  });
  instructions.forEach((ins, addr) => {
    const spec = ISA[ins.op];
    if (!spec) {
      problems.push(`@${addr}: unknown opcode '${ins.op}'`);
      return;
    }
    if (!Array.isArray(ins.args) || ins.args.length !== spec.sig.length) {
      problems.push(`@${addr}: ${ins.op} expects ${spec.sig.length} operand(s)`);
      return;
    }
    ins.args.forEach((a, k) => {
      const want = SIG_KIND[spec.sig[k]];
      if (a.kind !== want) problems.push(`@${addr}: operand ${k + 1} of ${ins.op} must be a ${want}`);
      else if (a.kind === 'reg' && !isValidRegister(a.name, registerCount)) problems.push(`@${addr}: invalid register ${a.name}`);
      else if (a.kind === 'label' && labels[a.name] === undefined) problems.push(`@${addr}: undefined label ${a.name}`);
      else if (a.kind === 'imm' && (!Number.isInteger(a.value) || (a.value | 0) !== a.value)) problems.push(`@${addr}: immediate ${a.value} is not a 32-bit integer`);
    });
  });
  return { instructions, labels, sourceIndex, problems, registerCount };
}

function isValidRegister(name, count) {
  const m = /^R(\d+)$/.exec(name);
  return !!m && Number(m[1]) < count;
}

// ------------------------------------------------------------------ execution
export function initialState(program, { inputs = [] } = {}) {
  const registers = {};
  for (let i = 0; i < program.registerCount; i++) registers[`R${i}`] = undefined;
  return {
    pc: 0,
    registers,
    memory: {},
    output: [],
    inputs: [...inputs],
    inputPos: 0,
    steps: 0,
    status: program.problems.length ? 'error' : 'ready',
    error: program.problems.length ? { kind: 'InvalidProgram', message: program.problems[0], pc: null } : null,
  };
}

/**
 * Execute one instruction. Pure: returns { state, event } where `state` is a new object
 * and `event` describes what happened (for traces and the UI).
 */
export function step(program, state, { maxSteps = 100000 } = {}) {
  if (state.status === 'halted' || state.status === 'error') return { state, event: null };

  const s = {
    ...state,
    registers: { ...state.registers },
    memory: { ...state.memory },
    output: [...state.output],
    status: 'running',
  };
  const pc = s.pc;
  const fail = (kind, message) => {
    s.status = 'error';
    s.error = { kind, message, pc };
    return { state: s, event: { pc, text: pc < program.instructions.length ? formatTargetInstruction(program.instructions[pc]) : '—', effect: message, error: true } };
  };

  if (s.steps >= maxSteps) return fail('StepLimitExceeded', `Stopped after ${maxSteps} instructions (possible infinite loop).`);
  if (pc < 0 || pc >= program.instructions.length) return fail('PCOutOfRange', `Program counter ${pc} is outside the program (missing HALT?).`);

  const ins = program.instructions[pc];
  const text = formatTargetInstruction(ins);
  const spec = ISA[ins.op];
  if (!spec) return fail('InvalidInstruction', `Unknown opcode '${ins.op}'.`);
  s.steps++;

  const [a, b, c] = ins.args;
  const readReg = (arg) => {
    const v = s.registers[arg.name];
    if (v === undefined) throw new CPUFault('UninitializedRegister', `Register ${arg.name} read before it was written.`);
    return v;
  };
  const writeReg = (arg, v) => {
    s.registers[arg.name] = v | 0;
  };

  let effect = '';
  let nextPc = pc + 1;
  try {
    if (spec.alu) {
      const v = evalBinary(spec.alu, readReg(b), readReg(c));
      writeReg(a, v);
      effect = `${a.name} ← ${readRegSafe(state, b)} ${spec.alu} ${readRegSafe(state, c)} = ${v}`;
    } else if (spec.unary) {
      const v = evalUnary(spec.unary, readReg(b));
      writeReg(a, v);
      effect = `${a.name} ← ${spec.unary}${readRegSafe(state, b)} = ${v}`;
    } else if (spec.cmp) {
      const taken = evalBinary(spec.cmp, readReg(a), readReg(b)) === 1;
      if (taken) nextPc = program.labels[c.name];
      effect = taken ? `branch taken → ${c.name} (@${nextPc})` : 'branch not taken';
    } else {
      switch (ins.op) {
        case 'LI':
          writeReg(a, b.value);
          effect = `${a.name} ← ${b.value}`;
          break;
        case 'LD':
          if (!(b.name in s.memory)) throw new CPUFault('UninitializedMemory', `Load from '${b.name}' before any store to it.`);
          writeReg(a, s.memory[b.name]);
          effect = `${a.name} ← Mem[${b.name}] = ${s.memory[b.name]}`;
          break;
        case 'ST':
          s.memory[a.name] = readReg(b);
          effect = `Mem[${a.name}] ← ${b.name} = ${s.memory[a.name]}`;
          break;
        case 'MOV':
          writeReg(a, readReg(b));
          effect = `${a.name} ← ${b.name} = ${s.registers[a.name]}`;
          break;
        case 'IN': {
          if (s.inputPos >= s.inputs.length) throw new CPUFault('InputExhausted', `IN executed but only ${s.inputs.length} input value(s) were provided.`);
          const v = s.inputs[s.inputPos] | 0;
          s.inputPos++;
          writeReg(a, v);
          effect = `${a.name} ← input #${s.inputPos} = ${v}`;
          break;
        }
        case 'OUT':
        case 'OUTB': {
          const v = readReg(a);
          const isBool = ins.op === 'OUTB';
          const textValue = isBool ? (v !== 0 ? 'true' : 'false') : String(v);
          s.output.push({ value: v, valueType: isBool ? 'bool' : 'int', text: textValue });
          effect = `output ${textValue}`;
          break;
        }
        case 'JMP':
          nextPc = program.labels[a.name];
          effect = `jump → ${a.name} (@${nextPc})`;
          break;
        case 'HALT':
          s.status = 'halted';
          effect = 'halt';
          nextPc = pc;
          break;
        default:
          throw new CPUFault('InvalidInstruction', `Opcode '${ins.op}' is not implemented.`);
      }
    }
  } catch (e) {
    s.steps--; // the faulting instruction did not complete
    if (e instanceof ArithmeticError) return fail('DivisionByZero', e.message);
    if (e instanceof CPUFault) return fail(e.kind, e.message);
    throw e;
  }

  if (nextPc === undefined) return fail('InvalidJump', `Jump to undefined label.`);
  s.pc = nextPc;
  return { state: s, event: { pc, text, effect, error: false } };
}

function readRegSafe(state, arg) {
  return state.registers[arg.name];
}

class CPUFault extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

/**
 * Run until HALT, an error, or the step budget. Returns the final state and a trace of
 * the first `traceLimit` events (the full run is still executed).
 */
export function runProgram(program, { inputs = [], maxSteps = 100000, traceLimit = 2000 } = {}) {
  let state = initialState(program, { inputs });
  const trace = [];
  while (state.status === 'ready' || state.status === 'running') {
    const { state: next, event } = step(program, state, { maxSteps });
    if (event && trace.length < traceLimit) trace.push({ ...event, step: next.steps });
    state = next;
  }
  return { state, trace, truncated: state.steps > trace.length };
}
