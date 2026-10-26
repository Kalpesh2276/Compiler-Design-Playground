import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGrammar,
  computeFirstSets,
  computeFollowSets,
  eliminateLeftRecursion,
  createLL1Table,
  parseStringLL1,
} from '../src/engine/grammar.js';
import { createSLR1Table, parseStringLR } from '../src/engine/lrParser.js';

const LL1_EXPR = `E -> T E'\nE' -> + T E' | ε\nT -> F T'\nT' -> * F T' | ε\nF -> ( E ) | id`;
const LR_EXPR = `E -> E + T | T\nT -> T * F | F\nF -> ( E ) | id`;

function sets(grammarText) {
  const g = parseGrammar(grammarText);
  const { firstSets } = computeFirstSets(g);
  const { followSets } = computeFollowSets(g, firstSets);
  return { g, firstSets, followSets };
}

test('FIRST and FOLLOW of the classic LL(1) expression grammar', () => {
  const { firstSets, followSets } = sets(LL1_EXPR);
  assert.deepEqual(firstSets.E, ['(', 'id']);
  assert.deepEqual(firstSets["E'"], ['+', 'ε']);
  assert.deepEqual(firstSets["T'"], ['*', 'ε']);
  assert.deepEqual(followSets.E, ['$', ')']);
  assert.deepEqual(followSets["E'"], ['$', ')']);
  assert.deepEqual(followSets.T, ['$', ')', '+']);
  assert.deepEqual(followSets.F, ['$', ')', '*', '+']);
});

test('LL(1) table is conflict-free and parses id + id * id', () => {
  const { g, firstSets, followSets } = sets(LL1_EXPR);
  const table = createLL1Table(g, firstSets, followSets);
  assert.equal(table.isLL1, true);
  assert.equal(table.table.E.id, "T E'");
  assert.equal(table.table["E'"].$, 'ε');
  assert.equal(parseStringLL1('id + id * id', g, table).success, true);
  assert.equal(parseStringLL1('id + * id', g, table).success, false);
});

test('left-recursive grammar is reported as not LL(1)', () => {
  const { g, firstSets, followSets } = sets(LR_EXPR);
  assert.equal(createLL1Table(g, firstSets, followSets).isLL1, false);
});

test('left recursion elimination produces an LL(1) grammar for the expression grammar', () => {
  const { transformedGrammarText } = eliminateLeftRecursion(parseGrammar(LR_EXPR));
  const { g, firstSets, followSets } = sets(transformedGrammarText);
  const table = createLL1Table(g, firstSets, followSets);
  assert.equal(table.isLL1, true);
  assert.equal(parseStringLL1('id * ( id + id )', g, table).success, true);
});

test('SLR(1) table for the expression grammar: 12 states, no conflicts', () => {
  const slr = createSLR1Table(LR_EXPR);
  assert.equal(slr.itemSets.length, 12);
  assert.equal(slr.isSLR1, true);
});

test('SLR(1) parser accepts valid and rejects invalid strings', () => {
  const slr = createSLR1Table(LR_EXPR);
  const ok = parseStringLR('id + id * id', slr);
  assert.equal(ok.success, true);
  assert.equal(ok.parseTree.label, 'E');
  assert.equal(parseStringLR('id + + id', slr).success, false);
  assert.equal(parseStringLR('( id', slr).success, false);
});

test('SLR(1) detects the dangling-else style conflict in an ambiguous grammar', () => {
  const slr = createSLR1Table('E -> E + E | id');
  assert.equal(slr.isSLR1, false);
  assert.ok(slr.conflicts.length > 0);
});
