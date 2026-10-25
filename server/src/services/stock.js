import { eq, inArray, sql } from 'drizzle-orm';
import { ingredients, recipes, stockMovements, orders } from '../db/schema.js';
import { conflict } from '../lib/errors.js';

// Deduct recipe ingredients for an order. Idempotent: guarded by orders.stock_deducted
// (callers hold a row lock on the order, so concurrent requests cannot double-deduct).
export async function deductStock(tx, order, items, user, at = new Date()) {
  if (order.stockDeducted) return;
  const ids = [...new Set(items.map((i) => i.menuItemId).filter(Boolean))];
  const needs = new Map();
  if (ids.length) {
    const recs = await tx.select().from(recipes).where(inArray(recipes.menuItemId, ids));
    for (const item of items) {
      for (const r of recs.filter((x) => x.menuItemId === item.menuItemId)) {
        needs.set(r.ingredientId, (needs.get(r.ingredientId) ?? 0) + r.quantity * item.quantity);
      }
    }
  }
  if (needs.size) {
    // Lock ingredient rows in id order to avoid deadlocks between concurrent orders.
    const rows = await tx.select().from(ingredients).where(inArray(ingredients.id, [...needs.keys()])).orderBy(ingredients.id).for('update');
    for (const ing of rows) {
      const need = needs.get(ing.id);
      if (!ing.allowNegative && ing.stockQty - need < -1e-9) {
        throw conflict(`Not enough ${ing.name} in stock (need ${need} ${ing.unit}, have ${ing.stockQty} ${ing.unit})`);
      }
    }
    for (const ing of rows) {
      const need = needs.get(ing.id);
      await tx.update(ingredients).set({ stockQty: sql`${ingredients.stockQty} - ${need}` }).where(eq(ingredients.id, ing.id));
      await tx.insert(stockMovements).values({
        ingredientId: ing.id, type: 'ORDER_DEDUCTION', quantity: -need, orderId: order.id, createdBy: user?.id ?? null, createdAt: at,
        reason: `Order ${order.orderNumber}`,
      });
    }
  }
  await tx.update(orders).set({ stockDeducted: true }).where(eq(orders.id, order.id));
}

// Put back exactly what was deducted (read from the movement log, so recipe edits cannot skew it).
export async function restoreStock(tx, order, user, at = new Date()) {
  if (!order.stockDeducted) return;
  const moves = await tx.select().from(stockMovements)
    .where(sql`${stockMovements.orderId} = ${order.id} and ${stockMovements.type} = 'ORDER_DEDUCTION'`);
  for (const m of moves) {
    const qty = -m.quantity;
    await tx.update(ingredients).set({ stockQty: sql`${ingredients.stockQty} + ${qty}` }).where(eq(ingredients.id, m.ingredientId));
    await tx.insert(stockMovements).values({
      ingredientId: m.ingredientId, type: 'ORDER_RESTORE', quantity: qty, orderId: order.id, createdBy: user?.id ?? null, createdAt: at,
      reason: `Order ${order.orderNumber} cancelled`,
    });
  }
  await tx.update(orders).set({ stockDeducted: false }).where(eq(orders.id, order.id));
}
