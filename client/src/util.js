// Rupee text <-> paise helpers (all money on the wire is integer paise).
export const toPaise = (v) => {
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
export const fromPaise = (p) => (p == null ? '' : String((p / 100).toFixed(2)).replace(/\.00$/, ''));
export const bpToPercent = (bp) => (bp == null ? '' : String(bp / 100));
export const percentToBp = (v) => Math.round(Number(v) * 100);
export const qs = (obj) => new URLSearchParams(Object.entries(obj).filter(([, v]) => v !== '' && v != null)).toString();
