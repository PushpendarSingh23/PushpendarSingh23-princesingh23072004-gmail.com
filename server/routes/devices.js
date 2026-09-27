import { send, badRequest, notFound, forbidden } from '../http.js';
import { newId } from '../db.js';
import { assertCan, assertMayGrant, resolve, resolveDevices } from '../permissions.js';
import { endActiveSessions } from '../lifecycle.js';
import { audit } from '../audit.js';

export function registerDeviceAndGrantRoutes(router, { db }) {
  // GET /v1/orgs/:org/devices (list devices, with caller's resolved permissions per device)
  router.get('/v1/orgs/:org/devices', async (ctx, params, res) => {
    assertCan(db, ctx, 'device:list');

    const allDevices = db.prepare(`
      SELECT id, org_id, name, kind, online
      FROM devices
      WHERE org_id = ? AND deleted_at IS NULL
      ORDER BY name ASC
    `).all(ctx.orgId);

    if (allDevices.length === 0) {
      return send(res, 200, { devices: [] });
    }

    const deviceIds = allDevices.map((d) => d.id);
    const { byDevice } = resolveDevices(db, {
      userId: ctx.userId,
      orgId: ctx.orgId,
      deviceIds,
      now: ctx.now,
    });

    // PERMISSIONS.md §4: device:view decides whether a device is in the response.
    // Denying device:view on one device removes that row entirely.
    const visibleDevices = allDevices
      .filter((d) => byDevice[d.id]?.['device:view']?.effect === 'allow')
      .map((d) => ({
        id: d.id,
        name: d.name,
        kind: d.kind,
        online: Boolean(d.online),
        permissions: byDevice[d.id],
      }));

    send(res, 200, { devices: visibleDevices });
  });

  // GET /v1/orgs/:org/devices/:id
  router.get('/v1/orgs/:org/devices/:id', async (ctx, params, res) => {
    const dev = db.prepare(`
      SELECT * FROM devices
      WHERE id = ? AND org_id = ? AND deleted_at IS NULL
    `).get(params.id, ctx.orgId);

    if (!dev) {
      throw notFound('device not found');
    }

    assertCan(db, ctx, 'device:view', params.id);

    const resolved = resolve(db, {
      userId: ctx.userId,
      orgId: ctx.orgId,
      deviceId: params.id,
      now: ctx.now,
    });

    send(res, 200, {
      device: {
        id: dev.id,
        name: dev.name,
        kind: dev.kind,
        online: Boolean(dev.online),
        permissions: resolved.permissions,
      },
    });
  });

  // POST /v1/orgs/:org/devices (provision device)
  router.post('/v1/orgs/:org/devices', async (ctx, params, res) => {
    assertCan(db, ctx, 'device:provision');

    const { name, kind } = ctx.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw badRequest('device name is required');
    }

    const validKinds = ['macos', 'windows', 'linux', 'android', 'ios'];
    if (!kind || !validKinds.includes(kind)) {
      throw badRequest(`invalid device kind; must be one of: ${validKinds.join(', ')}`);
    }

    const devId = newId('dev');
    const nowIso = new Date().toISOString();

    db.prepare(`
      INSERT INTO devices (id, org_id, name, kind, online, created_at)
      VALUES (?, ?, ?, ?, 0, ?)
    `).run(devId, ctx.orgId, name.trim(), kind, nowIso);

    audit(db, {
      orgId: ctx.orgId,
      actorId: ctx.userId,
      action: 'device:provision',
      targetType: 'device',
      targetId: devId,
      result: 'allow',
      requestId: ctx.requestId,
    });

    send(res, 201, {
      id: devId,
      name: name.trim(),
      kind,
      online: false,
    });
  });

  // PATCH /v1/orgs/:org/devices/:id (update device)
  router.patch('/v1/orgs/:org/devices/:id', async (ctx, params, res) => {
    const dev = db.prepare(`
      SELECT * FROM devices
      WHERE id = ? AND org_id = ? AND deleted_at IS NULL
    `).get(params.id, ctx.orgId);

    if (!dev) {
      throw notFound('device not found');
    }

    assertCan(db, ctx, 'device:update', params.id);

    const { name, kind, online } = ctx.body;
    const newName = name !== undefined ? String(name).trim() : dev.name;
    const newKind = kind !== undefined ? String(kind) : dev.kind;
    const newOnline = online !== undefined ? (online ? 1 : 0) : dev.online;

    db.prepare(`
      UPDATE devices
      SET name = ?, kind = ?, online = ?
      WHERE id = ?
    `).run(newName, newKind, newOnline, params.id);

    audit(db, {
      orgId: ctx.orgId,
      actorId: ctx.userId,
      action: 'device:update',
      targetType: 'device',
      targetId: params.id,
      result: 'allow',
      requestId: ctx.requestId,
    });

    send(res, 200, {
      device: {
        id: params.id,
        name: newName,
        kind: newKind,
        online: Boolean(newOnline),
      },
    });
  });

  // DELETE /v1/orgs/:org/devices/:id (decommission device)
  router.delete('/v1/orgs/:org/devices/:id', async (ctx, params, res) => {
    const dev = db.prepare(`
      SELECT * FROM devices
      WHERE id = ? AND org_id = ? AND deleted_at IS NULL
    `).get(params.id, ctx.orgId);

    if (!dev) {
      throw notFound('device not found');
    }

    assertCan(db, ctx, 'device:provision', params.id);

    const nowIso = new Date().toISOString();
    db.prepare('UPDATE devices SET deleted_at = ? WHERE id = ?').run(nowIso, params.id);

    endActiveSessions(db, {
      orgId: ctx.orgId,
      deviceId: params.id,
      reason: 'device_transferred',
    });

    audit(db, {
      orgId: ctx.orgId,
      actorId: ctx.userId,
      action: 'device:decommission',
      targetType: 'device',
      targetId: params.id,
      result: 'allow',
      requestId: ctx.requestId,
    });

    send(res, 200, { success: true });
  });

  // POST /v1/orgs/:org/devices/:id/transfer (transfer device between orgs)
  router.post('/v1/orgs/:org/devices/:id/transfer', async (ctx, params, res) => {
    const dev = db.prepare(`
      SELECT * FROM devices
      WHERE id = ? AND org_id = ? AND deleted_at IS NULL
    `).get(params.id, ctx.orgId);

    if (!dev) {
      throw notFound('device not found');
    }

    // Must have device:provision in source org
    assertCan(db, ctx, 'device:provision', params.id);

    const { targetOrgId } = ctx.body;
    if (!targetOrgId || typeof targetOrgId !== 'string') {
      throw badRequest('targetOrgId is required');
    }

    // Must have device:provision in target org
    const targetMembership = db.prepare(`
      SELECT role, status FROM memberships
      WHERE org_id = ? AND user_id = ? AND status != 'removed'
    `).get(targetOrgId, ctx.userId);

    if (!targetMembership) {
      throw notFound('target organization not found or caller has no membership');
    }

    assertCan(db, { userId: ctx.userId, orgId: targetOrgId }, 'device:provision');

    db.prepare('UPDATE devices SET org_id = ? WHERE id = ?').run(targetOrgId, params.id);

    // End active sessions on device
    endActiveSessions(db, {
      orgId: ctx.orgId,
      deviceId: params.id,
      reason: 'device_transferred',
    });

    audit(db, {
      orgId: ctx.orgId,
      actorId: ctx.userId,
      action: 'device:transfer',
      targetType: 'device',
      targetId: params.id,
      result: 'allow',
      requestId: ctx.requestId,
    });

    audit(db, {
      orgId: targetOrgId,
      actorId: ctx.userId,
      action: 'device:transfer',
      targetType: 'device',
      targetId: params.id,
      result: 'allow',
      requestId: ctx.requestId,
    });

    send(res, 200, { success: true });
  });

  // ---------------------------------------------------------------------------
  // GRANTS
  // ---------------------------------------------------------------------------

  // POST /v1/orgs/:org/grants (create grant)
  router.post('/v1/orgs/:org/grants', async (ctx, params, res) => {
    assertCan(db, ctx, 'grant:create');

    const { userId, deviceId = null, effect, permissions, startsAt = null, expiresAt = null } = ctx.body;

    if (!userId || typeof userId !== 'string') {
      throw badRequest('userId is required');
    }

    // D9: No self-grants
    if (userId === ctx.userId) {
      throw forbidden('cannot create grant for yourself', 'self_grant');
    }

    if (!['allow', 'deny'].includes(effect)) {
      throw badRequest("effect must be 'allow' or 'deny'");
    }

    if (!Array.isArray(permissions) || permissions.length === 0) {
      throw badRequest('permissions must be a non-empty array');
    }

    // Validate permission strings against permission_patterns table
    for (const p of permissions) {
      const patternRow = db.prepare('SELECT pattern FROM permission_patterns WHERE pattern = ?').get(p);
      if (!patternRow) {
        throw badRequest(`unknown permission pattern: ${p}`, 'unknown_permission');
      }
    }

    // Target user must exist and have active membership in this org (404 otherwise)
    const targetMember = db.prepare(`
      SELECT id FROM memberships
      WHERE org_id = ? AND user_id = ? AND status != 'removed'
    `).get(ctx.orgId, userId);

    if (!targetMember) {
      throw notFound('target user not found in organization');
    }

    // If deviceId provided, device must exist in this org (404 otherwise)
    if (deviceId !== null) {
      const dev = db.prepare(`
        SELECT id FROM devices
        WHERE id = ? AND org_id = ? AND deleted_at IS NULL
      `).get(deviceId, ctx.orgId);

      if (!dev) {
        throw notFound('device not found in organization');
      }
    }

    // Validate time windows
    const nowIso = new Date().toISOString();
    if (expiresAt !== null) {
      const expDate = new Date(expiresAt);
      if (Number.isNaN(expDate.getTime()) || expDate <= new Date()) {
        throw badRequest('expiresAt must be in the future', 'GRANT_EXPIRED');
      }
    }

    // D9: No privilege laundering — caller must hold every permission at that scope
    assertMayGrant(db, ctx, permissions, deviceId);

    const grantId = newId('grt');
    db.prepare(`
      INSERT INTO grants (id, org_id, user_id, device_id, effect, starts_at, expires_at, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(grantId, ctx.orgId, userId, deviceId, effect, startsAt, expiresAt, ctx.userId, nowIso);

    for (const p of permissions) {
      db.prepare('INSERT INTO grant_permissions (grant_id, permission) VALUES (?, ?)').run(grantId, p);
    }

    // Bump target user's perm_version
    db.prepare('UPDATE memberships SET perm_version = perm_version + 1 WHERE org_id = ? AND user_id = ?').run(
      ctx.orgId,
      userId
    );

    audit(db, {
      orgId: ctx.orgId,
      actorId: ctx.userId,
      action: 'grant:create',
      targetType: 'grant',
      targetId: grantId,
      result: 'allow',
      requestId: ctx.requestId,
    });

    send(res, 201, {
      id: grantId,
      orgId: ctx.orgId,
      userId,
      deviceId,
      effect,
      permissions,
      startsAt,
      expiresAt,
      createdBy: ctx.userId,
    });
  });

  // GET /v1/orgs/:org/grants (list grants)
  router.get('/v1/orgs/:org/grants', async (ctx, params, res) => {
    assertCan(db, ctx, 'user:read');

    const grants = db.prepare(`
      SELECT g.id, g.org_id, g.user_id, g.device_id, g.effect, g.starts_at, g.expires_at,
             g.created_by, g.created_at, json_group_array(gp.permission) AS permissions
      FROM grants g
      JOIN grant_permissions gp ON gp.grant_id = g.id
      WHERE g.org_id = ? AND g.revoked_at IS NULL
      GROUP BY g.id
      ORDER BY g.created_at DESC
    `).all(ctx.orgId).map((g) => ({
      ...g,
      permissions: JSON.parse(g.permissions),
    }));

    send(res, 200, { grants });
  });

  // DELETE /v1/orgs/:org/grants/:id (revoke grant)
  router.delete('/v1/orgs/:org/grants/:id', async (ctx, params, res) => {
    assertCan(db, ctx, 'grant:revoke');

    const grant = db.prepare(`
      SELECT * FROM grants
      WHERE id = ? AND org_id = ? AND revoked_at IS NULL
    `).get(params.id, ctx.orgId);

    if (!grant) {
      throw notFound('grant not found');
    }

    const nowIso = new Date().toISOString();
    db.prepare('UPDATE grants SET revoked_at = ? WHERE id = ?').run(nowIso, params.id);

    // Bump target user's perm_version
    db.prepare('UPDATE memberships SET perm_version = perm_version + 1 WHERE org_id = ? AND user_id = ?').run(
      ctx.orgId,
      grant.user_id
    );

    audit(db, {
      orgId: ctx.orgId,
      actorId: ctx.userId,
      action: 'grant:revoke',
      targetType: 'grant',
      targetId: params.id,
      result: 'allow',
      requestId: ctx.requestId,
    });

    send(res, 200, { success: true });
  });
}
