# Phase 1 Engineering Specification — Authentication & Identity

**Status:** Draft for senior engineering review — implementation begins only after sign-off
**Source of truth this spec implements against:** `collaborative-workspace-architecture-blueprint.md` (frozen), `implementation-roadmap.md` (frozen), `phase-0-development-foundation-spec.md` (frozen, implemented)
**Rule in effect:** the architecture is not revisited in this document except where implementation planning surfaces a genuine conflict — none was found; this spec operates entirely within already-frozen decisions.

---

## 1. Goals

This phase implements the complete authentication and identity foundation: OAuth sign-in against Google and GitHub, account linking, Redis-backed session management, minimal user-profile creation (the data OAuth actually gives us — not the editable profile experience, which is Phase 3), authentication middleware, the authorization primitives every later phase's permission system will compose with, logout, and protected routes.

**Why this phase exists as its own isolated unit:** every other system in the roadmap — workspace membership, document ownership, permission resolution, WebSocket room authorization — answers the question "what can this user do," which is meaningless without first, reliably, answering "who is this user." Building that answer in isolation, before any workspace or document complexity exists, means it can be tested exhaustively against its own concerns (OAuth correctness, session security, account-linking safety) without a second system's bugs muddying the picture.

**How this phase prepares future phases, concretely:**

- Phase 3 (Profile & Account Management) extends the `User`/`Identity` model this phase creates and exposes the session-revocation _UI_ on top of the revocation _primitives_ this phase builds.
- Phase 4/5 (Workspace) attaches `WorkspaceMember` rows to the `User.id` this phase establishes as the stable identity anchor.
- Phase 7 (Permissions) and Phase 12 (WebSocket auth) both compose a second authorization layer on top of this phase's authentication middleware and request-context shape, rather than replacing it — the shape decided in §7 of this document is a load-bearing contract for both.
- Phase 20 (Security Hardening) extends, rather than replaces, the security baseline this phase establishes (§11).

## 2. Scope

### 2.1 In Scope

