// Target code generation: three-address code -> virtual CPU instructions (virtualCPU.js).
//
// generateTargetCode(instructions, { liveAtExit, registerCount = 4, strategy = 'local' })
//   -> { code, allocationLog, stats, problems }
//
// Strategies
//   'naive'  every TAC instruction loads its operands, computes, and stores its result
//            immediately; registers never carry values between instructions.
//   'local'  the simple code generator of Dragon Book §8.6: per basic block it keeps
//            *register descriptors* (which names each register holds) and *address
//            descriptors* (where the current value of each name lives), reuses values
//            already in registers, and chooses registers with getReg():
//              1. a register already holding the operand;
//              2. an empty register;
//              3. a register whose values are all safe to drop (dead after this
//                 instruction, already in memory, held in another register, or constants);
//              4. otherwise spill: store the register's live values, preferring the
//                 register whose values are needed furthest in the future (next-use).
//            At the end of a block every value that is live on exit and only held in a
//            register is stored, so blocks can be entered from anywhere with all values
//            in memory. This is a block-local allocator, not a global one.
//
// Requires registerCount >= 3 (two source operands plus a destination).

import { buildBasicBlocksAndCFG, computeLiveness } from './optimizationCFG.js';
import { formatInstruction, usesOf, defOf } from './ir.js';
import { assemble } from './virtualCPU.js';

const ALU = { '+': 'ADD', '-': 'SUB', '*': 'MUL', '/': 'DIV', '%': 'MOD', '<': 'SLT', '<=': 'SLE', '>': 'SGT', '>=': 'SGE', '==': 'SEQ', '!=': 'SNE' };
const BRANCH = { '<': 'BLT', '<=': 'BLE', '>': 'BGT', '>=': 'BGE', '==': 'BEQ', '!=': 'BNE' };
const UNARY = { '-': 'NEG', '!': 'NOT' };

const reg = (name) => ({ kind: 'reg', name });
const imm = (value) => ({ kind: 'imm', value });
const mem = (name) => ({ kind: 'mem', name });
const lab = (name) => ({ kind: 'label', name });
const constKey = (v) => `#${v}`;
const isConstKey = (k) => k.startsWith('#');

