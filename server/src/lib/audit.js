import { auditLogs } from '../db/schema.js';

export async function audit(dbOrTx, user, action, { entity, entityId, reason, details } = {}) {
  await dbOrTx.insert(auditLogs).values({
    userId: user?.id ?? null, action, entity, entityId: entityId != null ? String(entityId) : null, reason, details,
  });
}
