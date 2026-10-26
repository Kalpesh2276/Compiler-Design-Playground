// Engine for Automata Algorithms (Regex->NFA, NFA->DFA, Minimization, Simulation)

// -------------------------------------------------------------
// Helper: Insert explicit concatenation operator '.' in Regex
// -------------------------------------------------------------
function insertConcatOps(regex) {
  let result = '';
  for (let i = 0; i < regex.length; i++) {
    const c1 = regex[i];
    result += c1;
    if (i + 1 < regex.length) {
      const c2 = regex[i + 1];
      // Insert '.' if c1 can end an operand and c2 can start an operand
      const isC1OperandEnd = /[a-zA-Z0-9\)\*\+\?]/.test(c1);
      const isC2OperandStart = /[a-zA-Z0-9\(]/.test(c2);
      if (isC1OperandEnd && isC2OperandStart) {
        result += '.';
      }
    }
  }
  return result;
}

// -------------------------------------------------------------
// Helper: Shunting Yard to convert Infix Regex to Postfix
// -------------------------------------------------------------
function regexToPostfix(regex) {
  const formatted = insertConcatOps(regex);
  const precedence = { '*': 3, '+': 3, '?': 3, '.': 2, '|': 1 };
  let postfix = '';
  const stack = [];

  for (let i = 0; i < formatted.length; i++) {
    const token = formatted[i];
    if (/[a-zA-Z0-9ε]/.test(token)) {
      postfix += token;
    } else if (token === '(') {
      stack.push(token);
    } else if (token === ')') {
      while (stack.length > 0 && stack[stack.length - 1] !== '(') {
        postfix += stack.pop();
      }
      stack.pop(); // Remove '('
    } else if (precedence[token]) {
      while (
        stack.length > 0 &&
        stack[stack.length - 1] !== '(' &&
        precedence[stack[stack.length - 1]] >= precedence[token]
      ) {
        postfix += stack.pop();
      }
      stack.push(token);
    }
  }

  while (stack.length > 0) {
    postfix += stack.pop();
  }

  return postfix;
}

