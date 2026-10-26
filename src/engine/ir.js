// Three-address code (TAC): the intermediate representation shared by IR generation,
// optimisation, analysis (CFG, data flow, SSA, scheduling) and target code generation.
//
// Operand =
//   { kind: 'var',   name }   user variable (semantic uniqueName, e.g. 'x' or 'x.2')
//   { kind: 'temp',  name }   compiler temporary ('t1', 't2', …)
//   { kind: 'const', value }  32-bit integer constant (booleans are 0/1)
// Names are unique across kinds, so `name` alone identifies a storage location.
//
// Instruction =
//   { op: 'assign', dest, src }                       dest = src
//   { op: 'binary', operator, dest, left, right }     dest = left operator right
//   { op: 'unary',  operator, dest, src }             dest = operator src   ('-' or '!')
//   { op: 'input',  dest }                            dest = input()
//   { op: 'print',  src, valueType }                  print src  ('int' | 'bool')
//   { op: 'label',  name }                            name:
//   { op: 'goto',   target }                          goto target
//   { op: 'if',     operator, left, right, target }   if left operator right goto target
// Every instruction may also carry `span` (source location of the originating statement).
//
// Instructions are treated as immutable values: passes build new arrays/objects instead
// of mutating their input.

import { BINARY_OPERATORS, RELATIONAL_OPERATORS, UNARY_OPERATORS } from './intArith.js';

export const varOp = (name) => ({ kind: 'var', name });
export const tempOp = (name) => ({ kind: 'temp', name });
export const constOp = (value) => ({ kind: 'const', value });

export const isConst = (o) => o && o.kind === 'const';
export const isLocation = (o) => o && (o.kind === 'var' || o.kind === 'temp');
export const sameOperand = (a, b) =>
  a.kind === b.kind && (a.kind === 'const' ? a.value === b.value : a.name === b.name);

// ------------------------------------------------------------------ text form
export function formatOperand(o) {
  if (!o) return '?';
  return o.kind === 'const' ? String(o.value) : o.name;
}

export function formatInstruction(ins) {
  const f = formatOperand;
  switch (ins.op) {
    case 'assign':
      return `${f(ins.dest)} = ${f(ins.src)}`;
    case 'binary':
      return `${f(ins.dest)} = ${f(ins.left)} ${ins.operator} ${f(ins.right)}`;
    case 'unary':
      return `${f(ins.dest)} = ${ins.operator}${f(ins.src)}`;
    case 'input':
      return `${f(ins.dest)} = input()`;
    case 'print':
      return `print ${f(ins.src)}${ins.valueType === 'bool' ? '  (bool)' : ''}`;
    case 'label':
      return `${ins.name}:`;
    case 'goto':
      return `goto ${ins.target}`;
    case 'if':
      return `if ${f(ins.left)} ${ins.operator} ${f(ins.right)} goto ${ins.target}`;
    default:
      return `<unknown op ${ins.op}>`;
  }
}

/** Multi-line listing with labels outdented, as in textbooks. */
export function formatProgram(instructions) {
  return instructions.map((ins) => (ins.op === 'label' ? formatInstruction(ins) : `    ${formatInstruction(ins)}`)).join('\n');
}

// --------------------------------------------------------------- def / use
/** Name of the location written by `ins`, or null. */
export function defOf(ins) {
  return ins.dest ? ins.dest.name : null;
}

/** Location operands read by `ins` (constants excluded). */
export function usesOf(ins) {
  const ops = [];
  if (ins.op === 'assign' || ins.op === 'unary' || ins.op === 'print') ops.push(ins.src);
  if (ins.op === 'binary' || ins.op === 'if') ops.push(ins.left, ins.right);
  return ops.filter(isLocation);
}

export const isJump = (ins) => ins.op === 'goto' || ins.op === 'if';
export const isLabel = (ins) => ins.op === 'label';

/** True if the instruction only computes a value (no I/O, no control transfer). */
export function isPureComputation(ins) {
  return ins.op === 'assign' || ins.op === 'binary' || ins.op === 'unary';
}

// --------------------------------------------------------------- validation
/**
 * Structural validation of a TAC program. Returns a list of problem strings (empty if
 * valid). Used at phase boundaries and after every optimisation pass to guarantee that
 * rewriting never leaves a dangling branch target.
 */
export function validateIR(instructions) {
  const problems = [];
  const labels = new Map();
  if (!Array.isArray(instructions)) return ['IR must be an array of instructions.'];

  instructions.forEach((ins, i) => {
    if (ins.op === 'label') {
      if (labels.has(ins.name)) problems.push(`#${i}: duplicate label ${ins.name}`);
      labels.set(ins.name, i);
    }
  });

  const checkValue = (o, i, what) => {
    if (!o || !['var', 'temp', 'const'].includes(o.kind)) problems.push(`#${i}: invalid ${what} operand`);
    else if (o.kind === 'const' && (!Number.isInteger(o.value) || (o.value | 0) !== o.value)) {
      problems.push(`#${i}: ${what} constant ${o.value} is not a 32-bit integer`);
    }
  };
  const checkDest = (o, i) => {
    if (!isLocation(o)) problems.push(`#${i}: destination must be a variable or temporary`);
  };

  instructions.forEach((ins, i) => {
    switch (ins.op) {
      case 'assign':
        checkDest(ins.dest, i);
        checkValue(ins.src, i, 'source');
        break;
      case 'binary':
        checkDest(ins.dest, i);
        checkValue(ins.left, i, 'left');
        checkValue(ins.right, i, 'right');
        if (!BINARY_OPERATORS.includes(ins.operator)) problems.push(`#${i}: unknown operator ${ins.operator}`);
        break;
      case 'unary':
        checkDest(ins.dest, i);
        checkValue(ins.src, i, 'source');
        if (!UNARY_OPERATORS.includes(ins.operator)) problems.push(`#${i}: unknown unary operator ${ins.operator}`);
        break;
      case 'input':
        checkDest(ins.dest, i);
        break;
      case 'print':
        checkValue(ins.src, i, 'print');
        break;
      case 'label':
        break;
      case 'goto':
        if (!labels.has(ins.target)) problems.push(`#${i}: goto targets undefined label ${ins.target}`);
        break;
      case 'if':
        checkValue(ins.left, i, 'left');
        checkValue(ins.right, i, 'right');
        if (!RELATIONAL_OPERATORS.includes(ins.operator)) problems.push(`#${i}: '${ins.operator}' is not a relational operator`);
        if (!labels.has(ins.target)) problems.push(`#${i}: branch targets undefined label ${ins.target}`);
        break;
      default:
        problems.push(`#${i}: unknown instruction '${ins.op}'`);
    }
  });
  return problems;
}

