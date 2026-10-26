// Engine for Grammar Operations (FIRST/FOLLOW, Left Recursion, Left Factoring, LL(1) Parsing)

// -------------------------------------------------------------
// 1. Grammar Parser
// -------------------------------------------------------------
export function parseGrammar(grammarText) {
  if (!grammarText || grammarText.trim() === '') {
    throw new Error('Grammar input cannot be empty.');
  }

  const lines = grammarText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const productions = [];
  const nonTerminalsSet = new Set();
  let startSymbol = null;

  for (const line of lines) {
    if (!line.includes('->') && !line.includes('→')) {
      throw new Error(`Invalid line format (missing '->'): "${line}"`);
    }

    const parts = line.split(/->|→/);
    const lhs = parts[0].trim();
    const rhsString = parts[1].trim();

    if (!lhs) throw new Error(`Missing Left-Hand Side in line: "${line}"`);
    if (!startSymbol) startSymbol = lhs;

    nonTerminalsSet.add(lhs);

    const rhsList = rhsString.split('|').map((alt) => {
      const tokens = alt.trim().split(/\s+/).filter((t) => t.length > 0);
      // Only explicit spellings denote ε; a lone 'e' is an ordinary terminal (e.g. "else").
      return tokens.map((t) => (t === 'epsilon' || t === 'eps' ? 'ε' : t));
    });

    for (const alt of rhsList) {
      productions.push({ lhs, rhs: alt.length === 0 ? ['ε'] : alt });
    }
  }

  const nonTerminals = Array.from(nonTerminalsSet);
  const terminalsSet = new Set();

  for (const p of productions) {
    for (const sym of p.rhs) {
      if (sym !== 'ε' && !nonTerminalsSet.has(sym)) {
        terminalsSet.add(sym);
      }
    }
  }

  const terminals = Array.from(terminalsSet).sort();

  return {
    startSymbol,
    nonTerminals,
    terminals,
    productions,
  };
}

// -------------------------------------------------------------
// 2. FIRST Set Computation
// -------------------------------------------------------------
export function computeFirstSets(parsedGrammar) {
  const { nonTerminals, terminals, productions } = parsedGrammar;
  const first = {};
  const stepLogs = [];

  // Initialize FIRST for terminals
  for (const t of terminals) {
    first[t] = new Set([t]);
  }
  first['ε'] = new Set(['ε']);

  // Initialize FIRST for non-terminals
  for (const nt of nonTerminals) {
    first[nt] = new Set();
  }

  let changed = true;
  let pass = 1;

  while (changed) {
    changed = false;
    stepLogs.push(`Pass ${pass++}: Computing FIRST sets...`);

    for (const p of productions) {
      const { lhs, rhs } = p;
      const initialSize = first[lhs].size;

      // FIRST of RHS
      let allHasEpsilon = true;
      for (const symbol of rhs) {
        if (!first[symbol]) first[symbol] = new Set([symbol]);

        const symbolFirst = first[symbol];
        for (const f of symbolFirst) {
          if (f !== 'ε') {
            first[lhs].add(f);
          }
        }

        if (!symbolFirst.has('ε')) {
          allHasEpsilon = false;
          break;
        }
      }

      if (allHasEpsilon) {
        first[lhs].add('ε');
      }

      if (first[lhs].size > initialSize) {
        changed = true;
      }
    }
  }

  // Format as arrays
  const firstSets = {};
  for (const nt of nonTerminals) {
    firstSets[nt] = Array.from(first[nt]).sort();
    stepLogs.push(`FIRST(${nt}) = { ${firstSets[nt].join(', ')} }`);
  }

  return { firstSets, stepLogs };
}

// Helper: Compute FIRST of a sequence of symbols
export function computeFirstOfSequence(symbols, firstSets) {
  const result = new Set();
  let allEpsilon = true;

  for (const sym of symbols) {
    const symFirst = firstSets[sym] || [sym];
    for (const f of symFirst) {
      if (f !== 'ε') result.add(f);
    }
    if (!symFirst.includes('ε')) {
      allEpsilon = false;
      break;
    }
  }

  if (allEpsilon) result.add('ε');
  return Array.from(result);
}

