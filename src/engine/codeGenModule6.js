// Module 6: analyses that support code generation, computed on the shared TAC (ir.js):
//   * next-use information within a basic block (Dragon Book §8.4.2)
//   * interference graph + graph-colouring register allocation (Chaitin/Briggs style)
//   * activation-record (stack frame) layout for the program's variables
//
// The Compiler Studio's code generator uses the *block-local* descriptor allocator in
// targetCodegen.js; the graph-colouring allocator here is a global analysis shown for
// comparison and is not used to emit code.

import { defOf, usesOf, formatInstruction } from './ir.js';
import { buildBasicBlocksAndCFG, computeLiveness } from './optimizationCFG.js';

// ------------------------------------------------------------- next-use
/**
 * Backward scan of one block. Initially every name is dead except those live on exit
 * (which are live with no next use inside the block). For instruction i: x = y op z
 *   1. attach to i the current information about x, y and z;
 *   2. mark x dead with no next use;
 *   3. mark y and z live with next use i.
 * Returns rows in program order: { index, text, info: [{ name, role, live, nextUse }] }
 * plus `entry`, the information holding at the start of the block.
 */
export function computeNextUse(blockInstructions, { liveOut = [], startIndex = 0 } = {}) {
  const state = new Map(); // name -> { live, nextUse }
  for (const v of liveOut) state.set(v, { live: true, nextUse: null });
  const get = (name) => state.get(name) ?? { live: false, nextUse: null };

  const rows = [];
  for (let k = blockInstructions.length - 1; k >= 0; k--) {
    const ins = blockInstructions[k];
    const index = startIndex + k;
    const d = defOf(ins);
    const uses = usesOf(ins).map((o) => o.name);
    const info = [];
    if (d) info.push({ name: d, role: 'def', ...get(d) });
    for (const u of [...new Set(uses)]) info.push({ name: u, role: 'use', ...get(u) });
    rows.unshift({ index, text: formatInstruction(ins), info });
    if (d) state.set(d, { live: false, nextUse: null });
    for (const u of uses) state.set(u, { live: true, nextUse: index });
  }
  const entry = [...state.entries()].map(([name, s]) => ({ name, ...s })).sort((a, b) => a.name.localeCompare(b.name));
  return { rows, entry };
}

// ---------------------------------------------------- interference graph
/**
 * Two names interfere if one is defined at a point where the other is live. For a copy
 * x = y the pair (x, y) is not added, since they may share a register (Chaitin's rule).
 */
export function buildInterferenceGraph(instructions, liveAtExit = []) {
  const cfg = buildBasicBlocksAndCFG(instructions);
  const { liveAfter } = computeLiveness(cfg, liveAtExit);
  const names = new Set();
  const edges = new Set();
  const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  instructions.forEach((ins, i) => {
    for (const o of usesOf(ins)) names.add(o.name);
    const d = defOf(ins);
    if (!d) return;
    names.add(d);
    const copySource = ins.op === 'assign' && ins.src.kind !== 'const' ? ins.src.name : null;
    for (const v of liveAfter[i] ?? []) {
      if (v !== d && v !== copySource) edges.add(key(d, v));
    }
  });
  liveAtExit.forEach((v) => names.add(v));
  const nodes = [...names].sort();
  const edgeList = [...edges].map((e) => e.split('|')).sort();
  const adjacency = Object.fromEntries(nodes.map((n) => [n, new Set()]));
  for (const [a, b] of edgeList) {
    adjacency[a].add(b);
    adjacency[b].add(a);
  }
  return { nodes, edges: edgeList, adjacency };
}

/**
 * Graph colouring with k registers.
 *   simplify: repeatedly remove a node with degree < k (it can always be coloured);
 *   potential spill: if none exists, remove the node with the highest degree, optimistically;
 *   select: pop nodes and give each the lowest colour unused by its coloured neighbours;
 *           a node with no free colour becomes an actual spill (kept in memory).
 */
export function colorInterferenceGraph(graph, k) {
  if (k < 1) throw new Error('Need at least one register.');
  const degree = Object.fromEntries(graph.nodes.map((n) => [n, graph.adjacency[n].size]));
  const removed = new Set();
  const stack = [];
  const log = [];

  while (removed.size < graph.nodes.length) {
    const remaining = graph.nodes.filter((n) => !removed.has(n));
    let pick = remaining.find((n) => degree[n] < k);
    let potentialSpill = false;
    if (!pick) {
      pick = remaining.reduce((best, n) => (degree[n] > degree[best] ? n : best), remaining[0]);
      potentialSpill = true;
      log.push(`No node has degree < ${k}: push ${pick} (degree ${degree[pick]}) as a potential spill`);
    } else {
      log.push(`Simplify: push ${pick} (degree ${degree[pick]} < ${k})`);
    }
    removed.add(pick);
    stack.push({ name: pick, potentialSpill });
    for (const m of graph.adjacency[pick]) if (!removed.has(m)) degree[m]--;
  }

  const coloring = {};
  const spilled = [];
  for (let i = stack.length - 1; i >= 0; i--) {
    const { name } = stack[i];
    const used = new Set([...graph.adjacency[name]].map((m) => coloring[m]).filter((c) => c !== undefined && c !== null));
    let color = 0;
    while (used.has(color)) color++;
    if (color < k) {
      coloring[name] = color;
      log.push(`Select: ${name} → R${color}`);
    } else {
      coloring[name] = null;
      spilled.push(name);
      log.push(`Select: ${name} has neighbours in all ${k} registers → actual spill`);
    }
  }
  const colorsUsed = new Set(Object.values(coloring).filter((c) => c !== null)).size;
  return { coloring, spilled, stack: stack.map((s) => s.name), log, colorsUsed };
}

// ------------------------------------------------------- activation record
/**
 * Stack-frame layout for the program's single procedure (main), using the classic field
 * order: control information at non-negative offsets from the frame pointer, locals and
 * spill slots for temporaries at negative offsets. Offsets are in bytes.
 *
 * MiniC has no function calls, and the virtual CPU addresses variables by name, so this is
 * the layout the same variables WOULD have under a stack-based calling convention.
 */
export function generateActivationRecord({ variables = [], spillTemps = [], savedRegisters = [], wordSize = 4, procName = 'main' } = {}) {
  const rows = [];
  rows.push({ offset: `+${wordSize}`, field: 'Return address', size: wordSize, kind: 'control', note: 'where the caller resumes' });
  rows.push({ offset: '0', field: 'Control link (caller FP)', size: wordSize, kind: 'control', note: 'FP points here' });
  let off = 0;
  for (const r of savedRegisters) {
    off -= wordSize;
    rows.push({ offset: String(off), field: `Saved register ${r}`, size: wordSize, kind: 'saved', note: 'callee-saved' });
  }
  for (const v of variables) {
    off -= wordSize;
    rows.push({ offset: String(off), field: `Local ${v.sourceName ?? v.name}${v.sourceName && v.sourceName !== v.name ? ` (${v.name})` : ''}`, size: wordSize, kind: 'local', note: v.type });
  }
  for (const t of spillTemps) {
    off -= wordSize;
    rows.push({ offset: String(off), field: `Temporary ${t}`, size: wordSize, kind: 'temp', note: 'spill slot' });
  }
  return { funcName: procName, stackFrame: rows, frameSize: -off + 2 * wordSize, wordSize };
}
