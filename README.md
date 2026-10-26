# Compiler Design Playground

An interactive, browser-based compiler engineering lab built with React 19 and Vite 8.
Everything runs client-side; there is no backend.

* **Compiler Studio** – write your own program in **MiniC** (a documented C subset) or start
  from an example; save programs in the browser or open/download `.mc` files; compile it
  through seven connected phases and inspect the real output of each one: tokens, AST,
  symbol table, three-address code (+ quadruples/triples), optimised code with a
  transformation log, target assembly, and a step-by-step virtual CPU.
* **Algorithm Lab** – stand-alone, interactive explorations of compiler algorithms, each with
  theory notes (idea, algorithm steps, equations, worked example, complexity, references):
  Thompson NFA, subset construction, DFA minimisation, direct DFA (followpos), FIRST/FOLLOW,
  left recursion/factoring, LL(1), recursive descent, operator precedence, LR(0)/SLR(1),
  S-/L-attributed SDT, backpatching, switch translation, basic blocks/CFG, DAGs,
  reaching definitions, liveness, next-use, graph-colouring register allocation,
  activation records, SSA (dominators + φ), list scheduling and loop vectorisation analysis.
* **Language Reference** – grammar, precedence table, semantic rules and the CPU's ISA.

## Getting started

Requires Node.js 20+ (developed with Node 24).

```bash
npm install
```

```bash
npm run dev
```

Then open the printed URL (default http://localhost:5173). Other scripts:

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Run the automated test suite (Node's built-in `node:test`, no extra dependencies) |
| `npm run lint` | oxlint |

## Project layout

```
src/
  engine/        compiler algorithms (pure functions, no React)
  pipeline/      language definition, diagnostics contract, compile() orchestrator, examples
  components/    React UI: studio/ (Compiler Studio), lab/ (Algorithm Lab shell), Module*.jsx
tests/           automated tests (234 tests, including differential fuzzing)
docs/            architecture, language specification, testing, demo script, audit
```

## Documentation

* [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) – layers, data contracts, the compilation pipeline, validation strategy
* [docs/LANGUAGE.md](docs/LANGUAGE.md) – MiniC specification, grammar, semantics, target ISA, limitations
* [docs/TESTING.md](docs/TESTING.md) – test strategy and current results
* [docs/DEMO.md](docs/DEMO.md) – a 10-minute end-to-end demonstration for reviews / viva
* [docs/AUDIT.md](docs/AUDIT.md) – the initial audit of the codebase and how each finding was resolved
