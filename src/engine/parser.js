// MiniC recursive-descent parser: tokens -> abstract syntax tree.
//
// One parse function per grammar rule (see GRAMMAR_EBNF in pipeline/language.js).
// Binary operator levels are written as loops, which yields left associativity:
// `a - b - c` parses as `(a - b) - c`.
//
// AST node = { id, kind, span, ...fields }
//   Program     { body: Stmt[] }
//   VarDecl     { varType: 'int'|'bool', name, nameSpan, init: Expr|null }
//   Assign      { name, nameSpan, value: Expr }
//   Print       { value: Expr }
//   If          { condition: Expr, then: Stmt, otherwise: Stmt|null }
//   While       { condition: Expr, body: Stmt }
//   Block       { body: Stmt[] }
//   Binary      { operator, left: Expr, right: Expr }
//   Unary       { operator: '-'|'!', operand: Expr }
//   IntLiteral  { value: number }
//   BoolLiteral { value: boolean }
//   Identifier  { name }
//   Input       {}
// span = { start, end, line, col } in source coordinates.
//
// Errors use panic-mode recovery: after a syntax error the parser skips to the next
// statement boundary (';', '}', or a statement keyword) and continues, so several
// independent errors can be reported in one run. Every loop consumes at least one
// token per iteration on the error path, so parsing always terminates.

import { error, joinSpans } from '../pipeline/diagnostics.js';
import { UNSUPPORTED_KEYWORDS, INT_MAX } from '../pipeline/language.js';

const MAX_ERRORS = 25;
const STATEMENT_KEYWORDS = new Set(['int', 'bool', 'print', 'if', 'while']);

class SyntaxError extends Error {}

