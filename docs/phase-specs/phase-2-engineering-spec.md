# Phase 2 Engineering Specification — Background Jobs & Email Infrastructure

**Status:** Draft for senior engineering review — implementation begins only after sign-off
**Source of truth this spec implements against:** `collaborative-workspace-architecture-blueprint.md` (frozen), `implementation-roadmap.md` (frozen — this phase is defined there as "Background Jobs & Email Infrastructure," not a user-profile phase; see the note at the top of the conversation for why this spec follows that title), `phase-0-development-foundation-spec.md` (frozen, implemented), `phase-1-engineering-spec.md` (frozen, implemented)
**Rule in effect:** the architecture is not revisited in this document except where implementation planning surfaces a genuine conflict — none was found. This spec operates entirely within already-frozen decisions, including the frozen roadmap's own phase boundaries. Note on scope: user profile viewing/editing remains Phase 3's job, per the roadmap; nothing in this document builds profile-editing functionality.

---

## 1. Goals

This phase makes background job execution real for the first time: a genuine, running BullMQ worker process, a real transactional email provider integration, and one real end-to-end job — a welcome email sent asynchronously when a user completes their first sign-in (the Phase 1 OAuth flow).

**Why this phase exists as its own isolated unit, before any profile, workspace, or document feature:** the roadmap identifies five later phases that all need job infrastructure — invitations (Phase 5), thumbnailing (Phase 9), snapshot compaction (Phase 11), mentions/notifications (Phase 14/16), and exports/imports (Phase 19). Building and proving that infrastructure now, against one real, non-placeholder job, means every one of those later phases adds a job to already-trusted plumbing instead of each independently re-deciding how jobs, retries, idempotency, and worker deployment work. Proving the infrastructure against a real job — not a synthetic "ping" job — is what makes this phase's completion a meaningful guarantee rather than an untested scaffold.

**How this phase prepares future phases, concretely:**

- The queue/worker deployment pattern (its own containerized process, per architecture §5/§19's process-separation principle, already scaffolded in Phase 0) becomes real and load-bearing here — later phases extend it, they don't redesign it.
- The idempotency-key convention and the minimal-payload-reference principle (§5.8, §10.4) established here are the pattern every later job type inherits.
- The interim queue-monitoring/visibility approach built here (§8.4) is explicitly a placeholder for Phase 18's proper admin panel — this phase does not attempt to build Phase 18's work early, but it does establish the queue-observability habit Phase 18 will formalize.
- The `EmailLog`/notification-event entity introduced here (§4) is deliberately shaped so Phase 16's planned consolidation into a unified `Notification` model (per the roadmap's own explicit note) is additive, not a rewrite.

## 2. Scope

### 2.1 In Scope

