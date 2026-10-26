// Module 3: Syntax-directed translation (SDT) – attribute evaluation over real parse trees.
//
// evaluateSDT(expression) parses an integer expression (+ - * / and parentheses) twice:
//
//  1. S-attributed SDD on the left-recursive grammar (evaluated bottom-up, the order in
//     which an LR parser would reduce):
//       E → E1 + T  { E.val = E1.val + T.val }     E → E1 − T { E.val = E1.val − T.val }
//       E → T       { E.val = T.val }
//       T → T1 * F  { T.val = T1.val × F.val }     T → T1 / F { T.val = T1.val ÷ F.val }
//       T → F       { T.val = F.val }
//       F → ( E )   { F.val = E.val }               F → num    { F.val = num.lexval }
//
//  2. L-attributed SDD on the equivalent LL(1) grammar (evaluated top-down, left to right,
//     with an inherited attribute carrying the value computed so far):
//       E  → T { E'.inh = T.val } E' { E.val = E'.syn }
//       E' → + T { E'1.inh = E'.inh + T.val } E'1 { E'.syn = E'1.syn }   (likewise −)
//       E' → ε { E'.syn = E'.inh }
//       T  → F { T'.inh = F.val } T' { T.val = T'.syn }
//       T' → * F { T'1.inh = T'.inh × F.val } T'1 { T'.syn = T'1.syn }   (likewise /)
//       T' → ε { T'.syn = T'.inh }
//       F  → ( E ) { F.val = E.val }   F → num { F.val = num.lexval }
//
// Both evaluations must agree; arithmetic uses intArith.js (32-bit, truncating division).
// Returns { expressionStr, evaluatedValue, annotatedTree, stepLogs, lAttributed: { tree, logs, value } }.

import { evalBinary } from './intArith.js';

export const S_ATTRIBUTED_RULES = [
  'E → E1 + T   { E.val = E1.val + T.val }',
  'E → E1 − T   { E.val = E1.val − T.val }',
  'E → T        { E.val = T.val }',
  'T → T1 * F   { T.val = T1.val × F.val }',
  'T → T1 / F   { T.val = T1.val ÷ F.val }',
  'T → F        { T.val = F.val }',
  'F → ( E )    { F.val = E.val }',
  'F → num      { F.val = num.lexval }',
];

export const L_ATTRIBUTED_RULES = [
  "E  → T { E'.inh = T.val } E' { E.val = E'.syn }",
  "E' → + T { E'1.inh = E'.inh + T.val } E'1 { E'.syn = E'1.syn }",
  "E' → ε { E'.syn = E'.inh }",
  "T  → F { T'.inh = F.val } T' { T.val = T'.syn }",
  "T' → * F { T'1.inh = T'.inh × F.val } T'1 { T'.syn = T'1.syn }",
  "T' → ε { T'.syn = T'.inh }",
  'F  → ( E ) { F.val = E.val }      F → num { F.val = num.lexval }',
];

function lex(input) {
  const tokens = [];
  const re = /\s*(?:(\d+)|([-+*/()]))/y;
  let pos = 0;
  const trimmed = input.trimEnd();
  while (pos < trimmed.length) {
    re.lastIndex = pos;
    const m = re.exec(trimmed);
    if (!m) throw new Error(`Unexpected character '${trimmed.slice(pos).trimStart()[0]}' at position ${pos + 1}.`);
    tokens.push(m[1] !== undefined ? { kind: 'num', value: Number(m[1]) } : { kind: m[2] });
    pos = re.lastIndex;
  }
  tokens.push({ kind: '$' });
  return tokens;
}

const OP_NAME = { '+': '+', '-': '−', '*': '×', '/': '÷' };

