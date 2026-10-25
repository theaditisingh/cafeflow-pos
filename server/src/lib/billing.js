// Pure billing calculations. All amounts are integer paise; rates/percentages are basis points.

export function apportion(total, weights) {
  // Largest-remainder split so parts always sum exactly to total.
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0 || total === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const parts = raw.map(Math.floor);
  let left = total - parts.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k++, left--) parts[order[k % order.length][1]]++;
  return parts;
}

export function computeTotals(items, { discountType = null, discountValue = 0, taxInclusive = false } = {}) {
  const subs = items.map((i) => i.unitPricePaise * i.quantity);
  const subtotal = subs.reduce((a, b) => a + b, 0);

  let discount = 0;
  if (discountType === 'PERCENT') discount = Math.round((subtotal * discountValue) / 10000);
  else if (discountType === 'FLAT') discount = discountValue;
  discount = Math.min(Math.max(discount, 0), subtotal);

  const lineDiscounts = apportion(discount, subs);
  const lines = items.map((item, idx) => {
    const net = subs[idx] - lineDiscounts[idx];
    const tax = taxInclusive
      ? Math.round((net * item.taxRateBp) / (10000 + item.taxRateBp))
      : Math.round((net * item.taxRateBp) / 10000);
    const total = taxInclusive ? net : net + tax;
    return { lineSubtotalPaise: subs[idx], lineDiscountPaise: lineDiscounts[idx], lineTaxPaise: tax, lineTotalPaise: total };
  });

  const tax = lines.reduce((a, l) => a + l.lineTaxPaise, 0);
  const total = lines.reduce((a, l) => a + l.lineTotalPaise, 0);
  return { lines, subtotalPaise: subtotal, discountPaise: discount, taxPaise: tax, totalPaise: total };
}

export function cashChange(totalPaise, receivedPaise) {
  if (receivedPaise < totalPaise) throw new Error('Cash received is less than the amount payable');
  return receivedPaise - totalPaise;
}
