import { useEffect, useRef, useState, type ReactNode } from 'react';
import { formatClock, formatLapMs, parseClock, parseLapTime } from '../engine/format';
import type { Confidence } from '../engine/types';
import { IconX } from './icons';

export function Panel({
  title,
  meta,
  accent,
  className = '',
  bodyClass = '',
  children,
  scroll,
  id,
}: {
  title?: ReactNode;
  meta?: ReactNode;
  accent?: 'green' | 'amber' | 'red' | 'blue' | 'violet';
  className?: string;
  bodyClass?: string;
  children?: ReactNode;
  scroll?: boolean;
  id?: string;
}) {
  return (
    <section id={id} className={`panel ${accent ? `accent-${accent}` : ''} ${scroll ? 'scroll' : ''} ${className}`}>
      {(title || meta) && (
        <header className="panel-h">
          {typeof title === 'string' ? <span className="label">{title}</span> : title}
          {meta && <div className="meta">{meta}</div>}
        </header>
      )}
      <div className={`panel-b ${bodyClass}`}>{children}</div>
    </section>
  );
}

export function Stat({
  k,
  v,
  u,
  h,
  size,
  color,
  className = '',
  title,
}: {
  k: ReactNode;
  v: ReactNode;
  u?: ReactNode;
  h?: ReactNode;
  size?: 'sm' | 'lg' | 'xl';
  color?: 'green' | 'amber' | 'red' | 'blue' | 'violet';
  className?: string;
  title?: string;
}) {
  return (
    <div className={`stat ${size ?? ''} ${className}`} title={title}>
      <span className="k">{k}</span>
      <span className={`v ${color ? `c-${color}` : ''}`}>
        {v}
        {u && <span className="u">{u}</span>}
      </span>
      {h && <span className="h">{h}</span>}
    </div>
  );
}