export function evaluateSDT(expressionStr) {
  if (!expressionStr || !expressionStr.trim()) throw new Error('Enter an expression.');
  const tokens = lex(expressionStr);
  let id = 1;
  const leaf = (label) => ({ id: id++, label, children: [] });

  // ---------------------------------------------------- 1. S-attributed (bottom-up)
  let pos = 0;
  const stepLogs = [];
  const peek = () => tokens[pos].kind;
  const expect = (kind) => {
    if (peek() !== kind) throw new Error(`Expected '${kind}' but found '${peek() === '$' ? 'end of input' : peek()}'.`);
    pos++;
  };
  const apply = (op, a, b) => {
    try {
      return evalBinary(op, a, b);
    } catch (e) {
      throw new Error(`${e.message} (while evaluating ${a} ${op} ${b})`);
    }
  };

  // Each node: { label, sublabel: 'val = …', children, val }
  function parseE() {
    const t = parseT();
    let node = { id: id++, label: 'E', children: [t], val: t.val };
    stepLogs.push(`E → T          E.val = T.val = ${t.val}`);
    while (peek() === '+' || peek() === '-') {
      const op = peek();
      pos++;
      const right = parseT();
      const val = apply(op, node.val, right.val);
      stepLogs.push(`E → E1 ${OP_NAME[op]} T     E.val = ${node.val} ${OP_NAME[op]} ${right.val} = ${val}`);
      node = { id: id++, label: 'E', children: [node, leaf(op), right], val };
    }
    return node;
  }
  function parseT() {
    const f = parseF();
    let node = { id: id++, label: 'T', children: [f], val: f.val };
    stepLogs.push(`T → F          T.val = F.val = ${f.val}`);
    while (peek() === '*' || peek() === '/') {
      const op = peek();
      pos++;
      const right = parseF();
      const val = apply(op, node.val, right.val);
      stepLogs.push(`T → T1 ${OP_NAME[op]} F     T.val = ${node.val} ${OP_NAME[op]} ${right.val} = ${val}`);
      node = { id: id++, label: 'T', children: [node, leaf(op), right], val };
    }
    return node;
  }
  function parseF() {
    if (peek() === 'num') {
      const v = tokens[pos++].value;
      stepLogs.push(`F → num        F.val = num.lexval = ${v}`);
      return { id: id++, label: 'F', children: [leaf(`num ${v}`)], val: v };
    }
    if (peek() === '(') {
      pos++;
      const e = parseE();
      expect(')');
      stepLogs.push(`F → ( E )      F.val = E.val = ${e.val}`);
      return { id: id++, label: 'F', children: [leaf('('), e, leaf(')')], val: e.val };
    }
    throw new Error(`Expected a number or '(' but found '${peek() === '$' ? 'end of input' : peek()}'.`);
  }

  const root = parseE();
  if (peek() !== '$') throw new Error(`Unexpected '${peek()}' after the expression.`);
  const annotate = (n) => ({ ...n, sublabel: n.val !== undefined ? `val=${n.val}` : undefined, children: n.children.map(annotate) });

  // ---------------------------------------------------- 2. L-attributed (top-down)
  pos = 0;
  const logs = [];
  function E() {
    const t = T();
    logs.push(`E' .inh = T.val = ${t.val}            (inherited, passed down)`);
    const ep = Ep(t.val);
    logs.push(`E.val = E'.syn = ${ep.syn}`);
    return { id: id++, label: 'E', sublabel: `val=${ep.syn}`, children: [t, ep], val: ep.syn };
  }
  function Ep(inh) {
    if (peek() === '+' || peek() === '-') {
      const op = peek();
      pos++;
      const t = T();
      const childInh = apply(op, inh, t.val);
      logs.push(`E'1.inh = E'.inh ${OP_NAME[op]} T.val = ${inh} ${OP_NAME[op]} ${t.val} = ${childInh}`);
      const rest = Ep(childInh);
      logs.push(`E'.syn = E'1.syn = ${rest.syn}`);
      return { id: id++, label: "E'", sublabel: `inh=${inh} syn=${rest.syn}`, children: [leaf(op), t, rest], syn: rest.syn };
    }
    logs.push(`E' → ε: E'.syn = E'.inh = ${inh}`);
    return { id: id++, label: "E'", sublabel: `inh=${inh} syn=${inh}`, children: [leaf('ε')], syn: inh };
  }
  function T() {
    const f = F();
    logs.push(`T'.inh = F.val = ${f.val}`);
    const tp = Tp(f.val);
    logs.push(`T.val = T'.syn = ${tp.syn}`);
    return { id: id++, label: 'T', sublabel: `val=${tp.syn}`, children: [f, tp], val: tp.syn };
  }
  function Tp(inh) {
    if (peek() === '*' || peek() === '/') {
      const op = peek();
      pos++;
      const f = F();
      const childInh = apply(op, inh, f.val);
      logs.push(`T'1.inh = T'.inh ${OP_NAME[op]} F.val = ${inh} ${OP_NAME[op]} ${f.val} = ${childInh}`);
      const rest = Tp(childInh);
      logs.push(`T'.syn = T'1.syn = ${rest.syn}`);
      return { id: id++, label: "T'", sublabel: `inh=${inh} syn=${rest.syn}`, children: [leaf(op), f, rest], syn: rest.syn };
    }
    logs.push(`T' → ε: T'.syn = T'.inh = ${inh}`);
    return { id: id++, label: "T'", sublabel: `inh=${inh} syn=${inh}`, children: [leaf('ε')], syn: inh };
  }
  function F() {
    if (peek() === 'num') {
      const v = tokens[pos++].value;
      logs.push(`F.val = num.lexval = ${v}`);
      return { id: id++, label: 'F', sublabel: `val=${v}`, children: [leaf(`num ${v}`)], val: v };
    }
    pos++; // '(' – already validated by the first parse
    const e = E();
    pos++; // ')'
    logs.push(`F.val = E.val = ${e.val}`);
    return { id: id++, label: 'F', sublabel: `val=${e.val}`, children: [leaf('('), e, leaf(')')], val: e.val };
  }
  const lRoot = E();

  if (lRoot.val !== root.val) throw new Error('Internal error: S- and L-attributed evaluations disagree.');

  return {
    expressionStr,
    evaluatedValue: root.val,
    annotatedTree: annotate(root),
    stepLogs,
    lAttributed: { tree: lRoot, logs, value: lRoot.val },
  };
}
