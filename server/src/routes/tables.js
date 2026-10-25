import { Router } from 'express';
import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import { db, diningTables, orders } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { conflict, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';

const r = Router();
r.use(requireAuth);
const manager = requireRole('MANAGER');
const counter = requireRole('MANAGER', 'CASHIER');

const tableBody = z.object({ name: z.string().trim().min(1).max(20), area: z.enum(['INDOOR', 'OUTDOOR']), capacity: z.number().int().min(1).max(30) });

r.get('/', counter, async (_req, res) => {
  const [tables, active] = await Promise.all([
    db.select().from(diningTables).orderBy(diningTables.area, diningTables.name),
    db.select().from(orders).where(inArray(orders.status, ['OPEN', 'CONFIRMED'])),
  ]);
  res.json(tables.map((t) => {
    const o = active.find((x) => x.tableId === t.id);
    return { ...t, order: o ? { id: o.id, orderNumber: o.orderNumber, status: o.status, kitchenStatus: o.kitchenStatus, totalPaise: o.totalPaise, createdAt: o.createdAt } : null };
  }));
});

r.post('/', manager, async (req, res) => {
  const body = tableBody.parse(req.body);
  try {
    const [t] = await db.insert(diningTables).values(body).returning();
    res.status(201).json(t);
  } catch (e) {
    if (e.cause?.code === '23505') throw conflict('A table with that name already exists');
    throw e;
  }
});

r.put('/:id', manager, async (req, res) => {
  const body = tableBody.partial().parse(req.body);
  try {
    const [t] = await db.update(diningTables).set(body).where(eq(diningTables.id, +req.params.id)).returning();
    if (!t) throw notFound('Table not found');
    res.json(t);
  } catch (e) {
    if (e.cause?.code === '23505') throw conflict('A table with that name already exists');
    throw e;
  }
});

// Manual status changes (reserve, mark cleaning, mark available). OCCUPIED is only ever set by an order.
r.patch('/:id/status', counter, async (req, res) => {
  const { status } = z.object({ status: z.enum(['AVAILABLE', 'RESERVED', 'CLEANING']) }).parse(req.body);
  const id = +req.params.id;
  const [busy] = await db.select({ id: orders.id }).from(orders).where(and(eq(orders.tableId, id), inArray(orders.status, ['OPEN', 'CONFIRMED']))).limit(1);
  if (busy) throw conflict('This table has an active order. Complete or cancel it first.');
  const [t] = await db.update(diningTables).set({ status }).where(eq(diningTables.id, id)).returning();
  if (!t) throw notFound('Table not found');
  res.json(t);
});

r.delete('/:id', manager, async (req, res) => {
  const id = +req.params.id;
  const [used] = await db.select({ id: orders.id }).from(orders).where(eq(orders.tableId, id)).limit(1);
  if (used) throw conflict('This table has order history and cannot be deleted. Rename it instead.');
  const [t] = await db.delete(diningTables).where(eq(diningTables.id, id)).returning();
  if (!t) throw notFound('Table not found');
  await audit(db, req.user, 'TABLE_DELETE', { entity: 'table', entityId: id });
  res.status(204).end();
});

export default r;
