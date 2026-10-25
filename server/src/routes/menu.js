import { Router } from 'express';
import { z } from 'zod';
import { and, eq, asc } from 'drizzle-orm';
import { db, categories, menuItems, variants, addons } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { notFound, conflict } from '../lib/errors.js';
import { audit } from '../lib/audit.js';

const r = Router();
r.use(requireAuth);
const manage = requireRole('MANAGER');

const catSchema = z.object({ name: z.string().trim().min(1).max(60), sortOrder: z.number().int().optional() });
const itemSchema = z.object({
  categoryId: z.number().int(),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).optional(),
  imageUrl: z.string().max(500).nullable().optional(),
  pricePaise: z.number().int().min(0).max(10_000_000),
  taxRateBp: z.number().int().min(0).max(10000).optional(),
  station: z.enum(['BAR', 'KITCHEN', 'DESSERT']).optional(),
  isVeg: z.boolean().optional(),
  available: z.boolean().optional(),
  variants: z.array(z.object({ name: z.string().trim().min(1), priceDeltaPaise: z.number().int() })).optional(),
  addons: z.array(z.object({ name: z.string().trim().min(1), pricePaise: z.number().int().min(0) })).optional(),
});

async function withExtras(items) {
  const [vs, as] = await Promise.all([db.select().from(variants), db.select().from(addons)]);
  return items.map((i) => ({ ...i, variants: vs.filter((v) => v.menuItemId === i.id), addons: as.filter((a) => a.menuItemId === i.id) }));
}

// ---- Categories
r.get('/categories', async (_req, res) => {
  res.json(await db.select().from(categories).where(eq(categories.archived, false)).orderBy(asc(categories.sortOrder), asc(categories.name)));
});
r.post('/categories', manage, async (req, res) => {
  const body = catSchema.parse(req.body);
  const [c] = await db.insert(categories).values(body).returning();
  await audit(db, req.user, 'CATEGORY_CREATE', { entity: 'category', entityId: c.id });
  res.status(201).json(c);
});
r.put('/categories/:id', manage, async (req, res) => {
  const body = catSchema.partial().parse(req.body);
  const [c] = await db.update(categories).set(body).where(eq(categories.id, +req.params.id)).returning();
  if (!c) throw notFound('Category not found');
  res.json(c);
});
r.delete('/categories/:id', manage, async (req, res) => {
  const id = +req.params.id;
  const [live] = await db.select({ id: menuItems.id }).from(menuItems).where(and(eq(menuItems.categoryId, id), eq(menuItems.archived, false))).limit(1);
  if (live) throw conflict('Category still has menu items. Move or archive them first.');
  const [c] = await db.update(categories).set({ archived: true }).where(eq(categories.id, id)).returning();
  if (!c) throw notFound('Category not found');
  await audit(db, req.user, 'CATEGORY_ARCHIVE', { entity: 'category', entityId: id });
  res.status(204).end();
});

// ---- Items
r.get('/items', async (req, res) => {
  const rows = await db.select().from(menuItems).where(eq(menuItems.archived, false)).orderBy(asc(menuItems.name));
  const list = await withExtras(rows);
  res.json(req.query.available === 'true' ? list.filter((i) => i.available) : list);
});

async function saveExtras(tx, itemId, body) {
  if (body.variants) {
    await tx.delete(variants).where(eq(variants.menuItemId, itemId));
    if (body.variants.length) await tx.insert(variants).values(body.variants.map((v) => ({ ...v, menuItemId: itemId })));
  }
  if (body.addons) {
    await tx.delete(addons).where(eq(addons.menuItemId, itemId));
    if (body.addons.length) await tx.insert(addons).values(body.addons.map((a) => ({ ...a, menuItemId: itemId })));
  }
}

r.post('/items', manage, async (req, res) => {
  const { variants: _v, addons: _a, ...fields } = itemSchema.parse(req.body);
  const body = itemSchema.parse(req.body);
  const item = await db.transaction(async (tx) => {
    const [i] = await tx.insert(menuItems).values(fields).returning();
    await saveExtras(tx, i.id, body);
    await audit(tx, req.user, 'MENU_ITEM_CREATE', { entity: 'menu_item', entityId: i.id });
    return i;
  });
  res.status(201).json((await withExtras([item]))[0]);
});

r.put('/items/:id', manage, async (req, res) => {
  const id = +req.params.id;
  const body = itemSchema.partial().parse(req.body);
  const { variants: _v, addons: _a, ...fields } = body;
  const item = await db.transaction(async (tx) => {
    const [i] = Object.keys(fields).length
      ? await tx.update(menuItems).set(fields).where(eq(menuItems.id, id)).returning()
      : await tx.select().from(menuItems).where(eq(menuItems.id, id));
    if (!i) throw notFound('Menu item not found');
    await saveExtras(tx, id, body);
    await audit(tx, req.user, 'MENU_ITEM_UPDATE', { entity: 'menu_item', entityId: id, details: fields });
    return i;
  });
  res.json((await withExtras([item]))[0]);
});

// Quick stock toggle - also allowed for cashiers/kitchen who run out of an item mid-service.
r.patch('/items/:id/availability', requireRole('MANAGER', 'CASHIER', 'KITCHEN'), async (req, res) => {
  const { available } = z.object({ available: z.boolean() }).parse(req.body);
  const [i] = await db.update(menuItems).set({ available }).where(eq(menuItems.id, +req.params.id)).returning();
  if (!i) throw notFound('Menu item not found');
  res.json(i);
});

// Soft delete: order history keeps its own copy of name/price, and the row stays for FK integrity.
r.delete('/items/:id', manage, async (req, res) => {
  const [i] = await db.update(menuItems).set({ archived: true, available: false }).where(eq(menuItems.id, +req.params.id)).returning();
  if (!i) throw notFound('Menu item not found');
  await audit(db, req.user, 'MENU_ITEM_ARCHIVE', { entity: 'menu_item', entityId: i.id });
  res.status(204).end();
});

export default r;
