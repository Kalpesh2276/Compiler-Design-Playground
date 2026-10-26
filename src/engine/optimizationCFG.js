// Module 5: Basic blocks, control-flow graph, DAG of a basic block, and data-flow analysis
// (reaching definitions, liveness) over the structured three-address code in ir.js.
//
// CFG = {
//   blocks: [{ id: 'B1', index, start, end, instructions, labels: string[], succ: int[], pred: int[] }],
//   edges:  [{ from: 'B1', to: 'B2' | 'EXIT', kind: 'fallthrough' | 'jump' | 'branch' }],
// }
// `start`/`end` are inclusive indices into the original instruction array.

import { defOf, usesOf, isJump, formatInstruction, formatOperand } from './ir.js';

// --------------------------------------------------------------------- CFG
/**
 * Partition TAC into basic blocks using the leader algorithm:
 *   1. the first instruction is a leader;
 *   2. every label (jump target) is a leader;
 *   3. every instruction that follows a jump is a leader.
 */
export function buildBasicBlocksAndCFG(instructions) {
  if (!instructions || instructions.length === 0) return { blocks: [], edges: [], leaders: [] };

  const leaders = new Set([0]);
  instructions.forEach((ins, i) => {
    if (ins.op === 'label') leaders.add(i);
    if (isJump(ins) && i + 1 < instructions.length) leaders.add(i + 1);
  });
  const sorted = [...leaders].sort((a, b) => a - b);

  const blocks = sorted.map((start, k) => {
    const end = (k + 1 < sorted.length ? sorted[k + 1] : instructions.length) - 1;
    const body = instructions.slice(start, end + 1);
    return {
      id: `B${k + 1}`,
      index: k,
      start,
      end,
      instructions: body,
      labels: body.filter((ins) => ins.op === 'label').map((ins) => ins.name),
      succ: [],
      pred: [],
    };
  });

  const blockOfLabel = new Map();
  blocks.forEach((b) => b.labels.forEach((l) => blockOfLabel.set(l, b.index)));

  const edges = [];
  const link = (b, toIndex, kind) => {
    if (toIndex === null) {
      edges.push({ from: b.id, to: 'EXIT', kind });
      return;
    }
    if (!b.succ.includes(toIndex)) b.succ.push(toIndex);
    if (!blocks[toIndex].pred.includes(b.index)) blocks[toIndex].pred.push(b.index);
    edges.push({ from: b.id, to: blocks[toIndex].id, kind });
  };

  for (const b of blocks) {
    const last = b.instructions[b.instructions.length - 1];
    const next = b.index + 1 < blocks.length ? b.index + 1 : null;
    if (last.op === 'goto') {
      link(b, blockOfLabel.get(last.target) ?? null, 'jump');
    } else if (last.op === 'if') {
      link(b, blockOfLabel.get(last.target) ?? null, 'branch');
      link(b, next, 'fallthrough');
    } else {
      link(b, next, 'fallthrough');
    }
  }

  return { blocks, edges, leaders: sorted };
}

/** Indices of blocks reachable from the entry block. */
export function reachableBlocks(cfg) {
  const seen = new Set();
  if (!cfg.blocks.length) return seen;
  const stack = [0];
  while (stack.length) {
    const b = stack.pop();
    if (seen.has(b)) continue;
    seen.add(b);
    cfg.blocks[b].succ.forEach((s) => stack.push(s));
  }
  return seen;
}

/** Reverse post-order of reachable blocks (good iteration order for forward problems). */
export function reversePostOrder(cfg) {
  const order = [];
  const seen = new Set();
  const visit = (b) => {
    seen.add(b);
    for (const s of cfg.blocks[b].succ) if (!seen.has(s)) visit(s);
    order.push(b);
  };
  if (cfg.blocks.length) visit(0);
  return order.reverse();
}

// -------------------------------------------------------- reaching definitions
/**
 * Reaching definitions (forward, may, union):
 *   OUT[B] = GEN[B] ∪ (IN[B] − KILL[B]),  IN[B] = ∪ OUT[P] over predecessors P.
 * Definitions are numbered d1, d2, … in program order.
 */
