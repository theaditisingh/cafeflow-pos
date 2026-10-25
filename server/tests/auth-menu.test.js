import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app, resetDb, seedUsers, tokenFor, as, PASSWORD } from './helpers.js';

let owner, manager, cashier, kitchen, catId;

beforeAll(async () => {
  await resetDb();
  await seedUsers();
  [owner, manager, cashier, kitchen] = await Promise.all(['OWNER', 'MANAGER', 'CASHIER', 'KITCHEN'].map(tokenFor));
  const c = await request(app).post('/api/menu/categories').set(as(manager)).send({ name: 'Coffee' });
  catId = c.body.id;
});

describe('authentication', () => {
  it('logs in with valid credentials and never returns the hash', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'owner@t.test', password: PASSWORD });
    expect(r.status).toBe(200);
    expect(r.body.token).toBeTruthy();
    expect(JSON.stringify(r.body)).not.toMatch(/hash/i);
  });
  it('rejects wrong password, unknown user and disabled accounts identically', async () => {
    const bodies = [];
    for (const [email, password] of [['owner@t.test', 'nope'], ['nobody@t.test', PASSWORD], ['gone@t.test', PASSWORD]]) {
      const r = await request(app).post('/api/auth/login').send({ email, password });
      expect(r.status).toBe(401);
      bodies.push(r.body.error);
    }
    expect(new Set(bodies).size).toBe(1);
  });
  it('validates the login body', async () => {
    expect((await request(app).post('/api/auth/login').send({ email: 'x' })).status).toBe(400);
  });
  it('protects routes and rejects bad tokens', async () => {
    expect((await request(app).get('/api/menu/items')).status).toBe(401);
    expect((await request(app).get('/api/menu/items').set(as('garbage'))).status).toBe(401);
  });
});

describe('role permissions on the menu', () => {
  const item = () => ({ categoryId: catId, name: 'Cappuccino', pricePaise: 16000 });

  it('lets manager and owner create items; blocks cashier and kitchen', async () => {
    expect((await request(app).post('/api/menu/items').set(as(cashier)).send(item())).status).toBe(403);
    expect((await request(app).post('/api/menu/items').set(as(kitchen)).send(item())).status).toBe(403);
    expect((await request(app).post('/api/menu/items').set(as(manager)).send(item())).status).toBe(201);
    expect((await request(app).post('/api/menu/items').set(as(owner)).send({ ...item(), name: 'Espresso' })).status).toBe(201);
  });
  it('lets every role read the menu', async () => {
    for (const t of [owner, manager, cashier, kitchen]) {
      expect((await request(app).get('/api/menu/items').set(as(t))).status).toBe(200);
    }
  });
});

describe('menu rules', () => {
  it('rejects invalid prices', async () => {
    for (const pricePaise of [-1, 10.5, 'free']) {
      const r = await request(app).post('/api/menu/items').set(as(manager)).send({ categoryId: catId, name: 'Bad', pricePaise });
      expect(r.status).toBe(400);
    }
  });
  it('saves variants and add-ons, and replaces them on edit', async () => {
    const created = await request(app).post('/api/menu/items').set(as(manager)).send({
      categoryId: catId, name: 'Latte', pricePaise: 18000,
      variants: [{ name: 'Large', priceDeltaPaise: 4000 }], addons: [{ name: 'Extra shot', pricePaise: 3000 }],
    });
    expect(created.body.variants).toHaveLength(1);
    const edited = await request(app).put(`/api/menu/items/${created.body.id}`).set(as(manager)).send({ addons: [] });
    expect(edited.body.addons).toHaveLength(0);
    expect(edited.body.variants).toHaveLength(1);
  });
  it('lets a cashier toggle availability and hides unavailable items on request', async () => {
    const list = (await request(app).get('/api/menu/items').set(as(cashier))).body;
    const id = list.find((i) => i.name === 'Espresso').id;
    expect((await request(app).patch(`/api/menu/items/${id}/availability`).set(as(cashier)).send({ available: false })).status).toBe(200);
    const avail = (await request(app).get('/api/menu/items?available=true').set(as(cashier))).body;
    expect(avail.find((i) => i.id === id)).toBeUndefined();
  });
  it('archives items instead of deleting them and refuses to archive a non-empty category', async () => {
    expect((await request(app).delete(`/api/menu/categories/${catId}`).set(as(manager))).status).toBe(409);
    const list = (await request(app).get('/api/menu/items').set(as(manager))).body;
    const id = list.find((i) => i.name === 'Latte').id;
    expect((await request(app).delete(`/api/menu/items/${id}`).set(as(manager))).status).toBe(204);
    const after = (await request(app).get('/api/menu/items').set(as(manager))).body;
    expect(after.find((i) => i.id === id)).toBeUndefined();
  });
});
