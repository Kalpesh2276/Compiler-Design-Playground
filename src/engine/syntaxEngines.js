// Module 2: operator-precedence parsing and recursive-descent parsing for the classic
// expression grammar  E → E + E | E * E | ( E ) | id   (operator grammar) and its
// LL(1) form          E → T E'   E' → + T E' | ε   T → F T'   T' → * F T' | ε   F → ( E ) | id
//
// Input strings are whitespace-separated tokens, e.g. "id + id * ( id )".

const tokenize = (input) => input.trim().split(/\s+/).filter((t) => t.length > 0);

// -------------------------------------------------------------
// 1. Operator-precedence parsing
// -------------------------------------------------------------
/**
 * Precedence relations between terminals: row = topmost terminal on the stack (a),
 * column = current input terminal (b).  '<' : a yields precedence to b (shift),
 * '=' : same handle (shift), '>' : a takes precedence (reduce), 'acc', 'err'.
 * '*' binds tighter than '+', both are left-associative.
 */
export function buildOperatorPrecedenceMatrix() {
  const operators = ['+', '*', '(', ')', 'id', '$'];
  const matrix = {
    '+': { '+': '>', '*': '<', '(': '<', ')': '>', id: '<', $: '>' },
    '*': { '+': '>', '*': '>', '(': '<', ')': '>', id: '<', $: '>' },
    '(': { '+': '<', '*': '<', '(': '<', ')': '=', id: '<', $: 'err' },
    ')': { '+': '>', '*': '>', '(': 'err', ')': '>', id: 'err', $: '>' },
    id: { '+': '>', '*': '>', '(': 'err', ')': '>', id: 'err', $: '>' },
    $: { '+': '<', '*': '<', '(': '<', ')': 'err', id: '<', $: 'acc' },
  };
  return { operators, matrix };
}

const VALID_HANDLES = new Set(['id', 'E + E', 'E * E', '( E )']);

/**
 * Shift-reduce parsing driven by the precedence matrix. The relation is always looked
 * up with the TOPMOST TERMINAL on the stack (non-terminals are skipped), and a handle
 * is popped until the terminal below it yields precedence ('<') to the handle's first
 * terminal. Popped handles are checked against the grammar's right-hand sides.
 */
export function parseOperatorPrecedence(inputStr) {
  const { matrix } = buildOperatorPrecedenceMatrix();
  const tokens = [...tokenize(inputStr), '$'];
  const stack = [{ sym: '$', terminal: true, node: null }];
  const steps = [];
  let ip = 0;
  let success = false;
  let tree = null;
  let nodeId = 1;

  const topTerminalIndex = () => {
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i].terminal) return i;
    return -1;
  };
  const show = () => stack.map((s) => s.sym).join(' ');
  const record = (relation, action) => steps.push({ step: steps.length + 1, stack: show(), relation, input: tokens.slice(ip).join(' '), action });

  for (let guard = 0; guard < 10 * tokens.length + 20; guard++) {
    const a = stack[topTerminalIndex()].sym;
    const b = tokens[ip];
    if (!matrix[b]) {
      record('ERROR', `Unknown token '${b}' (expected one of + * ( ) id).`);
      return { success, steps, tree };
    }
    const rel = matrix[a][b];

    if (rel === 'acc') {
      if (stack.length === 2 && !stack[1].terminal) {
        success = true;
        tree = stack[1].node;
        record('ACCEPT', 'Accept: the input reduced to a single E.');
      } else {
        record('ERROR', 'Input ended but the stack does not hold exactly one E.');
      }
      return { success, steps, tree };
    }
    if (rel === '<' || rel === '=') {
      stack.push({ sym: b, terminal: true, node: { id: nodeId++, label: b, children: [] } });
      ip++;
      record(rel === '<' ? '⋖' : '≐', `Shift '${b}' (${a} ${rel === '<' ? '⋖' : '≐'} ${b})`);
      continue;
    }
    if (rel === '>') {
      // Pop the handle: keep popping until the terminal below the popped part ⋖ the
      // most recently popped terminal.
      const handle = [];
      let broken = false;
      for (;;) {
        // Pop up to and including the next terminal.
        let t = null;
        while (stack.length > 1 && t === null) {
          const s = stack.pop();
          handle.unshift(s);
          if (s.terminal) t = s.sym;
        }
        if (t === null || stack.length === 0) {
          broken = true;
          break;
        }
        if (matrix[stack[topTerminalIndex()].sym][t] === '<') break;
      }
      // A non-terminal directly below the handle's first terminal belongs to it (E + E).
      while (!broken && stack.length > 1 && !stack[stack.length - 1].terminal) handle.unshift(stack.pop());
      const text = handle.map((h) => (h.terminal ? h.sym : 'E')).join(' ');
      if (!VALID_HANDLES.has(text)) {
        record('ERROR', `Invalid handle [ ${text} ]: no production E → ${text}.`);
        return { success, steps, tree };
      }
      const node = { id: nodeId++, label: 'E', children: handle.map((h) => h.node) };
      stack.push({ sym: 'E', terminal: false, node });
      record('⋗', `Reduce E → ${text} (${a} ⋗ ${b})`);
      continue;
    }
    record('ERROR', `No precedence relation between '${a}' and '${b}': syntax error.`);
    return { success, steps, tree };
  }
  record('ERROR', 'Parser did not terminate (internal error).');
  return { success, steps, tree };
}

// -------------------------------------------------------------
// 2. Recursive-descent parser for the LL(1) expression grammar
// -------------------------------------------------------------
export function simulateRecursiveDescent(inputStr) {
  const tokens = tokenize(inputStr);
  let idx = 0;
  const trace = [];
  let depth = 0;
  let nodeId = 1;
  const log = (msg) => trace.push(`${'  '.repeat(depth)}${msg}`);
  const peek = () => tokens[idx] ?? '$';

  class ParseError extends Error {}
  const fail = (msg) => {
    log(`✖ ${msg}`);
    throw new ParseError(msg);
  };

  function match(expected) {
    if (peek() === expected) {
      log(`match '${expected}'`);
      idx++;
      return { id: nodeId++, label: expected, children: [] };
    }
    return fail(`expected '${expected}' but found '${peek() === '$' ? 'end of input' : peek()}'`);
  }

  function rule(name, body) {
    log(`→ ${name}()   lookahead '${peek()}'`);
    depth++;
    const children = body();
    depth--;
    log(`← ${name}()`);
    return { id: nodeId++, label: name, children };
  }

  const E = () => rule('E', () => [T(), Ep()]);
  const Ep = () =>
    rule("E'", () => {
      if (peek() === '+') return [match('+'), T(), Ep()];
      log("E' → ε");
      return [{ id: nodeId++, label: 'ε', children: [] }];
    });
  const T = () => rule('T', () => [F(), Tp()]);
  const Tp = () =>
    rule("T'", () => {
      if (peek() === '*') return [match('*'), F(), Tp()];
      log("T' → ε");
      return [{ id: nodeId++, label: 'ε', children: [] }];
    });
  const F = () =>
    rule('F', () => {
      if (peek() === 'id') return [match('id')];
      if (peek() === '(') return [match('('), E(), match(')')];
      return fail(`F cannot start with '${peek() === '$' ? 'end of input' : peek()}' (expected 'id' or '(')`);
    });

  let tree = null;
  let success = false;
  try {
    tree = E();
    if (idx < tokens.length) fail(`unexpected '${tokens[idx]}' after a complete expression`);
    success = true;
    log('✔ accepted');
  } catch (e) {
    if (!(e instanceof ParseError)) throw e;
    tree = null;
  }
  return { success, trace, tree };
}
