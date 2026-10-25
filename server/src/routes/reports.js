import { Router } from 'express';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { TIMEZONE } from '../lib/settings.js';
import { toCsv } from '../lib/csv.js';

const r = Router();
r.use(requireAuth, requireRole('MANAGER'));

const TZ = sql.raw(`'${TIMEZONE}'`);
const day = (col) => sql`(${col} AT TIME ZONE ${TZ})::date`;
const n = (v) => Number(v ?? 0);
const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date());
const addDays = (s, d) => { const t = new Date(`${s}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };
const dateRe = /^\d{4}-\d{2}-\d{2}$/;

function range(req) {
  const q = z.object({ from: z.string().regex(dateRe).optional(), to: z.string().regex(dateRe).optional(), format: z.enum(['json', 'csv']).default('json') }).parse(req.query);
  const to = q.to ?? todayStr();
  const from = q.from ?? to;
  return { from, to: to < from ? from : to, format: q.format };
}
const rows = async (q) => (await db.execute(q)).rows;
const rupees = (p) => (n(p) / 100).toFixed(2);

// Definitions used everywhere (see README "Money definitions"):
//   totalCollected = sum of order totals of PAID orders;  tax = tax inside those totals;  discounts = discounts given
//   netSales = totalCollected - tax (sales excluding tax, after discounts);  grossSales = netSales + discounts
async function summary(from, to) {
  const [s] = await rows(sql`select count(*)::int as orders, coalesce(sum(total_paise),0)::bigint as total, coalesce(sum(tax_paise),0)::bigint as tax,
    coalesce(sum(discount_paise),0)::bigint as discount from orders
    where payment_status = 'PAID' and ${day(sql`completed_at`)} between ${from}::date and ${to}::date`);
  const [rf] = await rows(sql`select count(*)::int as count, coalesce(sum(amount_paise),0)::bigint as amount,
    coalesce(sum(amount_paise) filter (where status = 'REFUNDED'),0)::bigint as refunded, coalesce(sum(amount_paise) filter (where status = 'VOID'),0)::bigint as voided
    from payments where status in ('REFUNDED','VOID') and ${day(sql`refunded_at`)} between ${from}::date and ${to}::date`);
  const total = n(s.total), tax = n(s.tax), discount = n(s.discount);
  return {
    from, to, orders: s.orders, totalCollectedPaise: total, taxPaise: tax, discountPaise: discount,
    netSalesPaise: total - tax, grossSalesPaise: total - tax + discount,
    avgOrderValuePaise: s.orders ? Math.round(total / s.orders) : 0,
    refundsPaise: n(rf.amount), refundedPaise: n(rf.refunded), voidedPaise: n(rf.voided), refundCount: rf.count,
    netAfterRefundsPaise: total - tax - n(rf.amount),
  };
}

async function daily(from, to) {
  const data = await rows(sql`select ${day(sql`completed_at`)}::text as d, count(*)::int as orders, coalesce(sum(total_paise),0)::bigint as total,
    coalesce(sum(tax_paise),0)::bigint as tax, coalesce(sum(discount_paise),0)::bigint as discount from orders
    where payment_status = 'PAID' and ${day(sql`completed_at`)} between ${from}::date and ${to}::date group by 1`);
  const byDay = new Map(data.map((x) => [x.d, x]));
  const out = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) {
    const x = byDay.get(d);
    out.push({ date: d, orders: x?.orders ?? 0, totalCollectedPaise: n(x?.total), taxPaise: n(x?.tax), discountPaise: n(x?.discount), netSalesPaise: n(x?.total) - n(x?.tax) });
  }
  return out;
}

const payments = (from, to) => rows(sql`select method, count(*)::int as count, coalesce(sum(amount_paise),0)::bigint as amount from payments
  where status = 'SUCCESS' and ${day(sql`created_at`)} between ${from}::date and ${to}::date group by method order by amount desc`)
  .then((x) => x.map((p) => ({ method: p.method, count: p.count, amountPaise: n(p.amount) })));

const items = (from, to, limit = 500) => rows(sql`select oi.name, sum(oi.quantity)::int as qty, coalesce(sum(oi.line_total_paise - oi.line_tax_paise),0)::bigint as net,
  coalesce(sum(oi.line_discount_paise),0)::bigint as discount, coalesce(sum(oi.line_tax_paise),0)::bigint as tax
  from order_items oi join orders o on o.id = oi.order_id where o.payment_status = 'PAID' and ${day(sql`o.completed_at`)} between ${from}::date and ${to}::date
  group by oi.name order by qty desc, net desc limit ${limit}`)
  .then((x) => x.map((i) => ({ name: i.name, quantity: i.qty, netSalesPaise: n(i.net), discountPaise: n(i.discount), taxPaise: n(i.tax) })));

function send(res, format, name, data, columns) {
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
    return res.send(toCsv(data, columns));
  }
  return res.json(data);
}

r.get('/dashboard', async (_req, res) => {
  const today = todayStr();
  const [sum, trend, top, low, recent, types] = await Promise.all([
    summary(today, today), daily(addDays(today, -6), today), items(addDays(today, -6), today, 5),
    rows(sql`select id, name, unit, stock_qty as "stockQty", min_stock_qty as "minStockQty" from ingredients where stock_qty <= min_stock_qty order by name`),
    rows(sql`select o.id, o.order_number as "orderNumber", o.type, o.status, o.kitchen_status as "kitchenStatus", o.payment_status as "paymentStatus",
      o.total_paise as "totalPaise", o.created_at as "createdAt", t.name as "tableName", o.is_demo as "isDemo" from orders o left join dining_tables t on t.id = o.table_id
      order by o.created_at desc limit 8`),
    rows(sql`select type, count(*)::int as count from orders where status <> 'CANCELLED' and ${day(sql`created_at`)} = ${today}::date group by type`),
  ]);
  const typeCounts = { DINE_IN: 0, TAKEAWAY: 0, DELIVERY: 0 };
  for (const t of types) typeCounts[t.type] = t.count;
  const [pay] = await Promise.all([payments(today, today)]);
  res.json({
    today: sum, totalOrdersToday: Object.values(typeCounts).reduce((a, b) => a + b, 0), typeCounts, trend, topItems: top, payments: pay,
    lowStock: low.map((l) => ({ ...l, stockQty: n(l.stockQty), minStockQty: n(l.minStockQty) })), recentOrders: recent,
  });
});

r.get('/sales', async (req, res) => {
  const { from, to, format } = range(req);
  const [sum, days, pay] = await Promise.all([summary(from, to), daily(from, to), payments(from, to)]);
  if (format === 'csv') {
    return send(res, 'csv', `sales_${from}_to_${to}`, days, [
      { label: 'Date', key: 'date' }, { label: 'Orders', key: 'orders' },
      { label: 'Gross sales (INR)', get: (d) => rupees(d.netSalesPaise + d.discountPaise) }, { label: 'Discounts (INR)', get: (d) => rupees(d.discountPaise) },
      { label: 'Net sales (INR)', get: (d) => rupees(d.netSalesPaise) }, { label: 'Tax collected (INR)', get: (d) => rupees(d.taxPaise) },
      { label: 'Total collected (INR)', get: (d) => rupees(d.totalCollectedPaise) },
    ]);
  }
  res.json({ summary: sum, daily: days, payments: pay });
});

r.get('/payments', async (req, res) => {
  const { from, to, format } = range(req);
  send(res, format, `payments_${from}_to_${to}`, await payments(from, to), [{ label: 'Method', key: 'method' }, { label: 'Payments', key: 'count' }, { label: 'Amount (INR)', get: (p) => rupees(p.amountPaise) }]);
});

r.get('/items', async (req, res) => {
  const { from, to, format } = range(req);
  send(res, format, `items_${from}_to_${to}`, await items(from, to), [
    { label: 'Item', key: 'name' }, { label: 'Quantity sold', key: 'quantity' }, { label: 'Net sales (INR)', get: (i) => rupees(i.netSalesPaise) },
    { label: 'Discounts (INR)', get: (i) => rupees(i.discountPaise) }, { label: 'Tax (INR)', get: (i) => rupees(i.taxPaise) },
  ]);
});

r.get('/categories', async (req, res) => {
  const { from, to, format } = range(req);
  const data = (await rows(sql`select coalesce(c.name, 'Uncategorised') as name, sum(oi.quantity)::int as qty, coalesce(sum(oi.line_total_paise - oi.line_tax_paise),0)::bigint as net
    from order_items oi join orders o on o.id = oi.order_id left join menu_items mi on mi.id = oi.menu_item_id left join categories c on c.id = mi.category_id
    where o.payment_status = 'PAID' and ${day(sql`o.completed_at`)} between ${from}::date and ${to}::date group by 1 order by net desc`))
    .map((c) => ({ name: c.name, quantity: c.qty, netSalesPaise: n(c.net) }));
  send(res, format, `categories_${from}_to_${to}`, data, [{ label: 'Category', key: 'name' }, { label: 'Quantity sold', key: 'quantity' }, { label: 'Net sales (INR)', get: (c) => rupees(c.netSalesPaise) }]);
});

r.get('/cancellations', async (req, res) => {
  const { from, to, format } = range(req);
  const data = (await rows(sql`select o.order_number as "orderNumber", o.created_at as "createdAt", o.type, o.total_paise as "totalPaise", o.kitchen_status as "kitchenStatus",
    o.cancel_reason as reason, u.name as "cancelledBy" from orders o
    left join audit_logs a on a.action = 'ORDER_CANCEL' and a.entity_id = o.id::text left join users u on u.id = a.user_id
    where o.status = 'CANCELLED' and ${day(sql`o.created_at`)} between ${from}::date and ${to}::date order by o.created_at desc`))
    .map((c) => ({ ...c, totalPaise: n(c.totalPaise) }));
  send(res, format, `cancellations_${from}_to_${to}`, data, [
    { label: 'Order', key: 'orderNumber' }, { label: 'Created', key: 'createdAt' }, { label: 'Type', key: 'type' }, { label: 'Value (INR)', get: (c) => rupees(c.totalPaise) },
    { label: 'Kitchen status when cancelled', key: 'kitchenStatus' }, { label: 'Reason', key: 'reason' }, { label: 'Cancelled by', key: 'cancelledBy' },
  ]);
});

r.get('/stock', async (req, res) => {
  const { from, to, format } = range(req);
  const movements = (await rows(sql`select m.created_at as "createdAt", i.name as ingredient, i.unit, m.type, m.quantity, m.reason, u.name as "by" from stock_movements m
    join ingredients i on i.id = m.ingredient_id left join users u on u.id = m.created_by
    where ${day(sql`m.created_at`)} between ${from}::date and ${to}::date order by m.created_at desc, m.id desc limit 2000`)).map((m) => ({ ...m, quantity: n(m.quantity) }));
  if (format === 'csv') {
    return send(res, 'csv', `stock_movements_${from}_to_${to}`, movements, [
      { label: 'Time', key: 'createdAt' }, { label: 'Ingredient', key: 'ingredient' }, { label: 'Unit', key: 'unit' }, { label: 'Type', key: 'type' },
      { label: 'Quantity (signed)', key: 'quantity' }, { label: 'Reason', key: 'reason' }, { label: 'By', key: 'by' },
    ]);
  }
  const stock = (await rows(sql`select name, unit, stock_qty as "stockQty", min_stock_qty as "minStockQty", cost_per_unit_paise as "costPerUnitPaise" from ingredients order by name`))
    .map((i) => ({ ...i, stockQty: n(i.stockQty), minStockQty: n(i.minStockQty), low: n(i.stockQty) <= n(i.minStockQty) }));
  res.json({ stock, movements });
});

export default r;
