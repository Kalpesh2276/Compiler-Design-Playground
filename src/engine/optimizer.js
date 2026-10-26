// Machine-independent optimiser for three-address code (ir.js).
//
// optimizeIR(instructions, { liveAtExit, passes }) -> {
//   instructions,               optimised TAC (the input array is never modified)
//   log: [{ round, pass, action, before, after }],
//   rounds, stats: { [pass]: count }, before: n, after: n
// }
//
// Passes (each can be switched off through `passes`):
//   constantPropagation  global constant propagation over the CFG (lattice ⊤/const/⊥),
//                        constant folding, algebraic identities, constant-branch folding
//   copyPropagation      local: after x = y, uses of x become y until x or y changes
//   cse                  local common-subexpression elimination (available expressions)
//   deadCode             global liveness-based dead-assignment elimination
//   controlFlow          unreachable-block removal, goto-to-next removal, unused labels
//
// Correctness rules enforced here:
//   * Only pure computations (assign / binary / unary) are ever removed or rewritten into
//     copies; input(), print and branches are never deleted as "dead".
//   * A division or modulo whose divisor is not a known non-zero constant may trap, so it
//     is never removed by DCE and never folded.
//   * Folding uses intArith.js – the same arithmetic the interpreter and CPU use.
//   * After every round the result is checked with validateIR (e.g. no branch may target a
//     deleted label); a violation throws instead of returning broken code.

import { evalBinary, evalUnary, ArithmeticError, mayTrap } from './intArith.js';
import { constOp, defOf, usesOf, isPureComputation, formatInstruction, validateIR, sameOperand } from './ir.js';
import { buildBasicBlocksAndCFG, computeLiveness, reachableBlocks, reversePostOrder } from './optimizationCFG.js';

export const DEFAULT_PASSES = {
  constantPropagation: true,
  copyPropagation: true,
  cse: true,
  deadCode: true,
  controlFlow: true,
};

export const PASS_DESCRIPTIONS = {
  constantPropagation: 'Constant propagation & folding (global, lattice-based)',
  copyPropagation: 'Copy propagation (local)',
  cse: 'Common-subexpression elimination (local)',
  deadCode: 'Dead-code elimination (liveness-based)',
  controlFlow: 'Control-flow cleanup (unreachable code, redundant jumps, unused labels)',
};

const MAX_ROUNDS = 12;
const fmt = formatInstruction;

export function optimizeIR(input, { liveAtExit = [], passes = {} } = {}) {
  const enabled = { ...DEFAULT_PASSES, ...passes };
  const problems = validateIR(input);
  if (problems.length) throw new Error(`optimizeIR: input IR is invalid (${problems[0]}).`);

  let code = input.map((ins) => ({ ...ins }));
  const log = [];
  const stats = Object.fromEntries(Object.keys(DEFAULT_PASSES).map((k) => [k, 0]));
  let round = 0;

  for (round = 1; round <= MAX_ROUNDS; round++) {
    const before = log.length;
    const record = (pass) => (action, beforeIns, afterIns) => {
      stats[pass]++;
      log.push({ round, pass, action, before: beforeIns ? fmt(beforeIns) : '', after: afterIns ? fmt(afterIns) : '(removed)' });
    };
    if (enabled.constantPropagation) code = constantPropagation(code, record('constantPropagation'));
    if (enabled.copyPropagation) code = copyPropagation(code, record('copyPropagation'));
    if (enabled.cse) code = commonSubexpressions(code, record('cse'));
    if (enabled.deadCode) code = deadCodeElimination(code, liveAtExit, record('deadCode'));
    if (enabled.controlFlow) code = controlFlowCleanup(code, record('controlFlow'));

    const invalid = validateIR(code);
    if (invalid.length) throw new Error(`Optimiser produced invalid IR in round ${round}: ${invalid[0]}`);
    if (log.length === before) break;
  }

  return { instructions: code, log, rounds: Math.min(round, MAX_ROUNDS), stats, before: input.length, after: code.length };
}

// ------------------------------------------------------- constant propagation
// Lattice per variable: absent = ⊤ (no definition seen yet), number = constant, NAC = ⊥.
const NAC = 'NAC';

function meet(a, b) {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return a === b ? a : NAC;
}

function valueOf(o, env) {
  return o.kind === 'const' ? o.value : env.get(o.name);
}

/** Abstract execution of one instruction; mutates env. */
function transfer(ins, env) {
  const d = defOf(ins);
  if (!d) return;
  let v = NAC;
  if (ins.op === 'assign') {
    v = valueOf(ins.src, env) ?? NAC;
  } else if (ins.op === 'binary') {
    const l = valueOf(ins.left, env);
    const r = valueOf(ins.right, env);
    if (typeof l === 'number' && typeof r === 'number') {
      try {
        v = evalBinary(ins.operator, l, r);
      } catch (e) {
        if (!(e instanceof ArithmeticError)) throw e;
        v = NAC; // division by zero stays a run-time error
      }
    }
  } else if (ins.op === 'unary') {
    const s = valueOf(ins.src, env);
    if (typeof s === 'number') v = evalUnary(ins.operator, s);
  }
  env.set(d, v);
}

