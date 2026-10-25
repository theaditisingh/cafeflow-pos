import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app, resetDb, seedUsers, as, login, seedFixture } from './helpers.js';

let T, F;
const get = (u, t) => request(app).get(u).set(as(t));
const post = (u, t, b) => request(app).post(u).set(as(t)).send(b);
const put = (u, t, b) => request(app).put(u).set(as(t)).send(b);
let k = 0;
const pay = (id, method = 'UPI') => post(`/api/orders/${id}/payments`, T.cashier, { method, idempotencyKey: `rep-key-${Date.now()}-${++k}` });

beforeAll(async () => {
  await resetDb(); await seedUsers(); T = await login(); F = await seedFixture(T);
});

describe('inventory', () => {
  it('records purchases, adjustments and a movement history', async () => {
    const before = (await get('/api/inventory/ingredients', T.manager)).body.find((i) => i.id === F.milk.id).stockQty;
    await post('/api/inventory/purchases', T.manager, { supplierId: F.sup.id, ingredientId: F.milk.id, quantity: 500, unitCostPaise: 7, invoiceNo: 'INV-9' });
    const adj = await post('/api/inventory/adjustments', T.manager, { ingredientId: F.milk.id, delta: -50, reason: 'Spilled' });
    expect(adj.body.stockQty).toBe(before + 450);
    const mv = (await get(`/api/inventory/movements?ingredientId=${F.milk.id}`, T.manager)).body;
    expect(mv.map((m) => m.type)).toEqual(expect.arrayContaining(['PURCHASE', 'ADJUSTMENT']));
    expect(mv.find((m) => m.type === 'ADJUSTMENT').reason).toBe('Spilled');
  });
  it('requires a reason and blocks negative stock unless explicitly allowed', async () => {
    expect((await post('/api/inventory/adjustments', T.manager, { ingredientId: F.beans.id, delta: -1 })).status).toBe(400);
    expect((await post('/api/inventory/adjustments', T.manager, { ingredientId: F.beans.id, delta: -99999, reason: 'Oops' })).status).toBe(409);
    await put(`/api/inventory/ingredients/${F.beans.id}`, T.manager, { allowNegative: true });
    expect((await post('/api/inventory/adjustments', T.manager, { ingredientId: F.beans.id, delta: -150, reason: 'Count correction' })).body.stockQty).toBe(-50);
    await put(`/api/inventory/ingredients/${F.beans.id}`, T.manager, { allowNegative: false });
  });
  it('flags low stock and is manager-only', async () => {
    const low = (await get('/api/inventory/low-stock', T.manager)).body;
    expect(low.some((i) => i.id === F.beans.id)).toBe(true);
    expect((await get('/api/inventory/ingredients', T.cashier)).status).toBe(403);
    expect((await get('/api/inventory/ingredients', T.kitchen)).status).toBe(403);
  });
  it('validates recipes', async () => {
    const dup = await put(`/api/inventory/recipes/${F.cap.id}`, T.manager, { lines: [{ ingredientId: F.milk.id, quantity: 1 }, { ingredientId: F.milk.id, quantity: 2 }] });
    expect(dup.status).toBe(400);
    expect((await put(`/api/inventory/recipes/${F.cap.id}`, T.manager, { lines: [{ ingredientId: F.milk.id, quantity: -1 }] })).status).toBe(400);
  });
});

