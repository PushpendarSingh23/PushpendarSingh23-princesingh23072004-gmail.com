// Append-only audit writes.
//
// audit_events has BEFORE UPDATE / BEFORE DELETE triggers, so this module only ever INSERTs.
// Schema columns: id, org_id (NOT NULL), actor_id, action, target_type, target_id,
// result ('allow'|'deny'), reason_code, request_id, at.

import { newId } from './db.js';
import { HttpError } from './http.js';

export function audit(db, { orgId, actorId, action, targetType = null, targetId = null, result, reasonCode = null, requestId = null }) {
  if (!orgId) return; // Cannot audit without an org context

  const id = newId('aud');
  const nowIso = new Date().toISOString();

  db.prepare(`
    INSERT INTO audit_events (id, org_id, actor_id, action, target_type, target_id, result, reason_code, request_id, at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    orgId,
    actorId ?? null,
    action,
    targetType ?? null,
    targetId ?? null,
    result,
    reasonCode ?? null,
    requestId ?? null,
    nowIso
  );
}

// Run fn(); if it refuses with a 403 permission error, record the denial before rethrowing.
export async function auditDenials(db, ctx, meta, fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError && err.status === 403 && ctx?.orgId) {
      try {
        audit(db, {
          orgId: ctx.orgId,
          actorId: ctx.userId ?? null,
          action: meta.action,
          targetType: meta.targetType ?? null,
          targetId: meta.targetId ?? null,
          result: 'deny',
          reasonCode: err.reason ?? null,
          requestId: meta.requestId ?? null,
        });
      } catch (auditErr) {
        console.error('Audit denial write error:', auditErr);
      }
    }
    throw err;
  }
}

