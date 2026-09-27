// Shared domain rules: role ranks, last-owner protection, ending sessions.
//
// Sources: PERMISSIONS.md §6, §7.2, and D8.

import { forbidden, badRequest, lastOwner } from './http.js';
import { resolve } from './permissions.js';

export function roleRanks(db) {
  const rows = db.prepare('SELECT key, rank, label FROM roles').all();
  const map = {};
  for (const r of rows) {
    map[r.key] = r.rank;
  }
  return map;
}

export function assertRoleExists(db, role) {
  const row = db.prepare('SELECT key FROM roles WHERE key = ?').get(role);
  if (!row) {
    throw badRequest(`unknown role: ${role}`);
  }
  return row;
}

export function assertCanModify(db, callerRole, targetRole, assignedRole = null) {
  const ranks = roleRanks(db);
  const callerRank = ranks[callerRole] ?? -1;
  const targetRank = ranks[targetRole] ?? -1;

  if (callerRole === 'owner') {
    // Owner can modify any role (other owners are allowed, subject to last-owner checks)
    if (assignedRole) {
      assertRoleExists(db, assignedRole);
    }
    return;
  }

  // Non-owner cannot modify someone with equal or higher rank (admin -> admin is 403)
  if (callerRank <= targetRank) {
    throw forbidden(`cannot modify member with role '${targetRole}' at or above your rank`, 'insufficient_rank');
  }

  // If assigning a new role, non-owner cannot assign owner or role at/above own rank
  if (assignedRole) {
    const assignedRank = ranks[assignedRole];
    if (assignedRank === undefined) {
      throw badRequest(`unknown role: ${assignedRole}`);
    }
    if (assignedRole === 'owner' || callerRank <= assignedRank) {
      throw forbidden(`cannot assign role '${assignedRole}' at or above your rank`, 'insufficient_rank');
    }
  }
}

export function assertNotLastOwner(db, orgId, userId) {
  const targetMembership = db.prepare(
    'SELECT role, status FROM memberships WHERE org_id = ? AND user_id = ?'
  ).get(orgId, userId);

  if (targetMembership && targetMembership.role === 'owner' && targetMembership.status === 'active') {
    const activeOwnerCount = db.prepare(
      "SELECT count(*) AS count FROM memberships WHERE org_id = ? AND role = 'owner' AND status = 'active'"
    ).get(orgId).count;

    if (activeOwnerCount <= 1) {
      throw lastOwner();
    }
  }
}

export function endActiveSessions(db, { orgId, userId, deviceId, reason, exceptSessionId }) {
  const nowIso = new Date().toISOString();
  let sql = "UPDATE sessions SET state = 'ended', end_reason = ?, ended_at = ? WHERE org_id = ? AND state = 'active'";
  const params = [reason, nowIso, orgId];

  if (userId) {
    sql += ' AND user_id = ?';
    params.push(userId);
  }
  if (deviceId) {
    sql += ' AND device_id = ?';
    params.push(deviceId);
  }
  if (exceptSessionId) {
    sql += ' AND id != ?';
    params.push(exceptSessionId);
  }

  db.prepare(sql).run(...params);
}

export function snapshotAuthority(db, { userId, orgId, deviceId }) {
  const resolved = resolve(db, { userId, orgId, deviceId });
  return {
    role: resolved.role,
    permissions: resolved.permissions,
    capturedAt: new Date().toISOString(),
  };
}

export function sessionExpiry(db, orgId, startedAt = new Date()) {
  const org = db.prepare('SELECT max_session_minutes FROM organizations WHERE id = ?').get(orgId);
  const minutes = org?.max_session_minutes ?? 60;
  const startMs = startedAt instanceof Date ? startedAt.getTime() : new Date(startedAt).getTime();
  return new Date(startMs + minutes * 60 * 1000).toISOString();
}