// -------------------------------------------------------------
// 1. Thompson's Construction (Regex to NFA)
// -------------------------------------------------------------
export function regexToNFA(regexInput) {
  if (!regexInput || regexInput.trim() === '') {
    throw new Error('Regex input cannot be empty.');
  }

  const cleanRegex = regexInput.replace(/\s+/g, '');
  const postfix = regexToPostfix(cleanRegex);
  const stack = [];
  let stateCounter = 0;

  function createState() {
    return `q${stateCounter++}`;
  }

  const transitions = [];
  const alphabetSet = new Set();
  const stepLogs = [];

  stepLogs.push(`Input Regular Expression: "${regexInput}"`);
  stepLogs.push(`Infix with Explicit Concatenation: "${insertConcatOps(cleanRegex)}"`);
  stepLogs.push(`Postfix Expression: "${postfix}"`);

  for (let i = 0; i < postfix.length; i++) {
    const char = postfix[i];

    if (/[a-zA-Z0-9ε]/.test(char)) {
      const start = createState();
      const accept = createState();
      const sym = char === 'ε' ? 'ε' : char;
      if (sym !== 'ε') alphabetSet.add(sym);

      transitions.push({ from: start, to: accept, symbol: sym });
      stack.push({ start, accept });
      stepLogs.push(`Symbol '${sym}': Created NFA fragment (${start} --${sym}--> ${accept})`);
    } else if (char === '.') {
      if (stack.length < 2) throw new Error('Invalid regex syntax for concatenation.');
      const n2 = stack.pop();
      const n1 = stack.pop();

      transitions.push({ from: n1.accept, to: n2.start, symbol: 'ε' });
      stack.push({ start: n1.start, accept: n2.accept });
      stepLogs.push(`Concat ('.'): Connected ${n1.accept} --ε--> ${n2.start}`);
    } else if (char === '|') {
      if (stack.length < 2) throw new Error('Invalid regex syntax for union.');
      const n2 = stack.pop();
      const n1 = stack.pop();
      const start = createState();
      const accept = createState();

      transitions.push({ from: start, to: n1.start, symbol: 'ε' });
      transitions.push({ from: start, to: n2.start, symbol: 'ε' });
      transitions.push({ from: n1.accept, to: accept, symbol: 'ε' });
      transitions.push({ from: n2.accept, to: accept, symbol: 'ε' });

      stack.push({ start, accept });
      stepLogs.push(`Union ('|'): Combined fragments into new start ${start} and accept ${accept}`);
    } else if (char === '*') {
      if (stack.length < 1) throw new Error('Invalid regex syntax for Kleene star.');
      const n = stack.pop();
      const start = createState();
      const accept = createState();

      transitions.push({ from: start, to: n.start, symbol: 'ε' });
      transitions.push({ from: start, to: accept, symbol: 'ε' });
      transitions.push({ from: n.accept, to: n.start, symbol: 'ε' });
      transitions.push({ from: n.accept, to: accept, symbol: 'ε' });

      stack.push({ start, accept });
      stepLogs.push(`Star ('*'): Wrapped fragment with star loops (${start} and ${accept})`);
    } else if (char === '+') {
      if (stack.length < 1) throw new Error('Invalid regex syntax for plus operator.');
      const n = stack.pop();
      const start = createState();
      const accept = createState();

      transitions.push({ from: start, to: n.start, symbol: 'ε' });
      transitions.push({ from: n.accept, to: n.start, symbol: 'ε' });
      transitions.push({ from: n.accept, to: accept, symbol: 'ε' });

      stack.push({ start, accept });
      stepLogs.push(`Plus ('+'): Created 1-or-more loops for fragment (${start} to ${accept})`);
    } else if (char === '?') {
      if (stack.length < 1) throw new Error('Invalid regex syntax for optional operator.');
      const n = stack.pop();
      const start = createState();
      const accept = createState();

      transitions.push({ from: start, to: n.start, symbol: 'ε' });
      transitions.push({ from: start, to: accept, symbol: 'ε' });
      transitions.push({ from: n.accept, to: accept, symbol: 'ε' });

      stack.push({ start, accept });
      stepLogs.push(`Option ('?'): Created optional bypass (${start} to ${accept})`);
    }
  }

  if (stack.length !== 1) {
    throw new Error('Malformed regular expression syntax.');
  }

  const finalNFA = stack.pop();
  const allStates = [];
  for (let s = 0; s < stateCounter; s++) {
    allStates.push(`q${s}`);
  }

  stepLogs.push(`NFA Construction Complete: ${allStates.length} states generated.`);

  return {
    states: allStates,
    alphabet: Array.from(alphabetSet).sort(),
    startState: finalNFA.start,
    acceptStates: [finalNFA.accept],
    transitions,
    stepLogs,
  };
}

// -------------------------------------------------------------
// Helper: Compute Epsilon Closure for a set of states
// -------------------------------------------------------------
function epsilonClosure(stateSet, transitions) {
  const closure = new Set(stateSet);
  const stack = Array.from(stateSet);

  while (stack.length > 0) {
    const curr = stack.pop();
    for (const tr of transitions) {
      if (tr.from === curr && (tr.symbol === 'ε' || tr.symbol === '')) {
        if (!closure.has(tr.to)) {
          closure.add(tr.to);
          stack.push(tr.to);
        }
      }
    }
  }

  return closure;
}

// Helper: Move from state set on symbol
function move(stateSet, symbol, transitions) {
  const result = new Set();
  for (const s of stateSet) {
    for (const tr of transitions) {
      if (tr.from === s && tr.symbol === symbol) {
        result.add(tr.to);
      }
    }
  }
  return result;
}

