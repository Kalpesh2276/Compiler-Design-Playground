// Engine for LR(0) / SLR(1) Bottom-Up Parsing & Canonical Collection of Item Sets
import { parseGrammar, computeFirstSets, computeFollowSets } from './grammar.js';

// Helper: Convert item object to unique string identifier
export function itemToString(item) {
  const rhsWithDot = [...item.rhs];
  rhsWithDot.splice(item.dotPos, 0, '•');
  return `${item.lhs} -> ${rhsWithDot.join(' ')}`;
}

/** Display form of a production right-hand side (empty = ε). */
export const rhsToString = (rhs) => (rhs.length === 0 ? 'ε' : rhs.join(' '));

// Helper: Check equality of item sets
function isSameItemSet(setA, setB) {
  if (setA.length !== setB.length) return false;
  const strSetA = new Set(setA.map(itemToString));
  return setB.every((item) => strSetA.has(itemToString(item)));
}

// -------------------------------------------------------------
// 1. Augment Grammar
// -------------------------------------------------------------
export function getAugmentedGrammar(grammarText) {
  const parsed = parseGrammar(grammarText);
  const startSymbol = parsed.startSymbol;
  // The augmented start symbol must be fresh: "E'" may already exist in the grammar.
  let augmentedStart = `${startSymbol}'`;
  while (parsed.nonTerminals.includes(augmentedStart)) augmentedStart += "'";

  // Prepend S' -> S. An ε-production is represented by an EMPTY right-hand side, so the
  // item A -> • is complete immediately and gets a reduce action.
  const productions = [
    { lhs: augmentedStart, rhs: [startSymbol], isAugmented: true },
    ...parsed.productions.map((p) => ({ ...p, rhs: p.rhs.filter((s) => s !== 'ε'), isAugmented: false })),
  ];

  const nonTerminals = [augmentedStart, ...parsed.nonTerminals];

  return {
    ...parsed,
    augmentedStart,
    nonTerminals,
    productions,
  };
}

// -------------------------------------------------------------
// 2. LR(0) Closure Computation
// -------------------------------------------------------------
export function lr0Closure(itemSet, grammar) {
  const closure = [...itemSet];
  let changed = true;

  while (changed) {
    changed = false;
    for (let i = 0; i < closure.length; i++) {
      const item = closure[i];
      if (item.dotPos < item.rhs.length) {
        const symbolAfterDot = item.rhs[item.dotPos];
        if (grammar.nonTerminals.includes(symbolAfterDot)) {
          // Find all productions for symbolAfterDot
          const prods = grammar.productions.filter((p) => p.lhs === symbolAfterDot);
          for (const p of prods) {
            const newItem = { lhs: p.lhs, rhs: p.rhs, dotPos: 0 };
            const newItemStr = itemToString(newItem);
            if (!closure.some((it) => itemToString(it) === newItemStr)) {
              closure.push(newItem);
              changed = true;
            }
          }
        }
      }
    }
  }

  return closure;
}

// -------------------------------------------------------------
// 3. LR(0) Goto Computation
// -------------------------------------------------------------
export function lr0Goto(itemSet, symbol, grammar) {
  const movedItems = [];
  for (const item of itemSet) {
    if (item.dotPos < item.rhs.length && item.rhs[item.dotPos] === symbol) {
      movedItems.push({
        lhs: item.lhs,
        rhs: item.rhs,
        dotPos: item.dotPos + 1,
      });
    }
  }
  return lr0Closure(movedItems, grammar);
}

