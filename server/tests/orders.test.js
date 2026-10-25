import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { db, payments, auditLogs, stockMovements, ingredients, customers, orders } from '../src/db/index.js';
import { app, resetDb, seedUsers, as, login, seedFixture } from './helpers.js';

let T, F;
const api = {
  post: (url, tok, body) => request(app).post(url).set(as(tok)).send(body),
  get: (url, tok) => request(app).get(url).set(as(tok)),
  put: (url, tok, body) => request(app).put(url).set(as(tok)).send(body),
};
const cart = (over = {}) => ({ type: 'TAKEAWAY', items: [{ menuItemId: F.chai.id, quantity: 1 }], ...over });
let keyN = 0;
const key = () => `test-key-${Date.now()}-${++keyN}`;
const stock = async (id) => (await db.select().from(ingredients).where(eq(ingredients.id, id)))[0].stockQty;

beforeAll(async () => {
  await resetDb();
  await seedUsers();
  T = await login();
  F = await seedFixture(T);
});

describe('order creation & server-side pricing', () => {
  it('ignores client totals and prices from the menu (variant + add-on + tax)', async () => {
    const r = await api.post('/api/orders', T.cashier, {
      ...cart({ items: [{ menuItemId: F.cap.id, variantId: F.variantId, addonIds: [F.addonId], quantity: 2 }] }),
      totalPaise: 1, subtotalPaise: 1, items_total: 1,
    });
    expect(r.status).toBe(201);
    expect(r.body.items[0].unitPricePaise).toBe(23000);
    expect(r.body.subtotalPaise).toBe(46000);
    expect(r.body.taxPaise).toBe(2300);
    expect(r.body.totalPaise).toBe(48300);
    expect(r.body.orderNumber).toMatch(/^ORD-\d{8}-0001$/);
    expect(r.body.status).toBe('OPEN');
  });
  it('keeps historical name and price on the order after the menu changes', async () => {
    const o = (await api.post('/api/orders', T.cashier, cart())).body;
    await api.put(`/api/menu/items/${F.chai.id}`, T.manager, { name: 'Chai Renamed', pricePaise: 9900 });
    const again = (await api.get(`/api/orders/${o.id}`, T.cashier)).body;
    expect(again.items[0].name).toBe('Masala Chai');
    expect(again.items[0].unitPricePaise).toBe(6000);
    await api.put(`/api/menu/items/${F.chai.id}`, T.manager, { name: 'Masala Chai', pricePaise: 6000 });
  });
  it('rejects unavailable items, bad variants, bad quantities and empty carts', async () => {
    expect((await api.post('/api/orders', T.cashier, cart({ items: [{ menuItemId: F.off.id, quantity: 1 }] }))).status).toBe(409);
    expect((await api.post('/api/orders', T.cashier, cart({ items: [{ menuItemId: F.chai.id, variantId: F.variantId, quantity: 1 }] }))).status).toBe(400);
    expect((await api.post('/api/orders', T.cashier, cart({ items: [{ menuItemId: F.chai.id, quantity: 0 }] }))).status).toBe(400);
    expect((await api.post('/api/orders', T.cashier, cart({ items: [] }))).status).toBe(400);
    expect((await api.post('/api/orders', T.cashier, cart({ items: [{ menuItemId: 99999, quantity: 1 }] }))).status).toBe(400);
  });
  it('enforces cashier discount limit; managers can exceed it', async () => {
    const big = cart({ discount: { type: 'PERCENT', value: 2000 } });
    expect((await api.post('/api/orders', T.cashier, big)).status).toBe(403);
    const ok = await api.post('/api/orders', T.manager, big);
    expect(ok.status).toBe(201);
    expect(ok.body.discountPaise).toBe(1200);
    expect((await api.post('/api/orders', T.cashier, cart({ discount: { type: 'PERCENT', value: 1000 } }))).status).toBe(201);
  });
  it('kitchen staff cannot create orders', async () => {
    expect((await api.post('/api/orders', T.kitchen, cart())).status).toBe(403);
  });
});