function constantPropagation(code, record) {
  const cfg = buildBasicBlocksAndCFG(code);
  if (!cfg.blocks.length) return code;

  // Iterative forward data flow; IN[B] = meet of OUT[P] over predecessors already
  // reached. The program entry contributes ⊤ for every name (nothing assigned yet), so
  // the entry block – which may also be a loop header – uses the same rule.
  const outEnv = cfg.blocks.map(() => null); // null = block not reached yet
  const order = reversePostOrder(cfg);
  let changed = true;
  const inEnvOf = (b) => {
    const preds = cfg.blocks[b].pred.filter((p) => outEnv[p] !== null);
    const env = new Map();
    const names = new Set();
    preds.forEach((p) => outEnv[p].forEach((_, k) => names.add(k)));
    for (const name of names) {
      let v;
      for (const p of preds) {
        const pv = outEnv[p].has(name) ? outEnv[p].get(name) : undefined;
        v = meet(v, pv);
      }
      if (v !== undefined) env.set(name, v);
    }
    return env;
  };
  let guard = 0;
  while (changed && guard++ < 1000) {
    changed = false;
    for (const b of order) {
      const env = inEnvOf(b);
      for (const ins of cfg.blocks[b].instructions) transfer(ins, env);
      const prev = outEnv[b];
      if (!prev || prev.size !== env.size || [...env].some(([k, v]) => prev.get(k) !== v)) {
        outEnv[b] = env;
        changed = true;
      }
    }
  }

  // Rewrite using the facts that hold before each instruction.
  const result = [];
  for (const block of cfg.blocks) {
    if (outEnv[block.index] === null && block.index !== 0) {
      result.push(...block.instructions); // unreachable: left for control-flow cleanup
      continue;
    }
    const env = inEnvOf(block.index);
    for (const ins of block.instructions) {
      const rewritten = rewriteWithConstants(ins, env);
      if (rewritten === null) {
        record('constant branch never taken', ins, null);
      } else if (fmt(rewritten) !== fmt(ins)) {
        record(describeConstRewrite(ins, rewritten), ins, rewritten);
      }
      if (rewritten) result.push(rewritten);
      transfer(ins, env);
    }
  }
  return result;
}

function describeConstRewrite(before, after) {
  if (before.op === 'if' && after.op === 'goto') return 'constant branch always taken';
  if (after.op === 'assign' && after.src.kind === 'const' && before.op !== 'assign') return 'constant folding';
  if (after.op === 'assign' && before.op === 'binary') return 'algebraic simplification';
  return 'constant propagation';
}

/** Returns the rewritten instruction, or null if it should be deleted. */
function rewriteWithConstants(ins, env) {
  const sub = (o) => {
    if (o.kind === 'const') return o;
    const v = env.get(o.name);
    return typeof v === 'number' ? constOp(v) : o;
  };
  switch (ins.op) {
    case 'assign':
      return { ...ins, src: sub(ins.src) };
    case 'print':
      return { ...ins, src: sub(ins.src) };
    case 'unary': {
      const src = sub(ins.src);
      if (src.kind === 'const') return { op: 'assign', dest: ins.dest, src: constOp(evalUnary(ins.operator, src.value)), span: ins.span };
      return { ...ins, src };
    }
    case 'binary': {
      const left = sub(ins.left);
      const right = sub(ins.right);
      if (left.kind === 'const' && right.kind === 'const' && !mayTrap(ins.operator, right.value)) {
        return { op: 'assign', dest: ins.dest, src: constOp(evalBinary(ins.operator, left.value, right.value)), span: ins.span };
      }
      return simplifyAlgebra({ ...ins, left, right });
    }
    case 'if': {
      const left = sub(ins.left);
      const right = sub(ins.right);
      if (left.kind === 'const' && right.kind === 'const') {
        return evalBinary(ins.operator, left.value, right.value) ? { op: 'goto', target: ins.target, span: ins.span } : null;
      }
      return { ...ins, left, right };
    }
    default:
      return ins;
  }
}

/** x+0, 0+x, x-0, x*1, 1*x, x/1 -> x ;  x*0, 0*x -> 0. (No trapping cases.) */
function simplifyAlgebra(ins) {
  const { operator: op, left: l, right: r } = ins;
  const isK = (o, k) => o.kind === 'const' && o.value === k;
  const copy = (src) => ({ op: 'assign', dest: ins.dest, src, span: ins.span });
  if (op === '+' && isK(r, 0)) return copy(l);
  if (op === '+' && isK(l, 0)) return copy(r);
  if (op === '-' && isK(r, 0)) return copy(l);
  if (op === '*' && isK(r, 1)) return copy(l);
  if (op === '*' && isK(l, 1)) return copy(r);
  if (op === '*' && (isK(r, 0) || isK(l, 0))) return copy(constOp(0));
  if (op === '/' && isK(r, 1)) return copy(l);
  return ins;
}

