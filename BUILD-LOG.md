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

_What did you expect each failure mode to look like before you ran it? Which one behaved
differently from your expectation, and what did that tell you?_

## Phase 2 — caller context and the resolution engine

_This is where most people's first model is wrong. Write down the model you started with, the
observation that broke it, and the model you moved to. Be specific about the observation._

## Phase 3 — orgs, members, invites

_Anything you had to work out that no document states. Invite lifecycle states are a common
source of this._

## Phase 4 — devices and grants

_What happens at the boundary where two grants disagree, or where a grant's scope and the
question's scope differ? Say what you predicted and what you got._

## Phase 5 — sessions

_Two permissions, one device. What did you have to resolve, and in what order, to keep the two
failure reasons distinguishable?_

## Phase 6 — audit

_What did you decide counts as an auditable event, and what pushed you to that line?_

## Phase 7 — the console

_Where did the server's answer and your instinct disagree about what should be on screen?_

## Phase 8 — hardening

_What did you measure, what did you fix, and what did you deliberately leave alone? Anything you
chose not to build belongs here with its reason._

## Open threads

_Things you know are wrong, unfinished, or that you would do differently with another day. Listing
these honestly is worth more than pretending they do not exist — we will find them anyway._
