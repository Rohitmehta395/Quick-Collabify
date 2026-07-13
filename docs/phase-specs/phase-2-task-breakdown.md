# Phase 2 — Task Breakdown

**Source spec:** `phase-2-engineering-spec.md` (frozen)
**Rule in effect:** tasks are implemented strictly in order within a milestone; milestones are implemented strictly in order. No task begins until its listed dependencies are merged to `main`. Every task maps to a specific, cited section of the frozen spec — nothing here is invented, skipped, or borrowed from a later phase.
**Total tasks:** 36, across 9 milestones.
**Naming decision inherited from the spec:** the durable notification-tracking entity (spec §4) is referred to throughout this breakdown as `NotificationEvent`, per the spec's own suggested naming.
**Email provider:** Postmark, per spec §5.1's inherited architecture decision and the spec's own §11–17 reasoning — this breakdown does not revisit that choice.

---

## Milestone 1 — Worker Foundation

_Ends with: the database can durably represent a notification event, the worker process's configuration and dependencies are in place, and the worker starts up correctly against real Redis — before any queue or job logic exists._

### P2-T01 — NotificationEvent Prisma Model & Migration

- **Title:** Add `NotificationEvent` model and migration.
- **Goal:** Add the `NotificationEvent` entity to the Prisma schema per spec §4 and §7, including the unique constraint on the idempotency key (spec §7.3).
- **Why this task exists:** every later task that reads or writes job outcome data (Milestones 4–6) depends on this table existing first; this is the true starting point of the phase, mirroring how Phase 1's `User`/`Identity` migration was its own first task.
- **Scope:** Included — `NotificationEvent` model (type, recipientUserId FK, status enum/string, idempotencyKey with unique constraint, metadata JSON field, timestamps for each status transition per spec §4.3/§4.5), index on `recipientUserId`, composite/status index (spec §7.3). Excluded — no other schema changes; no data-access functions yet (P2-T09).
- **Files expected:** Modify `apps/api/prisma/schema.prisma`; create a new migration under `apps/api/prisma/migrations/`.
- **Dependencies:** P1-T02 (User model exists, per Phase 1).
- **Packages:** None — Prisma already installed.
- **Commands:** `pnpm --filter api exec prisma migrate dev --name add_notification_event`, `pnpm --filter api exec prisma generate`.
- **Verification:** Migration applies cleanly against the Compose-provided Postgres; inspecting the resulting table confirms the unique constraint on the idempotency key and both indexes exist exactly as specified; `prisma migrate deploy` succeeds against a freshly reset database. Expected database state: an empty `NotificationEvent` table with the correct constraints, confirmed via a direct `\d` inspection or equivalent.
- **Definition of Done:** Migration committed; schema matches spec §4/§7 exactly, including the deliberately generic (not email-specific) column shape from spec §4.4.
- **Common mistakes:** Adding email-specific columns (subject, body) instead of the generic `type`/`metadata` shape the spec explicitly requires for Phase 16 forward-compatibility (spec §4.4) — re-read that section before naming columns.
- **Estimated time:** 45 min.
- **Git commit:** `feat(db): add NotificationEvent model with idempotency constraint`

---

### P2-T02 — Install BullMQ, Email Provider, and Worker Dependencies

- **Title:** Install Phase 2's backend dependencies.
- **Goal:** Add `bullmq` and the Postmark client SDK to `apps/api` (needed for enqueueing) and `apps/worker` (needed for processing and, if the worker itself calls the provider directly, sending).
- **Why this task exists:** isolates dependency changes from logic changes in the git history, exactly as Phase 0/1's equivalent first tasks did.
- **Scope:** Package installation only — no usage yet.
- **Files expected:** Modify `apps/api/package.json`, `apps/worker/package.json`, root `pnpm-lock.yaml`.
- **Dependencies:** Phase 0 complete, Phase 1 complete.
- **Packages:**
  - `bullmq` — the queue/worker library selected by the architecture (spec §5.1); needed in both `apps/api` (to enqueue) and `apps/worker` (to process).
  - `postmark` — the official Postmark Node SDK, needed in `apps/worker` (the process that actually performs the send, per spec §9's worker-does-the-work model).
- **Commands:** `pnpm --filter api add bullmq`, `pnpm --filter worker add bullmq postmark`.
- **Verification:** `pnpm install` at the repo root completes with no errors; both `package.json` files list the new packages at pinned versions per the dependency policy established in Phase 0 spec §18.
- **Definition of Done:** Packages installed, lockfile committed, no other files touched.
- **Common mistakes:** Installing `postmark` into `apps/api` as well "just in case" — per spec §9's design, only the worker performs the actual send; keep the provider SDK scoped to where it's actually used.
- **Estimated time:** 30 min.
- **Git commit:** `chore(worker): add BullMQ and Postmark dependencies`

---

### P2-T03 — Worker & API Config Schema Extension for Queue/Email Settings

- **Title:** Extend environment schemas for queue and email provider configuration.
- **Goal:** Add the new environment variables this phase requires (Postmark API key, from-address, retry/backoff tuning values if externalized, the interim monitoring-view environment flag from spec §8.4) to `packages/config`'s existing API and worker schemas, and to root `.env.example`.
- **Why this task exists:** every later task that reads one of these variables assumes it's already validated per Phase 0's fail-fast config pattern (that spec §8); this is the same discipline Phase 1 applied for OAuth variables (P1-T06), applied here for this phase's variables.
- **Scope:** Included — all new environment variables this phase needs, added to the correct schema(s). Excluded — no logic that consumes them yet.
- **Files expected:** Modify `packages/config/src/api-config.js`, `packages/config/src/worker-config.js`; modify root `.env.example`.
- **Dependencies:** P2-T02.
- **Packages:** None.
- **Commands:** None beyond running the config loader (via the dev server) to confirm the new variables parse correctly.
- **Verification:** Starting `apps/worker` with all new variables present in `.env` succeeds; starting it with one deliberately missing (e.g., the Postmark API key) fails fast with the expected Phase 0-style config error, confirming the variable is genuinely wired into the schema.
- **Definition of Done:** `.env.example` and both config schemas are in sync (manually confirmed here; automatically re-confirmed by CI in Milestone 8).
- **Common mistakes:** Adding the monitoring-view access flag (spec §8.4) only to `apps/api`'s schema and forgetting it needs to be readable wherever the dashboard route is actually mounted — confirm which process hosts that route before finalizing which schema needs the variable.
- **Estimated time:** 45 min.
- **Git commit:** `chore(config): add queue and email provider environment variables`

---

### P2-T04 — Worker Process Startup Sequence

- **Title:** Implement the real worker startup sequence.
- **Goal:** Replace Phase 0's empty worker scaffold with the real startup sequence from spec §9.1: load/validate config, establish the Redis connection, and log a structured "worker ready" event — stopping short of registering any queue processor (that's P2-T08, once a queue exists to register against).
- **Why this task exists:** proves the worker process genuinely boots against real configuration and Redis before any queue-specific logic is layered on top, mirroring how Phase 1 separated Express bootstrap (P1-T17) from its first route (P1-T18).
- **Scope:** Included — config load, Redis connection, structured startup log. Excluded — no queue/processor registration yet.
- **Files expected:** Modify `apps/worker/src/index.js`.
- **Dependencies:** P2-T03.
- **Packages:** None beyond what's already installed (`ioredis`, from Phase 0).
- **Commands:** `pnpm --filter worker dev` (or the Docker Compose equivalent) for manual verification.
- **Verification:** Starting the worker against a valid environment produces a structured "worker ready" log line and a confirmed, live Redis connection; starting it with a broken environment fails fast per P2-T03's verification.
- **Definition of Done:** Worker process starts, connects to Redis, and logs readiness — confirmed via real log output, not just "the process didn't crash."
- **Common mistakes:** Treating "the process is still running" as equivalent to "the process is ready" — confirm the actual Redis connection is live, not just attempted, per the same fail-fast discipline established in Phase 0/1.
- **Estimated time:** 45 min.
- **Git commit:** `feat(worker): implement real startup sequence with config and Redis`

---

## Milestone 2 — BullMQ Infrastructure

_Ends with: the email queue exists with its retry/backoff policy configured, a worker can register a (structurally real, behaviorally empty) processor against it, and the shared payload schema, idempotency-key utility, and database-access functions all exist independently, ready to be composed together in Milestone 4._

### P2-T05 — Define Email Queue with Job Options (Retry & Backoff Policy)

