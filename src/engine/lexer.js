// Engine for Lexical Analysis (Tokenization & Symbol Table Extraction)
//
// tokenize(source, specs) scans left to right; at each position the FIRST spec whose
// regex matches wins, so more specific patterns (comments, multi-character operators)
// must precede general ones. Spec fields:
//   type   token type written to the token
//   regex  pattern (implicitly anchored at the current position)
//   skip   true => lexeme is consumed but produces no token (comments)
//   error  string => lexeme is reported as a lexical error with this message
//          ('{lexeme}' is replaced by the matched text)
// Specs with type 'COMMENT' are skipped even without `skip` (backwards compatible).
//
// Token = { type, value, line, col, start, end }  (line/col 1-based, start/end offsets)

export const DEFAULT_TOKEN_SPECS = [
  // Comments must precede OPERATOR, otherwise '//' lexes as two '/' operators.
  { type: 'COMMENT', regex: /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/ },
  { type: 'KEYWORD', regex: /\b(if|else|while|for|return|int|float|void|char|break|continue)\b/ },
  { type: 'IDENTIFIER', regex: /\b[a-zA-Z_][a-zA-Z0-9_]*\b/ },
  { type: 'NUMBER', regex: /\b\d+(\.\d+)?\b/ },
  { type: 'STRING', regex: /"([^"\\]|\\.)*"/ },
  { type: 'OPERATOR', regex: /(==|!=|<=|>=|&&|\|\||\+\+|--|\+|-|\*|\/|=|<|>|!)/ },
  { type: 'DELIMITER', regex: /[;,\(\)\{\}\[\]]/ },
];

export function tokenize(sourceCode, customSpecs = DEFAULT_TOKEN_SPECS) {
  if (sourceCode === undefined || sourceCode === null) {
    throw new Error('Source code input is required.');
  }

  const tokens = [];
  const symbolTable = new Map();
  const errors = [];

  let line = 1;
  let col = 1;
  let cursor = 0;

  while (cursor < sourceCode.length) {
    const remaining = sourceCode.slice(cursor);

    // Skip whitespace
    const wsMatch = remaining.match(/^[ \t\r]+/);
    if (wsMatch) {
      const matchLen = wsMatch[0].length;
      cursor += matchLen;
      col += matchLen;
      continue;
    }

    // Skip newlines
    if (remaining.startsWith('\n')) {
      cursor++;
      line++;
      col = 1;
      continue;
    }

    let matched = false;

    for (const spec of customSpecs) {
      const regex = new RegExp('^' + spec.regex.source);
      const match = remaining.match(regex);

      if (match) {
        matched = true;
        const value = match[0];

        const linesCount = (value.match(/\n/g) || []).length;
        const advance = () => {
          if (linesCount > 0) {
            line += linesCount;
            col = value.length - value.lastIndexOf('\n');
          } else {
            col += value.length;
          }
          cursor += value.length;
        };

        // Skipped lexemes (comments)
        if (spec.skip || spec.type === 'COMMENT') {
          advance();
          break;
        }

        // Malformed lexemes recognised by an error pattern
        if (spec.error) {
          const span = { line, col, start: cursor, end: cursor + value.length };
          errors.push({ message: spec.error.replace('{lexeme}', value), ...span });
          tokens.push({ type: 'UNKNOWN', value, ...span });
          advance();
          break;
        }

        const token = {
          type: spec.type,
          value,
          line,
          col,
          start: cursor,
          end: cursor + value.length,
        };

        tokens.push(token);

        // Populate Symbol Table for Identifiers
        if (spec.type === 'IDENTIFIER') {
          if (!symbolTable.has(value)) {
            symbolTable.set(value, {
              name: value,
              type: 'variable',
              firstOccurred: `Line ${line}, Col ${col}`,
              references: 1,
            });
          } else {
            const sym = symbolTable.get(value);
            sym.references++;
          }
        }

        cursor += value.length;
        col += value.length;
        break;
      }
    }

    if (!matched) {
      const char = sourceCode[cursor];
      errors.push({
        message: `Unrecognized character '${char}'`,
        line,
        col,
        start: cursor,
        end: cursor + 1,
      });
      tokens.push({
        type: 'UNKNOWN',
        value: char,
        line,
        col,
        start: cursor,
        end: cursor + 1,
      });
      cursor++;
      col++;
    }
  }

  const symbolList = Array.from(symbolTable.values());

  return {
    tokens,
    symbolTable: symbolList,
    errors,
  };
}
