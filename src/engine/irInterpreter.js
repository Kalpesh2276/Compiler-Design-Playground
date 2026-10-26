// Reference interpreter for three-address code.
//
// This defines the meaning of a TAC program. It is used to
//   * check that optimisation preserves behaviour (original vs optimised IR), and
//   * check that the virtual CPU running the generated target code agrees with the IR.
//
// runIR(instructions, { inputs = [], maxSteps = 100000 }) -> {
//   status: 'halted' | 'error',
//   output: [{ value, valueType, text }],
//   memory: { [name]: value }      final value of every variable and temporary
//   steps:  number of instructions executed (labels included)
//   error:  null | { kind, message, index }
// }
// Error kinds: 'DivisionByZero', 'InputExhausted', 'UninitializedRead', 'StepLimitExceeded',
//              'InvalidProgram'.

import { evalBinary, evalUnary, ArithmeticError } from './intArith.js';
import { formatInstruction, validateIR } from './ir.js';

export function formatValue(value, valueType) {
  return valueType === 'bool' ? (value !== 0 ? 'true' : 'false') : String(value);
}

export function runIR(instructions, { inputs = [], maxSteps = 100000 } = {}) {
  const output = [];
  const memory = new Map();
  let steps = 0;
  let inputPos = 0;

  const fail = (kind, message, index) => ({
    status: 'error',
    output,
    memory: Object.fromEntries(memory),
    steps,
    error: { kind, message, index, instruction: index >= 0 ? formatInstruction(instructions[index]) : null },
  });

  const problems = validateIR(instructions);
  if (problems.length) return fail('InvalidProgram', `Invalid IR: ${problems[0]}`, -1);

  const labelIndex = new Map();
  instructions.forEach((ins, i) => {
    if (ins.op === 'label') labelIndex.set(ins.name, i);
  });

  class ReadError extends Error {}
  const read = (o) => {
    if (o.kind === 'const') return o.value;
    if (!memory.has(o.name)) throw new ReadError(o.name);
    return memory.get(o.name);
  };

  let pc = 0;
  while (pc < instructions.length) {
    if (steps >= maxSteps) {
      return fail('StepLimitExceeded', `Execution stopped after ${maxSteps} steps (possible infinite loop).`, pc);
    }
    steps++;
    const ins = instructions[pc];
    try {
      switch (ins.op) {
        case 'assign':
          memory.set(ins.dest.name, read(ins.src));
          break;
        case 'binary':
          memory.set(ins.dest.name, evalBinary(ins.operator, read(ins.left), read(ins.right)));
          break;
        case 'unary':
          memory.set(ins.dest.name, evalUnary(ins.operator, read(ins.src)));
          break;
        case 'input':
          if (inputPos >= inputs.length) {
            return fail('InputExhausted', `input() called but only ${inputs.length} input value(s) were provided.`, pc);
          }
          memory.set(ins.dest.name, inputs[inputPos++] | 0);
          break;
        case 'print': {
          const value = read(ins.src);
          output.push({ value, valueType: ins.valueType, text: formatValue(value, ins.valueType) });
          break;
        }
        case 'label':
          break;
        case 'goto':
          pc = labelIndex.get(ins.target);
          continue;
        case 'if':
          if (evalBinary(ins.operator, read(ins.left), read(ins.right))) {
            pc = labelIndex.get(ins.target);
            continue;
          }
          break;
        default:
          return fail('InvalidProgram', `Unknown instruction '${ins.op}'.`, pc);
      }
    } catch (e) {
      if (e instanceof ArithmeticError) return fail('DivisionByZero', e.message, pc);
      if (e instanceof ReadError) return fail('UninitializedRead', `Read of '${e.message}' before it was assigned.`, pc);
      throw e;
    }
    pc++;
  }

  return { status: 'halted', output, memory: Object.fromEntries(memory), steps, error: null };
}