- OAuth 2.0 sign-in via Google and GitHub (Authorization Code + PKCE).
- Account creation on first sign-in; account linking when a second provider's verified email matches an existing user, gated by an explicit confirmation step.
- Redis-backed session creation, validation, expiration, and revocation (the backend primitives — including the multi-device-aware storage shape — not the Phase 3 "browse and revoke my sessions" UI).
- Minimal user-profile creation from OAuth-provided data (display name, avatar, email) — record creation only, not the editable settings experience.
- Authentication middleware (is there a valid session) and the authorization _primitives_ (authenticated vs. anonymous, protected vs. public route distinction, the request-context shape future role/permission checks attach to) — not any actual role or permission model, since none exists yet.
- Logout (current session).
- A minimal "who am I" read endpoint, needed by the frontend to render an authenticated shell — this is identity data retrieval, not the Phase 3 profile-editing surface.
- Baseline rate limiting specifically on the OAuth-facing endpoints, given their sensitivity (full application-wide rate-limiting rollout remains Phase 20's job).
- Security properties: CSRF protection on the OAuth flow (state parameter), cookie security flags, session-fixation prevention, replay protection.

### 2.2 Out of Scope

- Workspaces, documents, the editor, WebSockets, and any collaboration feature — none of this phase's work depends on or produces any of them.
- Password-based authentication of any kind, and any form of multi-factor authentication beyond what the OAuth providers themselves enforce — the product is OAuth-only by design (architecture §6.1), and this is not revisited here.
- Profile _editing_ UI, connected-provider management UI, and the active-sessions browsing/revocation UI — all explicitly Phase 3.
- Any role, permission, or authorization _policy_ beyond "authenticated or not" — role-based and resource-based authorization begin at Phase 5/7.
- Full, application-wide rate limiting and CSRF-token rollout — Phase 20.
- Persisting OAuth provider access/refresh tokens for any purpose beyond the transient profile fetch during sign-in (see §5.4) — no future provider-API integration is being prepared for in this phase.
- Any admin-facing audit log _table or UI_ (Phase 18) — though this phase's logging is deliberately structured to be audit-log-compatible later (§12).

## 3. User Flows

All flows below assume Phase 0's infrastructure (config validation, structured logging, centralized error handling) is already in place and is used, not re-decided, by this phase.

### 3.1 New User — Sign In With Google (or GitHub; identical shape)

```
User clicks "Sign in with Google"
  → Browser redirected to Google's authorization endpoint
      (with: client_id, redirect_uri, scope, a fresh random `state`, PKCE code_challenge)
  → User authenticates with Google and grants consent
  → Google redirects back to our callback URL with `code` + `state`
  → Server verifies `state` matches the one issued for this flow (§5.2) — reject if not
  → Server exchanges `code` (+ PKCE code_verifier) for tokens at Google's token endpoint
  → Server fetches the user's profile from Google's userinfo endpoint
  → Server verifies the returned email is marked verified — reject if not (§5.6)
  → Server looks up an Identity matching (provider=google, providerUserId=<id>) — none found
  → Server checks whether any existing User has a verified identity with this same email — none found
  → Server creates a new User + a new Identity linked to it
  → Server creates a new Session (Redis) and issues the session cookie
  → Browser is redirected to the authenticated application shell, now signed in
```

### 3.2 Returning User — Sign In (Same Provider)

Identical to §3.1 up through the userinfo fetch, except: an `Identity` matching `(provider, providerUserId)` **is** found, referencing an existing `User`. No new `User` or `Identity` is created — only a new `Session` is issued. This is the common-path, low-friction flow.

### 3.3 Account Linking — New Provider, Existing Verified Email

```
User (already has a Google-linked account) clicks "Sign in with GitHub" for the first time
  → ... (state/PKCE/token exchange/userinfo fetch as in §3.1) ...
  → No Identity matches (provider=github, providerUserId=<id>)
  → An existing User IS found whose verified email matches this GitHub profile's verified email
  → Server does NOT silently link. Server presents an explicit confirmation step:
        "An account already exists for <email>, currently signed in via Google.
         Link your GitHub account to it?"
  → User confirms
      → Server creates a new Identity (provider=github) linked to the EXISTING User
      → Server rotates the session ID (§6.4) as a privilege-relevant-event safeguard
      → Session issued; user is signed in to their existing account, now with two linked providers
  → User declines
      → No Identity or User is created or modified
      → Server aborts the sign-in with a clear message: "An account already exists for this
         email via Google. Please sign in with Google, or contact support to link accounts."
      → No session is issued
```

**Design decision — decline path does not create a shadow duplicate account.** An alternative design would silently create a second, unlinked `User` with the same email when the user declines linking. This is rejected: it produces confusing duplicate-account proliferation (the user now has two accounts and no clear way to reconcile them later) and offers no real benefit over simply informing the user how to reach their existing account. See §9 for the corresponding decision not to enforce a hard database uniqueness constraint on `User.email` despite this policy — the two are related but distinct decisions, explained there.

### 3.4 Logout

```
Authenticated user clicks "Log out"
  → Server deletes the corresponding session key from Redis
  → Server clears the session cookie on the response
  → Browser redirected to the sign-in page
  → Any subsequent request presenting the old (now-cleared, and even if somehow replayed,
    now-nonexistent-in-Redis) session cookie is rejected as unauthenticated
```

### 3.5 Session Expiration (Natural)

```
User's session has been idle beyond the sliding-expiration window (§6.2), or has hit the
absolute maximum lifetime regardless of activity
  → Redis key has already expired and is gone (TTL-based, no explicit action needed)
  → User's next request with the (now-invalid) cookie is rejected as unauthenticated
  → Client-side: a 401 response triggers a redirect to sign-in, with the originally-intended
    destination preserved as a validated (allowlisted) return-to target (§11.1) so the user
    lands back where they meant to go after re-authenticating
```

### 3.6 Provider or Network Failure Mid-Flow

```
User initiates sign-in → redirected to provider → provider is down / times out / returns an error
  → Server never receives a valid callback, OR receives a callback carrying a provider-reported
    error parameter instead of a code
  → Server presents a clear, generic "sign-in is temporarily unavailable, please try again"
    state — no raw provider error detail is surfaced to the user (§13.1)
  → No User, Identity, or Session is created or modified — this is a no-op failure, not a
    partial-state failure, by construction (see §9.3's transactional creation requirement)
```

## 4. Identity Model

Three concepts, each with a distinct purpose and lifecycle:

- **User** — the durable, canonical identity a person has within the product. Everything downstream (workspace membership in Phase 5, document ownership in Phase 6, comments in Phase 14) ultimately references `User.id`. A `User` is not tied to any single OAuth provider.
- **Identity** — a record of one OAuth provider account linked to a `User`. A `User` has **one-to-many** Identities (this is precisely what makes multi-provider linking possible — architecture §6.1/§6.2). An Identity is uniquely identified by the pair `(provider, providerUserId)` — never by email alone, since email is provider-reported and not treated as a stable primary key (§5.6, §9.2).
- **Session** — an ephemeral, revocable proof that a particular browser/device is currently authenticated as a particular `User`. A `User` has **one-to-many** concurrent Sessions (multi-device support, §6.6). Unlike `User` and `Identity`, a `Session` does not live in Postgres as primary storage — it lives in Redis, consistent with architecture §6.3's decision, because a session's defining properties (fast lookup, instant revocability, natural TTL-based expiry) are exactly what Redis is for, and a session is not the kind of fact that needs relational durability the way identity and ownership records do.

**Why these are three separate concepts and not fewer:** collapsing `User` and `Identity` into one entity would make multi-provider linking impossible to represent cleanly (which provider "is" the user, if there are two?). Collapsing `Session` into `User` (e.g., a single "current session token" field on the user row) would break multi-device support and make revoking one device's access without affecting others impossible. The three-entity shape is the minimum necessary to support the flows in §3.

## 5. OAuth Architecture

### 5.1 Lifecycle Overview

The full lifecycle is described narratively in §3.1; this section explains the mechanics and reasoning behind each step.

### 5.2 State Parameter

A cryptographically random `state` value is generated per sign-in attempt, stored briefly server-side (Redis, short TTL matching the maximum reasonable time a user takes to complete a provider's consent screen — on the order of minutes, not longer), and included in the authorization request. On callback, the returned `state` must match exactly and must not have already been consumed. This is the primary CSRF defense for the OAuth flow specifically (distinct from application-level CSRF, covered in §11.2) — without it, an attacker could trick a victim's browser into completing an OAuth callback initiated by the attacker, potentially binding the victim's session to an account the attacker controls.

**The state value is deleted from Redis immediately upon use**, whether the callback succeeds or fails — this closes the replay window explicitly rather than relying solely on its short TTL (§11.4).

### 5.3 PKCE

| Approach                                                                                                           | Reasoning                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Skip PKCE** (technically permissible for a confidential client — this Express backend does hold a client secret) | Rejected. The authorization `code` still transits through the browser's redirect chain, where it is exposed to a class of interception risks (malicious browser extensions, referrer leakage, misconfigured redirect handling) that PKCE specifically defends against, independent of whether the _token exchange_ step is confidential. |
| **Use PKCE regardless of client confidentiality**                                                                  | **Selected.** This is the direction OAuth 2.1 explicitly consolidates on, and the cost of implementing it is low (a code verifier/challenge pair generated per flow) relative to the defense-in-depth it provides against code interception.                                                                                             |

### 5.4 Token Exchange & the Decision Not to Persist Provider Tokens

The authorization code is exchanged for provider access/(refresh) tokens server-side only — the browser never sees them. Critically:

**Provider access and refresh tokens are used transiently to fetch the user's profile during the callback, and then discarded. They are not persisted anywhere.**

| Approach                                                                                       | Pros                                                                                                       | Cons                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Persist provider tokens** (enabling future calls to Google/GitHub APIs on the user's behalf) | Would save a re-auth step if a future phase needs ongoing provider API access (e.g., syncing GitHub repos) | Nothing in the current, frozen product scope needs this; storing tokens creates a durable secret-management liability (encryption at rest, rotation, revocation-on-provider-side handling) for a capability that doesn't exist                     |
| **Discard tokens after the transient profile fetch**                                           | Data minimization — the smallest possible secret-storage surface for a capability with real, current use   | If a future phase genuinely needs ongoing provider API access, that phase would need to re-request the relevant scopes and implement token storage at that time — an explicit, deliberate future decision, not a retrofit onto Phase 1's oversight |
| **Selected: discard after use**                                                                | —                                                                                                          | —                                                                                                                                                                                                                                                  |

This is called out explicitly in §18 as a decision that should not be casually reversed "for convenience" later — if a future phase needs provider tokens, that need should drive a deliberate design addition, not a quiet expansion of what Phase 1 already stores.

### 5.5 Refresh Strategy

Because provider tokens are not persisted (§5.4), there is no provider-token refresh strategy to design in this phase — refreshing only becomes relevant when there's an ongoing need to call the provider's API after the initial callback, which is explicitly out of scope. The only "refresh"-like concept in this phase is **session** renewal (sliding TTL, §6.2), which is a wholly separate mechanism from OAuth token refresh.

### 5.6 Email Verification Requirement

Both Google and GitHub can, in principle, return an email that is not marked verified (GitHub in particular, depending on account configuration). The callback handler **must** check the provider's verified-email flag and reject sign-in (with a clear, generic message) if it is false or absent. Treating an unverified email as trustworthy for identity/linking purposes would allow an attacker who has merely registered an unverified email matching a victim's identity to potentially trigger the account-linking confirmation flow (§3.3) against the victim's account — this check is a prerequisite for the linking flow's safety, not an independent nice-to-have.

### 5.7 Failure Cases (Summary Table)

| Failure                                                                              | Handling                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| User denies consent at the provider                                                  | Provider redirects back with an error parameter instead of a code; treated as a clean abort, no account/session created, generic "sign-in cancelled" state shown                                                                                                                                       |
| `state` mismatch or missing                                                          | Reject immediately, log as a security-relevant event (§12), generic error shown to user — this is treated as a potential attack signal, not routine noise                                                                                                                                              |
| Authorization code invalid, expired, or already used                                 | Token exchange fails at the provider; surfaced as a generic "sign-in failed, please try again"                                                                                                                                                                                                         |
| Email missing or unverified                                                          | Reject with a clear, specific message (this one _can_ be specific to the user, since it's not a security-sensitive rejection — it's actionable: "please verify your email with \<provider\> and try again")                                                                                            |
| Provider API unreachable/timeout (either authorize redirect or token/userinfo calls) | Generic "sign-in temporarily unavailable" — and critically, per architecture's OAuth-outage failure mode (§24.4), this must **not** affect any already-authenticated user's existing session, since session validity depends on Redis, not provider availability (verified explicitly in testing, §14) |

## 6. Session Architecture

### 6.1 Cookie Configuration

The session cookie carries only an opaque session ID (never a JWT with embedded claims, per architecture §6.3's decision) and is set with `HttpOnly`, `Secure`, and `SameSite=Lax`. `Secure` is conditionally relaxed **only** for local HTTP development (per Phase 0's environment-driven config) and is never relaxed in any deployed environment — this is called out explicitly as a configuration invariant to test for (§14), since "it works locally" being achieved by weakening a security flag is a realistic, easy-to-miss mistake.

### 6.2 TTL Model — Sliding vs. Absolute vs. Combined

| Approach                                                                          | Pros                                                                                                                                    | Cons                                                                                                                                                                       |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sliding expiration only** (TTL refreshed on every request)                      | An active user is never unexpectedly logged out                                                                                         | A session that is _stolen but used periodically_ by an attacker (e.g., a leaked cookie) never naturally expires — sliding-only provides no upper bound on session lifetime |
| **Absolute expiration only** (fixed lifetime from creation, no matter how active) | Guarantees an upper bound on any session's lifetime                                                                                     | An actively-working user gets logged out mid-session at an arbitrary point, which is a poor experience for exactly the users doing the most legitimate work                |
| **Combined: sliding refresh up to an absolute cap**                               | Active legitimate users stay signed in; even an actively-used stolen session is forced to expire eventually, bounding the damage window | Slightly more implementation complexity (two TTL concepts tracked instead of one)                                                                                          |
| **Selected: combined**                                                            | —                                                                                                                                       | —                                                                                                                                                                          |

**Concrete parameters:** a sliding idle-expiration window refreshed on activity, with an absolute maximum session lifetime that forces re-authentication regardless of activity level. Exact durations are a product/security-policy decision to be finalized during task breakdown (a reasonable starting point, consistent with common SaaS practice, is an idle window in the range of days-to-weeks and an absolute cap in the range of weeks-to-a-few-months) — the _mechanism_ (both bounds must exist) is what's frozen by this spec, not the specific numbers.

### 6.3 Lookup

Session validation on every authenticated request is a single Redis key lookup by the opaque ID from the cookie — O(1), sub-millisecond, and the reason architecture §6.3 selected Redis-backed opaque sessions over a self-contained JWT in the first place (instant revocability without a blocklist).

### 6.4 Rotation

The session ID is rotated (a new ID issued, old one invalidated) on privilege-relevant events — concretely, in this phase, **after a successful account-linking confirmation** (§3.3). This is a standard mitigation against session-fixation-adjacent risk: even though this system never accepts a client-supplied pre-auth session ID (§11.5), rotating on a privilege change is cheap, standard defense-in-depth, and is established as a pattern this phase's implementation should follow for any future privilege-relevant event (e.g., a future role change in Phase 5+) without needing to re-derive the reasoning then.

### 6.5 Expiration & Revocation

- **Expiration** is passive: Redis's native key TTL handles it; no application code needs to "notice" an expired session, it simply no longer exists to be found (§3.5).
- **Revocation** is active: deleting the Redis key immediately invalidates that session for all future requests, with no propagation delay — this is the direct payoff of the Redis-backed design (architecture §6.3) versus a stateless-JWT alternative.

### 6.6 Multi-Device Support

Each successful sign-in creates an independent session, keyed independently, with no limit imposed in this phase on the number of concurrent sessions per user (a future rate-limit-adjacent policy decision, not a Phase 1 concern). Alongside each session's primary key, a secondary per-user index (a set of active session IDs keyed by `userId`) is maintained at session-creation and -deletion time — **this phase builds and maintains this index but does not expose any UI or endpoint to browse it**; that's explicitly Phase 3's job (per §2.2). Building the index now, even though nothing reads it yet, avoids Phase 3 needing a backfill/migration to reconstruct historical session ownership data that Phase 1's sessions never recorded.

### 6.7 Future Scalability

Per architecture §8 and §24.2, session data is small (well under a kilobyte per session) and Redis's memory footprint for sessions is never the scaling constraint at any modeled stage — this phase's design requires no forward-looking scaling accommodation beyond what architecture already establishes.

## 7. Authorization Foundation

This phase establishes **authentication** (who) and the barest possible **authorization** primitive (authenticated vs. anonymous) — it does not implement any role- or permission-based authorization, since no resource (workspace, document) exists yet for a role to apply to.

### 7.1 Request Context Shape

On every authenticated request, the authentication middleware attaches a request context carrying, at minimum: `userId`, `sessionId`, and the correlation ID already established by Phase 0's logging infrastructure. This shape is **the contract future phases build on**:

- Phase 5/7's workspace-membership and permission-resolution middleware will attach _additional_ context (resolved role, workspace ID) alongside this phase's `userId` — composing with it, not replacing it.
- Phase 12's WebSocket room-join authorization reuses the identical `userId` concept (resolved from the same session validation logic) to call Phase 7's permission-resolution function, per architecture §11.2's "one source of truth" requirement.

**Why `req.user`-style attachment (idiomatic Express) rather than `AsyncLocalStorage`-based context for authorization data specifically:** Phase 0 already established `AsyncLocalStorage` for correlation-ID propagation through logging (chosen there because logging needs to reach deeply nested function calls without threading a parameter through every signature). Authorization data is different: it's consumed directly by route handlers and middleware in the same request-handling chain where it was attached, making direct, explicit attachment (`req.user`) both idiomatic for Express and easier to unit-test (a handler's authorization behavior can be tested by constructing a request object directly, without needing to simulate an async context). The two mechanisms are complementary, not competing — each is used where it fits best, and this reasoning is worth stating explicitly so a future engineer doesn't "fix" the apparent inconsistency by forcing both onto the same mechanism.

### 7.2 Anonymous vs. Authenticated

A request with no valid session is treated as anonymous — not rejected outright at the middleware level, since some routes are legitimately public (§8.4). Route-level declarations (protected vs. public) determine what happens next; the middleware's only job is to _resolve_ the request's authentication state accurately and attach it (or its absence) to the request context, not to make per-route access decisions itself.

### 7.3 Forward Compatibility With Workspace Permissions

The middleware is deliberately unopinionated about anything beyond "is there a valid, authenticated user." This is intentional: Phase 7's permission-resolution function (architecture §7.7) will be invoked as a _separate_, composable middleware step layered on top of this phase's authentication check, exactly as architecture §6.4 describes ("three independent checks, all server-side"). This phase implements check one of three; it does not anticipate or stub out checks two and three, since doing so before workspaces/documents exist would mean guessing at a shape that Phase 5/7 are better positioned to get right when those entities are real.

## 8. API Planning

### 8.1 REST Philosophy

Consistent with architecture §18: a versioned path prefix from day one, a uniform error envelope (using Phase 0's `packages/errors`), and Zod validation at every request boundary (query parameters on the OAuth callback, any request bodies on logout/session endpoints) — established here for the first time with real endpoints, following exactly the pattern Phase 0 built and tested in the abstract.

### 8.2 Authentication Middleware Behavior

On every request to a protected route: read the session cookie, look up the session in Redis (§6.3), and either attach the resolved request context (§7.1) and proceed, or short-circuit with a 401 using the standard error envelope. The middleware performs no database queries — session validation is Redis-only, keeping this check cheap enough to run on every request without concern (consistent with architecture §6.3's entire rationale for this design).

### 8.3 Error Responses & Status Codes

| Status | Meaning in this phase's context                                                                                                                                                                                                             |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | Malformed request (e.g., a callback missing expected query parameters, caught by Zod validation)                                                                                                                                            |
| `401`  | No valid session — covers missing cookie, expired session, revoked session, and tampered/invalid cookie identically (§11.6 explains why these must not be distinguishable in the response)                                                  |
| `403`  | Reserved for future use once a permission model exists (Phase 5/7) — not produced by any endpoint in this phase, but the envelope/handling path is proven now so later phases add to a working pattern rather than building it from scratch |
| `409`  | Conflict — e.g., an attempt to link a provider identity that is already linked to a _different_ user (a genuine edge case: someone else already claimed that GitHub account)                                                                |
| `429`  | Rate limit exceeded on OAuth-facing endpoints (§11.7)                                                                                                                                                                                       |
| `500`  | Unexpected/programmer error, generic body, full detail only in server-side logs (per Phase 0's `OperationalError`/generic-error distinction)                                                                                                |

### 8.4 Protected vs. Public Routes (Conceptual)

**Public:** the OAuth initiation and callback endpoints (a signed-out user must be able to reach these to sign in at all), the health endpoint (Phase 0).

**Protected:** the "who am I" identity-read endpoint, logout, and any session-management endpoint this phase's backend primitives expose even if no UI calls them yet (§6.6).

No endpoint in this phase is "protected" in a role-based sense — only in the authenticated/anonymous sense established in §7.

### 8.5 Validation Strategy

Every externally-supplied value this phase touches — OAuth callback query parameters, any request body on session-management endpoints — is validated via a Zod schema before any business logic runs, consistent with the pattern already proven in Phase 0's config validation (§8 of that spec) and anticipated by architecture §18/§19.

## 9. Database Planning

### 9.1 Entities (Recap From §4, With Relational Detail)

- **User** — one row per person. Holds the minimal profile data available from OAuth at creation time (display name, avatar URL, a "primary" email for display purposes — see §9.2 for why this is not a uniqueness-enforcing field).
- **Identity** — one row per linked provider account, referencing exactly one `User`.
- No `Session` table in Postgres — sessions are Redis-primary (§6), consistent with architecture §7.1's framing that a Postgres-side durable session audit trail is an optional future enhancement, not a Phase 1 requirement. If a future phase (e.g., Phase 18's audit logging) wants a durable record of login _events_ specifically, that's better served by structured log ingestion (§12) than by duplicating live session state into Postgres.

### 9.2 Relationships & the Email-Uniqueness Decision

`User` has many `Identity` rows (1:N). Each `Identity` is uniquely constrained on `(provider, providerUserId)` — this is the actual anchor of "who is this," never email.

**Should `User.email` carry a uniqueness constraint?** No — deliberately not enforced at the database level.

| Approach                                                                        | Reasoning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Enforce unique `User.email`**                                                 | Would guarantee no two `User` rows ever share an email — but combined with the explicit-confirmation linking policy (§3.3), this creates an awkward failure mode: if a user declines linking, the system _cannot_ create a second `User` with that email even though the policy's stated behavior is to abort rather than merge — the constraint would force choosing between violating the "explicit confirmation, never silent" principle or hard-failing the decline path in a confusing way                         |
| **Do not enforce uniqueness on `User.email`, rely on application-level policy** | The linking-confirmation flow (§3.3) already prevents _silent_ duplication by informing the user and refusing to auto-create a shadow account by default; the application layer is where this policy correctly lives, since it involves a human decision (confirm or decline), not a database invariant. A `User.email` field remains useful for display and for the _lookup_ that triggers the linking-confirmation prompt in the first place, indexed for that lookup's performance, just not uniqueness-constrained. |
| **Selected: indexed, not uniqueness-constrained**                               | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | —   |

### 9.3 Constraints & Transactional Integrity

- `Identity.userId` is a required foreign key to `User.id`.
- `(Identity.provider, Identity.providerUserId)` is a required unique composite constraint — this is the actual integrity guarantee preventing two different `User` rows from both claiming the same underlying provider account.
- **User+Identity creation on first sign-in is transactional** — both rows are created together or neither is; a failure partway through (e.g., a database error after the `User` row is written but before the `Identity` row is) must not leave an orphaned `User` with no way to sign in again. This is stated explicitly because it's exactly the kind of subtle correctness requirement that's easy to overlook when writing the callback handler under the assumption that "it'll basically always work."

### 9.4 Indexing

- Composite unique index on `Identity(provider, providerUserId)` — the dominant, security-critical lookup on every sign-in.
- Index on `Identity.userId` — supports "list all identities for this user" (needed by Phase 3, and internally by the linking-confirmation lookup in §3.3).
- Index on `User.email` — supports the linking-confirmation lookup (§3.3), non-unique per §9.2.

### 9.5 Future Compatibility

No schema changes to `User` or `Identity` are anticipated when Phase 5 introduces `WorkspaceMember` — that table will simply hold a foreign key to `User.id`, exactly as the roadmap and architecture already assume. This phase's entities are deliberately minimal and stable specifically so later phases can build on top without needing to revisit them.

## 10. Redis Planning

Extending Phase 0's key-namespacing convention (`type:identifier`, established in that phase's spec §22):

- **`session:{sessionId}`** — the primary session record (userId, createdAt, lastSeenAt, device/label metadata for future Phase 3 display), TTL managed per the combined sliding/absolute model (§6.2).
- **`user-sessions:{userId}`** — a set of active session IDs for a given user, maintained alongside primary session creation/deletion (§6.6), enabling future multi-device listing without requiring a Redis key scan (which would be an anti-pattern at any real scale).
- **`oauth-state:{state}`** — the short-lived state-parameter record (§5.2), deleted on use.

**Expiration:** all three key types rely on native Redis TTL rather than application-level cleanup jobs — this is precisely the kind of ephemeral, self-expiring data Redis is suited for, and no BullMQ job (Phase 2) is needed to clean up expired sessions or stale state values.

**Lookup:** all three are O(1) direct key lookups; no Redis-side scanning or pattern-matching is used anywhere in this phase's hot paths.

**Invalidation:** explicit `DEL` on logout/revocation for `session:{sessionId}`, with a corresponding removal from `user-sessions:{userId}`'s set — both operations should be treated as a single logical unit (executed together, e.g., within a Redis transaction/pipeline) so the two structures can't drift out of sync under a partial failure.

**Scaling:** per architecture §8/§24.2, none of this phase's Redis usage requires any scaling accommodation beyond what's already established — session/state data volume is trivial at any stage this phase's testing needs to reach.

## 11. Security

### 11.1 Open Redirect Prevention

Any "return to this page after sign-in" parameter accepted by the sign-in flow must be validated against an allowlist (same-origin, known-safe paths) before being used as a post-login redirect target — accepting an arbitrary external URL here is a classic open-redirect vulnerability that turns the application's own sign-in flow into a phishing vector.

### 11.2 CSRF

The OAuth flow's own CSRF exposure is covered by the `state` parameter (§5.2) — this is necessary but not sufficient for the application as a whole. This phase's state-changing endpoints (logout, session revocation) rely on the `SameSite=Lax` cookie baseline established in §6.1 as their CSRF defense for now; full CSRF-token issuance/validation across all state-changing endpoints application-wide is explicitly Phase 20's job (§2.2). This is a deliberate, bounded scope decision, not an oversight — `SameSite=Lax` already blocks the most common cross-site POST-based CSRF vector for these specific low-risk-payload endpoints (logout has no meaningful "attacker benefit" from forcing it via CSRF, for instance), and the fuller token-based defense is reserved for the dedicated hardening pass once more state-changing surface area exists to justify building it once, comprehensively.

### 11.3 Cookie Security

`HttpOnly` (no JS access — defeats the most common XSS-driven cookie-theft vector), `Secure` (never transmitted over plaintext HTTP in any deployed environment — see §6.1's explicit callout), `SameSite=Lax` (blocks cross-site top-level navigation-triggered CSRF in the common case while still permitting the OAuth provider's redirect-back to function, which a stricter `SameSite=Strict` would actually break).

### 11.4 Replay Attacks

- **Authorization code reuse:** enforced as single-use by the provider itself; this system additionally treats a second callback attempt with an already-consumed `state` (§5.2) as invalid, providing defense-in-depth against a race (e.g., a double-submitted callback request) even in the moment before the provider-side single-use enforcement would itself reject the reused code.
- **Session token replay:** not applicable in the traditional sense (there's no separate "token" beyond the session cookie itself) — an attacker possessing a valid, non-expired, non-revoked session cookie _is_, by this system's design, indistinguishable from the legitimate session holder; this is why cookie theft (via XSS, network interception, or device compromise) is the actual threat model to defend against via §11.3's flags, not a "replay" concept layered on top.

### 11.5 Session Fixation

The server **never accepts a client-supplied session identifier prior to authentication** — a session ID is only ever generated server-side, after successful authentication, and only server-generated IDs are ever looked up or trusted. This alone prevents the classic fixation attack (an attacker pre-setting a known session ID for a victim to unknowingly adopt). Rotation on privilege-relevant events (§6.4) is additional defense-in-depth, not the primary defense.

### 11.6 Brute Force & the "Don't Distinguish Invalid Reasons" Principle

There is no password to brute-force in this system by design (architecture §6.1). The closest analogous risk is an attacker attempting to guess or forge valid session cookie values. Two mitigations: (a) session IDs are generated with sufficient entropy that guessing is computationally infeasible, and (b) **every invalid-session case — missing, expired, revoked, or malformed/tampered — returns an identical 401 response**, never a response that lets an attacker distinguish "this cookie format is almost right" from "this cookie doesn't exist at all." Leaking that distinction would hand an attacker a useful oracle for probing the session ID space; a uniform failure response denies them that feedback.

### 11.7 Rate Limiting (Baseline, This Phase Only)

The OAuth initiation and callback endpoints receive a Redis-backed sliding-window rate limit (per user IP, and separately per targeted account where applicable) as a baseline protection against abuse (e.g., automated hammering of the callback endpoint with garbage codes, or an attempted enumeration of the linking-confirmation flow to probe which emails have accounts). This is intentionally narrow — just these sensitive endpoints — with the comprehensive, application-wide rate-limiting rollout deferred to Phase 20 (§2.2) once more of the attack surface (comment posting, invitation sending, etc.) actually exists to protect.

### 11.8 Secret Management

OAuth client secrets are supplied via Phase 0's environment/secret-management mechanism, per-environment (local/staging/production each have their own provider app registrations and redirect URIs, since redirect URIs are provider-side, exact-match-validated, and cannot be shared across environments) — this phase introduces no new secret-management pattern beyond what Phase 0 already established and validated.

## 12. Logging

### 12.1 Events to Log

| Event                                | Level                                | Notes                                                                                                                                          |
| ------------------------------------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Successful login (new user)          | `info`                               | userId, provider, correlation ID; explicitly tagged as "new user" for later analytics/audit consumption                                        |
| Successful login (returning user)    | `info`                               | Same shape, tagged "returning user"                                                                                                            |
| Failed login (any reason from §5.7)  | `warn`                               | Reason _category_ (state mismatch, provider error, unverified email, etc.) — never the raw provider error payload verbatim                     |
| Account-linking confirmation shown   | `info`                               | The event of prompting, distinct from...                                                                                                       |
| Account-linking confirmed / declined | `info`                               | ...the user's actual decision, each logged distinctly since both are meaningful signals                                                        |
| Session creation                     | `info`                               | userId, a non-reversible reference to the session (§12.2) — never the raw session ID                                                           |
| Logout                               | `info`                               | userId, session reference                                                                                                                      |
| Provider failure/outage detected     | `warn`/`error` depending on severity | Provider name, failure category                                                                                                                |
| Rate limit triggered (§11.7)         | `warn`                               | Flagged distinctly, since a spike in this specific log event is a meaningful operational/security signal worth its own future alert (Phase 21) |

**Audit-log compatibility, without an audit-log table existing yet:** every event above is emitted as a structured, consistently-shaped log entry specifically so that Phase 18's audit log (which will likely ingest a subset of these events into a queryable Postgres table) can be built later as a consumer of an already-correct event stream, rather than requiring this phase's code to be revisited to add missing instrumentation retroactively.

### 12.2 What Must Never Be Logged

- Raw OAuth authorization codes, access tokens, or (irrelevant here since none are persisted, but worth stating) refresh tokens — under no circumstances, not even at `debug` level, not even temporarily "for local debugging."
- The full session cookie / session ID value — logs reference a session by a non-reversible, truncated, or hashed identifier sufficient for correlating log lines about the same session without the log itself becoming a bearer credential equivalent to the cookie.
- Full raw provider profile payloads — log only the specific fields actually used (provider, provider user ID, verified-email boolean), not the entire response body, which may carry additional PII beyond what this system needs or has any reason to retain even transiently in a log store.
- `state` parameter values, PKCE verifiers/challenges.
- Anything Phase 0's logger redaction rules (that spec's §9.2) already generically catch (`password`, `token`, `secret`, `authorization` headers) — this phase's events should be structured so that redaction, not developer discipline alone, is the actual backstop.

## 13. Error Handling

### 13.1 OAuth Failures

Every failure category in §5.7's table maps to a specific `OperationalError` subclass (Phase 0's taxonomy), producing the standard envelope with a status code from §8.3 and a message that is generically safe to show the user — never a raw provider error string, which could inadvertently leak implementation detail or be confusing/alarming without being actionable.

### 13.2 Redis Failures

If Redis is unreachable during session validation, the system **fails closed** — the request is treated as unauthenticated (401), never as "let's assume they're fine and proceed," consistent with the failure-mode posture architecture's design-review addendum establishes for Redis outages generally (§24.4). This is logged as a high-severity operational event (an infrastructure alert-worthy condition, not a routine "user's session expired" log line), since a Redis outage means the entire application is effectively down for anyone not already mid-request with a still-valid in-flight context — this is exactly the scenario architecture §24.4 flags as needing an explicit, tested degraded-mode decision, and "fail closed, alert loudly" is that decision for the authentication layer specifically.

### 13.3 Database Failures

A database error during `User`/`Identity` creation (§9.3) aborts the transaction entirely — the user sees the generic "sign-in failed, please try again" state from §13.1's pattern, and no partial `User`-without-`Identity` (or vice versa) row is ever left behind. A database error during the linking-confirmation email lookup (§3.3) is treated the same way — abort cleanly, generic message, no silent fallback to "just create a new account anyway," since that fallback would reintroduce the exact silent-duplication risk §3.3's design explicitly avoids.

### 13.4 Expired / Invalid / Revoked Sessions

All three produce an identical 401 (§11.6) — the _internal_ handling (Redis key simply absent vs. cookie failing basic format validation before a lookup is even attempted) can differ for efficiency, but the _external_ behavior must not.

### 13.5 Provider Downtime

Handled as described in §5.7's table and explicitly tested (§14) to confirm the specific, important property that **already-authenticated users are entirely unaffected** by a provider outage — their session validity depends only on Redis, never on a live check against the provider. This is a meaningful, testable guarantee worth stating plainly: OAuth provider downtime degrades _new sign-ins only_, never existing sessions.

## 14. Testing Strategy

### 14.1 Unit Tests

- Session TTL/rotation logic in isolation (sliding-refresh calculation, absolute-cap enforcement, rotation triggering on the linking-confirmation event).
- The identity-linking decision function in isolation (given a provider profile and the current database state, does it correctly identify: new user / returning user / linking-candidate / conflicting-identity-already-claimed) — this function's correctness is central enough to the whole phase's safety that it deserves dedicated, exhaustive unit coverage independent of any HTTP/OAuth-provider context.
- Cookie-flag configuration (confirms `Secure` is correctly environment-conditional and never silently disabled outside local development).

### 14.2 Integration Tests

- Full OAuth flow, both providers, both new-user and returning-user paths, against mocked provider token/userinfo endpoints (real provider calls are never made in automated tests).
- Account-linking confirm path and decline path (§3.3), verifying the decline path's "no shadow account" guarantee explicitly.
- Session validation middleware against a real (test) Redis instance — not mocked, since the actual Redis interaction pattern is exactly what needs verifying.
- The "who am I" endpoint against both an authenticated and an anonymous request.

### 14.3 OAuth-Specific Testing

- `state` mismatch is rejected.
- A reused/already-consumed `state` is rejected (§11.4's replay defense).
- PKCE verifier mismatch is rejected.
- Missing or unverified email is rejected, with the specific, user-actionable message from §5.7.
- A provider callback carrying a consent-denial error is handled as a clean abort, not an error state.

### 14.4 Session Testing

- Creation produces both the primary `session:{id}` key and the corresponding `user-sessions:{userId}` set entry (§10).
- Expiration is verified using a deliberately shortened TTL in the test environment (never waiting out the real production TTL in a test suite).
- Revocation takes effect immediately — a request presenting a just-revoked session is rejected on its very next attempt, no propagation delay.
- Multiple concurrent sessions for the same user are independent — revoking one does not affect the others.

### 14.5 Security Testing

- A tampered/invalid-format session cookie is rejected identically to a missing one (§11.6/§13.4), verified by response-shape comparison, not just status-code comparison.
- A simulated replayed authorization code (mock provider configured to accept a code twice) is rejected on the second attempt.
- An open-redirect attempt (a malicious, non-allowlisted post-login redirect target) is rejected/sanitized (§11.1).
- A session-fixation attempt (a request supplying a pre-chosen, client-generated session identifier prior to authentication) is confirmed to have zero effect — the server-generated ID is always what's actually issued (§11.5).
- Rate limiting on the OAuth endpoints (§11.7) is confirmed to trigger correctly under a simulated burst.

### 14.6 Edge Cases

- User denies OAuth consent.
- Provider returns no email at all (not just unverified — genuinely absent, which some provider configurations permit).
- Network timeout mid-callback (simulated).
- Double-submission race: two near-simultaneous callback requests carrying the same authorization code — exactly one should succeed, the other should fail cleanly (not create a duplicate `User`/`Identity`, not corrupt session state).
- Provider outage while an existing user has a perfectly valid session — confirmed unaffected (§13.5).

## 15. Acceptance Criteria

Phase 1 is complete when **all** of the following are objectively true:

1. A real user can complete sign-in via both Google and GitHub against real (dev/test) provider app registrations, landing in an authenticated state.
2. A new sign-in (no existing Identity, no matching verified email) correctly creates exactly one `User` and one `Identity`.
3. A returning sign-in (existing Identity match) creates no new `User`/`Identity`, only a new `Session`.
4. A cross-provider sign-in with a matching verified email correctly triggers the linking-confirmation flow; confirming links a new `Identity` to the existing `User` and rotates the session ID; declining creates no account and leaves the existing account entirely untouched, with a clear, actionable message shown.
5. An unverified or missing provider email is rejected with a clear message and creates no account.
6. Logout immediately invalidates the session — verified by an immediate subsequent request, not merely by cookie clearing client-side.
7. A tampered, expired, or revoked session cookie is rejected identically (same status, same response shape) in all three cases.
8. The "who am I" endpoint correctly returns current-user data for an authenticated request and a 401 for an anonymous one.
9. No OAuth token, full session ID, `state` value, or PKCE verifier ever appears in any log output, verified by inspection of real log output during test execution, not just code review.
10. Provider downtime (simulated) blocks new sign-ins but does not affect any existing, valid session.
11. Baseline rate limiting is active and verified on the OAuth initiation/callback endpoints.
12. All tests described in §14 exist and pass in CI (extending, not replacing, Phase 0's pipeline).
13. The full local-dev flow (Phase 0's `docker-compose up`) supports signing in against real provider dev-app credentials with no undocumented manual steps beyond what Phase 0 already requires.

## 16. Risks

| Risk                                                                                                                                                                                                                | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OAuth provider API/endpoint changes** (Google or GitHub altering their OAuth implementation details)                                                                                                              | Use a well-maintained OAuth client library rather than hand-rolling raw HTTP calls to provider endpoints where reasonable — a specific library choice is a task-breakdown-level decision, not this spec's concern, but the principle is stated here so it isn't lost                                                                                                                                                                               |
| **Redirect URI misconfiguration across environments**                                                                                                                                                               | Each environment (local/staging/production) has its own provider app registration and exact-match redirect URI, documented clearly per Phase 0's environment-contract pattern (§7 of the Phase 0 spec) — this is a process risk, mitigated by documentation and by CI/deploy-time verification that the expected variables are present (Phase 0's fail-fast config validation already catches a missing/malformed redirect URI at process startup) |
| **Redis as a single point of failure for all authentication**                                                                                                                                                       | An accepted, explicit trade-off (architecture §24.4) — mitigated by the fail-closed behavior (§13.2) and loud alerting (deferred concretely to Phase 21's observability work, but the logging groundwork for it is laid here in §12)                                                                                                                                                                                                               |
| **Scope creep into Phase 3's profile/session-management UI**                                                                                                                                                        | §2's explicit scope boundary, and the deliberate framing throughout this document ("primitives now, UI later") — reviewers should flag any implementation work that starts building settings-page UI during this phase                                                                                                                                                                                                                             |
| **Email-uniqueness confusion** (a user ends up believing they have "lost" an account because they signed up twice with different providers before ever triggering the linking flow, e.g., if they declined it once) | Mitigated by the clear, specific decline-path messaging (§3.3) pointing the user toward the correct provider to use; a full account-recovery/merge-support flow is intentionally out of scope for this phase and would be a support-driven manual process for now                                                                                                                                                                                  |

## 17. Common Mistakes

Frequent, well-documented OAuth implementation mistakes this spec is designed to prevent by construction — called out explicitly so reviewers know exactly what to check for in implementation:

- **Persisting provider access/refresh tokens "just in case."** This phase explicitly does not (§5.4); an implementation that stores them anyway should be flagged as a scope/security deviation, not a helpful addition.
- **Silently auto-merging accounts on email match.** The explicit-confirmation flow (§3.3) exists specifically to prevent this well-known account-takeover vector — any implementation shortcut that skips the confirmation step is a critical defect, not a minor simplification.
- **Trusting a client-supplied redirect/return-to URL without allowlist validation**, creating an open redirect (§11.1).
- **Logging full session tokens or OAuth secrets "for debugging convenience."** §12.2 is exhaustive precisely because this mistake is common and easy to make unintentionally (e.g., logging an entire request object without realizing it includes the cookie header).
- **Treating provider-reported email as always verified.** Some providers can return unverified emails under certain account configurations; skipping the verified-email check (§5.6) reopens the exact account-linking attack the confirmation flow is meant to prevent.
- **Using a static or predictable `state` value**, or reusing one `state` across multiple sign-in attempts, which defeats its CSRF-protection purpose entirely (§5.2).
- **Non-constant-time comparison of security-sensitive values** (session IDs, `state` values) — a minor but real timing-attack surface, avoided by using constant-time comparison utilities for these specific checks.
- **Forgetting to invalidate `state` after use**, leaving a replay window open even within its TTL (§5.2, §11.4).
- **Accepting a client-supplied session identifier before authentication completes** — the classic fixation vector (§11.5); the server must always be the sole generator of session IDs.

## 18. Decisions That Must Never Change Later

These are foundational to this phase and to everything downstream that depends on it. They are not to be casually revisited without a genuine, documented implementation-driven reason, per the working agreement already in effect:

- **OAuth-only authentication, no passwords** — a product-level decision from the frozen architecture (§6.1), not reopened here.
- **`Identity` as a distinct entity from `User`**, keyed on `(provider, providerUserId)`, never on email — the entire multi-provider linking model depends on this shape (§4, §9.2).
- **Redis as the sole session store**, opaque session IDs, never a self-contained JWT carrying claims — every future phase that checks "is this user authenticated" assumes this exact mechanism (§6.3, per architecture §6.3).
- **The explicit-confirmation account-linking policy**, including the specific "abort and inform, never silently create a shadow account" decline behavior (§3.3) — weakening this later to a silent-merge convenience "fix" is precisely the vulnerability this design prevents.
- **No persisted OAuth provider tokens by default** (§5.4) — a future phase may deliberately add token persistence for a specific, new capability, but that must be a conscious new design decision, not a quiet reversal of this phase's data-minimization stance.
- **Cookie flags (`HttpOnly`, `Secure`, `SameSite=Lax`)** — never loosened for convenience, in any environment beyond the explicitly-scoped local-development HTTP exception (§6.1).
- **The request-context shape** (`userId`, `sessionId`, correlation ID) attached by authentication middleware (§7.1) — this is the exact contract Phase 5/7's authorization middleware and Phase 12's WebSocket authorization compose with; changing its shape later means touching every downstream consumer across the roadmap.
- **The "identical 401 for every invalid-session reason" behavior** (§11.6, §13.4) — this is a deliberate anti-oracle security property, not an accidental simplification, and must not be "improved" later with more specific error messages that reintroduce the information leak it prevents.