// -------------------------------------------------------------
// 4. Build Canonical Collection of Item Sets
// -------------------------------------------------------------
export function buildCanonicalItems(grammar) {
  const initialItem = {
    lhs: grammar.augmentedStart,
    rhs: [grammar.startSymbol],
    dotPos: 0,
  };
  const i0 = lr0Closure([initialItem], grammar);

  const itemSets = [i0];
  const gotoTransitions = [];
  const stepLogs = [];

  stepLogs.push(`Augmented Start Rule: ${grammar.augmentedStart} -> ${grammar.startSymbol}`);
  stepLogs.push(`Computing I0 closure...`);

  let changed = true;
  while (changed) {
    changed = false;
    for (let sIdx = 0; sIdx < itemSets.length; sIdx++) {
      const currentSet = itemSets[sIdx];
      const symbolsToTry = [...grammar.nonTerminals, ...grammar.terminals];

      for (const sym of symbolsToTry) {
        const targetClosure = lr0Goto(currentSet, sym, grammar);
        if (targetClosure.length === 0) continue;

        let targetIdx = itemSets.findIndex((set) => isSameItemSet(set, targetClosure));

        if (targetIdx === -1) {
          itemSets.push(targetClosure);
          targetIdx = itemSets.length - 1;
          changed = true;
          stepLogs.push(`Created new Item Set I${targetIdx} via GOTO(I${sIdx}, '${sym}')`);
        }

        if (
          !gotoTransitions.some(
            (t) => t.fromState === sIdx && t.toState === targetIdx && t.symbol === sym
          )
        ) {
          gotoTransitions.push({ fromState: sIdx, symbol: sym, toState: targetIdx });
        }
      }
    }
  }

  return { itemSets, gotoTransitions, stepLogs };
}

// -------------------------------------------------------------
// 5. Build SLR(1) Action & Goto Table
// -------------------------------------------------------------
export function createSLR1Table(grammarText) {
  const grammar = getAugmentedGrammar(grammarText);
  const firstRes = computeFirstSets(grammar);
  const followRes = computeFollowSets(grammar, firstRes.firstSets);
  const { itemSets, gotoTransitions, stepLogs } = buildCanonicalItems(grammar);

  const actionTable = {};
  const gotoTable = {};
  const conflicts = [];

  const terminalCols = [...grammar.terminals, '$'];
  const nonTerminalCols = grammar.nonTerminals.filter((nt) => nt !== grammar.augmentedStart);

  for (let i = 0; i < itemSets.length; i++) {
    actionTable[i] = {};
    for (const t of terminalCols) actionTable[i][t] = [];
    gotoTable[i] = {};
    for (const nt of nonTerminalCols) gotoTable[i][nt] = null;
  }

  for (const tr of gotoTransitions) {
    if (nonTerminalCols.includes(tr.symbol)) {
      gotoTable[tr.fromState][tr.symbol] = tr.toState;
    }
  }

  for (let i = 0; i < itemSets.length; i++) {
    const itemSet = itemSets[i];

    for (const item of itemSet) {
      if (item.dotPos < item.rhs.length) {
        const symbolAfterDot = item.rhs[item.dotPos];
        if (grammar.terminals.includes(symbolAfterDot)) {
          const tr = gotoTransitions.find(
            (t) => t.fromState === i && t.symbol === symbolAfterDot
          );
          if (tr) {
            const shiftAction = `S${tr.toState}`;
            if (!actionTable[i][symbolAfterDot].includes(shiftAction)) {
              actionTable[i][symbolAfterDot].push(shiftAction);
            }
          }
        }
      } else {
        if (item.lhs === grammar.augmentedStart) {
          if (!actionTable[i]['$'].includes('ACC')) {
            actionTable[i]['$'].push('ACC');
          }
        } else {
          const prodIdx = grammar.productions.findIndex(
            (p) => p.lhs === item.lhs && p.rhs.join(' ') === item.rhs.join(' ')
          );
          const reduceAction = `R${prodIdx}`;

          const followSet = followRes.followSets[item.lhs] || ['$'];
          for (const term of followSet) {
            if (!actionTable[i][term].includes(reduceAction)) {
              actionTable[i][term].push(reduceAction);
            }
          }
        }
      }
    }

    for (const term of terminalCols) {
      const actions = actionTable[i][term];
      if (actions.length > 1) {
        conflicts.push(
          `Conflict in State I${i} on symbol '${term}': Actions [${actions.join(', ')}]`
        );
      }
    }
  }

  const isSLR1 = conflicts.length === 0;

  return {
    grammar,
    itemSets,
    gotoTransitions,
    actionTable,
    gotoTable,
    terminalCols,
    nonTerminalCols,
    isSLR1,
    conflicts,
    stepLogs,
  };
}