describe('dine-in tables', () => {
  it('requires a table, occupies it, blocks a second order, and frees it on payment', async () => {
    expect((await api.post('/api/orders', T.cashier, cart({ type: 'DINE_IN' }))).status).toBe(400);
    const o = await api.post('/api/orders', T.cashier, cart({ type: 'DINE_IN', tableId: F.t1.id }));
    expect(o.status).toBe(201);
    let tables = (await api.get('/api/tables', T.cashier)).body;
    const t1 = tables.find((t) => t.id === F.t1.id);
    expect(t1.status).toBe('OCCUPIED');
    expect(t1.order.totalPaise).toBe(o.body.totalPaise);
    expect((await api.post('/api/orders', T.cashier, cart({ type: 'DINE_IN', tableId: F.t1.id }))).status).toBe(409);
    expect((await api.post(`/api/orders/${o.body.id}/payments`, T.cashier, { method: 'UPI', idempotencyKey: key() })).status).toBe(201);
    tables = (await api.get('/api/tables', T.cashier)).body;
    expect(tables.find((t) => t.id === F.t1.id).status).toBe('AVAILABLE');
  });
  it('frees the table when an unpaid order is cancelled and blocks manual status on busy tables', async () => {
    const o = (await api.post('/api/orders', T.cashier, cart({ type: 'DINE_IN', tableId: F.t2.id }))).body;
    const busy = await request(app).patch(`/api/tables/${F.t2.id}/status`).set(as(T.cashier)).send({ status: 'CLEANING' });
    expect(busy.status).toBe(409);
    expect((await api.post(`/api/orders/${o.id}/cancel`, T.cashier, { reason: 'Guests left' })).status).toBe(200);
    const t = (await api.get('/api/tables', T.cashier)).body.find((x) => x.id === F.t2.id);
    expect(t.status).toBe('AVAILABLE');
    expect(t.order).toBeNull();
  });
});

describe('kitchen send & stock', () => {
  it('deducts ingredients exactly once even if the request is repeated', async () => {
    const beansBefore = await stock(F.beans.id), milkBefore = await stock(F.milk.id);
    const o = (await api.post('/api/orders', T.cashier, cart({ items: [{ menuItemId: F.cap.id, quantity: 2 }] }))).body;
    const [a, b] = await Promise.all([api.post(`/api/orders/${o.id}/send-kitchen`, T.cashier, {}), api.post(`/api/orders/${o.id}/send-kitchen`, T.cashier, {})]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await stock(F.beans.id)).toBe(beansBefore - 36);
    expect(await stock(F.milk.id)).toBe(milkBefore - 300);
    expect(a.body.kotNumber).toBe(b.body.kotNumber);
    expect(a.body.kotNumber).toMatch(/^KOT-\d{8}-\d{4}$/);
    const moves = await db.select().from(stockMovements).where(eq(stockMovements.orderId, o.id));
    expect(moves).toHaveLength(2);
  });
  it('rolls back completely when stock is insufficient', async () => {
    const before = await stock(F.beans.id);
    const o = (await api.post('/api/orders', T.cashier, cart({ items: [{ menuItemId: F.cap.id, quantity: 90 }] }))).body;
    const r = await api.post(`/api/orders/${o.id}/send-kitchen`, T.cashier, {});
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/Not enough/);
    expect(await stock(F.beans.id)).toBe(before);
    const after = (await api.get(`/api/orders/${o.id}`, T.cashier)).body;
    expect(after.kitchenStatus).toBe('NOT_SENT');
    expect(after.status).toBe('OPEN');
    await api.post(`/api/orders/${o.id}/cancel`, T.cashier, { reason: 'Too big' });
  });
  it('restores stock when an order is cancelled before cooking starts', async () => {
    const before = await stock(F.milk.id);
    const o = (await api.post('/api/orders', T.cashier, cart({ items: [{ menuItemId: F.cap.id, quantity: 1 }], sendToKitchen: true }))).body;
    expect(await stock(F.milk.id)).toBe(before - 150);
    expect((await api.post(`/api/orders/${o.id}/cancel`, T.cashier, { reason: 'Changed mind' })).status).toBe(403); // cashier cannot cancel once in kitchen
    expect((await api.post(`/api/orders/${o.id}/cancel`, T.manager, { reason: 'Changed mind' })).status).toBe(200);
    expect(await stock(F.milk.id)).toBe(before);
    expect((await api.post(`/api/orders/${o.id}/cancel`, T.manager, { reason: 'Changed mind' })).status).toBe(200); // idempotent
    expect(await stock(F.milk.id)).toBe(before);
  });
});

