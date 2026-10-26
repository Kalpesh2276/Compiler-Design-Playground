// Small presentational building blocks shared by the Studio and the Lab.
import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Circle, MinusCircle } from 'lucide-react';

const STATUS_LABEL = {
  success: 'OK',
  warning: 'Warnings',
  error: 'Error',
  skipped: 'Skipped',
  disabled: 'Off',
  pending: 'Not run',
};

export function StatusPill({ status }) {
  const Icon =
    status === 'success' ? CheckCircle2 : status === 'error' ? AlertCircle : status === 'warning' ? AlertTriangle : status === 'disabled' ? MinusCircle : Circle;
  return (
    <span className={`status-pill status-${status}`}>
      <Icon size={11} aria-hidden="true" /> {STATUS_LABEL[status] ?? status}
    </span>
  );
}

/** Accessible tab strip. `tabs` = [{ id, label, icon? }]. */
export function Tabs({ tabs, active, onChange, label }) {
  return (
    <div className="sub-tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => {
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={active === t.id}
            className={active === t.id ? 'sub-tab active' : 'sub-tab'}
            onClick={() => onChange(t.id)}
          >
            {Icon && <Icon size={15} aria-hidden="true" />} {t.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Numbered code listing. `lines` = [{ text, kind?: 'label'|'comment', key?, className? }].
 * `current` = index of the highlighted line (scrolled into view).
 */
export function Listing({ lines, current = -1, numberFrom = 0, showNumbers = true, ariaLabel }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (current < 0 || !ref.current) return;
    const el = ref.current.querySelector('[data-current="true"]');
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [current]);
  let n = numberFrom;
  return (
    <div className="listing" ref={ref} role="region" aria-label={ariaLabel} tabIndex={0}>
      {lines.length === 0 && <div className="listing-line muted">(empty)</div>}
      {lines.map((line, i) => {
        const numbered = showNumbers && line.kind !== 'label' && line.kind !== 'comment';
        const number = numbered ? n++ : '';
        return (
          <div
            key={line.key ?? i}
            data-current={i === current}
            className={`listing-line ${line.kind ? `${line.kind}-line` : ''} ${i === current ? 'current' : ''} ${line.className ?? ''}`}
          >
            <span className="ln">{number}</span>
            <span className="code">{line.text}</span>
          </div>
        );
      })}
    </div>
  );
}

export function Stat({ label, value }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export function Empty({ children }) {
  return <div className="placeholder-text" style={{ padding: 24 }}>{children}</div>;
}

export function DiagnosticList({ diagnostics, onSelect }) {
  if (!diagnostics.length) return null;
  return (
    <ul className="diag-list" aria-label="Diagnostics">
      {diagnostics.map((d, i) => (
        <li key={i}>
          <button className={`diag-item ${d.severity}`} onClick={() => onSelect?.(d)} title={d.span ? 'Show in editor' : undefined}>
            {d.severity === 'error' ? (
              <AlertCircle size={16} className="diag-icon error" aria-label="error" />
            ) : (
              <AlertTriangle size={16} className="diag-icon warning" aria-label="warning" />
            )}
            <span className="diag-loc">{d.span ? `${d.span.line}:${d.span.col}` : '—'}</span>
            <span>
              <strong className="small muted">{d.phase}</strong> {d.message}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
