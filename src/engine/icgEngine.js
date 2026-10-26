// Module 4: Intermediate code generation algorithms that complement the main pipeline:
//   * one-pass translation of boolean expressions with BACKPATCHING (Dragon Book §6.7)
//   * switch-statement translation (Dragon Book §6.8)
//   * indirect triples (re-exported from the shared IR module)

export { toIndirectTriples as generateIndirectTriples } from './ir.js';

// ------------------------------------------------------------- backpatching
// Grammar (lowest precedence first):
//   B → B1 || M B2   { backpatch(B1.falselist, M.instr); B.truelist = merge(B1.truelist, B2.truelist); B.falselist = B2.falselist }
//   B → B1 && M B2   { backpatch(B1.truelist, M.instr);  B.truelist = B2.truelist; B.falselist = merge(B1.falselist, B2.falselist) }
//   B → ! B1         { B.truelist = B1.falselist; B.falselist = B1.truelist }
//   B → ( B1 )       { B.truelist = B1.truelist; B.falselist = B1.falselist }
//   B → E1 rel E2    { B.truelist = makelist(nextinstr); B.falselist = makelist(nextinstr + 1);
//                      emit('if' E1 rel E2 'goto _'); emit('goto _') }
//   B → true         { B.truelist = makelist(nextinstr); emit('goto _') }
//   B → false        { B.falselist = makelist(nextinstr); emit('goto _') }
//   M → ε            { M.instr = nextinstr }
// `and`, `or`, `not` are accepted as synonyms of &&, ||, !. Operands E are identifiers or
// integers.

const RELOPS = ['<=', '>=', '==', '!=', '<', '>'];

function lexBool(input) {
  const tokens = [];
  const re = /\s*(?:(&&|\|\||<=|>=|==|!=|<|>|!|\(|\))|([A-Za-z_]\w*|\d+))/y;
  let pos = 0;
  const s = input.trimEnd();
  while (pos < s.length) {
    re.lastIndex = pos;
    const m = re.exec(s);
    if (!m) throw new Error(`Unexpected character '${s.slice(pos).trim()[0]}' at position ${pos + 1}.`);
    let tok = m[1] ?? m[2];
    if (tok === 'and') tok = '&&';
    else if (tok === 'or') tok = '||';
    else if (tok === 'not') tok = '!';
    tokens.push(tok);
    pos = re.lastIndex;
  }
  tokens.push('$');
  return tokens;
}

