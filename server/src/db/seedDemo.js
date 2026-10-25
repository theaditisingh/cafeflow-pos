// Demo orders: a week of history + live orders in each kitchen state. Everything is flagged is_demo = true.
import { eq, and } from 'drizzle-orm';
import { db, menuItems, variants, addons, customers, diningTables } from './index.js';
import { createOrder, sendToKitchen, payOrder, setKitchenStatus, cancelOrder, refundOrder } from '../services/orders.js';
import { ymd } from '../lib/settings.js';

let seed = 20261014;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const minutes = (d, m) => new Date(d.getTime() + m * 60000);

export async function seedDemoOrders(owner, manager) {
  const items = await db.select().from(menuItems);
  const vs = await db.select().from(variants);
  const as = await db.select().from(addons);
  const custs = await db.select().from(customers);
  const tbls = await db.select().from(diningTables);
  const byName = Object.fromEntries(items.map((i) => [i.name, i]));
  const tableId = (name) => tbls.find((t) => t.name === name).id;

  const line = (name, quantity = 1, o = {}) => {
    const m = byName[name];
    const v = o.variant ? vs.find((x) => x.menuItemId === m.id && x.name === o.variant) : null;
    const ad = (o.addons ?? []).map((n) => as.find((x) => x.menuItemId === m.id && x.name === n).id);
    return { menuItemId: m.id, variantId: v?.id ?? null, addonIds: ad, quantity, notes: o.notes };
  };
  const menuNames = items.map((i) => i.name);
  const randomCart = () => Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => line(pick(menuNames), 1 + Math.floor(rnd() * 2)));

  let made = 0;
  const attempt = async (fn) => { try { await db.transaction(fn); made++; } catch (e) { if (e.status === 409) return; throw e; } };

  // Order history for the last 6 full days, 4-8 orders per day
  const now = new Date();
  for (let back = 6; back >= 1; back--) {
    const day = new Date(now.getTime() - back * 86400000);
    const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(day);
    const count = 4 + Math.floor(rnd() * 5);
    for (let i = 0; i < count; i++) {
      const hour = 9 + Math.floor((i * 11) / count) + Math.floor(rnd() * 2);
      const at = new Date(`${dateStr}T${String(Math.min(hour, 21)).padStart(2, '0')}:${String(Math.floor(rnd() * 60)).padStart(2, '0')}:00+05:30`);
      await historic(at);
    }
  }
  // Today: orders that already happened this morning/afternoon
  for (let i = 0; i < 5; i++) await historic(minutes(now, -(40 + i * 35)));

  async function historic(at) {
    const type = pick(['DINE_IN', 'DINE_IN', 'TAKEAWAY', 'TAKEAWAY', 'DELIVERY']);
    const dineTable = type === 'DINE_IN' ? tableId(pick(['T1', 'T2', 'T3', 'O1', 'O2'])) : null;
    const cust = rnd() < 0.4 ? pick(custs) : null;
    const discount = rnd() < 0.12 ? { type: 'PERCENT', value: 1000 } : null;
    const roll = rnd();
    const method = roll < 0.5 ? 'UPI' : roll < 0.8 ? 'CASH' : 'CARD';
    await attempt(async (tx) => {
      const o = await createOrder(tx, owner, { type, tableId: dineTable, customerId: cust?.id, discount, items: randomCart(), sendToKitchen: true }, { at, isDemo: true });
      await setKitchenStatus(tx, owner, o.id, 'PREPARING', { at: minutes(at, 2) });
      await setKitchenStatus(tx, owner, o.id, 'READY', { at: minutes(at, 9 + Math.floor(rnd() * 8)) });
      await setKitchenStatus(tx, owner, o.id, 'SERVED', { at: minutes(at, 20) });
      await payOrder(tx, owner, o.id, {
        method, cashReceivedPaise: method === 'CASH' ? Math.ceil(o.totalPaise / 5000) * 5000 : undefined,
        reference: method === 'CASH' ? undefined : `DEMO-${method}-${at.getTime() % 100000}`,
      }, { at: minutes(at, 25) });
    });
  }

  // One cancelled and one refunded order today
  await attempt(async (tx) => {
    const o = await createOrder(tx, owner, { type: 'TAKEAWAY', items: [line('Cold Coffee')], sendToKitchen: false }, { at: minutes(now, -90), isDemo: true });
    await cancelOrder(tx, manager, o.id, 'Customer left before ordering', { at: minutes(now, -85) });
  });
  await attempt(async (tx) => {
    const o = await createOrder(tx, owner, { type: 'TAKEAWAY', items: [line('Chicken Burger', 2)], sendToKitchen: true }, { at: minutes(now, -120), isDemo: true });
    await payOrder(tx, owner, o.id, { method: 'UPI', reference: 'DEMO-UPI-REFUND' }, { at: minutes(now, -118) });
    await refundOrder(tx, manager, o.id, { type: 'REFUND', reason: 'Order was cold, customer complained' }, { at: minutes(now, -100) });
  });

  // Live orders: one in each stage so the floor plan and kitchen screens are not empty
  const ananya = custs[0];
  await attempt((tx) => createOrder(tx, owner, { type: 'DINE_IN', tableId: tableId('T3'), items: [line('Masala Chai', 2), line('Veg Sandwich')], customerId: ananya.id }, { at: minutes(now, -4), isDemo: true }));
  await attempt((tx) => createOrder(tx, owner, { type: 'DINE_IN', tableId: tableId('T1'), items: [line('Cappuccino', 2, { variant: 'Large', addons: ['Extra shot'] }), line('Chocolate Brownie')], sendToKitchen: true, notes: 'Brownie warm please' }, { at: minutes(now, -3), isDemo: true }));
  await attempt(async (tx) => {
    const o = await createOrder(tx, owner, { type: 'TAKEAWAY', items: [line('Margherita Pizza', 1, { variant: '10 inch', addons: ['Extra cheese'] }), line('French Fries', 1, { variant: 'Peri peri' })], sendToKitchen: true, customerId: custs[1].id }, { at: minutes(now, -12), isDemo: true });
    await setKitchenStatus(tx, owner, o.id, 'PREPARING', { at: minutes(now, -9) });
  });
  await attempt(async (tx) => {
    const o = await createOrder(tx, owner, { type: 'DINE_IN', tableId: tableId('O2'), items: [line('Veg Burger', 2), line('Fresh Lime Soda', 2)], sendToKitchen: true }, { at: minutes(now, -18), isDemo: true });
    await setKitchenStatus(tx, owner, o.id, 'PREPARING', { at: minutes(now, -15) });
    await setKitchenStatus(tx, owner, o.id, 'READY', { at: minutes(now, -2) });
  });
  await attempt((tx) => createOrder(tx, owner, { type: 'DELIVERY', items: [line('Chicken Tikka Pizza'), line('Cold Coffee', 2)], sendToKitchen: true, customerId: custs[2].id, customerPhone: custs[2].phone }, { at: minutes(now, -1), isDemo: true }));
  return made;
}
