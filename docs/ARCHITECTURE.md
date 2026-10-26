# Architecture

## Layers

```
components/  React: presentation and interaction only
    │  calls
pipeline/    compile.js (orchestrator) · language.js · diagnostics.js · examples.js
    │  calls
engine/      compiler algorithms – pure functions over plain data
```

* **Engines** never import React or the orchestrator. They may import the dependency-free
  contracts in `pipeline/language.js` and `pipeline/diagnostics.js`.
* **compile.js** is the only place that knows the phase order. Components never run phases
  themselves; they render the structured results.
* There is no global mutable state. Every `compile()` call builds fresh state; engines
  return new objects instead of mutating their inputs (`optimizeIR` is tested for this).

## The pipeline

```
source ─▶ lexical ─▶ syntax ─▶ semantic ─▶ ir ─▶ optimization ─▶ codegen ─▶ execution
          tokens     AST        symbols,    TAC    optimised TAC   target     CPU state,
                                types                              program    output, trace
```

| Phase | Engine | Input → output |
|---|---|---|
| Lexical | `engine/lexer.js` with `MINIC_TOKEN_SPECS` | source → `Token[]` |
| Syntax | `engine/parser.js` (recursive descent, panic-mode recovery) | tokens → AST |
| Semantic | `engine/semanticAnalyzer.js` | AST → symbols, scopes, `types`, `resolutions` |
| IR | `engine/irgen.js` | AST + semantic info → TAC (+ quadruples, triples, CFG via `engine/ir.js`) |
| Optimization | `engine/optimizer.js` | TAC → TAC + transformation log |
| Codegen | `engine/targetCodegen.js` | TAC → target instructions |
| Execution | `engine/virtualCPU.js` | target program + inputs → final state, output, trace |

`compile(source, options)` returns `{ phases, diagnostics, ok, stoppedAt }`. Each phase has
`status` = `success | warning | error | skipped | disabled`, its `output`, `diagnostics`
and timing. A failing phase stops all later phases (`skipped`); outputs of earlier phases
are kept so the UI can still show them. Exceptions thrown by an engine become an
`internal-error` diagnostic instead of crashing the app.

Options: `inputs`, `optimize`, `passes`, `strategy` (`local` | `naive`), `registerCount`,
`maxSteps`, `traceLimit`, `execute`, `preserveVariables`.

## Data contracts

| Contract | Defined in | Shape (abridged) |
|---|---|---|
| Diagnostic | `pipeline/diagnostics.js` | `{ severity, phase, code, message, span }` |
| Span | – | `{ start, end, line, col }` (offsets into the source) |
| Token | `engine/lexer.js` | `{ type, value, line, col, start, end }` |
| AST node | `engine/parser.js` | `{ id, kind, span, … }` – Program, VarDecl, Assign, Print, If, While, Block, Binary, Unary, IntLiteral, BoolLiteral, Identifier, Input |
| Symbol | `engine/semanticAnalyzer.js` | `{ id, name, uniqueName, type, scopeId, depth, declaredAt, references, assignments }` |
| TAC instruction | `engine/ir.js` | `assign`, `binary`, `unary`, `input`, `print`, `label`, `goto`, `if` with operands `{kind:'var'|'temp'|'const'}` |
| Quadruple / triple | `engine/ir.js` | `{op, arg1, arg2, result}` / `{index, op, arg1, arg2}` |
| CFG | `engine/optimizationCFG.js` | `{ blocks: [{id, start, end, instructions, succ, pred}], edges, leaders }` |
| Target instruction | `engine/virtualCPU.js` | `{ op, args: [{kind:'reg'|'imm'|'mem'|'label'}], irIndex }`, pseudo-op `LABEL` |
| CPU state | `engine/virtualCPU.js` | `{ pc, registers, memory, output, inputPos, steps, status, error }` |

Display text is always *derived* from these structures (`formatInstruction`,
`formatTargetInstruction`); no phase parses another phase's text.

## Semantics shared across phases

`engine/intArith.js` defines 32-bit integer arithmetic (wrap-around, truncating division,
C remainder, traps on division by zero). The constant folder, the IR interpreter and the
virtual CPU all use it, so compile-time and run-time results cannot disagree.

## Validation strategy

Visual plausibility is not trusted; behaviour is checked by execution.

1. **Reference semantics.** `engine/irInterpreter.js` executes TAC directly. It defines what
   a program means.
2. **Optimisation is translation-validated.** For every Studio compilation, the original and
   optimised IR are run on the current inputs and compared (output, error kind, and — with
   `preserveVariables` — final variable values). A mismatch is reported as an error.
3. **Code generation is validated.** The CPU's result is compared with the IR interpreter's.
4. **Structural checks.** `validateIR` runs after IR generation and after every optimiser
   round (e.g. no jump may target a deleted label); `assemble` checks every target
   instruction's opcode, operand kinds, registers and labels before execution.
5. **Offline evidence.** The test suite repeats 2–3 on a hand-checked corpus, for every
   optimisation pass in isolation, every code-generation strategy and 3–6 registers, and on
   300 randomly generated programs. Deliberately injected bugs (mutants) in copy
   propagation, CSE invalidation, DCE's trap guard, constant-propagation meet and spill
   stores are all caught.

Points 2 and 3 are evidence for one input, not proofs; the documentation and UI say so.

## Optimiser

`optimizeIR` iterates these passes to a fixed point (max 12 rounds):

| Pass | Scope | Notes |
|---|---|---|
| Constant propagation & folding | global (iterative data flow, lattice ⊤ / constant / ⊥) | also algebraic identities and constant-branch folding |
| Copy propagation | basic block | facts killed when either side is reassigned |
| Common-subexpression elimination | basic block | available expressions; commutative operands normalised |
| Dead-code elimination | global (liveness) | never removes input/print/branches or possibly-trapping `/` `%` |
| Control-flow cleanup | global | unreachable blocks, jumps to the next instruction, unused labels |

Observable behaviour is the program's output and run-time errors. With
`preserveVariables` the final values of all variables are also treated as observable
(they are made live at exit).

## Code generation and the virtual CPU

* `local` strategy: the Dragon Book §8.6 simple code generator – register and address
  descriptors per basic block, `getReg` preferring a register already holding the value,
  then a free one, then one whose contents are dispensable, then spilling by furthest
  next use. Live values are stored at block ends. It is block-local by design.
* `naive` strategy: load/compute/store per instruction (baseline for comparison).
* The CPU is a 3–8 register load/store machine (see the ISA in `LANGUAGE.md`). It validates
  every instruction, enforces a step budget, faults on uninitialised registers/memory and
  returns structured errors. `step()` is pure, which makes reset/rerun deterministic and
  lets the UI step forwards safely.

## Algorithm Lab

The lab modules are independent of the Studio pipeline but reuse its engines where
possible (modules 3–7 analyse IR produced by `compile()`). Algorithms that operate on their
own small languages — regexes, user-supplied grammars, the boolean language of the
backpatching demo, the array-loop language of the vectorisation analysis — are documented
as such in the UI.

## Legacy files

`engine/codegen.js` (string-based 3AC/optimiser/CPU), `components/CodeGenModule.jsx` and
`components/LexerModule.jsx` are the original implementations, superseded by the pipeline
and no longer imported. `src/App.css` is the unused Vite template stylesheet. They were
left in place pending a decision on removal (see `AUDIT.md`).