export function parseProgram(tokens) {
  const toks = tokens.filter((t) => t.type !== 'COMMENT');
  const last = toks[toks.length - 1];
  const eofPos = last ? last.end : 0;
  const eof = {
    type: 'EOF',
    value: '<end of input>',
    start: eofPos,
    end: eofPos,
    line: last ? last.line : 1,
    col: last ? last.col + last.value.length : 1,
  };
  toks.push(eof);

  let pos = 0;
  let nextId = 1;
  const diagnostics = [];

  // ---------------------------------------------------------------- helpers
  const peek = (offset = 0) => toks[Math.min(pos + offset, toks.length - 1)];
  const atEnd = () => peek().type === 'EOF';
  const is = (type, value) => {
    const t = peek();
    return t.type === type && (value === undefined || t.value === value);
  };
  const isOp = (...ops) => peek().type === 'OPERATOR' && ops.includes(peek().value);
  const advance = () => toks[pos < toks.length - 1 ? pos++ : pos];
  const spanOf = (t) => ({ start: t.start, end: t.end, line: t.line, col: t.col });

  function node(kind, span, fields) {
    return { id: nextId++, kind, span, ...fields };
  }

  function describe(t) {
    return t.type === 'EOF' ? 'end of input' : `'${t.value}'`;
  }

  function fail(message, token = peek(), code = 'syntax-error') {
    diagnostics.push(error('syntax', code, message, spanOf(token)));
    throw new SyntaxError(message);
  }

  function expect(type, value, context) {
    if (is(type, value)) return advance();
    const found = peek();
    const what = value ?? type.toLowerCase();
    const prefix = found.type === 'EOF' ? 'Unexpected end of input: expected' : 'Expected';
    return fail(`${prefix} '${what}' ${context} but found ${describe(found)}.`, found,
      found.type === 'EOF' ? 'unexpected-eof' : 'syntax-error');
  }

  function rejectUnsupported() {
    const t = peek();
    if (t.type === 'KEYWORD' && UNSUPPORTED_KEYWORDS[t.value]) {
      fail(UNSUPPORTED_KEYWORDS[t.value], t, 'unsupported-feature');
    }
    if (t.type === 'STRING') fail('String literals are not supported in MiniC.', t, 'unsupported-feature');
    if (t.type === 'OPERATOR' && ['++', '--', '+=', '-=', '*=', '/='].includes(t.value)) {
      fail(`Operator '${t.value}' is not supported; write it out, e.g. 'x = x + 1;'.`, t, 'unsupported-feature');
    }
    if (t.type === 'DELIMITER' && (t.value === '[' || t.value === ']')) {
      fail('Arrays are not supported in MiniC.', t, 'unsupported-feature');
    }
  }

  /** Skip tokens until a likely statement boundary (panic-mode recovery). */
  function synchronize() {
    while (!atEnd()) {
      const t = peek();
      if (t.type === 'DELIMITER' && t.value === ';') {
        advance();
        return;
      }
      if (t.type === 'DELIMITER' && t.value === '}') return;
      if (t.type === 'KEYWORD' && STATEMENT_KEYWORDS.has(t.value)) return;
      advance();
    }
  }

  // ------------------------------------------------------------- statements
  function parseStatementList(terminator) {
    const body = [];
    while (!atEnd() && !(terminator && is('DELIMITER', terminator))) {
      if (diagnostics.length >= MAX_ERRORS) break;
      const before = pos;
      try {
        body.push(parseStatement(true));
      } catch (e) {
        if (!(e instanceof SyntaxError)) throw e;
        synchronize();
        // Guarantee progress if synchronize stopped on the offending token.
        if (pos === before) advance();
      }
    }
    return body;
  }

  function parseStatement(allowDeclaration) {
    rejectUnsupported();
    const t = peek();

    if (t.type === 'KEYWORD' && (t.value === 'int' || t.value === 'bool')) {
      if (!allowDeclaration) {
        fail(`A declaration cannot be the body of 'if'/'while'/'else'; wrap it in { }.`, t, 'declaration-not-allowed');
      }
      return parseDeclaration();
    }
    if (t.type === 'KEYWORD' && t.value === 'print') return parsePrint();
    if (t.type === 'KEYWORD' && t.value === 'if') return parseIf();
    if (t.type === 'KEYWORD' && t.value === 'while') return parseWhile();
    if (t.type === 'DELIMITER' && t.value === '{') return parseBlock();
    if (t.type === 'IDENTIFIER') return parseAssignment();
    if (t.type === 'DELIMITER' && t.value === ';') {
      fail("Empty statement ';' is not allowed.", t, 'empty-statement');
    }
    return fail(`Expected a statement but found ${describe(t)}.`, t);
  }

  function parseDeclaration() {
    const typeTok = advance();
    rejectUnsupported();
    const nameTok = expect('IDENTIFIER', undefined, `after '${typeTok.value}'`);
    let init = null;
    if (isOp('=')) {
      advance();
      init = parseExpression();
    }
    const semi = expect('DELIMITER', ';', 'after declaration');
    return node('VarDecl', joinSpans(spanOf(typeTok), spanOf(semi)), {
      varType: typeTok.value,
      name: nameTok.value,
      nameSpan: spanOf(nameTok),
      init,
    });
  }

  function parseAssignment() {
    const nameTok = advance();
    rejectUnsupported();
    if (!isOp('=')) {
      fail(`Expected '=' after '${nameTok.value}' but found ${describe(peek())}.`, peek());
    }
    advance();
    const value = parseExpression();
    const semi = expect('DELIMITER', ';', 'after assignment');
    return node('Assign', joinSpans(spanOf(nameTok), spanOf(semi)), {
      name: nameTok.value,
      nameSpan: spanOf(nameTok),
      value,
    });
  }

  function parsePrint() {
    const kw = advance();
    expect('DELIMITER', '(', "after 'print'");
    const value = parseExpression();
    expect('DELIMITER', ')', 'to close print(...)');
    const semi = expect('DELIMITER', ';', 'after print statement');
    return node('Print', joinSpans(spanOf(kw), spanOf(semi)), { value });
  }

  function parseCondition(keyword) {
    expect('DELIMITER', '(', `after '${keyword}'`);
    const condition = parseExpression();
    expect('DELIMITER', ')', `to close the '${keyword}' condition`);
    return condition;
  }

  function parseIf() {
    const kw = advance();
    const condition = parseCondition('if');
    const then = parseStatement(false);
    let otherwise = null;
    if (is('KEYWORD', 'else')) {
      advance();
      otherwise = parseStatement(false);
    }
    return node('If', joinSpans(spanOf(kw), (otherwise ?? then).span), { condition, then, otherwise });
  }

  function parseWhile() {
    const kw = advance();
    const condition = parseCondition('while');
    const body = parseStatement(false);
    return node('While', joinSpans(spanOf(kw), body.span), { condition, body });
  }

  function parseBlock() {
    const open = advance();
    const body = parseStatementList('}');
    const close = expect('DELIMITER', '}', `to close the block opened at line ${open.line}`);
    return node('Block', joinSpans(spanOf(open), spanOf(close)), { body });
  }

  // ------------------------------------------------------------ expressions
  function parseExpression() {
    return parseBinaryLevel(0);
  }

  // Lowest to highest precedence; each level is left-associative.
  const BINARY_LEVELS = [['||'], ['&&'], ['==', '!='], ['<', '<=', '>', '>='], ['+', '-'], ['*', '/', '%']];

  function parseBinaryLevel(level) {
    if (level === BINARY_LEVELS.length) return parseUnary();
    let left = parseBinaryLevel(level + 1);
    while (isOp(...BINARY_LEVELS[level])) {
      const opTok = advance();
      const right = parseBinaryLevel(level + 1);
      left = node('Binary', joinSpans(left.span, right.span), { operator: opTok.value, left, right });
    }
    return left;
  }

  function parseUnary() {
    if (isOp('-', '!')) {
      const opTok = advance();
      const operand = parseUnary();
      return node('Unary', joinSpans(spanOf(opTok), operand.span), { operator: opTok.value, operand });
    }
    return parsePrimary();
  }

  function parsePrimary() {
    rejectUnsupported();
    const t = peek();

    if (t.type === 'NUMBER') {
      advance();
      if (t.value.includes('.')) {
        fail(`Floating-point literal '${t.value}' is not supported: MiniC only has int.`, t, 'unsupported-feature');
      }
      const value = Number(t.value);
      if (value > INT_MAX) {
        fail(`Integer literal ${t.value} is out of range (maximum ${INT_MAX}).`, t, 'int-literal-range');
      }
      return node('IntLiteral', spanOf(t), { value });
    }
    if (t.type === 'KEYWORD' && (t.value === 'true' || t.value === 'false')) {
      advance();
      return node('BoolLiteral', spanOf(t), { value: t.value === 'true' });
    }
    if (t.type === 'KEYWORD' && t.value === 'input') {
      advance();
      expect('DELIMITER', '(', "after 'input'");
      const close = expect('DELIMITER', ')', "after 'input('");
      return node('Input', joinSpans(spanOf(t), spanOf(close)), {});
    }
    if (t.type === 'IDENTIFIER') {
      advance();
      if (is('DELIMITER', '(')) {
        fail(`Function calls are not supported ('${t.value}(...)').`, t, 'unsupported-feature');
      }
      return node('Identifier', spanOf(t), { name: t.value });
    }
    if (t.type === 'DELIMITER' && t.value === '(') {
      advance();
      const inner = parseExpression();
      expect('DELIMITER', ')', 'to close parenthesised expression');
      return inner;
    }
    if (t.type === 'EOF') {
      return fail('Unexpected end of input: expected an expression.', t, 'unexpected-eof');
    }
    return fail(`Expected an expression but found ${describe(t)}.`, t);
  }

  // ------------------------------------------------------------------ entry
  const body = parseStatementList(null);
  if (diagnostics.length >= MAX_ERRORS) {
    diagnostics.push(error('syntax', 'too-many-errors', `Stopped after ${MAX_ERRORS} syntax errors.`, null));
  }
  const programSpan = { start: 0, end: eofPos, line: 1, col: 1 };
  const ast = node('Program', programSpan, { body });
  return { ast, diagnostics, nodeCount: nextId - 1 };
}

/** Visit every node of an AST (pre-order). */
export function walkAST(root, visit) {
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    if (!n) continue;
    visit(n);
    const kids = astChildren(n);
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
}

export function astChildren(n) {
  switch (n.kind) {
    case 'Program':
    case 'Block':
      return n.body;
    case 'VarDecl':
      return n.init ? [n.init] : [];
    case 'Assign':
    case 'Print':
      return [n.value];
    case 'If':
      return [n.condition, n.then, ...(n.otherwise ? [n.otherwise] : [])];
    case 'While':
      return [n.condition, n.body];
    case 'Binary':
      return [n.left, n.right];
    case 'Unary':
      return [n.operand];
    default:
      return [];
  }
}

/** Fully parenthesised rendering of an expression (useful for showing precedence). */
export function exprToString(e) {
  switch (e.kind) {
    case 'IntLiteral':
      return String(e.value);
    case 'BoolLiteral':
      return String(e.value);
    case 'Identifier':
      return e.name;
    case 'Input':
      return 'input()';
    case 'Unary':
      return `(${e.operator}${exprToString(e.operand)})`;
    case 'Binary':
      return `(${exprToString(e.left)} ${e.operator} ${exprToString(e.right)})`;
    default:
      return `<${e.kind}>`;
  }
}
