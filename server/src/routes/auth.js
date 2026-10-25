import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, users } from '../db/index.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { HttpError } from '../lib/errors.js';

const r = Router();
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

r.post('/login', async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const [u] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
  // Same message for unknown user / wrong password / disabled account.
  if (!u || !u.active || !(await bcrypt.compare(password, u.passwordHash))) throw new HttpError(401, 'Invalid email or password');
  res.json({ token: signToken(u), user: { id: u.id, name: u.name, email: u.email, role: u.role } });
});

r.get('/me', requireAuth, async (req, res) => {
  const [u] = await db.select().from(users).where(eq(users.id, req.user.id));
  if (!u || !u.active) throw new HttpError(401, 'Account disabled');
  res.json({ id: u.id, name: u.name, email: u.email, role: u.role });
});

export default r;
