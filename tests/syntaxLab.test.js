import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOperatorPrecedence, simulateRecursiveDescent } from '../src/engine/syntaxEngines.js';
import { parseGrammar, computeFirstSets, computeFollowSets, createLL1Table, eliminateLeftFactoring } from '../src/engine/grammar.js';
import { createSLR1Table, parseStringLR } from '../src/engine/lrParser.js';

const treeText = (n) => (n.children.length ? `${n.label}(${n.children.map(treeText).join(' ')})` : n.label);

// ------------------------------------------------------- operator precedence
test('operator precedence accepts valid expressions (legacy bug B3)', () => {
  for (const s of ['id', 'id + id', 'id + id * id', '( id + id ) * id', '( ( id ) )']) {
    assert.equal(parseOperatorPrecedence(s).success, true, s);
  }
});

test('operator precedence builds a tree with * binding tighter and + left-associative', () => {
  assert.equal(treeText(parseOperatorPrecedence('id + id * id').tree), 'E(E(id) + E(E(id) * E(id)))');
  assert.equal(treeText(parseOperatorPrecedence('id + id + id').tree), 'E(E(E(id) + E(id)) + E(id))');
});

test('operator precedence rejects invalid input with a reason', () => {
  for (const s of ['id id', 'id +', '+ id', '( id', 'id )', 'id - id', '']) {
    const r = parseOperatorPrecedence(s);
    assert.equal(r.success, false, s);
    assert.equal(r.steps.at(-1).relation, 'ERROR', s);
  }
});

// ------------------------------------------------------- recursive descent
test('recursive descent accepts valid input and builds the LL(1) parse tree', () => {
  const r = simulateRecursiveDescent('id * ( id + id )');
  assert.equal(r.success, true);
  assert.equal(r.tree.label, 'E');
});

test('recursive descent rejects an unclosed parenthesis (legacy bug B4) and trailing junk', () => {
  assert.equal(simulateRecursiveDescent('( id').success, false);
  assert.equal(simulateRecursiveDescent('id id').success, false);
  assert.equal(simulateRecursiveDescent('').success, false);
  assert.match(simulateRecursiveDescent('( id').trace.at(-1), /expected '\)' but found 'end of input'/);
});

// ------------------------------------------------------------- grammar tools
test("a terminal named 'e' is no longer turned into ε (legacy bug B10)", () => {
  const g = parseGrammar('S -> i E t S | i E t S e S | a\nE -> b');
  assert.ok(g.terminals.includes('e'));
  assert.deepEqual(g.productions[1].rhs, ['i', 'E', 't', 'S', 'e', 'S']);
});

test('left factoring handles several prefix groups and nested prefixes', () => {
  const r = eliminateLeftFactoring(parseGrammar('A -> a b c | a b d | a e | x y | x z'));
  const g = parseGrammar(r.transformedGrammarText);
  // No non-terminal may keep two alternatives with the same first symbol.
  for (const nt of g.nonTerminals) {
    const firsts = g.productions.filter((p) => p.lhs === nt).map((p) => p.rhs[0]);
    assert.equal(new Set(firsts).size, firsts.length, `${nt}: ${firsts}`);
  }
});

test('left factoring of the dangling-else grammar yields the textbook result', () => {
  const r = eliminateLeftFactoring(parseGrammar('S -> i E t S | i E t S e S | a\nE -> b'));
  assert.match(r.transformedGrammarText, /^S -> i E t S S' \| a$/m);
  assert.match(r.transformedGrammarText, /^S' -> ε \| e S$/m);
  // ...and it is (famously) still not LL(1): FIRST/FOLLOW conflict on 'e'.
  const g = parseGrammar(r.transformedGrammarText);
  const { firstSets } = computeFirstSets(g);
  const { followSets } = computeFollowSets(g, firstSets);
  const t = createLL1Table(g, firstSets, followSets);
  assert.equal(t.isLL1, false);
  assert.match(t.conflicts[0], /M\[S', 'e'\]/);
});

// ------------------------------------------------------------------ SLR(1)
test('SLR(1) reduces ε-productions (legacy bug B11)', () => {
  const slr = createSLR1Table('S -> A b\nA -> a | ε');
  assert.equal(slr.isSLR1, true);
  assert.equal(parseStringLR('b', slr).success, true);
  assert.equal(parseStringLR('a b', slr).success, true);
  assert.equal(parseStringLR('a', slr).success, false);
});

test("SLR(1) augmented start symbol does not collide with an existing E' (legacy bug B12)", () => {
  const slr = createSLR1Table("E -> T E'\nE' -> + T E' | ε\nT -> id");
  const nts = slr.grammar.nonTerminals;
  assert.equal(new Set(nts).size, nts.length);
  assert.equal(slr.grammar.augmentedStart, "E''");
  assert.equal(parseStringLR('id + id + id', slr).success, true);
});
