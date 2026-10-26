// Parsing of the Studio's "program input" text box.

/** Parse "3, -4 7" into integers; returns { values } or { error }. */
export function parseInputs(text) {
  const parts = text.split(/[\s,]+/).filter(Boolean);
  const values = [];
  for (const p of parts) {
    if (!/^-?\d+$/.test(p)) return { error: `'${p}' is not an integer.` };
    const v = Number(p);
    if (v > 2147483647 || v < -2147483648) return { error: `${p} does not fit in a 32-bit int.` };
    values.push(v);
  }
  return { values };
}
