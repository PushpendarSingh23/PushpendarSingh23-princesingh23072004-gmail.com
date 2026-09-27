import { newInviteToken, hashInviteToken, hashPassword, issueAccessToken } from '../auth.js';
import { send, badRequest, notFound, conflict, gone, forbidden } from '../http.js';
import { newId } from '../db.js';
import { assertCan } from '../permissions.js';
import { assertRoleExists, roleRanks } from '../lifecycle.js';
import { audit } from '../audit.js';

export function registerInviteRoutes(router, { db, secret }) {
  // POST /v1/orgs/:org/invites (create invite)
  router.post('/v1/orgs/:org/invites', async (ctx, params, res) => {
    assertCan(db, ctx, 'user:invite');

    const { email, role } = ctx.body;
    if (!email || typeof email !== 'string' || !role || typeof role !== 'string') {
      throw badRequest('email and role are required');
    }

    const cleanEmail = email.toLowerCase().trim();
    assertRoleExists(db, role);

    const ranks = roleRanks(db);
    const callerRank = ranks[ctx.role] ?? -1;
    const inviteRank = ranks[role] ?? -1;

    // Caller cannot invite with role at or above their rank, unless owner
    if (callerRank <= inviteRank && ctx.role !== 'owner') {
      throw forbidden('cannot invite with a role at or above your rank');
    }

    // Check if user is already an active member of this org
    const existingMember = db.prepare(`
      SELECT m.id FROM memberships m
      JOIN users u ON u.id = m.user_id
      WHERE m.org_id = ? AND u.email = ? AND m.status != 'removed'
    `).get(ctx.orgId, cleanEmail);

    if (existingMember) {
      throw conflict('user is already a member of this organization');
    }

    // Check if live invite already exists
    const liveInvite = db.prepare(`
      SELECT id FROM invites
      WHERE org_id = ? AND email = ? AND accepted_at IS NULL AND revoked_at IS NULL
    `).get(ctx.orgId, cleanEmail);

    if (liveInvite) {
      throw conflict('a live invite already exists for this email');
    }

    const rawToken = newInviteToken();
    const tokenHash = hashInviteToken(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const inviteId = newId('inv');

    db.prepare(`
      INSERT INTO invites (id, org_id, email, role, token_hash, invited_by, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(inviteId, ctx.orgId, cleanEmail, role, tokenHash, ctx.userId, expiresAt);

    audit(db, {
      orgId: ctx.orgId,
      actorId: ctx.userId,
      action: 'invite:create',
      targetType: 'invite',
      targetId: inviteId,
      result: 'allow',
      requestId: ctx.requestId,
    });

    send(res, 201, {
      id: inviteId,
      email: cleanEmail,
      role,
      expiresAt,
      inviteToken: rawToken,
    });
  });

  // GET /v1/orgs/:org/invites (list invites)
  router.get('/v1/orgs/:org/invites', async (ctx, params, res) => {
    assertCan(db, ctx, 'user:invite');

    const invites = db.prepare(`
      SELECT id, org_id, email, role, invited_by, expires_at, accepted_at, revoked_at, created_at
      FROM invites
      WHERE org_id = ?
      ORDER BY created_at DESC
    `).all(ctx.orgId);

    send(res, 200, { invites });
  });

  // DELETE /v1/orgs/:org/invites/:id (revoke invite)
  router.delete('/v1/orgs/:org/invites/:id', async (ctx, params, res) => {
    assertCan(db, ctx, 'user:invite');

    const invite = db.prepare(
      'SELECT * FROM invites WHERE id = ? AND org_id = ? AND revoked_at IS NULL'
    ).get(params.id, ctx.orgId);

    if (!invite) {
      throw notFound('invite not found');
    }

    const nowIso = new Date().toISOString();
    db.prepare('UPDATE invites SET revoked_at = ? WHERE id = ?').run(nowIso, params.id);

    audit(db, {
      orgId: ctx.orgId,
      actorId: ctx.userId,
      action: 'invite:revoke',
      targetType: 'invite',
      targetId: params.id,
      result: 'allow',
      requestId: ctx.requestId,
    });

    send(res, 200, { success: true });
  });

  // GET /v1/invites/:token (public inspection)
  router.get('/v1/invites/:token', async (ctx, params, res) => {
    const rawToken = params.token;
    const tokenHash = hashInviteToken(rawToken);

    const invite = db.prepare(`
      SELECT i.*, o.name AS org_name
      FROM invites i
      JOIN organizations o ON o.id = i.org_id
      WHERE i.token_hash = ?
    `).get(tokenHash);

    if (!invite) {
      throw notFound('invite not found');
    }

    if (invite.revoked_at !== null || new Date(invite.expires_at) <= new Date()) {
      throw gone('invite has expired or been revoked');
    }

    if (invite.accepted_at !== null) {
      throw conflict('invite has already been accepted');
    }

    send(res, 200, {
      orgName: invite.org_name,
      role: invite.role,
      email: invite.email,
      expiresAt: invite.expires_at,
    });
  });

  // POST /v1/invites/:token/accept (public accept)
  router.post('/v1/invites/:token/accept', async (ctx, params, res) => {
    const rawToken = params.token;
    const tokenHash = hashInviteToken(rawToken);

    const invite = db.prepare(`
      SELECT i.*, o.name AS org_name, o.theme AS org_theme
      FROM invites i
      JOIN organizations o ON o.id = i.org_id
      WHERE i.token_hash = ?
    `).get(tokenHash);

    if (!invite) {
      throw notFound('invite not found');
    }

    if (invite.revoked_at !== null || new Date(invite.expires_at) <= new Date()) {
      throw gone('invite has expired or been revoked');
    }

    if (invite.accepted_at !== null) {
      throw conflict('invite has already been accepted');
    }

    const { name, password } = ctx.body;
    const nowIso = new Date().toISOString();

    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(invite.email);
    if (!user) {
      if (!password || typeof password !== 'string' || password.length < 6) {
        throw badRequest('password must be at least 6 characters');
      }
      const userId = newId('usr');
      const displayName = (name && typeof name === 'string') ? name.trim() : invite.email;
      const passHash = hashPassword(password);
      db.prepare(`
        INSERT INTO users (id, email, name, password_hash, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(userId, invite.email, displayName, passHash, nowIso);
      user = { id: userId, email: invite.email, name: displayName };
    }

    // Attach or update membership (Tier A discovery A1: handle removed/existing membership)
    const existingMem = db.prepare(
      'SELECT id, status FROM memberships WHERE org_id = ? AND user_id = ?'
    ).get(invite.org_id, user.id);

    let memPermVersion = 1;
    if (existingMem) {
      db.prepare(`
        UPDATE memberships
        SET role = ?, status = 'active', joined_at = ?, perm_version = perm_version + 1
        WHERE id = ?
      `).run(invite.role, nowIso, existingMem.id);
      memPermVersion = db.prepare('SELECT perm_version FROM memberships WHERE id = ?').get(existingMem.id).perm_version;
    } else {
      const memId = newId('mem');
      db.prepare(`
        INSERT INTO memberships (id, org_id, user_id, role, status, joined_at, created_at)
        VALUES (?, ?, ?, ?, 'active', ?, ?)
      `).run(memId, invite.org_id, user.id, invite.role, nowIso, nowIso);
    }

    // Mark invite as accepted
    db.prepare(`
      UPDATE invites
      SET accepted_at = ?, accepted_by = ?
      WHERE id = ?
    `).run(nowIso, user.id, invite.id);

    const token = issueAccessToken(
      {
        userId: user.id,
        orgId: invite.org_id,
        role: invite.role,
        permVersion: memPermVersion,
      },
      secret
    );

    audit(db, {
      orgId: invite.org_id,
      actorId: user.id,
      action: 'invite:accept',
      targetType: 'invite',
      targetId: invite.id,
      result: 'allow',
      requestId: ctx.requestId,
    });

    send(res, 200, {
      user: { id: user.id, email: user.email, name: user.name },
      role: invite.role,
      token,
      org: {
        id: invite.org_id,
        name: invite.org_name,
        theme: invite.org_theme,
      },
    });
  });
}
