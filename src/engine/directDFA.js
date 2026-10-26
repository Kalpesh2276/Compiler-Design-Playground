// Direct Method: Regular Expression to DFA Construction (using nullable, firstpos, lastpos, followpos)

export function buildDirectDFA(regexInput) {
  if (!regexInput || regexInput.trim() === '') {
    throw new Error('Regex input cannot be empty.');
  }

  const cleanRegex = regexInput.replace(/\s+/g, '');
  const augmentedRegex = `(${cleanRegex})#`;

  // Parse into Syntax Tree nodes
  let nodeCounter = 1;
  let leafCounter = 1;

  const leaves = []; // { id, symbol, firstpos, lastpos, nullable }

  function parseTree(str) {
    // Basic syntax tree builder for symbols, concatenation '.', union '|', star '*'
    const stack = [];
    const postfix = convertToPostfix(str);

    for (let i = 0; i < postfix.length; i++) {
      const char = postfix[i];

      if (/[a-zA-Z0-9#ε]/.test(char)) {
        const leafId = char !== 'ε' ? leafCounter++ : null;
        const node = {
          id: nodeCounter++,
          symbol: char,
          leafId,
          nullable: char === 'ε',
          firstpos: leafId !== null ? [leafId] : [],
          lastpos: leafId !== null ? [leafId] : [],
          children: [],
        };
        if (leafId !== null) leaves.push(node);
        stack.push(node);
      } else if (char === '*' || char === '+' || char === '?') {
        // a* and a? are nullable; a+ is nullable only if a is.
        // All three keep the child's firstpos/lastpos.
        if (stack.length < 1) throw new Error(`Operator '${char}' has no operand.`);
        const child = stack.pop();
        const node = {
          id: nodeCounter++,
          symbol: char,
          leafId: null,
          nullable: char === '+' ? child.nullable : true,
          firstpos: [...child.firstpos],
          lastpos: [...child.lastpos],
          children: [child],
        };
        stack.push(node);
      } else if (char === '.') {
        if (stack.length < 2) throw new Error('Concatenation is missing an operand.');
        const right = stack.pop();
        const left = stack.pop();
        const nullable = left.nullable && right.nullable;
        const firstpos = left.nullable
          ? Array.from(new Set([...left.firstpos, ...right.firstpos])).sort((a, b) => a - b)
          : [...left.firstpos];
        const lastpos = right.nullable
          ? Array.from(new Set([...left.lastpos, ...right.lastpos])).sort((a, b) => a - b)
          : [...right.lastpos];

        const node = {
          id: nodeCounter++,
          symbol: '.',
          leafId: null,
          nullable,
          firstpos,
          lastpos,
          children: [left, right],
        };
        stack.push(node);
      } else if (char === '|') {
        if (stack.length < 2) throw new Error("Union '|' is missing an operand.");
        const right = stack.pop();
        const left = stack.pop();
        const nullable = left.nullable || right.nullable;
        const firstpos = Array.from(new Set([...left.firstpos, ...right.firstpos])).sort((a, b) => a - b);
        const lastpos = Array.from(new Set([...left.lastpos, ...right.lastpos])).sort((a, b) => a - b);

        const node = {
          id: nodeCounter++,
          symbol: '|',
          leafId: null,
          nullable,
          firstpos,
          lastpos,
          children: [left, right],
        };
        stack.push(node);
      }
    }

    if (stack.length !== 1) throw new Error('Malformed regular expression.');
    return stack.pop();
  }

  function convertToPostfix(regex) {
    if (/[^a-zA-Z0-9#ε|*+?()]/.test(regex)) {
      throw new Error('Unsupported character in regex. Use letters, digits, ε, |, *, +, ?, ( ).');
    }
    let depth = 0;
    for (const c of regex) {
      if (c === '(') depth++;
      if (c === ')' && --depth < 0) throw new Error("Unbalanced ')' in regex.");
    }
    if (depth !== 0) throw new Error("Unbalanced '(' in regex.");

    let formatted = '';
    for (let i = 0; i < regex.length; i++) {
      const c1 = regex[i];
      formatted += c1;
      if (i + 1 < regex.length) {
        const c2 = regex[i + 1];
        const isC1End = /[a-zA-Z0-9#ε*+?)]/.test(c1);
        const isC2Start = /[a-zA-Z0-9#ε(]/.test(c2);
        if (isC1End && isC2Start) formatted += '.';
      }
    }

    const precedence = { '*': 3, '+': 3, '?': 3, '.': 2, '|': 1 };
    let postfix = '';
    const stack = [];

    for (let i = 0; i < formatted.length; i++) {
      const c = formatted[i];
      if (/[a-zA-Z0-9#ε]/.test(c)) {
        postfix += c;
      } else if (c === '(') {
        stack.push(c);
      } else if (c === ')') {
        while (stack.length > 0 && stack[stack.length - 1] !== '(') postfix += stack.pop();
        stack.pop();
      } else if (precedence[c]) {
        while (
          stack.length > 0 &&
          stack[stack.length - 1] !== '(' &&
          precedence[stack[stack.length - 1]] >= precedence[c]
        ) {
          postfix += stack.pop();
        }
        stack.push(c);
      }
    }
    while (stack.length > 0) postfix += stack.pop();
    return postfix;
  }

  const root = parseTree(augmentedRegex);

  // Compute followpos table
  const followpos = {};
  leaves.forEach((l) => {
    followpos[l.leafId] = new Set();
  });

  function computeFollowpos(node) {
    if (!node) return;
    if (node.symbol === '.') {
      const c1 = node.children[0];
      const c2 = node.children[1];
      for (const i of c1.lastpos) {
        for (const j of c2.firstpos) {
          if (followpos[i]) followpos[i].add(j);
        }
      }
    } else if (node.symbol === '*' || node.symbol === '+') {
      // Repetition: every last position can be followed by every first position.
      for (const i of node.lastpos) {
        for (const j of node.firstpos) {
          if (followpos[i]) followpos[i].add(j);
        }
      }
    }
    node.children.forEach(computeFollowpos);
  }

  computeFollowpos(root);

  // Alphabet (excluding '#')
  const alphabetSet = new Set(leaves.map((l) => l.symbol).filter((s) => s !== '#'));
  const alphabet = Array.from(alphabetSet).sort();

  // Construct DFA states directly from followpos
  const dfaStateMap = new Map();
  const dfaStates = [];
  const dfaTransitions = [];
  let dCounter = 0;

  const startSet = root.firstpos.sort((a, b) => a - b);
  const startKey = startSet.join(',');

  const d0 = `D${dCounter++}`;
  dfaStateMap.set(startKey, d0);
  dfaStates.push({ name: d0, positions: startSet });

  const queue = [d0];

  const endLeafId = leaves.find((l) => l.symbol === '#')?.leafId;

  while (queue.length > 0) {
    const currDfaName = queue.shift();
    const currState = dfaStates.find((s) => s.name === currDfaName);

    for (const sym of alphabet) {
      const targetPosSet = new Set();
      for (const pos of currState.positions) {
        const leaf = leaves.find((l) => l.leafId === pos);
        if (leaf && leaf.symbol === sym) {
          const fps = followpos[pos] ? Array.from(followpos[pos]) : [];
          fps.forEach((p) => targetPosSet.add(p));
        }
      }

      if (targetPosSet.size === 0) continue;

      const sortedTarget = Array.from(targetPosSet).sort((a, b) => a - b);
      const targetKey = sortedTarget.join(',');

      let targetDfaName = dfaStateMap.get(targetKey);
      if (!targetDfaName) {
        targetDfaName = `D${dCounter++}`;
        dfaStateMap.set(targetKey, targetDfaName);
        dfaStates.push({ name: targetDfaName, positions: sortedTarget });
        queue.push(targetDfaName);
      }

      dfaTransitions.push({ from: currDfaName, to: targetDfaName, symbol: sym });
    }
  }

  const acceptStates = dfaStates
    .filter((s) => endLeafId !== undefined && s.positions.includes(endLeafId))
    .map((s) => s.name);

  // Format followpos table for view
  const followposTable = leaves.map((l) => ({
    leafId: l.leafId,
    symbol: l.symbol,
    followpos: Array.from(followpos[l.leafId] || []).sort((a, b) => a - b),
  }));

  return {
    augmentedRegex,
    syntaxTree: root,
    leaves,
    followposTable,
    alphabet,
    states: dfaStates.map((s) => s.name),
    dfaStateDetails: dfaStates,
    startState: d0,
    acceptStates,
    transitions: dfaTransitions,
  };
}

// Generate Lex (.l) file preview
export function generateLexSpec(tokenSpecs) {
  const lines = [];
  lines.push('/* Lex (flex) Specification Generator */');
  lines.push('%{');
  lines.push('#include <stdio.h>');
  lines.push('#include "y.tab.h"');
  lines.push('%}');
  lines.push('');
  lines.push('%%');

  tokenSpecs.forEach((spec) => {
    if (spec.skip || spec.type === 'COMMENT') {
      lines.push(`${spec.regex.source}  ; /* skip */`);
    } else if (spec.error) {
      lines.push(`${spec.regex.source}  { fprintf(stderr, "lexical error: %s\\n", yytext); }`);
    } else {
      lines.push(`${spec.regex.source}  { printf("TOKEN_%s: %s\\n", "${spec.type}", yytext); return ${spec.type}; }`);
    }
  });

  lines.push('[ \\t\\n]+  ; /* ignore whitespace */');
  lines.push('.          { printf("Unknown character: %s\\n", yytext); }');
  lines.push('%%');
  lines.push('');
  lines.push('int main() { yylex(); return 0; }');
  lines.push('int yywrap() { return 1; }');

  return lines.join('\n');
}
