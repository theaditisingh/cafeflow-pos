import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db, users } from '../src/db/index.js';

export const app = createApp();
export const PASSWORD = 'Test@1234';

export async function resetDb() {
  await db.execute(sql`TRUNCATE users, categories, menu_items, variants, addons, dining_tables, customers, loyalty_transactions,
    orders, order_items, payments, suppliers, ingredients, recipes, purchases, stock_movements, audit_logs, settings RESTART IDENTITY CASCADE`);
}

export async function seedUsers() {
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  await db.insert(users).values([
    { name: 'Owner', email: 'owner@t.test', role: 'OWNER', passwordHash },
    { name: 'Manager', email: 'manager@t.test', role: 'MANAGER', passwordHash },
    { name: 'Cashier', email: 'cashier@t.test', role: 'CASHIER', passwordHash },
    { name: 'Kitchen', email: 'kitchen@t.test', role: 'KITCHEN', passwordHash },
    { name: 'Gone', email: 'gone@t.test', role: 'CASHIER', passwordHash, active: false },
  ]);
}

export async function tokenFor(role) {
  const res = await request(app).post('/api/auth/login').send({ email: `${role.toLowerCase()}@t.test`, password: PASSWORD });
  return res.body.token;
}
export const as = (token) => ({ Authorization: `Bearer ${token}` });

// Small menu + inventory fixture shared by the order/kitchen/report tests.
export async function seedFixture(tokens) {
  const post = async (url, tok, body) => (await request(app).post(url).set(as(tok)).send(body)).body;
  const cat = await post('/api/menu/categories', tokens.manager, { name: 'Coffee' });
  const cap = await post('/api/menu/items', tokens.manager, {
    categoryId: cat.id, name: 'Cappuccino', pricePaise: 16000, variants: [{ name: 'Large', priceDeltaPaise: 4000 }], addons: [{ name: 'Extra shot', pricePaise: 3000 }],
  });
  const chai = await post('/api/menu/items', tokens.manager, { categoryId: cat.id, name: 'Masala Chai', pricePaise: 6000 });
  const off = await post('/api/menu/items', tokens.manager, { categoryId: cat.id, name: 'Seasonal Latte', pricePaise: 20000, available: false });
  const t1 = await post('/api/tables', tokens.manager, { name: 'T1', area: 'INDOOR', capacity: 4 });
  const t2 = await post('/api/tables', tokens.manager, { name: 'T2', area: 'INDOOR', capacity: 2 });
  const milk = await post('/api/inventory/ingredients', tokens.manager, { name: 'Milk', unit: 'ml', minStockQty: 200 });
  const beans = await post('/api/inventory/ingredients', tokens.manager, { name: 'Coffee beans', unit: 'g', minStockQty: 50 });
  const sup = await post('/api/inventory/suppliers', tokens.manager, { name: 'Test Dairy' });
  await post('/api/inventory/purchases', tokens.manager, { supplierId: sup.id, ingredientId: milk.id, quantity: 1000, unitCostPaise: 6 });
  await post('/api/inventory/purchases', tokens.manager, { supplierId: sup.id, ingredientId: beans.id, quantity: 100, unitCostPaise: 120 });
  await request(app).put(`/api/inventory/recipes/${cap.id}`).set(as(tokens.manager)).send({ lines: [{ ingredientId: beans.id, quantity: 18 }, { ingredientId: milk.id, quantity: 150 }] });
  return { cat, cap, chai, off, t1, t2, milk, beans, sup, variantId: cap.variants[0].id, addonId: cap.addons[0].id };
}

export async function login() {
  const t = {};
  for (const r of ['OWNER', 'MANAGER', 'CASHIER', 'KITCHEN']) t[r.toLowerCase()] = await tokenFor(r);
  return t;
}