// -------------------------------------------------------------
// 6. Shift-Reduce String Simulator & Parse Tree Builder
// -------------------------------------------------------------
export function parseStringLR(inputString, slrTable) {
  const { grammar, actionTable, gotoTable } = slrTable;
  const tokens = inputString.trim().split(/\s+/).filter((t) => t.length > 0);
  tokens.push('$');

  const stateStack = [0];
  const symbolStack = ['$'];
  const treeStack = [null];
  let tokenIdx = 0;
  let stepNum = 1;
  const steps = [];
  let nodeCounter = 1;
  let success = false;

  let parseTreeRoot = null;

  while (tokenIdx < tokens.length) {
    const currentState = stateStack[stateStack.length - 1];
    const currentToken = tokens[tokenIdx];
    const availableActions = actionTable[currentState]?.[currentToken] || [];

    if (availableActions.length === 0) {
      steps.push({
        step: stepNum++,
        stateStack: [...stateStack].join(' '),
        symbolStack: [...symbolStack].join(' '),
        input: tokens.slice(tokenIdx).join(' '),
        action: `Error: No action for state I${currentState} on token '${currentToken}'`,
      });
      break;
    }

    // On a conflict (non-SLR grammar) the first action is taken and the choice is reported.
    const action = availableActions[0];
    const conflictNote = availableActions.length > 1 ? ` [conflict ${availableActions.join('/')}: chose ${action}]` : '';

    if (action === 'ACC') {
      steps.push({
        step: stepNum++,
        stateStack: [...stateStack].join(' '),
        symbolStack: [...symbolStack].join(' '),
        input: tokens.slice(tokenIdx).join(' '),
        action: 'Accept! Successfully parsed input string.',
      });
      success = true;
      parseTreeRoot = treeStack[treeStack.length - 1];
      break;
    }

    if (action.startsWith('S')) {
      const nextState = parseInt(action.slice(1), 10);
      const leafNode = { id: nodeCounter++, label: currentToken, children: [] };

      stateStack.push(nextState);
      symbolStack.push(currentToken);
      treeStack.push(leafNode);

      steps.push({
        step: stepNum++,
        stateStack: [...stateStack].join(' '),
        symbolStack: [...symbolStack].join(' '),
        input: tokens.slice(tokenIdx + 1).join(' '),
        action: `Shift '${currentToken}' -> State I${nextState}${conflictNote}`,
      });

      tokenIdx++;
    } else if (action.startsWith('R')) {
      const prodIdx = parseInt(action.slice(1), 10);
      const prod = grammar.productions[prodIdx];

      const childrenNodes = [];
      const rhsLen = prod.rhs.length === 1 && prod.rhs[0] === 'ε' ? 0 : prod.rhs.length;

      for (let k = 0; k < rhsLen; k++) {
        stateStack.pop();
        symbolStack.pop();
        childrenNodes.unshift(treeStack.pop());
      }

      const parentNode = {
        id: nodeCounter++,
        label: prod.lhs,
        children: rhsLen === 0 ? [{ id: nodeCounter++, label: 'ε', children: [] }] : childrenNodes,
      };

      const topState = stateStack[stateStack.length - 1];
      const gotoState = gotoTable[topState]?.[prod.lhs];

      if (gotoState === null || gotoState === undefined) {
        steps.push({
          step: stepNum++,
          stateStack: [...stateStack].join(' '),
          symbolStack: [...symbolStack].join(' '),
          input: tokens.slice(tokenIdx).join(' '),
          action: `Error: GOTO state undefined for state I${topState} on non-terminal '${prod.lhs}'`,
        });
        break;
      }

      stateStack.push(gotoState);
      symbolStack.push(prod.lhs);
      treeStack.push(parentNode);

      steps.push({
        step: stepNum++,
        stateStack: [...stateStack].join(' '),
        symbolStack: [...symbolStack].join(' '),
        input: tokens.slice(tokenIdx).join(' '),
        action: `Reduce by ${prod.lhs} -> ${rhsToString(prod.rhs)} (GOTO state I${gotoState})${conflictNote}`,
      });
    }
  }

  return {
    success,
    steps,
    parseTree: parseTreeRoot,
  };
}