describe('reports and dashboard', () => {
  let a, b;
  beforeAll(async () => {
    // Make sure recipes cannot block these orders
    await put(`/api/inventory/recipes/${F.cap.id}`, T.manager, { lines: [] });
    a = (await post('/api/orders', T.cashier, { type: 'TAKEAWAY', items: [{ menuItemId: F.chai.id, quantity: 2 }] })).body; // 12000 + 600 = 12600
    b = (await post('/api/orders', T.manager, { type: 'DELIVERY', items: [{ menuItemId: F.cap.id, quantity: 1 }], discount: { type: 'PERCENT', value: 1000 } })).body; // 16000 - 1600, tax 720 = 15120
    await pay(a.id, 'CASH'); await pay(b.id, 'UPI');
    const c = (await post('/api/orders', T.cashier, { type: 'DINE_IN', tableId: F.t1.id, items: [{ menuItemId: F.chai.id, quantity: 1 }] })).body;
    await post(`/api/orders/${c.id}/cancel`, T.cashier, { reason: 'Walked out' });
  });
  it('computes sales, tax, discount and payment breakdown from stored orders', async () => {
    const s = (await get('/api/reports/sales', T.manager)).body;
    expect(s.summary.orders).toBe(2);
    expect(s.summary.totalCollectedPaise).toBe(27720);
    expect(s.summary.taxPaise).toBe(1320);
    expect(s.summary.discountPaise).toBe(1600);
    expect(s.summary.netSalesPaise).toBe(26400);
    expect(s.summary.grossSalesPaise).toBe(28000);
    expect(s.summary.avgOrderValuePaise).toBe(13860);
    expect(Object.fromEntries(s.payments.map((p) => [p.method, p.amountPaise]))).toEqual({ CASH: 12600, UPI: 15120 });
  });
  it('powers the owner dashboard with live numbers that change with refunds', async () => {
    let d = (await get('/api/reports/dashboard', T.owner)).body;
    expect(d.today.totalCollectedPaise).toBe(27720);
    expect(d.typeCounts).toEqual({ DINE_IN: 0, TAKEAWAY: 1, DELIVERY: 1 }); // cancelled order excluded
    expect(d.trend).toHaveLength(7);
    expect(d.trend[6].totalCollectedPaise).toBe(27720);
    expect(d.topItems[0].name).toBe('Masala Chai');
    expect(d.recentOrders.length).toBeGreaterThan(0);
    expect(d.lowStock.length).toBeGreaterThan(0);
    await post(`/api/orders/${a.id}/refund`, T.manager, { reason: 'Quality complaint' });
    d = (await get('/api/reports/dashboard', T.owner)).body;
    expect(d.today.totalCollectedPaise).toBe(15120);
    expect(d.today.refundsPaise).toBe(12600);
  });
  it('reports items, categories and cancellations', async () => {
    const items = (await get('/api/reports/items', T.manager)).body;
    expect(items.find((i) => i.name === 'Cappuccino').quantity).toBe(1);
    const cats = (await get('/api/reports/categories', T.manager)).body;
    expect(cats[0].name).toBe('Coffee');
    const canc = (await get('/api/reports/cancellations', T.manager)).body;
    expect(canc[0].reason).toBe('Walked out');
    expect(canc[0].cancelledBy).toBe('Cashier');
  });
  it('exports CSV and blocks formula injection', async () => {
    const r = await get('/api/reports/sales?format=csv', T.manager);
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    expect(r.text.split('\r\n')[0]).toBe('Date,Orders,Gross sales (INR),Discounts (INR),Net sales (INR),Tax collected (INR),Total collected (INR)');
    const { toCsv } = await import('../src/lib/csv.js');
    const out = toCsv([{ n: '=HYPERLINK("x")' }, { n: 'a,b' }, { n: '-5' }], [{ label: 'N', key: 'n' }]);
    expect(out).toBe('N\r\n"\'=HYPERLINK(""x"")"\r\n"a,b"\r\n-5');
  });
  it('validates dates and restricts reports to managers', async () => {
    expect((await get('/api/reports/sales?from=nope', T.manager)).status).toBe(400);
    expect((await get('/api/reports/dashboard', T.cashier)).status).toBe(403);
    expect((await get('/api/reports/sales', T.kitchen)).status).toBe(403);
    const range = (await get('/api/reports/sales?from=2000-01-01&to=2000-01-03', T.manager)).body;
    expect(range.daily).toHaveLength(3);
    expect(range.summary.orders).toBe(0);
  });
});

describe('settings, staff and audit log', () => {
  it('lets everyone read settings but only managers change them (with validation)', async () => {
    expect((await get('/api/settings', T.cashier)).body.currency).toBe('INR');
    expect((await put('/api/settings', T.cashier, { cafeName: 'Hacked' })).status).toBe(403);
    expect((await put('/api/settings', T.manager, { defaultTaxRateBp: 99999 })).status).toBe(400);
    expect((await put('/api/settings', T.manager, { notASetting: 1 })).status).toBe(400);
    expect((await put('/api/settings', T.manager, { cafeName: 'Chai Point', receiptFooter: 'Thanks!' })).body.cafeName).toBe('Chai Point');
  });
  it('supports tax-inclusive pricing as a setting', async () => {
    await put('/api/settings', T.manager, { taxInclusive: true });
    const o = (await post('/api/orders', T.cashier, { type: 'TAKEAWAY', items: [{ menuItemId: F.chai.id, quantity: 1 }] })).body;
    expect(o.totalPaise).toBe(6000);
    expect(o.taxPaise).toBe(286); // 6000 * 500 / 10500
    await put('/api/settings', T.manager, { taxInclusive: false });
  });
  it('limits staff management to the owner and protects accounts', async () => {
    expect((await get('/api/staff', T.manager)).status).toBe(403);
    const list = (await get('/api/staff', T.owner)).body;
    expect(JSON.stringify(list)).not.toMatch(/hash/i);
    expect((await post('/api/staff', T.owner, { name: 'New', email: 'new@t.test', password: 'short', role: 'CASHIER' })).status).toBe(400);
    const c = await post('/api/staff', T.owner, { name: 'New Cashier', email: 'new@t.test', password: 'LongEnough1', role: 'CASHIER' });
    expect(c.status).toBe(201);
    expect((await post('/api/staff', T.owner, { name: 'Dup', email: 'new@t.test', password: 'LongEnough1', role: 'CASHIER' })).status).toBe(409);
    const login = await request(app).post('/api/auth/login').send({ email: 'new@t.test', password: 'LongEnough1' });
    expect(login.status).toBe(200);
    await put(`/api/staff/${c.body.id}`, T.owner, { active: false });
    expect((await request(app).post('/api/auth/login').send({ email: 'new@t.test', password: 'LongEnough1' })).status).toBe(401);
    const ownerId = list.find((u) => u.role === 'OWNER').id;
    expect((await put(`/api/staff/${ownerId}`, T.owner, { active: false })).status).toBe(400);
  });
  it('exposes the audit log to managers with who/what/why', async () => {
    const logs = (await get('/api/audit?limit=200', T.manager)).body;
    const actions = logs.map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(['PAYMENT_REFUND', 'ORDER_CANCEL', 'SETTINGS_UPDATE', 'STOCK_ADJUSTMENT', 'STAFF_CREATE']));
    expect(logs.find((l) => l.action === 'PAYMENT_REFUND').reason).toBe('Quality complaint');
    expect((await get('/api/audit', T.cashier)).status).toBe(403);
  });
});