// -------------------------------------------------------------
// 3. FOLLOW Set Computation
// -------------------------------------------------------------
export function computeFollowSets(parsedGrammar, firstSets) {
  const { startSymbol, nonTerminals, productions } = parsedGrammar;
  const follow = {};
  const stepLogs = [];

  for (const nt of nonTerminals) {
    follow[nt] = new Set();
  }

  // Rule 1: Start symbol gets $
  follow[startSymbol].add('$');
  stepLogs.push(`Rule 1: Placed '$' in FOLLOW(${startSymbol})`);

  let changed = true;
  let pass = 1;

  while (changed) {
    changed = false;
    stepLogs.push(`Pass ${pass++}: Propagating FOLLOW sets...`);

    for (const p of productions) {
      const { lhs, rhs } = p;

      for (let i = 0; i < rhs.length; i++) {
        const B = rhs[i];
        if (!nonTerminals.includes(B)) continue;

        const beta = rhs.slice(i + 1);
        const initialSize = follow[B].size;

        if (beta.length > 0) {
          const firstBeta = computeFirstOfSequence(beta, firstSets);
          for (const f of firstBeta) {
            if (f !== 'ε') follow[B].add(f);
          }

          if (firstBeta.includes('ε')) {
            for (const f of follow[lhs]) {
              follow[B].add(f);
            }
          }
        } else {
          // B is at the end of RHS
          for (const f of follow[lhs]) {
            follow[B].add(f);
          }
        }

        if (follow[B].size > initialSize) {
          changed = true;
        }
      }
    }
  }

  const followSets = {};
  for (const nt of nonTerminals) {
    followSets[nt] = Array.from(follow[nt]).sort();
    stepLogs.push(`FOLLOW(${nt}) = { ${followSets[nt].join(', ')} }`);
  }

  return { followSets, stepLogs };
}

// -------------------------------------------------------------
// 4. Left Recursion Elimination
// -------------------------------------------------------------
export function eliminateLeftRecursion(parsedGrammar) {
  const { nonTerminals, productions } = parsedGrammar;
  const newProductions = [];
  const stepLogs = [];

  stepLogs.push(`Checking left recursion across non-terminals: ${nonTerminals.join(', ')}`);

  // Map non-terminals to their list of RHS alternatives
  const rulesMap = {};
  for (const nt of nonTerminals) {
    rulesMap[nt] = productions.filter((p) => p.lhs === nt).map((p) => p.rhs);
  }

  const nts = [...nonTerminals];

  for (let i = 0; i < nts.length; i++) {
    const Ai = nts[i];

    // Indirect left recursion replacement
    for (let j = 0; j < i; j++) {
      const Aj = nts[j];
      const newRhsList = [];

      for (const rhs of rulesMap[Ai]) {
        if (rhs[0] === Aj) {
          const gamma = rhs.slice(1);
          stepLogs.push(`Substituting ${Aj} in ${Ai} -> ${rhs.join(' ')}`);
          for (const delta of rulesMap[Aj]) {
            newRhsList.push([...delta, ...gamma]);
          }
        } else {
          newRhsList.push(rhs);
        }
      }
      rulesMap[Ai] = newRhsList;
    }

    // Immediate left recursion elimination for Ai
    const recursiveRhs = [];
    const nonRecursiveRhs = [];

    for (const rhs of rulesMap[Ai]) {
      if (rhs[0] === Ai) {
        recursiveRhs.push(rhs.slice(1));
      } else {
        nonRecursiveRhs.push(rhs);
      }
    }

    if (recursiveRhs.length > 0) {
      let AiPrime = `${Ai}'`;
      while (nts.includes(AiPrime)) AiPrime += "'";
      stepLogs.push(`Detected Immediate Left Recursion in ${Ai}! Creating ${AiPrime}.`);

      const newAiRhs = nonRecursiveRhs.map((beta) =>
        beta.length === 1 && beta[0] === 'ε' ? [AiPrime] : [...beta, AiPrime]
      );
      const newAiPrimeRhs = recursiveRhs.map((alpha) => [...alpha, AiPrime]);
      newAiPrimeRhs.push(['ε']);

      rulesMap[Ai] = newAiRhs;
      rulesMap[AiPrime] = newAiPrimeRhs;
      nts.push(AiPrime);
    } else {
      stepLogs.push(`No immediate left recursion in ${Ai}`);
    }
  }

  // Format result grammar text
  const resultLines = [];
  for (const nt of nts) {
    const alts = rulesMap[nt].map((alt) => alt.join(' '));
    resultLines.push(`${nt} -> ${alts.join(' | ')}`);
  }

  return {
    transformedGrammarText: resultLines.join('\n'),
    stepLogs,
  };
}

