import { describe, it, expect } from 'vitest';
import { computeTotals, apportion, cashChange } from '../src/lib/billing.js';

const item = (unitPricePaise, quantity, taxRateBp = 500) => ({ unitPricePaise, quantity, taxRateBp });

describe('computeTotals', () => {
  it('computes exclusive GST with no discount', () => {
    const t = computeTotals([item(16000, 2), item(6000, 1)]);
    expect(t.subtotalPaise).toBe(38000);
    expect(t.taxPaise).toBe(1900);
    expect(t.totalPaise).toBe(39900);
  });

  it('applies a percentage discount before tax', () => {
    const t = computeTotals([item(10000, 1)], { discountType: 'PERCENT', discountValue: 1000 }); // 10%
    expect(t.discountPaise).toBe(1000);
    expect(t.taxPaise).toBe(450); // 5% of 9000
    expect(t.totalPaise).toBe(9450);
  });

  it('applies a flat discount and never exceeds the subtotal', () => {
    const t = computeTotals([item(5000, 1)], { discountType: 'FLAT', discountValue: 999999 });
    expect(t.discountPaise).toBe(5000);
    expect(t.totalPaise).toBe(0);
  });

  it('supports tax-inclusive pricing without changing the payable amount', () => {
    const t = computeTotals([item(10500, 1)], { taxInclusive: true });
    expect(t.totalPaise).toBe(10500);
    expect(t.taxPaise).toBe(500);
  });

  it('keeps line discounts summing exactly to the order discount', () => {
    const t = computeTotals([item(3333, 1), item(3333, 1), item(3334, 1)], { discountType: 'FLAT', discountValue: 100 });
    expect(t.lines.reduce((a, l) => a + l.lineDiscountPaise, 0)).toBe(100);
    expect(t.lines.reduce((a, l) => a + l.lineTotalPaise, 0)).toBe(t.totalPaise);
  });

  it('handles mixed tax rates and an empty cart', () => {
    const t = computeTotals([item(10000, 1, 0), item(10000, 1, 1800)]);
    expect(t.taxPaise).toBe(1800);
    expect(computeTotals([]).totalPaise).toBe(0);
  });
});

describe('apportion', () => {
  it('always sums to the total', () => {
    for (const total of [0, 1, 7, 100, 12345]) {
      expect(apportion(total, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(total);
    }
  });
});

describe('cashChange', () => {
  it('returns change and rejects underpayment', () => {
    expect(cashChange(9450, 10000)).toBe(550);
    expect(() => cashChange(9450, 9000)).toThrow();
  });
});