export function generateBackpatching(boolExprStr, { startQuad = 100 } = {}) {
  if (!boolExprStr || !boolExprStr.trim()) throw new Error('Enter a boolean expression.');
  const tokens = lexBool(boolExprStr);
  let pos = 0;
  const quads = []; // { quad, kind: 'if'|'goto', test?, target: number|null }
  const stepLogs = [];
  const snapshots = []; // code after each semantic action
  const nextinstr = () => startQuad + quads.length;

  const fmtList = (l) => `{${l.join(', ')}}`;
  const snapshot = (label) => snapshots.push({ label, code: quads.map((q) => ({ ...q })) });
  const emit = (q) => quads.push({ quad: nextinstr(), ...q, target: null });
  const backpatch = (list, target) => {
    for (const q of list) quads[q - startQuad].target = target;
  };
  const peek = () => tokens[pos];
  const expect = (t) => {
    if (peek() !== t) throw new Error(`Expected '${t}' but found '${peek() === '$' ? 'end of input' : peek()}'.`);
    pos++;
  };
  const isOperand = (t) => /^([A-Za-z_]\w*|\d+)$/.test(t) && !['true', 'false'].includes(t);

  function parseOr() {
    let left = parseAnd();
    while (peek() === '||') {
      pos++;
      const m = nextinstr();
      stepLogs.push(`M → ε: M.instr = ${m}`);
      const right = parseAnd();
      backpatch(left.falselist, m);
      const result = { truelist: [...left.truelist, ...right.truelist], falselist: right.falselist };
      stepLogs.push(
        `B → B1 || M B2: backpatch(${fmtList(left.falselist)}, ${m}); truelist = ${fmtList(result.truelist)}, falselist = ${fmtList(result.falselist)}`
      );
      snapshot(`after backpatching B1.falselist with ${m} (||)`);
      left = result;
    }
    return left;
  }
  function parseAnd() {
    let left = parseNot();
    while (peek() === '&&') {
      pos++;
      const m = nextinstr();
      stepLogs.push(`M → ε: M.instr = ${m}`);
      const right = parseNot();
      backpatch(left.truelist, m);
      const result = { truelist: right.truelist, falselist: [...left.falselist, ...right.falselist] };
      stepLogs.push(
        `B → B1 && M B2: backpatch(${fmtList(left.truelist)}, ${m}); truelist = ${fmtList(result.truelist)}, falselist = ${fmtList(result.falselist)}`
      );
      snapshot(`after backpatching B1.truelist with ${m} (&&)`);
      left = result;
    }
    return left;
  }
  function parseNot() {
    if (peek() === '!') {
      pos++;
      const inner = parseNot();
      stepLogs.push(`B → ! B1: swap lists → truelist = ${fmtList(inner.falselist)}, falselist = ${fmtList(inner.truelist)}`);
      return { truelist: inner.falselist, falselist: inner.truelist };
    }
    return parsePrimary();
  }
  function parsePrimary() {
    const t = peek();
    if (t === '(') {
      pos++;
      const inner = parseOr();
      expect(')');
      return inner;
    }
    if (t === 'true' || t === 'false') {
      pos++;
      const q = nextinstr();
      emit({ kind: 'goto' });
      stepLogs.push(`B → ${t}: emit ${q}: goto _ ; ${t === 'true' ? 'truelist' : 'falselist'} = {${q}}`);
      snapshot(`emitted ${q}`);
      return t === 'true' ? { truelist: [q], falselist: [] } : { truelist: [], falselist: [q] };
    }
    if (isOperand(t)) {
      pos++;
      const rel = peek();
      if (!RELOPS.includes(rel)) throw new Error(`Expected a relational operator after '${t}' but found '${rel === '$' ? 'end of input' : rel}'.`);
      pos++;
      const right = peek();
      if (!isOperand(right)) throw new Error(`Expected an identifier or number after '${rel}'.`);
      pos++;
      const q = nextinstr();
      emit({ kind: 'if', test: `${t} ${rel} ${right}` });
      emit({ kind: 'goto' });
      stepLogs.push(`B → E1 ${rel} E2: emit ${q}: if ${t} ${rel} ${right} goto _ ; emit ${q + 1}: goto _ ; truelist = {${q}}, falselist = {${q + 1}}`);
      snapshot(`emitted ${q}–${q + 1}`);
      return { truelist: [q], falselist: [q + 1] };
    }
    throw new Error(`Unexpected '${t === '$' ? 'end of input' : t}': expected a comparison, true, false, ! or '('.`);
  }

  const result = parseOr();
  if (peek() !== '$') throw new Error(`Unexpected '${peek()}' after the expression.`);

  const render = (q) => `${q.kind === 'if' ? `if ${q.test} goto` : 'goto'} ${q.target ?? '_'}`;
  const toRows = (code) => code.map((q) => ({ quad: q.quad, instruction: render(q), truelist: result.truelist.includes(q.quad), falselist: result.falselist.includes(q.quad) }));

  return {
    // All jumps exactly as first emitted (every target unknown).
    originalCode: toRows(quads.map((q) => ({ ...q, target: null }))),
    // After the semantic actions of the expression itself: only B.truelist / B.falselist stay open.
    backpatchedCode: toRows(quads),
    truelist: result.truelist,
    falselist: result.falselist,
    nextQuad: nextinstr(),
    snapshots,
    stepLogs,
  };
}

// ------------------------------------------------------------------- switch
/**
 * Translate  switch (E) { case V1: S1 ... case Vn: Sn  default: Sd }  using the
 * Dragon Book layout: the case bodies come first, the tests are placed at the end.
 *
 *         t = E                    test:  if t == V1 goto L1
 *         goto test                       ...
 *   L1:   S1 ; goto next                  if t == Vn goto Ln
 *   ...                                   goto Ld   (or goto next when there is no default)
 *   Ld:   Sd ; goto next           next:
 *
 * `cases` = [{ val, action }], `defaultAction` optional.
 */
export function translateSwitchCase(switchExpr, cases, defaultAction = null) {
  if (!switchExpr || !String(switchExpr).trim()) throw new Error('The switch expression is empty.');
  const seen = new Set();
  for (const c of cases) {
    if (seen.has(String(c.val))) throw new Error(`Duplicate case value ${c.val}.`);
    seen.add(String(c.val));
  }
  const tac = [];
  tac.push(`    t = ${switchExpr}`);
  tac.push('    goto test');
  cases.forEach((c, i) => {
    tac.push(`L${i + 1}:`);
    tac.push(`    ${c.action}`);
    tac.push('    goto next');
  });
  if (defaultAction) {
    tac.push('Ld:');
    tac.push(`    ${defaultAction}`);
    tac.push('    goto next');
  }
  tac.push('test:');
  cases.forEach((c, i) => tac.push(`    if t == ${c.val} goto L${i + 1}`));
  tac.push(defaultAction ? '    goto Ld' : '    goto next      // no default: fall out of the switch');
  tac.push('next:');
  return { tac };
}

/** Parse "1: x = 10" / "default: x = 0" lines for translateSwitchCase. */
export function parseSwitchCases(text) {
  const cases = [];
  let defaultAction = null;
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((line, i) => {
      const m = /^(default|-?\d+|'.')\s*:\s*(.+)$/.exec(line);
      if (!m) throw new Error(`Line ${i + 1}: expected "value: statement" or "default: statement".`);
      if (m[1] === 'default') {
        if (defaultAction) throw new Error('Only one default case is allowed.');
        defaultAction = m[2];
      } else {
        cases.push({ val: m[1], action: m[2] });
      }
    });
  return { cases, defaultAction };
}
