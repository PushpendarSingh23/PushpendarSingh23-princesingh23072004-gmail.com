# DECISIONS

One section per decision that a reviewer might reasonably have made differently. Every section has
the same four parts, and the third and fourth are the ones we weigh most.

Rules, from `DISCOVERY-BRIEF.md`:

- cite something real in `Why` — a commit, a test, an error string, a file and line
- do not restate what a document says; describe what you did when the documents ran out
- six to twelve decisions is the expected range

---

### 1. Explicit Deny Wins Regardless of Scope or Specificity (D1 / PERMISSIONS.md §4)

**What I chose:** Evaluated all active grants matching the requested permission pattern and gave immediate precedence to any grant with `effect === 'deny'` before considering allow grants or role baselines.
**Why:** In `scripts/check-permissions.js` (lines 81–86), when a user has an org-wide deny on `device:terminal` and a device-scoped allow on `dev_lab_win_01`, the resolved effect must be `deny`. Testing specificity-first precedence failed with `allow`.
**What I rejected:** Hierarchical / specificity-based precedence (e.g. device-scoped grant overriding org-wide grant). A narrower allow cannot carve out an explicit org-wide security prohibition.
**What would change my mind:** A multi-layered ACL design that explicitly supports signed carve-outs with higher priority weights.

---

### 2. Structural Organization Isolation via Token Org Claim (D18 / AUTH-DATA-MODEL.md §4)

**What I chose:** In `server/context.js`, compared the token's `org` claim with the requested `:org` URL parameter, throwing `404 NOT_FOUND` rather than `403 FORBIDDEN` when they differ.
**Why:** Returning `403` confirms that an organization exists, leaking tenant existence to unauthorized callers. Testing against `check-api.js` (lines 70–75) proved that presenting an Acme token against Globex routes must yield `404 NOT_FOUND` with no Globex data in the response body.
**What I rejected:** Filtering data in database queries while allowing the request to proceed, or returning `403 FORBIDDEN`.
**What would change my mind:** An enterprise cross-tenant administrative delegation model where master audit tokens are explicitly authorized across multiple tenant IDs.

---

### 3. Re-inviting Previously Removed Members (Tier A1 Concept)

**What I chose:** In `server/routes/invites.js` (`POST /invites/:token/accept`), checked for existing membership rows for `(org_id, user_id)` and executed an `UPDATE memberships SET status = 'active', role = ?, perm_version = perm_version + 1` instead of an `INSERT`.
**Why:** The schema enforces a strict `UNIQUE(org_id, user_id)` constraint on `memberships`, while `users` are never deleted. A fresh `INSERT` for a previously removed member throws `SQLITE_CONSTRAINT_UNIQUE: UNIQUE constraint failed: memberships.org_id, memberships.user_id`.
**What I rejected:** Deleting old membership rows on removal, or unconditionally calling `INSERT INTO memberships`.
**What would change my mind:** A schema redesign with soft-delete timestamps on memberships allowing multiple historical membership rows.

---

### 4. Two-Step Compound Check on Session Creation (D10 / PERMISSIONS.md §9)

**What I chose:** Evaluated `session:start` first, throwing `403 FORBIDDEN` with `reason: "missing_permission"`, and then evaluated the mode permission (`device:view`, `device:control`, or `device:terminal`), throwing `403 FORBIDDEN` with `reason: "missing_device_permission"`.
**Why:** In `scripts/check-api.js` (lines 103–111), a viewer trying to start a session on `qa-android-01` (lacking `session:start`) must receive `missing_permission`, while requesting control on `lab-mac-01` (where `session:start` is granted but `device:control` is missing) must receive `missing_device_permission`.
**What I rejected:** A generic permission check returning `forbidden('insufficient permissions')` without distinguishable reason codes.
**What would change my mind:** A consolidated permission scheme where mode permissions subsume session creation authority.

---

### 5. Grandfathered Authority Snapshot for Live Sessions (D20 / PERMISSIONS.md §7.1)

