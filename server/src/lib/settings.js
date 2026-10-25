import { db, settings } from '../db/index.js';

export const TIMEZONE = 'Asia/Kolkata';

export const defaultSettings = {
  cafeName: 'CafeFlow Demo Cafe',
  address: '12, Church Street, Bengaluru 560001',
  phone: '+91 80 0000 0000',
  receiptFooter: 'Thank you! Visit again.',
  currency: 'INR',
  taxInclusive: false,
  defaultTaxRateBp: 500,
  maxDiscountPercentCashier: 10,
  loyaltyEnabled: true,
  loyaltyPointsPer100Rupees: 1,
};

export async function getSettings(dbOrTx = db) {
  const rows = await dbOrTx.select().from(settings);
  const s = { ...defaultSettings };
  for (const r of rows) s[r.key] = r.value;
  return s;
}

// YYYYMMDD in the cafe's timezone (used in order / receipt / KOT numbers).
export function ymd(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(d).replaceAll('-', '');
}
