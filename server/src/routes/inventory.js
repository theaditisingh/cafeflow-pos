import { Router } from 'express';
import { z } from 'zod';
import { desc, eq, sql } from 'drizzle-orm';
import { db, ingredients, suppliers, purchases, stockMovements, recipes, menuItems, users } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { conflict, notFound, bad } from '../lib/errors.js';
import { audit } from '../lib/audit.js';

const r = Router();
r.use(requireAuth, requireRole('MANAGER'));

const qty = z.number().positive().max(10_000_000);
const ingBody = z.object({
  name: z.string().trim().min(1).max(80), unit: z.enum(['g', 'kg', 'ml', 'l', 'pcs']),
  minStockQty: z.number().min(0).max(10_000_000).optional(), costPerUnitPaise: z.number().int().min(0).optional(),
  allowNegative: z.boolean().optional(),
});

// ---- Ingredients
r.get('/ingredients', async (_req, res) => {
  const rows = await db.select().from(ingredients).orderBy(ingredients.name);
  res.json(rows.map((i) => ({ ...i, low: i.stockQty <= i.minStockQty })));
});
r.get('/low-stock', async (_req, res) => {
  res.json(await db.select().from(ingredients).where(sql`${ingredients.stockQty} <= ${ingredients.minStockQty}`).orderBy(ingredients.name));
});
r.post('/ingredients', async (req, res) => {
  const b = ingBody.parse(req.body);
  try {
    const [i] = await db.insert(ingredients).values(b).returning();
    await audit(db, req.user, 'INGREDIENT_CREATE', { entity: 'ingredient', entityId: i.id });
    res.status(201).json(i);
  } catch (e) {
    if (e.cause?.code === '23505') throw conflict('An ingredient with that name already exists');
    throw e;
  }
});
// Stock quantity is never edited directly - use purchases or adjustments so the movement log stays complete.
r.put('/ingredients/:id', async (req, res) => {
  const b = ingBody.partial().parse(req.body);
  const [i] = await db.update(ingredients).set(b).where(eq(ingredients.id, +req.params.id)).returning();
  if (!i) throw notFound('Ingredient not found');
  if (b.allowNegative !== undefined) await audit(db, req.user, 'INGREDIENT_NEGATIVE_STOCK_SETTING', { entity: 'ingredient', entityId: i.id, details: { allowNegative: b.allowNegative } });
  res.json(i);
});

// ---- Suppliers
const supBody = z.object({
  name: z.string().trim().min(1).max(100), contactPerson: z.string().max(100).nullable().optional(),
  phone: z.string().max(20).nullable().optional(), email: z.string().email().max(100).nullable().optional().or(z.literal('').transform(() => null)),
  address: z.string().max(300).nullable().optional(),
});
r.get('/suppliers', async (_req, res) => res.json(await db.select().from(suppliers).orderBy(suppliers.name)));
r.post('/suppliers', async (req, res) => res.status(201).json((await db.insert(suppliers).values(supBody.parse(req.body)).returning())[0]));
r.put('/suppliers/:id', async (req, res) => {
  const [s] = await db.update(suppliers).set(supBody.partial().parse(req.body)).where(eq(suppliers.id, +req.params.id)).returning();
  if (!s) throw notFound('Supplier not found');
  res.json(s);
});
r.delete('/suppliers/:id', async (req, res) => {
  const id = +req.params.id;
  const [used] = await db.select({ id: purchases.id }).from(purchases).where(eq(purchases.supplierId, id)).limit(1);
  if (used) throw conflict('This supplier has purchase history and cannot be deleted');
  const [s] = await db.delete(suppliers).where(eq(suppliers.id, id)).returning();
  if (!s) throw notFound('Supplier not found');
  res.status(204).end();
});