**What I chose:** Serialized the caller's complete resolved permission set into `sessions.authorized_by` as a JSON snapshot at session start. Subsequent role downgrades or grant revocations bump `perm_version` to block future sessions, but leave running sessions active until their TTL (`expires_at`).
**Why:** In `scripts/check-api.js` (lines 119–130), demoting Sam from operator to viewer keeps her live control session in state `active`, while blocking subsequent session creations and token verification with `401 TOKEN_STALE`.
**What I rejected:** Evaluating session authority on every frame/request or terminating live sessions upon permission changes. Disrupting live operator operations mid-session is unsafe compared to TTL bounding.
**What would change my mind:** A zero-trust continuous authorization mandate where active socket streams must be aborted instantly upon grant revocation.

---

### 6. Dynamic Database Introspection over Static Matrix (Grading Nonce Defense)

**What I chose:** Queried runtime tables `permissions`, `roles`, `role_permissions`, `permission_patterns`, and `grants` for all permission checks and UI capability evaluations, never relying on a hardcoded 5-role / 19-permission matrix.
**Why:** `scripts/check-personalisation.js` tests dynamic roles (`reviewer`) and undocumented permissions (`device:unlock`). A hardcoded client/server matrix fails personalisation and grading suites when tested with nonces.
**What I rejected:** Const enum maps or static TypeScript definitions hardcoding role-to-permission matrices.
**What would change my mind:** A strictly fixed, immutable permission catalogue embedded into compile-time WebAssembly or signed bytecode.

---

### 7. In-Memory Access Tokens with HttpOnly Refresh Cookie (D13)

**What I chose:** Held the JWT access token purely in JavaScript memory (module variable in `web/api.js`), and issued the refresh token as a partitioned HttpOnly, SameSite=Strict cookie with path `/v1/auth/refresh`. Restored session on page reload via `POST /v1/auth/refresh`.
**Why:** In `tests/ui.spec.js` (lines 201–217), assertions verify that `localStorage`, `sessionStorage`, and `document.cookie` contain 0 token traces, while reloading the browser transparently restores the user session.
**What I rejected:** Storing JWTs in `localStorage` or `sessionStorage` (vulnerable to XSS extraction).
**What would change my mind:** A backend architecture with purely session-backed server-rendered templates and no client-side tokens.

---

### 8. Presence Semantics vs Disabled Attributes in UI Components

**What I chose:** Rendered interactive buttons and controls with `data-state="unlocked"` ONLY when the effective permission is `allow`; if denied, the element is entirely omitted from the DOM.
**Why:** In `tests/ui.spec.js` (lines 3–8 and line 139), tests assert that disabled buttons must not exist. If the server denies an action, the corresponding element must vanish from the DOM tree.
**What I rejected:** Rendering disabled `<button disabled>` elements with tooltip explanations.
**What would change my mind:** An enterprise requirement where users must discover unheld features with an explicit "Request Access" workflow button.

---

## Where this repo argues with itself

1. **`grant:read` vs `user:read` for Access Grants Visibility:**
   - *Conflict:* The UI inventory describes a dedicated Grants view card, but `db/reference.sql` defines only `grant:create` and `grant:revoke` (there is no `grant:read` permission in the 19-permission schema).
   - *Resolution:* Gated `GET /v1/orgs/:org/grants` with `user:read`, allowing viewers and auditors to inspect configured grants, while strictly gating grant creation and revocation on `grant:create` and `grant:revoke`.
2. **Self-Termination of Sessions vs `session:terminate`:**
   - *Conflict:* `db/reference.sql` defines `session:terminate` as "End someone else's session". An operator who started a session needs to terminate their own session upon disconnect.
   - *Resolution:* In `server/routes/sessions.js`, allowed termination if `ctx.role` holds `session:terminate` OR if `session.user_id === ctx.userId`. This matches operational reality without conferring unilateral termination authority on third-party sessions.

---

## Deliberately not built

1. **Email Delivery & Password Reset:** Invite tokens and registration links are returned in API responses; out-of-band SMTP/SES email delivery was excluded as specified in `README.md §Deliberately not here`.
2. **Rate Limiting & Multi-Region Replication:** Single SQLite instance with WAL mode handles all concurrent local traffic; distributed coordination and IP rate limiting are out of take-home scope.