export function Badge({ children, color, size, solid, className = '', title, dot }: { children: ReactNode; color?: 'green' | 'amber' | 'red' | 'blue' | 'violet'; size?: 'sm' | 'lg'; solid?: boolean; className?: string; title?: string; dot?: boolean }) {
  return (
    <span className={`badge ${color ?? ''} ${size ?? ''} ${solid ? 'solid' : ''} ${className}`} title={title}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}

export function SampleBadge() {
  return (
    <span className="badge sample sm" title="Values are illustrative SAMPLE DATA — not authoritative LMU physics">
      Sample data
    </span>
  );
}

export function ConfidenceBadge({ c, basis }: { c: Confidence; basis?: string }) {
  const color = c === 'HIGH' ? 'green' : c === 'MEDIUM' ? 'amber' : 'red';
  return (
    <span className={`badge sm ${color} ghost`} title={basis ? `Based on: ${basis}` : undefined}>
      {c} CONF
    </span>
  );
}

export function Modal({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal>
        <div className="modal-h">
          {typeof title === 'string' ? <h3>{title}</h3> : title}
          <button className="btn ghost icon sm" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close">
            <IconX size={14} />
          </button>
        </div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * Labelled form row. Use `group` when the field holds several controls (segmented
 * buttons, checkbox + select …): a <label> would forward clicks to the first one.
 */
export function Field({ label, hint, children, right, className = '', group }: { label: ReactNode; hint?: ReactNode; children: ReactNode; right?: ReactNode; className?: string; group?: boolean }) {
  const head = (
    <span className="label">
      <span>{label}</span>
      {right}
    </span>
  );
  if (group)
    return (
      <div className={`field ${className}`} role="group" aria-label={typeof label === 'string' ? label : undefined}>
        {head}
        {children}
        {hint && <span className="hint">{hint}</span>}
      </div>
    );
  return (
    <label className={`field ${className}`}>
      {head}
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

/** Numeric input that keeps a free-typing draft and commits on blur / Enter. */
export function NumInput({
  value,
  onChange,
  unit,
  decimals = 2,
  step = 1,
  min,
  max,
  className = '',
  placeholder,
  size,
  disabled,
  autoFocus,
  onClear,
}: {
  value: number | null | undefined;
  onChange: (v: number) => void;
  /** Called when the field is emptied; without it an empty field reverts. */
  onClear?: () => void;
  unit?: string;
  decimals?: number;
  step?: number;
  min?: number;
  max?: number;
  className?: string;
  placeholder?: string;
  size?: 'sm' | 'lg';
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const fmt = (v: number | null | undefined) => (v == null || !isFinite(v) ? '' : String(Number(v.toFixed(decimals))));
  const [draft, setDraft] = useState(fmt(value));
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    if (!focus) setDraft(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focus]);
  const commit = () => {
    const n = Number(draft.replace(',', '.'));
    if (draft.trim() === '' && onClear) {
      if (value != null) onClear();
      return;
    }
    if (draft.trim() === '' || !isFinite(n)) {
      setDraft(fmt(value));
      return;
    }
    let v = n;
    if (min != null) v = Math.max(min, v);
    if (max != null) v = Math.min(max, v);
    if (v !== value) onChange(v);
    setDraft(fmt(v));
  };
  const input = (
    <input
      className={`input num ${size ?? ''} ${className}`}
      value={draft}
      inputMode="decimal"
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      onFocus={(e) => {
        setFocus(true);
        e.currentTarget.select();
      }}
      onBlur={() => {
        setFocus(false);
        commit();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const n = Number(draft) || 0;
          const v = n + (e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1);
          setDraft(fmt(v));
          onChange(v);
        }
      }}
    />
  );
  if (!unit) return input;
  return (
    <span className="input-wrap">
      {input}
      <span className="unit">{unit}</span>
    </span>
  );
}

export function LapTimeInput({ value, onChange, onClear, className = '', size }: { value: number | null | undefined; onChange: (ms: number) => void; onClear?: () => void; className?: string; size?: 'sm' | 'lg' }) {
  const [draft, setDraft] = useState(value ? formatLapMs(value) : '');
  const [focus, setFocus] = useState(false);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    if (!focus) setDraft(value ? formatLapMs(value) : '');
  }, [value, focus]);
  return (
    <input
      className={`input num ${size ?? ''} ${bad ? 'invalid' : ''} ${className}`}
      value={draft}
      placeholder="m:ss.sss"
      onFocus={(e) => {
        setFocus(true);
        e.currentTarget.select();
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        setBad(false);
      }}
      onBlur={() => {
        setFocus(false);
        if (draft.trim() === '' && onClear) {
          if (value != null) onClear();
          return;
        }
        const ms = parseLapTime(draft);
        if (ms == null) {
          setBad(draft.trim() !== '');
          return;
        }
        if (ms !== value) onChange(ms);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
    />
  );
}

export function ClockInput({ value, onChange, className = '' }: { value: number; onChange: (s: number) => void; className?: string }) {
  const [draft, setDraft] = useState(formatClock(value));
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    if (!focus) setDraft(formatClock(value));
  }, [value, focus]);
  return (
    <input
      className={`input num ${className}`}
      value={draft}
      placeholder="h:mm:ss"
      onFocus={(e) => {
        setFocus(true);
        e.currentTarget.select();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setFocus(false);
        const s = parseClock(draft);
        if (s != null && s !== value) onChange(s);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
    />
  );
}

export function Seg<T extends string | number>({ options, value, onChange, className = '' }: { options: { value: T; label: ReactNode; title?: string }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={`seg ${className}`} role="group">
      {options.map((o) => (
        <button key={String(o.value)} type="button" title={o.title} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Bar({ pct, color, marks = [], size, title }: { pct: number; color?: 'green' | 'amber' | 'red' | 'blue' | 'violet'; marks?: number[]; size?: 'lg'; title?: string }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div className={`bar ${color ?? ''} ${size ?? ''}`} title={title}>
      <i style={{ width: `${p}%` }} />
      {marks.map((m, i) => (
        <span key={i} className="mark" style={{ left: `${Math.max(0, Math.min(100, m))}%` }} />
      ))}
    </div>
  );
}

export function useOutside<T extends HTMLElement>(onOut: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOut();
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onOut]);
  return ref;
}

export function Logo({ size = 22, word = true }: { size?: number; word?: boolean }) {
  return (
    <span className="logo" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <svg width={size * 1.45} height={size} viewBox="0 0 32 22" aria-hidden>
        <rect x="0" y="8" width="12" height="6" fill="var(--text)" />
        <rect x="15" y="8" width="8" height="6" fill="var(--text)" />
        <rect x="26" y="8" width="6" height="6" fill="var(--amber)" />
        <rect x="13" y="3" width="1.4" height="16" fill="var(--amber)" />
        <rect x="24.2" y="3" width="1.4" height="16" fill="var(--amber)" />
      </svg>
      {word && (
        <span style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: size * 0.95, letterSpacing: '0.2em', lineHeight: 1 }}>
          STINT
        </span>
      )}
    </span>
  );
}

export function Toasts({ toasts, onDismiss }: { toasts: { id: string; text: string; level: string }[]; onDismiss: (id: string) => void }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.level}`} onClick={() => onDismiss(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
