import { and, eq, inArray, like, sql } from 'drizzle-orm';
import {
  orders, orderItems, payments, menuItems, variants, addons, diningTables, customers, loyaltyTransactions,
} from '../db/schema.js';
import { computeTotals, cashChange } from '../lib/billing.js';
import { bad, conflict, notFound, HttpError } from '../lib/errors.js';
import { getSettings, ymd } from '../lib/settings.js';
import { audit } from '../lib/audit.js';
import { deductStock, restoreStock } from './stock.js';

const ACTIVE = ['OPEN', 'CONFIRMED'];

async function nextNumber(tx, column, prefix) {
  await tx.execute(sql`select pg_advisory_xact_lock(7001)`);
  const [{ n }] = await tx.select({ n: sql`count(*)::int` }).from(orders).where(like(column, `${prefix}%`));
  return `${prefix}${String(n + 1).padStart(4, '0')}`;
}

async function lockOrder(tx, id) {
  const [o] = await tx.select().from(orders).where(eq(orders.id, id)).for('update');
  if (!o) throw notFound('Order not found');
  return o;
}

export async function loadOrder(tx, id) {
  const [o] = await tx.select().from(orders).where(eq(orders.id, id));
  if (!o) throw notFound('Order not found');
  // Sequential on purpose: a transaction uses a single connection, which cannot run queries in parallel.
  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, id)).orderBy(orderItems.id);
  const pays = await tx.select().from(payments).where(eq(payments.orderId, id)).orderBy(payments.id);
  const tbl = o.tableId ? await tx.select().from(diningTables).where(eq(diningTables.id, o.tableId)) : [];
  const cust = o.customerId ? await tx.select().from(customers).where(eq(customers.id, o.customerId)) : [];
  return { ...o, items, payments: pays, table: tbl[0] ?? null, customer: cust[0] ?? null };
}

// Turn the client's cart into trusted priced lines using ONLY server-side menu data.
async function buildLines(tx, cart) {
  if (!cart?.length) throw bad('Add at least one item');
  const ids = [...new Set(cart.map((c) => c.menuItemId))];
  const mi = await tx.select().from(menuItems).where(inArray(menuItems.id, ids));
  const vs = await tx.select().from(variants).where(inArray(variants.menuItemId, ids));
  const as = await tx.select().from(addons).where(inArray(addons.menuItemId, ids));
  return cart.map((c) => {
    const m = mi.find((x) => x.id === c.menuItemId);
    if (!m || m.archived) throw bad('A menu item in this order no longer exists');
    if (!m.available) throw conflict(`${m.name} is currently unavailable`);
    const v = c.variantId ? vs.find((x) => x.id === c.variantId && x.menuItemId === m.id) : null;
    if (c.variantId && !v) throw bad(`Invalid variant for ${m.name}`);
    const picked = [...new Set(c.addonIds ?? [])].map((aid) => {
      const a = as.find((x) => x.id === aid && x.menuItemId === m.id);
      if (!a) throw bad(`Invalid add-on for ${m.name}`);
      return a;
    });
    const unit = m.pricePaise + (v?.priceDeltaPaise ?? 0) + picked.reduce((s, a) => s + a.pricePaise, 0);
    if (unit < 0) throw bad(`Invalid price for ${m.name}`);
    return {
      menuItemId: m.id, name: m.name, variantName: v?.name ?? null,
      addons: picked.map((a) => ({ name: a.name, pricePaise: a.pricePaise })),
      notes: c.notes?.trim() || null, isVeg: m.isVeg, station: m.station,
      unitPricePaise: unit, quantity: c.quantity, taxRateBp: m.taxRateBp,
    };
  });
}

function priceOrder(lines, discount, settings, user) {
  const type = discount?.type ?? null;
  const value = discount?.value ?? 0;
  if (type === 'PERCENT' && (value < 0 || value > 10000)) throw bad('Discount percent must be between 0 and 100');
  const t = computeTotals(lines, { discountType: value > 0 ? type : null, discountValue: value, taxInclusive: settings.taxInclusive });
  if (t.discountPaise > 0 && user.role === 'CASHIER') {
    const cap = Math.round((t.subtotalPaise * settings.maxDiscountPercentCashier) / 100);
    if (t.discountPaise > cap) throw new HttpError(403, `Cashiers can give at most ${settings.maxDiscountPercentCashier}% discount. Ask a manager.`);
  }
  return t;
}

