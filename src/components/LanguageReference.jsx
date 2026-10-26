// Reference page: the MiniC language accepted by the Compiler Studio and the target ISA.
import React from 'react';
import { GRAMMAR_EBNF, LEXICAL_RULES, SEMANTIC_RULES, PRECEDENCE_LEVELS, UNSUPPORTED_KEYWORDS, LANGUAGE_NAME } from '../pipeline/language.js';
import { ISATable } from './studio/PhaseViews';

const SUPPORTED = [
  'int (32-bit, wrap-around) and bool variables, declared before use',
  'Assignment, print(expr), input()',
  'Arithmetic + - * / % with C semantics (truncating division)',
  'Comparisons < <= > >= == != producing bool',
  'Logical && || ! with short-circuit evaluation',
  'if / else (dangling else binds to the nearest if), while loops',
  'Nested { } blocks with lexical scoping and shadowing',
  '// and /* */ comments',
];

export function LanguageReference() {
  return (
    <div className="module-wrapper">
      <div className="page-heading">
        <div className="breadcrumb">
          Reference › <strong>{LANGUAGE_NAME}</strong>
        </div>
        <h1>{LANGUAGE_NAME} language reference</h1>
        <p>
          {LANGUAGE_NAME} is the C-like subset compiled by the Compiler Studio. Every feature listed as supported goes through all seven
          phases – lexer, parser, semantic analysis, IR generation, optimisation, code generation and execution on the virtual CPU.
          Anything else is rejected with a diagnostic.
        </p>
      </div>

      <div className="ref-grid">
        <section className="panel-card">
          <h2 className="panel-title">Supported</h2>
          <ul>
            {SUPPORTED.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <h2 className="panel-title mt-16">Not supported (rejected with a message)</h2>
          <ul>
            {Object.entries(UNSUPPORTED_KEYWORDS).map(([k, msg]) => (
              <li key={k} className="small">
                <code>{k}</code> – {msg}
              </li>
            ))}
            <li className="small">Floating-point and string literals, arrays, function calls, ++/--/+= operators, bitwise &amp; and |</li>
          </ul>
        </section>

        <section className="panel-card">
          <h2 className="panel-title">Grammar (EBNF)</h2>
          <pre className="code-block">{GRAMMAR_EBNF}</pre>
          <h4>Lexical rules</h4>
          <pre className="code-block">{LEXICAL_RULES}</pre>
        </section>

        <section className="panel-card">
          <h2 className="panel-title">Operator precedence (lowest first)</h2>
          <div className="table-wrapper">
            <table className="table-compact">
              <thead>
                <tr>
                  <th>Level</th>
                  <th>Operators</th>
                  <th>Kind</th>
                  <th>Operands → result</th>
                </tr>
              </thead>
              <tbody>
                {PRECEDENCE_LEVELS.map((l) => (
                  <tr key={l.level}>
                    <td>{l.level}</td>
                    <td>
                      <code>{l.operators.join('  ')}</code>
                    </td>
                    <td>{l.name}</td>
                    <td className="small">
                      {l.operands} → {l.result}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h4>Semantic rules</h4>
          <ul>
            {SEMANTIC_RULES.map((r) => (
              <li key={r} className="small">
                {r}
              </li>
            ))}
          </ul>
        </section>

        <section className="panel-card">
          <h2 className="panel-title">Virtual CPU instruction set</h2>
          <p className="explain">
            A load/store machine with 3–8 general registers (R0…), named memory cells, an input queue and an output stream. Arithmetic
            uses the same 32-bit semantics as the compiler&apos;s constant folder. Division by zero, reading an unwritten register or
            memory cell, running past the end, or exceeding the step budget stops the CPU with a structured error.
          </p>
          <ISATable />
        </section>
      </div>
    </div>
  );
}
