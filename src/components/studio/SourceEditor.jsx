// Plain-textarea source editor with a line-number gutter. Lines containing errors or
// warnings are marked in the gutter. The parent can select a span via `ref.revealSpan`.
import React, { useImperativeHandle, useRef } from 'react';

export function SourceEditor({ value, onChange, onSubmit, diagnostics = [], ref, label = 'Source code' }) {
  const textRef = useRef(null);
  const gutterRef = useRef(null);

  useImperativeHandle(ref, () => ({
    revealSpan(span) {
      const el = textRef.current;
      if (!el || !span) return;
      el.focus();
      el.setSelectionRange(span.start, Math.max(span.end, span.start + 1));
      // Scroll the selected line into view (approximate: line height is fixed).
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 21;
      el.scrollTop = Math.max(0, (span.line - 3) * lineHeight);
    },
  }));

  const lineCount = value.split('\n').length;
  const errorLines = new Set(diagnostics.filter((d) => d.severity === 'error' && d.span).map((d) => d.span.line));
  const warnLines = new Set(diagnostics.filter((d) => d.severity === 'warning' && d.span).map((d) => d.span.line));

  const onKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      onSubmit?.();
      return;
    }
    // Tab inserts two spaces; Shift+Tab / Escape leave the editor for keyboard users.
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: s, selectionEnd: t } = el;
      const next = `${value.slice(0, s)}  ${value.slice(t)}`;
      onChange(next);
      requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
    }
  };

  return (
    <div className="editor-wrap">
      <div className="editor-gutter" ref={gutterRef} aria-hidden="true">
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i} className={errorLines.has(i + 1) ? 'err-line' : warnLines.has(i + 1) ? 'warn-line' : undefined}>
            {errorLines.has(i + 1) ? `● ${i + 1}` : i + 1}
          </div>
        ))}
      </div>
      <textarea
        ref={textRef}
        className="editor-text"
        value={value}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label={`${label} (Ctrl+Enter compiles; Tab indents, Shift+Tab leaves the editor)`}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onScroll={(e) => {
          if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
        }}
        rows={16}
      />
    </div>
  );
}