- **Title:** Create the email queue with its configured retry/backoff policy.
- **Goal:** Define the BullMQ `Queue` instance for the email queue (spec §5.2's "one queue per job category" decision) and the default job options applied to jobs added to it — bounded max-attempt count and exponential backoff (spec §5.4) — as a shared, reusable definition.
- **Why this task exists:** every later task that enqueues (P2-T12) or processes (P2-T08 onward) a job depends on one canonical queue definition and one canonical retry policy, rather than each call site configuring its own.
- **Scope:** Included — queue instantiation, default job options (attempts, backoff strategy). Excluded — no processor registration yet (P2-T08); no actual job-adding logic yet (P2-T12).
- **Files expected:** Create `apps/api/src/jobs/email-queue.js` (or a shared location importable by both `apps/api` and `apps/worker` if the monorepo structure favors a shared queue-definition package — a call to make at implementation time based on how BullMQ's `Queue` vs. `Worker` classes are split across processes; document the choice in code comments).
- **Dependencies:** P2-T02.
- **Packages:** None beyond `bullmq` (already installed).
- **Commands:** None.
- **Verification:** A throwaway script or REPL check confirms a `Queue` instance can be created against the Compose-provided Redis and its configured default job options (max attempts, backoff type) match spec §5.4 exactly.
- **Definition of Done:** Queue definition exists, is importable, and its default job options are confirmed correct by direct inspection.
- **Common mistakes:** Using fixed-interval retry instead of exponential backoff — spec §5.4 is explicit that this is a deliberate choice, not a default to leave unconfigured.
- **Estimated time:** 45 min.
- **Git commit:** `feat(queue): define email queue with retry and backoff policy`

---

### P2-T06 — Job Payload Zod Schema

- **Title:** Define the email-job payload schema.
- **Goal:** Define the Zod schema for the job payload (`userId` + idempotency key, per spec §5.8/§10.4's minimal-reference principle) in `packages/schemas`.
- **Why this task exists:** per spec §8.2, payload validation must happen before a job enters the queue, and per the shared-schema principle already established in Phase 1, this schema is defined once and reused at both the enqueue call site (P2-T12) and, defensively, inside the worker's own processing logic (P2-T13).
- **Scope:** Included — exactly the minimal payload shape from spec §10.4. Excluded — no additional fields "just in case" — this is a deliberate minimalism the spec calls for explicitly.
- **Files expected:** Create `packages/schemas/src/jobs/email-job-payload.js`; modify `packages/schemas/src/index.js`.
- **Dependencies:** P0-T15 (packages/schemas scaffolded).
- **Packages:** None (Zod already present).
- **Commands:** None.
- **Verification:** The schema accepts a valid `{ userId, idempotencyKey }` payload and rejects a payload missing either field or carrying an unexpected extra field (confirming the minimal-shape discipline is enforced, not just documented).
- **Definition of Done:** Schema exists, exported, and independently verified against both valid and invalid example payloads.
- **Common mistakes:** Allowing extra, unvalidated fields to pass through silently (a permissive schema) instead of rejecting anything beyond the documented minimal shape — this would quietly reopen the door to the "full profile data in the payload" anti-pattern spec §10.4 explicitly rejects.
- **Estimated time:** 30 min.
- **Git commit:** `feat(schemas): add email job payload schema`

---

### P2-T07 — Idempotency Key Derivation Utility

- **Title:** Implement the deterministic idempotency-key function.
- **Goal:** Implement the function that, given a `userId` and a fixed event-type string ("welcome-email"), deterministically derives the idempotency key described in spec §5.8 — same inputs always produce the same key, different users always produce different keys.
- **Why this task exists:** this is the specific mechanism spec §5.8 identifies as protecting against both duplicate processing and duplicate enqueueing; it must exist and be independently correct before it's used at the enqueue call site (P2-T12).
- **Scope:** Included — the derivation function only. Excluded — no usage/wiring yet.
- **Files expected:** Create `apps/api/src/jobs/idempotency-key.js` (or a shared package location if reused identically by the worker for verification — likely a shared `packages/jobs`-style location is cleaner than duplicating the function in both `apps/api` and `apps/worker`; make this call at implementation time and document it).
- **Dependencies:** None beyond Phase 0/1 infrastructure.
- **Packages:** None (Node's built-in `crypto` module is sufficient for deterministic hashing — no external hashing library needed).
- **Commands:** None.
- **Verification:** Calling the function twice with the same `userId` produces an identical key both times; calling it with two different `userId` values produces two different keys — this is also the basis for P2-T25's unit test, but should be manually confirmed here first.
- **Definition of Done:** Function is pure (no side effects), deterministic, and collision-resistant across distinct users, confirmed by direct testing at this stage (formal unit tests arrive in Milestone 8, but ad hoc verification now catches obvious mistakes early).
- **Common mistakes:** Including a timestamp or random component in the derivation "for extra uniqueness" — this defeats the entire purpose of a _deterministic_ key (spec §5.8's comparison table is explicit that determinism, not randomness, is what protects against duplicate enqueueing).
- **Estimated time:** 30 min.
- **Git commit:** `feat(queue): implement deterministic idempotency key derivation`

---

### P2-T08 — Worker Processor Registration (Structural)

- **Title:** Register the email queue's processor function on the worker.
- **Goal:** Register a `Worker` instance (BullMQ's processing-side class) against the email queue defined in P2-T05, with a processor function that, at this stage, only confirms it received the job and its payload shape (validated against P2-T06's schema) — no actual send logic yet (that's P2-T14).
- **Why this task exists:** this is the structural counterpart to Phase 0's pattern of scaffolding a process boundary before filling in behavior (e.g., P0-T19/T20) — it proves the worker can actually receive jobs from the queue before any business logic is layered on top, isolating "is the plumbing connected" from "is the business logic correct."
- **Scope:** Included — processor registration, payload validation on receipt. Excluded — no idempotency check (P2-T13), no send logic (P2-T14) — the processor at this stage should log receipt and mark the job complete as a structural placeholder _only within this task's own scope_, not as a shipped Phase 2 behavior (this distinction matters: the phase is not "done" until later tasks complete it, exactly as Phase 0's `apps/realtime`/`apps/worker` scaffolds were not considered feature-complete at that phase's end either).
- **Files expected:** Modify `apps/worker/src/index.js` (register the `Worker` instance); create `apps/worker/src/processors/email-processor.js`.
- **Dependencies:** P2-T04, P2-T05, P2-T06.
- **Packages:** None beyond `bullmq` (already installed).
- **Commands:** `pnpm --filter worker dev`; a manual test enqueue (via a throwaway script or the API's not-yet-built endpoint — likely a direct queue `.add()` call in a REPL/script at this stage) to confirm receipt.
- **Verification:** Manually adding a job to the queue (via a script, not yet the real Phase 4 wiring) results in the worker's processor function being invoked, confirmed via log output; a job with a payload that fails P2-T06's schema is confirmed rejected/logged distinctly rather than silently accepted.
- **Definition of Done:** Worker receives and acknowledges jobs from the queue; payload validation is confirmed working; expected queue state after a test job: the job moves from `waiting` to `completed` in BullMQ's own state (inspectable via Redis or a throwaway script), confirming the plumbing works end-to-end at the structural level.
- **Common mistakes:** Writing "temporary" send logic into this processor to make the manual test more satisfying — resist this; the task is explicitly structural, and premature logic here creates rework risk in P2-T13/T14.
- **Estimated time:** 60 min.
- **Git commit:** `feat(worker): register email queue processor`

---

### P2-T09 — NotificationEvent Repository Functions

- **Title:** Implement data-access functions for `NotificationEvent`.
- **Goal:** Implement the functions to create a `pending`-status record (at enqueue time), update it to `sent` or `failed` (at outcome time), and read an existing record by idempotency key (spec §4.3's status-tracking lifecycle) — pure data-access functions, not yet called from anywhere.
- **Why this task exists:** both the enqueue path (P2-T12) and the worker's processing logic (P2-T13/T14) need these functions; defining them once, independently testable, avoids duplicating Prisma query logic across two processes' codebases.
- **Scope:** Included — create, update-status, and read-by-idempotency-key functions. Excluded — no wiring into the enqueue or processor logic yet.
- **Files expected:** Create `apps/api/src/notifications/notification-event-repository.js` (or a shared package location if reused identically by the worker — same cross-process sharing consideration as P2-T07; likely warrants a shared `packages/` location since both processes need identical query logic against the same table).
- **Dependencies:** P2-T01.
- **Packages:** None (Prisma already installed).
- **Commands:** None.
- **Verification:** Direct testing confirms: creating a record produces the expected `pending` row; updating it transitions status correctly; reading by idempotency key correctly finds an existing record or correctly returns nothing for a key that's never been used.
- **Definition of Done:** All three functions independently confirmed correct against a real (test) Postgres instance.
- **Common mistakes:** Building these functions to swallow or ignore a unique-constraint violation silently at this stage — that specific handling belongs in P2-T16 (Milestone 5), where it's a deliberate design decision, not an incidental side effect of how this task's basic create function happens to behave; keep this task's `create` function a straightforward insert that lets a constraint violation propagate as an error, to be handled explicitly later.
- **Estimated time:** 60 min.
- **Git commit:** `feat(notifications): implement NotificationEvent repository functions`

---

## Milestone 3 — Email Provider Integration

_Ends with: a real email can be sent through Postmark from the worker process, using a fixed welcome-email template, independent of any queue/job wiring._

### P2-T10 — Configure Email Provider Client

- **Title:** Configure the Postmark client.
- **Goal:** Instantiate the Postmark client using the API key from `packages/config`'s worker schema (P2-T03), with a minimal wrapper function for sending a single transactional email.
- **Why this task exists:** isolates provider-SDK configuration from the welcome-email-specific template/content logic (P2-T11), so a provider-connectivity problem and a template-content problem are never conflated during debugging.
- **Scope:** Included — client instantiation, a generic (not welcome-email-specific) send wrapper accepting recipient, subject, and body. Excluded — no welcome-email template content yet.
- **Files expected:** Create `apps/worker/src/email/provider-client.js`.
- **Dependencies:** P2-T02, P2-T03.
- **Packages:** None beyond `postmark` (already installed).
- **Commands:** None beyond a manual test send.
- **Verification:** A manual test send (via a throwaway script, using a real Postmark dev/sandbox API key) to a real test inbox succeeds and the email arrives; the function correctly returns the provider's message ID (needed for spec §4.5's metadata).
- **Definition of Done:** A real email demonstrably sends and arrives, confirmed by checking the actual test inbox — not just "the API call returned success."
- **Common mistakes:** Testing only against Postmark's API success response without confirming actual delivery to a real inbox — a successful API call and actual delivery are not the same guarantee, and this task's verification should confirm both.
- **Estimated time:** 45 min.
- **Git commit:** `feat(email): configure Postmark client`

---

### P2-T11 — Welcome Email Template & Send Function

- **Title:** Implement the welcome email's fixed template and send function.
- **Goal:** Implement the welcome email's content (subject, body — a fixed template, not stored per-recipient per spec §4.5) and a `sendWelcomeEmail(user)`-style function that composes the template with the recipient's data and calls P2-T10's generic send wrapper.
- **Why this task exists:** this is the last piece needed before the queue/job pipeline (Milestone 4) can actually do something real when a job is processed.
- **Scope:** Included — template content, the welcome-email-specific send function. Excluded — no queue/job wiring yet.
- **Files expected:** Create `apps/worker/src/email/templates/welcome-email.js`, `apps/worker/src/email/send-welcome-email.js`.
- **Dependencies:** P2-T10.
- **Packages:** None.
- **Commands:** None beyond a manual test send.
- **Verification:** Calling `sendWelcomeEmail` with a real test user's data results in a correctly-formatted, real email arriving in a real test inbox, with the recipient's name correctly interpolated into the template.
- **Definition of Done:** A real, correctly-personalized welcome email is confirmed delivered.
- **Common mistakes:** Storing the rendered email body anywhere (e.g., accidentally passing it into a logging call, or persisting it) — per spec §4.5/§11.2, the body is never stored or logged, only generated fresh at send time.
- **Estimated time:** 45 min.
- **Git commit:** `feat(email): implement welcome email template and send function`

---

## Milestone 4 — Welcome Email Pipeline

_Ends with: the complete, real, end-to-end pipeline works — a genuine sign-in results in a genuine welcome email, non-blockingly, exactly as spec §3.1–§3.2 describes._

### P2-T12 — Enqueue-on-Signup Wiring (Non-Blocking)

- **Title:** Wire job enqueueing into Phase 1's OAuth callback.
- **Goal:** Modify Phase 1's OAuth callback (new-user path only) to enqueue an email-queue job with the minimal payload (P2-T06's schema, using P2-T07's idempotency key and P2-T09's `create`-pending-record function), with the enqueue call explicitly wrapped so any failure (Redis unreachable, validation failure) is caught, logged, and never propagates to the sign-in response (spec §3.1, §12.1, §12.5 — this non-blocking property is built correctly here, from the start, not retrofitted later).
- **Why this task exists:** this is the actual trigger point the whole phase exists to serve — the first place Milestones 1–3's independently-built pieces are composed together with Phase 1's existing code.
- **Scope:** Included — the enqueue call, its non-blocking error handling, creation of the `pending` `NotificationEvent` record. Excluded — no worker-side processing logic yet (P2-T13/T14) — a job can be enqueued by this task and simply sit unprocessed (or be picked up by P2-T08's structural processor) until those tasks land.
- **Files expected:** Modify `apps/api/src/auth/oauth/routes.js` (or wherever Phase 1's new-user path lives) to call the enqueue function; create `apps/api/src/jobs/enqueue-welcome-email.js`.
- **Dependencies:** P2-T05, P2-T06, P2-T07, P2-T09, Phase 1 complete.
- **Packages:** None.
- **Commands:** `pnpm --filter api dev` for manual verification.
- **Verification:** A real new-user sign-in results in exactly one job appearing in the email queue (confirmed via Redis inspection or the queue's own introspection) and exactly one `pending` `NotificationEvent` row; a returning-user sign-in results in zero new jobs/records; a simulated Redis outage during sign-in (temporarily stopping the Compose Redis service) confirms the sign-in still completes successfully, with the enqueue failure logged loudly per spec §12.1.
- **Definition of Done:** All three cases above (new-user enqueue, returning-user no-op, Redis-outage non-blocking) independently confirmed — the third is the most important and must not be skipped, as it's the literal Phase 2 acceptance criterion #4.
- **Common mistakes:** Awaiting the enqueue call in a way that lets its rejection propagate up into the response-handling path unguarded — wrap it explicitly (try/catch or equivalent) at this exact call site, not somewhere further downstream where it's easy to forget.
- **Estimated time:** 75 min.
- **Git commit:** `feat(queue): enqueue welcome email job on new user sign-in`

---

### P2-T13 — Worker Processor Logic: Idempotency Check

- **Title:** Add the idempotency check to the email processor.
- **Goal:** Extend P2-T08's structural processor to, before doing anything else, check (via P2-T09's read function) whether a `NotificationEvent` with this job's idempotency key already has a `sent` status — if so, treat the job as a safe no-op completion (spec §5.8, §3.3's retry-safety scenario).
- **Why this task exists:** this is the specific mechanism that makes the crash-recovery scenario (spec §3.5) and the retry scenario (spec §3.3) safe; it must exist before P2-T14 adds the actual send call, so the send call is never reachable without first passing this check.
- **Scope:** Included — the idempotency check and early-return-if-already-sent logic. Excluded — no actual send logic yet (P2-T14).
- **Files expected:** Modify `apps/worker/src/processors/email-processor.js`.
- **Dependencies:** P2-T08, P2-T09.
- **Packages:** None.
- **Commands:** None.
- **Verification:** Manually seeding a `sent`-status `NotificationEvent` for a given idempotency key, then enqueueing a job with that same key, confirms the processor short-circuits without attempting to proceed further (verified via log output showing the no-op path was taken).
- **Definition of Done:** The check is confirmed to correctly distinguish "already sent" (short-circuit) from "not yet sent" (proceed) — the second case has nothing to proceed _to_ yet until P2-T14, so confirm this task's own boundary by checking the "proceed" path is reached and then stops gracefully (no error) at the current end of the processor.
- **Common mistakes:** Checking for the mere _existence_ of a `NotificationEvent` record instead of specifically its `sent` status — a `pending` or `failed` record for the same key should _not_ short-circuit, since the send genuinely hasn't succeeded yet in those cases; only a confirmed `sent` status is a true duplicate-prevention signal.
- **Estimated time:** 45 min.
- **Git commit:** `feat(worker): implement idempotency check in email processor`

---

### P2-T14 — Worker Processor Logic: Execute Send & Record Outcome

- **Title:** Complete the email processor: send and record outcome.
- **Goal:** Extend the processor (after P2-T13's idempotency check passes) to look up the recipient's current data from Postgres using the payload's `userId` (spec §10.4 — execution-time lookup, never data duplicated in the payload), call P2-T11's `sendWelcomeEmail` function, and update the `NotificationEvent` record to `sent` (including the provider message ID in metadata) on success, or leave it appropriately reflecting failure on error (allowing BullMQ's retry mechanism, already configured in P2-T05, to handle the retry — this task does not implement retry logic itself, only records the outcome of a single attempt).
- **Why this task exists:** this is the task that makes the pipeline actually functional end-to-end for the first time — every prior Milestone 1–4 task was necessary but insufficient on its own.
- **Scope:** Included — execution-time user lookup, the send call, outcome recording. Excluded — no custom retry logic (BullMQ's own mechanism, already configured, handles this by the processor simply throwing on failure); no terminal-failure-specific handling yet (P2-T20, Milestone 6).
- **Files expected:** Modify `apps/worker/src/processors/email-processor.js`.
- **Dependencies:** P2-T13, P2-T11, P2-T09.
- **Packages:** None.
- **Commands:** `pnpm --filter worker dev` for manual verification.
- **Verification:** A real job (enqueued via P2-T12's real sign-in flow) is confirmed to result in a real email arriving in a real test inbox, and the corresponding `NotificationEvent` record confirmed transitioned to `sent` with a message ID populated in its metadata. Expected database state: exactly one `sent` `NotificationEvent` row per test sign-in.
- **Definition of Done:** This task's verification is functionally the first real end-to-end proof of the phase's core deliverable — confirm it thoroughly, including checking the actual database row shape, not just "an email arrived."
- **Common mistakes:** Including the recipient's full profile object in the job payload as a shortcut to avoid the database lookup — this directly violates spec §10.4's minimal-reference principle, which P2-T06's payload schema was specifically designed to enforce; the lookup here is the correct, intended cost of that design.
- **Estimated time:** 60 min.
- **Git commit:** `feat(worker): implement welcome email send and outcome recording`

---

### P2-T15 — Full End-to-End Manual Verification

- **Title:** Manually verify the complete pipeline end-to-end.
- **Goal:** Perform and document a full, real, manual walkthrough: a genuine new-user sign-in through Phase 1's real OAuth flow, resulting in a genuine welcome email arriving in a genuine test inbox, with correct database state at every stage.
- **Why this task exists:** mirrors Phase 1's P1-T19 — proves the pieces built and unit-verified across Milestones 1–4 actually compose correctly together in a real, unmocked scenario, which is a distinct risk from any individual piece being correct in isolation.
- **Scope:** Included — manual, real-provider, real-database verification only. Excluded — no automated tests yet (Milestone 8); no new implementation work — if this task uncovers a defect, fix it in the task where it actually belongs, then re-run this verification, rather than patching around it here.
- **Files expected:** None (verification only) — optionally, a short internal notes doc recording the verification steps performed, for the team's record.
- **Dependencies:** P2-T12, P2-T14.
- **Packages:** None.
- **Commands:** `docker-compose up` (full local stack).
- **Verification:** This task's entire content _is_ its own verification — see Goal above. Expected logs: enqueue, receipt, idempotency-check-pass, send-success, all visible in structured log output across the two processes. Expected queue state: job in `completed` state. Expected database state: `sent` `NotificationEvent` row.
- **Definition of Done:** A real, unmocked, end-to-end pass succeeds and is confirmed at every layer (queue, database, actual email delivery).
- **Common mistakes:** Treating a partially-successful run (e.g., email arrives but the database record wasn't checked) as sufficient — verify every layer explicitly, since this task's entire value is in catching composition gaps between independently-tested pieces.
- **Estimated time:** 45 min.
- **Git commit:** `chore(queue): verify end-to-end welcome email pipeline`

---

## Milestone 5 — Idempotency

_Ends with: the idempotency guarantees from spec §5.8/§7.3 are hardened against concurrent-duplicate scenarios, not just the simple sequential case already covered in Milestone 4, and the database-level backstop is confirmed to actually work as a backstop._

### P2-T16 — Idempotency Conflict Handling (Race Conditions & DB Constraint)

- **Title:** Handle concurrent duplicate-enqueue and database-constraint conflicts gracefully.
- **Goal:** Harden P2-T09's `create`-pending-record function (and/or the enqueue path from P2-T12) to gracefully catch a unique-constraint violation on the idempotency key (spec §7.3's database-level backstop) — treating it as evidence a duplicate enqueue attempt occurred, not as an unhandled application error.
- **Why this task exists:** Milestone 4 proved the simple, sequential case works; this task proves the trickier concurrent case — two near-simultaneous enqueue attempts for the same logical event — is handled correctly, per spec §7.3's explicit reasoning for why the database constraint exists as a backstop beyond the application-level check.
- **Scope:** Included — graceful handling of the specific unique-constraint-violation error. Excluded — no changes to the idempotency-key derivation itself (already correct per P2-T07).
- **Files expected:** Modify `apps/api/src/notifications/notification-event-repository.js` (or the shared location chosen in P2-T09).
- **Dependencies:** P2-T09, P2-T12.
- **Packages:** None.
- **Commands:** None.
- **Verification:** A simulated concurrent double-enqueue (two near-simultaneous calls with the same idempotency key, via a test script) confirms exactly one `NotificationEvent` row is created and the second attempt's constraint violation is caught and handled gracefully (logged, not thrown as an unhandled error up to the caller).
- **Definition of Done:** The concurrent case is confirmed handled without an unhandled exception or a duplicate row.
- **Common mistakes:** Catching the constraint-violation error too broadly (accidentally swallowing genuinely unexpected database errors alongside the specific expected one) — catch and handle specifically the unique-constraint-violation case, letting any other database error propagate normally per Phase 1's established error-handling conventions.
- **Estimated time:** 60 min.
- **Git commit:** `feat(notifications): handle concurrent idempotency key conflicts gracefully`

---

### P2-T17 — Database-Level Idempotency Constraint Test

- **Title:** Write the automated test proving the DB-level idempotency backstop works.
- **Goal:** Write the automated test (anticipating Milestone 8, but written here alongside the feature it verifies, consistent with how Phase 1 sometimes paired implementation and test tasks closely) confirming a direct attempt to insert two `NotificationEvent` rows with the same idempotency key is rejected at the database level, independent of any application-level check.
- **Why this task exists:** this is the literal Phase 2 acceptance criterion #11 — proving the database constraint itself is a genuine backstop, not just trusting that it was declared correctly in the P2-T01 migration.
- **Scope:** Included — exactly this one test. Excluded — the broader test suite (Milestone 8).
- **Files expected:** Create `apps/api/src/notifications/notification-event-repository.test.js`.
- **Dependencies:** P2-T16.
- **Packages:** None beyond Vitest (already installed).
- **Commands:** `pnpm --filter api test`.
- **Verification:** The test passes, confirming a direct, application-logic-bypassing insert attempt (or as close to bypassing as is practical to construct in a test) still gets rejected by the database itself.
- **Definition of Done:** Test exists, passes, and specifically exercises the database constraint, not merely the application-level check (which is a different guarantee, already covered by P2-T16's own manual verification).
- **Common mistakes:** Writing a test that only exercises the application-level graceful handling from P2-T16, without actually proving the underlying database constraint is what's doing the real work — the test should be constructed so that if the migration's constraint were accidentally removed, this test would fail.
- **Estimated time:** 30 min.
- **Git commit:** `test(notifications): verify database-level idempotency constraint`

---

## Milestone 6 — Retries and Failure Recovery

_Ends with: the worker survives crashes and shutdowns gracefully, terminal job failures are distinctly visible, and the narrow edge case of "the email sent but the database write failed" is handled per spec §12.4's documented policy._

### P2-T18 — Configure Stalled-Job Detection & Lock Duration

- **Title:** Configure BullMQ's stalled-job detection settings.
- **Goal:** Explicitly configure (rather than leave at library defaults) the lock duration and stalled-job-check interval on the worker (spec §3.5's crash-recovery mechanism, §9.4), choosing values appropriate to how long a single welcome-email send realistically takes.
- **Why this task exists:** this is the literal mechanism that makes the crash-recovery scenario (P2-T29's forthcoming test) work — a job abandoned mid-processing must be recognized as stalled and requeued within a reasonable time, not left stuck indefinitely.
- **Scope:** Included — lock/stall configuration values. Excluded — no graceful-shutdown logic yet (P2-T19) — that's a complementary, distinct mechanism.
- **Files expected:** Modify `apps/worker/src/index.js` (or wherever the `Worker` instance from P2-T08 is configured).
- **Dependencies:** P2-T08.
- **Packages:** None.
- **Commands:** None.
- **Verification:** A simulated stalled job (a job artificially held past the configured lock duration, via a test harness that claims a job and then never completes it within the window) is confirmed to be picked up again by another (or the same, restarted) worker after the configured interval.
- **Definition of Done:** Stalled-job recovery confirmed working with deliberately-chosen, documented configuration values (not defaults left unexamined).
- **Common mistakes:** Leaving the lock duration at whatever BullMQ's default happens to be without considering whether it actually fits this job's expected execution time — too short a duration risks a slow-but-healthy job being incorrectly treated as stalled and duplicated (mitigated by idempotency, but still wasteful); too long delays legitimate crash recovery.
- **Estimated time:** 45 min.
- **Git commit:** `chore(worker): configure stalled-job detection and lock duration`

---

### P2-T19 — Worker Graceful Shutdown Handling

- **Title:** Implement graceful shutdown for the worker process.
- **Goal:** Implement the SIGTERM handler described in spec §9.3: stop accepting new jobs, allow any in-flight job a bounded grace period to complete, then close the Redis connection and exit cleanly.
- **Why this task exists:** reduces (though, per the idempotency design, does not need to eliminate) the frequency of jobs being abandoned mid-processing during routine deploys/restarts — the same connection-draining discipline architecture's design-review addendum establishes for the real-time process, applied here to the worker for the first time.
- **Scope:** Included — the shutdown signal handler and its grace-period logic. Excluded — no changes to the crash-scenario handling from P2-T18 (that remains the backstop for _ungraceful_ termination; this task handles the _graceful_ case).
- **Files expected:** Modify `apps/worker/src/index.js`.
- **Dependencies:** P2-T18.
- **Packages:** None.
- **Commands:** None.
- **Verification:** Sending a SIGTERM to the worker process while it's mid-job (simulated with an artificially slow test job) confirms the process waits for the job to complete (within the grace period) before exiting, and confirms no new jobs are picked up once the shutdown signal is received; sending SIGTERM with no jobs in flight confirms immediate, clean exit.
- **Definition of Done:** Both the mid-job and no-job shutdown cases are confirmed to behave correctly and distinctly.
- **Common mistakes:** Implementing a grace period with no upper bound (waiting indefinitely for a job that never completes), which would defeat the purpose of a _graceful_ shutdown by making it effectively unable to shut down at all — the grace period must be bounded, with the process forcibly exiting after it elapses even if a job hasn't finished (relying on P2-T18's stalled-job recovery to pick it back up afterward).
- **Estimated time:** 60 min.
- **Git commit:** `feat(worker): implement graceful shutdown with bounded grace period`

---

### P2-T20 — Terminal Failure Handling & Logging

- **Title:** Add distinct handling and logging for permanently-failed jobs.
- **Goal:** Register a listener (or equivalent BullMQ mechanism) for a job reaching its terminal `failed` state after exhausting all configured retry attempts (spec §3.4), logging this distinctly at `error` level, per spec §11.1's table.
- **Why this task exists:** spec §3.4 and §11.1 both call this out as a distinct signal worth operational attention, different from an ordinary, expected mid-retry failure (which is `warn`-level, already implicit in BullMQ's retry mechanism from P2-T05/T14).
- **Scope:** Included — the terminal-failure listener and its distinct log line. Excluded — no dead-letter-queue infrastructure (spec §5.7 explicitly defers this).
- **Files expected:** Modify `apps/worker/src/index.js` (or a dedicated `apps/worker/src/monitoring/failure-listener.js`).
- **Dependencies:** P2-T05, P2-T14.
- **Packages:** None.
- **Commands:** None.
- **Verification:** A job deliberately configured (in a test scenario) to always fail is confirmed to reach BullMQ's terminal failed state after exactly the configured max-attempts count, and confirmed to produce exactly one distinct `error`-level log line at that point (not one per retry attempt, which would already be logged at `warn` per the ordinary retry path).
- **Definition of Done:** Terminal failure is confirmed distinctly logged and distinguishable from an in-progress retry in the log output.
- **Common mistakes:** Confusing this listener with the ordinary per-attempt failure handling already implicit in BullMQ's retry mechanism — this task is specifically about the _final_, no-more-retries-remaining event, not every individual failed attempt along the way.
- **Estimated time:** 45 min.
- **Git commit:** `feat(worker): add distinct logging for terminal job failures`

---

### P2-T21 — NotificationEvent Write-Failure Handling

- **Title:** Handle the case where the email sends successfully but the outcome-recording write fails.
- **Goal:** Implement the specific policy from spec §12.4: if the `NotificationEvent` status-update write fails after a successful provider send, retry that specific write independently (a narrow, fast retry distinct from the job's own BullMQ retry mechanism), and if it still fails, mark the job complete anyway (since the email genuinely was sent) while logging the inconsistency loudly.
- **Why this task exists:** spec §12.4 identifies this as a genuine edge case deserving deliberate handling — without it, a Postgres hiccup immediately after a successful send could incorrectly trigger a full job retry, which (even with idempotency protecting against a literal duplicate send, per P2-T13) is wasteful and would produce a confusing, hard-to-diagnose operational picture.
- **Scope:** Included — exactly the policy described in spec §12.4. Excluded — no broader database-resilience work beyond this specific, named scenario.
- **Files expected:** Modify `apps/worker/src/processors/email-processor.js`.
- **Dependencies:** P2-T14.
- **Packages:** None.
- **Commands:** None.
- **Verification:** A simulated database failure specifically at the outcome-write step (after a successful, mocked provider send) confirms: a small number of independent retries of just that write are attempted, and if still failing, the job is marked complete (not retried by BullMQ) with a distinct, loud log entry recording the inconsistency.
- **Definition of Done:** The specific policy from spec §12.4 is confirmed implemented exactly as described, not approximated.
- **Common mistakes:** Allowing this failure to trigger the job's normal BullMQ retry (which would re-attempt the actual email send) — re-read spec §12.4 carefully; the whole point of this task is to _avoid_ a duplicate send in exactly this scenario, which a naive "just let it retry" implementation would get wrong.
- **Estimated time:** 60 min.
- **Git commit:** `feat(worker): handle NotificationEvent write failures without duplicate sends`

---

## Milestone 7 — Monitoring

_Ends with: the worker's health check genuinely reflects readiness, an interim, appropriately-gated queue-monitoring view exists for engineering visibility, and every event from spec §11.1's table is being logged consistently._

### P2-T22 — Worker Readiness/Health Check Extension

- **Title:** Extend the worker's health check to reflect real readiness.
- **Goal:** Extend Phase 0's placeholder worker health check (per spec §9.6) so readiness now means "Redis connection established AND the email queue's processor is registered" — a genuine strengthening, not a new pattern.
- **Why this task exists:** Phase 0's worker health check was explicitly a placeholder pending real logic; this task closes that gap now that real logic (P2-T04, P2-T08) exists to check against.
- **Scope:** Included — the readiness condition update. Excluded — no metrics/dashboard work (Phase 21).
- **Files expected:** Modify `apps/worker/src/health.js` (or wherever Phase 0 established the worker's health-check endpoint/mechanism).
- **Dependencies:** P2-T04, P2-T08.
- **Packages:** None.
- **Commands:** None.
- **Verification:** The health check reports not-ready before Redis connection/processor registration completes during startup, and ready afterward — confirmed by observing the check's output across the startup sequence, not just its final state.
- **Definition of Done:** Readiness genuinely reflects the two named conditions, confirmed at both the not-yet-ready and ready points in the process lifecycle.
- **Common mistakes:** Making the health check always report ready as soon as the process starts (the Phase 0 placeholder behavior) and forgetting to actually gate it on the real conditions — this defeats the entire purpose of a readiness check as distinct from a liveness check.
- **Estimated time:** 30 min.
- **Git commit:** `feat(worker): extend health check to verify Redis and processor readiness`

---

### P2-T23 — Interim Queue-Monitoring Dashboard

- **Title:** Mount the interim, access-gated queue-monitoring dashboard.
- **Goal:** Mount a BullMQ-compatible monitoring dashboard (e.g., Bull Board or equivalent), gated per spec §8.4's decision: reachable only through Phase 1's authentication middleware **and** an explicit environment flag (disabled by default, only enabled in local/staging environments).
- **Why this task exists:** this is the roadmap's explicit deliverable for job-failure visibility at this phase's stage, and spec §8.4 works through, in detail, exactly how it must be gated given no formal admin-role system exists yet — this task implements that specific, deliberate decision, not an ungated convenience tool.
- **Scope:** Included — the dashboard mount, both gating mechanisms. Excluded — no real role-based access control (explicitly Phase 18's job, per spec §8.4/§17).
- **Files expected:** Create `apps/api/src/monitoring/queue-dashboard.js` (or wherever the dashboard route is mounted — likely `apps/api`, since it needs to reuse Phase 1's auth middleware); modify route mounting in `apps/api/src/app.js`.
- **Dependencies:** P2-T05, P1-T20/T21 (Phase 1's auth middleware), P2-T03 (the environment flag).
- **Packages:** `@bull-board/express` and `@bull-board/api` (or equivalent) — a maintained, BullMQ-compatible monitoring UI, chosen over building a custom one given this is explicitly an interim/internal tool where reinventing an existing, well-supported dashboard would be wasted effort disproportionate to the tool's temporary status (spec §8.4/§17).
- **Commands:** `pnpm --filter api add @bull-board/express @bull-board/api`.
- **Verification:** With the environment flag disabled (the default), the dashboard route is confirmed unreachable (404 or equivalent) even with a valid authenticated session; with the flag enabled, an authenticated request reaches the dashboard and correctly displays real queue/job state (including a deliberately-failed test job, to confirm failure visibility); an unauthenticated request is rejected even with the flag enabled.
- **Definition of Done:** Both gating layers (auth + environment flag) independently confirmed necessary — test each one's absence separately.
- **Common mistakes:** Gating on only one of the two required conditions (e.g., auth alone, without the environment flag) — spec §8.4 requires both, specifically because auth alone doesn't distinguish "any signed-in product user" from "an engineer who should see operationally sensitive queue detail," a distinction that doesn't yet exist as a real role and is instead approximated by the environment gate.
- **Estimated time:** 75 min.
- **Git commit:** `feat(monitoring): add access-gated queue monitoring dashboard`

---

### P2-T24 — Structured Logging Pass for Job/Worker Events

- **Title:** Complete structured logging coverage for all Phase 2 events.
- **Goal:** Do a dedicated, focused pass confirming every event in spec §11.1's table (job enqueued, started, completed, failed-will-retry, failed-permanently, worker started/shutting down, monitoring-view accessed) is being logged with the correct level and shape — filling any gap left by the incremental logging added inline during Milestones 1–6.
- **Why this task exists:** mirrors Phase 1's P1-T28 — deferred to this point deliberately so real, working behavior exists to verify logging against in one focused pass, rather than trusting that each earlier task's incidental logging additions add up to full, correct coverage.
- **Scope:** Included — exactly the events in spec §11.1's table. Excluded — nothing beyond that table; no new behavior, purely observability.
- **Files expected:** Modify whichever files across `apps/api/src/jobs/**` and `apps/worker/src/**` are found, during this pass, to be missing an event or logging it at the wrong level.
- **Dependencies:** All of Milestones 1–6.
- **Packages:** None (Pino already installed).
- **Commands:** None beyond re-running the manual/automated flows from earlier tasks while inspecting log output.
- **Verification:** Triggering each event in spec §11.1's table produces a correctly-shaped, correctly-leveled structured log line; a deliberate check confirms none of spec §11.2's forbidden content (provider API key, full email body, raw unfiltered provider error payloads, indiscriminate full-payload dumps) appears anywhere in captured output — verified against real emitted log lines, not code review alone.
- **Definition of Done:** Every event in spec §11.1 confirmed present and correctly shaped; every prohibition in spec §11.2 confirmed not violated.
- **Common mistakes:** Trusting that "we probably logged this somewhere during an earlier task" without actually re-verifying — this task's entire value is in the explicit, systematic re-check against the spec's table, not in assuming prior coverage.
- **Estimated time:** 60 min.
- **Git commit:** `feat(logging): complete structured logging coverage for job and worker events`

---

## Milestone 8 — Testing

_Ends with: every test category from spec §13 exists, passes, and runs in CI alongside Phase 0/1's existing pipeline. This milestone does not add new application behavior — it proves the behavior already built is correct, including the phase's single most important guarantee (crash-safe idempotency)._

### P2-T25 — Unit Tests: Idempotency Key & Payload Schema

- **Title:** Write unit tests for idempotency-key derivation and payload validation.
- **Goal:** Write the unit tests from spec §13.1 — deterministic key derivation (same input → same key, different input → different key) and the payload schema's accept/reject behavior.
- **Why this task exists:** these are pure-function tests, independent of any HTTP/queue/database context, and were specifically designed (P2-T06, P2-T07) to be easy to test in isolation.
- **Scope:** Included — exactly the two areas named above. Excluded — anything requiring a running queue or database.
- **Files expected:** Create `apps/api/src/jobs/idempotency-key.test.js`, `packages/schemas/src/jobs/email-job-payload.test.js`.
- **Dependencies:** P2-T06, P2-T07.
- **Packages:** None (Vitest already installed).
- **Commands:** `pnpm test` (workspace-wide) or `pnpm --filter api test` / `pnpm --filter schemas test`.
- **Verification:** All new tests pass; deliberately breaking the derivation function (e.g., adding a random component) confirms the corresponding test fails, proving the test is meaningful.
- **Definition of Done:** Both areas fully covered per spec §13.1.
- **Common mistakes:** Testing only the "happy path" of key derivation without the negative case (confirming different users genuinely produce different keys, not just that the function runs without error).
- **Estimated time:** 45 min.
- **Git commit:** `test(queue): add unit tests for idempotency key and payload schema`

---

### P2-T26 — Integration Test: Enqueue-on-Signup Wiring

- **Title:** Write the integration test for the enqueue-on-signup path.
- **Goal:** Write the test from spec §13.2 extending Phase 1's OAuth integration tests: a new-user sign-in enqueues exactly one job (and creates exactly one `pending` `NotificationEvent`); a returning-user sign-in enqueues zero.
- **Why this task exists:** automates what P2-T12 and P2-T15 already manually verified, turning it into a regression-proof, repeatable check.
- **Scope:** Included — exactly the enqueue-triggering behavior. Excluded — worker-side processing (P2-T27).
- **Files expected:** Modify or extend Phase 1's `apps/api/src/auth/oauth/callback.integration.test.js` (per P1-T25), or create a new adjacent test file if that's cleaner given the added scope.
- **Dependencies:** P2-T12.
- **Packages:** None beyond what Phase 1 already installed (`nock`, `supertest`).
- **Commands:** `pnpm --filter api test`.
- **Verification:** Test passes for both the new-user and returning-user cases, confirmed against real (test) Postgres and Redis.
- **Definition of Done:** Both cases from spec §13.2 covered and passing.
- **Common mistakes:** Accidentally coupling this test too tightly to Phase 1's existing OAuth test fixtures in a way that makes it fragile to unrelated Phase 1 test changes — keep the new assertions clearly additive and independently readable.
- **Estimated time:** 45 min.
- **Git commit:** `test(queue): add integration test for enqueue-on-signup wiring`

---

### P2-T27 — Integration Test: Worker End-to-End Processing (Mocked Provider)

- **Title:** Write the integration test for worker job processing.
- **Goal:** Write the test from spec §13.2 confirming the worker processes a job end-to-end against a mocked email-provider API (never a real provider call in automated tests), confirming the `NotificationEvent` transitions from `pending` to `sent` correctly.
- **Why this task exists:** automates what P2-T14/T15 manually verified against the real provider — the automated version must mock the provider specifically so CI never depends on real Postmark credentials or network access.
- **Scope:** Included — worker processing, mocked provider. Excluded — enqueue-side behavior (already covered by P2-T26).
- **Files expected:** Create `apps/worker/src/processors/email-processor.integration.test.js`.
- **Dependencies:** P2-T14.
- **Packages:** `nock` (reused from Phase 1's pattern, now scoped to `apps/worker` — confirm it's added to that app's devDependencies if not already).
- **Commands:** `pnpm --filter worker add -D nock` (if not already present), then `pnpm --filter worker test`.
- **Verification:** Test passes fully offline (no real Postmark network calls), confirming the complete `pending` → `sent` transition with correct metadata.
- **Definition of Done:** Test covers the full processing path and is confirmed CI-safe (no real external dependency).
- **Common mistakes:** Accidentally leaving a test dependent on real Postmark credentials — verify the mock is genuinely intercepting the call, not just coincidentally working because real credentials happen to be present in the local dev environment.
- **Estimated time:** 60 min.
- **Git commit:** `test(worker): add integration test for email processor`

---

### P2-T28 — Worker Lifecycle Tests: Startup/Readiness & Graceful Shutdown

- **Title:** Write tests for worker startup, readiness, and shutdown behavior.
- **Goal:** Write the tests from spec §13.3 — the worker correctly reports not-ready before Redis/registration completes and ready afterward; graceful shutdown allows an in-flight job to complete within its grace period.
- **Why this task exists:** automates what P2-T04, P2-T19, and P2-T22 each manually verified individually.
- **Scope:** Included — exactly the two lifecycle areas named above. Excluded — the stalled-job-recovery case, which is covered separately in P2-T29 given its distinct (crash, not graceful-shutdown) nature.
- **Files expected:** Create `apps/worker/src/lifecycle.test.js`.
- **Dependencies:** P2-T19, P2-T22.
- **Packages:** None beyond what's already installed.
- **Commands:** `pnpm --filter worker test`.
- **Verification:** Both tests pass, confirmed against real (test) Redis, not a mocked connection (the readiness check's correctness depends on genuine connection state).
- **Definition of Done:** Both lifecycle areas covered per spec §13.3.
- **Common mistakes:** Mocking the Redis connection in this specific test in a way that makes the readiness check trivially always pass — this test's value depends on exercising a real connection lifecycle.
- **Estimated time:** 45 min.
- **Git commit:** `test(worker): add lifecycle tests for startup and graceful shutdown`

---

### P2-T29 — Crash-Recovery Test: Kill Worker Mid-Job

- **Title:** Write the crash-recovery test — the phase's literal Definition of Done.
- **Goal:** Write the test from spec §13.4 that is explicitly named as "the literal Phase 2 Definition of Done from the roadmap": kill the worker process mid-job-execution (simulated) and restart it, confirming the job completes exactly once, with no duplicate email sent and no lost job.
- **Why this task exists:** this is the single most important test in the entire phase — it's the concrete proof that the idempotency design (P2-T07, T13, T16), the stalled-job configuration (P2-T18), and the outcome-recording logic (P2-T14) all genuinely compose to deliver the phase's core reliability guarantee.
- **Scope:** Included — exactly this scenario. Excluded — nothing; this test should not be diluted by combining it with unrelated assertions.
- **Files expected:** Create `apps/worker/src/crash-recovery.integration.test.js`.
- **Dependencies:** P2-T18, P2-T13, P2-T14, P2-T27.
- **Packages:** None beyond what's already installed.
- **Commands:** `pnpm --filter worker test`.
- **Verification:** The test simulates a worker process being killed after claiming a job but before completing it (e.g., by forcibly terminating the worker mid-processing in a controlled test harness), then starts a new worker instance and confirms: the job is picked up again (via stalled-job recovery, P2-T18), the idempotency check (P2-T13) correctly determines whether the original attempt had actually completed the send or not, and exactly one real send occurs regardless of exactly when the kill happened relative to the actual provider call.
- **Definition of Done:** This test passes reliably (not flakily) and is confirmed to actually exercise a genuine process-kill scenario, not a simulated approximation that doesn't really test the crash path.
- **Common mistakes:** Building a "crash simulation" that's actually just a clean function return disguised as a crash (e.g., throwing a caught exception instead of genuinely terminating the process/connection) — this would not exercise the real stalled-job/lock-timeout mechanism at all, and the test would give false confidence; the simulation needs to genuinely abandon the job the way a real crash would.
- **Estimated time:** 90 min.
- **Git commit:** `test(worker): add crash-recovery test for idempotent job processing`

---

### P2-T30 — Failure & Retry Tests: Backoff and Exhaustion

- **Title:** Write tests for retry backoff timing and exhaustion.
- **Goal:** Write the tests from spec §13.4/§13.5: a simulated transient provider failure triggers BullMQ's configured retry/backoff; the maximum-attempts count is enforced exactly; backoff timing is confirmed exponential, not fixed-interval.
- **Why this task exists:** proves P2-T05's retry configuration and P2-T20's terminal-failure handling behave exactly as designed, under simulated failure conditions rather than just the happy path already covered elsewhere.
- **Scope:** Included — retry triggering, exhaustion enforcement, backoff-shape confirmation. Excluded — the crash-specific scenario (already covered distinctly in P2-T29).
- **Files expected:** Create `apps/worker/src/retry-behavior.test.js`.
- **Dependencies:** P2-T05, P2-T20.
- **Packages:** `nock` (for simulating provider failure responses).
- **Commands:** `pnpm --filter worker test`.
- **Verification:** A job configured to always fail (mocked provider always returns an error) is confirmed to fail exactly the configured number of times before reaching the terminal state; observed delay between attempts is confirmed to grow (exponential), allowing reasonable variance for test-environment timing jitter rather than asserting exact millisecond values.
- **Definition of Done:** Both retry-triggering and exhaustion-enforcement confirmed; backoff shape confirmed exponential.
- **Common mistakes:** Asserting exact timing values instead of a shape/relative-growth pattern, which makes the test flaky under normal CI timing variance — assert that each delay is meaningfully larger than the last, not a precise millisecond figure.
- **Estimated time:** 60 min.
- **Git commit:** `test(worker): verify retry backoff and exhaustion behavior`

---

### P2-T31 — Non-Blocking Sign-In Test: Simulated Redis/Provider Outage

- **Title:** Write the test proving sign-in is never blocked by job/email failures.
- **Goal:** Write the test corresponding to Phase 2 acceptance criterion #4: simulate a Redis outage (enqueue fails) and separately a provider outage (send fails, after enqueue succeeds) during a sign-in flow, confirming sign-in succeeds in both cases.
- **Why this task exists:** this is the automated proof of the single most-repeated design principle across the entire spec (§3.1, §12.1, §12.5, §17) — that job infrastructure failures must never propagate to the user-facing action that triggered them. It deserves its own explicit, dedicated test, not incidental coverage inside another test.
- **Scope:** Included — exactly the two outage scenarios named above, both confirming sign-in success. Excluded — the actual retry/recovery behavior of the job itself once the outage clears (covered elsewhere).
- **Files expected:** Create `apps/api/src/auth/oauth/enqueue-failure-isolation.test.js`.
- **Dependencies:** P2-T12.
- **Packages:** None beyond what's already installed.
- **Commands:** `pnpm --filter api test`.
- **Verification:** Both simulated-outage scenarios confirm a successful sign-in response, with the underlying enqueue/send failure confirmed logged (per §11.1's expectations) but confirmed **not** to affect the HTTP response the user receives.
- **Definition of Done:** Both scenarios pass, and the test explicitly asserts on the sign-in response's success, not just on the absence of a crash.
- **Common mistakes:** Writing a test that only confirms "the request didn't throw an unhandled exception" without explicitly asserting the sign-in response is a genuine success (correct status code, correct session issued) — the stronger assertion is what actually proves the acceptance criterion.
- **Estimated time:** 45 min.
- **Git commit:** `test(auth): verify sign-in is unaffected by job enqueue or send failures`

---

### P2-T32 — Log-Content Security Test

- **Title:** Write the automated test confirming no secrets or excess PII appear in logs.
- **Goal:** Write a test (or a small suite) that runs representative flows (enqueue, processing, failure) while capturing real log output, and asserts none of spec §11.2's forbidden content (provider API key, full email body, raw unfiltered provider errors, full-payload dumps) appears anywhere in it.
- **Why this task exists:** this is the automated counterpart to P2-T24's manual pass — turning a one-time manual check into a regression-proof, repeatable one, matching the rigor Phase 1 applied to its own equivalent logging-security requirement.
- **Scope:** Included — exactly the content prohibitions from spec §11.2. Excluded — general log-format testing (not a security concern, out of scope here).
- **Files expected:** Create `apps/worker/src/logging-security.test.js` (and/or an `apps/api`-side equivalent if enqueue-side logging also needs coverage).
- **Dependencies:** P2-T24.
- **Packages:** None beyond what's already installed (capturing Pino output in a test context may need a simple log-capture utility, but no new external package should be required beyond Pino's own testing-friendly stream support).
- **Commands:** `pnpm --filter worker test`, `pnpm --filter api test`.
- **Verification:** Test passes, confirmed to actually inspect real captured log content (not just check that logging calls were made) for the presence of known-forbidden patterns (e.g., the literal test Postmark API key value, a sample email body string).
- **Definition of Done:** Test genuinely inspects log content and would fail if a forbidden value were accidentally logged.
- **Common mistakes:** Writing a test that checks logging _calls_ were made with certain arguments in a mocked logger, without ever inspecting genuine serialized output — Phase 1's equivalent guidance applies identically here: verify against real captured output, since Pino's redaction and this phase's own logging discipline both need to be proven together, not assumed from unit-level mocking alone.
- **Estimated time:** 45 min.
- **Git commit:** `test(logging): verify no sensitive content appears in job and worker logs`

---

## Milestone 9 — Documentation and Cleanup

_Ends with: Phase 2 is fully documented, every acceptance criterion is explicitly re-verified, and the codebase is left exactly as clean as the roadmap's working agreement requires before Phase 3 planning begins._

### P2-T33 — Environment & Config Contract Finalization

- **Title:** Final cross-check of Phase 2's environment variable contract.
- **Goal:** Confirm every environment variable introduced across this phase (P2-T03's additions) is correctly present in both `packages/config`'s schemas and root `.env.example`, and that Phase 0's CI env-contract check passes cleanly against this phase's additions.
- **Why this task exists:** mirrors Phase 1's P1-T29 — individual tasks added variables incrementally; this is the dedicated closing check that nothing drifted.
- **Scope:** Included — cross-checking, not adding new variables. Excluded — new design work (any gap found should be a small fix).
- **Files expected:** Modify `packages/config/src/*-config.js` and root `.env.example` only if a discrepancy is found.
- **Dependencies:** P2-T03, P2-T23.
- **Packages:** None.
- **Commands:** CI's existing env-contract check, run locally if possible.
- **Verification:** Phase 0's CI env-contract check step passes with zero discrepancies.
- **Definition of Done:** Clean CI run on the env-contract check.
- **Common mistakes:** Treating this as unnecessary since earlier tasks already added the variables — incremental additions across multiple tasks are exactly where small drifts accumulate unnoticed, per the identical reasoning in Phase 1's equivalent task.
- **Estimated time:** 30 min.
- **Git commit:** `chore(config): finalize environment variable contract for Phase 2`

---

### P2-T34 — ADRs: Email Provider Selection & Queue-Per-Category Convention

- **Title:** Write ADRs for Phase 2's major decisions.
- **Goal:** Write the Architecture Decision Records for the two most significant new decisions this phase introduced: Postmark as the email provider (spec §5.1/§11–17 reasoning) and the "one queue per job category" convention (spec §5.2) that every future job-adding phase will inherit.
- **Why this task exists:** per Phase 0's documentation standard (that spec §23), every significant decision gets an ADR — these two decisions are the ones this phase actually introduced (as opposed to inheriting from already-frozen documents), and are the ones most likely to be questioned or need context by a future engineer.
- **Scope:** Included — exactly these two ADRs. Excluded — no re-documentation of already-frozen architecture decisions (BullMQ itself, Redis, etc. — those ADRs, if desired, belong to whichever phase first genuinely decided them, which for BullMQ was the original architecture document, not this phase).
- **Files expected:** Create `docs/adr/0007-email-provider-selection.md`, `docs/adr/0008-queue-per-category-convention.md`.
- **Dependencies:** All of Milestones 1–8.
- **Packages:** None.
- **Commands:** None.
- **Verification:** Each ADR correctly captures the _why_, including the alternatives considered and rejected (per spec §5.1's comparison table and §5.2's comparison table) — not merely a restatement of what was built.
- **Definition of Done:** Both ADRs exist and accurately reflect the reasoning already recorded in the frozen spec.
- **Common mistakes:** Writing the ADR as a description of the implementation rather than the decision reasoning — per Phase 1's equivalent task's guidance, this is a common and easy mistake to make under time pressure.
- **Estimated time:** 45 min.
- **Git commit:** `docs(queue): add ADRs for email provider and queue convention decisions`

---

### P2-T35 — Documentation Update (Worker README, Local Email-Testing Setup)

- **Title:** Update setup documentation for local email/queue development.
- **Goal:** Update `apps/worker/README.md` with setup notes for local development (how to obtain a Postmark sandbox/test API key, how to verify the local worker is processing jobs), and update the root `README.md` if Phase 0's local setup steps need any Phase-2-specific addition.
- **Why this task exists:** mirrors Phase 1's P1-T30 — every setup-affecting phase gets its README updated so a new teammate can reach a fully working local stack without undocumented steps.
- **Scope:** Included — exactly the documents named above. Excluded — no changes to frozen architecture/roadmap/spec documents.
- **Files expected:** Modify `apps/worker/README.md`, root `README.md`.
- **Dependencies:** All of Milestones 1–8.
- **Packages:** None.
- **Commands:** None.
- **Verification:** A teammate unfamiliar with this phase's implementation can follow the updated README to obtain their own Postmark sandbox credentials and confirm local welcome-email delivery works, with no undocumented steps — the same bar established in Phase 0's T30 and Phase 1's T30.
- **Definition of Done:** READMEs updated and verified by a teammate performing the setup from scratch.
- **Common mistakes:** Assuming the Phase 1 README update already covers "how to test the full flow locally" — Phase 2 adds a genuinely new local-setup dependency (a Postmark sandbox account) that didn't exist before and needs its own explicit documentation.
- **Estimated time:** 30 min.
- **Git commit:** `docs(worker): update setup documentation for local queue and email testing`

---

### P2-T36 — Full Acceptance Criteria Verification Pass

- **Title:** Perform the closing acceptance-criteria verification for Phase 2.
- **Goal:** Systematically re-verify every item in Phase 2 spec §14's acceptance criteria list against the actual, final state of the implementation.
- **Why this task exists:** mirrors Phase 0's T30 and Phase 1's P1-T31 — the closing gate for the entire phase, catching composition/integration gaps that no single earlier task was responsible for catching on its own.
- **Scope:** Included — the 11 acceptance criteria in spec §14, checked one by one. Excluded — no new implementation work; any gap found here becomes a small follow-up task, not a silent patch within this task.
- **Files expected:** None (verification only) — optionally, `docs/phase-specs/phase-2-acceptance-verification.md` recording the results.
- **Dependencies:** All prior Phase 2 tasks (P2-T01 through P2-T35).
- **Packages:** None.
- **Commands:** `pnpm test` (full workspace suite), `docker-compose up` (full local stack), plus manual sign-in verification against the real Postmark sandbox.
- **Verification:** Each of spec §14's 11 criteria is checked off individually against real, observed behavior.
- **Definition of Done:** All 11 acceptance criteria confirmed met; any criterion that fails this final pass blocks Phase 2 from being considered complete and generates a follow-up task before Phase 3 planning begins.
- **Common mistakes:** Treating this as a formality since every earlier task already verified its own piece — per the identical reasoning in Phase 1's equivalent closing task, composition failures are exactly what individual task verification doesn't catch.
- **Estimated time:** 60 min.
- **Git commit:** `chore(queue): complete Phase 2 acceptance criteria verification`

---

## Milestone Summary

| Milestone                        | Tasks   | Ends With                                                                                                            |
| -------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------- |
| 1 — Worker Foundation            | T01–T04 | Database and worker process foundation in place; no queue logic yet                                                  |
| 2 — BullMQ Infrastructure        | T05–T09 | Queue, schema, idempotency utility, structural processor, and data-access functions all exist independently          |
| 3 — Email Provider Integration   | T10–T11 | A real welcome email can be sent through Postmark, independent of any queue wiring                                   |
| 4 — Welcome Email Pipeline       | T12–T15 | The complete, real, end-to-end pipeline works: sign-in → non-blocking enqueue → processing → real email delivered    |
| 5 — Idempotency                  | T16–T17 | Concurrent-duplicate and database-constraint edge cases are hardened and proven                                      |
| 6 — Retries and Failure Recovery | T18–T21 | Crash recovery, graceful shutdown, terminal-failure visibility, and the write-failure edge case are all handled      |
| 7 — Monitoring                   | T22–T24 | Real worker readiness, an appropriately-gated monitoring dashboard, and complete logging coverage                    |
| 8 — Testing                      | T25–T32 | Every test category from the spec exists, passes, and runs in CI — including the phase's core crash-safety guarantee |
| 9 — Documentation and Cleanup    | T33–T36 | ADRs, setup docs, and a final acceptance-criteria pass close out the phase                                           |

**Working agreement reminder:** no task in this breakdown begins before its listed dependencies are merged; no task reaches into Phase 3's concerns (no profile work anywhere in this breakdown, per the frozen roadmap's actual Phase 2 scope); Phase 3 planning does not begin until P2-T36 confirms every acceptance criterion is met.