describe('payments', () => {
  it('validates cash, calculates change, completes the order and issues a receipt number', async () => {
    const o = (await api.post('/api/orders', T.cashier, cart({ items: [{ menuItemId: F.chai.id, quantity: 3 }] }))).body; // 18000 + 900 tax
    expect((await api.post(`/api/orders/${o.id}/payments`, T.cashier, { method: 'CASH', cashReceivedPaise: 1000, idempotencyKey: key() })).status).toBe(400);
    const r = await api.post(`/api/orders/${o.id}/payments`, T.cashier, { method: 'CASH', cashReceivedPaise: 20000, idempotencyKey: key() });
    expect(r.status).toBe(201);
    expect(r.body.payment.amountPaise).toBe(18900);
    expect(r.body.payment.changePaise).toBe(1100);
    expect(r.body.order.status).toBe('COMPLETED');
    expect(r.body.order.paymentStatus).toBe('PAID');
    expect(r.body.order.kitchenStatus).toBe('NEW'); // billing and kitchen are separate; paying sent it to the kitchen
    expect(r.body.order.receiptNumber).toMatch(/^RCT-\d{8}-\d{4}$/);
  });
  it('never takes the amount from the client', async () => {
    const o = (await api.post('/api/orders', T.cashier, cart())).body;
    const r = await api.post(`/api/orders/${o.id}/payments`, T.cashier, { method: 'UPI', amountPaise: 1, idempotencyKey: key() });
    expect(r.body.payment.amountPaise).toBe(o.totalPaise);
  });
  it('replaying the same idempotency key returns the original payment; a new key is rejected', async () => {
    const o = (await api.post('/api/orders', T.cashier, cart())).body;
    const k = key();
    const first = await api.post(`/api/orders/${o.id}/payments`, T.cashier, { method: 'CARD', idempotencyKey: k });
    const replay = await api.post(`/api/orders/${o.id}/payments`, T.cashier, { method: 'CARD', idempotencyKey: k });
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.body.payment.id).toBe(first.body.payment.id);
    expect((await api.post(`/api/orders/${o.id}/payments`, T.cashier, { method: 'CARD', idempotencyKey: key() })).status).toBe(409);
    expect(await db.select().from(payments).where(eq(payments.orderId, o.id))).toHaveLength(1);
  });
  it('handles truly concurrent double-submits safely', async () => {
    const o1 = (await api.post('/api/orders', T.cashier, cart())).body;
    const k = key();
    const same = await Promise.all([1, 2, 3].map(() => api.post(`/api/orders/${o1.id}/payments`, T.cashier, { method: 'UPI', idempotencyKey: k })));
    expect(same.map((x) => x.status).sort()).toEqual([200, 200, 201]);
    expect(await db.select().from(payments).where(eq(payments.orderId, o1.id))).toHaveLength(1);

    const o2 = (await api.post('/api/orders', T.cashier, cart())).body;
    const diff = await Promise.all([1, 2, 3].map(() => api.post(`/api/orders/${o2.id}/payments`, T.cashier, { method: 'UPI', idempotencyKey: key() })));
    expect(diff.map((x) => x.status).sort()).toEqual([201, 409, 409]);
    expect(await db.select().from(payments).where(eq(payments.orderId, o2.id))).toHaveLength(1);
  });
  it('cannot pay a cancelled order or cancel a paid one', async () => {
    const c = (await api.post('/api/orders', T.cashier, cart())).body;
    await api.post(`/api/orders/${c.id}/cancel`, T.cashier, { reason: 'Test cancel' });
    expect((await api.post(`/api/orders/${c.id}/payments`, T.cashier, { method: 'CASH', idempotencyKey: key() })).status).toBe(409);
    const p = (await api.post('/api/orders', T.cashier, cart())).body;
    await api.post(`/api/orders/${p.id}/payments`, T.cashier, { method: 'UPI', idempotencyKey: key() });
    expect((await api.post(`/api/orders/${p.id}/cancel`, T.manager, { reason: 'Test cancel' })).status).toBe(409);
  });
  it('requires a reason to cancel', async () => {
    const c = (await api.post('/api/orders', T.cashier, cart())).body;
    expect((await api.post(`/api/orders/${c.id}/cancel`, T.cashier, {})).status).toBe(400);
  });
});

