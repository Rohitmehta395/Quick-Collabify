# Implementation Roadmap — Master Engineering Plan

**Status:** Approved sequencing pending final sign-off. Supersedes the high-level phase sketch in the architecture blueprint's §25.
**Source of truth this roadmap implements:** `collaborative-workspace-architecture-blueprint.md` (frozen).
**Working rule:** phases are executed strictly in order. A phase is not "mostly done" — it is done per its Definition of Done, or it is not done. No phase begins before the prior phase's DoD is met.

---

## How to Read This Roadmap

Each phase is a **vertical slice**: by the end of it, the application is deployable, and a real (not simulated) capability works end-to-end — database to UI. Phases do not mix unrelated systems. Real-time collaboration is deliberately pushed to Phase 12/13, after every system it depends on (auth, workspaces, permissions, documents, the editor's data model, background jobs) already exists and is tested — this is a hard sequencing rule, not a suggestion.

**Relative sizing** (S/M/L) is a rough gut-check for planning, not a time commitment — it reflects the number of moving parts in a phase, not calendar time, since team velocity varies.

| #   | Phase                                            | Size | One-line summary                                                         |
| --- | ------------------------------------------------ | ---- | ------------------------------------------------------------------------ |
| 0   | Development Foundation                           | M    | Repo, Docker, CI, config, logging — no features                          |
| 1   | Authentication Core                              | M    | OAuth login/logout, Redis sessions, protected routes                     |
| 2   | Background Jobs & Email Infrastructure           | S    | BullMQ + email provider, first real job (welcome email)                  |
| 3   | User Profile & Account Management                | S    | Profile, connected providers, active sessions UI                         |
| 4   | Workspace Core                                   | M    | Create/switch/settings workspaces, single-owner                          |
| 5   | Workspace Membership, Roles & Invitations        | M    | Multi-user workspaces, invite flow, ownership transfer                   |
| 6   | Document Metadata & Tree                         | M    | Document CRUD, nested pages, folders-as-documents, no content editor yet |
| 7   | Permissions & Sharing                            | M    | Per-document overrides, inheritance resolution, Redis permission cache   |
| 8   | Tags & Full-Text Search                          | S    | Postgres FTS, tags, filters                                              |
| 9   | File Storage & Uploads                           | S    | S3 integration, attachments, thumbnailing                                |
| 10  | Rich Text Editor Foundation (Yjs, Single-Client) | L    | Editor UI, real Yjs persistence model, REST load/save, no live sync      |
| 11  | Snapshot Compaction & Version History            | M    | Debounced compaction job, restore, compare, timeline                     |
| 12  | WebSocket Infrastructure & Presence              | L    | Socket.IO, Redis adapter scaling, room auth, Awareness (presence only)   |
| 13  | Real-Time Collaborative Editing                  | L    | Live Yjs sync over WebSocket, multi-cursor, offline/reconnect            |
| 14  | Comments & Mentions                              | M    | Inline threaded comments, @mentions, notification triggers               |
| 15  | Suggestion Mode                                  | M    | Track-changes-style proposed edits                                       |
| 16  | Notifications System                             | S    | Unified email + in-app notification center                               |
| 17  | Dashboard, Activity & Templates                  | M    | Recent/shared/favorites, activity feed, templates gallery                |
| 18  | Admin Panel & Audit Logging                      | M    | Workspace admin console, audit trail across all prior phases             |
| 19  | Exports & Imports                                | S    | Async PDF/Markdown export, import pipeline                               |
| 20  | Security Hardening Pass                          | M    | CSRF, rate limiting, XSS/session audit across the whole app              |
| 21  | Observability & Production Readiness             | M    | Metrics, tracing, SLO dashboards, alerting, connection draining          |
| 22  | Scale Validation & Launch Readiness              | M    | Load testing against §24.2 capacity model, go/no-go                      |

---

## Phase 0 — Development Foundation

**Goal:** A professional engineering foundation with zero application features — anyone can clone the repo, run one command, and have the full stack running locally.

**Why this phase exists:** every later phase assumes CI, linting, environment validation, and logging already exist. Building this once, correctly, prevents every future phase from re-deciding "how do we run this locally" or "where do secrets live."

**Prerequisites:** none — this is the starting point.

**Deliverables:**

- A running local environment via `docker-compose up` (Postgres, Redis, control-plane API, Next.js frontend — real-time process scaffolded but not required until Phase 12).
- CI pipeline that lints, type-checks (Zod schema validation at minimum, given no TypeScript), and runs the (currently empty) test suite on every PR.
- A documented environment-variable contract, validated at process startup.

**Features implemented:** none. This phase explicitly ships no user-facing feature.

**Database changes:** Prisma initialized against Postgres with zero application tables — only the migration tooling itself proven to work (a trivial smoke-test migration, e.g., a `_health` table, is acceptable to prove the pipeline).

**Backend work:**

- Express app skeleton with a `/health` endpoint (liveness/readiness, per architecture §22).
- Structured (JSON) logging setup with correlation-ID middleware, wired but with nothing meaningful to log yet beyond request/response lifecycle.
- Environment/config validation via Zod at startup — fail fast on missing/malformed config (architecture §19).

**Frontend work:**

- Next.js 15 App Router skeleton, Tailwind + shadcn/ui installed and themed with base design tokens (no product screens yet).
- A single placeholder page proving the frontend can call the backend `/health` endpoint successfully.

**Infrastructure work:**

- `Dockerfile`s for both the control-plane process and the real-time-plane process (even though Phase 12 is when the latter gets real logic — the process boundary from architecture §19 should exist from day one so it's never an afterthought).
- `docker-compose.yml` wiring Postgres, Redis, and both Node processes together for local dev.
- GitHub Actions workflow: lint → typecheck/schema-check → test (empty for now, but the gate exists).
- ESLint + Prettier + Husky pre-commit hooks + a commit-message convention (Conventional Commits) enforced by a commit-msg hook.
- Secrets handled via `.env` locally (git-ignored, with a committed `.env.example`) and via the deployment platform's secret manager conceptually documented for later phases.

**Testing requirements:**

- CI pipeline itself is the test: a PR with a deliberate lint violation, a deliberate type/schema violation, and a passing PR should each produce the expected CI result.
- `docker-compose up` from a clean clone must succeed with no manual steps beyond copying `.env.example`.

**Definition of Done:**

- A new engineer can clone the repo, copy `.env.example` to `.env`, run `docker-compose up`, and see the frontend successfully call the backend health endpoint — with no manual database setup, no manual secret hunting, and no undocumented steps.
- CI blocks merges on lint/format/schema failures.
- Pre-commit hooks catch the same issues locally before a PR is even opened.

**Common pitfalls:**

- Treating this phase as "quick, skip it" — foundation shortcuts here compound into every later phase's friction.
- Forgetting to validate environment variables at startup, deferring the failure to the first request that happens to touch the missing config (fails loud vs. fails deep — must fail loud).
- Under-scoping Docker Compose so "works on my machine" masks a missing dependency that breaks CI.

**Dependencies on future phases:** every phase depends on this one. This phase depends on nothing.

---

## Phase 1 — Authentication Core

**Goal:** A user can sign in with Google or GitHub, get a real session, and access a protected route. Nothing else exists yet.

**Why this phase exists:** every other feature requires "who is this user" to exist first, and getting OAuth + session security right in isolation — without workspace/document complexity layered on top — makes it far easier to test and reason about.

**Prerequisites:** Phase 0 complete (running stack, CI, logging, config).

**Deliverables:**

- Working "Sign in with Google" and "Sign in with GitHub" buttons that produce a real, revocable, Redis-backed session.
- At least one genuinely protected route (e.g., a placeholder `/dashboard` page) that redirects unauthenticated users.
- Logout (single session).

**Features implemented:** OAuth sign-in (Google, GitHub), account-linking safeguard (§6.2's explicit-confirmation rule for cross-provider linking), Redis-backed session creation/validation/revocation, protected-route middleware, logout.

**Database changes:** `User` and `Identity` tables (per architecture §7.1) — a user has many linked OAuth identities. No workspace, document, or any other table yet.

**Backend work:**

- OAuth 2.0 Authorization Code + PKCE flow against both providers.
- Session issuance: HttpOnly/Secure/SameSite=Lax cookie holding an opaque session ID, session data stored in Redis (architecture §6.3).
- Session validation middleware applied to protected Express routes.
- The explicit cross-provider linking confirmation step (§6.2) — this is a real security decision, not a nice-to-have, and must ship in this phase, not deferred.

**Frontend work:**

- Sign-in page with both provider buttons.
- Auth-aware layout: redirect logic for unauthenticated access to protected routes.
- A minimal authenticated shell (just enough to prove the session works — no dashboard content yet, that's later phases).

**Infrastructure work:**

- OAuth client credentials wired through the Phase 0 secrets mechanism, per environment (local/staging/prod each need their own OAuth app registrations, since redirect URIs differ).

**Testing requirements:**

- Integration tests against a real (test) Postgres + Redis: full OAuth callback flow (mocked provider responses), session creation, session validation, session revocation.
- Security test: a request with no session cookie is rejected by protected routes; a request with a tampered/invalid session ID is rejected.
- Explicit test for the cross-provider linking confirmation step — this is a security-sensitive path and deserves its own dedicated test, not incidental coverage.

**Definition of Done:**

- A real user can sign in with either provider, land on a protected page, refresh the page and remain signed in, sign out, and be redirected away from the protected page afterward.
- Revoking a session in Redis (simulating an admin/security action) immediately invalidates that session on the next request — no stale-session window.
- No password-based auth exists anywhere, by design.

**Common pitfalls:**

- Storing role/permission claims inside the session object — don't; permission data doesn't exist yet in this phase and must never be cached in a way that outlives a permission change (this becomes relevant starting Phase 5, but the session shape decided here should already avoid baking in stale-permission risk).
- Silently merging accounts on email match instead of requiring the explicit linking confirmation — this is the specific account-takeover vector §6.2 exists to prevent.
- Skipping the "tampered session ID" test because "it'll obviously fail" — verify it explicitly.

**Dependencies on future phases:** Phase 3 (profile) extends the `User`/`Identity` model read-only surface. Phase 5 (membership) is the first phase that actually uses "who is this user" for anything beyond "are they logged in."

---

## Phase 2 — Background Jobs & Email Infrastructure

**Goal:** A real background job runs end-to-end: a new user signing in via OAuth (Phase 1) triggers a genuine welcome email, sent asynchronously via BullMQ, not inline in the request path.

**Why this phase exists:** invitations (Phase 5), notifications (Phase 14/16), thumbnailing (Phase 9), and compaction (Phase 11) all need job infrastructure. Building it now, proven against one real (not placeholder) job, means every later phase adds a job to existing, trusted infrastructure instead of re-deciding how jobs work.

**Prerequisites:** Phase 1 complete (a real signup event to hook the first job to).

**Deliverables:**

- A running BullMQ worker process (separate from the request-handling process, per architecture §5's process-separation principle).
- A real transactional email provider integrated (not a console-log stub).
- One real job: "send welcome email on first sign-in," triggered by the Phase 1 OAuth callback, executed asynchronously.
- Job-failure visibility (BullMQ's built-in retry/backoff, plus a way to see failed jobs — even if just a basic admin queue-dashboard library at this stage, ahead of the full Phase 18 admin panel).

**Features implemented:** background job execution infrastructure; welcome email (the first genuinely user-facing behavior this infrastructure powers).

**Database changes:** none required strictly for job execution (BullMQ's state lives in Redis), but add a lightweight `EmailLog` or reuse of a general event-log pattern if you want durable proof an email was sent — recommended, since "did the user actually get this email" is a real support question from day one.

**Backend work:**

- BullMQ queue + worker setup, connected to Redis (architecture §8's job-queue Redis use case).
- Email-provider client wrapper (whatever transactional email service is chosen) with a retry-safe, idempotent send (idempotency key per notification event, per architecture §10).
- Wiring: Phase 1's OAuth callback enqueues a "welcome email" job on first sign-in (not every sign-in — first-time-only logic belongs here).

**Frontend work:** none — this phase is invisible to the UI by design.

**Infrastructure work:**

- Worker process containerized separately (Phase 0 already scaffolded this Dockerfile; now it does real work).
- Docker Compose updated to run the worker alongside the API.
- Email provider credentials added to the secrets mechanism, per environment.

**Testing requirements:**

- Integration test: triggering the first-sign-in path enqueues exactly one job; a second sign-in by the same user does not re-enqueue it.
- Failure-injection test: simulate the email provider being unreachable and verify BullMQ's retry/backoff behavior actually retries, and that the job is not silently dropped.
- Idempotency test: manually re-running the same job (simulating a retry after a crash) does not send a duplicate email.

**Definition of Done:**

- A real test/dev email inbox receives a real welcome email after OAuth sign-in, sent asynchronously, with the request itself unaffected by email-provider latency.
- Killing the worker process mid-job and restarting it does not lose or duplicate the job.

**Common pitfalls:**

- Sending the email synchronously "just for now" inside the OAuth callback — this defeats the entire purpose of the phase and creates a pattern later jobs will copy.
- Skipping the idempotency key because "it's just a welcome email" — the pattern established here is what Phase 5's invitation emails and Phase 16's notifications will copy directly; get it right once.

**Dependencies on future phases:** Phase 5 (invitations), Phase 9 (thumbnailing), Phase 11 (snapshot compaction), Phase 14/16 (mentions/notifications), and Phase 19 (exports/imports) all add jobs to this same infrastructure rather than building their own.

---

## Phase 3 — User Profile & Account Management

**Goal:** A signed-in user can view and edit their profile, see and manage linked OAuth providers, and see/revoke their own active sessions.

**Why this phase exists:** this is the natural, low-risk next slice after auth — it deepens the `User`/`Identity`/`Session` model into real UI without introducing any multi-user complexity (workspaces) yet.

**Prerequisites:** Phase 1 (auth), Phase 2 (not strictly required, but notification-preference storage introduced here is consumed by Phase 16 later).

**Deliverables:**

- Account settings page: edit display name/avatar, view linked providers, link/unlink an additional provider, view and revoke active sessions ("logout of this device" / "logout of all devices").
- Notification-preference fields stored (UI toggle, even though no notifications exist to gate yet until Phase 16 — the schema and toggle should exist now so Phase 16 doesn't need a data-model change).

**Features implemented:** profile view/edit, connected-provider management, active-session list and revocation, notification-preference storage (UI-only meaningfully until Phase 16).

**Database changes:** extend `User` with editable profile fields (display name, avatar URL); notification-preference fields/table added now, consumed later.

**Backend work:**

- REST endpoints for profile read/update, provider link/unlink (reusing Phase 1's linking-confirmation flow for adding a second provider), session listing and revocation (deletes the target session key in Redis).
- Validation via Zod on all profile-edit inputs (architecture §18/§19).

**Frontend work:**

- Account settings page with React Hook Form + Zod validation, matching the shared-schema principle from architecture §18.
- Active-sessions UI showing device/label and last-seen-at (from Phase 1's session shape), with a revoke action per session.

**Infrastructure work:** none beyond what Phase 0/1 already provide.

**Testing requirements:**

- Integration tests: profile update persists and is reflected on reload; unlinking a provider that is the user's _only_ identity is rejected (must not lock the user out of their own account — a real edge case worth an explicit test); revoking a session from the settings UI actually invalidates that session on its next request.
- Frontend form validation tests against the shared Zod schema.

**Definition of Done:**

- A user can change their display name, link a second OAuth provider (going through the Phase 1 confirmation step), see both providers listed, unlink one (but not the last one), and revoke a session from a "different device" and confirm that session is immediately dead.

**Common pitfalls:**

- Allowing unlinking of the last remaining identity, locking the user out permanently — must be explicitly blocked server-side, not just hidden in the UI.
- Building notification-preference storage as an afterthought later (in Phase 16) instead of now — deferring it creates a migration Phase 16 shouldn't need to do.

**Dependencies on future phases:** Phase 16 (notifications) reads the preference fields established here.

---

## Phase 4 — Workspace Core

**Goal:** A signed-in user can create a workspace, switch between workspaces they belong to, edit workspace settings, and delete a workspace they own. Single-owner only — no other members yet.

**Why this phase exists:** workspace is the top-level scoping unit for everything that follows (architecture §1's "workspace-first" principle). Building it before membership/roles isolates "does a workspace exist and behave correctly" from "do multiple people share access to it correctly" (that's Phase 5).

**Prerequisites:** Phase 1 (auth) — a workspace needs an owner.

**Deliverables:**

- Create workspace, list "my workspaces," switch active workspace, edit workspace name/settings, soft-delete a workspace with a grace period (architecture §7's soft-delete pattern for documents applies here too).
- A workspace switcher UI component (the persistent, always-visible element from architecture §17.2) — even though there's only ever one member in it at this stage, the UI pattern is established here.

**Features implemented:** workspace creation, switching, settings, ownership (implicit single-owner), soft-delete with grace period.

**Database changes:** `Workspace` table; `WorkspaceMember` join table introduced now (even though only ever populated with a single Owner row until Phase 5) so the schema doesn't need a shape change when membership becomes real in the next phase.

**Backend work:**

- Workspace CRUD endpoints, all requiring an authenticated session (Phase 1).
- Every workspace-scoped endpoint from this phase forward validates the requesting user is a member (already just "the owner," but the check is written generically now, since Phase 5 makes it meaningfully multi-user without a code change here).
- Soft-delete: mark-deleted with a grace-period timestamp; a background job (Phase 2 infra) for permanent cleanup after the grace period is scheduled now but can be a simple scan-and-delete — this is the "document cleanup" job category from architecture §10, applied to workspaces first.

**Frontend work:**

- Workspace creation flow, workspace switcher, workspace settings page (rename, delete with a confirmation step given the grace-period soft-delete).

**Infrastructure work:** none beyond existing.

**Testing requirements:**

- Integration tests: create workspace, verify creator is the sole `WorkspaceMember` with Owner role; switching active workspace updates the session's active-workspace pointer; soft-deleting a workspace hides it from the "my workspaces" list but doesn't immediately purge data; the grace-period cleanup job actually removes it after expiry (test with a shortened TTL, not the real production grace period).
- Authorization test: a user cannot read/edit/delete a workspace they don't belong to, even by guessing its ID.

**Definition of Done:**

- A user can create multiple workspaces, switch between them, rename one, delete one (soft), and confirm it disappears from their list but is recoverable within the grace period, then confirm it's actually gone after the grace period via the cleanup job.

**Common pitfalls:**

- Building workspace CRUD as if it will only ever have one member — this phase's job is specifically to get the _shape_ right (WorkspaceMember table existing now) so Phase 5 is additive, not a schema migration.
- Forgetting the authorization test (users guessing another workspace's ID) — this is the single most common real-world bug class in multi-tenant systems and deserves explicit coverage this early.

**Dependencies on future phases:** Phase 5 makes `WorkspaceMember` genuinely multi-row. Phase 6 (documents) scopes everything to `workspaceId` established here.

---

## Phase 5 — Workspace Membership, Roles & Invitations

**Goal:** A workspace owner can invite others (by email or link), assign roles, and transfer ownership. Multiple real users can now share a workspace.

**Why this phase exists:** this is where the product becomes genuinely collaborative at the organizational level — and it's deliberately built _before_ documents exist, so the permission/role model can be tested in isolation from document-level complexity.

**Prerequisites:** Phase 4 (workspace core), Phase 2 (real email infrastructure for invitations — no placeholder invite emails).

**Deliverables:**

- Invite-by-email flow (sends a real invitation email via Phase 2's job infra) and invite-by-link flow, both with expiry.
- Member list UI with role assignment (the role enum from architecture §4.3/§6.4: Owner/Editor/Commenter/Viewer/Guest — at the workspace-default level; per-document overrides are Phase 7).
- Ownership transfer flow (with an explicit confirmation step, since it's irreversible without another transfer).
- Member removal.

**Features implemented:** invitations (email + link-based), role assignment, ownership transfer, member removal, workspace-level permission defaults.

**Database changes:** `Invitation` table (email or link token, expiry, target role, workspace reference); `WorkspaceMember.role` populated meaningfully now for the first time (architecture §7.5's denormalization decision — role lives directly on the join row).

**Backend work:**

- Invitation creation (enqueues a real email job via Phase 2), invitation acceptance (creates the `WorkspaceMember` row, invalidates the invitation token), invitation expiry enforcement.
- Role-assignment endpoint, restricted to users whose own role permits it (an Owner can assign any role; whether other roles can manage membership is a policy decision to make explicit here, not leave implicit).
- Ownership transfer: a two-step confirmation (current owner initiates, either immediate transfer with confirmation or a target-side acceptance step — pick one explicitly and document it) to avoid an accidental, irreversible mistake.
- Member removal, including the edge case of removing the sole remaining Owner (must be blocked — a workspace cannot end up ownerless).

**Frontend work:**

- Invitation UI (send by email, generate a shareable link, see pending invitations, revoke a pending invitation).
- Member list with role dropdowns (permission-gated: only shown/editable to users whose role allows it).
- Ownership transfer flow with a clear, hard-to-misclick confirmation step.

**Infrastructure work:** none beyond existing (reuses Phase 2's job infra and Phase 0's secrets for the email provider, already configured).

**Testing requirements:**

- Integration tests: full invite-accept flow via both email and link; expired invitations are rejected; role assignment respects the "who can assign roles" policy; ownership transfer correctly moves the Owner role and demotes the previous owner (to whatever role is specified, e.g., Editor) rather than leaving two Owners or zero; removing the last Owner is blocked.
- Security test: an invitation token cannot be reused after acceptance or after expiry; a non-Owner cannot transfer ownership or remove the Owner.

**Definition of Done:**

- Two real test accounts can end up as members of the same workspace via a real invitation email, with distinct roles, and ownership can be transferred between them without ever leaving the workspace ownerless.

**Common pitfalls:**

- Leaving "who can invite / who can assign roles" as an implicit assumption instead of an explicit, tested policy — this is exactly the kind of ambiguity that turns into a real permission bug later.
- Allowing an invitation link to be reused indefinitely instead of single-use-or-expiring.
- Forgetting the "cannot remove/demote the last Owner" invariant — this is a real production incident class ("workspace has no owner and no one can fix it").

**Dependencies on future phases:** Phase 7 (document-level permission overrides) builds on top of this workspace-level default-role system, inheriting from it rather than replacing it.

---

## Phase 6 — Document Metadata & Tree

**Goal:** Within a workspace, users can create, organize, and manage documents as a nested tree — titles, icons, folders-as-documents, move/pin/favorite/archive/restore — with **no content editor yet.** A document at this stage is metadata only.

**Why this phase exists:** organizing a document tree correctly (nesting, permission inheritance groundwork, soft-delete, search-ability) is a substantial problem on its own, and testing it without a live editor or collaboration layer on top keeps this phase's scope honest and independently verifiable.

**Prerequisites:** Phase 4/5 (workspace + membership, since documents are workspace-scoped and permission-aware from day one).

**Deliverables:**

- Document tree UI (sidebar) within a workspace: create, rename, move (drag or explicit action), duplicate, pin, favorite, archive/restore, soft-delete.
- Nested pages via the self-referential `parentId` model (architecture §7.3) — folders are just documents with children.
- Dashboard sections that are meaningful now: recent documents, favorites (shared-with-me and activity feed remain stubbed until Phase 17, since they need more than metadata to be interesting).

**Features implemented:** document CRUD (metadata only), nested tree, folders-as-documents, move/organize, pin/favorite, archive/restore, soft-delete with grace period, duplicate.

**Database changes:** `Document` table per architecture §7.1 — title, icon, `parentId` (self-referential), `workspaceId`, owner, timestamps, archived/deleted flags, denormalized `lastEditedByUserId`/`lastEditedAt` (§7.5) populated with placeholder values now (creation event) until Phase 10 gives it real meaning. Composite index on `(workspaceId, parentId)` and `(workspaceId, updatedAt DESC)` per architecture §7.4.

**Backend work:**

- Document CRUD endpoints, all workspace-membership-checked (reusing Phase 5's role system as the _default_ permission source — explicit per-document overrides are Phase 7, not this phase).
- Move/duplicate logic must correctly handle the nested-tree structure (moving a node with children moves the whole subtree; duplicate deep-copies the subtree or documents a shallow-copy decision explicitly).
- Soft-delete + grace-period cleanup job (same pattern as Phase 4's workspace soft-delete, now applied to documents, reusing the Phase 2 job infra).

**Frontend work:**

- Tree-based sidebar component with expand/collapse, drag-to-move (or an equivalent explicit move action), context menu for pin/favorite/archive/duplicate/delete.
- Dashboard "recent" and "favorites" sections, now backed by real data.

**Infrastructure work:** none beyond existing.

**Testing requirements:**

- Integration tests: creating nested documents produces the correct tree shape; moving a node moves its entire subtree; deleting a parent soft-deletes its children (or explicitly documents and tests the chosen alternative — e.g., orphaning children to the workspace root — pick one and test it, don't leave it undefined); duplicate produces a correct, independent copy.
- Authorization test: a user without workspace membership cannot see or act on any document in that workspace, even by ID.

**Definition of Done:**

- A user can build a multi-level nested document tree, move nodes between levels, pin/favorite/archive/restore, and see it reflected correctly and immediately in the dashboard's recent/favorites views — with zero document _content_ editing existing yet.

**Common pitfalls:**

- Leaving "what happens to children when a parent is deleted" undefined — this must be a deliberate, tested decision, not an accident of whatever the delete query happens to cascade.
- Building move/duplicate without considering the subtree case, then discovering it in Phase 7 when permission inheritance depends on the tree being correct.

**Dependencies on future phases:** Phase 7's permission inheritance depends on this tree structure being correct. Phase 8 (search/tags) and Phase 10 (editor) both extend this `Document` entity rather than replacing it.

---

## Phase 7 — Permissions & Sharing

**Goal:** Individual documents can have sharing overrides beyond the workspace default (Owner/Editor/Commenter/Viewer/Guest per document), with correct inheritance down the nested tree, and a fast, cached permission-resolution path.

**Why this phase exists:** this is one of the highest-risk correctness areas in the whole product (per architecture §7.7, §8) and deserves to be built and tested in isolation, against a tree that already exists (Phase 6) and a role system that already exists (Phase 5) — rather than being bolted on later under the pressure of also getting the editor working.

**Prerequisites:** Phase 5 (workspace roles), Phase 6 (document tree).

**Deliverables:**

- Per-document sharing UI: share with a specific user or make link-shareable, with a role, independent of workspace-wide defaults.
- Correct permission inheritance: a document with no explicit override inherits from its parent, ultimately from the workspace default (architecture §7.2).
- Redis-backed permission-resolution cache with short TTL and explicit invalidation on any permission-changing mutation (architecture §6.3, §8).

**Features implemented:** document sharing with roles, permission inheritance, resolved-permission caching.

**Database changes:** `DocumentPermission` table (explicit overrides, per architecture §7.1/§7.2) — a nullable, sparse table; absence of a row means "inherit."

**Backend work:**

- Permission-resolution function: given (user, document), walk up the parent chain applying the nearest explicit override, falling back to the workspace default role — this is the function referenced throughout the architecture doc (§6.4, §7.7) and deserves dedicated unit tests independent of any HTTP/socket context.
- Redis caching of resolved permissions, keyed by (userId, documentId), short TTL, with **explicit invalidation** on: role change, override change, membership change, ownership transfer — every mutation that could change the answer must invalidate the cache, not rely on TTL expiry alone for correctness-sensitive changes.
- This resolution function is written now to be reusable verbatim by the WebSocket room-join check in Phase 12 — one source of truth, per architecture §11.2.

**Frontend work:**

- Share dialog per document: search/invite a specific user with a role, or generate a shareable link with a role, see and revoke existing overrides.
- Visual indication in the tree of documents with sharing overrides (vs. inheriting default).

**Infrastructure work:** none beyond existing Redis.

**Testing requirements:**

- Unit tests for the permission-resolution function in isolation: multiple levels of nesting, explicit override at various levels, no override anywhere (falls through to workspace default), conflicting scenarios (override grants more access than the parent — verify the override wins, since it's more specific).
- Cache-invalidation tests: change a role, verify the _next_ request reflects it immediately (not after TTL expiry) — this is a correctness requirement, not a performance nice-to-have, since a user removed from a document must lose access immediately, not after a cache window.
- Authorization tests across the full CRUD surface from Phase 6, now re-run against documents with explicit overrides that grant _less_ access than the workspace default (e.g., a Guest-level share on a document inside a workspace where the user is otherwise an Editor) to confirm the more specific rule wins correctly in both directions.

**Definition of Done:**

- A document shared with Viewer-only access to a specific user is genuinely read-only for them, even though they're an Editor workspace-wide; revoking that share immediately (not eventually) removes their access; the permission-resolution function has full unit-test coverage independent of any transport layer, ready for Phase 12 to reuse directly.

**Common pitfalls:**

- Relying on TTL-only cache expiry for a permission _downgrade_ — an attacker or an accidentally-retained collaborator could retain access for the TTL window; invalidation on write is mandatory, not optional.
- Writing the permission-resolution logic inline in the REST handler instead of as an independently callable/testable function — this directly creates rework risk when Phase 12 needs the identical logic for socket authorization.

**Dependencies on future phases:** Phase 12's WebSocket room-join authorization calls this exact function. Phase 18's audit log records permission-changing events from this phase.

---

## Phase 8 — Tags & Full-Text Search

**Goal:** Users can tag documents and search within a workspace, with results correctly scoped by the permissions established in Phase 7.

**Why this phase exists:** search is a well-isolated, additive feature once the document tree (Phase 6) and permissions (Phase 7) exist — building it now, rather than earlier, avoids ever having to retrofit permission-filtering into search results.

**Prerequisites:** Phase 6 (documents), Phase 7 (permissions — search results must never leak documents the user can't access).

**Deliverables:**

- Tag creation/assignment/removal on documents.
- Full-text search within a workspace (Postgres `tsvector`/`tsquery` + GIN index, per architecture §7.6), filterable by tag, author, date, folder.

**Features implemented:** tags, full-text search, filters, recent/favorites refinement (now filterable/searchable, not just listed).

**Database changes:** `Tag` and `DocumentTag` join table; `tsvector` column + GIN index on `Document` (title + content-summary — note actual document _content_ doesn't exist as searchable text until Phase 10's editor ships; this phase's search covers titles/metadata/tags meaningfully, and is extended to cover body content once Phase 10 lands).

**Backend work:**

- Search endpoint: Postgres FTS query, **permission-filtered** — the query must intersect with the set of documents the requesting user can actually access (reusing Phase 7's resolution, not a separate ad hoc check).
- Tag CRUD, scoped to workspace.

**Frontend work:**

- Search bar/page with results list, filter controls (tag/author/date/folder).
- Tag assignment UI on documents (from Phase 6's tree/document view).

**Infrastructure work:** none — explicitly deferred: no dedicated search engine yet, per architecture §7.6's stated migration trigger (only revisit this if/when search latency degrades at the scale identified in §24.2).

**Testing requirements:**

- Integration test: search results never include a document the requesting user lacks permission to see, even if it matches the query text — test this explicitly with a document the user is deliberately excluded from.
- Filter combination tests (tag + date range, etc.).

**Definition of Done:**

- Search across a workspace with multiple documents, some shared with restricted permissions, returns only permission-visible results, filterable by tag/author/date/folder, with acceptable latency at the document counts realistic for this stage (low hundreds to low thousands per workspace).

**Common pitfalls:**

- Building search as a separate, unfiltered query and bolting permission-filtering on afterward as a post-query filter in application code — at scale this either leaks data (filter forgotten on one code path) or destroys pagination correctness (filtering after limiting the query). Permission-filtering belongs in the query itself.

**Dependencies on future phases:** Phase 10's editor content will extend what's indexed for full-text search (a follow-up addition to this phase's index, not a new phase).

---

## Phase 9 — File Storage & Uploads

**Goal:** Users can upload attachments and images to documents, stored in S3, with validation and thumbnailing — independent of the editor, which doesn't exist yet.

**Why this phase exists:** upload/storage/validation/thumbnailing is a self-contained problem that the editor (Phase 10) will consume as a capability, not build itself — isolating it here means Phase 10 can focus purely on editing UX.

**Prerequisites:** Phase 6 (documents, since uploads attach to a document), Phase 2 (job infra, for thumbnailing), Phase 7 (permissions — an attachment inherits its parent document's access rules).

**Deliverables:**

- Upload endpoint (direct-to-S3 or proxied, architecturally either is acceptable — pick one and document why; direct-to-S3 via presigned URLs is generally preferable for large files, avoiding proxying big payloads through the API process).
- Server-side validation: real MIME-type sniffing (not just trusting the file extension or client-supplied `Content-Type`), size limits enforced server-side.
- Thumbnail generation as a background job (Phase 2 infra) for image uploads.

**Features implemented:** image uploads, generic file attachments, storage limits, validation, thumbnailing.

**Database changes:** `Attachment` table (metadata: document reference, S3 key, MIME type, size, uploader, timestamps).

**Backend work:**

- Presigned-upload-URL generation, with server-side size/type constraints enforced before the URL is issued (don't rely solely on client-side checks).
- Post-upload confirmation endpoint that verifies the object actually landed in S3 and matches expected constraints (defense against a client lying about what it uploaded).
- Thumbnailing job wired to Phase 2's BullMQ infra, triggered on confirmed image upload.

**Frontend work:**

- Upload UI (drag-and-drop or file picker) usable in isolation (a simple "attachments" panel on a document, ahead of full in-editor embedding, which is Phase 10's job).
- Upload progress and error states (file too large, invalid type).

**Infrastructure work:**

- S3 bucket provisioning, CORS configuration for direct browser uploads if using presigned URLs, lifecycle policy consideration for orphaned uploads (an upload confirmed in S3 but never actually attached to a saved document — a cleanup job candidate, reusing Phase 2 infra, and the same "orphaned attachment cleanup" job named in architecture §10).

**Testing requirements:**

- Validation tests: oversized files rejected server-side; a file with a spoofed extension (e.g., an executable renamed to `.jpg`) is caught by real MIME sniffing, not extension trust.
- Integration test: full upload → confirm → thumbnail-job → thumbnail-available flow.
- Authorization test: an attachment inherits its document's permission resolution (Phase 7) — a user without document access cannot fetch the attachment by guessing its S3 key/URL.

**Definition of Done:**

- A user can upload an image and a generic file to a document, see upload progress and a generated thumbnail shortly after, have oversized/invalid files rejected with a clear error, and confirm a user without document access cannot retrieve the file directly.

**Common pitfalls:**

- Trusting client-supplied `Content-Type` or file extension for validation — this is a real security gap (MIME sniffing must happen server-side, post-upload).
- Making uploaded files publicly readable by URL guess instead of gating access through the same permission resolution as the parent document.

**Dependencies on future phases:** Phase 10's editor embeds images via this upload capability rather than reimplementing it.

---

## Phase 10 — Rich Text Editor Foundation (Yjs-Backed, Single-Client)

**Goal:** A user can open a document and get a full rich-text editing experience — headings, lists, tables, code blocks, images, checklists, markdown shortcuts, slash commands, undo/redo — persisted via a **real Yjs document model**, loaded/saved over plain REST (no WebSocket, no multi-user sync yet).

**Why this phase exists:** this is the largest and most consequential "simple before complex" decision in the roadmap. Building the editor against the _actual_ Yjs persistence model (update log + snapshot, per architecture §9.4) from day one — just without the live multi-client WebSocket relay — means Phase 13's real-time work is purely additive (a new transport for the same data), never a data-model migration. This avoids the technical debt of building a throwaway content format first.

**Prerequisites:** Phase 6 (documents, to attach content to), Phase 7 (permissions, to gate edit access), Phase 9 (uploads, for image embeds).

**Deliverables:**

- Full editor surface (ProseMirror/TipTap + Yjs binding) for all block types listed in architecture §4.5.
- REST endpoints to load a document's current Yjs state (server reconstructs from snapshot + update log, per §9.4) and to submit new updates (debounced client-side autosave, applied as real Yjs updates appended to the durable log — not a generic "save this blob" endpoint).
- Undo/redo via Yjs's `UndoManager` (§9.6), correctly scoped to local-origin changes even though there's only one client today — this behavior must already be correct before Phase 13 makes it matter for real.

**Features implemented:** full rich-text editing (single user, single session at a time — no simultaneous-multi-client behavior is expected or tested yet, that's explicitly Phase 13's job).

**Database changes:** the Yjs persistence tables from architecture §9.4 — an append-only update-log table (documentId, sequence, binary update blob) and a snapshot table (documentId, sequence-at-snapshot, binary compacted state). `Document.lastEditedByUserId`/`lastEditedAt` (placeholder since Phase 6) now updated with real values on every save.

**Backend work:**

- Load endpoint: reconstruct current state from latest snapshot + subsequent update-log entries (this exercises the exact reconstruction logic Phase 12/13's room-join will reuse).
- Save endpoint: accept a client-generated Yjs update, append to the durable log — implementing the **durability invariant from the architecture's design-review addendum §24.1** now, even without a WebSocket in the picture: the update must be durably appended before the save is acknowledged to the client.
- No compaction job yet (that's Phase 11) — the update log is allowed to grow during this phase, since it's a correctness-first phase, not a performance phase.

**Frontend work:**

- Full editor UI: all block types, slash-command menu, markdown shortcuts, keyboard shortcuts.
- Debounced autosave (local Yjs state updates instantly per keystroke — optimistic, per architecture's core UX principle — with periodic/debounced flush to the save endpoint).
- Image embedding using Phase 9's upload capability.
- A visible (even if simple) "saved" / "saving" indicator — the first appearance of the save-state UI pattern that Phase 13 will extend into full offline/reconnect states (architecture §17.3).

**Infrastructure work:** none new.

**Testing requirements:**

- Integration test: create a document, make edits, reload the page, confirm content persists correctly (exercises load-from-snapshot-plus-log reconstruction with a real, if short, update log).
- Undo/redo test: verify undo only reverts local-origin changes (meaningful groundwork for Phase 13, testable now with a single client).
- Durability test: kill the server process immediately after a save request is sent but before the client receives an acknowledgment, restart, and verify the update was not lost (this is the literal §24.1 invariant, testable even without collaboration).
- Authorization test: a user with only Commenter/Viewer-level access (Phase 7) cannot submit edits, even by calling the save endpoint directly.

**Definition of Done:**

- A user can create rich content of every supported block type in a document, reload the browser, and see it exactly as left; undo/redo behaves correctly; a simulated server crash immediately after a save does not lose that edit; a read-only user is blocked from editing at the API level, not just hidden in the UI.

**Common pitfalls:**

- Treating this as a temporary/throwaway content model "to be replaced by Yjs later" — it must _be_ the real Yjs model from the start, or Phase 13 inherits a painful migration. This is the single most important design decision in this roadmap to get right.
- Skipping the durability-invariant test because "there's no WebSocket yet so it doesn't matter" — it matters precisely because this is the cheapest point at which to prove the invariant, before concurrency makes it harder to test.

**Dependencies on future phases:** Phase 11 (compaction/version history) operates directly on this phase's update-log/snapshot tables. Phase 13 replaces this phase's REST save/load path with a live WebSocket path against the _same_ persistence tables — no schema change.

---

## Phase 11 — Snapshot Compaction & Version History

**Goal:** Long update logs are periodically compacted into snapshots (bounding load time), and users can browse, compare, and restore historical versions of a document.

**Why this phase exists:** Phase 10 deliberately left the update log uncompacted to keep that phase's scope tight. This phase closes that gap and, since compaction and version history share the same underlying snapshot mechanism, builds both together rather than as two disconnected features.

**Prerequisites:** Phase 10 (the update-log/snapshot tables must exist and be populated by real usage), Phase 2 (job infra).

**Deliverables:**

- A debounced BullMQ compaction job (architecture §9.4, §10) that merges a document's update log into a new baseline snapshot and prunes subsumed log entries.
- Named/manual snapshot creation ("save a version").
- Version history UI: timeline, restore-to-version, compare-versions (diff view).

**Features implemented:** automatic compaction, manual snapshots, version timeline, restore, compare.

**Database changes:** `VersionSnapshot` metadata table (architecture §7.1) referencing the underlying snapshot storage (extends Phase 10's snapshot table with named/manual entries and richer metadata — author, label, timestamp).

**Backend work:**

- Compaction job: debounced (N seconds after last edit, or a max-interval fallback), idempotent (re-running against an already-compacted range is a safe no-op, per architecture §10's idempotency requirement), with the dead-letter/alerting safeguard from the design-review addendum §24.4 (a document whose compaction repeatedly fails must not silently accumulate an ever-growing log forever — surface it).
- Manual snapshot endpoint: forces an immediate named snapshot outside the debounce cycle.
- Restore: reconstructs the chosen historical state and applies it as a new forward-moving Yjs update (never destructively rewrites history — restoring to an old version is itself a new, undoable edit, consistent with CRDT semantics).
- Compare: diff two snapshot states for display (text-level diff of the reconstructed content, not a Yjs-internal diff).

**Frontend work:**

- Version timeline UI (scrubber or list), "save a named version" action, restore confirmation, side-by-side or inline compare view.

**Infrastructure work:** none new — reuses Phase 2's BullMQ infra.

**Testing requirements:**

- Compaction correctness test: a document with many updates compacts to a snapshot that reconstructs identically to replaying the full original log.
- Idempotency test: running the compaction job twice against the same range produces no duplicate or corrupted state.
- Poison-update safeguard test (per §24.4): inject a deliberately malformed update into the log and verify the compaction job isolates/skips it with an alert, rather than crashing or corrupting the whole document's compaction.
- Restore test: restoring to an old version produces a new, forward-moving state (verify old history is not destroyed).

**Definition of Done:**

- A document with a realistic edit history compacts automatically without user action, a user can manually save a named version, browse a timeline, compare two versions, and restore an old version without losing the ability to undo that restore itself.

**Common pitfalls:**

- Making restore a destructive history rewrite instead of a new forward edit — this breaks the CRDT convergence guarantee's spirit and removes the ability to "undo an accidental restore."
- Letting a single malformed update block compaction entirely instead of isolating it — this is the exact death-spiral failure mode identified in the design-review addendum (§24.4) and must be handled here, not discovered in production.

**Dependencies on future phases:** Phase 13's live collaborative editing relies on this same compaction job continuing to run correctly under real concurrent multi-user load — this phase's tests should be considered a baseline, re-validated (not re-designed) once Phase 13 introduces concurrency.

---

## Phase 12 — WebSocket Infrastructure & Presence

**Goal:** A real Socket.IO server exists, horizontally scalable via the Redis adapter, with authenticated/authorized room joins — proven first via **presence only** (who's viewing, live avatars, typing indicators, cursor position broadcast) before any document _content_ flows through it.

**Why this phase exists:** this isolates "is the real-time transport layer correct, authorized, and horizontally scalable" from "is live content sync correct" — two very different, both hard, problems. Proving the WebSocket infrastructure with the lower-stakes presence feature first (nothing here is durable or correctness-critical if lost, per architecture §9.5/§8) means Phase 13 inherits trusted plumbing rather than building it under the added pressure of also getting content sync right simultaneously.

**Prerequisites:** Phase 7 (permission resolution function, reused verbatim for room-join authorization per architecture §11.2), Phase 10 (documents with real content to have presence _on_, even though this phase doesn't sync that content yet).

**Deliverables:**

- Socket.IO server as its own process (per architecture §5/§19's process-separation principle, scaffolded since Phase 0), authenticated via the same session cookie as REST (§11.1).
- Room-join authorization reusing Phase 7's exact permission-resolution function — no parallel WebSocket-only auth logic.
- Redis adapter wired for horizontal scaling (§11.4) — provable with at least two server instances in a test/staging environment.
- Awareness protocol wired for presence/cursor broadcast only (no Yjs content updates flow through this phase's sockets yet).
- Live avatar stack, typing indicators, live cursor position — all ephemeral, Redis-backed, no persistence (§8, §9.5).

**Features implemented:** presence, live avatars, typing indicators, live cursors (visual position only — not yet driving actual content sync).

**Database changes:** none — presence is deliberately Redis-only, non-durable, per architecture §8/§9.5.

**Backend work:**

- Socket.IO server setup, session-cookie authentication at handshake (§11.1).
- Room-join handler: calls Phase 7's permission function; rejects unauthorized joins before any room membership occurs.
- Redis pub/sub adapter configuration (`@socket.io/redis-adapter`), tested against a genuinely multi-instance setup, not just a single local process (§11.4).
- Heartbeat/reconnect handling (§11.3) with **exponential backoff plus jitter** on the client (the jitter requirement flagged in the design-review addendum §24.4 to avoid synchronized reconnect storms) — build this correctly now, since Phase 13's higher-stakes reconnect logic builds directly on it.
- Periodic re-validation of room-join authorization for long-lived connections (§11.2) — a permission revoked mid-session must actually disconnect the affected socket, not just block future joins.

**Frontend work:**

- Presence UI: avatar stack, typing indicator, live cursor rendering (color-coded per user) — layered onto Phase 10's editor UI without yet wiring actual content updates through the socket.

**Infrastructure work:**

- The real-time process now genuinely deployed as its own scalable service (separate from the control-plane API), with the Redis adapter configuration proven across multiple instances in at least a staging environment.

**Testing requirements:**

- Authorization test: a user without document access cannot join that document's presence room, even with a valid session — reusing and re-executing Phase 7's authorization test suite against the socket layer, not just REST.
- Multi-instance test: two clients connected to _different_ server instances, in the same document room, see each other's presence/cursor updates correctly via the Redis adapter (this is the literal §11.4 correctness requirement and must be tested against real multiple instances, not assumed from single-instance-passing tests).
- Mid-session revocation test: a user's document access is revoked while their socket is connected; verify they are disconnected from that room promptly, not just blocked from rejoining.
- Reconnect-storm test: simulate many simultaneous disconnects and verify reconnect attempts are jittered, not synchronized (§24.4).

**Definition of Done:**

- Two users viewing the same document, connected to different server instances in a multi-instance test setup, see each other's live cursor and presence indicators correctly and promptly; a permission revocation mid-session disconnects the affected user from that room; no document content sync exists yet — that is explicitly out of scope until Phase 13.

**Common pitfalls:**

- Testing the Redis adapter only against a single local instance, where it "works" trivially even if misconfigured, and only discovering a real multi-instance bug in Phase 13 or in production.
- Re-implementing permission logic at the socket layer instead of calling Phase 7's function directly — this is precisely the parallel-auth-system risk architecture §11.2 warns against.
- Skipping jitter on reconnect backoff "since it's just presence for now" — the pattern set here is what Phase 13's much higher-stakes reconnect logic will inherit.

**Dependencies on future phases:** Phase 13 adds live Yjs content-update relay through these exact same rooms, reusing this phase's authentication, authorization, and scaling infrastructure without modification.

---

## Phase 13 — Real-Time Collaborative Editing

**Goal:** Multiple users can edit the same document simultaneously, with live Yjs content sync over the WebSocket infrastructure from Phase 12, correct offline/reconnect behavior, and no central sequencing bottleneck.

**Why this phase exists:** this is the hardest, highest-risk phase in the entire roadmap — and by this point, every dependency (auth, permissions, document tree, the real Yjs persistence model from Phase 10, compaction from Phase 11, and a proven WebSocket transport from Phase 12) already exists and is independently tested. This phase's job is narrowly to wire live content sync through already-trusted plumbing, not to invent any of that plumbing under pressure.

**Prerequisites:** Phase 10 (Yjs persistence model), Phase 11 (compaction, now genuinely exercised under concurrent load), Phase 12 (WebSocket infra + presence, proven multi-instance).

**Deliverables:**

- Live Yjs update relay through Phase 12's rooms: the sync-step-1/sync-step-2 handshake on join (§9.3), incremental update broadcast thereafter (§12 of the architecture doc — the full user-A-types-to-user-B-sees flow).
- Client-side offline persistence (IndexedDB provider, §9.7) — editing continues uninterrupted when disconnected, syncing automatically on reconnect.
- Full offline/reconnect/conflict-adjacent UI states from architecture §17.3, now genuinely meaningful (not placeholder, since real concurrent editing exists to trigger them).
- The durability invariant from §24.1 now proven under real concurrency, not just Phase 10's single-client version.

**Features implemented:** real-time multi-cursor editing (now with actual content, not just cursor position from Phase 12), offline editing, reconnect-and-merge, optimistic updates under real concurrency, incremental sync.

**Database changes:** none new — this phase reuses Phase 10/11's tables exactly; this is the proof that Phase 10's design decision (build the real Yjs model early) pays off here as a transport change, not a schema change.

**Backend work:**

- Wire the sync-step-1/2 handshake into Phase 12's room-join flow.
- Relay incoming updates to other room members (via Phase 12's already-proven Redis adapter) **and** append to the durable log (Phase 10's table) — implementing the exact ordering/ack contract from architecture §24.1 under real concurrency this time, with a dedicated crash-recovery test (see below).
- Broadcast batching under high concurrency (§11.5) — now meaningful, since Phase 12 never had concurrent content updates to batch.
- Retire Phase 10's REST save endpoint as the primary path during active sessions (it can remain as a fallback for initial page load / non-JS contexts, per architecture's note in §12, but live editing sessions use the socket path).

**Frontend work:**

- Wire the editor's Yjs binding to the live socket connection instead of Phase 10's REST-only path.
- IndexedDB offline provider integration (§9.7).
- Offline/reconnecting/conflict-adjacent/error/success state UI (§17.3), now backed by real state transitions instead of being unreachable.

**Infrastructure work:** none new beyond Phase 12's already-provisioned multi-instance setup.

**Testing requirements:**

- **The highest-value test category in the entire roadmap:** simulated concurrent edits from multiple real Yjs clients, asserting eventual convergence regardless of update ordering (architecture §20's "synchronization tests").
- Crash-recovery test under real concurrency: kill a server instance mid-edit-burst with multiple active clients, verify zero data loss end-to-end and correct reconnection/resync for all affected clients (extends Phase 12's single-instance-crash groundwork into a genuinely concurrent scenario).
- Offline test: disconnect a client mid-edit, continue editing locally, reconnect, verify automatic merge with no manual conflict-resolution step required, and verify no data was lost from either the offline client or the clients that remained online.
- Multi-instance load test: many concurrent editors on the same document, split across multiple server instances, verifying Phase 12's Redis adapter and this phase's broadcast batching hold up (a first real exercise of the design-review addendum's §24.2 capacity model, even at modest scale).
- Reconnect-storm test under real content sync (not just presence, extending Phase 12's version): simulate a fleet restart with many active editing sessions and verify jittered reconnect plus correct resync for all of them.

**Definition of Done:**

- Three or more real browser clients can simultaneously edit the same document, see each other's changes propagate correctly and quickly, one client can go offline, keep editing, and reconnect with a correct automatic merge and no data loss, and a simulated server crash mid-session loses zero durably-received edits.

**Common pitfalls:**

- Treating this phase as "just wire the socket to Yjs" — the actual difficulty is in the failure-mode testing (crash recovery, offline merge, multi-instance broadcast under load), which must not be shortchanged just because the "happy path" wiring is comparatively simple given Phases 10–12's groundwork.
- Discovering _now_ that Phase 10's persistence model was actually a placeholder after all — this is exactly the rework risk the roadmap was structured to avoid; if it happens, treat it as a signal to revisit Phase 10's Definition of Done, not to patch around it here.
- Skipping jitter/backoff testing under real load because Phase 12 "already covered it" — Phase 12 tested it for presence-only reconnect; this phase must re-verify it under the added weight of actual content-sync reconnection.

**Dependencies on future phases:** Phase 14 (comments), Phase 15 (suggestions) both attach to documents that are now live-collaborative; both should be tested against actively co-edited documents, not just static ones.

---

## Phase 14 — Comments & Mentions

**Goal:** Users can leave inline, anchored comments on a document, thread replies, resolve/reopen, and @mention collaborators, triggering notification events.

**Why this phase exists:** comments are additive to a now-fully-functional collaborative editor (Phase 13) and don't require any new transport-layer work — they're a good next slice specifically because they exercise the notification-event pattern (§16) that later phases (suggestions, notifications center) will reuse.

**Prerequisites:** Phase 13 (a live document to comment on), Phase 2 (job infra, for notification events).

**Deliverables:**

- Inline comment anchoring (attached to a position/range in the document), threaded replies, resolve/reopen.
- @mention autocomplete (searching workspace members, per Phase 5), triggering a notification event on mention.

**Features implemented:** inline comments, threads, resolve, mentions, notification triggers (the events themselves; the unified notification _center_ UI is Phase 16).

**Database changes:** `Comment` table (document reference, anchor position/range, author, resolved flag, parent-comment reference for threading).

**Backend work:**

- Comment CRUD, anchor-position handling (must remain sensibly attached to content as the document changes under concurrent editing — a real design decision: anchor to a stable Yjs relative position, not a raw character offset, since offsets shift under concurrent edits).
- Mention detection and notification-event enqueueing (Phase 2 job infra) — this establishes the notification-event pattern Phase 16 consolidates.

**Frontend work:**

- Comment sidebar/inline UI, anchor highlighting in the editor, thread view, resolve/reopen controls, @mention autocomplete.

**Infrastructure work:** none new.

**Testing requirements:**

- Anchor-stability test: add a comment, have another (simulated) client concurrently edit the document before/around the anchored position, verify the comment anchor remains sensibly attached (this is a real correctness risk unique to commenting on a live-collaborative document and deserves explicit coverage, not an assumption).
- Mention-notification test: mentioning a user enqueues exactly one notification event (idempotency, consistent with Phase 2's pattern).
- Authorization test: comment visibility/creation respects Phase 7's permission resolution (e.g., a Viewer-level user can comment if the role allows it, per the role definitions in architecture §4.6, but not if it doesn't).

**Definition of Done:**

- A user can comment on a specific piece of content in a live document, have the anchor survive concurrent edits from another user, thread a reply, resolve it, and mention a collaborator who receives a real notification event (even before Phase 16's polished notification center exists to display it nicely).

**Common pitfalls:**

- Anchoring comments to raw character offsets instead of stable relative positions — this breaks the moment concurrent edits shift the document, which is now a real, frequent occurrence given Phase 13.
- Building mention-notification events ad hoc instead of following Phase 2's established job/idempotency pattern.

**Dependencies on future phases:** Phase 16 consolidates this phase's notification events into a unified center.

---

## Phase 15 — Suggestion Mode

**Goal:** Users can propose edits as tracked-change-style suggestions rather than direct edits, which the document owner/editor can accept or reject.

**Why this phase exists:** this is meaningfully more complex than direct comments (it requires representing a _proposed_ change distinctly from an _applied_ one, within the same collaborative document) and deserves isolation as its own phase rather than being bundled into Phase 14's comment work.

**Prerequisites:** Phase 13 (live collaborative editing), Phase 14 (the anchoring/notification patterns this phase extends).

**Deliverables:**

- "Suggesting" mode toggle in the editor: edits made in this mode are represented as visible, attributed proposals rather than applied directly.
- Accept/reject UI per suggestion (or per batch), with accepted suggestions becoming real Yjs edits and rejected ones discarded without ever having been applied to the canonical content.

**Features implemented:** suggestion mode, accept/reject workflow.

**Database changes:** likely none beyond what's needed to track suggestion metadata (author, status) if suggestions aren't represented purely within the Yjs document structure itself — this is an implementation decision to make explicitly during this phase (e.g., a `Y.Map`-based suggestion overlay within the document vs. a separate relational tracking table) and document the reasoning, not default to whichever is easiest.

**Backend work:**

- Suggestion representation within/alongside the Yjs document, accept/reject endpoints that either apply the change as a real edit (accept) or discard it (reject) without ever having mutated canonical content.

**Frontend work:**

- Suggestion-mode toggle, inline visual distinction (e.g., strikethrough/underline styling per common tracked-changes conventions) with attribution, accept/reject controls.

**Infrastructure work:** none new.

**Testing requirements:**

- Correctness test: a rejected suggestion leaves the canonical document byte-for-byte as if the suggestion never existed.
- Concurrency test: a suggestion proposed while another user is concurrently editing the same region resolves sensibly (this is a genuine edge case worth explicit coverage, not assumption).
- Authorization test: only users with sufficient role (per Phase 7) can accept/reject, even if any collaborator can propose.

**Definition of Done:**

- A Commenter-or-above-role user can propose a suggested edit, visibly distinct from a direct edit, and an Editor/Owner can accept (applying it as a real edit) or reject (leaving canonical content untouched) it.

**Common pitfalls:**

- Applying suggestions to canonical content immediately and "hiding" them with UI styling instead of truly keeping them out of the canonical Yjs state until accepted — this is a meaningfully different (and more correct) representation, worth the extra design effort.

**Dependencies on future phases:** none especially — this is closer to a leaf feature.

---

## Phase 16 — Notifications System

**Goal:** A unified notification center (in-app + email) consolidates the notification events already being generated by Phase 5 (invitations), Phase 14 (mentions/comments), and this phase's own additions, respecting the preferences established in Phase 3.

**Why this phase exists:** by this point, several earlier phases have been enqueueing notification-worthy events independently (invitations, mentions, comment replies). This phase's job is specifically to consolidate them into one coherent, user-facing system rather than leaving them as disconnected point features — an intentionally late phase so it can unify real, already-working event sources instead of guessing at requirements upfront.

**Prerequisites:** Phase 2 (job infra), Phase 3 (notification preferences schema), Phase 5 (invitation events), Phase 14 (mention/comment events).

**Deliverables:**

- In-app notification center (list, unread state, mark-as-read).
- Email notifications for the same event types, respecting Phase 3's preference toggles.
- Notification-event schema unified across all producing phases (invitations, mentions, comment replies) rather than each phase having its own ad hoc shape.

**Features implemented:** in-app notifications, email notifications, notification preferences enforcement.

**Database changes:** `Notification` table (recipient, type, source reference, read/unread, timestamp) — likely a refactor of Phase 5/14's previously ad hoc event handling into this unified table; this is an explicitly planned, contained refactor (not scope creep), since those phases were told from the start that this consolidation was coming.

**Backend work:**

- Unified notification-creation function, called by all producing events (invitation created, mention detected, comment reply posted), respecting Phase 3's per-user preferences before enqueueing an email (in-app notifications may always be created; email dispatch is gated by preference).
- Mark-as-read endpoint.

**Frontend work:**

- Notification center UI (bell icon + dropdown/panel, unread badge), notification-preferences page (extending Phase 3's settings).

**Infrastructure work:** none new — reuses Phase 2's email/job infra.

**Testing requirements:**

- Preference-respecting test: disabling email notifications for a given type suppresses the email but not the in-app notification (or whatever the exact policy is — make it explicit and test it).
- Regression test: Phase 5's invitation emails and Phase 14's mention notifications still work correctly after being refactored onto this unified system.

**Definition of Done:**

- All notification-worthy events across the app appear correctly in the in-app center and, subject to user preference, via email, with mark-as-read working and no regression in the previously-shipped invitation/mention notification behavior.

**Common pitfalls:**

- Treating this as a from-scratch feature instead of a deliberate consolidation of existing event producers — skipping the regression tests against Phase 5/14's prior behavior.

**Dependencies on future phases:** future push-notification support (explicitly out of scope per the architecture doc, §4.11) would extend this system's event producers, not replace them.

---

## Phase 17 — Dashboard, Activity & Templates

**Goal:** The dashboard becomes fully real: recent documents, shared-with-me, favorites, an activity feed, and a templates gallery (personal and workspace-level).

**Why this phase exists:** most of this phase's data already exists from earlier phases (documents, permissions, edits, comments) — this phase is primarily an aggregation and UX layer, plus the addition of the one genuinely new feature (templates), and is sequenced late so it can aggregate real, already-populated data rather than being built against stubs.

**Prerequisites:** Phase 6 (documents), Phase 7 (permissions, for "shared with me"), Phase 13 (real edit activity to show), Phase 14 (comment activity).

**Deliverables:**

- Full dashboard: recent, shared-with-me, favorites (Phase 6 already covered basic recent/favorites — this phase adds shared-with-me and ties it all together), activity feed, templates gallery.
- Template creation (save any document as a personal or workspace template) and instantiation (create a new document from a template).

**Features implemented:** shared-with-me view, activity feed, templates (personal and workspace-level).

**Database changes:** `Template` reference (likely a flag/relation on `Document` marking it as a template source, plus a join for workspace-level template visibility) — an `ActivityLogEntry` or reuse of a general event-log table for the activity feed (distinct from Phase 18's audit log, which is admin-facing and security-relevant; this one is user-facing and UX-relevant — worth keeping conceptually separate even if the underlying storage pattern is similar).

**Backend work:**

- Shared-with-me query: documents where the requesting user has an explicit Phase 7 override but is not the owner/workspace-default path — a genuinely distinct query from "my documents."
- Activity feed aggregation across edit/comment/share events.
- Template save/instantiate endpoints (instantiate deep-copies the template's content into a new document, reusing Phase 6's duplicate logic).

**Frontend work:**

- Dashboard layout consolidating all sections, activity feed UI, templates gallery UI with "use this template" action.

**Infrastructure work:** none new.

**Testing requirements:**

- "Shared with me" correctness test: only documents with a genuine explicit share (not just workspace membership) appear here, distinct from "my documents."
- Template instantiation test: creating from a template produces a correct, independent copy (not a reference back to the template).

**Definition of Done:**

- The dashboard is fully populated with real, correctly-scoped data across all sections, and a user can save a document as a template and create new documents from it.

**Common pitfalls:**

- Conflating "shared with me" with "everything in workspaces I belong to" — these are genuinely different sets and deserve a distinct, tested query.

**Dependencies on future phases:** none especially — this is largely a terminal aggregation phase.

---

## Phase 18 — Admin Panel & Audit Logging

**Goal:** Workspace admins get a management console: member management, an audit log of security/permission-relevant events across the app, and basic system-health indicators scoped to their workspace.

**Why this phase exists:** by this point, enough real mutating events exist across the app (role changes, ownership transfers, permission overrides, member removals, deletions) that the audit log has real content to record, rather than being built speculatively early with nothing meaningful to show.

**Prerequisites:** Phases 4/5 (workspace/membership), Phase 7 (permissions — the primary source of audit-worthy events).

**Deliverables:**

- Admin console: member management (reusing Phase 5's role-assignment/removal, now surfaced in a dedicated admin view), audit log viewer, workspace storage/activity indicators.
- Retroactive audit-event instrumentation across every prior phase's permission-relevant mutations (role changes, ownership transfers, member removal, document permission overrides, workspace/document deletion) — this is explicitly planned instrumentation work, not new business logic.

**Features implemented:** admin console, audit logging, workspace health indicators.

**Database changes:** `AuditLogEntry` table (actor, action type, target, timestamp, workspace reference) — distinct from Phase 17's user-facing activity log, per the reasoning noted there.

**Backend work:**

- Audit-event emission wired into every permission-relevant mutation across Phases 5/7/4 (and any others identified during this phase's implementation) — a cross-cutting instrumentation pass.
- Admin-only authorization on all endpoints in this phase (only workspace Owners, or an explicitly-defined admin role, per the policy decided in Phase 5).

**Frontend work:**

- Admin console UI: member table with actions, audit log table with filtering (by actor, action type, date), basic workspace health widgets (storage usage, member count, recent activity volume).

**Infrastructure work:** none new.

**Testing requirements:**

- Coverage test: every permission-relevant mutation identified above actually produces a correctly-attributed audit log entry (a checklist-style test suite, since this phase's value is in completeness, not cleverness).
- Authorization test: only admins can access this console; a non-admin workspace member is blocked, even by direct URL/API access.

**Definition of Done:**

- A workspace admin can see a member management console and a complete, correctly-attributed audit trail covering every permission-relevant action taken in that workspace across all prior phases, with non-admins correctly denied access.

**Common pitfalls:**

- Instrumenting audit logging only for _new_ actions built during this phase and forgetting to retrofit it onto Phase 5/7's already-shipped mutations — the whole point of sequencing this phase last (among the admin-adjacent phases) is to audit _everything_ that came before, not just what's new.

**Dependencies on future phases:** none especially.

---

## Phase 19 — Exports & Imports

**Goal:** Users can export a document to PDF/Markdown asynchronously and import external content into the platform.

**Why this phase exists:** exports/imports are genuinely asynchronous, potentially slow operations that don't belong on any synchronous request path — a natural, well-isolated addition once the core editor (Phase 10/13) and job infra (Phase 2) both exist and are proven.

**Prerequisites:** Phase 10/13 (real document content to export/import), Phase 2 (job infra), Phase 9 (S3, for storing export artifacts).

**Deliverables:**

- Async export job (PDF, Markdown) — user-initiated, notified on completion (via Phase 16's notification system) with a download link.
- Import pipeline for at least one external format, creating a new document (via Phase 6/10's creation path) from parsed external content.

**Features implemented:** exports, imports.

**Database changes:** possibly an `ExportJob`/`ImportJob` status-tracking table if not already adequately covered by BullMQ's own job-status visibility.

**Backend work:**

- Export job: renders the document's current state to the target format, uploads the artifact to S3 (Phase 9), notifies the user on completion.
- Import job: parses the uploaded external file, creates a new document via existing creation paths (never bypassing Phase 6/7's permission and tree logic) — and is transactional at the document-creation level, so a partially-failed import never leaves a half-created, inconsistent document (architecture §10's explicit requirement).

**Frontend work:**

- Export action with a "processing, we'll notify you" pattern (no synchronous waiting on the export completing).
- Import UI (file upload, format selection, progress/failure state).

**Infrastructure work:** none new.

**Testing requirements:**

- Export correctness test: exported PDF/Markdown accurately reflects document content.
- Import transactionality test: a deliberately malformed/partial import file does not leave a half-created document behind.
- Notification test: export completion correctly triggers a Phase 16 notification with a working download link.

**Definition of Done:**

- A user can export a document and receive a notification with a working download link once processing completes, and import an external file into a new, correctly-permissioned document, with a failed import leaving no partial artifacts.

**Common pitfalls:**

- Making export/import synchronous "since it's usually fast" — large documents or slow parsing will eventually violate this assumption, and the async pattern should be the default from the start, per architecture §10.

**Dependencies on future phases:** none especially.

---

## Phase 20 — Security Hardening Pass

**Goal:** A dedicated, cross-cutting review and hardening pass across the entire application built so far — CSRF, rate limiting, XSS, session-hijacking mitigations — rather than assuming each phase's incidental security work was sufficient in isolation.

**Why this phase exists:** individual phases have made security-relevant decisions along the way (session cookie flags in Phase 1, permission checks throughout, upload validation in Phase 9), but no phase has stepped back to verify these hold up _together_, under adversarial testing, across the whole surface area. This is a deliberate, dedicated phase, not a checklist item folded into feature work.

**Prerequisites:** effectively all prior phases (this is explicitly a review/hardening pass over the whole application).

**Deliverables:**

- CSRF tokens on state-changing REST endpoints, verified end-to-end (beyond the SameSite-cookie baseline from Phase 1).
- Rate limiting (Redis-backed sliding window, per architecture §8/§15) rolled out concretely to the sensitive endpoints identified throughout the roadmap: invitation sending (Phase 5), comment posting (Phase 14), login attempts (Phase 1), search queries (Phase 8).
- XSS audit across all user-generated-content rendering paths (rich text content, comments, embeds/link previews).
- Session-hijacking mitigation review (cookie flags, rotation policy) and a genuine penetration-test-style pass against the authorization boundaries established in Phases 1/5/7.

**Features implemented:** none new to the user — this phase hardens existing features rather than adding surface area.

**Database changes:** none expected, though rate-limit state lives in Redis (already established infra).

**Backend work:**

- Rate-limiting middleware applied to the specific endpoints identified above, with concrete thresholds decided and documented (not left as "reasonable defaults" without justification).
- CSRF token issuance/validation on state-changing endpoints.
- A content-sanitization audit specifically for every rendering path that touches user-generated content, not just the primary editor.

**Frontend work:**

- CSRF token inclusion in state-changing requests.
- Rate-limit-aware UX (clear messaging when a limit is hit, not a generic error).

**Infrastructure work:** none new.

**Testing requirements:**

- A genuine adversarial test pass: attempt CSRF against state-changing endpoints without a valid token; attempt to exceed rate limits and verify enforcement; attempt XSS payloads through every user-generated-content path identified; attempt session-fixation/hijacking scenarios against Phase 1's session mechanism.
- Re-run the authorization test suites from Phases 1, 5, and 7 under this phase's adversarial lens, not just their original happy-path-adjacent coverage.

**Definition of Done:**

- A documented, executed security test pass covering CSRF, rate limiting, XSS, and session security across the whole application, with concrete thresholds and mitigations in place and verified, not assumed from individual phases' earlier, narrower testing.

**Common pitfalls:**

- Treating each phase's incidental security work as sufficient and skipping this dedicated pass — cross-cutting vulnerabilities (e.g., an XSS gap in a rendering path added in Phase 17 that no earlier phase's tests ever exercised) are exactly what a phase-by-phase build misses without a deliberate, whole-system pass.

**Dependencies on future phases:** Phase 21/22 assume this hardening pass is complete before production traffic.

---

## Phase 21 — Observability & Production Readiness

**Goal:** Implement the design-review addendum's operational requirements (§24) for real: metrics, tracing, SLO dashboards, burn-rate alerting, and WebSocket-aware connection draining on deploy.

**Why this phase exists:** the architecture's design-review addendum (§24) specified SLOs, failure modes, and operational practices in writing; this phase is where those specifications become real, running infrastructure rather than remaining documentation.

**Prerequisites:** the full application (all prior phases) — observability needs real signals to observe.

**Deliverables:**

- Metrics dashboards for the SLIs defined in architecture §24.3 (API latency/availability, real-time layer availability, time-to-first-sync, cross-client propagation latency).
- Multi-window, multi-burn-rate alerting wired to these SLOs (§24.3's alerting policy), replacing any ad hoc threshold alerts from earlier phases.
- Distributed tracing with correlation IDs (established in Phase 0) actually flowing through real requests, including into BullMQ jobs.
- WebSocket-aware deployment: connection draining on rolling deploys (§24.5), replacing whatever default deployment behavior existed since Phase 12.
- Health checks (liveness/readiness) for both processes, wired into the deployment platform's restart policy.

**Features implemented:** none user-facing — this is entirely operational infrastructure.

**Database changes:** none expected.

**Backend work:**

- Metrics instrumentation across control-plane and real-time-plane processes.
- Tracing instrumentation, including propagation into async job execution (Phase 2's workers).
- Connection-draining logic on the real-time process's shutdown signal handler (§24.5) — this is a genuinely new behavior, not present since Phase 12's original deployment setup.

**Frontend work:** none.

**Infrastructure work:**

- Dashboards and alerting rules provisioned against the chosen observability stack.
- Deployment pipeline updated to use graceful shutdown/draining for the real-time process specifically, distinct from the control-plane's simpler rolling-restart behavior.

**Testing requirements:**

- A deliberate deploy-under-load test: roll out a new version of the real-time process while active editing sessions exist, and verify no mid-edit disconnects occur that aren't gracefully drained and reconnected (this directly validates §24.5's connection-draining requirement).
- Alert-firing test: deliberately degrade a monitored SLI (e.g., inject latency) and verify the correct burn-rate alert fires at the correct threshold, without excessive noise on normal, minor blips.

**Definition of Done:**

- Every SLO from architecture §24.3 has a live dashboard and burn-rate alerting; a rolling deploy of the real-time tier under active load produces no ungraceful mid-edit disconnects; tracing correctly follows a request from REST/socket entry through to any triggered background job.

**Common pitfalls:**

- Wiring dashboards for metrics that are easy to collect (CPU%, memory) instead of the user-facing SLIs that actually matter (§24.3) — infrastructure metrics alone were explicitly flagged in the design-review addendum as a poor primary paging signal.
- Deploying the real-time tier with the same rolling-restart strategy as the stateless control plane, re-introducing the exact problem §24.5 was written to prevent.

**Dependencies on future phases:** Phase 22's load testing depends on this phase's dashboards to actually observe results.

---

## Phase 22 — Scale Validation & Launch Readiness

**Goal:** Replace the architecture's back-of-envelope capacity estimates (§24.2) with real, measured load-test results, validate the failure-mode mitigations from §24.4 via actual game-day exercises, and make an explicit go/no-go launch call.

**Why this phase exists:** this is the final gate before treating the system as production-ready for real user traffic at any meaningful scale — every number in §24.2 was explicitly marked as an untested estimate, and every failure mode in §24.4 was a paper exercise until rehearsed. This phase is where "the architecture supports X" becomes "we've verified the system actually does X."

**Prerequisites:** every prior phase, especially Phase 21 (observability, needed to actually measure the results of this phase's tests).

**Deliverables:**

- Real load-test results replacing every estimate in architecture §24.2 (connections/instance, Redis pub/sub throughput, Postgres write QPS under realistic concurrent-editing load, storage growth rate).
- Executed game-day exercises for each failure mode in §24.4 (Redis outage, Redis partition, Postgres failover, WebSocket instance crash under load, hot-document saturation, poison-update injection, OAuth-provider outage simulation) with documented, verified outcomes — not just "should be fine because the architecture says so."
- A documented capacity headroom policy (§24.5) with a concrete current ceiling based on this phase's actual measured results.
- A documented backup-restore test actually executed (not just "backups are configured").
- A formal go/no-go launch decision document.

**Features implemented:** none new — this is a validation and hardening phase.

**Database changes:** none expected.

**Backend/Infrastructure work:**

- Load-testing harness simulating realistic concurrent editing patterns (not just raw connection counts) against a staging environment sized like the intended production environment.
- Chaos-engineering exercises executed against staging, each mapped directly to a §24.4 failure-mode row.

**Testing requirements:**

- This entire phase _is_ testing — the deliverables above are the test results. No phase's Definition of Done depends more heavily on genuinely executed verification rather than code review.

**Definition of Done:**

- Every capacity number in §24.2 has a real, measured counterpart from this phase's load testing; every failure mode in §24.4 has been actually triggered in staging with a documented, verified outcome matching (or updating) its stated mitigation; backup restore has been actually executed and verified; a go/no-go decision has been made and documented with the evidence gathered in this phase.

**Common pitfalls:**

- Treating the architecture document's estimates as sufficient evidence of readiness — the entire point of this phase is that estimates and rehearsed reality are different things, and only the latter justifies a launch decision.
- Running load tests only against the "happy path" (steady, evenly-distributed load) and skipping the hot-document / bursty-concurrency scenario specifically flagged as the most likely first real bottleneck in the design-review addendum.

**Dependencies on future phases:** none — this is the terminal phase of the initial roadmap. Any gap discovered here should loop back to the specific phase whose Definition of Done it violates, per the "real issue during implementation" exception you've defined — not become an ad hoc patch bolted onto this phase.

---

## Working Agreement Going Forward

- We execute one phase at a time, in order, and do not begin a phase until the previous phase's Definition of Done is fully met.
- The architecture document is frozen and is not revisited except when implementation surfaces a genuine, concrete issue with it — not a preference or a nice-to-have.
- If a phase's implementation reveals that an earlier phase's Definition of Done was not actually met (as flagged as a specific risk in Phase 13 regarding Phase 10, for example), we stop and address the earlier phase properly rather than patching around it downstream.
- No phase ships with a placeholder standing in for a system a later phase depends on (the Phase 10 Yjs-persistence-from-day-one decision is the clearest example of this principle in practice).