async function resolveCustomer(tx, p) {
  if (p.customerId) {
    const [c] = await tx.select().from(customers).where(eq(customers.id, p.customerId));
    if (!c) throw bad('Customer not found');
    return c;
  }
  if (p.customerPhone) {
    const [c] = await tx.select().from(customers).where(eq(customers.phone, p.customerPhone));
    if (c) return c;
    const [n] = await tx.insert(customers).values({ name: p.customerName?.trim() || 'Customer', phone: p.customerPhone }).returning();
    return n;
  }
  return null;
}

function itemRows(orderId, lines, totals) {
  return lines.map((l, i) => ({ ...l, orderId, ...totals.lines[i] }));
}

export async function createOrder(tx, user, p, opts = {}) {
  const at = opts.at ?? new Date();
  const settings = await getSettings(tx);
  if (p.type === 'DINE_IN' && !p.tableId) throw bad('Select a table for dine-in orders');
  let tableId = null;
  if (p.type === 'DINE_IN') {
    const [t] = await tx.select().from(diningTables).where(eq(diningTables.id, p.tableId)).for('update');
    if (!t) throw bad('Table not found');
    const [busy] = await tx.select({ id: orders.id }).from(orders).where(and(eq(orders.tableId, t.id), inArray(orders.status, ACTIVE))).limit(1);
    if (busy) throw conflict(`Table ${t.name} already has an open order`);
    if (t.status === 'CLEANING') throw conflict(`Table ${t.name} is being cleaned. Mark it available first.`);
    tableId = t.id;
  }
  const lines = await buildLines(tx, p.items);
  const totals = priceOrder(lines, p.discount, settings, user);
  const customer = await resolveCustomer(tx, p);
  const orderNumber = await nextNumber(tx, orders.orderNumber, `ORD-${ymd(at)}-`);

  const [o] = await tx.insert(orders).values({
    orderNumber, type: p.type, tableId, customerId: customer?.id ?? null,
    customerName: customer?.name ?? null, customerPhone: customer?.phone ?? null,
    discountType: totals.discountPaise > 0 ? p.discount.type : null, discountValue: totals.discountPaise > 0 ? p.discount.value : 0,
    subtotalPaise: totals.subtotalPaise, discountPaise: totals.discountPaise, taxPaise: totals.taxPaise, totalPaise: totals.totalPaise,
    notes: p.notes?.trim() || null, isDemo: !!opts.isDemo, createdBy: user.id, createdAt: at,
  }).returning();
  await tx.insert(orderItems).values(itemRows(o.id, lines, totals));
  if (tableId) await tx.update(diningTables).set({ status: 'OCCUPIED' }).where(eq(diningTables.id, tableId));
  await audit(tx, user, 'ORDER_CREATE', { entity: 'order', entityId: o.id });
  if (totals.discountPaise > 0) await audit(tx, user, 'DISCOUNT_APPLIED', { entity: 'order', entityId: o.id, details: { type: p.discount.type, value: p.discount.value, paise: totals.discountPaise } });
  if (p.sendToKitchen) await sendToKitchen(tx, user, o.id, { at });
  return loadOrder(tx, o.id);
}

// Edit a saved-but-unsent order (items, discount, notes, customer). Type/table cannot change.
export async function updateOrder(tx, user, id, p) {
  const o = await lockOrder(tx, id);
  if (o.status !== 'OPEN') throw conflict('Only orders that have not been sent to the kitchen can be edited');
  const settings = await getSettings(tx);
  const lines = await buildLines(tx, p.items);
  const totals = priceOrder(lines, p.discount, settings, user);
  const customer = await resolveCustomer(tx, p);
  await tx.delete(orderItems).where(eq(orderItems.orderId, id));
  await tx.insert(orderItems).values(itemRows(id, lines, totals));
  await tx.update(orders).set({
    customerId: customer?.id ?? null, customerName: customer?.name ?? null, customerPhone: customer?.phone ?? null,
    discountType: totals.discountPaise > 0 ? p.discount.type : null, discountValue: totals.discountPaise > 0 ? p.discount.value : 0,
    subtotalPaise: totals.subtotalPaise, discountPaise: totals.discountPaise, taxPaise: totals.taxPaise, totalPaise: totals.totalPaise,
    notes: p.notes?.trim() || null,
  }).where(eq(orders.id, id));
  await audit(tx, user, 'ORDER_UPDATE', { entity: 'order', entityId: id });
  return loadOrder(tx, id);
}

