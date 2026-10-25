import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { ZodError } from 'zod';
import authRoutes from './routes/auth.js';
import menuRoutes from './routes/menu.js';
import orderRoutes from './routes/orders.js';
import kitchenRoutes from './routes/kitchen.js';
import tableRoutes from './routes/tables.js';
import customerRoutes from './routes/customers.js';
import inventoryRoutes from './routes/inventory.js';
import reportRoutes from './routes/reports.js';
import { settingsRouter, staffRouter, auditRouter } from './routes/admin.js';

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes);
  app.use('/api/menu', menuRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/kitchen', kitchenRoutes);
  app.use('/api/tables', tableRoutes);
  app.use('/api/customers', customerRoutes);
  app.use('/api/inventory', inventoryRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/settings', settingsRouter);
  app.use('/api/staff', staffRouter);
  app.use('/api/audit', auditRouter);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Route not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    }
    if (err.status) return res.status(err.status).json({ error: err.message, details: err.details });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}
