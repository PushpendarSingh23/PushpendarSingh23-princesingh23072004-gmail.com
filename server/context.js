// Per-request context: turn a bearer token into an authenticated caller.
//
// What it has to do (BRIEF.md §3, PERMISSIONS.md §6):
//   - read the bearer token, verify it with verifyAccessToken() from ./auth.js
//   - look the membership up and refuse a token whose org or membership is gone
//   - THE TOKEN'S org CLAIM IS THE ONLY ORG THE CALLER MAY ADDRESS. A request that
//     names a different org is INVISIBLE — 404, never 403. Isolation is structural:
//     the caller cannot name another org, rather than being filtered afterwards.
//   - check freshness against memberships.perm_version (AUTH-DATA-MODEL.md §3), so a
//     role or grant change takes effect on the NEXT request, not at token expiry
//   - throw through the one error path in ./http.js

import { verifyAccessToken, assertFresh } from './auth.js';
import { unauthenticated, notFound } from './http.js';

export function authenticate(db, secret) {
  return function buildContext(req, params = {}) {
    const authHeader = req.headers['authorization'] ?? req.headers['Authorization'];
    if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      throw unauthenticated('missing or malformed Authorization header');
    }

    const token = authHeader.slice(7).trim();
    const claims = verifyAccessToken(token, secret);

    const membership = db.prepare(
      'SELECT * FROM memberships WHERE org_id = ? AND user_id = ?'
    ).get(claims.org, claims.sub);

    if (!membership || membership.status === 'removed') {
      throw unauthenticated('membership not found or removed');
    }

    // Check permission version freshness (AUTH-DATA-MODEL.md §3)
    assertFresh(claims, membership);

    // Structural org isolation (PERMISSIONS.md §5 / BRIEF.md §3.1)
    // A token for org A naming org B in URL parameter gets 404 NOT_FOUND
    const requestedOrg = params.org ?? params.orgId;
    if (requestedOrg && requestedOrg !== claims.org) {
      throw notFound('organization not found');
    }

    const user = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(claims.sub);
    if (!user) {
      throw unauthenticated('user not found');
    }

    return {
      userId: claims.sub,
      orgId: claims.org,
      role: membership.role,
      membership,
      claims,
      user,
      now: new Date(),
    };
  };
}