describe('refunds and voids', () => {
  it('requires manager access and a reason, writes an audit entry, and cannot repeat', async () => {
    const o = (await api.post('/api/orders', T.cashier, cart())).body;
    await api.post(`/api/orders/${o.id}/payments`, T.cashier, { method: 'UPI', idempotencyKey: key() });
    expect((await api.post(`/api/orders/${o.id}/refund`, T.cashier, { reason: 'Customer unhappy' })).status).toBe(403);
    expect((await api.post(`/api/orders/${o.id}/refund`, T.manager, {})).status).toBe(400);
    const r = await api.post(`/api/orders/${o.id}/refund`, T.manager, { reason: 'Customer unhappy', type: 'REFUND' });
    expect(r.status).toBe(200);
    expect(r.body.paymentStatus).toBe('REFUNDED');
    expect(r.body.payments[0].status).toBe('REFUNDED');
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.action, 'PAYMENT_REFUND'));
    expect(logs.some((l) => l.entityId === String(o.id) && l.reason === 'Customer unhappy')).toBe(true);
    expect((await api.post(`/api/orders/${o.id}/refund`, T.manager, { reason: 'Again please', type: 'REFUND' })).status).toBe(409);
  });
  it('supports voiding a payment recorded in error', async () => {
    const o = (await api.post('/api/orders', T.cashier, cart())).body;
    await api.post(`/api/orders/${o.id}/payments`, T.cashier, { method: 'CASH', idempotencyKey: key() });
    const r = await api.post(`/api/orders/${o.id}/refund`, T.owner, { reason: 'Wrong order rung', type: 'VOID' });
    expect(r.body.paymentStatus).toBe('VOID');
  });
});

describe('customers and loyalty', () => {
  it('creates a customer from a phone number and awards points exactly once', async () => {
    const o = (await api.post('/api/orders', T.cashier, cart({ items: [{ menuItemId: F.chai.id, quantity: 30 }], customerPhone: '9876543210', customerName: 'Test Guest' }))).body;
    const k = key();
    await Promise.all([1, 2].map(() => api.post(`/api/orders/${o.id}/payments`, T.cashier, { method: 'UPI', idempotencyKey: k })));
    await api.post(`/api/orders/${o.id}/payments`, T.cashier, { method: 'UPI', idempotencyKey: key() }); // rejected
    const [c] = await db.select().from(customers).where(eq(customers.phone, '9876543210'));
    expect(c.name).toBe('Test Guest');
    expect(c.loyaltyPoints).toBe(Math.floor(o.totalPaise / 10000)); // 1 point per ₹100
    const detail = (await api.get(`/api/customers/${c.id}`, T.cashier)).body;
    expect(detail.orderCount).toBe(1);
    expect(detail.totalSpentPaise).toBe(o.totalPaise);
    // refund takes the points back
    await api.post(`/api/orders/${o.id}/refund`, T.manager, { reason: 'Refund for points test' });
    const [after] = await db.select().from(customers).where(eq(customers.id, c.id));
    expect(after.loyaltyPoints).toBe(0);
  });
  it('reuses an existing customer by phone and rejects invalid phones', async () => {
    const before = (await db.select().from(customers)).length;
    await api.post('/api/orders', T.cashier, cart({ customerPhone: '9876543210' }));
    expect((await db.select().from(customers)).length).toBe(before);
    expect((await api.post('/api/orders', T.cashier, cart({ customerPhone: 'abc' }))).status).toBe(400);
    expect((await api.post('/api/customers', T.cashier, { name: 'Dup', phone: '9876543210' })).status).toBe(409);
  });
});

