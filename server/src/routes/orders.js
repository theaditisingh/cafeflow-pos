import { Router } from 'express';
import { z } from 'zod';
import { and, eq, desc, sql, ilike, or } from 'drizzle-orm';
import { db, orders, diningTables } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { TIMEZONE, getSettings } from '../lib/settings.js';
import { audit } from '../lib/audit.js';
import * as svc from '../services/orders.js';

const r = Router();
r.use(requireAuth);
const counter = requireRole('MANAGER', 'CASHIER');
const manager = requireRole('MANAGER');

const cartItem = z.object({
  menuItemId: z.number().int(),
  variantId: z.number().int().nullable().optional(),
  addonIds: z.array(z.number().int()).max(20).optional(),
  quantity: z.number().int().min(1).max(99),
  notes: z.string().max(200).optional(),
});
const orderBody = z.object({
  type: z.enum(['DINE_IN', 'TAKEAWAY', 'DELIVERY']),
  tableId: z.number().int().nullable().optional(),
  customerId: z.number().int().nullable().optional(),
  customerName: z.string().trim().max(100).optional(),
  customerPhone: z.string().trim().regex(/^[0-9+\- ]{7,15}$/, 'Enter a valid phone number').optional().or(z.literal('').transform(() => undefined)),
  discount: z.object({ type: z.enum(['PERCENT', 'FLAT']), value: z.number().int().min(0) }).nullable().optional(),
  notes: z.string().max(300).optional(),
  items: z.array(cartItem).min(1, 'Add at least one item').max(60),
  sendToKitchen: z.boolean().optional(),
});
const payBody = z.object({
  method: z.enum(['CASH', 'UPI', 'CARD']),
  cashReceivedPaise: z.number().int().min(0).optional(),
  reference: z.string().max(60).optional(),
  idempotencyKey: z.string().min(8).max(80).optional(),
});
const reasonBody = z.object({ reason: z.string().trim().min(3, 'A reason is required').max(300) });

const istDate = (col) => sql`(${col} AT TIME ZONE ${sql.raw(`'${TIMEZONE}'`)})::date`;

r.get('/', counter, async (req, res) => {
  const q = z.object({
    q: z.string().optional(), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    type: z.enum(['DINE_IN', 'TAKEAWAY', 'DELIVERY']).optional(), status: z.enum(['OPEN', 'CONFIRMED', 'COMPLETED', 'CANCELLED']).optional(),
    paymentStatus: z.enum(['UNPAID', 'PAID', 'REFUNDED', 'VOID']).optional(), kitchenStatus: z.enum(['NOT_SENT', 'NEW', 'PREPARING', 'READY', 'SERVED']).optional(),
    customerId: z.coerce.number().int().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0),
  }).parse(req.query);
  const w = [];
  if (q.q) { const like = `%${q.q}%`; w.push(or(ilike(orders.orderNumber, like), ilike(orders.receiptNumber, like), ilike(orders.customerName, like), ilike(orders.customerPhone, like))); }
  if (q.from) w.push(sql`${istDate(orders.createdAt)} >= ${q.from}::date`);
  if (q.to) w.push(sql`${istDate(orders.createdAt)} <= ${q.to}::date`);
  for (const k of ['type', 'status', 'paymentStatus', 'kitchenStatus', 'customerId']) if (q[k]) w.push(eq(orders[k], q[k]));
  const where = w.length ? and(...w) : undefined;
  const [rows, [{ n }]] = await Promise.all([
    db.select({ o: orders, tableName: diningTables.name }).from(orders).leftJoin(diningTables, eq(orders.tableId, diningTables.id))
      .where(where).orderBy(desc(orders.createdAt)).limit(q.limit).offset(q.offset),
    db.select({ n: sql`count(*)::int` }).from(orders).where(where),
  ]);
  res.json({ rows: rows.map(({ o, tableName }) => ({ ...o, tableName })), total: n });
});

r.get('/:id', counter, async (req, res) => res.json(await svc.loadOrder(db, +req.params.id)));

r.get('/:id/receipt', counter, async (req, res) => {
  const o = await svc.loadOrder(db, +req.params.id);
  const s = await getSettings();
  if (req.query.reprint === '1') await audit(db, req.user, 'RECEIPT_REPRINT', { entity: 'order', entityId: o.id });
  res.json({
    cafe: { name: s.cafeName, address: s.address, phone: s.phone, footer: s.receiptFooter, taxInclusive: s.taxInclusive },
    order: o, demo: o.isDemo,
  });
});

r.post('/', counter, async (req, res) => {
  const body = orderBody.parse(req.body);
  res.status(201).json(await db.transaction((tx) => svc.createOrder(tx, req.user, body)));
});
r.put('/:id', counter, async (req, res) => {
  const { type, tableId, sendToKitchen, ...body } = orderBody.parse(req.body);
  res.json(await db.transaction((tx) => svc.updateOrder(tx, req.user, +req.params.id, body)));
});
r.post('/:id/send-kitchen', counter, async (req, res) => {
  res.json(await db.transaction((tx) => svc.sendToKitchen(tx, req.user, +req.params.id)));
});
r.post('/:id/payments', counter, async (req, res) => {
  const body = payBody.parse(req.body);
  const out = await db.transaction((tx) => svc.payOrder(tx, req.user, +req.params.id, body));
  res.status(out.duplicate ? 200 : 201).json(out);
});
r.post('/:id/cancel', counter, async (req, res) => {
  const { reason } = reasonBody.parse(req.body);
  res.json(await db.transaction((tx) => svc.cancelOrder(tx, req.user, +req.params.id, reason)));
});
r.post('/:id/refund', manager, async (req, res) => {
  const body = reasonBody.extend({ type: z.enum(['REFUND', 'VOID']).default('REFUND') }).parse(req.body);
  res.json(await db.transaction((tx) => svc.refundOrder(tx, req.user, +req.params.id, body)));
});

export default r;