export async function sendToKitchen(tx, user, id, { at = new Date() } = {}) {
  const o = await lockOrder(tx, id);
  if (o.status === 'CANCELLED') throw conflict('Order is cancelled');
  if (o.kitchenStatus !== 'NOT_SENT') return loadOrder(tx, id); // duplicate request: no-op
  if (!ACTIVE.includes(o.status)) throw conflict('Order is already closed');
  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, id));
  await deductStock(tx, o, items, user, at);
  const kotNumber = await nextNumber(tx, orders.kotNumber, `KOT-${ymd(at)}-`);
  await tx.update(orders).set({ status: 'CONFIRMED', kitchenStatus: 'NEW', kotNumber, sentToKitchenAt: at }).where(eq(orders.id, id));
  await audit(tx, user, 'KOT_SENT', { entity: 'order', entityId: id, details: { kotNumber } });
  return loadOrder(tx, id);
}

export async function payOrder(tx, user, id, p, { at = new Date() } = {}) {
  const o = await lockOrder(tx, id); // serialises concurrent payment attempts on this order
  if (p.idempotencyKey) {
    const [prev] = await tx.select().from(payments).where(eq(payments.idempotencyKey, p.idempotencyKey));
    if (prev) {
      if (prev.orderId !== id) throw conflict('This payment key was used for another order');
      return { order: await loadOrder(tx, id), payment: prev, duplicate: true };
    }
  }
  if (o.paymentStatus !== 'UNPAID') throw conflict(`Order is already ${o.paymentStatus.toLowerCase()}`);
  if (o.status === 'CANCELLED') throw conflict('Order is cancelled');
  if (o.totalPaise <= 0) throw bad('Nothing to pay');

  let received = null;
  let change = null;
  if (p.method === 'CASH') {
    received = p.cashReceivedPaise ?? o.totalPaise;
    try { change = cashChange(o.totalPaise, received); } catch (e) { throw bad(e.message); }
  }
  if (o.kitchenStatus === 'NOT_SENT') await sendToKitchen(tx, user, id, { at });

  const receiptNumber = await nextNumber(tx, orders.receiptNumber, `RCT-${ymd(at)}-`);
  const [pay] = await tx.insert(payments).values({
    orderId: id, method: p.method, amountPaise: o.totalPaise, cashReceivedPaise: received, changePaise: change,
    reference: p.reference?.trim() || null, idempotencyKey: p.idempotencyKey ?? null, createdBy: user.id, createdAt: at,
  }).returning();
  await tx.update(orders).set({ paymentStatus: 'PAID', status: 'COMPLETED', receiptNumber, completedAt: at }).where(eq(orders.id, id));
  if (o.tableId) await tx.update(diningTables).set({ status: 'AVAILABLE' }).where(eq(diningTables.id, o.tableId));
  await awardLoyalty(tx, o, at);
  await audit(tx, user, 'PAYMENT_RECORDED', { entity: 'order', entityId: id, details: { method: p.method, amountPaise: o.totalPaise } });
  return { order: await loadOrder(tx, id), payment: pay, duplicate: false };
}

async function awardLoyalty(tx, o, at) {
  if (!o.customerId) return;
  const s = await getSettings(tx);
  if (!s.loyaltyEnabled) return;
  const points = Math.floor(o.totalPaise / 10000) * s.loyaltyPointsPer100Rupees;
  if (points <= 0) return;
  // Unique (order_id, type) makes a second award impossible even under races.
  const ins = await tx.insert(loyaltyTransactions).values({ customerId: o.customerId, orderId: o.id, type: 'EARN', points, createdAt: at })
    .onConflictDoNothing().returning({ id: loyaltyTransactions.id });
  if (ins.length) {
    await tx.update(customers).set({ loyaltyPoints: sql`${customers.loyaltyPoints} + ${points}` }).where(eq(customers.id, o.customerId));
    await tx.update(orders).set({ loyaltyAwarded: true }).where(eq(orders.id, o.id));
  }
}

