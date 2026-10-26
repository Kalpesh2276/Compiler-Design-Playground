// Module 7: advanced analyses on the shared TAC (ir.js):
//   * dominators, dominance frontiers and conversion to SSA form with φ-functions
//   * list scheduling of a basic block on a dependence DAG
//   * dependence analysis of simple array loops for vectorisation (SIMD)

import { defOf, usesOf, formatInstruction } from './ir.js';
import { buildBasicBlocksAndCFG, computeLiveness, reversePostOrder } from './optimizationCFG.js';

// =================================================================== dominators
/**
 * Immediate dominators with the iterative algorithm of Cooper, Harvey and Kennedy, and
 * dominance frontiers with their "runner" algorithm. Only reachable blocks take part.
 * Returns { idom: {blockIndex: idomIndex}, frontier: {b: Set}, children: {b: []}, rpo }.
 */
export function computeDominators(cfg) {
  const rpo = reversePostOrder(cfg);
  const order = new Map(rpo.map((b, i) => [b, i]));
  const idom = { [rpo[0]]: rpo[0] };
  const intersect = (a, b) => {
    while (a !== b) {
      while (order.get(a) > order.get(b)) a = idom[a];
      while (order.get(b) > order.get(a)) b = idom[b];
    }
    return a;
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const b of rpo.slice(1)) {
      const preds = cfg.blocks[b].pred.filter((p) => idom[p] !== undefined);
      if (!preds.length) continue;
      let newIdom = preds[0];
      for (const p of preds.slice(1)) newIdom = intersect(p, newIdom);
      if (idom[b] !== newIdom) {
        idom[b] = newIdom;
        changed = true;
      }
    }
  }
  const frontier = Object.fromEntries(rpo.map((b) => [b, new Set()]));
  for (const b of rpo) {
    const preds = cfg.blocks[b].pred.filter((p) => order.has(p));
    if (preds.length < 2) continue;
    for (const p of preds) {
      let runner = p;
      while (runner !== idom[b]) {
        frontier[runner].add(b);
        runner = idom[runner];
      }
    }
  }
  const children = Object.fromEntries(rpo.map((b) => [b, []]));
  for (const b of rpo.slice(1)) children[idom[b]].push(b);
  return { idom, frontier, children, rpo };
}

// =================================================================== SSA
/**
 * Convert TAC to (pruned) SSA form.
 *   1. φ placement: for every name defined in several places, insert x = φ(…) in the
 *      iterated dominance frontier of its definition blocks – but only where x is live
 *      on entry (pruned SSA), so no useless φs appear.
 *   2. Renaming: walk the dominator tree keeping a stack of current versions per name.
 * Names with a single definition and no φ are already in SSA form and keep their name;
 * the others become name_1, name_2, …  A φ argument from a path on which the name has
 * no definition yet is written name_⊥.
 */