// -------------------------------------------------------------
// 5. Left Factoring
// -------------------------------------------------------------
export function eliminateLeftFactoring(parsedGrammar) {
  const { nonTerminals, productions } = parsedGrammar;
  const stepLogs = [];

  const rulesMap = {};
  for (const nt of nonTerminals) {
    rulesMap[nt] = productions.filter((p) => p.lhs === nt).map((p) => p.rhs);
  }

  const nts = [...nonTerminals];
  const freshName = (base) => {
    let name = `${base}'`;
    while (nts.includes(name)) name += "'";
    return name;
  };

  // Longest prefix shared by at least two alternatives (ignoring a lone ε).
  const longestCommonPrefix = (rhsList) => {
    let longest = [];
    for (let p1 = 0; p1 < rhsList.length; p1++) {
      for (let p2 = p1 + 1; p2 < rhsList.length; p2++) {
        const [a, b] = [rhsList[p1], rhsList[p2]];
        let k = 0;
        while (k < a.length && k < b.length && a[k] === b[k] && a[k] !== 'ε') k++;
        if (k > longest.length) longest = a.slice(0, k);
      }
    }
    return longest;
  };

  // Each non-terminal is factored repeatedly until no two alternatives share a prefix;
  // new non-terminals are appended to `nts` and are themselves processed in turn.
  for (let i = 0; i < nts.length; i++) {
    const A = nts[i];
    let factored = false;
    for (let prefix = longestCommonPrefix(rulesMap[A]); prefix.length > 0; prefix = longestCommonPrefix(rulesMap[A])) {
      factored = true;
      const APrime = freshName(A);
      stepLogs.push(`Found common prefix '${prefix.join(' ')}' in ${A}. Creating ${APrime}.`);
      const matching = [];
      const nonMatching = [];
      for (const alt of rulesMap[A]) {
        if (prefix.every((sym, k) => alt[k] === sym)) {
          const suffix = alt.slice(prefix.length);
          matching.push(suffix.length === 0 ? ['ε'] : suffix);
        } else {
          nonMatching.push(alt);
        }
      }
      rulesMap[A] = [[...prefix, APrime], ...nonMatching];
      rulesMap[APrime] = matching;
      nts.push(APrime);
    }
    if (!factored) stepLogs.push(`No common prefix in ${A}`);
  }

  const resultLines = [];
  for (const nt of nts) {
    const alts = rulesMap[nt].map((alt) => alt.join(' '));
    resultLines.push(`${nt} -> ${alts.join(' | ')}`);
  }

  return {
    transformedGrammarText: resultLines.join('\n'),
    stepLogs,
  };
}

