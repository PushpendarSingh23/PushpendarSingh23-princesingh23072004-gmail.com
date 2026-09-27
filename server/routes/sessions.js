import { send, badRequest, notFound, deviceBusy } from '../http.js';
import { newId } from '../db.js';
import { assertCan, assertCanStartSession } from '../permissions.js';
import { snapshotAuthority, sessionExpiry } from '../lifecycle.js';
import { audit } from '../audit.js';

export function registerSessionRoutes(router, { db }) {
  // POST /v1/orgs/:org/sessions (start a new session)
  router.post('/v1/orgs/:org/sessions', async (ctx, params, res) => {
    const { deviceId, mode } = ctx.body;

    if (!deviceId || typeof deviceId !== 'string') {
      throw badRequest('deviceId is required');
    }

    const validModes = ['view', 'control', 'terminal'];
    if (!mode || !validModes.includes(mode)) {
      throw badRequest(`mode must be one of: ${validModes.join(', ')}`);
    }

    // Verify device exists in this org (404 otherwise)
    const dev = db.prepare(`
      SELECT id, org_id, name FROM devices
      WHERE id = ? AND org_id = ? AND deleted_at IS NULL
    `).get(deviceId, ctx.orgId);

    if (!dev) {
      throw notFound('device not found');
    }

    // Compound permission check: session:start AND mode permission
    assertCanStartSession(db, ctx, mode, deviceId);

    // D10: Exclusivity for control and terminal modes
    if (mode === 'control' || mode === 'terminal') {
      const activeExclusive = db.prepare(`
        SELECT id, user_id FROM sessions
        WHERE device_id = ? AND state = 'active' AND mode IN ('control', 'terminal')
      `).get(deviceId);

      if (activeExclusive) {
        throw deviceBusy(`device already has an active exclusive session: ${activeExclusive.id}`);
      }
    }

    const authoritySnapshot = snapshotAuthority(db, {
      userId: ctx.userId,
      orgId: ctx.orgId,
      deviceId,
    });

    const sessId = newId('ses');
    const startedAt = new Date().toISOString();
    const expiresAt = sessionExpiry(db, ctx.orgId, new Date(startedAt));

    db.prepare(`
      INSERT INTO sessions (id, org_id, user_id, device_id, mode, state, authorized_by, started_at, expires_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(
      sessId,
      ctx.orgId,
      ctx.userId,
      deviceId,
      mode,
      JSON.stringify(authoritySnapshot),
      startedAt,
      expiresAt
    );

    audit(db, {
      orgId: ctx.orgId,
      actorId: ctx.userId,
      action: 'session:start',
      targetType: 'session',
      targetId: sessId,
      result: 'allow',
      requestId: ctx.requestId,
    });

    send(res, 201, {
      id: sessId,
      orgId: ctx.orgId,
      userId: ctx.userId,
      deviceId,
      mode,
      state: 'active',
      startedAt,
      expiresAt,
    });
  });

  // GET /v1/orgs/:org/sessions (list sessions in org)
  router.get('/v1/orgs/:org/sessions', async (ctx, params, res) => {
    assertCan(db, ctx, 'session:view');

    const sessions = db.prepare(`
      SELECT s.*, d.name AS device_name, u.name AS user_name, u.email AS user_email
      FROM sessions s
      JOIN devices d ON d.id = s.device_id
      JOIN users u ON u.id = s.user_id
      WHERE s.org_id = ?
      ORDER BY s.started_at DESC
    `).all(ctx.orgId).map((s) => ({
      ...s,
      authorized_by: JSON.parse(s.authorized_by),
    }));

    send(res, 200, { sessions });
  });

  // GET /v1/sessions/:id (get session by id)
  router.get('/v1/sessions/:id', async (ctx, params, res) => {
    const session = db.prepare(`
      SELECT s.*, d.name AS device_name, u.name AS user_name
      FROM sessions s
      JOIN devices d ON d.id = s.device_id
      JOIN users u ON u.id = s.user_id
      WHERE s.id = ?
    `).get(params.id);

    if (!session) {
      throw notFound('session not found');
    }

    // Structural org isolation: session must belong to caller's org
    if (session.org_id !== ctx.orgId) {
      throw notFound('session not found');
    }

    // Check authority: participant or session:view
    if (session.user_id !== ctx.userId) {
      assertCan(db, ctx, 'session:view');
    }

    send(res, 200, {
      ...session,
      authorized_by: JSON.parse(session.authorized_by),
    });
  });

  // DELETE /v1/sessions/:id (end session)
  router.delete('/v1/sessions/:id', async (ctx, params, res) => {
    const session = db.prepare(`
      SELECT * FROM sessions WHERE id = ?
    `).get(params.id);

    if (!session) {
      throw notFound('session not found');
    }

    // Structural org isolation
    if (session.org_id !== ctx.orgId) {
      throw notFound('session not found');
    }

    let endReason = 'user_stopped';
    if (session.user_id !== ctx.userId) {
      assertCan(db, ctx, 'session:terminate');
      endReason = 'admin_terminated';
    }

    const nowIso = new Date().toISOString();
    db.prepare(`
      UPDATE sessions
      SET state = 'ended', end_reason = ?, ended_at = ?
      WHERE id = ?
    `).run(endReason, nowIso, params.id);

    audit(db, {
      orgId: ctx.orgId,
      actorId: ctx.userId,
      action: 'session:terminate',
      targetType: 'session',
      targetId: params.id,
      result: 'allow',
      requestId: ctx.requestId,
    });

    send(res, 200, { success: true });
  });
}