// ------------------------------------------------------------ copy propagation
function copyPropagation(code, record) {
  const cfg = buildBasicBlocksAndCFG(code);
  const result = [];
  for (const block of cfg.blocks) {
    const copies = new Map(); // x -> operand y  (x = y holds)
    const kill = (name) => {
      copies.delete(name);
      for (const [x, y] of [...copies]) if (y.kind !== 'const' && y.name === name) copies.delete(x);
    };
    for (const ins of block.instructions) {
      const sub = (o) => (o.kind !== 'const' && copies.has(o.name) && copies.get(o.name).kind !== 'const' ? copies.get(o.name) : o);
      let out = ins;
      if (ins.op === 'assign' || ins.op === 'unary' || ins.op === 'print') out = { ...ins, src: sub(ins.src) };
      if (ins.op === 'binary' || ins.op === 'if') out = { ...ins, left: sub(ins.left), right: sub(ins.right) };
      if (fmt(out) !== fmt(ins)) record('copy propagated', ins, out);
      const d = defOf(out);
      if (d) {
        kill(d);
        if (out.op === 'assign' && out.src.kind !== 'const' && out.src.name !== d) copies.set(d, out.src);
      }
      result.push(out);
    }
  }
  return result;
}

// --------------------------------------------------------------------- CSE
const COMMUTATIVE = new Set(['+', '*', '==', '!=']);

function exprKey(ins) {
  const k = (o) => (o.kind === 'const' ? `#${o.value}` : o.name);
  if (ins.op === 'unary') return `u${ins.operator}${k(ins.src)}`;
  let a = k(ins.left);
  let b = k(ins.right);
  if (COMMUTATIVE.has(ins.operator) && a > b) [a, b] = [b, a];
  return `${a}${ins.operator}${b}`;
}

function commonSubexpressions(code, record) {
  const cfg = buildBasicBlocksAndCFG(code);
  const result = [];
  for (const block of cfg.blocks) {
    const available = new Map(); // key -> { holder: operand, operands: names[] }
    for (const ins of block.instructions) {
      let out = ins;
      if (ins.op === 'binary' || ins.op === 'unary') {
        const key = exprKey(ins);
        const hit = available.get(key);
        if (hit && hit.holder.name !== ins.dest.name) {
          out = { op: 'assign', dest: ins.dest, src: hit.holder, span: ins.span };
          record(`reuse ${hit.holder.name}`, ins, out);
        }
      }
      const d = defOf(out);
      if (d) {
        for (const [key, entry] of [...available]) {
          if (entry.holder.name === d || entry.operands.includes(d)) available.delete(key);
        }
        if ((ins.op === 'binary' || ins.op === 'unary') && out === ins) {
          const operands = usesOf(ins).map((o) => o.name);
          if (!operands.includes(d)) available.set(exprKey(ins), { holder: ins.dest, operands });
        }
      }
      result.push(out);
    }
  }
  return result;
}

// --------------------------------------------------------- dead-code elimination
function deadCodeElimination(code, liveAtExit, record) {
  const cfg = buildBasicBlocksAndCFG(code);
  const { liveAfter } = computeLiveness(cfg, liveAtExit);
  const result = [];
  code.forEach((ins, i) => {
    const d = defOf(ins);
    const removable =
      isPureComputation(ins) &&
      !liveAfter[i].has(d) &&
      !(ins.op === 'binary' && mayTrap(ins.operator, ins.right.kind === 'const' ? ins.right.value : undefined));
    const selfCopy = ins.op === 'assign' && ins.src.kind !== 'const' && sameOperand(ins.src, ins.dest);
    if (removable || selfCopy) {
      record(selfCopy ? 'self-assignment removed' : `'${d}' is dead here`, ins, null);
    } else {
      result.push(ins);
    }
  });
  return result;
}

// ------------------------------------------------------------ control flow
function controlFlowCleanup(code, record) {
  let out = code;

  // 1. Remove unreachable blocks.
  const cfg = buildBasicBlocksAndCFG(out);
  if (cfg.blocks.length) {
    const reachable = reachableBlocks(cfg);
    const kept = [];
    for (const b of cfg.blocks) {
      if (reachable.has(b.index)) kept.push(...b.instructions);
      else b.instructions.forEach((ins) => ins.op !== 'label' && record('unreachable code', ins, null));
    }
    out = kept;
  }

  // 2. Remove 'goto L' / 'if … goto L' when L labels the very next instruction(s).
  const next = [];
  for (let i = 0; i < out.length; i++) {
    const ins = out[i];
    if (ins.op === 'goto' || ins.op === 'if') {
      let j = i + 1;
      let fallsInto = false;
      while (j < out.length && out[j].op === 'label') {
        if (out[j].name === ins.target) fallsInto = true;
        j++;
      }
      if (fallsInto) {
        record('jump to next instruction', ins, null);
        continue;
      }
    }
    next.push(ins);
  }
  out = next;

  // 3. Remove labels that no jump refers to.
  const targets = new Set(out.filter((ins) => ins.op === 'goto' || ins.op === 'if').map((ins) => ins.target));
  return out.filter((ins) => {
    if (ins.op === 'label' && !targets.has(ins.name)) {
      record('unused label', ins, null);
      return false;
    }
    return true;
  });
}