async function reverseLoyalty(tx, o, at) {
  if (!o.customerId || !o.loyaltyAwarded) return;
  const [earn] = await tx.select().from(loyaltyTransactions).where(and(eq(loyaltyTransactions.orderId, o.id), eq(loyaltyTransactions.type, 'EARN')));
  if (!earn) return;
  const ins = await tx.insert(loyaltyTransactions).values({ customerId: o.customerId, orderId: o.id, type: 'REVERSE', points: -earn.points, createdAt: at })
    .onConflictDoNothing().returning({ id: loyaltyTransactions.id });
  if (ins.length) {
    await tx.update(customers).set({ loyaltyPoints: sql`greatest(${customers.loyaltyPoints} - ${earn.points}, 0)` }).where(eq(customers.id, o.customerId));
  }
}

export async function cancelOrder(tx, user, id, reason, { at = new Date() } = {}) {
  const o = await lockOrder(tx, id);
  if (o.status === 'CANCELLED') return loadOrder(tx, id);
  if (o.paymentStatus !== 'UNPAID') throw conflict('Paid orders cannot be cancelled. Use a refund or void instead.');
  if (o.kitchenStatus !== 'NOT_SENT' && !['OWNER', 'MANAGER'].includes(user.role)) {
    throw new HttpError(403, 'Only a manager can cancel an order that is already in the kitchen');
  }
  // Ingredients are put back only if the kitchen has not started cooking.
  if (['NOT_SENT', 'NEW'].includes(o.kitchenStatus)) await restoreStock(tx, o, user, at);
  await tx.update(orders).set({ status: 'CANCELLED', cancelReason: reason }).where(eq(orders.id, id));
  if (o.tableId) await tx.update(diningTables).set({ status: 'AVAILABLE' }).where(eq(diningTables.id, o.tableId));
  await audit(tx, user, 'ORDER_CANCEL', { entity: 'order', entityId: id, reason, details: { kitchenStatus: o.kitchenStatus } });
  return loadOrder(tx, id);
}

// type: REFUND (money returned after a valid sale) or VOID (payment recorded in error).
export async function refundOrder(tx, user, id, { type, reason }, { at = new Date() } = {}) {
  const o = await lockOrder(tx, id);
  if (o.paymentStatus !== 'PAID') throw conflict('Only paid orders can be refunded or voided');
  const status = type === 'VOID' ? 'VOID' : 'REFUNDED';
  await tx.update(payments).set({ status, refundReason: reason, refundedAt: at, refundedBy: user.id })
    .where(and(eq(payments.orderId, id), eq(payments.status, 'SUCCESS')));
  await tx.update(orders).set({ paymentStatus: status }).where(eq(orders.id, id));
  await reverseLoyalty(tx, o, at);
  await audit(tx, user, type === 'VOID' ? 'PAYMENT_VOID' : 'PAYMENT_REFUND', { entity: 'order', entityId: id, reason, details: { amountPaise: o.totalPaise } });
  return loadOrder(tx, id);
}

const NEXT = { NEW: ['PREPARING'], PREPARING: ['READY', 'NEW'], READY: ['SERVED', 'PREPARING'], SERVED: [] };

export async function setKitchenStatus(tx, user, id, status, { at = new Date() } = {}) {
  const o = await lockOrder(tx, id);
  if (o.status === 'CANCELLED') throw conflict('Order is cancelled');
  if (o.kitchenStatus === 'NOT_SENT') throw conflict('Order has not been sent to the kitchen');
  if (o.kitchenStatus === status) return loadOrder(tx, id);
  if (!NEXT[o.kitchenStatus].includes(status)) throw conflict(`Cannot move a ${o.kitchenStatus} ticket to ${status}`);
  const patch = { kitchenStatus: status };
  if (status === 'NEW') { patch.preparingAt = null; }
  if (status === 'PREPARING') { patch.preparingAt = o.preparingAt ?? at; patch.readyAt = null; }
  if (status === 'READY') { patch.readyAt = at; patch.preparingAt = o.preparingAt ?? at; }
  if (status === 'SERVED') { patch.servedAt = at; patch.readyAt = o.readyAt ?? at; patch.preparingAt = o.preparingAt ?? at; }
  await tx.update(orders).set(patch).where(eq(orders.id, id));
  return loadOrder(tx, id);
}
