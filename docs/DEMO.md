# End-to-end demonstration (≈10 minutes)

A script for an academic review or viva. Start the app with `npm run dev`.

## 1. One program, seven phases (Compiler Studio)

1. Open **Compiler Studio**, choose the example **Optimization showcase** (inputs `3, 4`).
   All seven phase chips are green except *Semantics* (a warning: `unused` is never read).
2. **Lexer** – click a token: the editor selects that lexeme. Point out that `//` comments
   are gone and `4 + 6` is three tokens.
3. **Parser** – *AST diagram*: `(x + y) * (x + y) + scale` shows `*` below `+`.
   *Grammar* tab: one parse function per rule; precedence = nesting of rules.
4. **Semantics** – the symbol table (types, scopes, read/write counts) and the
   *Annotated AST* with a type on every expression.
5. **TAC** – three-address code; switch to *Quadruples*, *Triples* (results referenced by
   position) and *Basic blocks & CFG* (the `if` produces a diamond).
6. **Optimizer** – before/after, the transformation log (constant folding `scale = 10`,
   CSE reusing `x + y`, copy propagation, the unused variable removed as dead code, the
   `if (scale > 5)` branch folded away) and the green **validated** banner: original and
   optimised IR were executed on the inputs and produced the same output.
7. **Codegen** – annotated assembly: every block of target instructions is preceded by the
   TAC instruction it implements. *Register decisions* shows reuse and spills.
8. **CPU** – press **Step** a few times: the PC highlight moves, registers change
   (highlighted), `IN` consumes inputs. **Run to end**: output `59` and `1`, identical to
   the IR interpreter.

## 2. Errors stop the pipeline at the right place

* Example **Syntax errors (recovery)** – two syntax errors reported in one run (panic-mode
  recovery); phases 3–7 are *skipped*, but tokens and the partial AST remain viewable.
  Click a diagnostic to jump to the source.
* Example **Semantic errors** – four errors (type mismatch, undeclared, duplicate
  declaration, non-bool condition); IR generation never runs.
* Example **Run-time error** – division by zero is detected by the CPU (`DIV` faults),
  reported with the instruction address; earlier phases are intact.

## 3. Experiment with the compiler

* Open *Compiler options*: untick **Optimise** → more target instructions, same output.
* Choose the example **Register pressure (spills)** and set **Registers** to 3: the stats show spills, and *Register decisions* lists which values were stored to free a register.
* Switch the code generator to **naive** and compare load/store counts.

## 4. Algorithm Lab highlights

* **Regex → NFA → DFA** – `(a|b)*abb`: Thompson NFA, subset table, minimal DFA with 4
  states, then animate the string `ababb`.
* **Grammars & LL(1)** – load the left-recursive grammar, apply left-recursion
  elimination, see the conflict-free LL(1) table and the parse tree.
* **Backpatching** (Intermediate code) – `a < b || c < d && e < f` reproduces the Dragon
  Book figure: targets `102` and `104` are filled, `B.truelist = {100, 104}`,
  `B.falselist = {103, 105}` remain open.
* **Optimization → DAG of a block** – the common subexpression `x + y` is one node holding
  two names.
* **SSA** – the GCD example: φ-functions for `a` and `b` at the loop header, dominator
  tree and dominance frontiers.
* **Loop vectorisation** – compare *Forward dependence* (legal) with *Backward dependence*
  (illegal); explain why a distance-4 dependence allows 4 lanes but not 8.

## 5. Evidence of correctness

Run `npm test`: 234 tests including a hand-checked program corpus, differential testing of
every optimisation pass and code-generation configuration against the IR interpreter, and
300 randomly generated programs. `docs/TESTING.md` lists the mutants the suite detects.
