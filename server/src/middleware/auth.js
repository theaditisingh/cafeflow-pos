import jwt from 'jsonwebtoken';
import { HttpError } from '../lib/errors.js';

const secret = () => process.env.JWT_SECRET || 'test-secret';

export const signToken = (user) =>
  jwt.sign({ id: user.id, role: user.role, name: user.name }, secret(), { expiresIn: '12h' });

export function requireAuth(req, _res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Authentication required'));
  try {
    req.user = jwt.verify(token, secret());
    next();
  } catch {
    next(new HttpError(401, 'Invalid or expired token'));
  }
}

// OWNER is allowed everywhere.
export const requireRole = (...roles) => (req, _res, next) => {
  if (req.user?.role === 'OWNER' || roles.includes(req.user?.role)) return next();
  next(new HttpError(403, 'You do not have permission to do this'));
};
