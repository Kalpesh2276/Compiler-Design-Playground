# MiniC language specification

MiniC is the source language of the Compiler Studio. Every feature listed here is
supported by **all** phases: lexer, parser, semantic analyser, IR generator, optimiser,
code generator and virtual CPU. Constructs not listed are rejected with a diagnostic.
The authoritative definitions live in `src/pipeline/language.js`.

## Example

```c
// Reads n and prints n!
int n = input();
int fact = 1;
while (n > 1) {
  fact = fact * n;
  n = n - 1;
}
print(fact);
```

## Lexical structure

| Token | Pattern |
|---|---|
| Keywords | `int bool true false print input if else while` |
| Identifier | `[A-Za-z_][A-Za-z0-9_]*` that is not a keyword |
| Integer literal | `[0-9]+`, at most 2147483647 |
| Operators | `+ - * / % = == != < <= > >= && \|\| !` |
| Delimiters | `( ) { } ;` |
| Comments | `// …` to end of line, `/* … */` |

Recognised but rejected with a specific message: `for do return break continue switch case
float double char void const`, floating-point and string literals, `++ -- += -= *= /=`,
single `&` / `|`, arrays, function calls. Malformed lexemes (`9abc`, unterminated comments
or strings) are lexical errors.

## Grammar (EBNF)

```
program        → statement* EOF
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
               | "input" "(" ")" | "(" expression ")"
```

The dangling `else` binds to the nearest `if`. All binary operators are left-associative.

## Operator precedence (lowest first)

| Level | Operators | Operand types → result |
|---|---|---|
| 1 | `\|\|` | bool → bool (short-circuit) |
| 2 | `&&` | bool → bool (short-circuit) |
| 3 | `==` `!=` | int,int or bool,bool → bool |
| 4 | `<` `<=` `>` `>=` | int → bool |
| 5 | `+` `-` | int → int |
| 6 | `*` `/` `%` | int → int |
| 7 | unary `-` `!` | int → int / bool → bool |

## Static semantics

* Variables must be declared before use; redeclaration in the same scope is an error.
* Each `{ }` block is a scope; inner declarations may shadow outer ones (warning).
* A variable is not in scope in its own initialiser (`int x = x;` refers to an outer `x`).
* Declarations without initialiser start at `0` / `false`.
* Arithmetic and relational operators need `int`; `&&`, `||`, `!` need `bool`; `==`/`!=`
  need operands of the same type.
* `if`/`while` conditions must be `bool` (no implicit int→bool conversion).
* `print` accepts `int` or `bool`; `input()` has type `int`.
* Warnings: unused variables, shadowing.

## Dynamic semantics

* `int` is 32-bit two's complement; `+ - *` wrap around; `/` truncates toward zero; `%`
  takes the sign of the dividend; division or modulo by zero is a run-time error.
* `input()` returns the next value of the program's input list; reading past its end is a
  run-time error.
* `print` writes an int, or `true`/`false` for a bool.
* A program's observable behaviour is its output and its run-time error, if any.
* Execution stops with an error after `maxSteps` (default 100 000) CPU instructions.

## Target machine

Registers `R0…R(k-1)` (k = 3…8, default 4), memory cells addressed by variable name,
an input queue and an output stream.

| Opcode | Operands | Meaning |
|---|---|---|
| `LI` | Rd, #imm | Rd ← imm |
| `LD` | Rd, x | Rd ← Mem[x] |
| `ST` | x, Rs | Mem[x] ← Rs |
| `MOV` | Rd, Rs | Rd ← Rs |
| `ADD SUB MUL DIV MOD` | Rd, Rs, Rt | arithmetic (DIV/MOD trap on 0) |
| `SLT SLE SGT SGE SEQ SNE` | Rd, Rs, Rt | Rd ← 1 if the comparison holds, else 0 |
| `NEG` / `NOT` | Rd, Rs | Rd ← −Rs / Rd ← (Rs = 0) |
| `IN` | Rd | Rd ← next input |
| `OUT` / `OUTB` | Rs | print as int / bool |
| `JMP` | label | unconditional jump |
| `BLT BLE BGT BGE BEQ BNE` | Rs, Rt, label | conditional branch |
| `HALT` | – | stop |

Faults: `DivisionByZero`, `InputExhausted`, `StepLimitExceeded`, `UninitializedRegister`,
`UninitializedMemory`, `PCOutOfRange`, `InvalidProgram`.

## Known limitations

* No functions, arrays, strings, floating point or `for` loops.
* Register allocation in generated code is block-local; values are stored at the end of
  every basic block. (A global graph-colouring allocator is shown in the Lab for
  comparison but is not used to emit code.)
* Copy propagation and CSE are local to basic blocks; there is no loop-invariant code
  motion.
* The activation-record view describes the layout the variables *would* have on a stack;
  the virtual CPU addresses memory by name.
* The optimisation/execution equivalence checks in the Studio validate the current input
  only. Broader evidence comes from the test suite (see `TESTING.md`).
