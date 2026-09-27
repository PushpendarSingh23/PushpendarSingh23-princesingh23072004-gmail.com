import {
  issueAccessToken,
  newRefreshToken,
  hashRefreshToken,
  verifyPassword,
  REFRESH_TTL_SECONDS,
} from '../auth.js';
import { send, badRequest, unauthenticated, notFound } from '../http.js';
import { newId } from '../db.js';
import { resolve } from '../permissions.js';

export function registerAuthRoutes(router, { db, secret }) {
  // POST /v1/auth/login
  router.post('/v1/auth/login', async (ctx, params, res) => {
    const { email, password, orgId } = ctx.body;
    if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
      throw unauthenticated('invalid email or password');
    }

    const cleanEmail = email.toLowerCase().trim();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw unauthenticated('invalid email or password');
    }

    // Fetch user memberships in active orgs
    const memberships = db.prepare(`
      SELECT m.*, o.name AS org_name, o.theme AS org_theme, o.max_session_minutes
      FROM memberships m
      JOIN organizations o ON o.id = m.org_id
      WHERE m.user_id = ? AND m.status != 'removed' AND o.deleted_at IS NULL
      ORDER BY o.name ASC
    `).all(user.id);

    if (memberships.length === 0) {
      throw unauthenticated('no active membership found');
    }

    let activeMem = null;
    if (orgId) {
      activeMem = memberships.find((m) => m.org_id === orgId);
      if (!activeMem) {
        throw notFound('organization not found');
      }
    } else {
      activeMem = memberships[0];
    }

    const token = issueAccessToken(
      {
        userId: user.id,
        orgId: activeMem.org_id,
        role: activeMem.role,
        permVersion: activeMem.perm_version,
      },
      secret
    );

    const rawRefresh = newRefreshToken();
    const tokenHash = hashRefreshToken(rawRefresh);
    const familyId = newId('fam');
    const refreshExpires = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000).toISOString();

    db.prepare(`
      INSERT INTO refresh_tokens (id, user_id, token_hash, family_id, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(newId('ref'), user.id, tokenHash, familyId, refreshExpires);

    res.setHeader(
      'Set-Cookie',
      `refresh_token=${rawRefresh}; Path=/v1/auth/refresh; HttpOnly; SameSite=Strict; Max-Age=${REFRESH_TTL_SECONDS}`
    );

    const resolved = resolve(db, { userId: user.id, orgId: activeMem.org_id });

    send(res, 200, {
      user: { id: user.id, email: user.email, name: user.name },
      role: activeMem.role,
      token,
      org: {
        id: activeMem.org_id,
        name: activeMem.org_name,
        theme: activeMem.org_theme,
      },
      orgs: memberships.map((m) => ({
        id: m.org_id,
        name: m.org_name,
        theme: m.org_theme,
        role: m.role,
      })),
      permissions: resolved.permissions,
    });
  });

  // POST /v1/auth/refresh
  router.post('/v1/auth/refresh', async (ctx, params, res) => {
    const cookieHeader = ctx.req.headers['cookie'] ?? '';
    const match = /(?:^|;\s*)refresh_token=([^;]+)/.exec(cookieHeader);
    if (!match) {
      throw unauthenticated('missing refresh cookie');
    }

    const rawToken = match[1];
    const tokenHash = hashRefreshToken(rawToken);

    const row = db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(tokenHash);
    if (!row) {
      throw unauthenticated('invalid refresh token');
    }

    const now = new Date();
    // Replay detection: if revoked token presented, invalidate entire family (D12)
    if (row.revoked_at !== null) {
      db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE family_id = ?').run(
        now.toISOString(),
        row.family_id
      );
      throw unauthenticated('refresh token was already used');
    }

    if (new Date(row.expires_at) <= now) {
      throw unauthenticated('refresh token expired');
    }

    // Revoke old token
    db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?').run(now.toISOString(), row.id);

    // Issue new refresh token in the same family
    const nextRawRefresh = newRefreshToken();
    const nextTokenHash = hashRefreshToken(nextRawRefresh);
    const nextExpires = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000).toISOString();

    db.prepare(`
      INSERT INTO refresh_tokens (id, user_id, token_hash, family_id, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(newId('ref'), row.user_id, nextTokenHash, row.family_id, nextExpires);

    res.setHeader(
      'Set-Cookie',
      `refresh_token=${nextRawRefresh}; Path=/v1/auth/refresh; HttpOnly; SameSite=Strict; Max-Age=${REFRESH_TTL_SECONDS}`
    );

    // Find active membership
    const memberships = db.prepare(`
      SELECT m.*, o.name AS org_name, o.theme AS org_theme
      FROM memberships m
      JOIN organizations o ON o.id = m.org_id
      WHERE m.user_id = ? AND m.status != 'removed' AND o.deleted_at IS NULL
      ORDER BY o.name ASC
    `).all(row.user_id);

    if (memberships.length === 0) {
      throw unauthenticated('user has no active memberships');
    }

    const activeMem = memberships[0];
    const newAccessToken = issueAccessToken(
      {
        userId: row.user_id,
        orgId: activeMem.org_id,
        role: activeMem.role,
        permVersion: activeMem.perm_version,
      },
      secret
    );

    send(res, 200, { token: newAccessToken });
  });

  // POST /v1/auth/token (switch active organization)
  router.post('/v1/auth/token', async (ctx, params, res) => {
    const { orgId } = ctx.body;
    if (!orgId || typeof orgId !== 'string') {
      throw badRequest('orgId is required');
    }

    const targetMem = db.prepare(`
      SELECT m.*, o.name AS org_name, o.theme AS org_theme
      FROM memberships m
      JOIN organizations o ON o.id = m.org_id
      WHERE m.user_id = ? AND m.org_id = ? AND m.status != 'removed' AND o.deleted_at IS NULL
    `).get(ctx.userId, orgId);

    if (!targetMem) {
      throw notFound('organization not found');
    }

    const newToken = issueAccessToken(
      {
        userId: ctx.userId,
        orgId: targetMem.org_id,
        role: targetMem.role,
        permVersion: targetMem.perm_version,
      },
      secret
    );

    const resolved = resolve(db, { userId: ctx.userId, orgId: targetMem.org_id });

    send(res, 200, {
      token: newToken,
      role: targetMem.role,
      org: {
        id: targetMem.org_id,
        name: targetMem.org_name,
        theme: targetMem.org_theme,
      },
      permissions: resolved.permissions,
    });
  });

  // GET /v1/auth/me
  router.get('/v1/auth/me', async (ctx, params, res) => {
    const orgs = db.prepare(`
      SELECT m.org_id AS id, o.name, o.theme, m.role
      FROM memberships m
      JOIN organizations o ON o.id = m.org_id
      WHERE m.user_id = ? AND m.status != 'removed' AND o.deleted_at IS NULL
      ORDER BY o.name ASC
    `).all(ctx.userId);

    const activeOrg = orgs.find((o) => o.id === ctx.orgId);
    if (!activeOrg) {
      throw notFound('organization not found');
    }

    const resolved = resolve(db, { userId: ctx.userId, orgId: ctx.orgId });

    send(res, 200, {
      user: ctx.user,
      role: ctx.role,
      org: activeOrg,
      orgs,
      permissions: resolved.permissions,
    });
  });
}