- BullMQ queue and worker infrastructure, connected to Redis, running as its own process (`apps/worker`, scaffolded empty in Phase 0, made real here).
- A real transactional email provider integration (not a console-log stub).
- One real, working job: "send welcome email on first sign-in," enqueued by Phase 1's OAuth callback on the new-user path only, executed asynchronously by the worker.
- Retry/backoff behavior (BullMQ's built-in mechanism, configured deliberately, not left at unconsidered defaults), and basic failed-job visibility.
- The idempotency and minimal-payload-reference conventions that all future job types will follow.
- A durable, queryable record that a notification-worthy event occurred and its outcome (the `EmailLog`-shaped entity, §4) — for support/debugging visibility, distinct from BullMQ's own internal job state.
- An interim, narrowly-scoped queue-monitoring view for engineering visibility into job/failure state, gated appropriately given no formal admin-role system exists yet (§8.4).

### 2.2 Out of Scope

- Any user profile viewing/editing functionality — explicitly Phase 3, per the frozen roadmap. This phase does not touch profile data beyond reading the `userId` and email address already established by Phase 1's `User`/`Identity` model, purely to address the welcome email.
- Any workspace, document, editor, WebSocket, or collaboration feature.
- Any additional job types beyond the one welcome-email job — invitations, thumbnailing, compaction, notifications, and exports each arrive with their own later phase, adding to this phase's infrastructure rather than being built ahead of schedule here.
- Any formal admin-role or permission model — that begins at Phase 5 (workspace roles) and Phase 18 (admin panel specifically). The interim dashboard-access gate in §8.4 is deliberately temporary and coarse, not a preview of that future system.
- A generalized, multi-channel notification system (in-app + email unified) — that is explicitly Phase 16's job, per the roadmap's own plan to consolidate this phase's event-emission pattern later. This phase emits one channel (email) for one event (welcome).
- Full, application-wide rate limiting — remains Phase 20's job; this phase's job-enqueueing surface is narrow enough (only Phase 1's OAuth callback triggers it) that it doesn't need its own new rate-limiting mechanism, discussed further in §10.3.

## 3. User Flows

These flows describe system behavior, not end-user-facing UI — this phase has no frontend surface (§2.2, and see architecture's Phase 2 roadmap entry: "Frontend work: none").

### 3.1 New User Signs In → Welcome Email Enqueued

```
User completes first-time sign-in (Phase 1 OAuth flow, new-user path)
  → Phase 1's callback handler determines this is a new User (not returning)
  → Callback handler enqueues a "welcome-email" job onto the email queue,
    with a payload containing only { userId, idempotencyKey } — no duplicated
    profile data (§10.4)
  → Enqueue call returns immediately; the callback handler proceeds to issue
    the session and complete the sign-in response WITHOUT waiting on the job
  → (User is now signed in; the email send happens entirely out-of-band)
```

**Critical property, stated explicitly because it is the whole point of this phase's existence:** the sign-in response never blocks on, and never fails because of, anything that happens after this point. See §12.5 for the corresponding error-handling requirement.

### 3.2 Worker Picks Up and Executes the Job (Happy Path)

```
Worker process (already running, subscribed to the email queue) receives the job
  → Worker looks up the minimal user record (email, display name) from Postgres
    using the payload's userId — this lookup happens at execution time, not
    at enqueue time (§10.4)
  → Worker checks the idempotency key against prior execution records (§5.8)
    — not yet processed, proceeds
  → Worker calls the email provider's API to send the welcome email
  → On success: worker records the outcome in the EmailLog-shaped table (§4)
    and marks the BullMQ job complete
```

### 3.3 Job Failure and Automatic Retry

```
Worker attempts the provider API call → provider returns a transient error
  (timeout, 5xx, rate-limited)
  → BullMQ marks the job attempt failed and schedules a retry per the
    configured backoff policy (§5.4)
  → On the retry attempt, the SAME idempotency key is checked again — if the
    original attempt's provider call had actually succeeded despite an
    ambiguous/timed-out response, the idempotency check prevents a duplicate
    send (§5.8)
  → If the retry succeeds, proceeds as in §3.2
```

### 3.4 Retry Exhaustion

```
All configured retry attempts (§5.4) fail
  → BullMQ moves the job to a terminal "failed" state
  → This is logged distinctly (warn/error level, §11.1) as a signal that may
    warrant manual attention — a permanently-failed welcome email is low
    severity on its own, but a rising rate of these is an operational signal
    worth surfacing
  → The job remains inspectable in the interim queue-monitoring view (§8.4)
```

### 3.5 Worker Crash Mid-Job

```
Worker process is processing a job (has claimed it, has not yet reported
  completion) when the process crashes or is forcibly killed
  → BullMQ's stalled-job detection (a lock/heartbeat mechanism on in-progress
    jobs) recognizes the job as abandoned after a timeout
  → The job is automatically requeued for another worker (or the same worker,
    once restarted) to pick up
  → Because the job's idempotency key is unchanged, and the actual email send
    is checked against prior successful sends before executing (§5.8), the
    requeued execution is safe even if the original attempt had, in fact,
    already succeeded before the crash — this is the exact scenario the
    idempotency design exists to make safe, and is a specific, required test
    case (§13.4)
```

## 4. Job & Notification Domain Model

_(This section replaces "User Profile Architecture" from the original section template — per the frozen roadmap, this phase does not build profile functionality. See the note at the top of this document.)_

### 4.1 The Entity: A Durable Notification-Event Record

This phase introduces one new durable entity — referred to here generically as the notification-event record (its concrete name is a Phase 2 task-breakdown-level decision, not fixed by this spec, though `NotificationEvent` or `EmailLog` are both reasonable) — representing "a notification-worthy event occurred, targeting this user, via this channel, with this outcome."

**Relationship to `User` (Phase 1):** each record references exactly one `User.id` as its recipient — no new relationship complexity is introduced; this is a straightforward foreign key onto an entity Phase 1 already established and froze.

### 4.2 Why a Durable Record Exists Separately From BullMQ's Own Job State

BullMQ already tracks job state (queued, active, completed, failed) internally in Redis. A reasonable question is whether a separate, durable, Postgres-side record is needed at all.

| Approach                                          | Pros                                                                                                                                                                   | Cons                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Rely solely on BullMQ's internal job state**    | No new schema, no new writes                                                                                                                                           | BullMQ's job records are not designed for long-term, queryable, cross-referenced storage — they're operational state for the queue system itself, not a durable business record. A support engineer asking "did user X ever receive their welcome email" has no good way to answer this reliably once a job ages out of BullMQ's retention (BullMQ jobs are typically pruned after completion to keep Redis memory bounded, per architecture §8's Redis-is-disposable-cache principle) |
| **A durable Postgres record, written on outcome** | Answers exactly the "did this actually happen" question durably, independent of Redis/BullMQ's retention policy; queryable via normal application data-access patterns | One additional table and one additional write per job — a small, justified cost given the entity's minimal shape                                                                                                                                                                                                                                                                                                                                                                       |
| **Selected: durable Postgres record**             | —                                                                                                                                                                      | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

### 4.3 Lifecycle: Status Tracking, Not Write-Only-on-Outcome

| Approach                                                                                                  | Pros                                                                                                                                                                                                                    | Cons                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Write the record only once, on final outcome (sent or permanently failed)**                             | Simpler — one write per job                                                                                                                                                                                             | Gives no visibility into "a job was enqueued but something is stuck/missing" — if a job is lost or never reaches a worker for some reason, there's no record it was ever supposed to happen at all |
| **Create the record at enqueue time with a `pending` status, update it to `sent` or `failed` on outcome** | Provides real visibility into the full lifecycle, including the specific, valuable case of "this was supposed to happen and doesn't appear to have completed" — directly useful for the crash-recovery scenario in §3.5 | Two writes instead of one — a small, justified cost                                                                                                                                                |
| **Selected: status-tracking record, created at enqueue time**                                             | —                                                                                                                                                                                                                       | —                                                                                                                                                                                                  |

### 4.4 Shape Principle: Notification-Domain-Generic, Not Email-Specific

Per this document's Goals section, Phase 16 will later generalize this pattern into a unified, multi-channel `Notification` model. This phase's record is deliberately shaped to make that future generalization **additive**, not a rewrite: generic fields (`type`, `recipientUserId`, `status`, a structured `metadata` payload) rather than deeply email-specific columns (no dedicated "subject line" or "email body" columns, for instance — that detail belongs in the metadata payload or is reconstructed from the job type + template, not baked into the table's core shape). This is a direct, deliberate application of architecture §7.5's normalization philosophy — model the durable shape around what's genuinely core (an event happened, to whom, with what outcome) and keep channel-specific detail out of the entity's spine.

### 4.5 Metadata Considerations

Fields worth including in the structured metadata: the provider's message ID (for cross-referencing with the provider's own delivery/bounce webhooks, if such integration is ever added later — not built in this phase, but a message ID costs nothing to record now and is expensive to reconstruct retroactively if needed later), timestamps for each status transition. **Explicitly not included:** the actual email body content — this phase's welcome email content is generated from a fixed template at send time, not stored per-recipient, avoiding an unnecessary and growing store of message content that provides no real future value.

### 4.6 Future Compatibility

No schema changes to `User` (Phase 1) are needed to support this entity — it's purely additive, a new table with a foreign key. When Phase 5 (workspace invitations) needs its own notification-worthy event, and Phase 14/16 need theirs, they extend this same entity's `type` enum and `metadata` shape rather than each phase introducing its own parallel tracking table — this is the direct payoff of §4.4's genericity decision.

## 5. Background Job Architecture

### 5.1 Why BullMQ (Restated Briefly — Already Frozen)

Architecture §3.3 already selected BullMQ over alternatives (Bee-Queue, Agenda) specifically because it's Redis-backed (sharing infrastructure this system already needs for sessions, per Phase 1), has mature retry/backoff primitives, and has first-class delayed-job support. This phase does not revisit that decision — it implements it for the first time against a real job.

### 5.2 Queue Lifecycle

A queue is a named, durable (Redis-backed) channel that jobs are added to and workers consume from. This phase establishes exactly one queue (an email/notification queue) — the convention for adding future queues (one per distinct job _category_, e.g., a future "search-indexing" queue in Phase 8, a future "compaction" queue in Phase 11) versus using a single generic queue differentiated by job `type` is worth deciding explicitly now, since every later phase inherits whichever convention is set here.

| Approach                                                                                                    | Pros                                                                                                                                                                                                                                                                                             | Cons                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **One queue per job category** (email queue, future indexing queue, future compaction queue, each separate) | Each queue can have its own concurrency/priority/retry configuration tuned to that job type's actual characteristics (a CPU-heavy compaction job has very different tuning needs than a lightweight email send); failures/backlogs in one queue are naturally isolated from others in monitoring | More queues to configure and monitor as the system grows                                                                                                                                                                                                                                                                                      |
| **One generic queue, jobs differentiated by a `type` field**                                                | Fewer queues to manage nominally                                                                                                                                                                                                                                                                 | Forces all job types to share one concurrency/retry configuration unless the worker adds its own internal dispatch-and-override logic, which reintroduces most of the complexity multiple queues would have handled natively; monitoring "how backed up is compaction specifically" becomes a filtered query instead of a direct queue metric |
| **Selected: one queue per job category**                                                                    | —                                                                                                                                                                                                                                                                                                | —                                                                                                                                                                                                                                                                                                                                             |

This phase establishes the "email" queue as the first instance of this pattern — later phases add their own queues rather than overloading this one.

### 5.3 Worker Lifecycle

Covered in detail in §9 (Worker Architecture) — summarized here: the worker process starts, connects to Redis, registers a processor function for the email queue, and begins consuming jobs, running until a graceful shutdown signal is received.

### 5.4 Retry Strategy

BullMQ's built-in retry mechanism is used, configured explicitly (not left at library defaults) with: a bounded maximum attempt count (a small number, appropriate for a job whose failure mode is almost always a transient provider issue, not a data problem retries would fix indefinitely — three to five attempts is a reasonable starting point, to be finalized at the task-breakdown/implementation level, not hardcoded by this spec) and **exponential backoff between attempts** (not fixed-interval retries — exponential backoff gives a struggling provider more room to recover between attempts rather than hammering it at a constant rate, consistent with the jitter/backoff reasoning already established in Phase 0/1 for connection retries).

### 5.5 Delayed Jobs

BullMQ natively supports delaying a job's first execution. This phase's welcome email does not require a meaningful delay (immediate-to-near-immediate execution is the intended product behavior), but the mechanism is proven here as a side effect of using BullMQ correctly, since later phases depend on it directly and substantially — most notably Phase 11's debounced snapshot-compaction job, which is fundamentally a delayed-job pattern (schedule N seconds out, reschedule if a newer edit arrives before it fires). This phase does not implement compaction's debounce logic, but confirms the underlying delayed-job mechanism works correctly as part of this phase's own testing (§13), so Phase 11 inherits a proven primitive.

### 5.6 Scheduled (Repeatable) Jobs

Not used in this phase (no cron-style recurring job exists yet — the roadmap's first repeatable job is Phase 6's document cleanup, and later Phase 4's workspace soft-delete cleanup). Not built ahead of schedule here, per §2.2's scope discipline, but BullMQ's support for this pattern is confirmed available (a configuration option, not new infrastructure) for whichever phase needs it first.

### 5.7 Dead-Letter Handling

| Approach                                                                                           | Pros                                                                                                                                                                  | Cons                                                                                                                                       |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **A separate, dedicated dead-letter queue** that permanently-failed jobs are explicitly moved into | Clean separation between "queue of pending work" and "queue of things that need human attention"; supports more sophisticated dead-letter-specific tooling later      | Additional infrastructure and code to build and maintain, for a job-failure volume that, at this phase's stage, is expected to be very low |
| **BullMQ's native "failed" job state**, inspected via the interim monitoring view (§8.4)           | No additional infrastructure — this is what BullMQ already provides out of the box; sufficient given current job diversity (one job type) and expected failure volume | Less sophisticated than a dedicated DLQ if job diversity and failure volume grow significantly                                             |
| **Selected: BullMQ's native failed-job state, for now**                                            | —                                                                                                                                                                     | —                                                                                                                                          |

This is explicitly flagged as a decision to revisit — not in this phase, but whenever job diversity or failure volume genuinely grows to justify a dedicated dead-letter queue (a natural candidate trigger point: when a compaction-job failure loop, per architecture's design-review addendum §24.4, needs its own dead-letter path in Phase 11 — that phase should reconsider this decision specifically, not inherit it uncritically).

### 5.8 Idempotency

**This is the single most important design property in this phase**, per the roadmap's own explicit callout (its Phase 2 entry's "Common pitfalls" section) and the crash-recovery scenario in §3.5.

Every job payload carries an idempotency key. Before a worker performs the job's actual side-effecting action (calling the email provider), it checks whether a record already exists (in the §4 durable entity) showing this exact idempotency key has already succeeded — if so, the job is a safe no-op completion, not a duplicate send.

| Approach                                                                                                                                                             | Pros                                                                                                                                                                                                                  | Cons                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Random UUID generated per enqueue call, stored alongside the job**                                                                                                 | Simple to generate                                                                                                                                                                                                    | Does not, by itself, prevent a _duplicate enqueue_ (e.g., a bug that calls the enqueue function twice for the same logical event) from producing two different idempotency keys and thus two real sends — the UUID protects against duplicate _processing_ of the same job, but not duplicate _enqueueing_                                                                                              |
| **Deterministic key derived from the event itself** (e.g., a stable hash/combination of `userId` + event type — "welcome-email" is inherently a once-per-user event) | Protects against both duplicate processing _and_ duplicate enqueueing, since two enqueue calls for the same user's welcome email naturally produce the identical key, and the idempotency check catches it either way | Requires the event to genuinely have a natural, stable uniqueness key — not every future job type will have one this clean (a job triggered by a truly repeatable action, like "send a comment-reply notification," needs a key that includes enough context to distinguish distinct instances — a future phase's concern, not this one's, since "welcome email" is uniquely and cleanly once-per-user) |
| **Selected: deterministic key derivation**, specifically `userId` + a fixed event-type string for this phase's one job                                               | —                                                                                                                                                                                                                     | —                                                                                                                                                                                                                                                                                                                                                                                                       |

## 6. Redis Planning

Extending the key-namespacing convention established in Phase 0 (spec §22) and Phase 1 (spec §10):

- **BullMQ's own internal keys** (queue metadata, job data, job locks, retry/delay scheduling state) — these are managed entirely by the BullMQ library itself under its own key-naming scheme; this phase does not hand-roll any of this, and no custom Redis key design is needed for core queue mechanics.
- **Job state** (queued/active/completed/failed) lives natively inside BullMQ's Redis structures — not duplicated into any custom key by this phase's code (the durable Postgres record in §4 is the durable-visibility answer; Redis remains BullMQ's own operational state, consistent with the disposable-cache principle from architecture §8).
- **Retries** — BullMQ manages retry scheduling internally (delayed re-queueing per the configured backoff, §5.4); no custom Redis usage needed.
- **Locks** — BullMQ uses an internal per-job lock (renewed via a heartbeat while a worker is actively processing) to detect stalled jobs (§3.5's crash-recovery mechanism) — this phase relies on BullMQ's default lock/stall-detection behavior rather than building any custom distributed-lock mechanism, consistent with architecture §8's guidance that BullMQ's own job-level concurrency controls should be preferred over hand-rolled distributed locks where possible.
- **Scheduling** (delayed jobs, §5.5) — again, entirely internal to BullMQ.
- **Future queues** — each new queue (Phase 5's invitation queue, Phase 9's thumbnailing queue, etc.) reuses the identical pattern established here (its own BullMQ queue instance, its own worker processor registration) without requiring any new Redis-usage design.

**The overall Redis-planning conclusion for this phase is deliberately narrow:** almost none of this phase's Redis interaction is custom-designed, because BullMQ already owns the entirety of the queue/job/retry/lock state machine. This phase's job is to configure and use BullMQ correctly, not to design new Redis data structures around it — a meaningfully different, and much lighter, planning task than Phase 1's session-store design was.

## 7. Database Planning

### 7.1 Entities

The one new entity from §4 (referred to here as `NotificationEvent`, though the exact name is a task-breakdown-level decision) — no other schema changes in this phase.

### 7.2 Relationships

`NotificationEvent.recipientUserId` → foreign key to `User.id` (Phase 1). No other relationships — this entity does not reference any workspace, document, or other not-yet-existing entity.

### 7.3 Indexes

- Index on `recipientUserId` — supports "list notification events for this user," a natural future support/debugging query, and eventually the read pattern Phase 16's notification center will need.
- Index on `status` (or a composite `(status, type)` index) — supports the interim monitoring view's "show me failed/pending jobs" query (§8.4) without a full table scan as volume grows.
- A unique constraint (or unique index) on the idempotency key itself — this is worth calling out as a genuine constraint, not just an index: it provides a **database-level backstop** against duplicate sends even in the (unlikely, but worth defending against) case where the application-level idempotency check in §5.8 has a bug or race — an attempt to insert a second `pending`/`sent` record with an already-used idempotency key should fail at the database level, not just be caught by application logic.

### 7.4 Future Compatibility

As noted in §4.6, this entity's generic shape (`type`, `recipientUserId`, `status`, `metadata`) is designed so that Phase 5, 9, 11, 14, and 19's job types can each extend it (new `type` values, new `metadata` shapes) without schema changes to the core columns, and so that Phase 16's eventual consolidation into a formal multi-channel `Notification` model can migrate this table's data forward rather than discarding and rebuilding it.

### 7.5 Storage Considerations

Volume at this phase's stage is trivial (one row per user's first sign-in) — no partitioning, archival, or pruning strategy is needed yet. This becomes a relevant question only once Phase 14/16 substantially increase notification-event volume (comment mentions, invitation events, etc.) — noted here as a forward-looking awareness, not a Phase 2 requirement.

## 8. API Planning

### 8.1 REST Philosophy

This phase introduces almost no new _user-facing_ REST surface — job triggering is entirely internal (Phase 1's OAuth callback calls the enqueue function directly, in-process; there is no "enqueue a job" HTTP endpoint exposed to any client). The one new HTTP surface is the interim queue-monitoring view (§8.4), which is an internal engineering tool, not a product API endpoint, and is treated with correspondingly different conventions (see below).

### 8.2 Validation

The job payload itself (§5.8, §10.4 — `userId` + idempotency key, nothing else) is validated via a Zod schema **before** the job is accepted into the queue, not after a worker picks it up — rejecting a malformed enqueue attempt immediately, synchronously, at the call site, is both cheaper and produces a clearer failure signal than allowing a malformed job to enter the queue and fail repeatedly during worker processing (this is stated explicitly in §12.4 as well, since it's also an error-handling concern, not just a validation one).

### 8.3 Error Responses, Status Codes, Authentication, Authorization, Response Format, Versioning

These architecture-level API conventions (established in Phase 0 §17/§19 and Phase 1 §8) are inherited unchanged — this phase does not modify the error envelope, versioning scheme, or authentication middleware. The only genuinely new question this phase raises is access control for the interim monitoring view, addressed next.

### 8.4 The Interim Queue-Monitoring View

The roadmap explicitly calls for "job-failure visibility... even if just a basic admin queue-dashboard library at this stage." This phase needs to decide how that's gated, given **no formal admin-role or permission system exists yet** (that begins at Phase 5/18).

| Approach                                                                                                                                                                                                                                                                             | Pros                                                                                                                                                                                                                                                                                         | Cons                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No access control beyond standard Phase 1 authentication** (any signed-in user can view it)                                                                                                                                                                                        | Simplest                                                                                                                                                                                                                                                                                     | A queue dashboard can reveal operationally sensitive information (job payloads, failure patterns, provider error detail) that no ordinary product user should see — this is not an acceptable posture even temporarily                                                     |
| **Build a proper admin-role check now**                                                                                                                                                                                                                                              | Correctly scoped access control                                                                                                                                                                                                                                                              | This is explicitly Phase 5 (workspace roles) and Phase 18 (admin panel) work — building a role system early, just for this one internal tool, is exactly the kind of scope creep and premature-architecture-introduction this phase's instructions explicitly warn against |
| **Selected: authenticate via Phase 1's existing session middleware, AND gate behind an explicit environment flag** (disabled by default; only enabled in local/staging environments, or via a narrowly-scoped, separately-secured internal access path if ever needed in production) | Reuses existing, already-frozen authentication infrastructure (no new access-control mechanism invented); the environment gate keeps this tool out of any production user's reach entirely by default, which is the actually-important property given no real authorization model exists yet | This is explicitly an interim, coarse-grained measure — not a substitute for the real, role-based access control Phase 18 will eventually apply to a proper admin panel                                                                                                    |
| —                                                                                                                                                                                                                                                                                    | —                                                                                                                                                                                                                                                                                            | —                                                                                                                                                                                                                                                                          |

This decision is recorded explicitly in §17 as something Phase 18 is expected to _replace_, not preserve — the environment-gate approach should not quietly become the permanent access-control story for this or any future internal tool.

## 9. Worker Architecture

### 9.1 Startup Sequence

On process start: load and validate configuration (Phase 0's `packages/config` pattern, already established for `apps/worker` in that phase's scaffolding), establish the Redis connection, register the processor function for the email queue (§5.2), and log a structured "worker ready" event once registration succeeds — mirroring the fail-fast startup discipline already established for `apps/api` in Phase 1.

### 9.2 Queue Registration

The worker registers exactly one processor in this phase (the email queue's processor function). The registration pattern itself — how a worker process comes to know which queues/processors it's responsible for — is deliberately kept simple and explicit now (a single worker process handling the single existing queue) rather than building a dynamic/pluggable processor-registration system ahead of any actual need for one (§9.8 discusses future multi-worker scaling directly).

### 9.3 Graceful Shutdown

On receiving a shutdown signal (SIGTERM, consistent with the container-orchestration expectations architecture's design-review addendum §24.5 establishes for the _real-time_ process — this phase applies the identical discipline to the worker process, since a worker killed mid-job is exactly analogous to a WebSocket instance killed mid-edit-burst): the worker stops accepting new jobs, allows any in-flight job a bounded grace period to complete, and only then closes its Redis connection and exits. This is not merely a nicety — it directly reduces (though, per §3.5's design, does not need to eliminate, since idempotency already makes an abrupt kill safe) the frequency of jobs being abandoned mid-processing and needing the stalled-job-recovery path to kick in.

### 9.4 Error Handling

A processor function's own thrown error is caught by BullMQ and routed into the retry mechanism (§5.4) — this is expected, routine failure handling, not a crash. A **truly unexpected** error (a bug outside the job-processing try/catch boundary, or an `uncaughtException`/`unhandledRejection` at the process level) is handled per Phase 0's process-level safety net (§10.4 of that spec): logged with full detail and the process exits, relying on the container orchestrator to restart it — "log and continue in a possibly-corrupted state" remains explicitly rejected as a pattern, exactly as Phase 0 established for every process type.

### 9.5 Logging

Structured, correlation-ID-aware logging (Phase 0's Pino setup) is used throughout: job received, job started, job completed, job failed (with retry-attempt number), worker started, worker shutting down. **A specific propagation challenge worth calling out:** Phase 0's correlation-ID mechanism (`AsyncLocalStorage`) does not cross a process boundary automatically — a job enqueued from `apps/api` and processed by `apps/worker` is a different process, with its own `AsyncLocalStorage` context. The correlation ID from the _triggering_ request (e.g., the sign-in request that led to the enqueue) is therefore **explicitly included as part of the job's data payload** at enqueue time, and the worker re-establishes an `AsyncLocalStorage` context using that carried-forward ID when it begins processing — this is what allows a single correlation ID to trace a user action from the original HTTP request all the way through to the asynchronous job that action triggered, fulfilling the tracing intent architecture §22 describes, now implemented for the first time across a real process boundary.

### 9.6 Health Checks

Extending Phase 0's liveness/readiness pattern (already scaffolded for `apps/worker` as an empty process in that phase): readiness now means "Redis connection established AND the email queue's processor is registered," not just "the process is running." This is a genuine strengthening of Phase 0's placeholder health check, not a new pattern.

### 9.7 Monitoring

Full metrics/dashboards remain Phase 21's job (per the roadmap). This phase's contribution to future monitoring is exclusively through the structured logging in §9.5 — no metrics-collection library or dashboard is introduced here, consistent with §2.2's scope boundary.

### 9.8 Future Multiple Workers & Scaling Strategy

Because BullMQ workers are stateless consumers (they hold no state that isn't in Redis/Postgres), horizontal scaling is straightforward and requires no architectural change when it's eventually needed: first, increase a single worker process's internal concurrency setting (how many jobs it processes in parallel); if that's insufficient, run multiple worker process replicas, all consuming from the same queue(s), with BullMQ's own locking (§9.3, §3.5) already ensuring two replicas never process the same job simultaneously. This phase runs a single worker replica with a conservative concurrency setting — entirely sufficient for one job type at this stage — and this section exists specifically so a future phase facing real throughput pressure (per architecture's capacity model, §24.2) knows the scaling lever already exists and requires no redesign, only configuration and replica-count changes.

## 10. Security

### 10.1 Authorization

The only new access-control surface this phase introduces is the interim monitoring view, addressed in §8.4. The job-enqueue path itself has no independent authorization surface — it's called in-process by already-authorized code (Phase 1's OAuth callback, which has already completed its own authorization reasoning by the time it decides to enqueue).

### 10.2 Input Validation

Covered in §8.2/§12.4 — job payloads are Zod-validated before entering the queue, not trusted implicitly.

### 10.3 Queue Abuse

Because this phase's only enqueue trigger is Phase 1's OAuth callback (itself already rate-limited, per Phase 1 spec §11.7), there is no new, independently-exploitable surface for someone to flood the email queue in this phase specifically. This is worth stating explicitly as a scope-bounded security conclusion: **future phases that add new, user-triggerable enqueue paths** (e.g., Phase 5's "send an invitation" — a much more directly abusable trigger, since a user can trigger it repeatedly on demand) **must apply their own rate limiting at that trigger point**, following the precedent Phase 1 already set for OAuth endpoints — this phase's job infrastructure does not, and should not, attempt to solve that problem generically on future phases' behalf, since the correct rate-limiting policy depends on the specific trigger's abuse profile, which only that future phase can reason about correctly.

### 10.4 Sensitive Payload Fields — The Minimal-Reference Principle

| Approach                                                                                    | Pros                                                                                                    | Cons                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Include full recipient data in the job payload** (email address, display name, etc.)      | The worker doesn't need a database lookup to process the job                                            | Duplicates PII into Redis-stored job data (which may persist, even if briefly, in BullMQ's own retention) unnecessarily; if that user's data changes between enqueue and processing (e.g., an email correction), the job would act on stale data |
| **Include only a minimal reference (`userId`) and look up needed fields at execution time** | No PII duplication into Redis; the worker always acts on current data at the moment of actual execution | One additional database read per job — a negligible cost at this phase's volume                                                                                                                                                                  |
| **Selected: minimal reference**                                                             | —                                                                                                       | —                                                                                                                                                                                                                                                |

This mirrors the exact data-minimization reasoning already applied in Phase 1 §5.4's decision not to persist OAuth provider tokens — the same underlying principle (don't store more than the minimum needed, for the minimum time needed) is applied here to job payload design specifically, and is recorded in §17 as a convention every future job type must also follow.

### 10.5 Replay

Addressed structurally by the idempotency design in §5.8 — a "replayed" job (whether from a legitimate BullMQ retry or, hypothetically, a maliciously-crafted duplicate enqueue attempt with the same deterministic key) cannot produce a duplicate real-world effect (a second email sent).

### 10.6 Job Injection

Queue names and processor-function dispatch are fixed at deploy time (a queue's processor is registered once, at worker startup, per §9.2) — there is no dynamic, payload-driven dispatch where an attacker-influenced field determines which code path executes. This closes off an entire class of "job injection" risk (a malicious payload causing unintended code execution by manipulating a job-type-selection field) by construction, simply by not building a dynamic dispatch mechanism in the first place.

### 10.7 Secrets

The email provider's API key is supplied via Phase 0's environment/secret-management mechanism (per-environment, never committed) — no new secret-handling pattern is introduced by this phase.

## 11. Logging

### 11.1 Events to Log

| Event                                      | Level   | Notes                                                                                                                                                        |
| ------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Job enqueued                               | `info`  | userId reference, job type, correlation ID (carried forward per §9.5)                                                                                        |
| Job started (worker begins processing)     | `info`  | Job ID, attempt number                                                                                                                                       |
| Job completed successfully                 | `info`  | Job ID, duration                                                                                                                                             |
| Job failed (will retry)                    | `warn`  | Job ID, attempt number, failure category (never the raw provider error body verbatim — a categorized reason)                                                 |
| Job failed permanently (retries exhausted) | `error` | Distinctly flagged per §3.4 — this is the signal worth operational attention                                                                                 |
| Worker started / worker shutting down      | `info`  | Per §9.1/§9.3                                                                                                                                                |
| Interim monitoring view accessed           | `info`  | Given §8.4's coarse access gate, logging access to this internal tool is a reasonable, low-cost additional visibility measure while the gate remains interim |

### 11.2 What Must Never Be Logged

- The email provider's API key or any request/response header carrying it.
- The full email body content (not stored per §4.5, and correspondingly never logged either).
- Raw, unfiltered provider API error responses that might embed request details beyond what's needed for a categorized failure reason (§11.1's "failure category, not raw body" note).
- Full job payload objects logged indiscriminately "for debugging convenience" — given §10.4's minimal-payload design, the payload is small, but the habit of logging structured, chosen fields rather than dumping entire objects is the same discipline established in Phase 1 §12.2 and applies identically here.

## 12. Error Handling

### 12.1 Queue (Redis) Unavailable at Enqueue Time

If Redis is unreachable when Phase 1's callback attempts to enqueue the welcome-email job, the enqueue call fails. Per §3.1's stated critical property and §12.5 below, **this failure must not propagate to the sign-in response** — it is caught, logged loudly (this is a genuinely unexpected infrastructure condition worth an `error`-level log, distinct from an ordinary job failure), and the sign-in proceeds regardless. The user simply doesn't receive a welcome email this time; the core product function (signing in) is unaffected.

### 12.2 Redis Unavailable at Worker Runtime

If the worker loses its Redis connection while running, it cannot receive new jobs — this is a worker-level outage, handled via the same fail-loud, health-check-driven posture architecture's design-review addendum establishes generally for Redis-dependent processes (§24.4 of the architecture's addendum): the worker's readiness check (§9.6) should reflect the lost connection, and reconnection is attempted per standard client-library retry behavior rather than the process silently continuing in a non-functional state.

### 12.3 Worker Crashes

Covered in §9.4 and §3.5 — a crash mid-job is made safe by idempotency (§5.8) plus BullMQ's stalled-job recovery; a crash from a genuinely unexpected error triggers Phase 0's process-level exit-and-restart pattern.

### 12.4 Database Failures

Two distinct cases worth separating:

- **A database error during the initial job-payload validation/enqueue path** (§8.2) — the enqueue is aborted, following §12.1's "must not block sign-in" principle identically.
- **A database error while the worker is writing the §4 status-tracking record** (e.g., after a successful provider send, but the `sent`-status write to Postgres fails) — this is a genuine edge case worth a deliberate policy: the actual email **has** gone out at this point, so retrying the whole job (which would re-attempt the provider call) is undesirable if avoidable. The chosen policy: the write is retried a small number of times independently of the job's own retry mechanism (a narrower, faster retry specifically for this Postgres write), and if it still fails, the job is still marked complete from BullMQ's perspective (the email genuinely was sent — that's the primary correctness fact), with the tracking-record inconsistency logged loudly as its own distinct operational concern rather than causing a duplicate send via a full job retry.

### 12.5 Profile/Payload Validation Failures

Renamed from the original template's "profile validation failures," since this phase has no profile data — the equivalent concern here is job **payload** validation failure (§8.2, §12.1's principle applied consistently): a malformed enqueue attempt is rejected synchronously, at the call site, before entering the queue, and — as with every other failure mode in this section — never blocks or fails the triggering user-facing action.

### 12.6 Retry Exhaustion

Covered in §3.4/§5.4 — terminal failure, `error`-level log, visible in the interim monitoring view, no further automatic action.

## 13. Testing Strategy

### 13.1 Unit Tests

- Idempotency-key derivation function, in isolation — given the same user/event, always produces the same key; given different users, always produces different keys.
- Job-payload Zod schema — accepts a valid minimal payload (`userId` + idempotency key), rejects a malformed one.

### 13.2 Integration Tests

- The full enqueue-on-signup wiring, extending Phase 1's existing OAuth integration tests: a new-user sign-in results in exactly one job enqueued; a returning-user sign-in results in zero jobs enqueued (mirroring the "first-sign-in-only" logic the roadmap specifies).
- The worker processing a job end-to-end against a mocked email-provider API (never a real provider call in automated tests), confirming the §4 status-tracking record transitions from `pending` to `sent` correctly.

### 13.3 Worker Testing

- Worker startup/readiness sequence (§9.1/§9.6) — confirms the worker correctly reports not-ready before Redis connection/registration completes, and ready afterward.
- Graceful shutdown (§9.3) — confirms an in-flight job is allowed to complete (within the grace period) before the process exits when a shutdown signal is sent mid-processing.

### 13.4 Queue & Failure Testing

- **The literal Phase 2 Definition of Done from the roadmap:** kill the worker process mid-job-execution (simulated) and restart it — confirm the job completes exactly once, with no duplicate email sent and no lost job, directly exercising §3.5's design.
- Simulated provider failure (mocked to return a transient error) confirms BullMQ's retry/backoff triggers as configured (§5.4), and that a subsequent successful attempt (or continued failure through to exhaustion, §3.4) is handled correctly either way.
- A malformed job payload (bypassing the enqueue-time Zod check, to specifically test the worker's own defensive handling) is confirmed to fail cleanly without crashing the worker process or corrupting other jobs' processing.

### 13.5 Retry Testing

- Confirm the configured maximum-attempts count is actually enforced (a job fails permanently after exactly that many attempts, not more or fewer).
- Confirm backoff timing is exponential, not fixed-interval, by observing the approximate delay between successive retry attempts in a test environment (exact timing assertions should allow for reasonable variance, not require precise timing, given test-environment scheduling jitter).

## 14. Acceptance Criteria

Phase 2 is complete when **all** of the following are objectively true:

1. The BullMQ worker runs as its own containerized process (`apps/worker`), distinct from `apps/api`, confirmed via `docker-compose up`.
2. A real (dev/test) transactional email provider is integrated; a genuine sign-in through Phase 1's OAuth flow results in a real email arriving in a real test inbox.
3. The welcome-email job is enqueued exactly once per user's first sign-in and zero times on any subsequent sign-in by the same user, confirmed by test.
4. The sign-in response never blocks on, and never fails due to, any job-enqueue or email-send failure — confirmed by a test that simulates a Redis or provider outage during sign-in and verifies sign-in still succeeds.
5. Killing the worker process mid-job and restarting it results in the job completing exactly once — no loss, no duplicate send — confirmed by test (§13.4).
6. Retry/backoff behavior matches the documented policy (§5.4), and a job that exhausts retries reaches a visible terminal failed state.
7. The interim queue-monitoring view is reachable only through the documented access gate (authenticated + environment-restricted, §8.4) — confirmed by testing it is unreachable when the environment flag is unset/disabled.
8. No email-provider API key, full email body content, or raw unfiltered provider error payload ever appears in log output — verified by inspecting real captured logs, not by code review alone.
9. Job payloads contain only the minimal reference fields (`userId`, idempotency key) — verified by inspecting an actual enqueued job's stored data, confirming no duplicated profile fields are present.
10. All tests described in §13 exist and pass in CI, alongside Phase 0 and Phase 1's existing pipeline.
11. The `NotificationEvent` (or equivalently-named) entity's unique idempotency-key constraint is confirmed to reject a duplicate insert at the database level, independent of the application-level idempotency check (§7.3).

## 15. Risks

| Risk                                                                                                                                   | Mitigation                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Email provider outages or deliverability issues**                                                                                    | The core sign-in flow is explicitly, testably unaffected by any provider issue (§12.1, acceptance criterion #4) — this is the primary mitigation, more important than any specific provider-uptime guarantee                                                                                                                              |
| **Redis now serves both sessions (Phase 1) and job queueing (Phase 2), increasing its blast radius if it fails**                       | An already-accepted architectural trade-off (architecture's design-review addendum §24.4), not newly introduced by this phase — restated here only to note that this phase does not change that risk's shape, and that the fail-loud, fail-closed posture already established for Redis dependency in Phase 1 is applied identically here |
| **Job payload schema rigidity as more job types are added by later phases**                                                            | The `type` + generic `metadata` shape (§4.4, §7.4) is specifically designed to absorb this — but if a future phase's job type genuinely doesn't fit this shape well, that's a signal worth raising against this phase's design at that time, not silently working around                                                                  |
| **Premature generalization** (over-building a notification system this phase doesn't actually need yet)                                | The scope boundary in §2.2 and the deliberate deferral of multi-channel/notification-center work to Phase 16 (already the roadmap's own plan) directly guards against this                                                                                                                                                                |
| **The interim monitoring-view access gate being treated as a permanent solution** rather than the temporary measure it's documented as | Explicitly flagged in §8.4 and §17 as something Phase 18 must replace — a risk best mitigated by this documentation existing and being referenced when Phase 18 planning begins, not by any code-level safeguard                                                                                                                          |

## 16. Common Mistakes

Frequent, well-documented worker/queue-system implementation mistakes this spec is designed to prevent by construction:

- **Sending the email synchronously "just for now, we'll make it async later."** This is the roadmap's own explicitly named pitfall for this exact phase — defeats the entire purpose of the phase and establishes a pattern later job-adding phases would copy. Any implementation shortcut here should be treated as a critical defect, not a minor simplification.
- **Skipping the idempotency key** because "retries are rare" or "it's just an email." The crash-recovery scenario (§3.5) is not a rare edge case worth deprioritizing — it's a direct, expected consequence of running any process (including a well-behaved one during a routine deploy) in a distributed system, and idempotency is the actual, structural defense against it, not a nice-to-have.
- **Treating BullMQ's automatic retry as a substitute for idempotency**, rather than a complement to it. Retries alone guarantee a job _eventually_ completes; they say nothing about whether a partially-completed prior attempt already had a real-world side effect that a retry would duplicate. Both mechanisms are needed together.
- **Not implementing graceful shutdown** (§9.3), leading to a higher rate of abandoned/stalled jobs than necessary — idempotency makes this _safe_, but a well-behaved shutdown still makes it _less frequent_, which matters for provider-side effects like email-sending rate and for reducing noise in job-failure monitoring.
- **Blocking the triggering request on the enqueue call**, reintroducing exactly the synchronous coupling this phase's infrastructure exists to remove — this is the same mistake as "sending synchronously," one level more subtle (the _email_ is async, but if the enqueue call itself is allowed to fail the parent request, the coupling isn't actually removed).
- **Leaving retry/backoff configuration at unconsidered library defaults** rather than a deliberately chosen policy (§5.4) — defaults may not match this job's actual failure characteristics (a welcome email's transient-failure profile is different from, say, a large file-processing job's).
- **Logging full job payloads or provider responses indiscriminately** "for debugging convenience" (§11.2) — a habit that's easy to fall into under time pressure and easy to avoid by deciding, deliberately, which specific fields are worth logging.
- **Mounting the interim monitoring view without any access gate at all** (§8.4) — an easy oversight if the tool is built quickly "just for internal use," forgetting that "internal use" still needs an actual access boundary given the operationally sensitive information such a view exposes.

## 17. Decisions That Must Never Change Later

- **BullMQ as the job-processing engine** — already frozen by the architecture; this phase implements it for the first time but does not reopen the choice.
- **The worker-as-a-separate-process boundary** (`apps/worker`, distinct from `apps/api`) — never fold worker logic into the API process; this boundary is what makes the independent-scaling story in architecture §14/§9.8 possible, and collapsing it later would be a real architectural regression, not a simplification.
- **The idempotency-key convention** (deterministic derivation where the event naturally supports it, §5.8) — every future job type (Phase 5, 9, 11, 14/16, 19) must follow this same pattern; a future phase skipping idempotency "because this job type feels different" should be treated as a deviation requiring explicit justification, not a default.
- **The minimal-payload-reference principle** (§10.4 — pass IDs, look up current data at execution time, never duplicate PII into job payloads) — this shapes every future job's payload design and should not be quietly abandoned for convenience in a later phase.
- **The "job-enqueue or job-processing failure must never block or fail the triggering user-facing request" principle** (§3.1, §12.1, §12.5) — this is the actual reliability guarantee asynchronous processing exists to provide; a future phase that makes a user-facing action synchronously depend on successful job enqueueing would be undermining the entire premise of this phase's infrastructure.
- **The `NotificationEvent`-shaped entity's generic, channel-agnostic core shape** (§4.4) — future phases extend it via `type`/`metadata`, they do not fork a parallel, differently-shaped tracking table for their own job type.
- **The interim monitoring-view access gate is explicitly temporary** — Phase 18 is expected to replace it with real, role-based access control; this is recorded here specifically so it is not mistaken for a permanent design decision by a future engineer encountering it without this context.
