// Algorithm Lab: independent, interactive explorations of individual compiler algorithms.
import React, { useEffect, useRef } from 'react';
import { GitBranch, Workflow, Binary, Table, Layers, Sigma, Code, Zap, Cpu, Sparkles } from 'lucide-react';
import { AutomataModule } from '../AutomataModule';
import { Module1Lexical } from '../Module1Lexical';
import { GrammarModule } from '../GrammarModule';
import { Module2Syntax } from '../Module2Syntax';
import { LRParserModule } from '../LRParserModule';
import { Module3Semantics } from '../Module3Semantics';
import { Module4ICG } from '../Module4ICG';
import { Module5Optimization } from '../Module5Optimization';
import { Module6CodeGen } from '../Module6CodeGen';
import { Module7Parallelism } from '../Module7Parallelism';
import { TheoryPanel } from './TheoryPanel';

const LAB_TOPICS = [
  {
    group: '1 · Lexical analysis',
    items: [
      { id: 'automata', title: 'Regex → NFA → DFA', icon: Workflow, component: AutomataModule, blurb: "Thompson's construction, ε-closure and subset construction, DFA minimisation, and step-by-step string simulation." },
      { id: 'direct-dfa', title: 'Direct DFA & tokenizer', icon: GitBranch, component: Module1Lexical, blurb: 'Regex → DFA directly from the syntax tree (nullable, firstpos, lastpos, followpos), a generic tokenizer, and a Lex specification preview.' },
    ],
  },
  {
    group: '2 · Syntax analysis',
    items: [
      { id: 'grammar', title: 'Grammars & LL(1)', icon: Binary, component: GrammarModule, blurb: 'FIRST/FOLLOW sets, left-recursion elimination, left factoring, LL(1) table construction and predictive parsing.' },
      { id: 'parsing', title: 'Parsing techniques', icon: Table, component: Module2Syntax, blurb: 'Recursive descent, operator-precedence parsing and an SLR(1) parse tree for the same input.' },
      { id: 'lr', title: 'LR(0) items & SLR(1)', icon: Layers, component: LRParserModule, blurb: 'Canonical LR(0) collection, the SLR(1) ACTION/GOTO table with conflict detection, and a shift-reduce trace.' },
    ],
  },
  {
    group: '3 · Semantics',
    items: [{ id: 'sdt', title: 'Syntax-directed translation', icon: Sigma, component: Module3Semantics, blurb: 'Synthesized (S-attributed) and inherited (L-attributed) attribute evaluation over a real parse tree.' }],
  },
  {
    group: '4 · Intermediate code',
    items: [{ id: 'icg', title: 'TAC, quads, triples, backpatching', icon: Code, component: Module4ICG, blurb: 'Three-address code, quadruples and (indirect) triples for MiniC programs; one-pass backpatching of boolean expressions; switch translation.' }],
  },
  {
    group: '5 · Optimization',
    items: [{ id: 'optimization', title: 'Blocks, CFG, DAG, data flow', icon: Zap, component: Module5Optimization, blurb: 'Basic blocks and the CFG, the DAG of a block, reaching definitions, liveness, and the optimiser passes.' }],
  },
  {
    group: '6 · Code generation',
    items: [{ id: 'codegen', title: 'Next-use, registers, frames', icon: Cpu, component: Module6CodeGen, blurb: 'Next-use information, interference-graph register colouring, target code, and an activation-record layout.' }],
  },
  {
    group: '7 · Advanced',
    items: [{ id: 'advanced', title: 'SSA, scheduling, SIMD', icon: Sparkles, component: Module7Parallelism, blurb: 'Dominators and SSA form with φ-functions, list scheduling on a dependence DAG, and loop dependence analysis for vectorisation.' }],
  },
];

const ALL = LAB_TOPICS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.group })));

export function AlgorithmLab({ topicId, onNavigate }) {
  const topic = ALL.find((t) => t.id === topicId) ?? ALL[0];
  const Component = topic.component;
  const navRef = useRef(null);
  // On narrow screens the topic list is a horizontal strip: keep the active topic visible.
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector('.lab-link.active');
    if (nav && active && nav.scrollWidth > nav.clientWidth) {
      nav.scrollLeft = active.offsetLeft - nav.clientWidth / 2 + active.clientWidth / 2;
    }
  }, [topic.id]);
  return (
    <div className="lab-layout">
      <nav className="lab-sidebar" aria-label="Algorithm Lab topics" ref={navRef}>
        {LAB_TOPICS.map((g) => (
          <div key={g.group}>
            <div className="lab-group-title">{g.group}</div>
            {g.items.map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.id} className={`lab-link ${item.id === topic.id ? 'active' : ''}`} onClick={() => onNavigate(item.id)} aria-current={item.id === topic.id ? 'page' : undefined}>
                  <Icon size={15} aria-hidden="true" /> {item.title}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      <div style={{ minWidth: 0 }}>
        <div className="page-heading">
          <div className="breadcrumb">
            Algorithm Lab › {topic.group.replace(/^\d · /, '')} › <strong>{topic.title}</strong>
          </div>
          <h1>{topic.title}</h1>
          <p>{topic.blurb}</p>
        </div>
        <TheoryPanel key={`theory-${topic.id}`} topicId={topic.id} />
        <Component key={topic.id} />
      </div>
    </div>
  );
}
