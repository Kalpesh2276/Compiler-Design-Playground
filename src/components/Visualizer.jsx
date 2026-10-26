import React, { useState, useEffect, useRef, useId } from 'react';
import { ZoomIn, ZoomOut, RotateCcw, Download } from 'lucide-react';
import { GRAPH_PALETTE } from './graphPalette';

// -------------------------------------------------------------
// 1. Automata Graph Visualizer (SVG)
// -------------------------------------------------------------
export function AutomataVisualizer({ automaton, activeStates = [] }) {
  const { states = [], startState = '', acceptStates = [], transitions = [] } = automaton || {};

  const [positions, setPositions] = useState({});
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [draggingNode, setDraggingNode] = useState(null);
  const [isPanning, setIsPanning] = useState(false);
  const [startPan, setStartPan] = useState({ x: 0, y: 0 });

  const svgRef = useRef(null);
  const markerId = `arrowhead-${useId().replace(/:/g, '')}`;

  // Compute layout (Circular layout) whenever a new automaton arrives
  useEffect(() => {
    const states = automaton?.states ?? [];
    if (states.length === 0) return;

    const width = 600;
    const height = 400;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.35;

    const initialPos = {};
    states.forEach((st, idx) => {
      const angle = (idx / states.length) * 2 * Math.PI - Math.PI / 2;
      initialPos[st] = {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      };
    });

    setPositions(initialPos);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [automaton]);

  // Handle Dragging Nodes
  const handleMouseDownNode = (e, st) => {
    e.stopPropagation();
    setDraggingNode(st);
  };

  const handleMouseDownSVG = (e) => {
    setIsPanning(true);
    setStartPan({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e) => {
    if (draggingNode && svgRef.current) {
      const rect = svgRef.current.getBoundingClientRect();
      const newX = (e.clientX - rect.left - pan.x) / zoom;
      const newY = (e.clientY - rect.top - pan.y) / zoom;
      setPositions((prev) => ({
        ...prev,
        [draggingNode]: { x: newX, y: newY },
      }));
    } else if (isPanning) {
      setPan({ x: e.clientX - startPan.x, y: e.clientY - startPan.y });
    }
  };

  const handleMouseUp = () => {
    setDraggingNode(null);
    setIsPanning(false);
  };

  // Group multi-symbol transitions between same pair
  const groupedTransitions = {};
  transitions.forEach((tr) => {
    const key = `${tr.from}->${tr.to}`;
    if (!groupedTransitions[key]) {
      groupedTransitions[key] = { from: tr.from, to: tr.to, symbols: [] };
    }
    groupedTransitions[key].symbols.push(tr.symbol);
  });

  const exportSVG = () => {
    if (!svgRef.current) return;
    const svgData = new XMLSerializer().serializeToString(svgRef.current);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);
    const downloadLink = document.createElement('a');
    downloadLink.href = svgUrl;
    downloadLink.download = 'automaton_graph.svg';
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
  };

  if (!states || states.length === 0) {
    return <div className="placeholder-text">No automaton generated yet.</div>;
  }

  return (
    <div className="visualizer-container">
      <div className="visualizer-controls">
        <button onClick={() => setZoom((z) => Math.min(z + 0.2, 2.5))} title="Zoom In" aria-label="Zoom In">
          <ZoomIn size={16} />
        </button>
        <button onClick={() => setZoom((z) => Math.max(z - 0.2, 0.4))} title="Zoom Out" aria-label="Zoom Out">
          <ZoomOut size={16} />
        </button>
        <button
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
          title="Reset View" aria-label="Reset View"
        >
          <RotateCcw size={16} />
        </button>
        <button onClick={exportSVG} title="Export SVG" aria-label="Export SVG">
          <Download size={16} />
        </button>
      </div>

      <svg
        ref={svgRef}
        className="graph-svg"
        role="img"
        aria-label={`State diagram with ${states.length} states`}
        onMouseDown={handleMouseDownSVG}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <defs>
          <marker
            id={markerId}
            markerWidth="10"
            markerHeight="7"
            refX="24"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="var(--accent-glow)" />
          </marker>
        </defs>

        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {/* Render Transitions */}
          {Object.values(groupedTransitions).map((tr, idx) => {
            const fromPos = positions[tr.from];
            const toPos = positions[tr.to];
            if (!fromPos || !toPos) return null;

            const labelText = tr.symbols.join(', ');

            // Self-loop
            if (tr.from === tr.to) {
              const x = fromPos.x;
              const y = fromPos.y - 20;
              return (
                <g key={`tr-${idx}`}>
                  <path
                    d={`M ${x - 10} ${y} C ${x - 30} ${y - 45}, ${x + 30} ${y - 45}, ${x + 10} ${y}`}
                    fill="none"
                    stroke="var(--accent-glow)"
                    strokeWidth="2"
                    markerEnd={`url(#${markerId})`}
                  />
                  <text
                    x={x}
                    y={y - 50}
                    fill="var(--text-bright)"
                    fontSize="13"
                    fontWeight="bold"
                    textAnchor="middle"
                  >
                    {labelText}
                  </text>
                </g>
              );
            }

            // Directional Arc
            const dx = toPos.x - fromPos.x;
            const dy = toPos.y - fromPos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // Curve factor if reverse transition exists
            const reverseKey = `${tr.to}->${tr.from}`;
            const hasReverse = !!groupedTransitions[reverseKey];
            const curveOffset = hasReverse ? 25 : 0;

            const midX = (fromPos.x + toPos.x) / 2 + (dy / dist) * curveOffset;
            const midY = (fromPos.y + toPos.y) / 2 - (dx / dist) * curveOffset;

            const pathD = hasReverse
              ? `M ${fromPos.x} ${fromPos.y} Q ${midX} ${midY} ${toPos.x} ${toPos.y}`
              : `M ${fromPos.x} ${fromPos.y} L ${toPos.x} ${toPos.y}`;

            return (
              <g key={`tr-${idx}`}>
                <path
                  d={pathD}
                  fill="none"
                  stroke="var(--accent-glow)"
                  strokeWidth="2"
                  markerEnd={`url(#${markerId})`}
                />
                <text
                  x={midX}
                  y={midY - 8}
                  fill="var(--text-bright)"
                  fontSize="13"
                  fontWeight="bold"
                  textAnchor="middle"
                >
                  {labelText}
                </text>
              </g>
            );
          })}

          {/* Render States */}
          {states.map((st) => {
            const pos = positions[st] || { x: 100, y: 100 };
            const isStart = st === startState;
            const isAccept = acceptStates.includes(st);
            const isActive = activeStates.includes(st);

            return (
              <g
                key={`state-${st}`}
                transform={`translate(${pos.x}, ${pos.y})`}
                onMouseDown={(e) => handleMouseDownNode(e, st)}
                style={{ cursor: 'grab' }}
              >
                {/* Start State Arrow */}
                {isStart && (
                  <path
                    d="M -50 0 L -25 0"
                    stroke="var(--accent-primary)"
                    strokeWidth="3"
                    markerEnd={`url(#${markerId})`}
                  />
                )}

                {/* Outer Accept Ring */}
                {isAccept && (
                  <circle
                    r="25"
                    fill="none"
                    stroke="var(--accent-primary)"
                    strokeWidth="2"
                  />
                )}

                {/* Main Node Circle */}
                <circle
                  r="20"
                  fill={isActive ? 'var(--accent-primary)' : 'var(--bg-card)'}
                  stroke={isActive ? '#fff' : 'var(--accent-glow)'}
                  strokeWidth={isActive ? '3' : '2'}
                  className={isActive ? 'pulse-active' : ''}
                />

                {/* State Label */}
                <text
                  textAnchor="middle"
                  dy="5"
                  fill={isActive ? '#000' : 'var(--text-main)'}
                  fontSize="14"
                  fontWeight="bold"
                >
                  {st}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

// -------------------------------------------------------------
// 2. Parse Tree / AST Visualizer (SVG)
// Node boxes are sized to their labels; `node.sublabel` adds a second line.
// -------------------------------------------------------------
const CHAR_W = 7.6;
const boxWidth = (n) => Math.max(44, Math.max(String(n.label).length, String(n.sublabel ?? '').length) * CHAR_W + 18);

export function ParseTreeVisualizer({ tree }) {
  if (!tree) return <div className="placeholder-text">No Parse Tree generated.</div>;

  const nodeCoords = [];
  const edgeCoords = [];
  let maxDepth = 0;
  const GAP = 14;
  const LEVEL = 74;

  function layout(node, depth, xOffset) {
    maxDepth = Math.max(maxDepth, depth);
    const own = boxWidth(node);
    const kids = node.children || [];
    let width;
    const childLayouts = [];
    if (kids.length) {
      let x = xOffset;
      for (const child of kids) {
        const l = layout(child, depth + 1, x);
        childLayouts.push(l);
        x += l.width + GAP;
      }
      width = Math.max(x - xOffset - GAP, own);
    } else {
      width = own;
    }
    const nodeX = kids.length
      ? (childLayouts[0].nodeX + childLayouts[childLayouts.length - 1].nodeX) / 2
      : xOffset + width / 2;
    const nodeY = depth * LEVEL + 34;
    nodeCoords.push({ id: node.id, label: node.label, sublabel: node.sublabel, x: nodeX, y: nodeY, w: own });
    childLayouts.forEach((c) => edgeCoords.push({ x1: nodeX, y1: nodeY + 18, x2: c.nodeX, y2: c.nodeY - 18 }));
    return { width, nodeX, nodeY };
  }

  const root = layout(tree, 0, 20);
  const svgWidth = Math.max(root.width + 40, 300);
  const svgHeight = maxDepth * LEVEL + 80;

  return (
    <div className="visualizer-container auto-height">
      <svg
        className="graph-svg"
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        style={{ width: svgWidth, maxWidth: "none" }}
        role="img"
        aria-label={`Tree with ${nodeCoords.length} nodes`}
      >
        {edgeCoords.map((e, idx) => (
          <line key={`edge-${idx}`} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="var(--accent-glow)" strokeWidth="1.6" />
        ))}
        {nodeCoords.map((n, idx) => (
          <g key={`tree-node-${n.id ?? idx}-${idx}`} transform={`translate(${n.x}, ${n.y})`}>
            <rect x={-n.w / 2} y="-18" width={n.w} height="36" rx="8" fill="var(--bg-card)" stroke="var(--accent-primary)" strokeWidth="1.6" />
            <text textAnchor="middle" dy={n.sublabel ? -2 : 5} fill="var(--text-main)" fontSize="13" fontWeight="bold" fontFamily="var(--font-mono)">
              {n.label}
            </text>
            {n.sublabel && (
              <text textAnchor="middle" dy="12" fill="var(--accent-warning)" fontSize="10.5" fontFamily="var(--font-mono)">
                {n.sublabel}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

// -------------------------------------------------------------
// 3. LR Item Sets Graph Visualizer (SVG)
// -------------------------------------------------------------
export function ItemSetVisualizer({ itemSets = [], gotoTransitions = [] }) {
  if (!itemSets || itemSets.length === 0) {
    return <div className="placeholder-text">No Item Sets available.</div>;
  }

  const width = 800;
  const height = 500;

  // Grid / Circle positioning for Item Set nodes
  const nodeCoords = {};
  const radius = Math.min(width, height) * 0.38;
  const centerX = width / 2;
  const centerY = height / 2;

  itemSets.forEach((_, idx) => {
    const angle = (idx / itemSets.length) * 2 * Math.PI - Math.PI / 2;
    nodeCoords[idx] = {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    };
  });

  return (
    <div className="visualizer-container">
      <svg className="graph-svg" viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <marker
            id="lr-arrow"
            markerWidth="10"
            markerHeight="7"
            refX="45"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="var(--accent-glow)" />
          </marker>
        </defs>

        {/* Goto Edges */}
        {gotoTransitions.map((tr, idx) => {
          const from = nodeCoords[tr.fromState];
          const to = nodeCoords[tr.toState];
          if (!from || !to) return null;

          if (tr.fromState === tr.toState) {
            return (
              <g key={`goto-${idx}`}>
                <path
                  d={`M ${from.x - 15} ${from.y - 20} C ${from.x - 40} ${from.y - 50}, ${from.x + 40} ${from.y - 50}, ${from.x + 15} ${from.y - 20}`}
                  fill="none"
                  stroke="var(--accent-glow)"
                  strokeWidth="2"
                  markerEnd="url(#lr-arrow)"
                />
                <text
                  x={from.x}
                  y={from.y - 55}
                  fill="var(--accent-primary)"
                  fontSize="12"
                  fontWeight="bold"
                  textAnchor="middle"
                >
                  {tr.symbol}
                </text>
              </g>
            );
          }

          const midX = (from.x + to.x) / 2;
          const midY = (from.y + to.y) / 2;

          return (
            <g key={`goto-${idx}`}>
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="var(--accent-glow)"
                strokeWidth="2"
                markerEnd="url(#lr-arrow)"
              />
              <rect
                x={midX - 12}
                y={midY - 12}
                width="24"
                height="20"
                rx="4"
                fill="var(--bg-card)"
                stroke="var(--border-color)"
              />
              <text
                x={midX}
                y={midY + 2}
                fill="var(--accent-primary)"
                fontSize="12"
                fontWeight="bold"
                textAnchor="middle"
              >
                {tr.symbol}
              </text>
            </g>
          );
        })}

        {/* Item Set Nodes */}
        {itemSets.map((_, idx) => {
          const pos = nodeCoords[idx];
          return (
            <g key={`itemset-node-${idx}`} transform={`translate(${pos.x}, ${pos.y})`}>
              <circle
                r="30"
                fill="var(--bg-card)"
                stroke="var(--accent-primary)"
                strokeWidth="3"
              />
              <text
                textAnchor="middle"
                dy="5"
                fill="var(--text-bright)"
                fontSize="15"
                fontWeight="bold"
              >
                {`I${idx}`}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}


// -------------------------------------------------------------
// 4. Control-Flow Graph Visualizer (SVG)
// Blocks are stacked in program order. Fall-through edges run straight down;
// forward jumps are routed on the right, back edges (loops) on the left.
// `blocks` = [{ id, lines: string[], note? }], `edges` = [{ from, to, kind }]
// -------------------------------------------------------------
export function CFGVisualizer({ blocks, edges, highlight = null }) {
  const markerId = `cfg-arrow-${useId().replace(/:/g, '')}`;
  if (!blocks || blocks.length === 0) return <div className="placeholder-text">No basic blocks (empty program).</div>;

  const LINE_H = 16;
  const HEADER_H = 22;
  const PAD = 8;
  const V_GAP = 34;
  const indexOf = (id) => (id === 'EXIT' ? blocks.length : blocks.findIndex((b) => b.id === id));
  const isNext = (e) => indexOf(e.to) === indexOf(e.from) + 1;

  const longest = Math.max(12, ...blocks.flatMap((b) => b.lines.map((l) => l.length)));
  const boxW = Math.min(420, longest * 7.3 + 2 * PAD + 10);
  const routed = edges.filter((e) => !(e.kind === 'fallthrough' && isNext(e)));
  const backEdges = routed.filter((e) => e.to !== 'EXIT' && indexOf(e.to) <= indexOf(e.from));
  const fwdEdges = routed.filter((e) => !backEdges.includes(e));
  const x0 = 30 + backEdges.length * 16;

  let y = 16;
  const pos = {};
  for (const b of blocks) {
    const h = HEADER_H + Math.max(1, b.lines.length) * LINE_H + PAD;
    pos[b.id] = { x: x0, y, w: boxW, h };
    y += h + V_GAP;
  }
  pos.EXIT = { x: x0 + boxW / 2 - 36, y, w: 72, h: 26 };
  const height = y + 40;
  const width = x0 + boxW + 30 + fwdEdges.length * 16;
  const color = { fallthrough: 'var(--text-muted)', jump: 'var(--accent-primary)', branch: 'var(--success-text)' };

  const paths = edges.map((e, i) => {
    const a = pos[e.from];
    const b = pos[e.to];
    if (!a || !b) return null;
    const stroke = color[e.kind] ?? 'var(--accent-glow)';
    if (e.kind === 'fallthrough' && isNext(e)) {
      const cx = a.x + a.w / 2;
      return { key: i, d: `M ${cx} ${a.y + a.h} L ${cx} ${b.y}`, stroke };
    }
    const sy = a.y + a.h - 10;
    const ty = b.y + 12;
    if (backEdges.includes(e)) {
      const lx = x0 - 14 - backEdges.indexOf(e) * 16;
      return { key: i, d: `M ${a.x} ${sy} L ${lx} ${sy} L ${lx} ${ty} L ${b.x} ${ty}`, stroke };
    }
    const rx = x0 + boxW + 14 + fwdEdges.indexOf(e) * 16;
    return { key: i, d: `M ${a.x + a.w} ${sy} L ${rx} ${sy} L ${rx} ${ty} L ${b.x + b.w} ${ty}`, stroke };
  }).filter(Boolean);

  return (
    <div className="visualizer-container auto-height">
      <svg className="graph-svg" viewBox={`0 0 ${width} ${height}`} style={{ width, maxWidth: "none" }} role="img" aria-label={`Control-flow graph with ${blocks.length} basic blocks`}>
        <defs>
          {Object.entries(color).map(([kind, c]) => (
            <marker key={kind} id={`${markerId}-${kind}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <polygon points="0 0, 8 4, 0 8" fill={c} />
            </marker>
          ))}
        </defs>
        {paths.map((p) => {
          const kind = Object.keys(color).find((k) => color[k] === p.stroke) ?? 'jump';
          return <path key={`e-${p.key}`} d={p.d} fill="none" stroke={p.stroke} strokeWidth="1.6" markerEnd={`url(#${markerId}-${kind})`} />;
        })}
        {blocks.map((b) => {
          const p = pos[b.id];
          const active = highlight === b.id;
          return (
            <g key={b.id}>
              <rect x={p.x} y={p.y} width={p.w} height={p.h} rx="6" fill="var(--bg-card)" stroke={active ? 'var(--accent-warning)' : 'var(--accent-glow)'} strokeWidth={active ? 2.5 : 1.4} />
              <rect x={p.x + 1} y={p.y + 1} width={p.w - 2} height={HEADER_H - 5} rx="5" fill="rgba(31,111,235,0.22)" />
              <text x={p.x + PAD} y={p.y + 13} fill="var(--accent-primary)" fontSize="12" fontWeight="bold" fontFamily="var(--font-mono)">
                {b.id}
                {b.note ? `  ${b.note}` : ''}
              </text>
              {b.lines.map((line, k) => (
                <text key={k} x={p.x + PAD} y={p.y + HEADER_H + 10 + k * LINE_H} fill={line.endsWith(':') ? 'var(--accent-warning)' : 'var(--text-main)'} fontSize="12" fontFamily="var(--font-mono)" style={{ whiteSpace: 'pre' }}>
                  {line}
                </text>
              ))}
            </g>
          );
        })}
        <rect x={pos.EXIT.x} y={pos.EXIT.y} width={pos.EXIT.w} height={pos.EXIT.h} rx="13" fill="var(--bg-raised)" stroke="var(--border-color)" />
        <text x={pos.EXIT.x + pos.EXIT.w / 2} y={pos.EXIT.y + 17} textAnchor="middle" fill="var(--text-muted)" fontSize="12" fontWeight="bold">
          EXIT
        </text>
      </svg>
      <div className="graph-legend" style={{ padding: '0 12px 10px' }}>
        <span><span className="legend-swatch" style={{ background: 'var(--text-muted)' }} />fall-through</span>
        <span><span className="legend-swatch" style={{ background: 'var(--success-text)' }} />conditional branch (taken)</span>
        <span><span className="legend-swatch" style={{ background: 'var(--accent-primary)' }} />unconditional jump</span>
        <span>edges on the left are loop back edges</span>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// 5. DAG Visualizer (SVG) for one basic block
// `nodes` = [{ id, label, labels: string[], children: number[], kind, sideEffect }]
// Leaves at the bottom; each node is placed one level above its highest child.
// -------------------------------------------------------------
export function DAGVisualizer({ nodes, highlightIds = [] }) {
  const markerId = `dag-arrow-${useId().replace(/:/g, '')}`;
  if (!nodes || nodes.length === 0) return <div className="placeholder-text">This block has no computations.</div>;

  const level = new Map();
  const levelOf = (id) => {
    if (level.has(id)) return level.get(id);
    const n = nodes[id - 1];
    const l = n.children.length ? 1 + Math.max(...n.children.map(levelOf)) : 0;
    level.set(id, l);
    return l;
  };
  nodes.forEach((n) => levelOf(n.id));
  const maxLevel = Math.max(...level.values());
  const rows = Array.from({ length: maxLevel + 1 }, () => []);
  nodes.forEach((n) => rows[level.get(n.id)].push(n));

  const COL = 120;
  const ROW = 90;
  const width = Math.max(...rows.map((r) => r.length)) * COL + 40;
  const height = (maxLevel + 1) * ROW + 40;
  const pos = {};
  rows.forEach((row, l) => {
    const offset = (width - row.length * COL) / 2;
    row.forEach((n, i) => {
      pos[n.id] = { x: offset + i * COL + COL / 2, y: (maxLevel - l) * ROW + 44 };
    });
  });

  return (
    <div className="visualizer-container auto-height">
      <svg className="graph-svg" viewBox={`0 0 ${width} ${height}`} style={{ width, maxWidth: "none" }} role="img" aria-label={`DAG with ${nodes.length} nodes`}>
        <defs>
          <marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <polygon points="0 0, 8 4, 0 8" fill="var(--accent-glow)" />
          </marker>
        </defs>
        {nodes.flatMap((n) =>
          n.children.map((c, k) => {
            const a = pos[n.id];
            const b = pos[c];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const len = Math.hypot(dx, dy) || 1;
            return (
              <line key={`${n.id}-${c}-${k}`} x1={a.x + (dx / len) * 20} y1={a.y + (dy / len) * 20} x2={b.x - (dx / len) * 22} y2={b.y - (dy / len) * 22} stroke="var(--accent-glow)" strokeWidth="1.5" markerEnd={`url(#${markerId})`} />
            );
          })
        )}
        {nodes.map((n) => {
          const p = pos[n.id];
          const hot = highlightIds.includes(n.id);
          return (
            <g key={n.id} transform={`translate(${p.x}, ${p.y})`}>
              {n.kind === 'leaf' ? (
                <rect x="-26" y="-16" width="52" height="32" rx="6" fill="var(--bg-inset)" stroke="var(--text-muted)" />
              ) : (
                <circle r="20" fill={n.sideEffect ? 'rgba(210,153,34,0.15)' : 'var(--bg-card)'} stroke={hot ? 'var(--accent-warning)' : 'var(--accent-primary)'} strokeWidth={hot ? 3 : 1.6} />
              )}
              <text textAnchor="middle" dy="4" fill="var(--text-bright)" fontSize="12" fontWeight="bold" fontFamily="var(--font-mono)">
                {n.label.length > 9 ? `${n.label.slice(0, 8)}…` : n.label}
              </text>
              <text textAnchor="middle" dy="-27" fill="var(--success-text)" fontSize="11" fontFamily="var(--font-mono)">
                {n.labels.join(', ')}
              </text>
              <text textAnchor="middle" dy="35" fill="var(--text-muted)" fontSize="9">
                n{n.id}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// -------------------------------------------------------------
// 6. Undirected graph (interference graph) with optional node colouring
// `nodes` = [{ id, dashed?: bool, sub?: string }], `edges` = [[a, b]],
// `colorIndex` = { [id]: register number }
// -------------------------------------------------------------

export function UndirectedGraph({ nodes, edges, colorIndex = {} }) {
  if (!nodes || nodes.length === 0) return <div className="placeholder-text">No nodes.</div>;
  const size = Math.max(320, Math.min(640, 90 * Math.sqrt(nodes.length) + 160));
  const c = size / 2;
  const r = size / 2 - 50;
  const pos = {};
  nodes.forEach((n, i) => {
    const a = (i / nodes.length) * 2 * Math.PI - Math.PI / 2;
    pos[n.id] = { x: c + r * Math.cos(a), y: c + r * Math.sin(a) };
  });
  return (
    <div className="visualizer-container auto-height">
      <svg className="graph-svg" viewBox={`0 0 ${size} ${size}`} style={{ maxWidth: size }} role="img" aria-label={`Graph with ${nodes.length} nodes and ${edges.length} edges`}>
        {edges.map(([a, b], i) => (
          <line key={i} x1={pos[a].x} y1={pos[a].y} x2={pos[b].x} y2={pos[b].y} stroke="#30363d" strokeWidth="1.5" />
        ))}
        {nodes.map((n) => {
          const p = pos[n.id];
          const k = colorIndex[n.id];
          const stroke = k === undefined ? 'var(--text-muted)' : GRAPH_PALETTE[k % GRAPH_PALETTE.length];
          return (
            <g key={n.id} transform={`translate(${p.x}, ${p.y})`}>
              <circle r="22" fill={k === undefined ? 'var(--bg-card)' : stroke} fillOpacity={k === undefined ? 1 : 0.22} stroke={stroke} strokeWidth="2" strokeDasharray={n.dashed ? '4 3' : undefined} />
              <text textAnchor="middle" dy="4" fill="var(--text-bright)" fontSize="12" fontWeight="bold" fontFamily="var(--font-mono)">
                {n.id}
              </text>
              {n.sub && (
                <text textAnchor="middle" dy="37" fill="var(--text-muted)" fontSize="11" fontFamily="var(--font-mono)">
                  {n.sub}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