// ---- Purchases (stock in)
r.get('/purchases', async (_req, res) => {
  res.json(await db.select({ p: purchases, supplier: suppliers.name, ingredient: ingredients.name, unit: ingredients.unit })
    .from(purchases).innerJoin(suppliers, eq(suppliers.id, purchases.supplierId)).innerJoin(ingredients, eq(ingredients.id, purchases.ingredientId))
    .orderBy(desc(purchases.createdAt)).limit(100).then((rows) => rows.map(({ p, ...x }) => ({ ...p, ...x }))));
});
r.post('/purchases', async (req, res) => {
  const b = z.object({ supplierId: z.number().int(), ingredientId: z.number().int(), quantity: qty, unitCostPaise: z.number().int().min(0), invoiceNo: z.string().max(40).optional() }).parse(req.body);
  const out = await db.transaction(async (tx) => {
    const [ing] = await tx.select().from(ingredients).where(eq(ingredients.id, b.ingredientId)).for('update');
    if (!ing) throw bad('Ingredient not found');
    const [sup] = await tx.select().from(suppliers).where(eq(suppliers.id, b.supplierId));
    if (!sup) throw bad('Supplier not found');
    const [p] = await tx.insert(purchases).values({ ...b, totalPaise: Math.round(b.quantity * b.unitCostPaise), createdBy: req.user.id }).returning();
    await tx.update(ingredients).set({ stockQty: sql`${ingredients.stockQty} + ${b.quantity}`, costPerUnitPaise: b.unitCostPaise }).where(eq(ingredients.id, ing.id));
    await tx.insert(stockMovements).values({ ingredientId: ing.id, type: 'PURCHASE', quantity: b.quantity, reason: `Purchase from ${sup.name}${b.invoiceNo ? ` (${b.invoiceNo})` : ''}`, createdBy: req.user.id });
    await audit(tx, req.user, 'PURCHASE_ADD', { entity: 'purchase', entityId: p.id });
    return p;
  });
  res.status(201).json(out);
});

// ---- Adjustments (manual correction; reason is mandatory)
r.post('/adjustments', async (req, res) => {
  const b = z.object({ ingredientId: z.number().int(), delta: z.number().refine((n) => n !== 0, 'Change cannot be zero').refine((n) => Math.abs(n) <= 10_000_000), reason: z.string().trim().min(3, 'A reason is required').max(200) }).parse(req.body);
  const out = await db.transaction(async (tx) => {
    const [ing] = await tx.select().from(ingredients).where(eq(ingredients.id, b.ingredientId)).for('update');
    if (!ing) throw bad('Ingredient not found');
    if (!ing.allowNegative && ing.stockQty + b.delta < -1e-9) throw conflict(`This would make ${ing.name} stock negative. Enable "allow negative" for it first if that is intended.`);
    await tx.update(ingredients).set({ stockQty: sql`${ingredients.stockQty} + ${b.delta}` }).where(eq(ingredients.id, ing.id));
    await tx.insert(stockMovements).values({ ingredientId: ing.id, type: 'ADJUSTMENT', quantity: b.delta, reason: b.reason, createdBy: req.user.id });
    await audit(tx, req.user, 'STOCK_ADJUSTMENT', { entity: 'ingredient', entityId: ing.id, reason: b.reason, details: { delta: b.delta } });
    const [after] = await tx.select().from(ingredients).where(eq(ingredients.id, ing.id));
    return after;
  });
  res.json(out);
});

r.get('/movements', async (req, res) => {
  const ingredientId = req.query.ingredientId ? +req.query.ingredientId : null;
  const rows = await db.select({ m: stockMovements, ingredient: ingredients.name, unit: ingredients.unit, by: users.name })
    .from(stockMovements).innerJoin(ingredients, eq(ingredients.id, stockMovements.ingredientId)).leftJoin(users, eq(users.id, stockMovements.createdBy))
    .where(ingredientId ? eq(stockMovements.ingredientId, ingredientId) : undefined).orderBy(desc(stockMovements.createdAt), desc(stockMovements.id)).limit(200);
  res.json(rows.map(({ m, ...x }) => ({ ...m, ...x })));
});

// ---- Recipes
r.get('/recipes', async (_req, res) => {
  const rows = await db.select({ r: recipes, ingredient: ingredients.name, unit: ingredients.unit, item: menuItems.name })
    .from(recipes).innerJoin(ingredients, eq(ingredients.id, recipes.ingredientId)).innerJoin(menuItems, eq(menuItems.id, recipes.menuItemId)).orderBy(menuItems.name);
  res.json(rows.map(({ r: x, ...o }) => ({ ...x, ...o })));
});
r.put('/recipes/:menuItemId', async (req, res) => {
  const menuItemId = +req.params.menuItemId;
  const { lines } = z.object({ lines: z.array(z.object({ ingredientId: z.number().int(), quantity: qty })).max(30) }).parse(req.body);
  if (new Set(lines.map((l) => l.ingredientId)).size !== lines.length) throw bad('Each ingredient can appear once per recipe');
  await db.transaction(async (tx) => {
    const [m] = await tx.select().from(menuItems).where(eq(menuItems.id, menuItemId));
    if (!m) throw notFound('Menu item not found');
    await tx.delete(recipes).where(eq(recipes.menuItemId, menuItemId));
    if (lines.length) await tx.insert(recipes).values(lines.map((l) => ({ ...l, menuItemId })));
    await audit(tx, req.user, 'RECIPE_UPDATE', { entity: 'menu_item', entityId: menuItemId });
  });
  res.json({ ok: true });
});

export default r;
