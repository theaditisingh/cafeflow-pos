import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { X, Loader2, CheckCircle2, AlertTriangle, Inbox } from 'lucide-react';

export const cx = (...a) => a.filter(Boolean).join(' ');

export const inr = (paise, { compact = false } = {}) => {
  const v = (paise ?? 0) / 100;
  const whole = Number.isInteger(v);
  return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: compact && whole ? 0 : 2, maximumFractionDigits: 2 });
};
const TZ = 'Asia/Kolkata';
export const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '—');
export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ }) : '—');
export const fmtDateTime = (d) => (d ? `${fmtDate(d)}, ${fmtTime(d)}` : '—');
export const fmtDuration = (s) => (s == null ? '—' : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`);
export const istToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
export const istDaysAgo = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(Date.now() - n * 86400000));
export const titleCase = (s) => (s ?? '').toLowerCase().split('_').map((w) => w[0]?.toUpperCase() + w.slice(1)).join(' ');

// ---------- Buttons & form controls
const BTN = {
  primary: 'bg-terra text-white shadow-sm shadow-terra/25 hover:bg-terra-d active:shadow-none disabled:bg-terra/50 disabled:shadow-none',
  secondary: 'bg-white text-ink border border-line shadow-sm shadow-black/[0.04] hover:bg-cream-2 hover:border-line active:shadow-none disabled:text-ink-3',
  green: 'bg-sage text-white shadow-sm shadow-sage/25 hover:bg-sage-d active:shadow-none disabled:bg-sage/50 disabled:shadow-none',
  danger: 'bg-rose text-white shadow-sm shadow-rose/25 hover:bg-rose/90 active:shadow-none disabled:bg-rose/50 disabled:shadow-none',
  ghost: 'text-ink-2 hover:bg-cream-2 disabled:text-ink-3',
};
export function Button({ variant = 'secondary', size = 'md', loading, className, children, ...p }) {
  return (
    <button {...p} disabled={p.disabled || loading}
      className={cx('inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all duration-150 active:scale-[0.97]', size === 'sm' ? 'px-2.5 py-1.5 text-xs' : size === 'lg' ? 'px-5 py-3 text-base' : 'px-3.5 py-2 text-sm', BTN[variant], className)}>
      {loading && <Loader2 size={15} className="animate-spin" />}{children}
    </button>
  );
}
export const inputCls = 'w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink shadow-sm shadow-black/[0.03] placeholder:text-ink-3 transition-[border-color,box-shadow] duration-150 focus:border-terra focus:ring-2 focus:ring-terra/10 focus:outline-none';
export const Input = (p) => <input {...p} className={cx(inputCls, p.className)} />;
export const Select = ({ children, ...p }) => <select {...p} className={cx(inputCls, p.className)}>{children}</select>;
export const Textarea = (p) => <textarea {...p} className={cx(inputCls, p.className)} />;
export function Field({ label, hint, error, children, className }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 block text-xs font-semibold tracking-wide text-ink-2">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-rose">{error}</span>}
    </label>
  );
}
export const Card = ({ className, children, ...p }) => <div {...p} className={cx('rounded-xl border border-line bg-white shadow-sm shadow-black/[0.04]', className)}>{children}</div>;

// ---------- Status badges
const TONES = {
  gray: 'bg-cream-2 text-ink-2', green: 'bg-sage-l text-sage-d', amber: 'bg-amber-l text-amber-d', red: 'bg-rose-l text-rose', blue: 'bg-sky-l text-sky', terra: 'bg-terra-l text-terra-d',
};
export const Badge = ({ tone = 'gray', children, className }) => <span className={cx('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', TONES[tone], className)}>{children}</span>;
const MAPS = {
  order: { OPEN: ['gray', 'Open'], CONFIRMED: ['blue', 'In progress'], COMPLETED: ['green', 'Completed'], CANCELLED: ['red', 'Cancelled'] },
  payment: { UNPAID: ['amber', 'Unpaid'], PAID: ['green', 'Paid'], REFUNDED: ['red', 'Refunded'], VOID: ['gray', 'Void'] },
  kitchen: { NOT_SENT: ['gray', 'Not sent'], NEW: ['blue', 'New'], PREPARING: ['amber', 'Preparing'], READY: ['green', 'Ready'], SERVED: ['gray', 'Served'] },
  table: { AVAILABLE: ['green', 'Available'], OCCUPIED: ['terra', 'Occupied'], RESERVED: ['blue', 'Reserved'], CLEANING: ['amber', 'Cleaning'] },
  type: { DINE_IN: ['gray', 'Dine-in'], TAKEAWAY: ['gray', 'Takeaway'], DELIVERY: ['gray', 'Delivery'] },
};
export const StatusBadge = ({ kind, value }) => { const [tone, label] = MAPS[kind][value] ?? ['gray', value]; return <Badge tone={tone}>{label}</Badge>; };
export const DemoTag = () => <span className="rounded border border-amber-d/30 bg-amber-l px-1 text-[10px] font-semibold uppercase tracking-wide text-amber-d">Demo</span>;

export const VegDot = ({ veg }) => (
  <span title={veg ? 'Vegetarian' : 'Non-vegetarian'} className={cx('inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border-2 bg-white', veg ? 'border-sage' : 'border-rose')}>
    <span className={cx('h-2 w-2 rounded-full', veg ? 'bg-sage' : 'bg-rose')} />
  </span>
);

// ---------- States
export const Spinner = ({ label = 'Loading…' }) => <div className="flex items-center justify-center gap-2 p-10 text-ink-3"><Loader2 className="animate-spin" size={18} />{label}</div>;
export const Empty = ({ title, hint, icon: Icon = Inbox, children }) => (
  <div className="flex flex-col items-center justify-center gap-1 p-10 text-center"><Icon size={28} className="text-ink-3" /><div className="font-medium text-ink-2">{title}</div>{hint && <div className="max-w-sm text-xs text-ink-3">{hint}</div>}{children}</div>
);
export const ErrorBox = ({ error, onRetry }) => (
  <div className="m-4 flex items-start gap-3 rounded-lg border border-rose/30 bg-rose-l p-3 text-sm text-rose"><AlertTriangle size={18} className="mt-0.5 shrink-0" />
    <div className="flex-1">{error?.message ?? String(error)}</div>{onRetry && <Button size="sm" onClick={onRetry}>Retry</Button>}</div>
);

// ---------- Modal
export function Modal({ title, onClose, children, footer, wide, size }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="anim-backdrop fixed inset-0 z-50 flex items-end justify-center bg-ink/40 backdrop-blur-[2px] p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={cx('anim-slide flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-cream shadow-2xl sm:rounded-2xl', size === 'lg' ? 'sm:max-w-3xl' : wide ? 'sm:max-w-xl' : 'sm:max-w-md')}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5"><h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-cream-2 hover:text-ink"><X size={18} /></button></div>
        <div className="overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- Toasts & confirmation dialog
const UiCtx = createContext(null);
export const useUi = () => useContext(UiCtx);

export function UiProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);
  const id = useRef(0);
  const toast = useCallback((message, type = 'success') => {
    const n = ++id.current;
    setToasts((t) => [...t, { n, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.n !== n)), type === 'error' ? 6000 : 3000);
  }, []);
  // confirm({title, message, confirmLabel, danger, reason: true|{label,min}}) -> resolves to true / reason string / false
  const confirm = useCallback((opts) => new Promise((resolve) => setDialog({ opts, resolve })), []);
  const done = (v) => { dialog.resolve(v); setDialog(null); };
  return (
    <UiCtx.Provider value={{ toast, confirm }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.n} className={cx('anim-toast pointer-events-auto flex max-w-sm items-start gap-2 rounded-xl px-4 py-3 text-sm shadow-lg', t.type === 'error' ? 'bg-rose text-white' : 'bg-ink text-white')}>
            {t.type === 'error' ? <AlertTriangle size={16} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-sage-l" />}{t.message}</div>
        ))}
      </div>
      {dialog && <ConfirmDialog {...dialog.opts} onCancel={() => done(false)} onConfirm={done} />}
    </UiCtx.Provider>
  );
}
function ConfirmDialog({ title, message, confirmLabel = 'Confirm', danger, reason, onCancel, onConfirm }) {
  const [text, setText] = useState('');
  const min = reason ? (reason.min ?? 3) : 0;
  const ok = !reason || text.trim().length >= min;
  return (
    <Modal title={title} onClose={onCancel} footer={<><Button onClick={onCancel}>Keep as is</Button><Button variant={danger ? 'danger' : 'primary'} disabled={!ok} onClick={() => onConfirm(reason ? text.trim() : true)}>{confirmLabel}</Button></>}>
      {message && <p className="mb-3 text-sm text-ink-2">{message}</p>}
      {reason && <Field label={reason.label ?? 'Reason (kept in the audit log)'}><Textarea autoFocus rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Enter a short reason" /></Field>}
    </Modal>
  );
}

// ---------- Data hooks
export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const run = useCallback(async (silent) => {
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
    try { setState({ data: await fn(), error: null, loading: false }); }
    catch (error) { setState((s) => ({ data: silent ? s.data : null, error, loading: false })); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(false); }, [run]);
  return { ...state, reload: () => run(false), refresh: () => run(true), setData: (data) => setState((s) => ({ ...s, data })) };
}
// Polls `refresh` while the tab is visible (used by KDS / floor plan / dashboard for live sync)
export function usePoll(refresh, ms) {
  const ref = useRef(refresh);
  ref.current = refresh;
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) ref.current(); }, ms);
    return () => clearInterval(t);
  }, [ms]);
}

export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-xl font-bold tracking-tight">{title}</h1>{subtitle && <p className="mt-0.5 text-sm text-ink-3">{subtitle}</p>}</div><div className="flex flex-wrap gap-2">{actions}</div></div>
  );
}
export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
      {tabs.map(([k, label]) => (
        <button key={k} role="tab" aria-selected={value === k} onClick={() => onChange(k)}
          className={cx('whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors', value === k ? 'border-terra text-terra' : 'border-transparent text-ink-3 hover:text-ink')}>{label}</button>
      ))}
    </div>
  );
}
export const Table = ({ children }) => <div className="overflow-x-auto"><table className="w-full text-left text-sm">{children}</table></div>;
export const Th = ({ children, right }) => <th className={cx('border-b border-line bg-cream-2/50 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3', right && 'text-right')}>{children}</th>;
export const Td = ({ children, right, className }) => <td className={cx('border-b border-line/60 px-3 py-3', right && 'text-right tnum', className)}>{children}</td>;
