import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, DEFAULT_TOKEN_SPECS } from '../src/engine/lexer.js';
import { parseProgram, exprToString } from '../src/engine/parser.js';
import { analyzeProgram } from '../src/engine/semanticAnalyzer.js';
import { MINIC_TOKEN_SPECS } from '../src/pipeline/language.js';

const lex = (src) => tokenize(src, MINIC_TOKEN_SPECS);
const kinds = (src) => lex(src).tokens.map((t) => `${t.type}:${t.value}`);
const parse = (src) => parseProgram(lex(src).tokens);
const analyze = (src) => analyzeProgram(parse(src).ast);
const codes = (diags, severity = 'error') => diags.filter((d) => d.severity === severity).map((d) => d.code);

// ------------------------------------------------------------------- lexer
test('lexer: keywords, identifiers, integers, operators, delimiters', () => {
  assert.deepEqual(kinds('int x = 42;'), ['KEYWORD:int', 'IDENTIFIER:x', 'OPERATOR:=', 'NUMBER:42', 'DELIMITER:;']);
  assert.deepEqual(kinds('integer printx inputs'), ['IDENTIFIER:integer', 'IDENTIFIER:printx', 'IDENTIFIER:inputs']);
});

test('lexer: multi-character operators are matched before single ones', () => {
  assert.deepEqual(kinds('a<=b==c!=d>=e&&f||!g'), [
    'IDENTIFIER:a', 'OPERATOR:<=', 'IDENTIFIER:b', 'OPERATOR:==', 'IDENTIFIER:c', 'OPERATOR:!=', 'IDENTIFIER:d',
    'OPERATOR:>=', 'IDENTIFIER:e', 'OPERATOR:&&', 'IDENTIFIER:f', 'OPERATOR:||', 'OPERATOR:!', 'IDENTIFIER:g',
  ]);
});

test('lexer: whitespace and both comment styles are skipped, positions track lines', () => {
  const { tokens, errors } = lex('// first line\nint /* multi\nline */ y;\n  y = 1;');
  assert.deepEqual(errors, []);
  assert.deepEqual(tokens.map((t) => t.value), ['int', 'y', ';', 'y', '=', '1', ';']);
  const y2 = tokens[3];
  assert.equal(y2.line, 4);
  assert.equal(y2.col, 3);
  assert.equal(tokens[1].line, 3); // 'y' after the multi-line comment
});

test('lexer: start/end offsets slice back to the lexeme', () => {
  const src = 'bool ok = 10 >= 7;';
  for (const t of lex(src).tokens) assert.equal(src.slice(t.start, t.end), t.value);
});

test('lexer: invalid characters and malformed lexemes produce positioned errors', () => {
  const r = lex('int a = 3 @ 4;\nint 9abc;\n/* open');
  const messages = r.errors.map((e) => `${e.line}:${e.col} ${e.message}`);
  assert.equal(messages.length, 3);
  assert.match(messages[0], /^1:11 Unrecognized character '@'/);
  assert.match(messages[1], /^2:5 Invalid numeric literal '9abc'/);
  assert.match(messages[2], /^3:1 Unterminated block comment/);
});

test('lexer: single & and | get a helpful hint', () => {
  assert.match(lex('a & b').errors[0].message, /did you mean '&&'/);
});

test('default (lab) token specs: // comments are no longer split into two / operators (bug B1)', () => {
  const { tokens } = tokenize('a // hi', DEFAULT_TOKEN_SPECS);
  assert.deepEqual(tokens.map((t) => t.value), ['a']);
});

// ------------------------------------------------------------------ parser
function exprOf(src) {
  const { ast, diagnostics } = parse(`print(${src});`);
  assert.deepEqual(diagnostics, []);
  return exprToString(ast.body[0].value);
}

test('parser: precedence of * over + and of relational over logical', () => {
  assert.equal(exprOf('1 + 2 * 3'), '(1 + (2 * 3))');
  assert.equal(exprOf('a < b && c == d || e'), '(((a < b) && (c == d)) || e)');
  assert.equal(exprOf('-a * b'), '((-a) * b)');
  assert.equal(exprOf('!!x'), '(!(!x))');
});

test('parser: binary operators are left-associative', () => {
  assert.equal(exprOf('a - b - c'), '((a - b) - c)');
  assert.equal(exprOf('a / b / c'), '((a / b) / c)');
  assert.equal(exprOf('a % b * c'), '((a % b) * c)');
});

test('parser: parentheses override precedence', () => {
  assert.equal(exprOf('(1 + 2) * 3'), '((1 + 2) * 3)');
  assert.equal(exprOf('a - (b - c)'), '(a - (b - c))');
});

test('parser: statements produce the expected AST shapes and spans', () => {
  const src = 'int x = 1;\nwhile (x < 10) { x = x * 2; }\nif (x == 16) print(x); else print(0);';
  const { ast, diagnostics } = parse(src);
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(ast.body.map((s) => s.kind), ['VarDecl', 'While', 'If']);
  assert.equal(ast.body[1].body.kind, 'Block');
  assert.equal(ast.body[2].otherwise.kind, 'Print');
  const decl = ast.body[0];
  assert.equal(src.slice(decl.span.start, decl.span.end), 'int x = 1;');
});

test('parser: dangling else binds to the nearest if', () => {
  const { ast } = parse('if (a) if (b) print(1); else print(2);');
  const outer = ast.body[0];
  assert.equal(outer.otherwise, null);
  assert.equal(outer.then.otherwise.kind, 'Print');
});

