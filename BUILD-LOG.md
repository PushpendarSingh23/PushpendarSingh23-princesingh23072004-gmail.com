# BUILD-LOG

Append to this as you go. Commit it with the code it describes — the timestamps are part of the
evidence, and a log that arrives in one commit at the end reads as what it is.

Five lines is a real entry. Short and dated is better than long and reconstructed.

The categories we look for are listed in `DISCOVERY-BRIEF.md`. The example below shows the
*shape* of a good entry; it is a recreation of something already printed in `README.md`, so it
gives nothing away.

---

<!-- EXAMPLE — delete this block, keep the shape.

## 2026-03-04 · Phase 0 — orientation

Expected the unknown-permission test to fail on my validation code.
Observed: it passed, with foreign_keys ON, and *also* passed with the pragma removed — so the
check was never running, and the "pass" was the schema loading fine while enforcing nothing.
Changed: moved `foreign_keys = ON` to connection open and re-ran; now it raises
`FOREIGN KEY constraint failed` as the README said it would.
Note: this is the failure mode where a passing test is worse than a failing one.

-->

## Phase 0 — orientation

**2026-09-27 · Initial Environment & Skeleton Verification**

- Installed dependencies and verified runtime environment (Node v24.18.1). Resolved native addon prebuild compatibility by updating `better-sqlite3` to latest prebuilt release.
- Investigated `scripts/load-db.js` and `server/index.js` path handling on Windows: discovered `new URL(path, import.meta.url).pathname` returns POSIX `/C:/...` which causes `ENOENT` (`C:\C:\...`). Corrected with `fileURLToPath(new URL(...))` across loader scripts.
- Seeded `app.db` via `load-db.js`. Examined the personalisation overlay generated from `.candidate-nonce` (`remoteops/CoderDemon07`, fingerprint `84b5b7ff1f8f`):
  - Injected extra organization: `Vantage Works` (`org_p_84b5b7`)
  - Injected undocumented role: `reviewer` (rank 25)
  - Injected undocumented permission: `device:unlock`
  - Per-candidate grants: `dev_p_84b5b7_a` (allow `device:unlock`) and `dev_p_84b5b7_b` (deny `device:unlock`).
- Ran baseline test suites against untouched skeleton:
  - `node scripts/check-jwt.js`: 0 passed, 43 failed (`verifyAccessToken` throws `NOT_IMPLEMENTED`).
  - `node scripts/check-permissions.js`: threw `NOT_IMPLEMENTED` on `resolve()`.
  - `node scripts/check-personalisation.js`: threw `NOT_IMPLEMENTED` on `resolve()`.
- Verified database constraints in SQLite schema: `PRAGMA foreign_keys = ON`, `PRAGMA busy_timeout = 5000`, `STRICT` tables, and trigger-protected `audit_events`.
- Identified Phase 1 target: Implement `verifyAccessToken` in `server/auth.js` to satisfy all 43 tests in `check-jwt.js`.

## Phase 1 — token verification

**2026-09-27 · Access Token Verifier Implementation**

- Implemented `verifyAccessToken` in `server/auth.js` adhering to `AUTH-DATA-MODEL.md §10` and `§2`.
- Initial assumption during verification: standard `Buffer.from(str, 'base64url')` in Node.js might be sufficient for base64url parsing.
- Discovery / correction: Node's `Buffer.from` silently strips or ignores non-base64 characters in some inputs. For tests such as `signature is not base64url` (`!!!not-base64!!!`), an explicit regex guard `/^[A-Za-z0-9_-]+$/` on all three dot-separated segments was required to reject malformed encodings with `401 UNAUTHENTICATED`.
- Implemented constant-time signature comparison using `timingSafeEqual(actualSig, expectedSig)` with explicit buffer length matching to prevent side-channel timing leaks.
- Enforced strict algorithm pinning (`header.alg === 'HS256'`, `header.typ === 'JWT'`) before signature computation.
- Enforced half-open time window semantics (`exp <= nowSec()`) where `exp == now` is strictly treated as expired.
- Validated standard claims (`iss === 'remoteops'`, `aud === 'remoteops-api'`, and non-empty `jti`).
- Result: `node scripts/check-jwt.js` passed all 43 assertions (43 passed, 0 failed).

## Phase 2 — caller context and the resolution engine

**2026-09-27 · Dynamic DB Resolution Engine & Context Isolation**

