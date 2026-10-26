// Shared diagnostic contract used by every compiler phase.
//
// Diagnostic = {
//   severity: 'error' | 'warning' | 'info',
//   phase:    'lexical' | 'syntax' | 'semantic' | 'ir' | 'optimization' | 'codegen' | 'execution',
//   code:     short machine-readable identifier, e.g. 'undeclared-variable',
//   message:  human-readable explanation,
//   span:     { start, end, line, col } | null   (character offsets into the source, 1-based line/col)
// }
//
// This module has no dependencies so that engines may import it without creating cycles.

export function makeDiagnostic(severity, phase, code, message, span = null) {
  return { severity, phase, code, message, span: span ? normalizeSpan(span) : null };
}

export const error = (phase, code, message, span) => makeDiagnostic('error', phase, code, message, span);
export const warning = (phase, code, message, span) => makeDiagnostic('warning', phase, code, message, span);

export function normalizeSpan(span) {
  return { start: span.start, end: span.end, line: span.line, col: span.col };
}

/** Smallest span covering both `a` and `b`. */
export function joinSpans(a, b) {
  if (!a) return b;
  if (!b) return a;
  const first = a.start <= b.start ? a : b;
  return { start: first.start, end: Math.max(a.end, b.end), line: first.line, col: first.col };
}

export function hasErrors(diagnostics) {
  return diagnostics.some((d) => d.severity === 'error');
}

export function formatDiagnostic(d) {
  const where = d.span ? `${d.span.line}:${d.span.col} ` : '';
  return `${where}${d.severity} [${d.phase}] ${d.message}`;
}
