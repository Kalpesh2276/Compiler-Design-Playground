// Test helpers: run the front end directly (independently of the pipeline orchestrator).
import { tokenize } from '../src/engine/lexer.js';
import { parseProgram } from '../src/engine/parser.js';
import { analyzeProgram } from '../src/engine/semanticAnalyzer.js';
import { generateIR } from '../src/engine/irgen.js';
import { MINIC_TOKEN_SPECS } from '../src/pipeline/language.js';

export function frontEnd(source) {
  const lex = tokenize(source, MINIC_TOKEN_SPECS);
  if (lex.errors.length) throw new Error(`lexical error: ${lex.errors[0].message}`);
  const { ast, diagnostics } = parseProgram(lex.tokens);
  if (diagnostics.length) throw new Error(`syntax error: ${diagnostics[0].message}`);
  const semantic = analyzeProgram(ast);
  const err = semantic.diagnostics.find((d) => d.severity === 'error');
  if (err) throw new Error(`semantic error: ${err.message}`);
  return generateIR(ast, semantic);
}

export const outputsOf = (result) => result.output.map((o) => o.text);
