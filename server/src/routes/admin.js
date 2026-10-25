import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { desc, eq, ilike, sql } from 'drizzle-orm';
import { db, users, settings, auditLogs } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { getSettings } from '../lib/settings.js';
import { audit } from '../lib/audit.js';
import { bad, conflict, notFound } from '../lib/errors.js';

export const settingsRouter = Router();
export const staffRouter = Router();
export const auditRouter = Router();

// ---- Settings (every signed-in user can read; managers change)
const settingsBody = z.object({
  cafeName: z.string().trim().min(1).max(80), address: z.string().max(200), phone: z.string().max(30), receiptFooter: z.string().max(200),
  taxInclusive: z.boolean(), defaultTaxRateBp: z.number().int().min(0).max(10000), maxDiscountPercentCashier: z.number().min(0).max(100),
  loyaltyEnabled: z.boolean(), loyaltyPointsPer100Rupees: z.number().int().min(0).max(1000),
}).partial().strict();

settingsRouter.use(requireAuth);
settingsRouter.get('/', async (_req, res) => res.json(await getSettings()));
settingsRouter.put('/', requireRole('MANAGER'), async (req, res) => {
  const b = settingsBody.parse(req.body);
  await db.transaction(async (tx) => {
    for (const [key, value] of Object.entries(b)) {
      await tx.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
    }
    await audit(tx, req.user, 'SETTINGS_UPDATE', { entity: 'settings', details: b });
  });
  res.json(await getSettings());
});

// ---- Staff (owner only)
const pub = { id: users.id, name: users.name, email: users.email, role: users.role, active: users.active, createdAt: users.createdAt };
const pw = z.string().min(8, 'Password must be at least 8 characters').max(100);
staffRouter.use(requireAuth, requireRole());  // OWNER only (no other roles listed)

staffRouter.get('/', async (_req, res) => res.json(await db.select(pub).from(users).orderBy(users.id)));
staffRouter.post('/', async (req, res) => {
  const b = z.object({ name: z.string().trim().min(1).max(80), email: z.string().email().toLowerCase(), password: pw, role: z.enum(['OWNER', 'MANAGER', 'CASHIER', 'KITCHEN']) }).parse(req.body);
  try {
    const [u] = await db.insert(users).values({ name: b.name, email: b.email, role: b.role, passwordHash: await bcrypt.hash(b.password, 10) }).returning(pub);
    await audit(db, req.user, 'STAFF_CREATE', { entity: 'user', entityId: u.id, details: { role: u.role } });
    res.status(201).json(u);
  } catch (e) {
    if (e.cause?.code === '23505') throw conflict('A user with that email already exists');
    throw e;
  }
});
staffRouter.put('/:id', async (req, res) => {
  const id = +req.params.id;
  const b = z.object({ name: z.string().trim().min(1).max(80), role: z.enum(['OWNER', 'MANAGER', 'CASHIER', 'KITCHEN']), active: z.boolean(), password: pw }).partial().parse(req.body);
  const [cur] = await db.select().from(users).where(eq(users.id, id));
  if (!cur) throw notFound('User not found');
  if (id === req.user.id && (b.active === false || (b.role && b.role !== 'OWNER'))) throw bad('You cannot disable or demote your own account');
  if (cur.role === 'OWNER' && (b.active === false || (b.role && b.role !== 'OWNER'))) {
    const [{ c }] = await db.select({ c: sql`count(*)::int` }).from(users).where(sql`${users.role} = 'OWNER' and ${users.active}`);
    if (c <= 1) throw bad('There must be at least one active owner');
  }
  const { password, ...rest } = b;
  const patch = { ...rest, ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}) };
  if (!Object.keys(patch).length) throw bad('Nothing to update');
  const [u] = await db.update(users).set(patch).where(eq(users.id, id)).returning(pub);
  await audit(db, req.user, 'STAFF_UPDATE', { entity: 'user', entityId: id, details: { ...rest, passwordChanged: !!password } });
  res.json(u);
});

// ---- Audit log (manager+)
auditRouter.use(requireAuth, requireRole('MANAGER'));
auditRouter.get('/', async (req, res) => {
  const q = z.object({ action: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(100), offset: z.coerce.number().int().min(0).default(0) }).parse(req.query);
  const where = q.action ? ilike(auditLogs.action, `%${q.action}%`) : undefined;
  const rows = await db.select({ a: auditLogs, user: users.name }).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.userId))
    .where(where).orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(q.limit).offset(q.offset);
  res.json(rows.map(({ a, user }) => ({ ...a, user })));
});
