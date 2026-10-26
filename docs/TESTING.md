# Testing

Run everything with:

```bash
npm test
```

The suite uses Node's built-in `node:test` and `node:assert` (no added dependencies). It
tests the engine and pipeline layers; the React components were verified manually in a
browser (every Studio phase and every Lab sub-tab exercised with no console errors, and no
horizontal page overflow at 375 px width).

## Current result

234 tests, 234 passing, ~3 s (Node 24, 2026-10-26).

| File | Tests | Covers |
|---|---|---|
| `automata.test.js` | 16 | Thompson NFA, subset construction, minimisation and direct DFA checked against JS `RegExp` on every string up to length 6; textbook followpos table; malformed regexes |
| `grammar.test.js` | 7 | FIRST/FOLLOW, LL(1) table and parsing, left-recursion elimination, SLR(1) table and parsing, conflict detection |
| `syntaxLab.test.js` | 10 | operator precedence (trees, associativity, errors), recursive descent, `e` terminal, multi-level left factoring, SLR(1) ε-productions and augmented-start collision |
| `frontend.test.js` | 26 | MiniC lexer (keywords, multi-char operators, comments, positions, errors), parser (precedence, associativity, dangling else, error recovery, termination, unsupported constructs), semantic analysis (undeclared, duplicate, scopes, shadowing, type errors, no error cascades) |
| `ir.test.js` | 18 | 32-bit arithmetic, IR shapes for expressions/if/while/short-circuit, IR validation, interpreter (C division, errors, step budget, overflow), quadruples and triples |
| `optimizer.test.js` | 65 | 24-program corpus with hand-computed outputs; optimisation equivalence for every pass alone and all together; targeted tests for each pass and for legacy bugs B5/B6; CFG, reaching definitions, liveness, DAG |
| `cpu.test.js` | 35 | ISA semantics, jumps, faults, step budget, program validation, purity of `step()`; differential CPU vs IR for every corpus program × {unoptimised, optimised} × {naive, local} × {3, 4, 6 registers} |
| `fuzz.test.js` | 1 | 300 random well-typed programs (seeded): interpreter vs optimised IR vs CPU in several configurations |
| `pipeline.test.js` | 28 | the eight required end-to-end scenarios, error propagation between phases, internal errors, input validation, determinism, all bundled examples |
| `labEngines.test.js` | 9 | S-/L-attributed SDT, backpatching (Dragon Book example), switch translation |
| `advanced.test.js` | 17 | SSA (φ placement, pruning, single definition on the whole corpus), scheduling invariants on every corpus block, vectorisation dependence cases, next-use, graph colouring validity, activation records |
| `theory.test.js` | 2 | every Algorithm Lab topic has well-formed theory notes |

## How expected values were obtained

Expected program outputs in `tests/corpus.js` and `tests/pipeline.test.js` were computed by
hand (the arithmetic is shown in comments) — not by running the compiler. Algorithm
results are checked against textbook examples (followpos table, 4-state minimal DFA for
`(a|b)*abb`, 12-state SLR automaton, backpatching of `a < b || c < d && e < f`) or against
an independent oracle (JavaScript `RegExp` for automata).

## Mutation checks

To confirm the differential tests can catch real mistakes, the following bugs were injected
one at a time; each made the suite fail, and the original code was restored afterwards:

| Mutant | Caught by |
|---|---|
| copy propagation forgets to kill `x→y` when `y` is reassigned | fuzz test + `copy propagation stops when…` |
| CSE forgets to invalidate expressions whose operand changes | 2 tests |
| DCE removes possibly-trapping division | 1 test |
| constant-propagation meet keeps the first constant instead of ⊥ | 23 tests |
| register spill omits the store | fuzz test |

The copy-propagation mutant initially survived; the corpus and fuzzer were strengthened
until it was caught.

## Pre-existing state

Before this work the project had no tests. The baseline run of the first regression tests
found bug B13 (direct DFA ignored `+` and `?`); see `AUDIT.md` for all findings.
