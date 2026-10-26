// MiniC: the source language accepted by the Compiler Studio pipeline.
//
// This file is the single source of truth for the language definition: the lexical
// specification consumed by the generic lexer engine, the grammar shown in the UI and
// docs, and the operator table. It has no imports so engines can depend on it freely.

export const LANGUAGE_NAME = 'MiniC';

/** Keywords that MiniC implements. */
export const KEYWORDS = ['int', 'bool', 'true', 'false', 'print', 'input', 'if', 'else', 'while'];

/**
 * C keywords that are recognised lexically but rejected by the parser with a
 * "not supported" diagnostic, so users get a clear message instead of a confusing
 * "unexpected identifier".
 */
export const UNSUPPORTED_KEYWORDS = {
  for: "'for' loops are not supported; use 'while'.",
  do: "'do'/'while' loops are not supported; use 'while'.",
  return: "'return' is not supported: MiniC programs have no functions.",
  break: "'break' is not supported.",
  continue: "'continue' is not supported.",
  switch: "'switch' is not supported in MiniC (see the Algorithm Lab for switch translation).",
  case: "'case' is not supported.",
  float: "'float' is not supported: MiniC only has 'int' and 'bool'.",
  double: "'double' is not supported: MiniC only has 'int' and 'bool'.",
  char: "'char' is not supported: MiniC only has 'int' and 'bool'.",
  void: "'void' is not supported: MiniC programs have no functions.",
  const: "'const' is not supported.",
};

const keywordAlternation = [...KEYWORDS, ...Object.keys(UNSUPPORTED_KEYWORDS)].join('|');

/** Lexical specification. Order matters: the first matching spec wins. */
export const MINIC_TOKEN_SPECS = [
  { type: 'COMMENT', regex: /\/\/[^\n]*/, skip: true },
  { type: 'COMMENT', regex: /\/\*[\s\S]*?\*\//, skip: true },
  { type: 'ERROR', regex: /\/\*[\s\S]*/, error: 'Unterminated block comment (missing */).' },
  { type: 'KEYWORD', regex: new RegExp(`(?:${keywordAlternation})(?![A-Za-z0-9_])`) },
  { type: 'IDENTIFIER', regex: /[A-Za-z_][A-Za-z0-9_]*/ },
  { type: 'ERROR', regex: /\d+[A-Za-z_][A-Za-z0-9_]*/, error: "Invalid numeric literal '{lexeme}': identifiers cannot start with a digit." },
  { type: 'NUMBER', regex: /\d+(?:\.\d+)?/ },
  { type: 'STRING', regex: /"(?:[^"\\\n]|\\.)*"/ },
  { type: 'ERROR', regex: /"[^\n]*/, error: 'Unterminated string literal.' },
  { type: 'OPERATOR', regex: /(?:==|!=|<=|>=|&&|\|\||\+\+|--|\+=|-=|\*=|\/=|[-+*/%=<>!])/ },
  { type: 'ERROR', regex: /&/, error: "Bitwise '&' is not supported; did you mean '&&'?" },
  { type: 'ERROR', regex: /\|/, error: "Bitwise '|' is not supported; did you mean '||'?" },
  { type: 'DELIMITER', regex: /[;,(){}[\]]/ },
];

/** Largest int literal; ints are 32-bit two's complement at run time. */
export const INT_MAX = 2147483647;
export const INT_MIN = -2147483648;

/** Binary operators from lowest to highest precedence. All are left-associative. */
export const PRECEDENCE_LEVELS = [
  { level: 1, operators: ['||'], name: 'logical OR', operands: 'bool', result: 'bool' },
  { level: 2, operators: ['&&'], name: 'logical AND', operands: 'bool', result: 'bool' },
  { level: 3, operators: ['==', '!='], name: 'equality', operands: 'int,int or bool,bool', result: 'bool' },
  { level: 4, operators: ['<', '<=', '>', '>='], name: 'relational', operands: 'int', result: 'bool' },
  { level: 5, operators: ['+', '-'], name: 'additive', operands: 'int', result: 'int' },
  { level: 6, operators: ['*', '/', '%'], name: 'multiplicative', operands: 'int', result: 'int' },
  { level: 7, operators: ['-', '!'], name: 'unary prefix (right-assoc.)', operands: 'int / bool', result: 'int / bool' },
];

export const GRAMMAR_EBNF = `program        → statement* EOF
statement      → declaration | assignment | printStmt
               | ifStmt | whileStmt | block
declaration    → type IDENT ( "=" expression )? ";"
type           → "int" | "bool"
assignment     → IDENT "=" expression ";"
printStmt      → "print" "(" expression ")" ";"
ifStmt         → "if" "(" expression ")" body ( "else" body )?
whileStmt      → "while" "(" expression ")" body
body           → statement            (a bare declaration is not allowed here)
block          → "{" statement* "}"
expression     → logicOr
logicOr        → logicAnd ( "||" logicAnd )*
logicAnd       → equality ( "&&" equality )*
equality       → relational ( ( "==" | "!=" ) relational )*
relational     → additive ( ( "<" | "<=" | ">" | ">=" ) additive )*
additive       → multiplicative ( ( "+" | "-" ) multiplicative )*
multiplicative → unary ( ( "*" | "/" | "%" ) unary )*
unary          → ( "-" | "!" ) unary | primary
primary        → INT_LITERAL | "true" | "false" | IDENT
               | "input" "(" ")" | "(" expression ")"`;

export const LEXICAL_RULES = `IDENT        [A-Za-z_][A-Za-z0-9_]*   (not a keyword)
INT_LITERAL  [0-9]+                   (0 … ${INT_MAX})
comments     // to end of line,  /* … */
whitespace   spaces, tabs, newlines (ignored)`;

export const SEMANTIC_RULES = [
  'Every variable must be declared before use; redeclaring a name in the same scope is an error.',
  'Each { } block opens a new scope; inner declarations may shadow outer ones (reported as a warning).',
  "A variable is not in scope inside its own initializer: 'int x = x;' refers to an outer x.",
  'Declarations without an initializer start at 0 (int) or false (bool).',
  "Arithmetic and relational operators need int operands; '&&', '||', '!' need bool operands.",
  "'==' and '!=' need two operands of the same type.",
  "Conditions of 'if' and 'while' must be bool (there is no implicit int→bool conversion).",
  "print accepts int or bool. input() reads the next integer from the program's input list.",
  "A program's observable behaviour is its output and any run-time error; variables that never influence output may be optimised away.",
  'int arithmetic wraps around on 32-bit overflow; '
    + "'/' truncates toward zero; '/' or '%' by zero is a run-time error.",
];
