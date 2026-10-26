import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regexToNFA, nfaToDFA, minimizeDFA, simulateString } from '../src/engine/automata.js';
import { buildDirectDFA } from '../src/engine/directDFA.js';

// All strings over `alphabet` with length <= maxLen.
function allStrings(alphabet, maxLen) {
  const out = [''];
  let frontier = [''];
  for (let len = 1; len <= maxLen; len++) {
    const next = [];
    for (const s of frontier) for (const c of alphabet) next.push(s + c);
    out.push(...next);
    frontier = next;
  }
  return out;
}

const CASES = [
  { regex: '(a|b)*abb', alphabet: ['a', 'b'] },
  { regex: '(0|1)*10', alphabet: ['0', '1'] },
  { regex: 'a*b+', alphabet: ['a', 'b'] },
  { regex: 'ab?c', alphabet: ['a', 'b', 'c'] },
  { regex: '(ab|ba)*', alphabet: ['a', 'b'] },
  { regex: 'a(a|b)*b', alphabet: ['a', 'b'] },
];

for (const { regex, alphabet } of CASES) {
  test(`Thompson NFA, subset DFA and minimized DFA agree with RegExp for ${regex}`, () => {
    const reference = new RegExp(`^(?:${regex})$`);
    const nfa = regexToNFA(regex);
    const dfa = nfaToDFA(nfa);
    const min = minimizeDFA(dfa);
    assert.ok(min.states.length <= dfa.states.length);
    for (const s of allStrings(alphabet, 6)) {
      const expected = reference.test(s);
      assert.equal(simulateString(nfa, s).isAccepted, expected, `NFA on "${s}"`);
      assert.equal(simulateString(dfa, s).isAccepted, expected, `DFA on "${s}"`);
      assert.equal(simulateString(min, s).isAccepted, expected, `min DFA on "${s}"`);
    }
  });
}

test('minimized DFA for (a|b)*abb has the textbook 4 states', () => {
  const min = minimizeDFA(nfaToDFA(regexToNFA('(a|b)*abb')));
  assert.equal(min.states.length, 4);
  assert.equal(min.acceptStates.length, 1);
});

test('Thompson construction rejects malformed regexes', () => {
  assert.throws(() => regexToNFA(''));
  assert.throws(() => regexToNFA('a|'));
});

for (const { regex, alphabet } of CASES) {
  test(`direct DFA (followpos) agrees with RegExp for ${regex}`, () => {
    const reference = new RegExp(`^(?:${regex})$`);
    const dfa = buildDirectDFA(regex);
    for (const s of allStrings(alphabet, 6)) {
      assert.equal(simulateString(dfa, s).isAccepted, reference.test(s), `"${s}"`);
    }
  });
}

test('direct DFA followpos table for (a|b)*abb matches the Dragon Book example', () => {
  const { followposTable } = buildDirectDFA('(a|b)*abb');
  const fp = Object.fromEntries(followposTable.map((r) => [r.leafId, r.followpos]));
  assert.deepEqual(fp[1], [1, 2, 3]);
  assert.deepEqual(fp[2], [1, 2, 3]);
  assert.deepEqual(fp[3], [4]);
  assert.deepEqual(fp[4], [5]);
  assert.deepEqual(fp[5], [6]);
  assert.deepEqual(fp[6], []);
});

test('direct DFA reports malformed regexes instead of crashing', () => {
  assert.throws(() => buildDirectDFA('(ab'), /Unbalanced/);
  assert.throws(() => buildDirectDFA('a|'), /missing an operand/);
  assert.throws(() => buildDirectDFA('*a'), /no operand/);
  assert.throws(() => buildDirectDFA('a-b'), /Unsupported character/);
});
