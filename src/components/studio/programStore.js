// Browser-local storage for the user's own MiniC programs.
// Programs live only in this browser (localStorage). Every access is guarded because
// storage can be unavailable (private mode, blocked site data) – the Studio then simply
// works without persistence.

const PROGRAMS_KEY = 'cdp.studio.programs.v1';
const DRAFT_KEY = 'cdp.studio.draft.v1';

export const STARTER_PROGRAM = `// My program
// Write MiniC here and press Compile & run (Ctrl+Enter).
// Values for input() go in the "Program input" box below.
int x = input();
int y = input();
print(x + y);
`;

function read(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** [{ id, name, source, inputs, updatedAt }] newest first. */
export function loadPrograms() {
  const list = read(PROGRAMS_KEY, []);
  return Array.isArray(list) ? list.filter((p) => p && typeof p.source === 'string' && typeof p.name === 'string') : [];
}

export function savePrograms(list) {
  return write(PROGRAMS_KEY, list);
}

/** Insert or replace a program; returns the new list. */
export function upsertProgram(list, program) {
  const rest = list.filter((p) => p.id !== program.id);
  return [{ ...program, updatedAt: Date.now() }, ...rest];
}

export function newProgramId() {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** The unsaved work in the editor, restored on the next visit. */
export function loadDraft() {
  const d = read(DRAFT_KEY, null);
  return d && typeof d.source === 'string' ? d : null;
}

export function saveDraft(draft) {
  return write(DRAFT_KEY, draft);
}

export function uniqueName(list, base = 'My program') {
  const names = new Set(list.map((p) => p.name));
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}