export function convertToSSA(instructions) {
  const cfg = buildBasicBlocksAndCFG(instructions);
  if (!cfg.blocks.length) return { blocks: [], dominators: [], phiCount: 0, verified: true, renamed: [] };
  const dom = computeDominators(cfg);
  const reachable = new Set(dom.rpo);
  const liveness = computeLiveness(cfg, []);
  const liveIn = cfg.blocks.map((b, i) => new Set(liveness.blocks[i].in));

  // Definition sites.
  const defBlocks = new Map();
  const defCount = new Map();
  for (const b of cfg.blocks) {
    if (!reachable.has(b.index)) continue;
    for (const ins of b.instructions) {
      const d = defOf(ins);
      if (!d) continue;
      if (!defBlocks.has(d)) defBlocks.set(d, new Set());
      defBlocks.get(d).add(b.index);
      defCount.set(d, (defCount.get(d) || 0) + 1);
    }
  }

  // 1. φ placement on the iterated dominance frontier.
  const phis = cfg.blocks.map(() => new Map()); // block -> name -> { dest, args: Map(pred -> value) }
  for (const [name, blocks] of defBlocks) {
    const work = [...blocks];
    const hasPhi = new Set();
    const everOnWork = new Set(blocks);
    while (work.length) {
      const b = work.pop();
      for (const d of dom.frontier[b] ?? []) {
        if (hasPhi.has(d) || !liveIn[d].has(name)) continue;
        phis[d].set(name, { dest: null, args: new Map() });
        hasPhi.add(d);
        if (!everOnWork.has(d)) {
          everOnWork.add(d);
          work.push(d);
        }
      }
    }
  }
  const versioned = new Set([...defCount].filter(([, c]) => c > 1).map(([name]) => name));
  phis.forEach((m) => m.forEach((_, name) => versioned.add(name)));

  // 2. Renaming over the dominator tree.
  const counter = new Map();
  const stacks = new Map();
  const top = (name) => {
    const s = stacks.get(name);
    if (!versioned.has(name)) return name;
    return s && s.length ? s[s.length - 1] : `${name}_⊥`;
  };
  const fresh = (name) => {
    if (!versioned.has(name)) return name;
    const n = (counter.get(name) || 0) + 1;
    counter.set(name, n);
    const v = `${name}_${n}`;
    if (!stacks.has(name)) stacks.set(name, []);
    stacks.get(name).push(v);
    return v;
  };
  const renameOperand = (o) => (o.kind === 'const' ? o : { ...o, name: top(o.name) });
  const ssaBlocks = cfg.blocks.map(() => []);

  const rename = (b) => {
    const pushed = [];
    for (const [name, phi] of phis[b]) {
      phi.dest = fresh(name);
      pushed.push(name);
    }
    for (const ins of cfg.blocks[b].instructions) {
      let out = { ...ins };
      if (ins.op === 'assign' || ins.op === 'unary' || ins.op === 'print') out.src = renameOperand(ins.src);
      if (ins.op === 'binary' || ins.op === 'if') {
        out.left = renameOperand(ins.left);
        out.right = renameOperand(ins.right);
      }
      if (ins.dest) {
        out.dest = { ...ins.dest, name: fresh(ins.dest.name) };
        pushed.push(ins.dest.name);
      }
      ssaBlocks[b].push(out);
    }
    for (const s of cfg.blocks[b].succ) {
      for (const [name, phi] of phis[s]) phi.args.set(b, top(name));
    }
    for (const c of dom.children[b]) rename(c);
    for (const name of pushed) if (versioned.has(name)) stacks.get(name).pop();
  };
  rename(dom.rpo[0]);

  // Verification: every name is defined exactly once.
  const defs = new Map();
  let verified = true;
  cfg.blocks.forEach((b, i) => {
    if (!reachable.has(i)) return;
    for (const phi of phis[i].values()) defs.set(phi.dest, (defs.get(phi.dest) || 0) + 1);
    for (const ins of ssaBlocks[i]) if (ins.dest) defs.set(ins.dest.name, (defs.get(ins.dest.name) || 0) + 1);
  });
  for (const c of defs.values()) if (c !== 1) verified = false;

  const blocks = cfg.blocks
    .filter((b) => reachable.has(b.index))
    .map((b) => ({
      id: b.id,
      phis: [...phis[b.index].entries()].map(([name, phi]) => ({
        variable: name,
        dest: phi.dest,
        args: cfg.blocks[b.index].pred.filter((p) => reachable.has(p)).map((p) => ({ from: cfg.blocks[p].id, value: phi.args.get(p) ?? `${name}_⊥` })),
      })),
      instructions: ssaBlocks[b.index],
      lines: [
        ...[...phis[b.index].values()].map(
          (phi) => `${phi.dest} = φ(${cfg.blocks[b.index].pred.filter((p) => reachable.has(p)).map((p) => phi.args.get(p) ?? '?').join(', ')})`
        ),
        ...ssaBlocks[b.index].map((ins) => (ins.op === 'label' ? formatInstruction(ins) : formatInstruction(ins))),
      ],
    }));

  const dominators = dom.rpo.map((b) => {
    const chain = [];
    for (let x = b; ; x = dom.idom[x]) {
      chain.push(cfg.blocks[x].id);
      if (x === dom.idom[x]) break;
    }
    return {
      block: cfg.blocks[b].id,
      idom: b === dom.rpo[0] ? '—' : cfg.blocks[dom.idom[b]].id,
      dominators: chain.reverse(),
      frontier: [...dom.frontier[b]].map((f) => cfg.blocks[f].id),
    };
  });

  return {
    cfg,
    blocks,
    dominators,
    domTreeEdges: dom.rpo.slice(1).map((b) => ({ from: cfg.blocks[dom.idom[b]].id, to: cfg.blocks[b].id })),
    phiCount: blocks.reduce((n, b) => n + b.phis.length, 0),
    versioned: [...versioned].sort(),
    verified,
  };
}