// -------------------------------------------------------------
// 6. LL(1) Parsing Table Construction & String Simulation
// -------------------------------------------------------------
export function createLL1Table(parsedGrammar, firstSets, followSets) {
  const { nonTerminals, terminals, productions } = parsedGrammar;
  const table = {};
  const conflicts = [];
  const stepLogs = [];

  const columns = [...terminals, '$'];

  for (const nt of nonTerminals) {
    table[nt] = {};
    for (const col of columns) {
      table[nt][col] = null;
    }
  }

  for (const p of productions) {
    const { lhs, rhs } = p;
    const firstRHS = computeFirstOfSequence(rhs, firstSets);

    for (const terminal of firstRHS) {
      if (terminal !== 'ε') {
        if (table[lhs][terminal] !== null) {
          conflicts.push(
            `FIRST/FIRST Conflict at M[${lhs}, '${terminal}']: Existing: "${table[lhs][terminal]}", New: "${rhs.join(' ')}"`
          );
        }
        table[lhs][terminal] = rhs.join(' ');
      }
    }

    if (firstRHS.includes('ε')) {
      const followLHS = followSets[lhs] || [];
      for (const terminal of followLHS) {
        if (table[lhs][terminal] !== null) {
          conflicts.push(
            `FIRST/FOLLOW Conflict at M[${lhs}, '${terminal}']: Existing: "${table[lhs][terminal]}", New: "${rhs.join(' ')}"`
          );
        }
        table[lhs][terminal] = rhs.join(' ');
      }
    }
  }

  const isLL1 = conflicts.length === 0;

  return {
    table,
    columns,
    isLL1,
    conflicts,
    stepLogs,
  };
}

// Interactive LL(1) String Parser & Parse Tree Generator
export function parseStringLL1(inputString, parsedGrammar, ll1Table) {
  const { startSymbol } = parsedGrammar;
  const tokens = inputString.trim().split(/\s+/).filter((t) => t.length > 0);
  tokens.push('$');

  const stack = ['$', startSymbol];
  let tokenIdx = 0;
  const steps = [];
  let stepNum = 1;

  // Root node of Parse Tree
  const parseTree = { id: 0, label: startSymbol, children: [] };
  const treeNodeStack = [null, parseTree];
  let nodeCounter = 1;

  let success = false;

  while (stack.length > 0) {
    const top = stack[stack.length - 1];
    const currToken = tokens[tokenIdx];
    const currNode = treeNodeStack[treeNodeStack.length - 1];

    if (top === '$' && currToken === '$') {
      steps.push({
        step: stepNum++,
        stack: [...stack].join(' '),
        input: tokens.slice(tokenIdx).join(' '),
        action: 'Accept! Parsing successfully completed.',
      });
      success = true;
      break;
    }

    if (top === currToken) {
      stack.pop();
      treeNodeStack.pop();
      tokenIdx++;
      steps.push({
        step: stepNum++,
        stack: [...stack].join(' '),
        input: tokens.slice(tokenIdx).join(' '),
        action: `Matched terminal '${currToken}'`,
      });
    } else if (ll1Table.table[top] !== undefined) {
      const productionRhsStr = ll1Table.table[top][currToken];

      if (!productionRhsStr) {
        steps.push({
          step: stepNum++,
          stack: [...stack].join(' '),
          input: tokens.slice(tokenIdx).join(' '),
          action: `Error: No production entry for M[${top}, '${currToken}']`,
        });
        break;
      }

      stack.pop();
      treeNodeStack.pop();

      const rhsTokens = productionRhsStr.split(/\s+/);
      const childNodes = [];

      for (const tok of rhsTokens) {
        const child = { id: nodeCounter++, label: tok, children: [] };
        childNodes.push(child);
      }

      if (currNode) {
        currNode.children = childNodes;
      }

      steps.push({
        step: stepNum++,
        stack: [...stack].join(' '),
        input: tokens.slice(tokenIdx).join(' '),
        action: `Apply rule ${top} -> ${productionRhsStr}`,
      });

      // Push RHS tokens onto stack in reverse order
      if (productionRhsStr !== 'ε') {
        for (let r = rhsTokens.length - 1; r >= 0; r--) {
          stack.push(rhsTokens[r]);
          treeNodeStack.push(childNodes[r]);
        }
      }
    } else {
      steps.push({
        step: stepNum++,
        stack: [...stack].join(' '),
        input: tokens.slice(tokenIdx).join(' '),
        action: `Error: Unexpected symbol '${top}' on stack`,
      });
      break;
    }
  }

  return {
    success,
    steps,
    parseTree,
  };
}
