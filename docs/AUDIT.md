# Repository Audit (Stage A)

Audit date: 2026-10-20. Every finding marked **Confirmed** was reproduced by running the
engine code under Node (probe script) or by reading the source; **Suspected** items are
flagged for test coverage.

## 1. Baseline status

| Check | Result |
|---|---|
| `npm run build` | Passes (Vite 8.1.5, 1783 modules, 225 kB JS) |
| `npm run lint` (oxlint) | 0 errors, ~45 warnings (unused vars, useless regex escapes, one hook-deps warning) |
| Tests | None exist; no test runner configured |
| Version control | Directory is **not** a git repository (a copy of the original `src/` was kept outside the repo before editing) |

## 2. Actual architecture

* `src/main.jsx` → `src/App.jsx`. `App.jsx` renders **only** `Module1Lexical` and
  `Module2Syntax` ("Review Build"). Modules 3–7 exist but are unreachable.
* `src/App.css` is the unused Vite template stylesheet (not imported anywhere).
* Five additional components are never imported: `AutomataModule`, `GrammarModule`,
  `LRParserModule`, `LexerModule`, `CodeGenModule`. Three of them expose engine
  features that are otherwise unreachable (Thompson NFA, subset construction,
  minimization, string simulation, FIRST/FOLLOW, left recursion/factoring, LL(1) table,
  SLR(1) ACTION/GOTO table).
* Engines are independent string-in/string-out functions. There is **no pipeline**:
  modules 4–7 each call `generate3AC(sourceCode)` on their own text box. The "IR" passed
  between engines is an array of display strings (`"t1 = a + b"`) re-parsed with regexes.
* Several CSS classes used by components are not defined (`mt-16`, `mt-8`, `step-logs`,
  `step-log-item`, `rules-list`, `input-group-inline`).

## 3. Module → engine map

| Component | Engine functions | Reachable |
|---|---|---|
| Module1Lexical | `buildDirectDFA`, `generateLexSpec`, `tokenize` | yes |
| Module2Syntax | `parseGrammar`, `buildOperatorPrecedenceMatrix`, `parseOperatorPrecedence`, `simulateRecursiveDescent`, `createSLR1Table`, `parseStringLR` | yes |
| Module3Semantics | `evaluateSDT` | no |
| Module4ICG | `generate3AC`, `generateBackpatching`, `translateSwitchCase`, `generateIndirectTriples` | no |
| Module5Optimization | `generate3AC`, `optimizeCode`, `buildBasicBlocksAndCFG`, `buildBlockDAG`, `performDataFlowAnalysis` | no |
| Module6CodeGen | `generate3AC`, `computeNextUse`, `allocateRegistersGraphColoring`, `generateAssembly`, `generateActivationRecord` | no |
| Module7Parallelism | `generate3AC`, `convertToSSA`, `scheduleInstructions`, `analyzeLoopVectorization` | no |
| AutomataModule | `regexToNFA`, `nfaToDFA`, `minimizeDFA`, `simulateString` | no |
| GrammarModule | FIRST/FOLLOW, left recursion, left factoring, LL(1) | no |
| LRParserModule | `createSLR1Table`, `parseStringLR`, `itemToString` | no |
| LexerModule / CodeGenModule | lexer / legacy 3AC→asm→CPU | no |

## 4. Working functionality (verified by reading + probing)

* Thompson construction, ε-closure, subset construction, partition-refinement DFA
  minimization (Moore-style, labelled "Hopcroft"), NFA/DFA string simulation.
* Direct DFA (nullable/firstpos/lastpos/followpos) for `|`, `*`, concatenation.
* Grammar parsing, FIRST, FOLLOW, LL(1) table with conflict detection, LL(1) predictive
  parse with tree, left-recursion elimination (general algorithm), single-level left factoring.
* LR(0) closure/goto, canonical collection, SLR(1) table with conflict reporting,
  shift-reduce parse with tree (for grammars without ε-productions).
* Lexer: positions (line/col/start/end), keywords, identifiers, numbers, operators,
  invalid-character reporting.

## 5. Confirmed bugs

