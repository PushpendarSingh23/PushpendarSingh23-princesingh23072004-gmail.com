// The permission resolution engine. THE ONLY PLACE allow-vs-deny is decided.
//
// Reads roles, permissions, role_permissions, and grants dynamically from the database
// at runtime. Never hardcodes any role or permission matrix.

import { forbidden } from './http.js';

export const MODE_PERMISSION = {
  view: 'device:view',
  control: 'device:control',
  terminal: 'device:terminal',
};

// Expand wildcard or concrete patterns into matching permission keys from the dynamic catalogue
function matchPattern(pattern, permissionKey, resource) {
  if (pattern === '*') return true;
  if (pattern === `${resource}:*`) return true;
  return pattern === permissionKey;
}

// Resolve one user's permission set in one org. deviceId === null means the org-level
// view; a deviceId means the exact per-device check.
export function resolve(db, { userId, orgId, deviceId = null, now = new Date() }) {
  const allPermissions = db.prepare('SELECT key, resource, action FROM permissions ORDER BY key').all();

  const membership = db.prepare(
    'SELECT role, status, perm_version FROM memberships WHERE org_id = ? AND user_id = ?'
  ).get(orgId, userId);

  const permissionsResult = {};

  // Case 1: No membership in the requested org (or removed) -> total invisible deny
  if (!membership || membership.status === 'removed') {
    for (const p of allPermissions) {
      permissionsResult[p.key] = { effect: 'deny', source: null, reason: 'not_a_member' };
    }
    return { role: null, permissions: permissionsResult };
  }

  // Case 2: Suspended membership -> all permissions denied with reason: 'suspended'
  if (membership.status === 'suspended') {
    for (const p of allPermissions) {
      permissionsResult[p.key] = { effect: 'deny', source: null, reason: 'suspended' };
    }
    return { role: membership.role, permissions: permissionsResult };
  }

  // Case 3: Active membership (or invited) -> evaluate baseline + grants
  const role = membership.role;
  const baselineRows = db.prepare(
    'SELECT permission FROM role_permissions WHERE role = ?'
  ).all(role);
  const baselineSet = new Set(baselineRows.map((r) => r.permission));

  // Query all active unrevoked grants for (userId, orgId)
  const grantRows = db.prepare(`
    SELECT g.id, g.device_id, g.effect, g.starts_at, g.expires_at, gp.permission AS pattern
    FROM grants g
    JOIN grant_permissions gp ON gp.grant_id = g.id
    WHERE g.user_id = ? AND g.org_id = ? AND g.revoked_at IS NULL
  `).all(userId, orgId);

  const nowIso = now instanceof Date ? now.toISOString() : String(now);

  // Filter applicable grants based on half-open time windows and device scope
  const applicableGrants = grantRows.filter((g) => {
    // Half-open window: starts_at <= now < expires_at
    if (g.starts_at && g.starts_at > nowIso) return false;
    if (g.expires_at && g.expires_at <= nowIso) return false;

    // Device scope matching:
    // If deviceId is null (org-level union), all grants in this org apply.
    // If deviceId is specified, only org-wide grants (g.device_id IS NULL) or matching device grants apply.
    if (deviceId !== null && g.device_id !== null && g.device_id !== deviceId) {
      return false;
    }

    return true;
  });

  // Evaluate each permission in the dynamic catalogue
  for (const p of allPermissions) {
    // 1. Explicit deny always wins (D1) regardless of scope or baseline
    const denyGrant = applicableGrants.find((g) => g.effect === 'deny' && matchPattern(g.pattern, p.key, p.resource));
    if (denyGrant) {
      permissionsResult[p.key] = {
        effect: 'deny',
        source: `grant:${denyGrant.id}`,
        reason: 'explicit_deny',
      };
      continue;
    }

    // 2. Allow from applicable grant (D3)
    const allowGrant = applicableGrants.find((g) => g.effect === 'allow' && matchPattern(g.pattern, p.key, p.resource));
    if (allowGrant) {
      permissionsResult[p.key] = {
        effect: 'allow',
        source: `grant:${allowGrant.id}`,
        reason: null,
      };
      continue;
    }

    // 3. Allow from role baseline
    if (baselineSet.has(p.key)) {
      permissionsResult[p.key] = {
        effect: 'allow',
        source: `role:${role}`,
        reason: null,
      };
      continue;
    }

    // 4. Implicit default deny (D4)
    permissionsResult[p.key] = {
      effect: 'deny',
      source: null,
      reason: 'implicit',
    };
  }

  return { role, permissions: permissionsResult };
}

// Batched form for list endpoints: { role, byDevice: { [deviceId]: permissions } }.
export function resolveDevices(db, { userId, orgId, deviceIds, now = new Date() }) {
  const byDevice = {};
  let userRole = null;

  for (const devId of deviceIds) {
    const res = resolve(db, { userId, orgId, deviceId: devId, now });
    userRole = res.role;
    byDevice[devId] = res.permissions;
  }

  return { role: userRole, byDevice };
}

export function can(db, ctx, permission, deviceId = null) {
  const res = resolve(db, { userId: ctx.userId, orgId: ctx.orgId, deviceId, now: ctx.now });
  return res.permissions[permission]?.effect === 'allow';
}

// Throws 403 carrying the reason code, so a refusal is debuggable.
export function assertCan(db, ctx, permission, deviceId = null) {
  const res = resolve(db, { userId: ctx.userId, orgId: ctx.orgId, deviceId, now: ctx.now });
  const perm = res.permissions[permission];
  if (!perm || perm.effect !== 'allow') {
    const reason = perm?.reason ?? 'missing_permission';
    throw forbidden(`insufficient permission: ${permission}`, reason);
  }
}

// No privilege laundering: you may only grant authority you hold at that scope.
export function assertMayGrant(db, ctx, patterns, deviceId = null) {
  const allPermissions = db.prepare('SELECT key, resource FROM permissions').all();
  const patternList = Array.isArray(patterns) ? patterns : [patterns];

  for (const pat of patternList) {
    const matchingPerms = allPermissions.filter((p) => matchPattern(pat, p.key, p.resource));
    for (const p of matchingPerms) {
      if (!can(db, ctx, p.key, deviceId)) {
        throw forbidden(`cannot grant permission you do not hold: ${p.key}`, 'privilege_laundering');
      }
    }
  }
}

// The compound check: session:start AND the permission for the requested mode, and a
// refusal must distinguish WHICH of the two was missing.
export function assertCanStartSession(db, ctx, mode, deviceId) {
  const resolved = resolve(db, { userId: ctx.userId, orgId: ctx.orgId, deviceId, now: ctx.now });

  // 1. First check session:start
  const startPerm = resolved.permissions['session:start'];
  if (!startPerm || startPerm.effect !== 'allow') {
    throw forbidden('lacking session:start permission', 'missing_permission');
  }

  // 2. Check mode permission on the device
  const modePermKey = MODE_PERMISSION[mode];
  if (!modePermKey) {
    throw forbidden(`invalid session mode: ${mode}`, 'invalid_mode');
  }

  const modePerm = resolved.permissions[modePermKey];
  if (!modePerm || modePerm.effect !== 'allow') {
    throw forbidden(`lacking ${modePermKey} on this device`, 'missing_device_permission');
  }
}

