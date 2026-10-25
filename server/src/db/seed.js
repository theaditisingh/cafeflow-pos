import bcrypt from 'bcryptjs';
import { sql, eq } from 'drizzle-orm';
import {
  db, pool, users, categories, menuItems, variants, addons, diningTables, customers, suppliers,
  ingredients, recipes, settings, orders,
} from './index.js';
import * as D from './seedData.js';
import { seedDemoOrders } from './seedDemo.js';

const force = process.argv.includes('--force');

const [{ real }] = await db.select({ real: sql`count(*)::int` }).from(orders).where(eq(orders.isDemo, false));
if (real > 0 && !force) {
  console.error(`Refusing to reset: ${real} non-demo order(s) exist. Re-run with --force only if you really want to wipe this database.`);
  await pool.end();
  process.exit(1);
}

await db.transaction(async (tx) => {
  await tx.execute(sql`TRUNCATE users, categories, menu_items, variants, addons, dining_tables, customers, loyalty_transactions,
    orders, order_items, payments, suppliers, ingredients, recipes, purchases, stock_movements, audit_logs, settings RESTART IDENTITY CASCADE`);

  const hash = await bcrypt.hash(D.DEMO_PASSWORD, 10);
  await tx.insert(users).values(D.demoUsers.map((u) => ({ ...u, passwordHash: hash })));

  const cats = await tx.insert(categories).values(D.categoryNames.map((name, i) => ({ name, sortOrder: i }))).returning();
  const catId = Object.fromEntries(cats.map((c) => [c.name, c.id]));

  const itemIds = {};
  for (const [cat, name, rs, isVeg, station, description, vs, as] of D.menu) {
    const [item] = await tx.insert(menuItems).values({
      categoryId: catId[cat], name, description, isVeg, station, pricePaise: rs * 100,
      taxRateBp: D.defaultSettings.defaultTaxRateBp,
    }).returning();
    itemIds[name] = item.id;
    if (vs.length) await tx.insert(variants).values(vs.map(([n, d]) => ({ menuItemId: item.id, name: n, priceDeltaPaise: d * 100 })));
    if (as.length) await tx.insert(addons).values(as.map(([n, p]) => ({ menuItemId: item.id, name: n, pricePaise: p * 100 })));
  }

  await tx.insert(diningTables).values(D.tables.map(([name, area, capacity]) => ({ name, area, capacity })));
  await tx.insert(customers).values(D.customers.map(([name, phone]) => ({ name, phone })));
  await tx.insert(suppliers).values(D.suppliers.map(([name, contactPerson, phone, email]) => ({ name, contactPerson, phone, email })));

  const ings = await tx.insert(ingredients).values(D.ingredients.map(([name, unit, stockQty, minStockQty, costPerUnitPaise]) => ({ name, unit, stockQty, minStockQty, costPerUnitPaise }))).returning();
  const ingId = Object.fromEntries(ings.map((i) => [i.name, i.id]));
  await tx.insert(recipes).values(D.recipes.map(([item, ing, quantity]) => ({ menuItemId: itemIds[item], ingredientId: ingId[ing], quantity })));

  await tx.insert(settings).values(Object.entries(D.defaultSettings).map(([key, value]) => ({ key, value })));
});

const staff = await db.select().from(users);
const made = await seedDemoOrders(staff.find((u) => u.role === 'OWNER'), staff.find((u) => u.role === 'MANAGER'));
console.log(`Created ${made} demo orders (flagged is_demo).`);
console.log('Seeded demo data. Logins (password for all: %s):', D.DEMO_PASSWORD);
for (const u of D.demoUsers) console.log(`  ${u.role.padEnd(8)} ${u.email}`);
await pool.end();