export function generateTargetCode(instructions, { liveAtExit = [], registerCount = 4, strategy = 'local' } = {}) {
  if (registerCount < 3) throw new Error('Target code generation needs at least 3 registers.');
  const cfg = buildBasicBlocksAndCFG(instructions);
  const liveness = computeLiveness(cfg, liveAtExit);
  const code = [];
  const allocationLog = [];
  const stats = { loads: 0, stores: 0, spills: 0, immediates: 0, reuses: 0 };
  const emit = (op, args = [], irIndex = null) => {
    if (op === 'LD') stats.loads++;
    if (op === 'ST') stats.stores++;
    if (op === 'LI') stats.immediates++;
    code.push({ op, args, irIndex });
  };
  const registers = Array.from({ length: registerCount }, (_, i) => `R${i}`);

  for (const block of cfg.blocks) {
    const liveOut = new Set(liveness.blocks[block.index].out);
    if (strategy === 'naive') genBlockNaive(block);
    else genBlockLocal(block, liveOut);
  }
  emit('HALT');

  const assembled = assemble(code, registerCount);
  return { code, allocationLog, stats, problems: assembled.problems, liveness };

  // ---------------------------------------------------------------- naive
  function genBlockNaive(block) {
    block.instructions.forEach((ins, k) => {
      const at = block.start + k;
      const load = (o, r) => {
        if (o.kind === 'const') emit('LI', [reg(r), imm(o.value)], at);
        else emit('LD', [reg(r), mem(o.name)], at);
        return reg(r);
      };
      switch (ins.op) {
        case 'label':
          code.push({ op: 'LABEL', label: ins.name, irIndex: at });
          break;
        case 'assign':
          load(ins.src, 'R0');
          emit('ST', [mem(ins.dest.name), reg('R0')], at);
          break;
        case 'binary':
          emit(ALU[ins.operator], [reg('R2'), load(ins.left, 'R0'), load(ins.right, 'R1')], at);
          emit('ST', [mem(ins.dest.name), reg('R2')], at);
          break;
        case 'unary':
          emit(UNARY[ins.operator], [reg('R1'), load(ins.src, 'R0')], at);
          emit('ST', [mem(ins.dest.name), reg('R1')], at);
          break;
        case 'input':
          emit('IN', [reg('R0')], at);
          emit('ST', [mem(ins.dest.name), reg('R0')], at);
          break;
        case 'print':
          emit(ins.valueType === 'bool' ? 'OUTB' : 'OUT', [load(ins.src, 'R0')], at);
          break;
        case 'goto':
          emit('JMP', [lab(ins.target)], at);
          break;
        case 'if':
          emit(BRANCH[ins.operator], [load(ins.left, 'R0'), load(ins.right, 'R1'), lab(ins.target)], at);
          break;
        default:
          throw new Error(`Code generation: unknown IR op '${ins.op}'.`);
      }
    });
  }

  // ---------------------------------------------------------------- local
  function genBlockLocal(block, liveOut) {
    // Register descriptor: register -> Set of keys (names, or '#c' for constants).
    const regDesc = new Map(registers.map((r) => [r, new Set()]));
    // Address descriptor: name -> { inMemory, regs:Set }. Absent => in memory only.
    const addr = new Map();
    const addrOf = (name) => {
      if (!addr.has(name)) addr.set(name, { inMemory: true, regs: new Set() });
      return addr.get(name);
    };
    const keyOf = (o) => (o.kind === 'const' ? constKey(o.value) : o.name);

    // next use of each name at or after position k inside this block
    const nextUse = (name, k) => {
      for (let j = k; j < block.instructions.length; j++) {
        if (usesOf(block.instructions[j]).some((o) => o.name === name)) return j;
        if (defOf(block.instructions[j]) === name) return Infinity;
      }
      return liveOut.has(name) ? block.instructions.length + 1000 : Infinity;
    };
    const liveAfter = (k) => liveness.liveAfter[block.start + k] ?? new Set();

    const findReg = (key) => registers.find((r) => regDesc.get(r).has(key));

    /** Can the contents of register r be discarded at instruction k without a store? */
    const storesNeeded = (r, k, ignore = null) =>
      [...regDesc.get(r)].filter((key) => {
        if (isConstKey(key) || key === ignore) return false;
        const a = addrOf(key);
        if (a.inMemory || a.regs.size > 1) return false;
        return liveAfter(k).has(key) || usesOf(block.instructions[k]).some((o) => o.name === key);
      });

    const clearReg = (r) => {
      for (const key of regDesc.get(r)) if (!isConstKey(key)) addrOf(key).regs.delete(r);
      regDesc.get(r).clear();
    };

    /** Choose a register, emitting spill stores if necessary. `locked` registers are untouchable. */
    const chooseReg = (k, locked, at, why, ignore = null) => {
      const free = registers.find((r) => !locked.has(r) && regDesc.get(r).size === 0);
      if (free) return free;
      const candidates = registers.filter((r) => !locked.has(r));
      const cheap = candidates.find((r) => storesNeeded(r, k, ignore).length === 0);
      if (cheap) return cheap;
      // Spill: fewest stores first, then furthest next use.
      let best = null;
      for (const r of candidates) {
        const stores = storesNeeded(r, k, ignore);
        const soonest = Math.min(...[...regDesc.get(r)].filter((x) => !isConstKey(x)).map((x) => nextUse(x, k)));
        const score = [stores.length, -soonest];
        if (!best || score[0] < best.score[0] || (score[0] === best.score[0] && score[1] < best.score[1])) best = { r, stores, score };
      }
      for (const name of best.stores) {
        emit('ST', [mem(name), reg(best.r)], at);
        addrOf(name).inMemory = true;
      }
      stats.spills++;
      allocationLog.push({ irIndex: at, event: `spill ${best.r} (${best.stores.join(', ')}) for ${why}` });
      return best.r;
    };

    /** Get a register holding operand o (loading it if needed). */
    const operandReg = (o, k, locked, at) => {
      const key = keyOf(o);
      const existing = findReg(key);
      if (existing) {
        stats.reuses++;
        return existing;
      }
      const r = chooseReg(k, locked, at, formatInstruction(block.instructions[k]));
      clearReg(r);
      if (o.kind === 'const') emit('LI', [reg(r), imm(o.value)], at);
      else emit('LD', [reg(r), mem(o.name)], at);
      regDesc.get(r).add(key);
      if (o.kind !== 'const') addrOf(o.name).regs.add(r);
      allocationLog.push({ irIndex: at, event: `${r} ← ${key}` });
      return r;
    };

    /**
     * Register to receive a new value of `dest`. An operand register may be reused because
     * the instruction reads its operands before writing the result – provided every value
     * it holds is dispensable afterwards (constant, the old value of dest, dead, in memory,
     * or also held in another register).
     */
    const dispensableAfter = (r, k, dest) =>
      [...regDesc.get(r)].every((x) => isConstKey(x) || x === dest || !liveAfter(k).has(x) || addrOf(x).inMemory || addrOf(x).regs.size > 1);
    const destReg = (dest, k, operandRegs, at) => {
      for (const r of operandRegs) if (dispensableAfter(r, k, dest)) return r;
      const own = findReg(dest);
      if (own && regDesc.get(own).size === 1) return own;
      return chooseReg(k, new Set(operandRegs), at, `result ${dest}`, dest);
    };

    /** Record that register r now holds the (new) value of dest and nothing else. */
    const define = (dest, r) => {
      const a = addrOf(dest);
      for (const old of a.regs) regDesc.get(old).delete(dest);
      clearReg(r);
      regDesc.get(r).add(dest);
      a.regs = new Set([r]);
      a.inMemory = false;
    };

    const flush = (at) => {
      for (const [name, a] of addr) {
        if (!a.inMemory && liveOut.has(name) && a.regs.size > 0) {
          emit('ST', [mem(name), reg([...a.regs][0])], at);
          a.inMemory = true;
        }
      }
    };

    let flushed = false;
    block.instructions.forEach((ins, k) => {
      const at = block.start + k;
      switch (ins.op) {
        case 'label':
          code.push({ op: 'LABEL', label: ins.name, irIndex: at });
          break;
        case 'assign': {
          const r = operandReg(ins.src, k, new Set(), at);
          // x = y: x now also lives in y's register (no instruction needed).
          const a = addrOf(ins.dest.name);
          for (const old of a.regs) regDesc.get(old).delete(ins.dest.name);
          regDesc.get(r).add(ins.dest.name);
          a.regs = new Set([r]);
          a.inMemory = false;
          allocationLog.push({ irIndex: at, event: `${r} also holds ${ins.dest.name}` });
          break;
        }
        case 'binary': {
          const rl = operandReg(ins.left, k, new Set(), at);
          const rr = operandReg(ins.right, k, new Set([rl]), at);
          const rd = destReg(ins.dest.name, k, [rl, rr], at);
          emit(ALU[ins.operator], [reg(rd), reg(rl), reg(rr)], at);
          define(ins.dest.name, rd);
          break;
        }
        case 'unary': {
          const rs = operandReg(ins.src, k, new Set(), at);
          const rd = destReg(ins.dest.name, k, [rs], at);
          emit(UNARY[ins.operator], [reg(rd), reg(rs)], at);
          define(ins.dest.name, rd);
          break;
        }
        case 'input': {
          const rd = destReg(ins.dest.name, k, [], at);
          emit('IN', [reg(rd)], at);
          define(ins.dest.name, rd);
          break;
        }
        case 'print': {
          const rs = operandReg(ins.src, k, new Set(), at);
          emit(ins.valueType === 'bool' ? 'OUTB' : 'OUT', [reg(rs)], at);
          break;
        }
        case 'goto':
          flush(at);
          flushed = true;
          emit('JMP', [lab(ins.target)], at);
          break;
        case 'if': {
          const rl = operandReg(ins.left, k, new Set(), at);
          const rr = operandReg(ins.right, k, new Set([rl]), at);
          flush(at); // stores do not modify registers, so rl/rr stay valid
          flushed = true;
          emit(BRANCH[ins.operator], [reg(rl), reg(rr), lab(ins.target)], at);
          break;
        }
        default:
          throw new Error(`Code generation: unknown IR op '${ins.op}'.`);
      }
    });
    if (!flushed) flush(block.end);
  }
}
