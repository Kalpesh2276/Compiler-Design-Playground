import React, { useState, useEffect } from 'react';
import { tokenize, DEFAULT_TOKEN_SPECS } from '../engine/lexer';
import { Code, Database, AlertCircle } from 'lucide-react';

const LEXER_PRESETS = [
  {
    name: 'C-Like Function',
    code: `int calculate(int x, float y) {
  // Compute sum and product
  int sum = x + 10;
  float prod = y * 2.5;
  if (sum > 15) {
    return sum;
  }
  return 0;
}`,
  },
  {
    name: 'Loop with Condition',
    code: `int count = 0;
while (count < 5) {
  count = count + 1;
}`,
  },
];

export function LexerModule() {
  const [sourceCode, setSourceCode] = useState(LEXER_PRESETS[0].code);
  const [tokensRes, setTokensRes] = useState(null);
  const [activeTab, setActiveTab] = useState('token-stream');

  useEffect(() => {
    try {
      const res = tokenize(sourceCode, DEFAULT_TOKEN_SPECS);
      setTokensRes(res);
    } catch (err) {
      setTokensRes(null);
    }
  }, [sourceCode]);

  return (
    <div className="module-wrapper">
      {/* Top Input Card */}
      <div className="input-card">
        <div className="input-row">
          <div className="field-group flex-1">
            <label>Source Code Input</label>
            <textarea
              rows="7"
              value={sourceCode}
              onChange={(e) => setSourceCode(e.target.value)}
              placeholder="Type or paste high-level code..."
            />
          </div>

          <div className="field-group">
            <label>Load Code Preset</label>
            <div className="preset-buttons vertical">
              {LEXER_PRESETS.map((preset, idx) => (
                <button
                  key={`lexer-p-${idx}`}
                  className="btn-secondary"
                  onClick={() => setSourceCode(preset.code)}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {tokensRes && tokensRes.errors.length > 0 && (
          <div className="error-banner">
            <AlertCircle size={16} /> Lexical Errors Detected:{' '}
            {tokensRes.errors.map((e) => `[Line ${e.line}, Col ${e.col}] ${e.message}`).join(' | ')}
          </div>
        )}
      </div>

      {/* Sub Tabs */}
      <div className="sub-tabs">
        <button
          className={activeTab === 'token-stream' ? 'sub-tab active' : 'sub-tab'}
          onClick={() => setActiveTab('token-stream')}
        >
          <Code size={16} /> 1. Token Stream
        </button>
        <button
          className={activeTab === 'symbol-table' ? 'sub-tab active' : 'sub-tab'}
          onClick={() => setActiveTab('symbol-table')}
        >
          <Database size={16} /> 2. Symbol Table
        </button>
      </div>

      {/* Grid Content */}
      {tokensRes && (
        <div className="grid-2col">
          {/* Left Column: Code Preview with Token Highlights */}
          <div className="panel-card">
            <h3 className="panel-title">Source Code Line Inspector</h3>
            <pre className="code-block">
              {sourceCode.split('\n').map((lineText, idx) => (
                <div key={`line-${idx}`} className="code-line">
                  <span className="line-num">{idx + 1}</span>
                  <span className="line-content">{lineText}</span>
                </div>
              ))}
            </pre>
          </div>

          {/* Right Column: Active Tab Details */}
          <div className="panel-card">
            {activeTab === 'token-stream' && (
              <div>
                <h3 className="panel-title">
                  Scanned Tokens ({tokensRes.tokens.length} tokens found)
                </h3>
                <div className="token-grid">
                  {tokensRes.tokens.map((tok, idx) => (
                    <div key={`token-${idx}`} className={`token-badge token-${tok.type.toLowerCase()}`}>
                      <span className="token-type">{tok.type}</span>
                      <span className="token-val">"{tok.value}"</span>
                      <span className="token-pos">
                        L{tok.line}:C{tok.col}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'symbol-table' && (
              <div>
                <h3 className="panel-title">Symbol Table Entries</h3>
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>Identifier Name</th>
                        <th>Type</th>
                        <th>First Defined</th>
                        <th>Reference Count</th>
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
          </div>
        </div>
      )}
    </div>
  );
}
