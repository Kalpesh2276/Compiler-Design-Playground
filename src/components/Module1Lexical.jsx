import React, { useState, useEffect } from 'react';
import { buildDirectDFA, generateLexSpec } from '../engine/directDFA';
import { tokenize, DEFAULT_TOKEN_SPECS } from '../engine/lexer';
import { AutomataVisualizer } from './Visualizer';
import { MINIC_TOKEN_SPECS } from '../pipeline/language';
import { Code, GitBranch, Layers } from 'lucide-react';

export function Module1Lexical() {
  const [regex, setRegex] = useState('(a|b)*abb');
  const [sourceCode, setSourceCode] = useState('int sum = a + 10; // comment\nif (sum > 15) print(sum);');
  const [specName, setSpecName] = useState('generic');
  const specs = specName === 'minic' ? MINIC_TOKEN_SPECS : DEFAULT_TOKEN_SPECS;
  const [activeTab, setActiveTab] = useState('direct-dfa');

  const [directDfaRes, setDirectDfaRes] = useState(null);
  const [tokensRes, setTokensRes] = useState(null);
  const [lexSpec, setLexSpec] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    try {
      setError('');
      const res = buildDirectDFA(regex);
      setDirectDfaRes(res);
    } catch (err) {
      setError(err.message || 'Error constructing Direct DFA.');
      setDirectDfaRes(null);
    }
  }, [regex]);

  useEffect(() => {
    try {
      const res = tokenize(sourceCode, specs);
      setTokensRes(res);
      setLexSpec(generateLexSpec(specs));
    } catch {
      setTokensRes(null);
    }
  }, [sourceCode, specs]);

  return (
    <div className="module-wrapper">
      {/* Sub-tabs */}
      <div className="sub-tabs">
        <button
          className={activeTab === 'direct-dfa' ? 'sub-tab active' : 'sub-tab'}
          onClick={() => setActiveTab('direct-dfa')}
        >
          <GitBranch size={16} /> 1. Direct Method Regex → DFA (followpos)
        </button>
        <button
          className={activeTab === 'lexer-tokens' ? 'sub-tab active' : 'sub-tab'}
          onClick={() => setActiveTab('lexer-tokens')}
        >
          <Code size={16} /> 2. Lexical Analyzer & Tokens
        </button>
        <button
          className={activeTab === 'lex-gen' ? 'sub-tab active' : 'sub-tab'}
          onClick={() => setActiveTab('lex-gen')}
        >
          <Layers size={16} /> 3. Lex (.l) Generator Preview
        </button>
      </div>

      {activeTab === 'direct-dfa' && (
        <div className="input-card mb-12">
          <div className="field-group">
            <label>Regular Expression for Direct Method</label>
            <input
              type="text"
              value={regex}
              onChange={(e) => setRegex(e.target.value)}
              placeholder="e.g. (a|b)*abb"
            />
          </div>
          {error && <div className="error-banner">{error}</div>}
        </div>
      )}

      {activeTab === 'lexer-tokens' && (
        <div className="input-card mb-12">
          <div className="row mb-8">
            <label htmlFor="spec-select" style={{ margin: 0 }}>
              Token specification
            </label>
            <select id="spec-select" value={specName} onChange={(e) => setSpecName(e.target.value)}>
              <option value="generic">Generic C-like (lab demo)</option>
              <option value="minic">MiniC (used by the Compiler Studio)</option>
            </select>
          </div>
          <div className="field-group">
            <label htmlFor="lex-src">Source Code to Tokenize</label>
            <textarea
              id="lex-src"
              rows="3"
              value={sourceCode}
              onChange={(e) => setSourceCode(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Main Grid */}
      <div className="grid-2col">
        {/* Left Column */}
        <div className="panel-card">
          {activeTab === 'direct-dfa' && directDfaRes && (
            <div>
              <h3 className="panel-title">Direct Method DFA Graph</h3>
              <AutomataVisualizer
                automaton={{
                  states: directDfaRes.states,
                  startState: directDfaRes.startState,
                  acceptStates: directDfaRes.acceptStates,
                  transitions: directDfaRes.transitions,
                }}
              />
            </div>
          )}

          {activeTab === 'lexer-tokens' && tokensRes && (
            <div>
              <h3 className="panel-title">Scanned Tokens</h3>
              {tokensRes.errors.map((e, i) => (
                <div key={i} className="error-banner mb-8">{`${e.line}:${e.col} ${e.message}`}</div>
              ))}
              <div className="token-grid">
                {tokensRes.tokens.map((tok, idx) => (
                  <div key={`tok-${idx}`} className={`token-badge token-${tok.type.toLowerCase()}`}>
                    <span className="token-type">{tok.type}</span>
                    <span className="token-val">"{tok.value}"</span>
                    <span className="token-pos">L{tok.line}:C{tok.col}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'lex-gen' && (
            <div>
              <h3 className="panel-title">Lex (.l) Specification File</h3>
              <pre className="code-block">{lexSpec}</pre>
            </div>
          )}
        </div>

        {/* Right Column */}
        <div className="panel-card">
          {activeTab === 'direct-dfa' && directDfaRes && (
            <div>
              <h3 className="panel-title">followpos Table</h3>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Node i</th>
                      <th>Symbol</th>
                      <th>followpos(i)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {directDfaRes.followposTable.map((row) => (
                      <tr key={`fp-${row.leafId}`}>
                        <td>
                          <strong>{row.leafId}</strong>
                        </td>
                        <td>
                          <span className="symbol-tag">{row.symbol}</span>
                        </td>
                        <td>{`{ ${row.followpos.join(', ')} }`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h3 className="panel-title mt-16">DFA States Mapping</h3>
              <ul>
                {directDfaRes.dfaStateDetails.map((st) => (
                  <li key={`dfa-st-${st.name}`}>
                    <strong>{st.name}</strong> = {`{ ${st.positions.join(', ')} }`}
                    {st.name === directDfaRes.startState && ' (Start)'}
                    {directDfaRes.acceptStates.includes(st.name) && ' (Accept)'}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {activeTab === 'lexer-tokens' && tokensRes && (
            <div>
              <h3 className="panel-title">Symbol Table</h3>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Identifier</th>
                      <th>Type</th>
                      <th>First Occurred</th>
                      <th>Refs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tokensRes.symbolTable.map((sym, idx) => (
                      <tr key={`sym-${idx}`}>
                        <td>
                          <strong>{sym.name}</strong>
                        </td>
                        <td>
                          <span className="symbol-tag">{sym.type}</span>
                        </td>
                        <td>{sym.firstOccurred}</td>
                        <td>{sym.references}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'lex-gen' && (
            <div>
              <h3 className="panel-title">Compiler Structure & Lex Generator Info</h3>
              <ul>
                <li>
                  <strong>Lexer Role:</strong> Scans input stream and produces a sequence of tokens with attributes.
                </li>
                <li>
                  <strong>Pattern Matching:</strong> Uses regular expressions to match lexemes against token specifications.
                </li>
                <li>
                  <strong>Lex Tool (flex):</strong> Compiles <code>.l</code> files into C code (<code>lex.yy.c</code>) for fast deterministic token recognition.
                </li>
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
