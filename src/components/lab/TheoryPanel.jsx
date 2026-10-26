// Collapsible theory notes shown above each Algorithm Lab topic.
import React, { useState } from 'react';
import { BookOpen, ChevronDown, ChevronRight, Clock, Library, AlertTriangle } from 'lucide-react';
import { THEORY } from './theory';

const OPEN_KEY = 'cdp.lab.theoryOpen';

function readOpen() {
  try {
    return window.localStorage.getItem(OPEN_KEY) !== 'false';
  } catch {
    return true;
  }
}

/** Render `code` and **bold** inside a text string. */
function Inline({ text }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith('`') && p.endsWith('`')) return <code key={i}>{p.slice(1, -1)}</code>;
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
    return <React.Fragment key={i}>{p}</React.Fragment>;
  });
}

function Block({ block }) {
  if (typeof block === 'string') {
    return (
      <p className="theory-p">
        <Inline text={block} />
      </p>
    );
  }
  if (block.steps) {
    return (
      <ol className="theory-steps">
        {block.steps.map((s, i) => (
          <li key={i}>
            <Inline text={s} />
          </li>
        ))}
      </ol>
    );
  }
  if (block.formula) return <pre className="code-block theory-formula">{block.formula}</pre>;
  if (block.example) {
    return (
      <figure className="theory-example">
        <figcaption>{block.label ?? 'Example'}</figcaption>
        <pre className="code-block">{block.example}</pre>
      </figure>
    );
  }
  if (block.note) {
    return (
      <div className="theory-note">
        <AlertTriangle size={15} aria-hidden="true" />
        <span>
          <Inline text={block.note} />
        </span>
      </div>
    );
  }
  if (block.table) {
    return (
      <div className="table-wrapper">
        <table className="table-compact">
          <thead>
            <tr>
              {block.table.head.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.table.rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j}>
                    <Inline text={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return null;
}

export function TheoryPanel({ topicId }) {
  const sections = THEORY[topicId] ?? [];
  const [open, setOpen] = useState(readOpen);
  const [sectionId, setSectionId] = useState(sections[0]?.id);
  if (!sections.length) return null;
  const section = sections.find((s) => s.id === sectionId) ?? sections[0];

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      window.localStorage.setItem(OPEN_KEY, String(next));
    } catch {
      /* preference is optional */
    }
  };

  return (
    <section className="panel-card theory-panel" aria-label="Theory">
      <button className="theory-toggle" onClick={toggle} aria-expanded={open}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <BookOpen size={16} aria-hidden="true" />
        <span>Theory</span>
        <span className="muted small">{open ? '' : `${sections.length} topic${sections.length > 1 ? 's' : ''}: ${sections.map((s) => s.title).join(' · ')}`}</span>
      </button>
      {open && (
        <>
          <div className="theory-chips" role="tablist" aria-label="Theory topics">
            {sections.map((s) => (
              <button key={s.id} role="tab" aria-selected={s.id === section.id} className={`theory-chip ${s.id === section.id ? 'active' : ''}`} onClick={() => setSectionId(s.id)}>
                {s.title}
              </button>
            ))}
          </div>
          <article className="theory-body" role="tabpanel">
            <h3 className="panel-title">{section.title}</h3>
            {section.blocks.map((b, i) => (
              <Block key={i} block={b} />
            ))}
            {(section.complexity || section.reference) && (
              <div className="theory-meta">
                {section.complexity && (
                  <span>
                    <Clock size={13} aria-hidden="true" /> <strong>Complexity:</strong> {section.complexity}
                  </span>
                )}
                {section.reference && (
                  <span>
                    <Library size={13} aria-hidden="true" /> <strong>Read more:</strong> {section.reference}
                  </span>
                )}
              </div>
            )}
          </article>
        </>
      )}
    </section>
  );
}
