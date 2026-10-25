import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { db, customers, orders, loyaltyTransactions } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { conflict, notFound } from '../lib/errors.js';

const r = Router();
r.use(requireAuth, requireRole('MANAGER', 'CASHIER'));

const body = z.object({
  name: z.string().trim().min(1).max(100),
  phone: z.string().trim().regex(/^[0-9+\- ]{7,15}$/, 'Enter a valid phone number').nullable().optional().or(z.literal('').transform(() => null)),
});

const spend = sql`coalesce(sum(${orders.totalPaise}) filter (where ${orders.paymentStatus} = 'PAID'), 0)::bigint`;

r.get('/', async (req, res) => {
  const q = (req.query.q ?? '').toString().trim();
  const where = q ? or(ilike(customers.name, `%${q}%`), ilike(customers.phone, `%${q}%`)) : undefined;
  const rows = await db.select({
    id: customers.id, name: customers.name, phone: customers.phone, loyaltyPoints: customers.loyaltyPoints, createdAt: customers.createdAt,
    orderCount: sql`count(${orders.id}) filter (where ${orders.paymentStatus} = 'PAID')::int`, totalSpentPaise: spend,
  }).from(customers).leftJoin(orders, eq(orders.customerId, customers.id)).where(where).groupBy(customers.id).orderBy(desc(customers.createdAt)).limit(100);
  res.json(rows.map((c) => ({ ...c, totalSpentPaise: Number(c.totalSpentPaise) })));
});

r.get('/:id', async (req, res) => {
  const id = +req.params.id;
  const [c] = await db.select().from(customers).where(eq(customers.id, id));
  if (!c) throw notFound('Customer not found');
  const [orderRows, points, [agg]] = await Promise.all([
    db.select().from(orders).where(eq(orders.customerId, id)).orderBy(desc(orders.createdAt)).limit(50),
    db.select().from(loyaltyTransactions).where(eq(loyaltyTransactions.customerId, id)).orderBy(desc(loyaltyTransactions.createdAt)).limit(50),
    db.select({ n: sql`count(*) filter (where ${orders.paymentStatus} = 'PAID')::int`, spent: spend }).from(orders).where(eq(orders.customerId, id)),
  ]);
  res.json({ ...c, orderCount: agg.n, totalSpentPaise: Number(agg.spent), orders: orderRows, loyalty: points });
});

async function guard(fn) {
  try { return await fn(); } catch (e) {
    if (e.cause?.code === '23505') throw conflict('A customer with that phone number already exists');
    throw e;
  }
}
r.post('/', async (req, res) => {
  const b = body.parse(req.body);
  res.status(201).json(await guard(async () => (await db.insert(customers).values({ name: b.name, phone: b.phone || null }).returning())[0]));
});
r.put('/:id', async (req, res) => {
  const b = body.partial().parse(req.body);
  const c = await guard(async () => (await db.update(customers).set({ ...b, phone: b.phone || null }).where(eq(customers.id, +req.params.id)).returning())[0]);
  if (!c) throw notFound('Customer not found');
  res.json(c);
});

export default r;