// -------------------------------------------------------------
// 2. NFA to DFA Conversion (Subset Construction)
// -------------------------------------------------------------
export function nfaToDFA(nfa) {
  const { states, alphabet, startState, acceptStates, transitions } = nfa;
  const stepLogs = [];

  const initialClosure = epsilonClosure(new Set([startState]), transitions);
  const initialSorted = Array.from(initialClosure).sort().join(',');

  const dfaStateMap = new Map(); // sortedStr -> "D0"
  const dfaStateSetMap = new Map(); // "D0" -> Set of NFA states
  let dfaCounter = 0;

  const d0Name = `D${dfaCounter++}`;
  dfaStateMap.set(initialSorted, d0Name);
  dfaStateSetMap.set(d0Name, initialClosure);

  const queue = [d0Name];
  const dfaTransitions = [];
  const subsetMappingTable = [];

  stepLogs.push(`Starting Subset Construction with Start State: ${startState}`);
  stepLogs.push(`D0 = ε-closure({${startState}}) = {${Array.from(initialClosure).sort().join(', ')}}`);

  subsetMappingTable.push({
    dfaState: d0Name,
    nfaStates: Array.from(initialClosure).sort().join(', '),
    isStart: true,
    isAccept: Array.from(initialClosure).some((s) => acceptStates.includes(s)),
  });

  while (queue.length > 0) {
    const currentDFAStateName = queue.shift();
    const currentNFAStateSet = dfaStateSetMap.get(currentDFAStateName);

    for (const sym of alphabet) {
      const moved = move(currentNFAStateSet, sym, transitions);
      const closure = epsilonClosure(moved, transitions);

      if (closure.size === 0) continue; // Dead transition or skip

      const sortedStr = Array.from(closure).sort().join(',');
      let targetDFAName = dfaStateMap.get(sortedStr);

      if (!targetDFAName) {
        targetDFAName = `D${dfaCounter++}`;
        dfaStateMap.set(sortedStr, targetDFAName);
        dfaStateSetMap.set(targetDFAName, closure);
        queue.push(targetDFAName);

        const isAcc = Array.from(closure).some((s) => acceptStates.includes(s));
        subsetMappingTable.push({
          dfaState: targetDFAName,
          nfaStates: Array.from(closure).sort().join(', '),
          isStart: false,
          isAccept: isAcc,
        });

        stepLogs.push(
          `Discovered ${targetDFAName} = ε-closure(move(${currentDFAStateName}, '${sym}')) = {${Array.from(closure).sort().join(', ')}}`
        );
      }

      dfaTransitions.push({
        from: currentDFAStateName,
        to: targetDFAName,
        symbol: sym,
      });
    }
  }

  const dfaStates = subsetMappingTable.map((row) => row.dfaState);
  const dfaAcceptStates = subsetMappingTable
    .filter((row) => row.isAccept)
    .map((row) => row.dfaState);

  return {
    states: dfaStates,
    alphabet,
    startState: d0Name,
    acceptStates: dfaAcceptStates,
    transitions: dfaTransitions,
    subsetMappingTable,
    stepLogs,
  };
}