// =================================================================== scheduling
export const DEFAULT_LATENCY = { '*': 3, '/': 4, '%': 4 };
const latencyOf = (ins, table) => (ins.op === 'binary' ? table[ins.operator] ?? 1 : 1);

/**
 * List scheduling of one basic block.
 * Dependence edges i → j (i before j in program order):
 *   RAW (true):   j reads what i wrote          – j may start latency(i) cycles after i
 *   WAR (anti):   j overwrites what i reads     – j may start in the same cycle as i
 *   WAW (output): j overwrites what i wrote     – j starts at least one cycle after i
 *   I/O order:    input/print stay in program order
 *   control:      the block's final jump issues after every other instruction
 * Priority = latency-weighted longest path to the end of the block (critical path).
 * Each cycle, up to `units` ready instructions issue, highest priority first.
 */
export function scheduleInstructions(blockInstructions, { units = 2, latency = DEFAULT_LATENCY } = {}) {
  const items = blockInstructions.map((ins, i) => ({ i, ins })).filter(({ ins }) => ins.op !== 'label');
  const n = items.length;
  const lat = items.map(({ ins }) => latencyOf(ins, latency));
  const edges = [];
  const isIO = (ins) => ins.op === 'input' || ins.op === 'print';
  const isJump = (ins) => ins.op === 'goto' || ins.op === 'if';

  for (let b = 0; b < n; b++) {
    const ib = items[b].ins;
    const usesB = usesOf(ib).map((o) => o.name);
    const defB = defOf(ib);
    for (let a = b - 1; a >= 0; a--) {
      const ia = items[a].ins;
      const defA = defOf(ia);
      const usesA = usesOf(ia).map((o) => o.name);
      // RAW only to the most recent definition before b.
      if (defA && usesB.includes(defA) && !items.slice(a + 1, b).some((x) => defOf(x.ins) === defA)) {
        edges.push({ from: a, to: b, type: 'RAW', latency: lat[a], on: defA });
      }
      if (defB && usesA.includes(defB)) edges.push({ from: a, to: b, type: 'WAR', latency: 0, on: defB });
      if (defB && defA === defB) edges.push({ from: a, to: b, type: 'WAW', latency: 1, on: defB });
      if (isIO(ia) && isIO(ib)) edges.push({ from: a, to: b, type: 'I/O', latency: 1, on: '' });
      if (isJump(ib)) edges.push({ from: a, to: b, type: 'control', latency: 0, on: '' });
    }
  }
  // Deduplicate (keep the largest latency per pair).
  const best = new Map();
  for (const e of edges) {
    const k = `${e.from}>${e.to}`;
    if (!best.has(k) || best.get(k).latency < e.latency) best.set(k, e);
  }
  const deps = [...best.values()].sort((x, y) => x.to - y.to || x.from - y.from);
  const preds = Array.from({ length: n }, () => []);
  const succs = Array.from({ length: n }, () => []);
  for (const e of deps) {
    preds[e.to].push(e);
    succs[e.from].push(e);
  }

  // Critical-path priority.
  const priority = new Array(n).fill(0);
  for (let k = n - 1; k >= 0; k--) {
    priority[k] = lat[k] + Math.max(0, ...succs[k].map((e) => priority[e.to] - lat[k] + e.latency));
  }

  // Cycle-by-cycle list scheduling.
  const start = new Array(n).fill(null);
  const schedule = [];
  let scheduled = 0;
  for (let cycle = 1; scheduled < n && cycle < 10000; cycle++) {
    const ready = [];
    for (let k = 0; k < n; k++) {
      if (start[k] !== null) continue;
      // Predecessors issued in an EARLIER cycle whose latency has elapsed (zero-latency
      // predecessors therefore delay their successor to the next cycle – conservative).
      const ok = preds[k].every((e) => start[e.from] !== null && start[e.from] + e.latency <= cycle);
      if (ok) ready.push(k);
    }
    ready.sort((x, y) => priority[y] - priority[x] || x - y);
    const issued = [];
    for (const k of ready) {
      if (issued.length >= units) break;
      start[k] = cycle;
      issued.push(k);
      scheduled++;
    }
    schedule.push({ cycle, slots: issued.map((k) => ({ index: items[k].i, text: formatInstruction(items[k].ins) })) });
  }
  const finish = Math.max(0, ...items.map((_, k) => start[k] + lat[k] - 1));

  // Baseline: in-order, single issue, stalling until operands are ready.
  let t = 0;
  const seqStart = new Array(n).fill(0);
  for (let k = 0; k < n; k++) {
    t = Math.max(t + 1, ...preds[k].map((e) => seqStart[e.from] + Math.max(e.latency, 1)));
    seqStart[k] = t;
  }
  const sequentialCycles = n ? Math.max(...items.map((_, k) => seqStart[k] + lat[k] - 1)) : 0;

  return {
    nodes: items.map(({ i, ins }, k) => ({ index: i, text: formatInstruction(ins), latency: lat[k], priority: priority[k], cycle: start[k] })),
    edges: deps.map((e) => ({ ...e, fromIndex: items[e.from].i, toIndex: items[e.to].i })),
    schedule, // empty slot lists are stall cycles
    totalCycles: finish,
    sequentialCycles,
    units,
  };
}

