import { Router } from 'express';
import { z } from 'zod';
import { and, desc, gte, inArray, ne, or, eq, sql } from 'drizzle-orm';
import { db, orders, orderItems, diningTables } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { setKitchenStatus } from '../services/orders.js';

const r = Router();
r.use(requireAuth);

const secs = (a, b) => (a && b ? Math.max(0, Math.round((new Date(b) - new Date(a)) / 1000)) : null);

export function ticketShape(o, items, tableName) {
  const now = new Date();
  return {
    id: o.id, orderNumber: o.orderNumber, kotNumber: o.kotNumber, type: o.type, tableName: tableName ?? null, notes: o.notes,
    kitchenStatus: o.kitchenStatus, paymentStatus: o.paymentStatus,
    sentToKitchenAt: o.sentToKitchenAt, preparingAt: o.preparingAt, readyAt: o.readyAt, servedAt: o.servedAt,
    // waitSeconds: ticket age until it was marked ready (or until now). prepSeconds: cooking time once started.
    waitSeconds: secs(o.sentToKitchenAt, o.readyAt ?? now),
    prepSeconds: o.preparingAt ? secs(o.preparingAt, o.readyAt ?? now) : null,
    items: items.map((i) => ({ id: i.id, name: i.name, variantName: i.variantName, addons: i.addons, notes: i.notes, quantity: i.quantity, isVeg: i.isVeg, station: i.station })),
  };
}

// state=active (New/Preparing/Ready), served (recently served), all (both; used by the KDS board)
r.get('/tickets', async (req, res) => {
  const { state, station } = z.object({ state: z.enum(['active', 'served', 'all']).default('all'), station: z.enum(['BAR', 'KITCHEN', 'DESSERT']).optional() }).parse(req.query);
  const since = new Date(Date.now() - 4 * 3600 * 1000);
  const active = inArray(orders.kitchenStatus, ['NEW', 'PREPARING', 'READY']);
  const served = and(eq(orders.kitchenStatus, 'SERVED'), gte(orders.servedAt, since));
  const cond = state === 'active' ? active : state === 'served' ? served : or(active, served);
  const rows = await db.select({ o: orders, tableName: diningTables.name }).from(orders)
    .leftJoin(diningTables, eq(orders.tableId, diningTables.id))
    .where(and(ne(orders.status, 'CANCELLED'), ne(orders.kitchenStatus, 'NOT_SENT'), cond))
    .orderBy(orders.sentToKitchenAt).limit(200);
  const items = rows.length ? await db.select().from(orderItems).where(inArray(orderItems.orderId, rows.map((x) => x.o.id))).orderBy(orderItems.id) : [];
  let tickets = rows.map(({ o, tableName }) => ticketShape(o, items.filter((i) => i.orderId === o.id), tableName));
  if (station) {
    tickets = tickets.map((t) => ({ ...t, items: t.items.filter((i) => i.station === station) })).filter((t) => t.items.length);
  }
  res.json(tickets);
});

r.patch('/orders/:id/status', requireRole('MANAGER', 'KITCHEN', 'CASHIER'), async (req, res) => {
  const { status } = z.object({ status: z.enum(['NEW', 'PREPARING', 'READY', 'SERVED']) }).parse(req.body);
  const o = await db.transaction((tx) => setKitchenStatus(tx, req.user, +req.params.id, status));
  res.json({ id: o.id, kitchenStatus: o.kitchenStatus });
});

export default r;