// -------------------------------------------------------------
// 3. DFA Minimization (Hopcroft's Partitioning Algorithm)
// -------------------------------------------------------------
export function minimizeDFA(dfa) {
  const { states, alphabet, startState, acceptStates, transitions } = dfa;
  const stepLogs = [];

  // Remove unreachable states
  const reachable = new Set();
  const reachQueue = [startState];
  reachable.add(startState);

  while (reachQueue.length > 0) {
    const curr = reachQueue.shift();
    for (const tr of transitions) {
      if (tr.from === curr && !reachable.has(tr.to)) {
        reachable.add(tr.to);
        reachQueue.push(tr.to);
      }
    }
  }

  const validStates = states.filter((s) => reachable.has(s));
  const validTransitions = transitions.filter(
    (tr) => reachable.has(tr.from) && reachable.has(tr.to)
  );
  const validAccept = acceptStates.filter((s) => reachable.has(s));
  const validNonAccept = validStates.filter((s) => !validAccept.includes(s));

  stepLogs.push(`Initial reachable states: ${validStates.join(', ')}`);

  // Partitions: P = [Non-Accepting, Accepting]
  let partitions = [];
  if (validNonAccept.length > 0) partitions.push(validNonAccept);
  if (validAccept.length > 0) partitions.push(validAccept);

  stepLogs.push(
    `Initial Groups: ${partitions.map((g) => `{${g.join(', ')}}`).join(' | ')}`
  );

  let changed = true;
  let iteration = 1;

  while (changed) {
    changed = false;
    const newPartitions = [];

    for (const group of partitions) {
      if (group.length <= 1) {
        newPartitions.push(group);
        continue;
      }

      // Split group based on transitions for each symbol
      const subGroups = new Map();

      for (const st of group) {
        // Construct signature: group indices of target state for each symbol
        const sigParts = [];
        for (const sym of alphabet) {
          const tr = validTransitions.find((t) => t.from === st && t.symbol === sym);
          const target = tr ? tr.to : null;

          let targetGroupIdx = -1;
          if (target) {
            targetGroupIdx = partitions.findIndex((p) => p.includes(target));
          }
          sigParts.push(`${sym}:${targetGroupIdx}`);
        }
        const sig = sigParts.join('|');

        if (!subGroups.has(sig)) {
          subGroups.set(sig, []);
        }
        subGroups.get(sig).push(st);
      }

      const splitList = Array.from(subGroups.values());
      if (splitList.length > 1) {
        changed = true;
      }
      newPartitions.push(...splitList);
    }

    partitions = newPartitions;
    stepLogs.push(
      `Iteration ${iteration++}: ${partitions.map((g) => `{${g.join(', ')}}`).join(' | ')}`
    );
  }

  // Build minimized DFA
  const minStateMap = new Map(); // origState -> "M0"
  const minStates = [];
  let minStart = '';
  const minAccept = [];
  let mCounter = 0;

  for (const group of partitions) {
    const name = `M${mCounter++}`;
    minStates.push(name);
    for (const st of group) {
      minStateMap.set(st, name);
    }
    if (group.includes(startState)) {
      minStart = name;
    }
    if (group.some((st) => validAccept.includes(st))) {
      minAccept.push(name);
    }
  }

  const minTransitions = [];
  const trSet = new Set();

  for (const tr of validTransitions) {
    const fromM = minStateMap.get(tr.from);
    const toM = minStateMap.get(tr.to);
    const key = `${fromM}->${toM}:${tr.symbol}`;
    if (fromM && toM && !trSet.has(key)) {
      trSet.add(key);
      minTransitions.push({ from: fromM, to: toM, symbol: tr.symbol });
    }
  }

  stepLogs.push(
    `Minimization Complete: Reduced from ${states.length} states to ${minStates.length} states.`
  );

  return {
    states: minStates,
    alphabet,
    startState: minStart,
    acceptStates: Array.from(new Set(minAccept)),
    transitions: minTransitions,
    partitionSteps: stepLogs,
    stepLogs,
  };
}

// -------------------------------------------------------------
// 4. String Simulation (DFA / NFA step-by-step trace)
// -------------------------------------------------------------
export function simulateString(automaton, inputString) {
  const { startState, acceptStates, transitions, alphabet } = automaton;
  const steps = [];
  let currentStates = new Set([startState]);

  // If NFA with epsilon transitions, start with epsilon closure
  currentStates = epsilonClosure(currentStates, transitions);

  steps.push({
    step: 0,
    char: '',
    processed: '',
    remaining: inputString,
    activeStates: Array.from(currentStates),
    action: `Initial State(s): {${Array.from(currentStates).join(', ')}}`,
  });

  for (let i = 0; i < inputString.length; i++) {
    const char = inputString[i];
    const processed = inputString.slice(0, i + 1);
    const remaining = inputString.slice(i + 1);

    const nextStates = move(currentStates, char, transitions);
    const closedNextStates = epsilonClosure(nextStates, transitions);

    if (closedNextStates.size === 0) {
      steps.push({
        step: i + 1,
        char,
        processed,
        remaining,
        activeStates: [],
        action: `Symbol '${char}': No valid transition. Trapped in dead state.`,
      });
      currentStates = new Set();
      break;
    }

    currentStates = closedNextStates;
    steps.push({
      step: i + 1,
      char,
      processed,
      remaining,
      activeStates: Array.from(currentStates),
      action: `Symbol '${char}': Transitioned to {${Array.from(currentStates).join(', ')}}`,
    });
  }

  const isAccepted = Array.from(currentStates).some((s) => acceptStates.includes(s));

  return {
    inputString,
    isAccepted,
    steps,
  };
}