// =================================================================== vectorisation
/**
 * Dependence analysis for loops of the form
 *     for (i = L; i < U; i++) { X[i + c] = expr; ... }
 * where array subscripts are i + constant and expr combines array elements, scalars and
 * integers with + - *. Executing the loop with vectors of width VF runs each statement for
 * VF consecutive iterations before the next statement. For a dependence between a write
 * of statement Sa and an access of statement Sb at iteration distance d, that order is
 * wrong exactly when it reverses the original order within a window of VF iterations:
 *   flow   (d > 0): illegal unless Sa precedes Sb, or VF ≤ d
 *   anti   (d < 0): illegal unless Sb (the read) precedes or is Sa, or VF ≤ |d|
 *   d = 0         : always legal (statement order is preserved)
 * A scalar assigned in the loop and read in a later iteration (e.g. s = s + A[i]) is a
 * recurrence; vectorising it would need a reduction transformation, which is not applied.
 */
export function analyzeLoopVectorization(loopCode, { vectorWidth = 4 } = {}) {
  const src = loopCode.replace(/\/\/[^\n]*/g, ' ').trim();
  const header = /^for\s*\(\s*(?:int\s+)?([A-Za-z_]\w*)\s*=\s*(-?\w+)\s*;\s*\1\s*(<=|<)\s*(-?\w+)\s*;\s*(?:\1\s*\+\+|\+\+\s*\1|\1\s*\+=\s*1|\1\s*=\s*\1\s*\+\s*1)\s*\)\s*(\{([\s\S]*)\}|([\s\S]*;))\s*$/.exec(src);
  if (!header) {
    throw new Error('Expected a loop of the form: for (i = 0; i < N; i++) { A[i] = B[i] + C[i]; }');
  }
  const [, iv, lower, cmp, upper, , braced, single] = header;
  const body = (braced ?? single).trim();
  const statements = body.split(';').map((s) => s.trim()).filter(Boolean);
  if (!statements.length) throw new Error('The loop body is empty.');

  const accessRe = /([A-Za-z_]\w*)\s*\[\s*([^\]]+)\]/g;
  const parseSubscript = (text, where) => {
    const t = text.replace(/\s+/g, '');
    const m = new RegExp(`^${iv}(?:([+-])(\\d+))?$|^(\\d+)\\+${iv}$`).exec(t);
    if (!m) throw new Error(`${where}: subscript [${text}] is not of the form ${iv} ± constant.`);
    if (m[3]) return Number(m[3]);
    return m[1] ? (m[1] === '-' ? -Number(m[2]) : Number(m[2])) : 0;
  };

  const parsed = statements.map((stmt, sIdx) => {
    const name = `S${sIdx + 1}`;
    const eq = stmt.indexOf('=');
    if (eq < 0 || stmt[eq + 1] === '=') throw new Error(`${name}: expected an assignment.`);
    const lhs = stmt.slice(0, eq).trim();
    const rhs = stmt.slice(eq + 1).trim();
    if (!/^[\w\s[\]+\-*()]+$/.test(rhs)) throw new Error(`${name}: unsupported characters in '${rhs}'.`);
    const lhsArr = /^([A-Za-z_]\w*)\s*\[\s*([^\]]+)\]$/.exec(lhs);
    const write = lhsArr ? { array: lhsArr[1], offset: parseSubscript(lhsArr[2], name) } : null;
    const scalarWrite = lhsArr ? null : /^[A-Za-z_]\w*$/.test(lhs) ? lhs : null;
    if (!write && !scalarWrite) throw new Error(`${name}: cannot assign to '${lhs}'.`);
    const reads = [];
    for (const m of rhs.matchAll(accessRe)) reads.push({ array: m[1], offset: parseSubscript(m[2], name) });
    const scalarReads = [...rhs.replace(accessRe, ' ').matchAll(/[A-Za-z_]\w*/g)].map((m) => m[0]).filter((s) => s !== iv);
    return { name, text: `${lhs} = ${rhs}`, write, scalarWrite, reads, scalarReads };
  });

  const dependences = [];
  parsed.forEach((sa, a) => {
    if (!sa.write) return;
    parsed.forEach((sb, b) => {
      const accesses = [...sb.reads.map((r) => ({ ...r, kind: 'read' })), ...(sb.write && b !== a ? [{ ...sb.write, kind: 'write' }] : [])];
      for (const acc of accesses) {
        if (acc.array !== sa.write.array) continue;
        // Sa writes X[j + w] at iteration j; Sb touches X[k + r] at iteration k: same element when k = j + (w − r).
        const d = sa.write.offset - acc.offset;
        let kind;
        let legalFor;
        if (acc.kind === 'read') {
          if (d > 0) {
            kind = 'flow (true)';
            legalFor = a < b ? Infinity : d;
          } else if (d < 0) {
            kind = 'anti';
            legalFor = b <= a ? Infinity : -d;
          } else {
            kind = a < b ? 'flow (true)' : 'anti';
            legalFor = Infinity;
          }
        } else {
          kind = 'output';
          legalFor = d === 0 || (d > 0 && a < b) || (d < 0 && b < a) ? Infinity : Math.abs(d);
        }
        dependences.push({
          from: sa.name,
          to: sb.name,
          array: acc.array,
          kind,
          distance: d,
          loopCarried: d !== 0,
          maxVF: legalFor,
          description: `${sa.name} writes ${acc.array}[${iv}${fmtOff(sa.write.offset)}], ${sb.name} ${acc.kind}s ${acc.array}[${iv}${fmtOff(acc.offset)}]`,
        });
      }
    });
  });

  const scalarWrites = new Set(parsed.filter((s) => s.scalarWrite).map((s) => s.scalarWrite));
  const recurrences = parsed.flatMap((s) => s.scalarReads.filter((v) => scalarWrites.has(v)).map((v) => ({ statement: s.name, variable: v })));

  const maxVF = recurrences.length ? 1 : Math.min(Infinity, ...dependences.map((d) => d.maxVF));
  const vectorizable = vectorWidth <= maxVF;
  const vf = vectorWidth;
  const range = `${iv} = ${lower}; ${iv} ${cmp} ${upper}`;
  const vecStmt = (s) =>
    s.text.replace(accessRe, (_, arr, sub) => `${arr}[${iv}${fmtOff(parseSubscript(sub, s.name))} : ${iv}${fmtOff(parseSubscript(sub, s.name) + vf)}]`);
  const vectorCode = vectorizable
    ? [
        `// Strip-mined loop: ${vf} iterations per vector operation`,
        `for (${iv} = ${lower}; ${iv} + ${vf - 1} ${cmp} ${upper}; ${iv} += ${vf}) {`,
        ...parsed.map((s) => `    ${vecStmt(s)};   // ${vf} lanes`),
        '}',
        `// Remainder loop for the last (${upper} - ${lower}) mod ${vf} iterations`,
        `for (; ${iv} ${cmp} ${upper}; ${iv}++) {`,
        ...parsed.map((s) => `    ${s.text};`),
        '}',
      ].join('\n')
    : null;

  return {
    loop: { variable: iv, range },
    statements: parsed.map((s) => ({ name: s.name, text: s.text })),
    dependences,
    recurrences,
    maxVF,
    vectorWidth: vf,
    vectorizable,
    vectorCode,
  };
}

function fmtOff(o) {
  return o === 0 ? '' : o > 0 ? ` + ${o}` : ` - ${-o}`;
}