- Implemented `server/permissions.js` with full runtime introspection of the `permissions`, `roles`, `role_permissions`, and `grants` tables.
- Tested against the candidate overlay (`npm run personalisation`, nonce `remoteops/CoderDemon07`): Verified that dynamic role `reviewer` (rank 25) and extra permission `device:unlock` resolve cleanly without any code modifications.
- Implemented Precedence model (D1): Deny grants evaluate before allow grants or role baselines. Tested case: an org-wide deny on `device:terminal` cannot be carved out by a device-scoped allow.
- Half-open time windows (D7): Checked `starts_at <= now < expires_at` where `expires_at == now` is strictly expired.
- Pattern matching: Supported concrete permissions, `*`, and wildcard namespaces (`device:*`, `session:*`, `grant:*`, `user:*`, `audit:*`, `org:*`).
- Implemented `server/context.js` with structural organization isolation: If token org does not match the URL parameter org, returns `404 NOT_FOUND` rather than `403 FORBIDDEN` to prevent resource/tenant enumeration.
- Result: `node scripts/check-permissions.js` (35/35) and `node scripts/check-personalisation.js` (18/18) passed.

## Phase 3 — orgs, members, invites

**2026-09-27 · Tenancy, Modification Authority, and Invite Lifecycle**

- Implemented `server/routes/orgs.js` and `server/routes/invites.js`.
- Discovered Tier A Concept A1: Because of the `UNIQUE(org_id, user_id)` constraint on `memberships`, re-accepting an invite for a previously removed user would cause SQLite constraint errors if treated as a fresh INSERT. Structured the invite acceptance in a transaction to UPDATE existing membership rows (`status = 'active'`, update role, bump `perm_version`).
- Modification Authority (D8): Implemented `assertCanModify` in `server/lifecycle.js`. Discovered that `owner` can modify other non-last owners, while non-owner admins can only modify strictly lower ranks (`callerRank > targetRank`).
- Protected last owner demotion/removal/leaving with `409 LAST_OWNER`.
- Handled invite secrecy: `GET /v1/invites/:token` returns minimal metadata (`orgName`, `role`, `email`, `expiresAt`) without exposing `org_id` or devices.

## Phase 4 — devices and grants

**2026-09-27 · Device Filtering & Privilege Laundering Guards**

- Implemented `server/routes/devices.js`.
- Implemented Row Visibility Filtering (PERMISSIONS.md §4): `device:list` authorizes accessing the endpoint, while `device:view` evaluated per-device controls row inclusion. Filtered out devices where `device:view` is denied so rows are completely omitted rather than returned with redacted fields.
- Implemented anti-laundering check (`assertMayGrant`): Expands wildcard patterns and checks caller's effective permission at that scope (`can(db, ctx, perm, deviceId)`). Self-grants rejected with `403 FORBIDDEN`.

## Phase 5 — sessions

**2026-09-27 · Compound Session Authorization & Exclusivity**

- Implemented `server/routes/sessions.js`.
- Compound check order: Validated `session:start` first (returning `reason: "missing_permission"` if denied), followed by mode permission on the specific device (returning `reason: "missing_device_permission"` if denied).
- Device Exclusivity (D10): Enforced single active `control` or `terminal` session per device with `409 DEVICE_BUSY`, while allowing multiple concurrent `view` sessions.
- Grandfathering (PERMISSIONS.md §7.1): Snapshotted authority in `authorized_by` on session creation; demonstrated that subsequent user demotion keeps live sessions running until TTL, while immediate token reuse is rejected via `401 TOKEN_STALE`.
- Cascade events: Cascaded immediate termination (`end_reason: 'user_suspended'` / `'membership_removed'` / `'device_transferred'`) upon user suspension, removal, or device decommissioning.

## Phase 6 — audit

**2026-09-27 · Append-Only Audit Logging**

- Implemented `server/audit.js` and wired denial auditing.
- Verified trigger protection: SQLite `BEFORE UPDATE` and `BEFORE DELETE` triggers guarantee audit log immutability.
- Logged both successful state mutations and denied attempts with `result: 'deny'` and `reason_code`.
- Implemented strict pagination bounds validation on `GET /v1/orgs/:org/audit` (limit between 1 and 1000, offset >= 0).
- Result: `node scripts/check-api.js` passed all 66 assertions (66 passed, 0 failed).

## Phase 7 — the console

_Next: Implement React SPA console in web/ with complete UI inventory, permission-driven data-state unlocking, org switcher, and error feedback._

## Phase 8 — hardening

_Pending Playwright UI suite verification._

## Open threads

- UI implementation underway.