export function computeReachingDefinitions(cfg) {
  const definitions = [];
  for (const b of cfg.blocks) {
    b.instructions.forEach((ins, k) => {
      const name = defOf(ins);
      if (name) {
        definitions.push({ id: `d${definitions.length + 1}`, variable: name, block: b.id, index: b.start + k, text: formatInstruction(ins) });
      }
    });
  }
  const defsOfVar = new Map();
  for (const d of definitions) {
    if (!defsOfVar.has(d.variable)) defsOfVar.set(d.variable, []);
    defsOfVar.get(d.variable).push(d.id);
  }

  const gen = [];
  const kill = [];
  for (const b of cfg.blocks) {
    const lastDefOfVar = new Map();
    for (const d of definitions) if (d.block === b.id) lastDefOfVar.set(d.variable, d.id);
    gen.push(new Set(lastDefOfVar.values()));
    const k = new Set();
    for (const d of definitions) {
      if (d.block === b.id) for (const other of defsOfVar.get(d.variable)) if (other !== d.id) k.add(other);
    }
    // A definition generated in B is not killed by B itself.
    for (const g of gen[gen.length - 1]) k.delete(g);
    kill.push(k);
  }

  const inSets = cfg.blocks.map(() => new Set());
  const outSets = cfg.blocks.map((_, i) => new Set(gen[i]));
  const order = reversePostOrder(cfg);
  let iterations = 0;
  let changed = true;
  while (changed) {
    changed = false;
    iterations++;
    for (const i of order) {
      const newIn = new Set();
      for (const p of cfg.blocks[i].pred) for (const d of outSets[p]) newIn.add(d);
      const newOut = new Set(gen[i]);
      for (const d of newIn) if (!kill[i].has(d)) newOut.add(d);
      if (newOut.size !== outSets[i].size) changed = true;
      inSets[i] = newIn;
      outSets[i] = newOut;
    }
  }

  const byNumber = (a, b) => Number(a.slice(1)) - Number(b.slice(1));
  return {
    definitions,
    iterations,
    blocks: cfg.blocks.map((b, i) => ({
      blockId: b.id,
      gen: [...gen[i]].sort(byNumber),
      kill: [...kill[i]].sort(byNumber),
      in: [...inSets[i]].sort(byNumber),
      out: [...outSets[i]].sort(byNumber),
    })),
  };
}

/** Kept for backwards compatibility with the original module API. */
export const performDataFlowAnalysis = (cfg) => computeReachingDefinitions(cfg).blocks;

// -------------------------------------------------------------------- liveness
/**
 * Live variables (backward, may, union):
 *   IN[B] = USE[B] ∪ (OUT[B] − DEF[B]),  OUT[B] = ∪ IN[S] over successors S.
 * `liveAtExit` lists names that are live when the program ends (by convention the
 * user's variables, so the final memory state is preserved). Also returns, for every
 * instruction, the set of names live immediately after it.
 */
export function computeLiveness(cfg, liveAtExit = []) {
  const exitLive = new Set(liveAtExit);
  const use = [];
  const def = [];
  for (const b of cfg.blocks) {
    const u = new Set();
    const d = new Set();
    for (const ins of b.instructions) {
      for (const o of usesOf(ins)) if (!d.has(o.name)) u.add(o.name);
      const w = defOf(ins);
      if (w) d.add(w);
    }
    use.push(u);
    def.push(d);
  }

  const exitsProgram = (b) => {
    const last = b.instructions[b.instructions.length - 1];
    if (last.op === 'goto') return b.succ.length === 0;
    return b.index === cfg.blocks.length - 1;
  };

  const inSets = cfg.blocks.map(() => new Set());
  const outSets = cfg.blocks.map(() => new Set());
  const order = reversePostOrder(cfg).reverse();
  const all = cfg.blocks.map((b) => b.index);
  const visitOrder = [...order, ...all.filter((i) => !order.includes(i))];
  let iterations = 0;
  let changed = true;
  while (changed) {
    changed = false;
    iterations++;
    for (const i of visitOrder) {
      const b = cfg.blocks[i];
      const out = new Set(exitsProgram(b) ? exitLive : []);
      for (const s of b.succ) for (const v of inSets[s]) out.add(v);
      const inn = new Set(use[i]);
      for (const v of out) if (!def[i].has(v)) inn.add(v);
      if (inn.size !== inSets[i].size || out.size !== outSets[i].size) changed = true;
      inSets[i] = inn;
      outSets[i] = out;
    }
  }

  // Per-instruction "live after" sets, computed backwards inside each block.
  const liveAfter = [];
  for (const b of cfg.blocks) {
    let live = new Set(outSets[b.index]);
    for (let k = b.instructions.length - 1; k >= 0; k--) {
      const ins = b.instructions[k];
      liveAfter[b.start + k] = new Set(live);
      const w = defOf(ins);
      if (w) live.delete(w);
      for (const o of usesOf(ins)) live.add(o.name);
    }
  }

  const sorted = (s) => [...s].sort();
  return {
    iterations,
    liveAfter,
    blocks: cfg.blocks.map((b, i) => ({
      blockId: b.id,
      use: sorted(use[i]),
      def: sorted(def[i]),
      in: sorted(inSets[i]),
      out: sorted(outSets[i]),
    })),
  };
}