| # | Location | Bug | Evidence |
|---|---|---|---|
| B1 | `lexer.js` | `OPERATOR` spec precedes `COMMENT`, so `// hi` lexes as `/`,`/`,`hi` | `tokenize('a // hi')` |
| B2 | `semantics.js` | `evaluateSDT` ignores operators and **sums all numbers**; tree and L-attributed log are fabricated | `3 + 5 * 2` → 10 |
| B3 | `syntaxEngines.js` | Operator-precedence parser looks up the relation using the stack top even when it is the non-terminal `E` → every input with an operator is rejected | `id + id` → reject |
| B4 | `syntaxEngines.js` | Recursive descent ignores the result of `match(')')` | `( id` → accepted |
| B5 | `codegen.js optimizeCode` | Constant propagation never invalidates a constant when the variable is reassigned | `a=5; a=b+1; c=a` → `c = 5` |
| B6 | `codegen.js optimizeCode` | DCE deletes any assignment whose target *starts with `t`* (e.g. user variable `total`) | `total = 5` removed |
| B7 | `codegen.js` | Folding uses real division (`7/2 → 3.5`) while the CPU floors (`3`); division by zero folds/executes to 0 silently | probe |
| B8 | `codegen.js generate3AC` | Line/regex based; any line without `=` is silently ignored; `if`/`while` lines are emitted verbatim as "3AC" | `if (a < b) x = 1` |
| B9 | `codegen.js simulateCPU` | No step budget, unknown opcodes silently skipped, unknown memory reads as 0, no output instruction | reading |
| B10 | `grammar.js parseGrammar` | Terminal `e` is silently converted to ε (breaks the bundled dangling-else preset, where `e` = else) | probe |
| B11 | `lrParser.js` | ε-productions are never reduced (item `A → • ε` is never complete) | `S → A b, A → a \| ε` rejects `b` |
| B12 | `lrParser.js` | Augmented start `E'` collides with an existing `E'` non-terminal | non-terminals `[E', E, E', T]` |
| B13 | `directDFA.js` | `+` and `?` are silently dropped (`a+b` treated as `ab`); malformed input can crash | probe |
| B14 | `icgEngine.js generateBackpatching` | Output is hard-coded and ignores the input expression | `x > y` → code for `a < b`, `c < d` |
| B15 | `icgEngine.js translateSwitchCase` | Default branch jumps to the *last case*; cases are hard-coded in the UI | reading |
| B16 | `optimizationCFG.js performDataFlowAnalysis` | Reaching definitions are fabricated (`gen = d_B`, `in = d_init`) | reading |
| B17 | `codeGenModule6.js` | Register "graph colouring" is round-robin and ignores interference; variable list hard-coded in UI; activation record values are constants; next-use marks every operand live, treats literals as variables | reading |
| B18 | `parallelismSSA.js` | φ-node text `x_3 = φ(x_1, x_2)` hard-coded; uses before definition get version `_1`; scheduling ignores dependences (`idx / 2`); vectorization analysis is a constant string | reading |
| B19 | `Module2Syntax` | Tab claims "SLR / CLR / LALR"; only SLR(1) exists | reading |

## 6. Risks requiring tests (suspected)

* Minimization operates on a partial DFA (missing transitions treated as an implicit dead
  state) – correct by construction, needs regression tests.
* Left factoring is single-level (does not re-factor the new `A'`).
* Lexer `\b`-anchored number regex produces one error per character for `12abc`.

## 7. Plan (prioritised)

1. Test runner (Node's built-in `node:test`, zero new dependencies) + regression tests
   for the working algorithms; fix extension-less imports so engines load in Node.
2. A documented source language (MiniC) with a real front end: lexer spec, recursive-descent
   parser producing an AST with spans, semantic analyser (scopes, types, symbol table).
3. Structured three-address IR, IR generator, IR interpreter (reference semantics).
4. CFG + data-flow (reaching definitions, liveness) and a validated optimiser.
5. Target code generator (register descriptors, next-use) + virtual CPU with budgets and
   structured errors.
6. `src/pipeline/compile.js` orchestrator with diagnostics; end-to-end + differential tests.
7. Compiler Studio UI; Algorithm Lab navigation exposing all modules.
8. Repair the confirmed lab-engine bugs (B1–B19) and replace fabricated outputs with
   real algorithms driven by the shared IR.
9. Documentation.

## 8. Resolution (2026-10-21)

| # | Status | Fix |
|---|---|---|
| B1 | Fixed | `COMMENT` spec moved first; `skip`/`error` spec options added to the lexer |
| B2 | Fixed | `semantics.js` rewritten: real parse, S-attributed and L-attributed evaluation that must agree |
| B3 | Fixed | operator precedence uses the topmost terminal, full matrix incl. `( )`, handles validated, parse tree built |
| B4 | Fixed | recursive descent stops on any mismatch and rejects trailing input |
| B5–B9 | Superseded | the Studio uses the structured pipeline (`irgen`, `optimizer`, `targetCodegen`, `virtualCPU`); `codegen.js` is no longer imported |
| B10 | Fixed | only `ε`, `epsilon`, `eps` denote ε |
| B11 | Fixed | ε-productions have an empty RHS in the LR automaton and are reduced |
| B12 | Fixed | augmented start symbol is always fresh (also for primes created by left recursion / factoring) |
| B13 | Fixed | direct DFA supports `+` and `?` and reports malformed regexes |
| B14 | Fixed | one-pass backpatching with makelist/merge/backpatch on a real parse |
| B15 | Fixed | default case gets its own label; no default → jump to `next` |
| B16 | Fixed | iterative reaching definitions and liveness over the CFG |
| B17 | Fixed | next-use by backward scan, interference-graph colouring with spills, frame layout derived from the program |
| B18 | Fixed | dominators (Cooper–Harvey–Kennedy), pruned SSA with φ placement on the iterated dominance frontier, dependence-DAG list scheduling, loop dependence analysis |
| B19 | Fixed | the tab is labelled SLR(1); CLR/LALR are explicitly not implemented |
| Unreachable modules | Fixed | Algorithm Lab exposes Modules 1–7 plus AutomataModule, GrammarModule, LRParserModule |
| Missing CSS classes | Fixed | defined in `src/layout.css` |

Still present and unused (awaiting a decision): `src/engine/codegen.js`,
`src/components/CodeGenModule.jsx`, `src/components/LexerModule.jsx`, `src/App.css`,
`src/assets/*` (Vite template images).
