# DECISIONS

One section per decision that a reviewer might reasonably have made differently. Every section has
the same four parts, and the third and fourth are the ones we weigh most.

Rules, from `DISCOVERY-BRIEF.md`:

- cite something real in `Why` — a commit, a test, an error string, a file and line
- do not restate what a document says; describe what you did when the documents ran out
- six to twelve decisions is the expected range

---

### Explicit Deny Wins Regardless of Scope or Specificity (D1 / PERMISSIONS.md §4)

**What I chose:** Evaluated all active grants matching the requested permission pattern and gave immediate precedence to any grant with `effect === 'deny'` before considering allow grants or role baselines.
**Why:** In `scripts/check-permissions.js` (lines 81–86), when a user has an org-wide deny on `device:terminal` and a device-scoped allow on `dev_lab_win_01`, the resolved effect must be `deny`. Testing specificity-first precedence failed with `allow`.
**What I rejected:** Hierarchical / specificity-based precedence (e.g. device-scoped grant overriding org-wide grant). A narrower allow cannot carve out an explicit org-wide security prohibition.
**What would change my mind:** A multi-layered ACL design that explicitly supports signed carve-outs with higher priority weights.

---

### Structural Organization Isolation via Token Org Claim (D18 / AUTH-DATA-MODEL.md §4)

**What I chose:** In `server/context.js`, compared the token's `org` claim with the requested `:org` URL parameter, throwing `404 NOT_FOUND` rather than `403 FORBIDDEN` when they differ.
**Why:** Returning `403` confirms that an organization exists, leaking tenant existence to unauthorized callers. Testing against `check-api.js` (lines 70–75) proved that presenting an Acme token against Globex routes must yield `404 NOT_FOUND` with no Globex data in the response body.
**What I rejected:** Filtering data in database queries while allowing the request to proceed, or returning `403 FORBIDDEN`.
**What would change my mind:** An enterprise cross-tenant administrative delegation model where master audit tokens are explicitly authorized across multiple tenant IDs.

---

### Re-inviting Previously Removed Members (Tier A1 Concept)

**What I chose:** In `server/routes/invites.js` (`POST /invites/:token/accept`), checked for existing membership rows for `(org_id, user_id)` and executed an `UPDATE memberships SET status = 'active', role = ?, perm_version = perm_version + 1` instead of an `INSERT`.
**Why:** The schema enforces a strict `UNIQUE(org_id, user_id)` constraint on `memberships`, while `users` are never deleted. A fresh `INSERT` for a previously removed member throws `SQLITE_CONSTRAINT_UNIQUE: UNIQUE constraint failed: memberships.org_id, memberships.user_id`.
**What I rejected:** Deleting old membership rows on removal, or unconditionally calling `INSERT INTO memberships`.
**What would change my mind:** A schema redesign with soft-delete timestamps on memberships allowing multiple historical membership rows.

---

### Two-Step Compound Check on Session Creation (D10 / PERMISSIONS.md §9)

**What I chose:** Evaluated `session:start` first, throwing `403 FORBIDDEN` with `reason: "missing_permission"`, and then evaluated the mode permission (`device:view`, `device:control`, or `device:terminal`), throwing `403 FORBIDDEN` with `reason: "missing_device_permission"`.
**Why:** In `scripts/check-api.js` (lines 103–111), a viewer trying to start a session on `qa-android-01` (lacking `session:start`) must receive `missing_permission`, while requesting control on `lab-mac-01` (where `session:start` is granted but `device:control` is missing) must receive `missing_device_permission`.
**What I rejected:** A generic permission check returning `forbidden('insufficient permissions')` without distinguishable reason codes.
**What would change my mind:** A consolidated permission scheme where mode permissions subsume session creation authority.

---

### Grandfathered Authority Snapshot for Live Sessions (D20 / PERMISSIONS.md §7.1)

**What I chose:** Serialized the caller's complete resolved permission set into `sessions.authorized_by` as a JSON snapshot at session start. Subsequent role downgrades or grant revocations bump `perm_version` to block future sessions, but leave running sessions active until their TTL (`expires_at`).
**Why:** In `scripts/check-api.js` (lines 119–130), demoting Sam from operator to viewer keeps her live control session in state `active`, while blocking subsequent session creations and token verification with `401 TOKEN_STALE`.
**What I rejected:** Evaluating session authority on every frame/request or terminating live sessions upon permission changes. Disrupting live operator operations mid-session is unsafe compared to TTL bounding.
**What would change my mind:** A zero-trust continuous authorization mandate where active socket streams must be aborted instantly upon grant revocation.


---

### Stub — the shape of a weak "Why"

**What I chose:** the obvious thing.
**Why:** it is what the brief says to do.
**What I rejected:** nothing, the alternative seemed worse.
**What would change my mind:** I do not know.

_Reads as a memory of the document, not a model of the system. Scores nothing._

---

### Stub — the shape of a strong "Why"

**What I chose:** X.
**Why:** I implemented Y first, because Y is the intuitive precedence rule. `node scripts/check-
permissions.js` reported `<the actual reason string it reported>` on the case where the two grants
disagree. That is only reachable if the two are evaluated in a different order than Y assumes.
Moved to X in `<commit>` and the case passed. Logged in `BUILD-LOG.md` under Phase 2.
**What I rejected:** Y, and also "resolve the narrower one last" — both fail the same case for the
same reason.
**What would change my mind:** a case where a narrower grant is expected to survive a broader
refusal. I could not construct one, which is itself evidence for X.

_Shows what you believed, what disproved it, and what you did next._

---

## Where this repo argues with itself

The documents contradict each other, or contradict the schema, in at least one place. Name each
one you found. For each: quote both statements, say which you built against, and say why.

Building against the written rule and arguing in writing is a **full-marks** answer. Silently
working around it, or quietly picking one and saying nothing, scores zero on the section — we
cannot tell the difference between a decision and an oversight.

## Deliberately not built

What you chose not to build, and the reason. A scope cut with a stated reason is a senior
judgement. An unmentioned gap is a gap.