// ------------------------------------------------------------------------ DAG
const COMMUTATIVE = new Set(['+', '*', '==', '!=']);

/**
 * DAG of one basic block (Dragon Book §8.5). Leaves are initial values (`a0`) and
 * constants; interior nodes are operators labelled with the variables that currently
 * hold their value. An operator node is reused when the same operator is applied to the
 * same children – that reuse *is* common-subexpression detection. input() and print
 * have side effects, so they always create fresh nodes and are never shared.
 */
export function buildBlockDAG(blockInstructions) {
  const nodes = [];
  const current = new Map(); // name -> node id currently holding its value
  const leafFor = new Map(); // leaf key -> node id
  const opIndex = new Map(); // "op|l|r" -> node id
  const commonSubexpressions = [];

  const addNode = (n) => {
    const node = { id: nodes.length + 1, labels: [], children: [], ...n };
    nodes.push(node);
    return node;
  };
  const detach = (name) => {
    const id = current.get(name);
    if (id !== undefined) nodes[id - 1].labels = nodes[id - 1].labels.filter((l) => l !== name);
  };
  const attach = (name, id) => {
    detach(name);
    nodes[id - 1].labels.push(name);
    current.set(name, id);
  };
  const nodeFor = (o) => {
    if (o.kind !== 'const' && current.has(o.name)) return current.get(o.name);
    const key = o.kind === 'const' ? `c:${o.value}` : `v:${o.name}`;
    if (!leafFor.has(key)) {
      const leaf = addNode({ kind: 'leaf', label: o.kind === 'const' ? String(o.value) : `${o.name}0` });
      leafFor.set(key, leaf.id);
      if (o.kind !== 'const') current.set(o.name, leaf.id);
    }
    return leafFor.get(key);
  };

  for (const ins of blockInstructions) {
    if (ins.op === 'assign') {
      attach(ins.dest.name, nodeFor(ins.src));
    } else if (ins.op === 'binary' || ins.op === 'unary') {
      const kids = ins.op === 'binary' ? [nodeFor(ins.left), nodeFor(ins.right)] : [nodeFor(ins.src)];
      const keyKids = ins.op === 'binary' && COMMUTATIVE.has(ins.operator) ? [...kids].sort((a, b) => a - b) : kids;
      const key = `${ins.op}|${ins.operator}|${keyKids.join(',')}`;
      let id = opIndex.get(key);
      if (id !== undefined) {
        commonSubexpressions.push({ instruction: formatInstruction(ins), reusedNode: id, heldBy: [...nodes[id - 1].labels] });
      } else {
        id = addNode({ kind: 'op', label: ins.op === 'unary' ? `${ins.operator}(unary)` : ins.operator, children: kids }).id;
        opIndex.set(key, id);
      }
      attach(ins.dest.name, id);
    } else if (ins.op === 'input') {
      attach(ins.dest.name, addNode({ kind: 'op', label: 'input', sideEffect: true }).id);
    } else if (ins.op === 'print') {
      addNode({ kind: 'op', label: 'print', sideEffect: true, children: [nodeFor(ins.src)] });
    } else if (ins.op === 'if') {
      addNode({ kind: 'op', label: `if ${ins.operator} → ${ins.target}`, sideEffect: true, children: [nodeFor(ins.left), nodeFor(ins.right)] });
    }
  }

  return { dagNodes: nodes, commonSubexpressions };
}

export { formatOperand };
