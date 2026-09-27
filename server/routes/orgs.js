import { send, badRequest, notFound, selfRoleChange, forbidden } from '../http.js';
import { newId } from '../db.js';
import { assertCan, resolve } from '../permissions.js';
import { assertCanModify, assertNotLastOwner, endActiveSessions, roleRanks } from '../lifecycle.js';
import { audit } from '../audit.js';

export function registerOrgRoutes(router, { db }) {
  // GET /v1/orgs (list all orgs caller belongs to)
  router.get('/v1/orgs', async (ctx, params, res) => {
    const orgs = db.prepare(`
      SELECT o.id, o.name, o.theme, o.max_session_minutes, m.role, m.status, m.joined_at
      FROM memberships m
      JOIN organizations o ON o.id = m.org_id
      WHERE m.user_id = ? AND m.status != 'removed' AND o.deleted_at IS NULL
      ORDER BY o.name ASC
    `).all(ctx.userId);

    send(res, 200, { orgs });
  });

  // POST /v1/orgs (create organization, creator becomes owner)
  router.post('/v1/orgs', async (ctx, params, res) => {
    const { name, theme = 'cobalt', maxSessionMinutes = 60 } = ctx.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw badRequest('organization name is required');
    }

    const orgId = newId('org');
    const nowIso = new Date().toISOString();

    db.prepare(`
      INSERT INTO organizations (id, name, theme, max_session_minutes, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(orgId, name.trim(), theme, maxSessionMinutes, nowIso);

    const memId = newId('mem');
    db.prepare(`
      INSERT INTO memberships (id, org_id, user_id, role, status, joined_at, created_at)
      VALUES (?, ?, ?, 'owner', 'active', ?, ?)
    `).run(memId, orgId, ctx.userId, nowIso, nowIso);

    audit(db, {
      orgId,
      actorId: ctx.userId,
      action: 'org:create',
      targetType: 'org',
      targetId: orgId,
      result: 'allow',
      requestId: ctx.requestId,
    });

    send(res, 201, {
      id: orgId,
      name: name.trim(),
      theme,
      maxSessionMinutes,
      role: 'owner',
    });
  });

  // PATCH /v1/orgs/:org (update organization)
  router.patch('/v1/orgs/:org', async (ctx, params, res) => {
    assertCan(db, ctx, 'org:update');

    const org = db.prepare('SELECT * FROM organizations WHERE id = ? AND deleted_at IS NULL').get(ctx.orgId);
    if (!org) {
      throw notFound('organization not found');
    }

    const { name, theme, maxSessionMinutes } = ctx.body;
    const newName = name !== undefined ? String(name).trim() : org.name;
    const newTheme = theme !== undefined ? String(theme) : org.theme;
    const newMaxSession = maxSessionMinutes !== undefined ? Number(maxSessionMinutes) : org.max_session_minutes;

    if (!newName) {
      throw badRequest('organization name cannot be empty');
    }

    db.prepare(`
      UPDATE organizations
      SET name = ?, theme = ?, max_session_minutes = ?
      WHERE id = ?
    `).run(newName, newTheme, newMaxSession, ctx.orgId);

    audit(db, {
      orgId: ctx.orgId,
      actorId: ctx.userId,
      action: 'org:update',
      targetType: 'org',
      targetId: ctx.orgId,
      result: 'allow',
      requestId: ctx.requestId,
    });

    send(res, 200, {
      organization: {
        id: ctx.orgId,
        name: newName,
        theme: newTheme,
        maxSessionMinutes: newMaxSession,
      },
    });
  });

  // DELETE /v1/orgs/:org (delete organization)
  router.delete('/v1/orgs/:org', async (ctx, params, res) => {
    assertCan(db, ctx, 'org:delete');

    const nowIso = new Date().toISOString();
    db.prepare('UPDATE organizations SET deleted_at = ? WHERE id = ?').run(nowIso, ctx.orgId);

    endActiveSessions(db, { orgId: ctx.orgId, reason: 'admin_terminated' });

    audit(db, {
      orgId: ctx.orgId,
      actorId: ctx.userId,
      action: 'org:delete',
      targetType: 'org',
      targetId: ctx.orgId,
      result: 'allow',
      requestId: ctx.requestId,
    });

    send(res, 200, { success: true });
  });

  // GET /v1/orgs/:org/members
  router.get('/v1/orgs/:org/members', async (ctx, params, res) => {
    assertCan(db, ctx, 'user:read');

    const members = db.prepare(`
      SELECT m.id, m.user_id, u.email, u.name, m.role, m.status, m.perm_version, m.joined_at, m.created_at
      FROM memberships m
      JOIN users u ON u.id = m.user_id
      WHERE m.org_id = ? AND m.status != 'removed'
      ORDER BY u.name ASC
    `).all(ctx.orgId);

    send(res, 200, { members });
  });

  // DELETE /v1/orgs/:org/members/me (self leave - register before :userId!)
  router.delete('/v1/orgs/:org/members/me', async (ctx, params, res) => {
    assertNotLastOwner(db, ctx.orgId, ctx.userId);

    const nowIso = new Date().toISOString();
    db.prepare(`
      UPDATE memberships
      SET status = 'removed', perm_version = perm_version + 1
      WHERE org_id = ? AND user_id = ?
    `).run(ctx.orgId, ctx.userId);

    endActiveSessions(db, {
      orgId: ctx.orgId,
      userId: ctx.userId,
      reason: 'membership_removed',
    });

    audit(db, {
      orgId: ctx.orgId,
      actorId: ctx.userId,
      action: 'user:leave',
      targetType: 'user',
      targetId: ctx.userId,
      result: 'allow',
      requestId: ctx.requestId,
    });

    send(res, 200, { success: true });
  });

  // PATCH /v1/orgs/:org/members/:userId (update member role)
  router.patch('/v1/orgs/:org/members/:userId', async (ctx, params, res) => {
    assertCan(db, ctx, 'user:role:update');

    const targetUserId = params.userId;
    if (targetUserId === ctx.userId) {
      throw selfRoleChange();
    }

    const { role: newRole } = ctx.body;
    if (!newRole || typeof newRole !== 'string') {
      throw badRequest('role is required');
    }

    const targetMem = db.prepare(
      'SELECT * FROM memberships WHERE org_id = ? AND user_id = ? AND status != \'removed\''
    ).get(ctx.orgId, targetUserId);

    if (!targetMem) {
      throw notFound('member not found');
    }

    assertCanModify(db, ctx.role, targetMem.role, newRole);

    if (targetMem.role === 'owner' && newRole !== 'owner') {
      assertNotLastOwner(db, ctx.orgId, targetUserId);
    }

    db.prepare(`
      UPDATE memberships
      SET role = ?, perm_version = perm_version + 1
      WHERE org_id = ? AND user_id = ?
    `).run(newRole, ctx.orgId, targetUserId);

    audit(db, {
      orgId: ctx.orgId,
      actorId: ctx.userId,
      action: 'user:role:update',
      targetType: 'user',
      targetId: targetUserId,
      result: 'allow',
      requestId: ctx.requestId,
    });

    send(res, 200, { success: true });
  });

  // POST /v1/orgs/:org/members/:userId/suspend
  router.post('/v1/orgs/:org/members/:userId/suspend', async (ctx, params, res) => {
    assertCan(db, ctx, 'user:remove');

    const targetUserId = params.userId;
    if (targetUserId === ctx.userId) {
      throw forbidden('cannot suspend yourself');
    }

    const targetMem = db.prepare(
      'SELECT * FROM memberships WHERE org_id = ? AND user_id = ? AND status != \'removed\''
    ).get(ctx.orgId, targetUserId);

    if (!targetMem) {
      throw notFound('member not found');
    }

    assertCanModify(db, ctx.role, targetMem.role);
    if (targetMem.role === 'owner') {
      assertNotLastOwner(db, ctx.orgId, targetUserId);
    }

    db.prepare(`
      UPDATE memberships
      SET status = 'suspended', perm_version = perm_version + 1
      WHERE org_id = ? AND user_id = ?
    `).run(ctx.orgId, targetUserId);

    endActiveSessions(db, {
      orgId: ctx.orgId,
      userId: targetUserId,
      reason: 'user_suspended',
    });

    audit(db, {
      orgId: ctx.orgId,
      actorId: ctx.userId,
      action: 'user:suspend',
      targetType: 'user',
      targetId: targetUserId,
      result: 'allow',
      requestId: ctx.requestId,
    });

    send(res, 200, { success: true });
  });

  // DELETE /v1/orgs/:org/members/:userId/suspend (reinstate)
  router.delete('/v1/orgs/:org/members/:userId/suspend', async (ctx, params, res) => {
    assertCan(db, ctx, 'user:remove');

    const targetUserId = params.userId;
    const targetMem = db.prepare(
      'SELECT * FROM memberships WHERE org_id = ? AND user_id = ?'
    ).get(ctx.orgId, targetUserId);

    if (!targetMem || targetMem.status === 'removed') {
      throw notFound('member not found');
    }

    assertCanModify(db, ctx.role, targetMem.role);

    db.prepare(`
      UPDATE memberships
      SET status = 'active', perm_version = perm_version + 1
      WHERE org_id = ? AND user_id = ?
    `).run(ctx.orgId, targetUserId);

    audit(db, {
      orgId: ctx.orgId,
      actorId: ctx.userId,
      action: 'user:reinstate',
      targetType: 'user',
      targetId: targetUserId,
      result: 'allow',
      requestId: ctx.requestId,
    });

    send(res, 200, { success: true });
  });

  // DELETE /v1/orgs/:org/members/:userId (remove member)
  router.delete('/v1/orgs/:org/members/:userId', async (ctx, params, res) => {
    assertCan(db, ctx, 'user:remove');

    const targetUserId = params.userId;
    if (targetUserId === ctx.userId) {
      throw forbidden('use leave endpoint to remove yourself');
    }

    const targetMem = db.prepare(
      'SELECT * FROM memberships WHERE org_id = ? AND user_id = ? AND status != \'removed\''
    ).get(ctx.orgId, targetUserId);

    if (!targetMem) {
      throw notFound('member not found');
    }

    assertCanModify(db, ctx.role, targetMem.role);
    if (targetMem.role === 'owner') {
      assertNotLastOwner(db, ctx.orgId, targetUserId);
    }

    db.prepare(`
      UPDATE memberships
      SET status = 'removed', perm_version = perm_version + 1
      WHERE org_id = ? AND user_id = ?
    `).run(ctx.orgId, targetUserId);

    endActiveSessions(db, {
      orgId: ctx.orgId,
      userId: targetUserId,
      reason: 'membership_removed',
    });

    audit(db, {
      orgId: ctx.orgId,
      actorId: ctx.userId,
      action: 'user:remove',
      targetType: 'user',
      targetId: targetUserId,
      result: 'allow',
      requestId: ctx.requestId,
    });

    send(res, 200, { success: true });
  });

  // GET /v1/orgs/:org/users/:userId/effective (effective permissions)
  router.get('/v1/orgs/:org/users/:userId/effective', async (ctx, params, res) => {
    const targetUserId = params.userId;
    if (targetUserId !== ctx.userId) {
      assertCan(db, ctx, 'user:read');
    }

    const targetMem = db.prepare(
      'SELECT role, status FROM memberships WHERE org_id = ? AND user_id = ?'
    ).get(ctx.orgId, targetUserId);

    if (!targetMem || targetMem.status === 'removed') {
      throw notFound('user not found in organization');
    }

    const deviceId = ctx.query.get('deviceId') || null;
    const resolved = resolve(db, { userId: targetUserId, orgId: ctx.orgId, deviceId });

    send(res, 200, {
      role: resolved.role,
      permissions: resolved.permissions,
    });
  });

  // GET /v1/orgs/:org/audit
  router.get('/v1/orgs/:org/audit', async (ctx, params, res) => {
    assertCan(db, ctx, 'audit:read');

    const limitStr = ctx.query.get('limit');
    const offsetStr = ctx.query.get('offset');

    let limit = 50;
    let offset = 0;

    if (limitStr !== null) {
      const parsed = Number(limitStr);
      if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 1000) {
        throw badRequest('limit must be an integer between 1 and 1000');
      }
      limit = parsed;
    }

    if (offsetStr !== null) {
      const parsed = Number(offsetStr);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw badRequest('offset must be an integer >= 0');
      }
      offset = parsed;
    }

    const events = db.prepare(`
      SELECT * FROM audit_events
      WHERE org_id = ?
      ORDER BY at DESC
      LIMIT ? OFFSET ?
    `).all(ctx.orgId, limit, offset);

    send(res, 200, { events });
  });
}
