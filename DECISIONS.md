# DECISIONS

One section per decision that a reviewer might reasonably have made differently. Every section has
the same four parts, and the third and fourth are the ones we weigh most.

Rules, from `DISCOVERY-BRIEF.md`:

- cite something real in `Why` — a commit, a test, an error string, a file and line
- do not restate what a document says; describe what you did when the documents ran out
- six to twelve decisions is the expected range

---

### JWT algorithm pinning and structural header rejection (D11 / AUTH-DATA-MODEL.md §10)

**What I chose:** Reject any token where `header.alg !== 'HS256'` or `header.typ !== 'JWT'` upfront using strict literal comparison before verifying the HMAC-SHA256 signature in constant time.
**Why:** Allowing the algorithm to be parameterized from the untrusted token header enables algorithm confusion attacks (such as `alg: none` stripping signatures or public-key confusion via HS512/RS256). In `scripts/check-jwt.js` (lines 95–102), eight explicit algorithm confusion test cases assert `401 UNAUTHENTICATED`.
**What I rejected:** Dynamically looking up the cryptographic algorithm based on `header.alg`, or using an `alg !== 'none'` denylist. A denylist fails when attacker-supplied headers introduce alternative algorithms (e.g. RS256/HS512).
**What would change my mind:** A multi-tenant requirement supporting asymmetric key rotation (e.g., RS256 with jwks endpoint) where a verified server-side key repository dictates the expected algorithm per key ID (`kid`).

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
