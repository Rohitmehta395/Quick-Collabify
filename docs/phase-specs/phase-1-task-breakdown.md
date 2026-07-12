# Phase 1 — Task Breakdown

**Source spec:** `phase-1-engineering-spec.md` (frozen)
**Rule in effect:** tasks are implemented strictly in order within a milestone; milestones are implemented strictly in order. No task begins until its listed dependencies are merged to `main`. No task reaches ahead into a later milestone's concerns (e.g., no rate limiting logic before Milestone 5, no test-writing before there's real behavior to test in Milestone 6).
**Total tasks:** 31, across 7 milestones.
**OAuth client library decision (applies across Milestone 2):** this breakdown standardizes on **Arctic**, a lightweight, framework-agnostic OAuth 2.0/OIDC client library with first-class PKCE and state-parameter support and built-in Google/GitHub provider helpers. It is selected over heavier alternatives (e.g., Passport.js) specifically because it does not bundle its own session-management opinions — this system's session architecture is fully custom (Redis-backed, per Phase 1 spec §6), and a library that tried to own sessions would fight that design rather than support it. This decision is recorded as its own ADR in Milestone 7.

---

## Milestone 1 — Authentication Foundation

_Ends with: the database can represent a User and their linked Identities, Redis session-key conventions are wired and reachable, and the shared validation schemas auth work will depend on exist. No OAuth flow yet._

### P1-T01 — Install OAuth & Session Dependencies

- **Goal:** Add the packages this phase's backend work depends on to `apps/api`.
- **Why this task exists:** every subsequent backend task in Milestones 2–5 assumes these packages are already present and version-pinned; installing them as a standalone first step keeps dependency changes isolated from logic changes in the git history.
- **Scope:** Package installation and lockfile update only — no usage of the packages yet.
- **Files expected:** Modify `apps/api/package.json`; modify root `pnpm-lock.yaml`.
- **Dependencies:** Phase 0 complete (pnpm workspace, `apps/api` scaffold).
- **External packages:**
  - `arctic` — OAuth 2.0 client with PKCE/state support and Google/GitHub helpers (see standardization note above).
  - `cookie-parser` — Express middleware for reading/writing the session cookie with the correct flags (Express's built-in `res.cookie` covers writing, but reading incoming cookies on requests needs this).
  - `ioredis` — only if not already installed in Phase 0's worker scaffolding for `apps/api` specifically; confirm and add if missing (Phase 0 may have only installed it for `apps/worker`).
- **Commands:**
  - `pnpm --filter api add arctic cookie-parser ioredis`
- **Verification:** `pnpm install` at the repo root completes with no errors; `apps/api/package.json` lists all three packages at pinned versions per Phase 0's dependency policy (spec §18).
- **Definition of Done:** Packages installed, lockfile committed, no other files touched.
- **Common mistakes:** Installing a package at the repo root instead of scoped to `apps/api` via `--filter`, which pollutes the workspace root's dependency list unnecessarily.
- **Estimated time:** 30 min.
- **Git commit:** `chore(auth): add OAuth and session dependencies`

---

### P1-T02 — User & Identity Prisma Models and Migration

- **Goal:** Add the `User` and `Identity` models to the Prisma schema, per Phase 1 spec §9, and generate the corresponding migration.
- **Why this task exists:** every later task in this phase — session creation, OAuth callback handling, account linking — reads or writes these two tables; nothing else can be meaningfully built until they exist.
- **Scope:** Included — `User` model (display name, avatar URL, non-unique indexed email, timestamps), `Identity` model (provider, providerUserId, foreign key to User, composite unique constraint, timestamps), the index on `Identity.userId` (spec §9.4). Excluded — no `Session` model (sessions are Redis-only, per spec §9.1); no workspace-related fields or relations (Phase 4+).
- **Files expected:** Modify `apps/api/prisma/schema.prisma`; create a new migration under `apps/api/prisma/migrations/`.
- **Dependencies:** P0-T25 (Prisma initialized).
- **External packages:** None — Prisma is already installed per Phase 0.
- **Commands:**
  - `pnpm --filter api exec prisma migrate dev --name add_user_and_identity`
  - `pnpm --filter api exec prisma generate`
- **Verification:** Migration applies cleanly against the Compose-provided Postgres with zero errors; inspecting the resulting tables confirms the composite unique constraint on `(provider, providerUserId)` and the index on `email` exist as designed; `prisma migrate deploy` also succeeds against a freshly reset database (confirms the migration is reproducible, not just locally patched).
- **Definition of Done:** Migration file committed; schema matches spec §9 exactly (no email uniqueness constraint, per the explicit decision in spec §9.2); Prisma client regenerates without error.
- **Common mistakes:** Accidentally adding a unique constraint on `email` out of habit — this directly contradicts the documented decision in Phase 1 spec §9.2 and must not happen; forgetting the composite (not single-column) uniqueness on `Identity`.
- **Estimated time:** 45 min.
- **Git commit:** `feat(auth): add User and Identity models with migration`

---

### P1-T03 — Scaffold Auth Module Structure

- **Goal:** Create the internal folder/module structure within `apps/api` that subsequent tasks will populate (empty function stubs are not created here — just the module boundaries and their `package.json`-adjacent wiring, if using a sub-package pattern, or plain folders if not).
- **Why this task exists:** establishes where OAuth logic, session logic, and identity-resolution logic will each live before any of them are written, so later tasks are additive to an agreed structure rather than each task inventing its own placement.
- **Scope:** Folder/module boundaries only. No functions, no logic.
- **Files expected:** Create `apps/api/src/auth/` directory (with subdirectories for `oauth/`, `sessions/`, `identity/` — folder creation only, each containing nothing but confirms the boundary); modify `apps/api/src/app.js` only if a wiring stub is genuinely needed (prefer not touching it yet if avoidable).
- **Dependencies:** P0-T17 (Express bootstrap).
- **External packages:** None.
- **Commands:** None beyond standard file creation.
- **Verification:** Directory structure exists and matches the module boundaries described; confirm via `apps/api`'s existing lint/build pipeline (Phase 0's CI) that empty folders don't break anything (empty JS directories are generally fine, but verify the build step doesn't choke on an empty folder if it expects at least one file — add a placeholder index file per folder only if required for tooling, not for its own sake).
- **Definition of Done:** Folder structure committed, CI still green.
- **Common mistakes:** Over-scaffolding by writing function signatures or stub logic "to save time later" — this task is explicitly structure-only, per the roadmap's "no placeholder implementations" rule; a stub that returns fake data is a placeholder and is not permitted even here.
- **Estimated time:** 30 min.
- **Git commit:** `chore(auth): scaffold auth module structure`

---

### P1-T04 — Redis Session Key Utilities

