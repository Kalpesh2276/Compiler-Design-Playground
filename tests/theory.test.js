import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEORY } from '../src/components/lab/theory.js';

const LAB_TOPICS = ['automata', 'direct-dfa', 'grammar', 'parsing', 'lr', 'sdt', 'icg', 'optimization', 'codegen', 'advanced'];

test('every Algorithm Lab topic has theory notes', () => {
  assert.deepEqual(Object.keys(THEORY).sort(), [...LAB_TOPICS].sort());
});

test('theory sections are well-formed', () => {
  const known = ['steps', 'formula', 'table', 'example', 'note'];
  for (const [topic, sections] of Object.entries(THEORY)) {
    const ids = sections.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, `${topic}: duplicate section id`);
    for (const s of sections) {
      assert.ok(s.title && s.blocks.length > 0, `${topic}/${s.id}`);
      for (const b of s.blocks) {
        if (typeof b === 'string') continue;
        assert.ok(known.some((k) => k in b), `${topic}/${s.id}: unknown block`);
        if (b.table) for (const row of b.table.rows) assert.equal(row.length, b.table.head.length, `${topic}/${s.id}: table row width`);
      }
    }
  }
});