describe('kitchen display flow', () => {
  it('moves tickets through New → Preparing → Ready → Served and tracks times', async () => {
    const o = (await api.post('/api/orders', T.cashier, cart({ type: 'DINE_IN', tableId: F.t1.id, notes: 'Less sugar', sendToKitchen: true }))).body;
    const status = (s, tok = T.kitchen) => request(app).patch(`/api/kitchen/orders/${o.id}/status`).set(as(tok)).send({ status: s });
    expect((await status('READY')).status).toBe(409); // cannot skip Preparing
    expect((await status('PREPARING')).status).toBe(200);
    expect((await status('READY')).status).toBe(200);
    let tickets = (await api.get('/api/kitchen/tickets?state=active', T.kitchen)).body;
    const t = tickets.find((x) => x.id === o.id);
    expect(t.kitchenStatus).toBe('READY');
    expect(t.notes).toBe('Less sugar');
    expect(t.tableName).toBe('T1');
    expect(t.prepSeconds).not.toBeNull();
    expect((await status('SERVED', T.cashier)).status).toBe(200);
    tickets = (await api.get('/api/kitchen/tickets?state=active', T.kitchen)).body;
    expect(tickets.find((x) => x.id === o.id)).toBeUndefined();
    const served = (await api.get('/api/kitchen/tickets?state=served', T.kitchen)).body;
    expect(served.find((x) => x.id === o.id)).toBeTruthy();
    // billing status is independent of the kitchen
    const full = (await api.get(`/api/orders/${o.id}`, T.cashier)).body;
    expect(full.paymentStatus).toBe('UNPAID');
    expect(full.kitchenStatus).toBe('SERVED');
    await api.post(`/api/orders/${o.id}/payments`, T.cashier, { method: 'CASH', idempotencyKey: key() });
  });
  it('hides cancelled tickets and blocks status changes on unsent orders', async () => {
    const unsent = (await api.post('/api/orders', T.cashier, cart())).body;
    expect((await request(app).patch(`/api/kitchen/orders/${unsent.id}/status`).set(as(T.kitchen)).send({ status: 'PREPARING' })).status).toBe(409);
    const sent = (await api.post('/api/orders', T.cashier, cart({ sendToKitchen: true }))).body;
    await api.post(`/api/orders/${sent.id}/cancel`, T.manager, { reason: 'Kitchen closed' });
    const tickets = (await api.get('/api/kitchen/tickets', T.kitchen)).body;
    expect(tickets.find((x) => x.id === sent.id)).toBeUndefined();
  });
});

describe('receipts and order history', () => {
  it('returns receipt data and logs reprints', async () => {
    const o = (await api.post('/api/orders', T.cashier, cart())).body;
    await api.post(`/api/orders/${o.id}/payments`, T.cashier, { method: 'UPI', reference: 'DEMO-UPI-1', idempotencyKey: key() });
    const r = (await api.get(`/api/orders/${o.id}/receipt?reprint=1`, T.cashier)).body;
    expect(r.cafe.name).toBeTruthy();
    expect(r.order.items).toHaveLength(1);
    expect(r.order.payments[0].reference).toBe('DEMO-UPI-1');
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.action, 'RECEIPT_REPRINT'));
    expect(logs.length).toBeGreaterThan(0);
  });
  it('filters and searches orders', async () => {
    const paid = (await api.get('/api/orders?paymentStatus=PAID&limit=5', T.cashier)).body;
    expect(paid.rows.every((x) => x.paymentStatus === 'PAID')).toBe(true);
    const row = paid.rows[0];
    const found = (await api.get(`/api/orders?q=${row.orderNumber}`, T.cashier)).body;
    expect(found.total).toBe(1);
    const dine = (await api.get('/api/orders?type=DINE_IN', T.cashier)).body;
    expect(dine.rows.every((x) => x.type === 'DINE_IN')).toBe(true);
    expect((await api.get('/api/orders?from=bad', T.cashier)).status).toBe(400);
    expect((await api.get('/api/orders', T.kitchen)).status).toBe(403);
  });
  it('lets a saved order be edited until it is sent', async () => {
    const o = (await api.post('/api/orders', T.cashier, cart())).body;
    const e = await api.put(`/api/orders/${o.id}`, T.cashier, cart({ items: [{ menuItemId: F.chai.id, quantity: 4 }] }));
    expect(e.body.subtotalPaise).toBe(24000);
    await api.post(`/api/orders/${o.id}/send-kitchen`, T.cashier, {});
    expect((await api.put(`/api/orders/${o.id}`, T.cashier, cart())).status).toBe(409);
  });
});