test('parser: missing semicolon is reported at the offending token', () => {
  const { diagnostics } = parse('int x = 1\nprint(x);');
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0].message, /Expected ';' after declaration but found 'print'/);
  assert.equal(diagnostics[0].span.line, 2);
});

test('parser: unexpected end of input', () => {
  const { diagnostics } = parse('int x = (1 + ');
  assert.equal(diagnostics[0].code, 'unexpected-eof');
  const block = parse('while (true) { print(1);');
  assert.equal(block.diagnostics[0].code, 'unexpected-eof');
  assert.match(block.diagnostics[0].message, /close the block opened at line 1/);
});

test('parser: recovers and reports several independent errors, always terminating', () => {
  const { diagnostics } = parse('int = 5;\nprint(1 +);\nx = ;\nint ok = 1;');
  assert.equal(diagnostics.length, 3);
  assert.deepEqual(diagnostics.map((d) => d.span.line), [1, 2, 3]);
  // Pathological input must not hang.
  const junk = parse(')))(((;;;}}}{{{ else else 1 2 3'.repeat(20));
  assert.ok(junk.diagnostics.length > 0);
});

test('parser: unsupported C constructs get specific diagnostics', () => {
  const msg = (src) => parse(src).diagnostics[0]?.message ?? '';
  assert.match(msg('for (;;) {}'), /'for' loops are not supported/);
  assert.match(msg('float f = 1;'), /'float' is not supported/);
  assert.match(msg('int x = 1.5;'), /Floating-point literal/);
  assert.match(msg('x++;'), /Operator '\+\+' is not supported/);
  assert.match(msg('int x = f(1);'), /Function calls are not supported/);
  assert.match(msg('if (a) int y = 1;'), /cannot be the body/);
  assert.match(msg('int x = 2147483648;'), /out of range/);
});

// --------------------------------------------------------------- semantics
test('semantics: valid program has no errors and a populated symbol table', () => {
  const r = analyze('int a = 5;\nbool f = a > 2;\nif (f) { print(a); }');
  assert.deepEqual(codes(r.diagnostics), []);
  assert.deepEqual(r.symbols.map((s) => `${s.name}:${s.type}`), ['a:int', 'f:bool']);
  assert.equal(r.symbols[0].references, 2);
});

test('semantics: undeclared identifiers (use and assignment)', () => {
  const r = analyze('print(y);\nz = 1;');
  assert.deepEqual(codes(r.diagnostics), ['undeclared-variable', 'undeclared-variable']);
});

test('semantics: duplicate declaration in the same scope', () => {
  const r = analyze('int a;\nbool a;');
  assert.deepEqual(codes(r.diagnostics), ['duplicate-declaration']);
  assert.match(r.diagnostics[0].message, /already declared in this scope \(line 1\)/);
});

test('semantics: block scoping and shadowing produce distinct unique names', () => {
  const r = analyze('int x = 1;\n{ int x = 2; print(x); }\nprint(x);');
  assert.deepEqual(codes(r.diagnostics), []);
  assert.deepEqual(codes(r.diagnostics, 'warning'), ['shadowing']);
  assert.deepEqual(r.symbols.map((s) => s.uniqueName), ['x', 'x.2']);
});

test('semantics: variables are not visible outside their block', () => {
  const r = analyze('{ int inner = 1; print(inner); }\nprint(inner);');
  assert.deepEqual(codes(r.diagnostics), ['undeclared-variable']);
  assert.equal(r.diagnostics.find((d) => d.severity === 'error').span.line, 2);
});

test('semantics: a variable is not in scope inside its own initializer', () => {
  assert.deepEqual(codes(analyze('int x = x + 1;').diagnostics), ['undeclared-variable']);
});

test('semantics: type mismatches', () => {
  const errs = (src) => codes(analyze(src).diagnostics);
  assert.deepEqual(errs('int a = true;'), ['type-mismatch']);
  assert.deepEqual(errs('bool b = 1;'), ['type-mismatch']);
  assert.deepEqual(errs('int a = 1; if (a) print(a);'), ['type-mismatch']);
  assert.deepEqual(errs('bool b = true; print(b + 1);'), ['type-mismatch']);
  assert.deepEqual(errs('int a = 1; print(a && true);'), ['type-mismatch']);
  assert.deepEqual(errs('print(1 == true);'), ['type-mismatch']);
  assert.deepEqual(errs('print(-true);'), ['type-mismatch']);
  assert.deepEqual(errs('print(!1);'), ['type-mismatch']);
  assert.deepEqual(errs('print(1 < 2 < 3);'), ['type-mismatch']);
});

test('semantics: one bad sub-expression does not cascade into many errors', () => {
  assert.deepEqual(codes(analyze('int a = (zz + 1) * 2 - 3;').diagnostics), ['undeclared-variable']);
});

test('semantics: annotates every expression with a type', () => {
  const { ast } = parse('bool r = 1 + 2 < 4;');
  const { types } = analyzeProgram(ast);
  const init = ast.body[0].init;
  assert.equal(types.get(init.id), 'bool');
  assert.equal(types.get(init.left.id), 'int');
});

test('semantics: unused variables produce warnings, not errors', () => {
  const r = analyze('int unused = 3;');
  assert.deepEqual(codes(r.diagnostics), []);
  assert.deepEqual(codes(r.diagnostics, 'warning'), ['unused-variable']);
});