- **Goal:** Implement the low-level Redis key-building and connection-access utilities for the three key patterns defined in spec §10 (`session:{sessionId}`, `user-sessions:{userId}`, `oauth-state:{state}`) — key construction and a shared Redis client accessor only, not the higher-level session-lifecycle functions (those are Milestone 3).
- **Why this task exists:** every later Redis-touching task (state storage in Milestone 2, session CRUD in Milestone 3) should build on one consistent key-naming implementation rather than each task hand-rolling its own string interpolation, which risks drift from the documented convention.
- **Scope:** Included — key-building functions, a shared Redis client instance reused across the auth module. Excluded — no TTL logic, no session creation/read/delete logic yet (Milestone 3); no OAuth-state logic yet (Milestone 2).
- **Files expected:** Create `apps/api/src/auth/sessions/redis-keys.js` (or equivalent), reusing `packages/config`'s Redis connection details from Phase 0.
- **Dependencies:** P1-T03, P0-T09 (Redis config schema).
- **External packages:** None (uses `ioredis`, already installed in P1-T01).
- **Commands:** None beyond running the existing dev server to confirm connectivity.
- **Verification:** A quick manual check (e.g., a throwaway script or REPL) confirms the key-builder functions produce exactly the key formats documented in spec §10 and Phase 0 spec §22; confirms the shared Redis client successfully connects against the Compose-provided Redis instance.
- **Definition of Done:** Key-builder utilities exist, produce correct formats, and are the only place in the codebase that constructs these key strings (no other file should ever interpolate a `session:` prefix manually).
- **Common mistakes:** Hardcoding the key prefix string in multiple places instead of centralizing it here — this is exactly the drift risk this task exists to prevent.
- **Estimated time:** 45 min.
- **Git commit:** `feat(auth): add Redis session key utilities`

---

### P1-T05 — Auth Zod Schemas

- **Goal:** Define the Zod schemas for OAuth callback query parameters, the account-linking confirmation request body, and the session/user-identity data shapes referenced elsewhere in this phase, in `packages/schemas`.
- **Why this task exists:** per spec §8.5 and the architecture's shared-schema principle, validation logic for this phase's request boundaries should exist once, here, and be imported by both the API routes (Milestone 2/4) and any frontend form/request code, rather than being defined ad hoc inside a route handler when that route is built.
- **Scope:** Included — OAuth callback query schema (code, state), linking-confirmation body schema (confirm/decline action), a `User`-shape schema for the "who am I" response. Excluded — no schemas for anything outside this phase's endpoints (no workspace/document schemas).
- **Files expected:** Create `packages/schemas/src/auth/oauth-callback.js`, `packages/schemas/src/auth/linking-confirmation.js`, `packages/schemas/src/auth/user.js`; modify `packages/schemas/src/index.js` to export them.
- **Dependencies:** P0-T15 (packages/schemas scaffolded).
- **External packages:** None (Zod already installed per architecture's stack requirement, confirm it's present in `packages/schemas`'s dependencies — add if Phase 0 didn't already).
- **Commands:** `pnpm --filter schemas add zod` (only if not already present from Phase 0).
- **Verification:** Unit-level manual check: each schema correctly accepts a valid example payload and rejects an invalid one (missing field, wrong type) with a clear Zod error.
- **Definition of Done:** All three schemas exist, exported, and independently verified against both valid and invalid example input.
- **Common mistakes:** Defining these schemas inline inside route handlers instead of in the shared package — this defeats the entire purpose of the shared-schema principle and creates rework when the frontend needs the identical validation logic.
- **Estimated time:** 45 min.
- **Git commit:** `feat(schemas): add auth request/response schemas`

---

## Milestone 2 — OAuth Providers