// ------------------------------------------------------ alternative notations
/** Quadruples (op, arg1, arg2, result) – a direct re-encoding of the TAC. */
export function toQuadruples(instructions) {
  const f = formatOperand;
  return instructions.map((ins) => {
    switch (ins.op) {
      case 'assign':
        return { op: '=', arg1: f(ins.src), arg2: '', result: f(ins.dest) };
      case 'binary':
        return { op: ins.operator, arg1: f(ins.left), arg2: f(ins.right), result: f(ins.dest) };
      case 'unary':
        return { op: ins.operator === '-' ? 'uminus' : 'not', arg1: f(ins.src), arg2: '', result: f(ins.dest) };
      case 'input':
        return { op: 'input', arg1: '', arg2: '', result: f(ins.dest) };
      case 'print':
        return { op: 'print', arg1: f(ins.src), arg2: '', result: '' };
      case 'label':
        return { op: 'label', arg1: '', arg2: '', result: ins.name };
      case 'goto':
        return { op: 'goto', arg1: '', arg2: '', result: ins.target };
      case 'if':
        return { op: `if${ins.operator}`, arg1: f(ins.left), arg2: f(ins.right), result: ins.target };
      default:
        return { op: '?', arg1: '', arg2: '', result: '' };
    }
  });
}

/**
 * Triples (op, arg1, arg2): results are referenced by triple position "(i)" instead of
 * temporary names. A temporary can be replaced by a position only if it is defined
 * exactly once; temporaries assigned on several paths (boolean materialisation) keep
 * their name. Labels disappear: jump targets become triple positions.
 */
export function toTriples(instructions) {
  const f = formatOperand;
  const defCount = new Map();
  for (const ins of instructions) {
    if (ins.dest && ins.dest.kind === 'temp') defCount.set(ins.dest.name, (defCount.get(ins.dest.name) || 0) + 1);
  }
  const tempPos = new Map(); // temp name -> triple index holding its value
  const triples = [];
  const labelPos = new Map();
  const pendingTargets = []; // [tripleIndex, field, label]

  const ref = (o) => (o.kind === 'temp' && tempPos.has(o.name) ? `(${tempPos.get(o.name)})` : f(o));

  const emitValue = (op, arg1, arg2, dest) => {
    const idx = triples.length;
    triples.push({ index: idx, op, arg1, arg2 });
    if (dest.kind === 'temp' && defCount.get(dest.name) === 1) {
      tempPos.set(dest.name, idx);
    } else {
      triples.push({ index: idx + 1, op: '=', arg1: f(dest), arg2: `(${idx})` });
    }
  };

  for (const ins of instructions) {
    switch (ins.op) {
      case 'assign':
        triples.push({ index: triples.length, op: '=', arg1: f(ins.dest), arg2: ref(ins.src) });
        break;
      case 'binary':
        emitValue(ins.operator, ref(ins.left), ref(ins.right), ins.dest);
        break;
      case 'unary':
        emitValue(ins.operator === '-' ? 'uminus' : 'not', ref(ins.src), '', ins.dest);
        break;
      case 'input':
        emitValue('input', '', '', ins.dest);
        break;
      case 'print':
        triples.push({ index: triples.length, op: 'print', arg1: ref(ins.src), arg2: '' });
        break;
      case 'label':
        labelPos.set(ins.name, triples.length);
        break;
      case 'goto':
        pendingTargets.push([triples.length, 'arg1', ins.target]);
        triples.push({ index: triples.length, op: 'goto', arg1: ins.target, arg2: '' });
        break;
      case 'if': {
        // (i) relop a b ; (i+1) if-true (i) goto target
        const cmp = triples.length;
        triples.push({ index: cmp, op: ins.operator, arg1: ref(ins.left), arg2: ref(ins.right) });
        pendingTargets.push([triples.length, 'arg2', ins.target]);
        triples.push({ index: cmp + 1, op: 'iftrue', arg1: `(${cmp})`, arg2: ins.target });
        break;
      }
      default:
        break;
    }
  }
  for (const [idx, field, label] of pendingTargets) {
    const target = labelPos.get(label);
    triples[idx][field] = target === undefined ? `(end)` : target >= triples.length ? '(end)' : `(${target})`;
  }
  return triples;
}

/** Indirect triples: a statement list of pointers into the triple table. */
export function toIndirectTriples(triples, base = 100) {
  return {
    statements: triples.map((t, i) => ({ position: base + i, pointsTo: t.index })),
    triples,
  };
}