_Ends with: a user can be redirected to Google or GitHub, complete consent, and land back on a callback route that has successfully validated state, exchanged the code, fetched a verified profile — without yet creating a database record or session (that's Milestone 4)._

### P1-T06 — Configure OAuth Provider Clients (Google & GitHub)

- **Goal:** Configure Arctic's Google and GitHub provider clients using the OAuth client ID/secret and redirect URIs sourced from `packages/config`'s environment schema.
- **Why this task exists:** both providers follow an identical configuration pattern once Arctic is in place; doing them together in one task avoids the overhead of two nearly-identical task write-ups, while still being a single, focused, reviewable unit of work distinct from the routes that will use these clients.
- **Scope:** Included — provider client instantiation for both Google and GitHub, environment variable additions for both providers' client ID/secret/redirect URI. Excluded — no routes yet, no callback handling logic yet.
- **Files expected:** Create `apps/api/src/auth/oauth/providers.js`; modify `packages/config/src/api-config.js` (add `OAUTH_GOOGLE_CLIENT_ID`, `OAUTH_GOOGLE_CLIENT_SECRET`, `OAUTH_GOOGLE_REDIRECT_URI`, `OAUTH_GITHUB_CLIENT_ID`, `OAUTH_GITHUB_CLIENT_SECRET`, `OAUTH_GITHUB_REDIRECT_URI`); modify root `.env.example` to match (Phase 0's env-contract CI check, per that spec §17, will fail otherwise).
- **Dependencies:** P1-T01, P1-T03.
- **External packages:** None beyond `arctic` (already installed).
- **Commands:** None beyond running the dev server to confirm the config loader accepts the new variables.
- **Verification:** Starting `apps/api` with real (dev-registered) Google/GitHub OAuth app credentials in `.env` succeeds with no config-validation errors; starting it with one of the new variables deliberately missing fails fast with the expected Phase 0-style config error, confirming the new variables are actually wired into the schema, not just declared and ignored.
- **Definition of Done:** Both provider clients instantiate successfully against real dev-app credentials; `.env.example` and the config schema are in sync (manually confirmed here, automatically re-confirmed by CI in Milestone 6).
- **Common mistakes:** Registering the OAuth apps with a redirect URI that doesn't exactly match what the code sends (provider-side exact-match validation is strict) — verify the registered URI and the configured one are byte-identical, including trailing slashes.
- **Estimated time:** 60 min.
- **Git commit:** `feat(auth): configure Google and GitHub OAuth provider clients`

---

### P1-T07 — State Parameter & PKCE Generation/Validation

- **Goal:** Implement generation of a cryptographically random `state` value and PKCE code verifier/challenge pair, storage of the state (and verifier) in Redis under `oauth-state:{state}` with a short TTL, and a validation function that checks-and-deletes on use (per spec §5.2, §11.4).
- **Why this task exists:** this is the CSRF/replay defense for the entire OAuth flow and must exist before any route actually initiates or completes a sign-in — building it as an isolated, independently testable unit means its correctness doesn't depend on the surrounding route logic being right too.
- **Scope:** Included — generation, Redis storage with TTL, validation-with-deletion. Excluded — no route wiring yet.
- **Files expected:** Create `apps/api/src/auth/oauth/state.js`.
- **Dependencies:** P1-T04 (Redis key utilities), P1-T06 (Arctic configured, since PKCE helpers come from Arctic).
- **External packages:** None beyond `arctic`.
- **Commands:** None.
- **Verification:** A manual/scripted check confirms: a generated state can be validated exactly once and fails on a second validation attempt against the same value (replay defense, spec §11.4); an expired (simulate via a shortened TTL) state fails validation; a state that was never generated fails validation.
- **Definition of Done:** State generation, storage, and single-use validation all independently confirmed working against real Redis.
- **Common mistakes:** Validating state without deleting it immediately (leaves a replay window open until natural TTL expiry, contradicting spec §5.2's explicit "delete on use" requirement) — this is the single most important correctness property of this task and deserves its own explicit verification step, not just incidental coverage.
- **Estimated time:** 60 min.
- **Git commit:** `feat(auth): implement OAuth state and PKCE generation/validation`

---

### P1-T08 — Sign-In Initiation Route

- **Goal:** Add the route(s) that, given a provider name (Google or GitHub), generate state/PKCE (T07) and redirect the browser to that provider's authorization endpoint via the configured client (T06).
- **Why this task exists:** this is the first user-facing entry point into the OAuth flow and is the natural next building block once state/PKCE and provider clients both independently exist.
- **Scope:** Included — the redirect-initiating route(s) for both providers. Excluded — no callback handling (T09); no post-login redirect-target allowlist validation yet (that's specifically part of T09/T22's callback completion, since the return-to target is only relevant once sign-in actually completes).
- **Files expected:** Create `apps/api/src/auth/oauth/routes.js` (or add to it if T09 will extend the same file); modify `apps/api/src/app.js` to mount the new route(s) as public (per spec §8.4).
- **Dependencies:** P1-T06, P1-T07.
- **External packages:** None.
- **Commands:** `pnpm --filter api dev` (manual verification below).
- **Verification:** Manually navigating to the initiation route in a browser (or via curl following redirects) results in a redirect to the correct provider's real consent screen, with the expected `client_id`, `redirect_uri`, and PKCE challenge present in the URL.
- **Definition of Done:** Both providers' initiation routes correctly redirect to a real, working provider consent screen.
- **Common mistakes:** Forgetting to mark this route explicitly public in whatever route-declaration pattern Milestone 5 will formalize — for now, simply ensure it is not accidentally gated behind auth middleware that doesn't exist yet (not a real risk at this exact point in the sequence, but worth confirming when Milestone 5's middleware is added later that this route is correctly exempted).
- **Estimated time:** 45 min.
- **Git commit:** `feat(auth): add OAuth sign-in initiation routes`

---

### P1-T09 — OAuth Callback: Code Exchange & Profile Fetch

- **Goal:** Implement the callback route's first half: validate `state` (T07), exchange the authorization code for tokens via Arctic, fetch the provider's user profile, and discard the tokens immediately after the fetch (per spec §5.4's data-minimization decision) — stopping short of any database/session logic, which is Milestone 4.
- **Why this task exists:** isolates the OAuth-protocol mechanics (code exchange, profile fetch, token discarding) from the identity-resolution business logic that comes next, so each can be verified independently — a failure here is a protocol-level problem, not a business-logic one.
- **Scope:** Included — state validation, code exchange, profile fetch, explicit non-persistence of tokens. Excluded — no email-verification check yet (T10); no database writes; no session issuance.
- **Files expected:** Modify `apps/api/src/auth/oauth/routes.js` (add the callback route); create `apps/api/src/auth/oauth/exchange.js` (the exchange/fetch logic itself, kept separate from route wiring for testability).
- **Dependencies:** P1-T08.
- **External packages:** None beyond `arctic`.
- **Commands:** None beyond dev-server manual testing.
- **Verification:** Completing a real sign-in flow through a dev-registered provider app up through this route successfully logs (temporarily, for manual verification only — real logging rules apply starting Milestone 7) the fetched profile fields; confirm via code review (not a log line left in permanently) that no token value is retained anywhere after the fetch completes.
- **Definition of Done:** A real, end-to-end OAuth handshake (both providers) reaches this point successfully and the fetched profile is available to the next task; no token persists past this function's execution.
- **Common mistakes:** Accidentally storing the raw token response "temporarily for debugging" and forgetting to remove it — this directly violates spec §5.4/§18's frozen decision; treat any lingering token storage as a defect, not a convenience.
- **Estimated time:** 75 min.
- **Git commit:** `feat(auth): implement OAuth code exchange and profile fetch`

---

### P1-T10 — Email Verification Enforcement

- **Goal:** Add the check (per spec §5.6) that rejects sign-in if the provider-reported email is missing or not marked verified, with the specific clear rejection message from spec §5.7.
- **Why this task exists:** this check is a prerequisite for the account-linking flow's safety (Milestone 4) and must exist and be independently verified before any identity-matching logic is built on top of a profile that might carry an untrustworthy email.
- **Scope:** Included — the verification check and its specific rejection path. Excluded — no identity/database logic yet.
- **Files expected:** Modify `apps/api/src/auth/oauth/exchange.js` (add the check immediately after profile fetch).
- **Dependencies:** P1-T09.
- **External packages:** None.
- **Commands:** None.
- **Verification:** Using a mocked/test provider profile response with `email_verified: false` (or the field absent) confirms the flow stops with the exact rejection behavior from spec §5.7, creating no side effects; a verified-email profile passes through unaffected.
- **Definition of Done:** Both the pass and reject paths are confirmed against realistic profile shapes for each provider (note: Google and GitHub structure this field differently — confirm both are handled correctly, not just one).
- **Common mistakes:** Checking only Google's verification field shape and assuming GitHub's is identical — the two providers do not represent this identically, and this is exactly the kind of provider-specific detail worth explicit, separate verification per provider.
- **Estimated time:** 45 min.
- **Git commit:** `feat(auth): enforce verified email requirement on OAuth callback`

---

## Milestone 3 — Session Management

_Ends with: a fully working, independently testable session lifecycle (create, validate with sliding refresh, revoke, rotate) against real Redis — built and proven before it's wired into the OAuth callback flow in Milestone 4._

### P1-T11 — Session Creation Function

- **Goal:** Implement the function that, given a `userId`, creates a new session: generates a cryptographically random session ID (server-side only, per spec §11.5), writes the `session:{id}` key with initial TTL, and adds the ID to the `user-sessions:{userId}` set (per spec §6.6, §10) — both operations executed as a single logical unit (pipeline/transaction, per spec §10's drift-prevention requirement).
- **Why this task exists:** this is the foundational session primitive every other session task and the eventual OAuth callback integration (Milestone 4) depends on.
- **Scope:** Included — ID generation, key writes, TTL setting. Excluded — cookie issuance (T12), validation/refresh logic (T13).
- **Files expected:** Create `apps/api/src/auth/sessions/create-session.js`.
- **Dependencies:** P1-T04.
- **External packages:** None (Node's built-in `crypto.randomUUID()` or equivalent is sufficient for session ID generation — no extra package needed for this).
- **Commands:** None.
- **Verification:** Calling the function against a test `userId` produces both a `session:{id}` key and a corresponding entry in `user-sessions:{userId}` in Redis, confirmed by direct inspection; the TTL on the session key matches the sliding-window value from spec §6.2.
- **Definition of Done:** Function produces both keys atomically; a simulated partial-failure scenario (if testable at this stage) does not leave the two structures inconsistent.
- **Common mistakes:** Writing the two keys as two separate, non-atomic Redis calls — this reopens exactly the drift risk spec §10 warns about; use a pipeline or multi/exec.
- **Estimated time:** 60 min.
- **Git commit:** `feat(auth): implement session creation`

---

### P1-T12 — Session Cookie Issuance

- **Goal:** Implement the helper that sets the session cookie on an Express response with the exact flags required by spec §6.1/§11.3 (`HttpOnly`, `Secure` conditional on environment, `SameSite=Lax`), and the corresponding helper to clear it on logout.
- **Why this task exists:** cookie flag correctness is a named, explicit security requirement (spec §11.3) and deserves isolated implementation and verification rather than being inlined into a route handler where a flag could be silently misconfigured.
- **Scope:** Included — set-cookie and clear-cookie helpers. Excluded — no route wiring yet.
- **Files expected:** Create `apps/api/src/auth/sessions/cookie.js`.
- **Dependencies:** P1-T01 (`cookie-parser` installed), P1-T11.
- **External packages:** None beyond `cookie-parser` (already installed).
- **Commands:** None.
- **Verification:** Inspecting the `Set-Cookie` response header in a local (HTTP) dev environment confirms `HttpOnly` and `SameSite=Lax` are present and confirms `Secure` is correctly **absent** locally (per the documented local-HTTP exception) — then confirms, via a staging-like HTTPS environment or an explicit environment-variable override test, that `Secure` **is** present when the environment is not local.
- **Definition of Done:** Both the local and non-local flag configurations are explicitly verified, not assumed from reading the config code.
- **Common mistakes:** Verifying only the local case and assuming the non-local case is "obviously fine" — this is precisely the kind of oversight spec §6.1 calls out as a realistic, easy-to-miss mistake; it must be tested, not assumed.
- **Estimated time:** 45 min.
- **Git commit:** `feat(auth): implement session cookie issuance with security flags`

---

### P1-T13 — Session Validation with Sliding Refresh

- **Goal:** Implement the function that, given a session ID from a request's cookie, looks up `session:{id}` in Redis, returns the session data if found and not expired, refreshes its TTL up to the absolute cap (per spec §6.2's combined sliding/absolute model), and returns a clear "invalid" signal otherwise.
- **Why this task exists:** this is the function the authentication middleware (Milestone 5) will call on every protected request; building and proving it correct in isolation first means the middleware task is simple wiring, not simultaneous logic-and-wiring work.
- **Scope:** Included — lookup, sliding-TTL refresh logic, absolute-cap enforcement. Excluded — no Express middleware wiring yet.
- **Files expected:** Create `apps/api/src/auth/sessions/validate-session.js`.
- **Dependencies:** P1-T11.
- **External packages:** None.
- **Commands:** None.
- **Verification:** A valid, recently-created session validates successfully and its TTL is confirmed refreshed afterward; a session manually set with an already-expired TTL (simulated) correctly returns invalid; a session artificially aged past the absolute cap (simulated by setting a creation timestamp in the past) correctly returns invalid even though its sliding TTL would otherwise still be valid — this specific case is the one most likely to be implemented incorrectly and deserves its own explicit test.
- **Definition of Done:** All three cases above (valid-and-refreshed, naturally-expired, absolute-cap-exceeded) are independently confirmed.
- **Common mistakes:** Implementing only the sliding-refresh behavior and forgetting the absolute cap entirely — per spec §6.2's comparison table, the combined model's entire value is the upper bound the absolute cap provides; omitting it silently degrades the design to "sliding-only," which was explicitly rejected.
- **Estimated time:** 75 min.
- **Git commit:** `feat(auth): implement session validation with sliding and absolute expiration`

---

### P1-T14 — Session Revocation

- **Goal:** Implement the function that deletes a `session:{id}` key and removes its entry from `user-sessions:{userId}`, atomically (same drift-prevention requirement as T11).
- **Why this task exists:** required for logout (Milestone 5) and is the literal mechanism behind the "instant revocation" guarantee spec §6.5 makes.
- **Scope:** Included — single-session revocation. Excluded — no "revoke all sessions for a user" bulk operation (not required by this phase's scope per spec §2.2 — that's Phase 3 UI-driven functionality, though this function could trivially be called in a loop by a future phase; building a dedicated bulk function now would be scope creep ahead of an actual requirement).
- **Files expected:** Create `apps/api/src/auth/sessions/revoke-session.js`.
- **Dependencies:** P1-T11.
- **External packages:** None.
- **Commands:** None.
- **Verification:** Revoking a session confirms both the `session:{id}` key and its `user-sessions:{userId}` entry are gone; a subsequent validation attempt (via T13) against the revoked session ID correctly returns invalid immediately, with no propagation delay.
- **Definition of Done:** Revocation is confirmed atomic and immediately effective.
- **Common mistakes:** Deleting only the primary session key and leaving a stale entry in the `user-sessions` set, which would corrupt any future Phase 3 "list my sessions" feature with references to sessions that no longer exist.
- **Estimated time:** 30 min.
- **Git commit:** `feat(auth): implement session revocation`

---

### P1-T15 — Session Rotation

- **Goal:** Implement the function that issues a brand-new session ID for an existing session's user (creating a new `session:{id}`/`user-sessions:{userId}` entry, per T11's logic) and revokes the old one (per T14's logic) — used specifically after the account-linking confirmation event (spec §6.4).
- **Why this task exists:** this is a distinct operation from both plain creation and plain revocation (it's a coordinated pair), and per spec §6.4/§18, establishes the pattern any future privilege-relevant event will reuse — worth its own explicit, tested implementation rather than being inlined into the linking-confirmation route when that's built in Milestone 4.
- **Scope:** Included — the create-new-then-revoke-old sequence as a single function. Excluded — no wiring into the linking-confirmation route yet (Milestone 4).
- **Files expected:** Create `apps/api/src/auth/sessions/rotate-session.js`.
- **Dependencies:** P1-T11, P1-T14.
- **External packages:** None.
- **Commands:** None.
- **Verification:** Calling rotation against an existing session confirms a new, different session ID is produced, the old session ID is confirmed invalid afterward (via T13), and the new session correctly validates for the same `userId`.
- **Definition of Done:** Rotation is confirmed to produce a genuinely new ID (not a reused or predictable one) and to fully invalidate the old one.
- **Common mistakes:** Revoking the old session before the new one is successfully created, which would momentarily leave the user with zero valid sessions if an error occurs between the two steps — sequence the operations so a failure during creation never destroys the still-valid old session.
- **Estimated time:** 45 min.
- **Git commit:** `feat(auth): implement session rotation for privilege-relevant events`

---

## Milestone 4 — Account Linking

_Ends with: the full sign-in decision logic (new user / returning user / linking candidate / conflicting identity) is implemented and independently tested, and the entire OAuth callback — from redirect to authenticated session — works end-to-end for the first time._

### P1-T16 — Identity Lookup & Decision Function

- **Goal:** Implement the function that, given a verified provider profile, determines which of the four cases from spec §3 applies: new user, returning user (existing Identity match), linking candidate (email matches an existing User via a different provider), or conflicting identity (the target Identity is already linked to a different user than expected — spec §8.3's 409 case) — returning a clear, typed result for the calling route to act on, without performing any writes itself.
- **Why this task exists:** spec §14.1 explicitly calls this function out as deserving dedicated, exhaustive unit testing independent of any HTTP/OAuth context, given how central its correctness is to the whole phase's safety — implementing it as a pure decision function (read-only, no side effects) is what makes that isolated testing possible.
- **Scope:** Included — the decision logic only, reading from Postgres via Prisma. Excluded — no database writes (that's T17/T18); no session logic.
- **Files expected:** Create `apps/api/src/auth/identity/resolve-identity.js`.
- **Dependencies:** P1-T02 (User/Identity models), P1-T05 (schemas).
- **External packages:** None (Prisma already installed).
- **Commands:** None.
- **Verification:** Against a seeded test database, each of the four cases is independently confirmed to produce the correct classification given the appropriate input profile.
- **Definition of Done:** All four cases pass explicit, independent verification — this is the single most important correctness gate in the entire phase and should not be considered done based on only the "happy path" (new user) case working.
- **Common mistakes:** Matching on email as if it were a reliable primary key instead of using it only to _suggest_ a linking candidate (per spec §4/§9.2, email is never the identity anchor) — a bug here could misclassify a returning user as a linking candidate or vice versa.
- **Estimated time:** 90 min.
- **Git commit:** `feat(auth): implement identity resolution decision logic`

---

### P1-T17 — New User & Returning User Creation Paths

- **Goal:** Implement the two straightforward outcomes from T16's decision function: creating a new `User` + `Identity` transactionally (spec §9.3) for the new-user case, and simply confirming the existing `User` for the returning-user case (no write needed).
- **Why this task exists:** these are the two lower-risk, higher-frequency paths (spec §3.1, §3.2) and are natural to implement together, immediately after the decision function that routes to them — the higher-risk linking path (T18) is deliberately isolated as its own task.
- **Scope:** Included — transactional new-user creation, returning-user pass-through. Excluded — linking-candidate and conflict handling (T18).
- **Files expected:** Create `apps/api/src/auth/identity/create-user.js`.
- **Dependencies:** P1-T16.
- **External packages:** None.
- **Commands:** None.
- **Verification:** A new-user scenario produces exactly one `User` and one `Identity` row, confirmed by direct database inspection; a simulated failure injected between the two writes (e.g., a forced error before the `Identity` insert) confirms the transaction rolls back completely, leaving zero rows — this is the specific correctness property spec §9.3 calls out and must be explicitly tested, not assumed from "it's wrapped in a transaction so it's probably fine."
- **Definition of Done:** Both paths confirmed correct; the transactional-rollback case specifically confirmed, not just the happy path.
- **Common mistakes:** Wrapping the two writes in a transaction but not actually testing the rollback behavior — an untested transaction boundary is not a verified guarantee.
- **Estimated time:** 60 min.
- **Git commit:** `feat(auth): implement new user creation and returning user resolution`

---

### P1-T18 — Account Linking Confirmation Endpoint

- **Goal:** Implement the linking-candidate flow from spec §3.3: a dedicated endpoint that, given a pending linking-candidate context, either confirms (creates the new `Identity` linked to the existing `User`, triggers session rotation per T15) or declines (creates nothing, returns the specific clear message from spec §3.3, issues no session).
- **Why this task exists:** this is the highest-security-sensitivity path in the entire phase (the exact mechanism spec §18 calls out as never to be weakened later) and is deliberately isolated from T17's lower-risk paths so it gets focused, careful implementation and review.
- **Scope:** Included — confirm and decline handling, session rotation on confirm. Excluded — no wiring into the main callback route yet (T19); no conflict-case (409) handling (a stretch case — if not naturally covered here, confirm it's at least explicitly deferred and flagged, not silently unhandled).
- **Files expected:** Create `apps/api/src/auth/identity/linking.js`; add a route in `apps/api/src/auth/oauth/routes.js` (protected — this endpoint is only reachable mid-flow with a pending linking context, not by an arbitrary anonymous request).
- **Dependencies:** P1-T16, P1-T15 (session rotation), P1-T05 (linking-confirmation schema).
- **External packages:** None.
- **Commands:** None.
- **Verification:** The confirm path is verified to create exactly one new `Identity` on the existing `User`, produce a rotated session, and leave the old session invalid; the decline path is verified to create zero rows and issue zero sessions, and to return the exact clear message from spec §3.3 — both are the literal Phase 1 acceptance criterion #4.
- **Definition of Done:** Both confirm and decline paths independently verified against spec §3.3's exact described behavior, including the "no shadow account" guarantee on decline.
- **Common mistakes:** Implementing decline as "create the account anyway, just don't link it" instead of "create nothing" — this is the exact silent-duplication anti-pattern the whole design exists to prevent (spec §3.3, §17); re-read that section before implementing this task if there's any ambiguity.
- **Estimated time:** 90 min.
- **Git commit:** `feat(auth): implement account linking confirmation and decline flow`

---

### P1-T19 — Wire Full OAuth Callback Flow End-to-End

- **Goal:** Integrate T09/T10 (exchange, verification), T16 (identity resolution), T17 (new/returning user), T18 (linking), and T11/T12 (session creation, cookie issuance) into the complete callback route — the first point in the phase where a real, unbroken sign-in works from click to authenticated session.
- **Why this task exists:** every prior task in Milestones 2–4 was deliberately built and tested in isolation; this task is where they're proven to compose correctly together, which is a distinct risk from any individual piece being correct on its own.
- **Scope:** Included — full route wiring, the open-redirect-safe post-login redirect (allowlist validation per spec §11.1, only relevant now that sign-in genuinely completes). Excluded — no auth middleware yet (Milestone 5 — this task proves sign-in works, not that _subsequent_ protected requests work).
- **Files expected:** Modify `apps/api/src/auth/oauth/routes.js` (the callback route becomes fully functional); create `apps/api/src/auth/redirect-allowlist.js`.
- **Dependencies:** P1-T09, P1-T10, P1-T16, P1-T17, P1-T18, P1-T11, P1-T12.
- **External packages:** None.
- **Commands:** `pnpm --filter api dev` for manual end-to-end verification.
- **Verification:** A real, manual sign-in through the browser against both real provider dev-apps succeeds end-to-end for all of: new user, returning user, and linking-confirm/decline, each confirmed by inspecting both the database state and the resulting session cookie; a manipulated post-login redirect parameter pointing to an external domain is confirmed rejected/sanitized.
- **Definition of Done:** This task's verification _is_ Phase 1 spec's acceptance criteria #1–#4 (spec §15) — all four must pass manually before this task is considered done.
- **Common mistakes:** Discovering during integration that two independently-tested pieces (e.g., T16's decision output shape and T18's expected input shape) don't actually line up — if this happens, fix the mismatch here rather than papering over it with an ad hoc adapter; a clean interface between these pieces was the point of building them separately.
- **Estimated time:** 90 min.
- **Git commit:** `feat(auth): wire complete OAuth callback flow end-to-end`

---

## Milestone 5 — Authorization Middleware

_Ends with: protected routes genuinely require authentication, an authenticated user can retrieve their own identity via a real endpoint, can log out, and the OAuth endpoints are rate-limited._

### P1-T20 — Authentication Middleware

- **Goal:** Implement the Express middleware that reads the session cookie, calls T13's validation function, and either attaches the request context (`userId`, `sessionId`, correlation ID — spec §7.1) to `req.user` and calls `next()`, or short-circuits with a 401 using Phase 0's error envelope.
- **Why this task exists:** this is the literal implementation of spec §7's authorization foundation and the contract every future phase's authorization layer composes with — it must be correct and stable before any route depends on it.
- **Scope:** Included — the middleware function itself. Excluded — no route-level public/protected declaration pattern yet (T21); no role/permission logic (out of phase scope entirely).
- **Files expected:** Create `apps/api/src/auth/middleware/authenticate.js`.
- **Dependencies:** P1-T13.
- **External packages:** None.
- **Commands:** None.
- **Verification:** A request with a valid session cookie reaches a downstream test handler with `req.user` correctly populated; a request with no cookie, an expired session, a revoked session, and a malformed cookie are each confirmed to produce an _identical_ 401 response shape (spec §11.6/§13.4) — this identical-response property is explicitly tested, not just the fact that all four cases return _some_ 401.
- **Definition of Done:** All four invalid-session cases produce byte-identical response bodies (differing only in nothing user-visible); the valid case correctly populates `req.user`.
- **Common mistakes:** Returning a slightly different error message for "expired" vs. "revoked" vs. "malformed" out of a well-intentioned desire to be more helpful — this directly reopens the information-leak spec §11.6 exists to close; resist the urge to be more specific here.
- **Estimated time:** 60 min.
- **Git commit:** `feat(auth): implement authentication middleware`

---

### P1-T21 — Protected/Public Route Pattern & Logout Endpoint

- **Goal:** Establish the convention for declaring a route as protected (applies T20's middleware) vs. public (does not), apply it retroactively to the OAuth initiation/callback routes (public) and the linking-confirmation route (protected — reachable only mid-flow, per T18's note), and implement the logout endpoint (protected, calls T14's revocation function and T12's cookie-clearing helper).
- **Why this task exists:** formalizes, in one place, the public/protected boundary spec §8.4 describes conceptually, applying it concretely to every route that exists so far, and adds the first genuinely protected, mutating endpoint (logout) as proof the pattern works end-to-end.
- **Scope:** Included — the route-declaration convention, its application to existing routes, the logout endpoint. Excluded — no new business-logic routes beyond logout.
- **Files expected:** Modify `apps/api/src/app.js` (or wherever routes are mounted) to apply the pattern consistently; create `apps/api/src/auth/routes/logout.js`.
- **Dependencies:** P1-T20, P1-T14, P1-T12, P1-T08/T09/T18/T19 (the routes being retroactively classified).
- **External packages:** None.
- **Commands:** `pnpm --filter api dev` for manual verification.
- **Verification:** The OAuth initiation/callback routes remain reachable without a session (confirming they weren't accidentally gated); the logout endpoint is confirmed to reject an unauthenticated request; calling logout with a valid session confirms the session is immediately revoked (a subsequent request with the same cookie is rejected) and the cookie is cleared in the response.
- **Definition of Done:** Every existing route is explicitly and correctly classified; logout works end-to-end and is covered by both the manual check above and will be covered by automated tests in Milestone 6.
- **Common mistakes:** Accidentally applying the authentication middleware globally and then trying to "unprotect" the OAuth routes with exceptions, rather than defaulting to public and explicitly protecting what needs it — either approach can work, but pick one deliberately and apply it consistently; an inconsistent mix is how a route gets accidentally left unprotected.
- **Estimated time:** 60 min.
- **Git commit:** `feat(auth): establish route protection pattern and implement logout`

---

### P1-T22 — "Who Am I" Endpoint

- **Goal:** Implement the minimal protected endpoint that returns the current authenticated user's identity data (per spec §2.1/§8.4), using T05's user-shape schema for the response.
- **Why this task exists:** this is the specific endpoint the frontend needs to render an authenticated shell (spec §8.4), and is a natural, small next step now that protected-route infrastructure (T20/T21) exists.
- **Scope:** Included — the read-only endpoint. Excluded — no profile-editing capability (Phase 3).
- **Files expected:** Create `apps/api/src/auth/routes/me.js`; modify route mounting in `apps/api/src/app.js`.
- **Dependencies:** P1-T21.
- **External packages:** None.
- **Commands:** None beyond manual dev-server verification.
- **Verification:** An authenticated request returns the correct current-user data matching T05's schema; an anonymous request returns 401 (reusing T20's identical-response guarantee).
- **Definition of Done:** Both cases confirmed; response shape matches the schema exactly (spec acceptance criterion #8).
- **Common mistakes:** Accidentally including sensitive fields in the response (nothing sensitive exists on `User` at this stage, but this is the kind of endpoint where it's worth a deliberate check rather than just serializing the entire database row by default — establish the habit of an explicit response shape now, since it matters much more once more fields exist in later phases).
- **Estimated time:** 30 min.
- **Git commit:** `feat(auth): add current-user identity endpoint`

---

### P1-T23 — Rate Limiting on OAuth Endpoints

- **Goal:** Add Redis-backed sliding-window rate limiting (per spec §11.7) to the OAuth initiation, callback, and linking-confirmation endpoints specifically — not application-wide (that remains Phase 20's job).
- **Why this task exists:** these endpoints are explicitly called out in the frozen spec as sensitive enough to deserve a baseline protection now, ahead of the general Phase 20 rollout, given the account-enumeration and abuse risks they carry.
- **Scope:** Included — rate limiting on exactly the three endpoint groups named above. Excluded — no rate limiting anywhere else in the application.
- **Files expected:** Create `apps/api/src/auth/middleware/rate-limit.js`; modify route mounting to apply it to the relevant routes.
- **Dependencies:** P1-T21.
- **External packages:** `rate-limiter-flexible` — chosen for its native Redis-backed sliding-window support, fitting directly into the existing Redis infrastructure without introducing a second rate-limiting mechanism/store.
- **Commands:** `pnpm --filter api add rate-limiter-flexible`
- **Verification:** A simulated burst of requests against the callback endpoint exceeding the configured threshold is confirmed to receive a 429 response, using the status code documented in spec §8.3; requests below the threshold are unaffected.
- **Definition of Done:** All three endpoint groups confirmed rate-limited independently; a request to an unrelated (non-OAuth) route is confirmed unaffected by this limiter, since it's scoped narrowly per spec §11.7.
- **Common mistakes:** Applying the limiter globally by mistake (e.g., mounting it before the router splits routes apart), which would be a scope violation of spec §2.2's explicit "OAuth endpoints only, not application-wide" boundary.
- **Estimated time:** 60 min.
- **Git commit:** `feat(auth): add rate limiting to OAuth-facing endpoints`

---

## Milestone 6 — Testing & Validation

_Ends with: every test category from spec §14 exists, passes, and runs in CI alongside Phase 0's existing pipeline. This milestone does not add new application behavior — it proves the behavior already built is correct._

### P1-T24 — Unit Tests: Session & Identity-Decision Logic

- **Goal:** Write the unit tests described in spec §14.1 — session TTL/rotation logic, the identity-resolution decision function (T16) exhaustively across all four cases, and cookie-flag configuration.
- **Why this task exists:** spec §14.1 calls these out as deserving dedicated, isolated coverage independent of any HTTP context — this task delivers exactly that, building on the pure-function design decisions made when T13/T15/T16 were originally implemented specifically to make this kind of testing straightforward.
- **Scope:** Included — the three unit-test areas named above. Excluded — anything requiring a running HTTP server or a real OAuth provider (that's T25).
- **Files expected:** Create `apps/api/src/auth/sessions/validate-session.test.js`, `apps/api/src/auth/sessions/rotate-session.test.js`, `apps/api/src/auth/identity/resolve-identity.test.js`, `apps/api/src/auth/sessions/cookie.test.js`.
- **Dependencies:** P1-T13, P1-T15, P1-T16, P1-T12.
- **External packages:** None (Vitest already installed per Phase 0).
- **Commands:** `pnpm --filter api test`
- **Verification:** All new tests pass; deliberately breaking one implementation (e.g., temporarily removing the absolute-cap check in T13) confirms the corresponding test actually fails — a quick sanity check that the tests are exercising real behavior, not vacuously passing.
- **Definition of Done:** All four identity-resolution cases, the sliding/absolute session-expiration cases, and both cookie-flag environments are covered and passing.
- **Common mistakes:** Testing only the happy path of the identity-resolution function and treating the exhaustive four-case coverage spec §14.1 calls for as optional — it is not optional, given this function's centrality to the phase's safety.
- **Estimated time:** 90 min.
- **Git commit:** `test(auth): add unit tests for session and identity resolution logic`

---

### P1-T25 — Integration Tests: Full OAuth Flow (Mocked Providers)

- **Goal:** Write the integration tests described in spec §14.2 — the full OAuth flow for both providers, both new-user and returning-user paths, the linking confirm/decline paths, and the "who am I" endpoint — against mocked provider HTTP endpoints and a real test Postgres/Redis.
- **Why this task exists:** proves the end-to-end composition (already manually verified in T19) is correct in an automated, repeatable way that will catch regressions in later phases.
- **Scope:** Included — the flows named above, run against mocks, never against real Google/GitHub. Excluded — security-specific tests (T26), edge cases (T27).
- **Files expected:** Create `apps/api/src/auth/oauth/callback.integration.test.js`; create test fixtures/mocks for provider token and userinfo responses.
- **Dependencies:** P1-T19, P1-T22.
- **External packages:** `nock` — for intercepting and mocking outbound HTTP calls to the provider token/userinfo endpoints, so tests never depend on real provider availability or real credentials; `supertest` — for exercising the Express app's HTTP routes directly in tests without a real running server process.
- **Commands:** `pnpm --filter api add -D nock supertest`, then `pnpm --filter api test`
- **Verification:** All flows pass against mocked providers in CI-like conditions (no network dependency on real Google/GitHub); confirm test isolation — each test resets its database/Redis state and does not depend on execution order.
- **Definition of Done:** Every flow in spec §14.2's list is covered and passing, fully offline-runnable (no real provider network calls).
- **Common mistakes:** Accidentally leaving a test dependent on real provider credentials/network access, which would make CI flaky or dependent on secrets that shouldn't be in the test environment at all.
- **Estimated time:** 90 min.
- **Git commit:** `test(auth): add integration tests for OAuth flow with mocked providers`

---

### P1-T26 — Security Tests

- **Goal:** Write the security-specific tests from spec §14.3/§14.5 — state mismatch/replay rejection, PKCE mismatch rejection, tampered/invalid-cookie rejection (identical-response confirmation), open-redirect rejection, session-fixation non-effect, and rate-limit triggering.
- **Why this task exists:** these are the tests that directly verify the security properties spec §11 spends an entire section justifying — without them, those properties are only asserted in prose, not proven.
- **Scope:** Included — exactly the security properties named above. Excluded — general functional correctness (already covered in T24/T25).
- **Files expected:** Create `apps/api/src/auth/security.test.js` (or split across relevant existing test files if more natural given the codebase structure by this point).
- **Dependencies:** P1-T19, P1-T23.
- **External packages:** None beyond what's already installed.
- **Commands:** `pnpm --filter api test`
- **Verification:** Each named property has a passing test that would fail if the corresponding protection were removed (confirm this by temporarily disabling one protection at a time and observing the expected test failure, then re-enabling it) — this "red-green" confirmation is worth doing explicitly for security tests specifically, more so than for ordinary functional tests, since a vacuously-passing security test is a false sense of safety.
- **Definition of Done:** All named properties covered, and the red-green confirmation performed (not necessarily left in the codebase, but performed and noted in the PR description) for at least the state-replay and identical-401 properties, the two most important.
- **Common mistakes:** Writing a security test that only checks "the request was rejected" without checking that the rejection response is _identical_ across the different invalid-session cases (spec §11.6) — the identical-response property is the actual security property, not just "rejected vs. not rejected."
- **Estimated time:** 75 min.
- **Git commit:** `test(auth): add security tests for OAuth and session handling`

---

### P1-T27 — Edge Case Tests

- **Goal:** Write the edge-case tests from spec §14.6 — consent denial, missing (not just unverified) email, network timeout mid-callback, double-submission race on a reused authorization code, and provider-outage-while-existing-session-is-valid.
- **Why this task exists:** these are the specific scenarios spec §16's risk table and §17's common-mistakes list flag as realistic and easy to get wrong — each deserves an explicit test rather than being left to chance.
- **Scope:** Included — exactly the five scenarios named above. Excluded — anything not explicitly listed in spec §14.6.
- **Files expected:** Create `apps/api/src/auth/edge-cases.test.js`.
- **Dependencies:** P1-T25.
- **External packages:** None beyond what's already installed.
- **Commands:** `pnpm --filter api test`
- **Verification:** All five scenarios produce the documented, correct behavior; the double-submission race test specifically confirms exactly one of the two concurrent attempts succeeds and no duplicate `User`/`Identity` is created — this is the trickiest test to get right in this task and deserves extra attention.
- **Definition of Done:** All five scenarios covered and passing; the provider-outage test specifically confirms an existing session is genuinely unaffected (spec §13.5's explicit guarantee), not just that the test happens to pass for an unrelated reason.
- **Common mistakes:** Simulating the double-submission race in a way that's actually sequential (e.g., awaiting the first request fully before starting the second), which doesn't actually test the race condition at all — the two requests need genuine concurrency in the test to be meaningful.
- **Estimated time:** 75 min.
- **Git commit:** `test(auth): add edge case tests for OAuth and session flows`

---

## Milestone 7 — Documentation & Cleanup

_Ends with: Phase 1 is fully documented, every acceptance criterion is explicitly re-verified, and the codebase is left exactly as clean as the roadmap's working agreement requires before Phase 3 planning begins._

### P1-T28 — Structured Logging for Auth Events

- **Goal:** Wire the specific logging events from spec §12.1 (successful/failed login, linking prompt/confirm/decline, session creation, logout, provider failure, rate-limit triggered) into the relevant points across the codebase built in Milestones 2–5, using Phase 0's Pino logger and correlation-ID infrastructure.
- **Why this task exists:** deferred deliberately to this point (rather than built inline during Milestones 2–5) so that real, working events exist to attach logging to, and so this task can verify the full, correct set of events against spec §12's table in one focused pass rather than piecemeal.
- **Scope:** Included — exactly the events in spec §12.1's table. Excluded — nothing outside that table; no new behavior, purely observability.
- **Files expected:** Modify the relevant files across `apps/api/src/auth/**` to add logging calls at the identified points.
- **Dependencies:** P1-T19, P1-T21, P1-T23 (all the behavior being logged must already exist).
- **External packages:** None (Pino already installed per Phase 0).
- **Commands:** None beyond manual/test verification.
- **Verification:** Triggering each event in spec §12.1's table (via manual testing or by re-running Milestone 6's test suite while inspecting log output) produces a correctly-shaped structured log line; a deliberate check confirms none of spec §12.2's forbidden content (raw tokens, full session IDs, `state` values, full profile payloads) appears anywhere in the captured output — this check should be performed by actually inspecting real emitted log lines, not by code review alone, since Phase 0's redaction is a backstop, not a substitute for verifying the specific new fields this phase introduces.
- **Definition of Done:** Every event in spec §12.1 is confirmed emitted with the correct shape; every prohibition in spec §12.2 is confirmed not violated, verified against real captured output.
- **Common mistakes:** Logging the entire request or profile object for convenience "since it's easier than picking specific fields" — this is exactly the mistake spec §12.2 warns against and must be avoided even under time pressure.
- **Estimated time:** 75 min.
- **Git commit:** `feat(auth): add structured logging for authentication events`

---

### P1-T29 — Environment & Config Finalization

- **Goal:** Do a final pass confirming every environment variable introduced across this phase (OAuth client IDs/secrets/redirect URIs from T06, any rate-limiting configuration from T23) is correctly present in both `packages/config`'s schema and the root `.env.example`, and that Phase 0's CI env-contract check (that spec's §17, step 4) passes cleanly against this phase's additions.
- **Why this task exists:** individual tasks (T06 especially) added variables incrementally; this is the dedicated closing check that nothing drifted, rather than assuming each task's own verification was sufficient in aggregate.
- **Scope:** Included — cross-checking, not adding new variables (any gap found here should be a small fix, not new design work).
- **Files expected:** Modify `packages/config/src/api-config.js` and root `.env.example` only if a discrepancy is found.
- **Dependencies:** P1-T06, P1-T23.
- **External packages:** None.
- **Commands:** CI's existing env-contract check, run locally if possible, or via a throwaway PR.
- **Verification:** Phase 0's CI env-contract check step passes with zero discrepancies.
- **Definition of Done:** Clean CI run on the env-contract check specifically.
- **Common mistakes:** Treating this as unnecessary "since T06 already added the variables" — incremental additions across multiple tasks are exactly where small drifts accumulate unnoticed.
- **Estimated time:** 30 min.
- **Git commit:** `chore(auth): finalize environment variable contract for Phase 1`

---

### P1-T30 — ADR and Documentation Update

- **Goal:** Write the ADR for the OAuth client library selection (Arctic, per this document's opening decision), update `apps/api`'s `README.md` with auth-flow-specific setup notes (how to register dev OAuth apps for local development, per Phase 1 spec §16's redirect-URI-per-environment risk), and update the root `README.md` if the local setup steps from Phase 0 need any auth-specific addition (e.g., "you'll also need to register a dev OAuth app and add its credentials to `.env`").
- **Why this task exists:** per Phase 0's documentation standard (that spec §23), every significant decision gets an ADR and every setup-affecting change gets reflected in the relevant README — this phase introduced both.
- **Scope:** Included — exactly the documents named above. Excluded — no changes to the frozen architecture/roadmap/spec documents themselves.
- **Files expected:** Create `docs/adr/0006-oauth-client-library-selection.md`; modify `apps/api/README.md`, root `README.md`.
- **Dependencies:** All of Milestones 1–6.
- **External packages:** None.
- **Commands:** None.
- **Verification:** A teammate unfamiliar with this phase's implementation can follow the updated README to register their own dev OAuth apps and get local sign-in working, with no undocumented steps — the same bar Phase 0's T30 established, now extended to cover this phase's addition to the setup process.
- **Definition of Done:** ADR exists and correctly reflects the reasoning from this document's opening section; READMEs updated and verified by a teammate performing the setup from scratch.
- **Common mistakes:** Writing the ADR as a restatement of what was built rather than _why_ the library was chosen over alternatives — per Phase 0 spec §23, ADRs exist specifically to answer "why," which code comments and this task's own file list don't capture on their own.
- **Estimated time:** 45 min.
- **Git commit:** `docs(auth): add OAuth library ADR and update setup documentation`

---

### P1-T31 — Full Acceptance Criteria Verification Pass

- **Goal:** Systematically re-verify every item in Phase 1 spec §15's acceptance criteria list against the actual, final state of the implementation — not against memory of what individual tasks confirmed in isolation.
- **Why this task exists:** this is the closing gate for the entire phase, mirroring Phase 0's T30 — individual tasks verified their own narrow scope, but no single prior task was responsible for confirming the _phase_ as a whole meets its own written definition of done.
- **Scope:** Included — the 13 acceptance criteria in spec §15, checked one by one. Excluded — no new implementation work; any gap found here should be filed as a small follow-up task, not silently patched in this task.
- **Files expected:** None (a verification pass, not a code change) — optionally, a checklist document recording the verification results for the team's record, e.g., `docs/phase-specs/phase-1-acceptance-verification.md`.
- **Dependencies:** All prior Phase 1 tasks (P1-T01 through P1-T30).
- **External packages:** None.
- **Commands:** `pnpm --filter api test` (full suite), `docker-compose up` (full local stack), plus manual browser-based sign-in verification against both real providers.
- **Verification:** Each of spec §15's 13 criteria is checked off individually against real, observed behavior — not assumed from earlier tasks' verification steps, since integration issues can surface even when every individual piece was independently correct.
- **Definition of Done:** All 13 acceptance criteria confirmed met; any criterion that fails this final pass blocks Phase 1 from being considered complete and generates a follow-up task before Phase 3 planning begins.
- **Common mistakes:** Treating this task as a formality since "every earlier task already verified its own piece" — the entire point of a closing acceptance pass is that composition failures and drift are exactly the class of bug individual task verification doesn't catch.
- **Estimated time:** 60 min.
- **Git commit:** `chore(auth): complete Phase 1 acceptance criteria verification`

---

## Milestone Summary

| Milestone                     | Tasks   | Ends With                                                                                                |
| ----------------------------- | ------- | -------------------------------------------------------------------------------------------------------- |
| 1 — Authentication Foundation | T01–T05 | Database, Redis, and schema groundwork in place; no OAuth logic yet                                      |
| 2 — OAuth Providers           | T06–T10 | A verified provider profile can be fetched via a real, working callback — no database/session writes yet |
| 3 — Session Management        | T11–T15 | Full session lifecycle (create/validate/revoke/rotate) proven correct in isolation against real Redis    |
| 4 — Account Linking           | T16–T19 | Complete, real, end-to-end sign-in works for all four identity-resolution cases                          |
| 5 — Authorization Middleware  | T20–T23 | Protected routes genuinely require auth; logout, "who am I," and OAuth-endpoint rate limiting all work   |
| 6 — Testing & Validation      | T24–T27 | Every test category from the spec exists, passes, and runs in CI                                         |
| 7 — Documentation & Cleanup   | T28–T31 | Logging, docs, and a final acceptance-criteria pass close out the phase                                  |

**Working agreement reminder:** no task in this breakdown begins before its listed dependencies are merged; no task reaches into a later milestone's concerns; Phase 3 planning does not begin until P1-T31 confirms every acceptance criterion is met.
