# Real-Time Collaborative Workspace — Engineering Architecture Blueprint

**Document type:** Pre-implementation architecture & design blueprint
**Audience:** Engineering team, prior to any code being written
**Status:** Draft v1 — foundation for phased implementation prompts

---

## 0. Purpose and Scope of This Document

This document is the architectural constitution for the product before a single line of code is written. It exists to force every non-trivial decision — data model, synchronization strategy, authorization boundaries, scaling posture — into the open, compared against alternatives, and justified in writing. Nothing here is a schema, an API contract, or a component tree. Those artifacts come later, and when they do, they should be traceable back to a decision made in this document.

The document is organized so that a new engineer could read it start to finish and understand _why_ the system looks the way it will look, not just _what_ it will contain.

---

## 1. Product Vision

The product is a **real-time collaborative document workspace** — a place where teams create, organize, and co-edit structured documents inside shared workspaces. It sits in the same conceptual category as Google Docs, Notion, Dropbox Paper, Microsoft Loop, and Coda, but it is not a clone of any of them. Its identity is defined by three commitments:

1. **Local-first editing feel, server-verified truth.** Every keystroke feels instant and never blocks on the network, but the server is the durable source of truth for permissions, membership, and persisted state.
2. **CRDT-based synchronization, not fragile custom logic.** Conflict resolution is delegated to a battle-tested CRDT library (Yjs) rather than a bespoke operational-transform or diff/patch system. Engineering effort goes into _integrating_ CRDT correctly, not _reinventing_ it.
3. **Workspace-first, not document-first.** Permissions, membership, and organization are modeled at the workspace level first, with documents inheriting and refining that structure — because collaborative tools fail more often on organizational/permission modeling than on the editor itself.

The product should feel premium: fast perceived latency, calm UI states for offline/reconnect/conflict, and an architecture that a Staff Engineer would be comfortable defending in a design review.

---

## 2. Guiding Architectural Principles

These principles are referenced throughout the document whenever a trade-off is made.

| Principle                                                                                                               | What it means in practice                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Server is authoritative for identity & authorization; client is authoritative for document content within a session** | Auth/session/permission checks always happen server-side before a socket join or REST mutation. Document _content_ conflict resolution is delegated to Yjs, which is allowed to merge concurrently without a server-side "content referee."  |
| **Optimistic UI, pessimistic security**                                                                                 | Users never wait on the network to see their own edit. But nothing bypasses server-side authorization — optimism applies to UX, never to access control.                                                                                     |
| **Every real-time feature has an offline/degraded-mode story**                                                          | If a feature (presence, comments, sync) can't gracefully explain "what happens when the socket drops," it isn't done being designed.                                                                                                         |
| **Redis is a fast, disposable cache — Postgres is truth**                                                               | Anything in Redis must be reconstructable from Postgres or from client state. Redis loss should degrade the product, never corrupt it.                                                                                                       |
| **Horizontal scalability is a default constraint, not an afterthought**                                                 | Any component that only works with a single server instance (in-memory session storage, in-process pub/sub, local file storage) is treated as a bug, even at low scale, because it forces a rewrite instead of a config change later.        |
| **Boring technology where correctness matters, novel effort where differentiation matters**                             | OAuth, sessions, background jobs, and CRDT sync use well-worn libraries. Engineering creativity is spent on the collaboration UX, permission model, and sync architecture _integration_ — not on reinventing distributed systems primitives. |

---

## 3. Tech Stack Rationale

The requested stack is fixed. This section justifies the decisions that have real alternatives worth naming, most importantly the real-time synchronization engine.

### 3.1 Why Yjs, and not OT, Automerge, or a custom CRDT

| Approach                       | How conflict resolution works                                                                                                                        | Pros                                                                                                                                                                                                                                                                       | Cons                                                                                                                                                                                                                                                                                                             | Verdict                                                                                                                                                                                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Operational Transform (OT)** | Every edit is an operation; the server transforms concurrent operations against each other in a specific order (Google Docs' original approach)      | Mature in specific implementations; fine-grained control                                                                                                                                                                                                                   | Requires a **central sequencing server** for correctness — every operation must pass through one authority. Transform functions are notoriously hard to get right for rich structured content (tables, nested blocks, embeds). Reimplementing OT correctly is a multi-year research-grade effort, not a feature. | **Rejected.** OT's need for central sequencing conflicts with the local-first, offline-capable goal, and correctness risk is too high for a small team to own.                                                                                  |
| **Automerge**                  | CRDT library, JSON-like document model, full history by design                                                                                       | Also a real CRDT (no central sequencer needed); strong data-model guarantees; good offline story                                                                                                                                                                           | Historically heavier documents (full op-log by default, though newer versions improve this), smaller ecosystem of _rich-text editor bindings_ specifically, less mature integration with mainstream editors (ProseMirror/TipTap) compared to Yjs                                                                 | **Rejected, but reasonable.** Automerge is a legitimate CRDT choice; it loses to Yjs specifically because of editor-ecosystem maturity, not because CRDTs are wrong.                                                                            |
| **Custom CRDT**                | Build our own conflict-free replicated data type for rich text                                                                                       | Full control                                                                                                                                                                                                                                                               | This is a distributed-systems research problem. Rich-text CRDTs (handling concurrent formatting, block moves, nested structures) have subtle correctness bugs that take mature libraries years to shake out. Building this in-house is the single highest-risk decision available in this entire architecture.   | **Rejected outright.** This is explicitly out of scope per the brief, and for good reason: the engineering value of this product is in integration and UX, not in inventing sync theory.                                                        |
| **Yjs**                        | CRDT, purpose-built with mature bindings for ProseMirror/TipTap, `y-websocket`/`y-protocols` for network sync, `y-indexeddb` for offline persistence | Mature rich-text CRDT with production usage (JupyterLab, several commercial editors), first-class **Awareness protocol** for presence/cursors, binary-efficient update encoding, strong offline story via IndexedDB provider, works with a "just relay bytes" server model | Document structure is still JSON-like under the hood, so extremely exotic data structures need adaptation; single-document CRDT state can grow if never compacted (mitigated by snapshotting, see §9)                                                                                                            | **Selected.** Yjs is the only option in this comparison that is simultaneously (a) a true CRDT — no central sequencer required — and (b) has mature, production-proven bindings for a rich-text editor and a real offline story out of the box. |

**Why this matters architecturally:** because Yjs doesn't require a central sequencing authority, the WebSocket server's job for document content is reduced to _relaying and persisting opaque binary updates_ — it does not need to understand document semantics at all. This is a major architectural simplification: the real-time server is "dumb" about content and "smart" about authorization, presence, and routing. Section 9 expands on this.

### 3.2 Frontend Stack Rationale (brief)

- **Next.js 15 App Router + React 19:** Server Components for the static/authenticated shell (dashboard chrome, workspace lists) and Client Components for the editor surface, which must own its own state and cannot be server-rendered meaningfully once Yjs attaches.
- **JavaScript, not TypeScript (per requirement):** this shifts correctness burden onto **Zod schemas at every boundary** (API requests/responses, form inputs) since there's no compile-time type safety. This is treated as a hard rule, not a suggestion — see §20.
- **TanStack Query:** owns all _REST_ server state (workspace lists, document metadata, comments) with cache invalidation; it explicitly does **not** own live document content — that's Yjs's job. Mixing the two would create two competing sources of truth for the same data.
- **React Hook Form + Zod:** all mutation forms (invite member, rename workspace, create document) validate client-side with the same Zod schema that validates server-side, so validation logic is written once and shared.
- **Framer Motion:** reserved for state-transition affordances (presence avatars entering/leaving, panel open/close) — not for core editing interactions, which must feel instantaneous and unanimated.

### 3.3 Backend Stack Rationale (brief)

- **Express.js over a heavier framework (NestJS, etc.):** the real complexity in this system is in the WebSocket/Yjs layer and background jobs, not in REST routing sophistication. Express keeps the HTTP layer thin and unopinionated so it doesn't compete architecturally with the real-time layer.
- **Prisma over raw SQL/knex:** migrations-as-code and type-safe-ish query building (even in JS, Prisma's generated client catches many shape errors at runtime) fit a team that needs to move quickly on the relational model while keeping migration history auditable.
- **BullMQ over alternatives (Bee-Queue, Agenda):** BullMQ is Redis-backed (so it shares infrastructure we already need for sessions/presence/pub-sub), has mature retry/backoff/rate-limiting primitives, and has first-class support for delayed jobs (needed for debounced version snapshots — see §10).

---

## 4. Feature Inventory

Organized by domain. This is the canonical feature list all later phases derive from.

### 4.1 Authentication

OAuth sign-in (Google, GitHub) · account linking across providers · secure session issuance · session revocation · protected route middleware · logout (single session + "all devices").

### 4.2 User Management

Profile (name, avatar, provider identities) · account settings · connected-provider management (link/unlink) · active session list & revocation · notification preferences.

### 4.3 Workspace

Create workspace · switch between workspaces · member list · invitations (email + link-based) · role-based permissions · ownership · ownership transfer · workspace deletion (soft-delete with grace period, see §7) · workspace settings.

### 4.4 Documents

Create · edit · delete (soft) · archive/restore · duplicate · move (between folders/workspaces the user has access to) · pin · favorite · templates (workspace-level and personal) · metadata (title, icon, last-edited, owner) · full-text search · tags · folders · nested pages (arbitrary-depth document tree).

### 4.5 Rich Text Editor

Paragraphs, headings, ordered/unordered/checklist lists, tables, code blocks (with language hinting), block quotes, images, generic embeds (link previews), Markdown shortcuts (`## ` → heading, etc.), slash command menu, keyboard shortcuts, undo/redo (CRDT-aware — see §9.6).

### 4.6 Collaboration

Real-time multi-cursor editing · live selections · presence (who's viewing/editing) · typing indicators · live avatar stack · inline comments · suggestion mode (tracked-change-style proposals) · @mentions · sharing controls with roles (Owner / Editor / Commenter / Viewer / Guest) · permission inheritance (folder → nested pages).

### 4.7 Synchronization

Offline editing · reconnect-and-merge · conflict resolution (delegated to Yjs CRDT semantics) · optimistic local updates · version reconciliation · incremental (delta) sync · initial full sync · snapshot-based fast loading for large/old documents.

### 4.8 Version History

Full document history · restore-to-version · named/manual snapshots · version comparison (diff view) · timeline scrubber.

### 4.9 Comments

Inline anchored comments · threaded replies · resolve/reopen · @mentions inside comments · notification triggers.

### 4.10 Search

Full-text search across a workspace · filters (by tag, author, date, folder) · recent documents · favorites.

### 4.11 Notifications

Email notifications · in-app notifications for mentions, comment replies, workspace invitations · architecture reserved for future push notifications (mobile/web push).

### 4.12 File Uploads

Image uploads embedded in documents · generic file attachments · storage in S3 · size limits · server-side validation (MIME sniffing, not just extension) · image compression/resizing pipeline.

### 4.13 Dashboard

Recent documents · "shared with me" · favorites · templates gallery · recent activity feed · workspace switcher.

### 4.14 Admin Panel

Workspace-level management console · member management (role changes, removal) · audit log viewer · system health indicators (for workspace admins: storage usage, member activity — not raw infra metrics, which belong to internal ops tooling).

---

## 5. High-Level System Architecture

Conceptually, the system is composed of five cooperating planes:

1. **Control plane (REST API via Express):** everything that is not live document content — auth, workspace/member/permission CRUD, document metadata CRUD, comments, search, notifications, file upload orchestration. Backed by Postgres, cached selectively via Redis.
2. **Real-time plane (Socket.IO + Yjs relay):** WebSocket connections scoped to "rooms" (one room per document). Handles Yjs update relay, Awareness (presence/cursors), and nothing else. Deliberately kept "thin" — it does not re-implement authorization logic; it _asks_ the control plane / shared session store whether a connection is allowed to join a room.
3. **Persistence plane (Postgres + S3):** Postgres holds relational truth (users, workspaces, permissions, document metadata, comments, version snapshots-as-metadata). S3 holds large binary blobs (uploaded files, and optionally serialized Yjs snapshots for very large documents).
4. **Coordination plane (Redis):** session storage, Socket.IO's Redis adapter for cross-instance pub/sub, presence TTLs, rate limiting, distributed locks, short-lived document-state caches.
5. **Async plane (BullMQ workers):** anything that shouldn't happen on the request/socket hot path — debounced snapshotting, search indexing, email sending, exports/imports, thumbnail generation, cleanup jobs.

A useful mental model: **the control plane and real-time plane are separate Node processes that scale independently**, coordinating only through Postgres (shared truth) and Redis (shared ephemeral state). This separation is what allows the WebSocket tier to scale horizontally without becoming a bottleneck for ordinary CRUD traffic, and vice versa.

---

## 6. Authentication & OAuth Architecture

### 6.1 Why OAuth-only (no password auth)

Removing password auth removes an entire class of problems: password storage, reset flows, credential-stuffing exposure, and forgotten-password support load. The trade-off is dependence on third-party identity providers' uptime and API stability — accepted here because the product's target users (teams already using Google Workspace or GitHub) already have these identities.

### 6.2 Flow

Standard OAuth 2.0 Authorization Code flow (with PKCE) against Google and GitHub. On successful callback:

1. Provider returns profile + verified email.
2. Server checks for an existing **identity link** (provider + provider-user-id) — not just email match, to avoid account-takeover via email reuse across providers with unverified emails.
3. If no identity exists but the verified email matches an existing user, the server **requires an explicit "link this provider" confirmation step** rather than silently merging accounts — silent email-based merging is a known account-takeover vector if any provider in the mix ever allows unverified emails.
4. A session is created and session ID handed to the client via an **HttpOnly, Secure, SameSite=Lax** cookie. The session token itself is never exposed to JavaScript.

### 6.3 Session Storage: Redis-backed, not JWT-only

| Approach                       | Pros                                                                                                                                                               | Cons                                                                                                                                                 | Verdict                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Stateless JWT in cookie        | No server-side lookup per request                                                                                                                                  | Cannot be revoked before expiry without a blocklist (which reintroduces state anyway); large token if it carries workspace/role claims that go stale | Rejected as the sole mechanism |
| Redis-backed opaque session ID | Instantly revocable (delete key); small cookie; session data can be updated server-side without reissuing a token; natural fit since Redis is already in the stack | Requires a Redis lookup per authenticated request (cheap, sub-millisecond, and cacheable)                                                            | **Selected**                   |

Sessions store: user ID, active workspace ID, issued-at, last-seen-at, and a device/session label (for the "active sessions" UI). Role/permission data is **not** cached inside the session — it's fetched fresh (with a short Redis cache, see §8) so that a permission change (e.g., being removed from a workspace) takes effect immediately rather than waiting for session expiry.

### 6.4 Authorization Layering

Three independent checks, all server-side, none skippable by client state:

1. **Authentication middleware:** is there a valid session? (Express middleware, applied globally to protected routes.)
2. **Workspace membership check:** is this user a member of the workspace the resource belongs to?
3. **Resource-level permission check:** does this user's role (Owner/Editor/Commenter/Viewer/Guest) permit this specific action on this specific document, accounting for permission inheritance from parent folders?

This three-layer check is duplicated conceptually at the WebSocket layer (see §11.2) — a socket joining a document room re-runs membership + permission checks against the same source of truth, because a valid HTTP session does not automatically imply a valid right to join a specific real-time room.

---

## 7. Database Planning

No schema yet — this is entity/relationship/indexing _reasoning_.

### 7.1 Major Entities

- **User** — identity, profile
- **Identity** (linked OAuth provider accounts per user)
- **Session** (mirrored conceptually in Redis; Postgres may hold a durable audit trail if "all devices" listing needs to survive Redis eviction)
- **Workspace**
- **WorkspaceMember** (join entity: user × workspace × role)
- **Invitation** (pending workspace invites, email or link-based, with expiry)
- **Document** (metadata: title, icon, parent folder/document, workspace, owner, timestamps, archived/deleted flags)
- **DocumentPermission** (explicit overrides beyond workspace-inherited defaults, for per-document sharing)
- **DocumentContent** (reference to where the durable Yjs state lives — see §9.4 — not the live content itself)
- **VersionSnapshot** (point-in-time named or automatic snapshot metadata + storage reference)
- **Comment** and **CommentReply** (or a single self-referential Comment/Thread entity)
- **Tag** and **DocumentTag** (join)
- **Notification**
- **AuditLogEntry**
- **Attachment** (uploaded file metadata; binary lives in S3)

### 7.2 Relationships (conceptual)

- A **User** has many **Identities** (1:N) — enabling multi-provider linking.
- A **User** belongs to many **Workspaces** through **WorkspaceMember** (M:N with role attribute on the join).
- A **Workspace** has many **Documents**; a **Document** optionally has a parent **Document** (self-referential, enabling nested pages/folders as a single recursive tree rather than a separate "Folder" entity — simpler mental model, one tree to reason about).
- A **Document** has many **VersionSnapshots**, many **Comments**, many **Tags** (via join), many **Attachments**.
- **DocumentPermission** overrides are optional per (document, user-or-role) pair; absence of an override means "inherit from parent document, and ultimately from workspace default role."

### 7.3 Why a self-referential Document tree instead of a separate Folder entity

Two entities (Folder + Document) create ambiguity: can a folder be shared like a document? Can a document contain other documents? Products in this space (Notion especially) converge on **"everything is a page, pages can nest"** because it avoids maintaining two parallel permission/sharing systems. This system adopts the same approach: a single `Document` entity with a nullable `parentId`, where "folder-ness" is just a document with children and no meaningful content of its own.

### 7.4 Indexing Strategy (reasoning, not DDL)

- **Composite index on (workspaceId, parentId)** — the dominant query pattern is "list children of this node within this workspace," used for both the document tree UI and permission-inheritance resolution.
- **Index on (workspaceId, updatedAt DESC)** — powers "recent documents" without a full scan.
- **Partial index for non-deleted, non-archived documents** — since most queries filter these out, a partial index keeps the common-case index small and fast, at the cost of a slightly different code path for admin/trash views.
- **GIN index for full-text search** (Postgres `tsvector`) as the baseline; see §7.6 for why this may later be supplemented or replaced.
- **Unique composite index on (userId, workspaceId)** in WorkspaceMember to prevent duplicate memberships and to make membership lookups O(1) via index.
- **Index on Session/Invitation expiry columns** to make cleanup-job scans efficient (see §10).

### 7.5 Normalization Posture

Mostly 3NF, with two deliberate, justified denormalizations:

- **Document.lastEditedByUserId / lastEditedAt cached on the Document row itself**, even though this is derivable from version history — because "recent documents" and "last edited by" are read on every dashboard load and must not require a join against version/edit history each time.
- **WorkspaceMember.role stored directly on the join row** rather than normalized into a separate Role table with a foreign key, because the role set (Owner/Editor/Commenter/Viewer/Guest) is a small, stable enum, not user-extensible data — normalizing it further would add a join for no real flexibility gained.

### 7.6 Search: Postgres FTS now, evaluate dedicated search later

Postgres full-text search (`tsvector`/`tsquery` with a GIN index) is the correct starting point: it requires no new infrastructure, and it's genuinely good enough for per-workspace document search at moderate scale. A dedicated search engine (Elasticsearch/Meilisearch/Typesense) is a **later-phase evaluation trigger**, not a day-one requirement — see §14 (scalability) for the specific signal that should trigger this migration (search latency degrading as workspace document counts grow into the tens of thousands, or a need for typo-tolerant/ranked relevance search that Postgres FTS handles poorly).

### 7.7 Query Pattern Summary

| Pattern                                                   | Frequency                                               | Design response                                                                                                                        |
| --------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| "Give me the document tree for workspace X"               | Very high (every dashboard/sidebar load)                | Composite index + likely a Redis cache of the tree shape (invalidated on mutation)                                                     |
| "Can user U do action A on document D?"                   | Extremely high (every REST mutation, every socket join) | Resolved via a short-lived Redis-cached permission lookup, falling back to a recursive-ish parent-chain walk in Postgres on cache miss |
| "Recent documents for user U across all their workspaces" | High (dashboard)                                        | Denormalized `lastEditedAt` + composite index, unioned across workspace memberships                                                    |
| "Full text search within workspace"                       | Medium                                                  | Postgres FTS index scoped by `workspaceId`                                                                                             |
| "Version history for document D"                          | Low-medium                                              | Simple indexed foreign key scan, naturally low-volume per document                                                                     |

---

## 8. Redis Planning

Redis is used for five distinct purposes, each with a different eviction/durability posture. Treating these as one undifferentiated "Redis" would be a mistake — they have different key naming, TTL, and failure-tolerance requirements.

| Use case                                           | Data shape                                                                                                    | TTL / durability posture                                                                                            | Failure impact if Redis is flushed                                                                                                                                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Session storage**                                | Opaque session ID → {userId, activeWorkspaceId, deviceInfo}                                                   | TTL matches session lifetime (sliding expiration on activity)                                                       | Users are logged out. Annoying, not corrupting.                                                                                                                                                                                       |
| **Permission cache**                               | `(userId, documentId) → resolvedRole`, short TTL (seconds-to-low-minutes)                                     | Short TTL, explicitly invalidated on any permission-changing mutation                                               | Falls back to a Postgres resolution; no correctness risk, just a latency blip                                                                                                                                                         |
| **Presence / Awareness ephemeral state**           | `documentId → Set<userId + cursor + color>`, TTL refreshed on heartbeat                                       | Very short TTL (seconds) — presence is inherently ephemeral                                                         | Presence indicators reset; users simply reappear on next heartbeat. Zero data-loss risk since presence was never durable truth.                                                                                                       |
| **Socket.IO horizontal scaling adapter (pub/sub)** | Internal to the Socket.IO Redis adapter — cross-instance event broadcast                                      | No TTL; transient pub/sub messages                                                                                  | If Redis drops momentarily, cross-instance broadcast pauses; Socket.IO adapter reconnects. Worst case is a brief missed presence update, not lost document data (document updates are also persisted via the durable path, see §9.4). |
| **Rate limiting**                                  | Sliding-window counters per user/IP for sensitive endpoints (invite sending, comment posting, login attempts) | Short TTL windows                                                                                                   | Rate limits reset — acceptable, not a security-critical durability requirement                                                                                                                                                        |
| **Distributed locks**                              | Used narrowly — e.g., to prevent two BullMQ workers from snapshotting the same document simultaneously        | Very short TTL with lock-renewal pattern, or use BullMQ's own job-level concurrency controls instead where possible | Loss of a lock mid-operation could allow a duplicate snapshot job to run; mitigated by making the snapshot operation itself idempotent (see §10) rather than relying solely on the lock                                               |

**Key principle:** every one of these Redis-held pieces of state is either (a) trivially reconstructable, (b) inherently ephemeral by design, or (c) protected by an idempotency guarantee elsewhere. Nothing that must survive is Redis-only.

---

## 9. Yjs Architecture (Deep Dive)

This is the most consequential section in the document, because getting the sync model wrong is the most expensive mistake to fix later.

### 9.1 What Yjs Actually Is

Yjs is a CRDT (Conflict-free Replicated Data Type) implementation. Each document is represented as a Yjs document (`Y.Doc`) — a container for shared types (`Y.XmlFragment`/`Y.XmlText` for rich text, `Y.Map`, `Y.Array` for structured data). Every local edit produces a small, self-describing **update** (a binary diff), which can be applied to any other replica of the same document, **in any order, any number of times, and the result converges to the same state.** This "any order, idempotent-ish, commutative" property is precisely what removes the need for a central sequencing authority — this is the core reason Yjs was selected over OT in §3.1.

### 9.2 Document Lifecycle

1. **Creation:** a new `Document` row is created in Postgres with metadata; its Yjs state starts as an empty `Y.Doc`.
2. **First open:** client requests to join the document's real-time room. Server authorizes, then either (a) sends the current durable Yjs state (loaded from persistence — see §9.4) as an initial sync payload, or (b) if this is a brand-new document, initializes an empty state.
3. **Active editing session:** client and server exchange binary updates continuously (see §9.3).
4. **Idle/closed:** when the last client leaves a document room, the server's in-memory representation of that `Y.Doc` can be safely evicted (after ensuring the latest state has been persisted — see §9.4), since Postgres/S3 holds the durable copy.
5. **Reopen:** repeats step 2, loading from durable storage.

### 9.3 Synchronization Protocol (the `y-protocols/sync` model)

Yjs's companion sync protocol works in two phases:

- **Sync Step 1:** a joining client sends a compact "state vector" (a summary of which updates it already has, per replica) rather than its full document.
- **Sync Step 2:** the other side (server or peer) responds with only the updates the joining client is missing, computed by diffing against that state vector.

This is the mechanism that makes reconnection efficient: a client that was offline for an hour doesn't re-download the whole document, only the delta it missed. After this initial handshake, both sides simply broadcast small incremental updates as they occur.

### 9.4 Persistence Strategy: the Server as a Relay + Durable Writer

The WebSocket server's role for Yjs content is deliberately narrow: **it relays binary updates between connected clients in a room, and it writes those updates to durable storage.** It does not parse or understand the rich-text semantics inside the update — that's the editor binding's job on the client. This keeps the server layer thin, content-agnostic, and reusable for any future document type built on Yjs.

Durable storage has two tiers:

- **Append-only update log (hot path):** every incoming update is appended to a durable log (a Postgres table of raw update blobs, keyed by document + sequence, or equivalently an object in S3 for very high-volume documents). This is fast and simple, but an unbounded log grows forever and gets slow to replay.
- **Periodic compaction into a snapshot (cold path, background job):** a BullMQ job periodically (debounced — see §10) loads the full update log for a document, merges it into a single compacted `Y.Doc` state, stores that as the new baseline snapshot (in Postgres for small documents, S3 for large ones), and prunes the update log entries that are now subsumed by the snapshot. This bounds load time: reopening a document means "load latest snapshot + replay only the updates since that snapshot," not "replay every edit since document creation."

### 9.5 Awareness Protocol (Presence, Cursors, Selections)

Yjs ships a companion **Awareness** protocol, architecturally distinct from document content sync: it's for **ephemeral, non-persisted state** — cursor position, selection range, user color/name, "currently typing" flags. Awareness state is broadcast the same way document updates are (via the WebSocket room) but is **never written to durable storage** and lives only in Redis (see §8) with short TTLs, refreshed by periodic heartbeats. When a client disconnects (cleanly or via timeout), its awareness entry expires and other clients see the cursor/avatar disappear.

### 9.6 Undo/Redo

Yjs provides an `UndoManager` that tracks _local-origin_ changes specifically, so a user's undo only reverts their own edits, not a collaborator's concurrent changes — an important UX property: undo must never destroy someone else's work. Undo/redo state is per-session (client-side), not synced or persisted.

### 9.7 Offline Support

The client-side Yjs binding pairs with a local persistence provider (IndexedDB) that stores the document state and any not-yet-sent updates locally. While offline, editing continues normally against the local `Y.Doc` — the user experiences zero degradation. On reconnect, the sync handshake (§9.3) exchanges only what's missing in each direction, and because Yjs updates commute, updates made offline merge automatically with whatever happened on the server/other clients while disconnected — **no manual conflict resolution UI is needed for content merging.** The product-level "conflict" states (§16) are about _communicating this merge happened_, not about asking the user to pick a winner.

### 9.8 Why This Doesn't Need a "Conflict Resolution Algorithm" of Our Own

This deserves stating explicitly since it's the crux of the whole selection: because Yjs guarantees convergence for concurrent operations by construction, "conflict resolution" in this system is not a feature we build — it's a property we inherit by using the library correctly (correct update ordering at the protocol level, correct state-vector exchange on reconnect, correct persistence/compaction). Engineering effort goes into the _plumbing_ around Yjs (auth, persistence, scaling), not into inventing merge logic.

---

## 10. BullMQ / Background Jobs Planning

| Job                                                                                            | Trigger                                                                                                                                  | Why it's async, not inline                                                                     | Idempotency approach                                                                                                      |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Document snapshot/compaction**                                                               | Debounced: N seconds after the last edit to a document, or a max-interval fallback (e.g., "at least every 5 minutes if actively edited") | Merging an update log into a snapshot is CPU work that must not block the real-time relay path | Snapshot job checks the log's last-compacted sequence number before writing; re-running against the same range is a no-op |
| **Search indexing**                                                                            | On document metadata/content-checkpoint change                                                                                           | Full-text index updates shouldn't add latency to the save/edit path                            | Upsert keyed by documentId — reprocessing is safe                                                                         |
| **Email sending** (invitations, mention notifications, comment replies)                        | Domain event (invite created, mention detected, etc.)                                                                                    | External SMTP/provider latency must never block the triggering request                         | Include an idempotency key per notification event to avoid duplicate sends on retry                                       |
| **In-app notification fan-out**                                                                | Same domain events as above                                                                                                              | Potentially fans out to many recipients; shouldn't block the triggering action                 | Upsert per (event, recipient) pair                                                                                        |
| **Document cleanup** (hard-delete after soft-delete grace period, orphaned attachment cleanup) | Scheduled/cron-style repeatable job                                                                                                      | Batch scans over "deletable" rows are not request-scoped work                                  | Scans by expiry timestamp; deleting an already-deleted row is a safe no-op                                                |
| **Exports** (document → PDF/Markdown/etc.)                                                     | User-initiated, explicitly async due to potentially large documents                                                                      | Rendering/export can be slow and shouldn't hold an HTTP connection open                        | Job writes to S3 and notifies the user on completion; re-running regenerates the same artifact safely                     |
| **Imports** (bringing in external content)                                                     | User-initiated                                                                                                                           | Parsing untrusted file formats is variable-latency and should be sandboxed/queued              | Import job is transactional at the document-creation level — partial failure doesn't leave a half-created document        |
| **Thumbnail generation**                                                                       | On image upload                                                                                                                          | Image processing (resize/compress) is CPU-bound and shouldn't block the upload response        | Thumbnail keyed by source-file hash — regenerating is a safe overwrite                                                    |

**Design note on debouncing:** the snapshot job is the most important one to get right, since it directly affects reopen latency for heavily-edited documents. BullMQ's delayed-job + job-id-based deduplication ("only one pending snapshot job per document at a time, and re-scheduling an existing delayed job simply pushes its execution time out") is the mechanism used to implement debouncing without a separate scheduler.

---

## 11. WebSocket Architecture (Deep Dive)

### 11.1 Connection Lifecycle

1. Client establishes a Socket.IO connection, authenticated via the same session cookie used for REST (Socket.IO reads the cookie during the HTTP upgrade handshake — no separate token scheme needed).
2. Server validates the session against Redis (§6.3, §8). Unauthenticated connections are rejected at handshake, before any room join is attempted.
3. Client emits a "join document room" event with a document ID.
4. Server re-validates: is this user a member of the workspace, and does their resolved permission level allow viewing this document? (Reuses the same permission-resolution path as REST, see §7.7 — one source of truth, not a parallel WebSocket-only auth system.)
5. On success, the socket joins a Socket.IO room scoped to that document ID, receives the Yjs sync handshake (§9.3), and begins exchanging updates + awareness state.
6. On disconnect (clean or timeout), the socket leaves the room; its awareness entry expires; if it was the last connection in the room, the server ensures the latest state is durably persisted before evicting the in-memory `Y.Doc`.

### 11.2 Authorization at the Socket Layer

A common mistake is trusting a valid HTTP session as sufficient for _any_ room join. This system explicitly re-runs permission resolution per room-join request, because workspace/document permissions can change mid-session (a user can be removed from a document while their socket is still connected) — periodic re-validation (or at minimum, validation on every join and on a periodic interval for long-lived connections) prevents a stale-permission window from becoming a real access-control gap.

### 11.3 Heartbeat & Reconnect

Socket.IO's built-in ping/pong heartbeat detects dead connections faster than relying on TCP timeouts alone. On the client, exponential backoff reconnect is used to avoid thundering-herd reconnection storms after a server restart or brief outage. On reconnect, the client re-runs the join handshake from scratch (re-authorization + Yjs sync-step-1/2), which naturally also re-syncs any content missed during the disconnect window.

### 11.4 Horizontal Scaling: Sticky Sessions vs. Redis Pub/Sub Adapter

| Approach                                                                                        | How it works                                                                                                                                                                                                       | Pros                                                                                                                                               | Cons                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sticky sessions only** (load balancer pins a client to one server instance by cookie/IP hash) | All clients editing the same document _happen_ to land on the same instance                                                                                                                                        | Simple; no cross-instance messaging needed if it always works                                                                                      | Fragile: doesn't guarantee two users on the _same document_ land on the _same instance_ unless routing is document-aware (which a simple LB isn't) — this alone is insufficient |
| **Redis Pub/Sub adapter for Socket.IO (`@socket.io/redis-adapter`)**                            | Every instance subscribes to a shared Redis channel; a message emitted to a "room" on one instance is broadcast via Redis to all instances, which then deliver to their own locally-connected sockets in that room | Correctly handles the real requirement — two users on the same document, connected to _different_ server instances, still see each other's updates | Adds Redis as a hard dependency for real-time correctness at scale (already true for sessions, so not a new dependency class)                                                   |
| **Selected approach**                                                                           | **Both, combined:** sticky sessions as an optimization (reduces cross-instance chatter when it does work out) + the Redis adapter as the correctness guarantee (handles the case where it doesn't)                 | —                                                                                                                                                  | —                                                                                                                                                                               |

This combination is the standard, production-proven pattern for scaling Socket.IO horizontally, and it directly enables the scaling story in §14.

### 11.5 Broadcast Optimization

Naively, every keystroke's Yjs update could be broadcast individually. In practice: (a) Yjs updates are already small binary diffs, not full documents, so per-update overhead is low; (b) the server can still **batch outgoing updates within a short window (tens of milliseconds)** per room to reduce message count under heavy concurrent editing, trading a small amount of latency for significantly reduced message overhead at high concurrency. Awareness updates (cursor position) are the higher-frequency signal and are explicitly throttled client-side (e.g., on a short interval, not on every mousemove) before they ever hit the wire.

### 11.6 Connection Limits & Failure Recovery

Each server instance sets a maximum concurrent-connection ceiling appropriate to its resources; the load balancer/orchestrator adds instances horizontally as this ceiling is approached (see §14). If an instance crashes, in-flight awareness state for its connections is lost (acceptable, per §9.5/§8 — it's ephemeral by design), and document content is not lost because updates are durably persisted on receipt (§9.4), not held only in memory pending some later flush.

---

## 12. Synchronization Flow, Step by Step

**User A types a character:**

1. **Local update:** the rich-text editor binding (ProseMirror/TipTap + Yjs binding) translates the keystroke into a local `Y.Doc` mutation.
2. **Yjs:** this mutation is encoded as a small binary update and applied immediately to A's local `Y.Doc` — A sees the character instantly, with zero network round-trip (this is the optimistic-UI guarantee).
3. **Local persistence (offline-safe):** the update is also written to A's local IndexedDB store via the offline provider (§9.7), so it survives a page refresh even before reaching the server.
4. **WebSocket:** the update is sent over A's existing socket connection to the document's room on the server.
5. **Server:** the server (a) appends the update to the durable append-only log for this document (§9.4), and (b) relays it — via the Socket.IO Redis adapter if other participants are connected to different instances — to every other socket in that document's room.
6. **Other users:** User B's client receives the update over its own socket, applies it to B's local `Y.Doc` (Yjs guarantees this merges correctly regardless of arrival order relative to any of B's own concurrent edits), and B's editor re-renders the change — typically within tens of milliseconds on a healthy connection.
7. **Persistence (durable, compacted):** independently of the real-time path, the debounced BullMQ snapshot job (§10) periodically compacts the growing update log into a new baseline snapshot, bounding future load time.

This flow is deliberately **fire-and-forget from the client's perspective for the happy path** — A does not wait for server acknowledgment to see their own character, and does not wait for B to receive it either. The only place synchronous waiting matters is the _initial_ room-join handshake (§9.3), where the client does need the authoritative starting state before it can be sure its subsequent edits are against the right baseline.

---

## 13. Offline Editing & Conflict Resolution

### 13.1 Offline Storage

The client-side Yjs `Y.Doc` is mirrored into IndexedDB continuously (not just on disconnect) via the offline persistence provider, so "offline editing" isn't a special mode the app enters — it's simply what happens when the WebSocket layer can't reach the server; the editor itself is unaware and keeps working against local state.

### 13.2 Reconnect & Merge

On reconnect, the client performs the sync-step-1/sync-step-2 handshake (§9.3) exactly as it would on first load — the server computes the delta the client is missing, the client computes (implicitly, via Yjs's internal state vector) the delta the server is missing, and both sides exchange only those deltas. Because Yjs updates are commutative and idempotent, **this merge is automatic and correct without any manual "resolve conflict" step** — this is the single biggest UX win of the CRDT choice over any diff/patch or locking-based approach.

### 13.3 What "Conflict" Means in This System

Because content-level conflicts are resolved automatically, the product never shows a "these two versions conflict, pick one" dialog for document text. The only user-facing "conflict-adjacent" states are:

- **A brief "reconnecting…" / "changes saved" indicator** during the handshake window, so the user has confidence their offline edits made it to the server.
- **Two users editing the same table cell or reordering the same list concurrently** — Yjs resolves this deterministically (e.g., via consistent tie-breaking on structural moves), but the _product_ can optionally surface a subtle "X also edited this" hint so the merge doesn't feel invisible/confusing, even though no user action is required.

### 13.4 Retry & Failure Cases

If the WebSocket connection cannot be re-established at all (e.g., the user is genuinely offline for an extended period), the client retries with exponential backoff and continues to allow local editing indefinitely — there is no hard offline time limit, since local Yjs state has no dependency on server availability. If the _server itself_ fails to persist an update after receiving it (e.g., a transient Postgres error), the server-side write path retries with backoff before acknowledging; the client-side update remains safely queued (both in the client's own Yjs state and, transiently, unflushed on the server's write-ahead path) until persistence succeeds, rather than the server acknowledging receipt prematurely.

### 13.5 Data Consistency Guarantee

The end-to-end guarantee is: **any update that reached the server's append-only log is durable**, and **any update currently in a client's local `Y.Doc` (online or offline) will eventually reach the server's log**, given enough retries. Combined with Yjs's convergence guarantee, this gives eventual consistency across all replicas (every connected/reconnecting client, plus the server's durable copy) without requiring a locking or last-writer-wins scheme that could silently drop a user's work.

---

## 14. Scalability: 10 → 10,000,000 Users

| Stage                | What works as-is                                                                                                                                                                                      | What breaks first                                                                                                                                                                                                                                                                 | Architectural response                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **10 users**         | Everything — single Express instance, single Postgres instance, single Redis instance, one WebSocket process                                                                                          | Nothing; this stage exists to prove correctness, not to prove scale                                                                                                                                                                                                               | None needed; resist the urge to over-engineer here                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **1,000 users**      | Still largely fine on modest infrastructure                                                                                                                                                           | Occasional connection-count pressure on one WebSocket instance during peak concurrent editing; a single Postgres instance still comfortably handles CRUD + FTS load                                                                                                               | Introduce a second WebSocket instance + the Redis Socket.IO adapter (§11.4) _before_ it's strictly required, since retrofitting horizontal scaling under load is riskier than doing it early. Add read-through Redis caching for hot permission lookups (§8) if not already present.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **100,000 users**    | Control-plane REST traffic is horizontally scaled behind a load balancer; Postgres is still a single primary but may show write contention on hot tables (WorkspaceMember, Document metadata updates) | Full-text search latency starts degrading as per-workspace document counts grow into tens of thousands; a single Postgres primary starts showing connection-pool pressure; BullMQ workers may need to scale out horizontally to keep up with snapshot/notification volume         | Add Postgres read replicas for read-heavy queries (dashboard lists, search); introduce connection pooling (PgBouncer or equivalent) in front of Postgres; evaluate migrating search to a dedicated engine (Meilisearch/Elasticsearch) per the trigger identified in §7.6; scale BullMQ workers horizontally (they're stateless consumers by design, so this is a straightforward scale-out)                                                                                                                                                                                                                                                                                                                           |
| **10,000,000 users** | Nothing "as-is" — this stage requires genuine architectural evolution, not just adding instances                                                                                                      | A single Postgres primary cannot serve global write load; a single-region deployment adds unacceptable latency for geographically distant users; the WebSocket tier's Redis pub/sub adapter starts becoming a fan-out bottleneck if many documents are extremely high-concurrency | **Database sharding/partitioning** by workspace ID (workspaces are a natural shard key since almost all queries are workspace-scoped, per §7.7); **regional deployment** with document "home regions" to keep latency low and to avoid a single global WebSocket fan-out plane; potential **decomposition into services** (auth/session service, real-time sync service, search service, notification service) so each scales independently and can be owned by separate teams; S3 already scales natively at this tier without redesign; consider a purpose-built pub/sub backbone (e.g., Kafka or NATS) for cross-region presence/update propagation if Redis pub/sub alone becomes a bottleneck for global fan-out |

**The throughline:** the architecture is deliberately structured (stateless control-plane servers, a CRDT sync model that doesn't require central sequencing, Redis-backed rather than in-memory session/presence state, workspace-scoped data access patterns) so that the _first_ three stages require only "add more of the same," and only the final, extreme stage requires genuine structural changes (sharding, regionalization, service decomposition) — and even then, the core sync model (Yjs) and authorization model don't need to be reinvented, only redistributed.

---

## 15. Security

| Area                                   | Approach                                                                                                                                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OAuth**                              | Authorization Code + PKCE; verified-email requirement; explicit confirmation step for cross-provider account linking (§6.2) to prevent silent account takeover                                                            |
| **Session security**                   | HttpOnly + Secure + SameSite=Lax cookies; opaque Redis-backed session IDs (not JWTs holding sensitive claims); server-side revocation support                                                                             |
| **Document & workspace authorization** | Every mutation and every socket room-join re-resolves permissions server-side (§6.4, §11.2); no client-supplied role/permission data is ever trusted                                                                      |
| **WebSocket authentication**           | Same session cookie validated at handshake; per-room-join re-authorization, not just per-connection                                                                                                                       |
| **Session hijacking mitigation**       | Secure/HttpOnly cookies prevent JS-based theft; session rotation on privilege-relevant events (e.g., re-authentication) reduces fixation risk                                                                             |
| **CSRF**                               | SameSite=Lax cookies as a baseline, plus explicit CSRF tokens on state-changing REST endpoints that could otherwise be triggered cross-site (belt-and-suspenders, since SameSite alone has historical edge cases)         |
| **XSS**                                | Rich-text content is rendered through the editor's sanitized rendering path, never via raw `dangerouslySetInnerHTML` of user content; any embed/link-preview rendering sanitizes and sandboxes external content           |
| **Rate limiting**                      | Redis-backed sliding-window limits on sensitive endpoints — invitation sending, comment posting, login attempts, search queries — to blunt both abuse and accidental client-bug-driven floods                             |
| **Spam/abuse**                         | Invitation and comment rate limits double as anti-spam controls; consider CAPTCHA or provider-trust-based friction only if abuse patterns actually emerge, rather than pre-emptively                                      |
| **Audit logs**                         | Workspace-scoped audit log records permission changes, ownership transfers, member removals, and deletions — visible to workspace admins (§4.14)                                                                          |
| **Encryption**                         | TLS in transit everywhere (REST and WebSocket); encryption at rest via the managed Postgres/S3 provider's native at-rest encryption; no custom crypto is built in-house                                                   |
| **Secrets management**                 | OAuth client secrets, database credentials, and S3 keys live in environment-specific secret stores (platform secret manager or CI/CD-injected environment variables), never committed to the repository, and never logged |

---

## 16. Performance

| Technique                                      | Where it applies                                                                                                                                                                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Lazy loading**                               | Document tree/sidebar loads children on expand, not the entire workspace tree upfront; comment threads load on demand rather than inline with every document open                                                      |
| **Document chunking / snapshot-based loading** | Large, long-lived documents load from the latest compacted snapshot plus only the update-log tail since that snapshot (§9.4), not the full edit history                                                                |
| **Virtualization**                             | Long documents and large document lists (search results, workspace document tree) render via windowing so DOM node count stays bounded regardless of underlying data size                                              |
| **Caching**                                    | Redis caches hot permission lookups and potentially hot document-tree shapes (§8); TanStack Query caches REST responses client-side with targeted invalidation                                                         |
| **Batching**                                   | Server batches outgoing Yjs update broadcasts within a short window under high concurrency (§11.5); notification fan-out jobs batch recipient processing rather than one job per recipient                             |
| **Compression**                                | WebSocket transport compression where supported; S3-stored exports/attachments served via compressed transfer where the content type benefits                                                                          |
| **Incremental updates**                        | Core to the entire sync model — Yjs updates are diffs, not full-document payloads, by construction (§9.1, §9.3)                                                                                                        |
| **Database optimization**                      | Targeted composite indexes (§7.4) matched to actual query patterns rather than indexing speculatively; read replicas introduced at the scale stage where they earn their operational cost (§14)                        |
| **Connection pooling**                         | Postgres access goes through a connection pool (Prisma's built-in pooling at moderate scale, an external pooler like PgBouncer once instance count grows per §14) to avoid connection exhaustion under concurrent load |

---

## 17. UI Flow Planning (Structure, Not Visual Design)

### 17.1 Pages / Top-Level Routes (conceptual, not literal paths)

- **Auth entry** (sign in with Google/GitHub)
- **Workspace selection / creation** (post-auth landing if the user belongs to zero or multiple workspaces)
- **Dashboard** (per §4.13: recent, shared-with-me, favorites, templates, activity)
- **Document view/editor** (the core surface)
- **Workspace settings** (members, invitations, permissions, danger zone: transfer ownership, delete workspace)
- **Account settings** (profile, connected providers, sessions, notification preferences)
- **Admin panel** (per §4.14, scoped to workspace admins)

### 17.2 Navigation Model

A persistent workspace switcher (top-level, always visible) sits above a document tree sidebar scoped to the active workspace; the document editor occupies the main surface. This mirrors the "workspace-first" principle from §1 — navigation structure should make the active workspace context unmissable, since permissions and content are entirely workspace-scoped.

### 17.3 State Categories the UI Must Explicitly Design For

- **Loading states:** initial document load (before the Yjs sync handshake completes) must show a distinct "loading document" state, not a blank editor that could be mistaken for an empty document.
- **Offline states:** a persistent-but-unobtrusive indicator that the user is offline and editing locally, per §13 — reassuring, not alarming, since editing continues to work.
- **Reconnecting/merge states:** brief, calm feedback during the sync handshake on reconnect (§13.2), distinct from the initial-load state.
- **Conflict-adjacent states:** subtle "someone else also edited this" affordances (§13.3) — never a blocking modal, since no user decision is actually required.
- **Error states:** clearly distinguished from offline states — an error means something is actually broken (e.g., permission revoked mid-session, document deleted by another user) and does require user acknowledgment, unlike offline/reconnect states.
- **Success states:** low-emphasis confirmation (e.g., "all changes saved") rather than intrusive toasts, since saving is continuous and automatic, not a discrete user-triggered action.

---

## 18. API Philosophy (REST Control Plane)

- **Versioning:** URL-path versioning (e.g., a `/v1/` prefix) from day one, even with only one version in existence — this avoids an awkward first migration later and costs nothing now.
- **Error handling:** a consistent error envelope (status code + machine-readable error code + human-readable message) across all endpoints, so client-side error handling can be written generically rather than per-endpoint.
- **Validation:** every request body validated against a Zod schema at the route boundary before any business logic runs — the same schema (or a close variant) used by React Hook Form client-side, so validation rules are defined once conceptually even without shared TypeScript types.
- **Pagination:** cursor-based pagination (not offset-based) for any list endpoint that can grow unbounded (document lists, notifications, audit logs), since offset pagination degrades and can produce duplicate/skipped results under concurrent writes.
- **Permissions:** authorization is resolved as its own middleware step, separate from business logic, so every endpoint has a visible, auditable "who is allowed to call this" check rather than permission logic scattered inline.
- **Response format:** a consistent envelope shape for success responses too (not just errors), so client-side response handling is uniform.

---

## 19. Coding Standards

| Area                        | Standard                                                                                                                                                                                                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Naming**                  | Descriptive, unabbreviated names for anything crossing a module boundary; consistent casing conventions (camelCase for JS variables/functions, PascalCase for React components) enforced by linting, not convention alone                                               |
| **Validation**              | Zod at every trust boundary (API input, form input, environment variable parsing at startup) — since the stack is JavaScript, Zod is the substitute for compile-time type safety and is treated as non-optional                                                         |
| **Logging**                 | Structured (JSON) logs in the server processes, with correlation IDs threaded through a request (and, where feasible, through the async job triggered by that request) so a single user action can be traced end-to-end                                                 |
| **Comments**                | Reserved for _why_, not _what_ — code should be self-explanative for _what_ it does; comments explain non-obvious trade-offs or link back to the relevant section of this document where a decision was made                                                            |
| **Git commits**             | Conventional-commit-style prefixes (feat/fix/chore/refactor/docs) to keep history machine-parseable for changelog generation                                                                                                                                            |
| **Environment variables**   | Validated at process startup via a Zod schema (fail fast on missing/malformed config rather than failing deep inside a request handler)                                                                                                                                 |
| **Configuration**           | Environment-specific config lives in environment variables / secret managers, never in committed files; feature flags (if introduced later) are treated as configuration, not as scattered conditionals                                                                 |
| **Architecture boundaries** | Control-plane (REST) and real-time-plane (WebSocket) code live in clearly separated modules even if co-deployed initially, so they can be split into separate deployable processes later without a rewrite — this directly supports the horizontal-scaling story in §14 |

---

## 20. Testing Strategy

| Test type                 | What it covers                                                                                                                                                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Unit tests**            | Pure logic: permission-resolution functions, Zod schema behavior, snapshot-compaction logic in isolation                                                                                                                                              |
| **Integration tests**     | REST endpoints against a real (test) Postgres instance — verifying authorization middleware, validation, and persistence together, not mocked in isolation                                                                                            |
| **WebSocket tests**       | Room join/authorization flows, Awareness broadcast correctness, reconnect handshake behavior against a real Socket.IO test server instance                                                                                                            |
| **Synchronization tests** | Simulated concurrent edits from multiple simulated Yjs clients, asserting eventual convergence to the same document state regardless of update ordering — this is the highest-value test category given how central Yjs correctness is to the product |
| **Load testing**          | Simulated high connection counts per document room and across many rooms, verifying the Redis pub/sub adapter and broadcast-batching behavior hold up under concurrency (§11.4, §11.5)                                                                |
| **Concurrency testing**   | Race-condition-prone paths specifically: simultaneous permission changes during an active socket session, simultaneous snapshot-job triggers for the same document (verifying idempotency, §10)                                                       |
| **Offline testing**       | Simulated network partition mid-edit, verifying local editing continues, IndexedDB persistence holds, and reconnect merge produces the expected converged state                                                                                       |
| **Recovery testing**      | Server-instance restart mid-session, verifying clients reconnect and resync correctly without data loss                                                                                                                                               |
| **Security testing**      | Authorization bypass attempts (calling REST/WebSocket actions with insufficient permission), session fixation/hijacking scenarios, CSRF/XSS regression tests                                                                                          |
| **End-to-end testing**    | Full user journeys (sign in → create workspace → create document → invite collaborator → concurrent edit → verify both see the same result) run against a staging-like environment                                                                    |

---

## 21. DevOps

- **Docker + Docker Compose** for local development, standing up Postgres, Redis, and the two Node processes (control plane, real-time plane) as separate services from the start — reinforcing the architectural boundary from §19 even in local dev.
- **CI/CD via GitHub Actions:** lint + unit/integration test gates on every pull request; a separate, slower pipeline stage for synchronization/load tests that doesn't block every commit but gates releases.
- **Environment separation:** distinct configuration (and where feasible, distinct infrastructure) for local, staging, and production — no shared database between staging and production, ever.
- **Secrets:** injected via the deployment platform's secret manager (Vercel/Railway environment variables, or a VPS-hosted secret store), never committed, never present in CI logs.
- **Deployment targets:** Vercel for the Next.js frontend (a natural fit given the framework); Railway or a VPS for the Express control-plane and real-time-plane Node processes, since these need long-lived WebSocket connections that don't fit a purely serverless model.
- **Rollback:** every deployment is tied to an immutable build artifact/image tag, so rollback is "redeploy the previous tag," not a manual revert process.
- **Monitoring & backups:** automated Postgres backups with a tested restore procedure (a backup that's never been restored from is not a real backup); S3 versioning enabled for attachment/export storage as a low-cost safety net.

---

## 22. Observability

| Signal                      | What's tracked                                                                                                                                                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Logs**                    | Structured, correlation-ID-tagged logs across both control-plane and real-time-plane processes (§19), shipped to a centralized log store                                                                                     |
| **Metrics**                 | Standard service metrics (request rate, latency, error rate) for the control plane; WebSocket-specific metrics for the real-time plane (see below)                                                                           |
| **WebSocket metrics**       | Concurrent connection count, connections per document room (to spot unusually hot documents), disconnect/reconnect rate, average time-to-first-sync on join                                                                  |
| **Synchronization metrics** | Update-broadcast latency (time from server receipt to relay), snapshot/compaction job duration and success rate, update-log growth rate per document (a leading indicator of documents that need more aggressive compaction) |
| **Tracing**                 | Distributed tracing across a request's path through control-plane → (optionally) triggered BullMQ job, so a slow user-facing action can be traced to its actual bottleneck                                                   |
| **Health checks**           | Liveness/readiness endpoints for both the control-plane and real-time-plane processes, plus a Redis/Postgres connectivity check, wired into the deployment platform's health-check/restart policy                            |

---

## 23. Documentation Plan

The following documents should exist alongside the codebase, each with a clear owner and scope:

- **README** — project overview, local setup via Docker Compose, how to run tests
- **Architecture** — this document, kept current as the source of truth for "why," linked from the README
- **Synchronization / Yjs guide** — a developer-facing deep dive into §9 and §12-13, since this is the highest-complexity, highest-risk part of the system for a new contributor to misunderstand
- **WebSocket guide** — developer-facing detail on §11, especially the authorization re-validation pattern, since it's easy to accidentally weaken
- **Database guide** — entity/relationship documentation (§7), kept in sync with actual Prisma schema once it exists, including the rationale for the self-referential document tree
- **Deployment guide** — concrete, current instructions matching §21, since deployment docs rot fastest
- **API reference** — generated or hand-maintained REST contract documentation, following the conventions in §18
- **Contributing guide** — coding standards (§19), commit conventions, and PR/test expectations

---

## 24. Design Review Addendum — Quantitative Analysis, SLOs, Failure Modes, Operational Readiness

_The following sections were added after an internal design review pass. The prior sections describe mechanisms correctly; this addendum sizes them, gives them targets, and asks "what fails first, and how do we know."_

### 24.1 Durability Invariant — Ack/Persistence Ordering (Correctness Gap, Not a Redesign)

§12 and §13.5 imply, but never state as an invariant, the ordering between receiving an update over a socket and durably persisting it. This must be an explicit, testable contract:

- **Invariant:** the server MUST append an incoming Yjs update to durable storage (Postgres append-only log, or an equivalent write-ahead mechanism) **before** that update is considered "received" for the purposes of any downstream guarantee — specifically, before evicting the room's in-memory state, and before treating the client's local copy as safely discardable from its own offline queue (§13.1).
- **What is _not_ required to block on persistence:** broadcasting the update to other connected clients. Relay-to-peers can and should happen without waiting on the durable write, to preserve the sub-100ms perceived-latency goal (§24.2) — the durability guarantee and the low-latency broadcast are allowed to race, _as long as the client's own retry/offline-queue logic does not discard the update until the server has ack'd persistence specifically_, not merely socket delivery.
- **Bounded data-loss window (RPO):** with this contract, the only loss scenario is a server process crash in the sub-millisecond-to-low-single-digit-millisecond window between receiving bytes off the socket and the persistence write completing, for updates whose _client-side_ copy has also already been evicted (which shouldn't happen per the above). With the client-side retention rule enforced, **RPO is effectively zero** for any client that remains reachable long enough to receive a persistence ack and retry otherwise. This should be written down as an explicit invariant and covered by a dedicated crash-recovery test (§24.4), not left implicit.

### 24.2 Capacity Model (Back-of-Envelope, by Stage)

These are Fermi estimates to size the scaling table in §14, not measured benchmarks — each should be replaced with real load-test numbers before it's used to justify a purchasing or provisioning decision, but every number in this system should currently be treated as **unknown and untested** rather than assumed safe.

| Metric                                                    | 1,000 users              | 100,000 users                                                                                                                                                                                                                                                                                | 10,000,000 users                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Assumed peak concurrency                                  | ~20% (200 concurrent)    | ~5% (5,000 concurrent)                                                                                                                                                                                                                                                                       | ~5% (500,000 concurrent)                                                                                                                                                                                                                                                                       |
| Concurrent WebSocket connections/instance (idle-weighted) | single instance, trivial | ~5,000–10,000/instance is a reasonable planning ceiling for a modest (4 vCPU / 8 GB) Node instance carrying Socket.IO + in-memory Yjs room state, _not_ just idle sockets                                                                                                                    | requires dozens of instances even at the low end; connections/instance ceiling becomes secondary to Redis pub/sub fan-out capacity (below)                                                                                                                                                     |
| "Hot" documents held in memory/instance                   | negligible               | active-room memory is the real constraint, not connection count — a typical text document's in-memory `Y.Doc` is on the order of tens to a few hundred KB; budget for **~2,000–5,000 concurrently-open rooms/instance** before memory pressure, not connection count, becomes the bottleneck | same per-instance ceiling; total active-room count now requires horizontal partitioning of _which instance owns which room_, since a single Redis pub/sub channel fanning out to hundreds of instances for a single hot document becomes the limiting factor (see §24.4, "hot document")       |
| Redis pub/sub message rate                                | trivial                  | assume ≤1% of concurrent users are actively mid-keystroke at any instant (most connections are idle/viewing) → **~50 msgs/sec** system-wide, trivial for one Redis instance                                                                                                                  | same 1% assumption → **~5,000 msgs/sec** system-wide; a single Redis instance can plausibly sustain this, but a single _hot_ document with thousands of concurrent editors can locally exceed the per-channel fan-out budget — this is the trigger for room-level sharding, not aggregate load |
| Postgres write QPS (append-only update log)               | trivial                  | assume 1% actively editing × ~2 updates/sec each ≈ **~100 writes/sec** sustained, bursting higher                                                                                                                                                                                            | ≈ **10,000 writes/sec** sustained — this is the number that should trigger the Postgres read-replica / connection-pooler / sharding decisions in §14, not a vague "at 100K scale, add replicas"                                                                                                |
| Redis memory (sessions + presence)                        | negligible               | ~5,000 concurrent × (session ~200B + presence ~200B) ≈ a few MB                                                                                                                                                                                                                              | ~500,000 concurrent × same ≈ low hundreds of MB — still comfortably single-instance; Redis memory is **not** the scaling trigger at any modeled stage, pub/sub fan-out and connection count are                                                                                                |
| Update-log storage growth (pre-compaction)                | negligible               | assume avg active document accumulates ~10–50 KB of uncompacted update log between compaction runs                                                                                                                                                                                           | same per-document bound; total system storage growth is a function of **document count × compaction interval**, not user count directly — this argues for compaction-interval as the primary lever if storage growth outpaces plan, before reaching for infrastructure changes                 |

**The concrete action item this section creates:** every number above needs a real load test to replace it before the 100,000-user stage is reached in production, and the 10,000,000-user numbers are provided only to validate that the _shape_ of the architecture (stateless control plane, Redis-mediated real-time fan-out, workspace-scoped sharding key) doesn't hit a hard wall — not as a provisioning target.

### 24.3 Service Level Objectives & Error Budgets

No target numbers exist anywhere in the current document — "is the system healthy" currently has no defined answer. Proposed SLOs:

| SLI                                                                                      | Target (SLO)                                                                                                  | Error budget (monthly)                                            | Notes                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Control-plane API availability                                                           | 99.9%                                                                                                         | ~43 minutes                                                       | Standard REST availability target; measured as successful (non-5xx) responses / total                                                                                                                       |
| Control-plane API latency                                                                | p50 < 150ms, p99 < 800ms                                                                                      | —                                                                 | Excludes long-running export/import endpoints, which have their own async-completion SLO instead                                                                                                            |
| Real-time layer availability (able to establish and maintain a document room connection) | 99.5%                                                                                                         | ~3.6 hours                                                        | Deliberately looser than the REST SLO — persistent-connection infrastructure has materially different failure modes (§24.4) and a tighter target here would be dishonest given current operational maturity |
| Time-to-first-sync (room join → first content visible)                                   | p50 < 300ms, p99 < 2s                                                                                         | —                                                                 | p99 tail deliberately generous to account for large/uncompacted documents; a document consistently missing this should page (compaction backlog signal)                                                     |
| Cross-client edit propagation latency (same region)                                      | p50 < 150ms, p99 < 500ms                                                                                      | —                                                                 | This is the number users actually feel as "collaboration feels real-time" — it deserves to be a first-class dashboard metric, not inferred from broadcast logs after the fact                               |
| Durability (§24.1 invariant)                                                             | **Zero tolerance** — any confirmed loss of a persisted-then-lost edit is a Sev1, not an SLO-percentage metric | N/A — this is a correctness invariant, not a probabilistic target | Availability/latency SLOs can be traded off against an error budget; durability cannot — this distinction should be explicit so on-call doesn't treat a durability incident like a latency blip             |

**Alerting policy:** per standard SRE practice, alerts should fire on **multi-window, multi-burn-rate** conditions against these SLOs (e.g., a fast-burn alert on 1-hour error budget consumption at a rate that would exhaust the monthly budget in a day, plus a slow-burn alert over 6 hours) rather than static threshold alerts — this avoids both alert fatigue on transient blips and slow detection of a real, sustained degradation. This detail is currently entirely absent from §22.

### 24.4 Failure Mode Analysis

None of the following scenarios are discussed in the current document. Each needs a detection mechanism, a known blast radius, and a runbook before this system is production-ready — "the architecture supports X" is not the same claim as "we know what happens when X breaks."

| Failure                                                                                                                                                                                                                         | Detection                                                                                                        | Blast radius                                                                                                                                                                                                                                                                   | Existing mitigation                                                                                         | Residual gap / action item                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Redis total outage** (not just a flush — the process/cluster is down)                                                                                                                                                         | Health-check failures on the Redis connectivity probe (§22)                                                      | Sessions unreadable → mass forced logout; Socket.IO cross-instance broadcast stops working entirely (not degraded, _stopped_, since the pub/sub adapter has no local fallback)                                                                                                 | None specified today                                                                                        | Need an explicit degraded-mode decision: does the real-time tier fall back to single-instance-only broadcast (silently breaking cross-instance collaboration) or refuse new room joins outright? Currently undefined — this is a real gap, not just missing docs. Recommend: fail closed (reject new room joins with a clear "service degraded" state) rather than silently serving partial collaboration. |
| **Redis pub/sub partition** (Redis up, but network-partitioned from some server instances)                                                                                                                                      | Missed heartbeat/ack from the adapter on affected instances                                                      | **Split-brain risk:** two users on the same document, on instances on opposite sides of the partition, stop seeing each other's edits but both believe they're synced — worse than an outright outage because it's silent                                                      | None specified                                                                                              | Needs an active health check _per instance_ on pub/sub connectivity that, on failure, forces that instance to reject/evict its own room memberships rather than continue serving a silently-partitioned view                                                                                                                                                                                               |
| **Postgres primary failure**                                                                                                                                                                                                    | Standard connection-failure/health-check detection                                                               | Control-plane writes fail; update-log appends fail → per the §24.1 invariant, this should mean the real-time tier also stops accepting new updates for affected documents (fail closed, not fail silent)                                                                       | Managed Postgres failover (assumed, not stated)                                                             | RTO/RPO for failover need to be explicitly stated and tested, not assumed from the hosting provider's marketing page                                                                                                                                                                                                                                                                                       |
| **WebSocket instance crash mid-edit-burst**                                                                                                                                                                                     | Load balancer health check + Socket.IO client disconnect                                                         | Bounded to that instance's connections; per §24.1, no durable data loss if the invariant holds                                                                                                                                                                                 | Client auto-reconnect + resync (§9.3, §13.2)                                                                | Needs an explicit test that specifically crashes an instance under load and verifies zero data loss end-to-end (not just "should be fine because Yjs")                                                                                                                                                                                                                                                     |
| **Hot/viral document** (e.g., an all-hands doc with thousands of concurrent viewers/editors)                                                                                                                                    | Per-room connection-count metric exceeding a defined threshold (§22 doesn't currently define one)                | A single room's broadcast fan-out can exceed one instance's or one Redis channel's practical throughput, degrading that document for everyone in it — and potentially pressuring the whole instance hosting it, affecting _unrelated_ documents co-located on the same process | None — the current architecture treats all rooms as equally sized                                           | This is the closest thing to an actual design gap worth flagging seriously: **no room-level resource isolation exists.** Recommend a per-room connection ceiling with graceful degradation (e.g., beyond N concurrent editors, switch presence/cursor broadcast to a reduced-frequency mode first, since that's the cheaper-to-shed load, before affecting content sync)                                   |
| **Poison / malformed Yjs update** (corrupted bytes, a client bug, or a malicious payload)                                                                                                                                       | Should be caught by update validation/decoding before it's appended to the durable log — not currently discussed | If an invalid update _is_ persisted and later replayed during compaction, it could break compaction for that document entirely, effectively bricking the document                                                                                                              | None specified                                                                                              | Needs (a) strict validation/decode-and-discard-on-failure before persistence, and (b) a compaction-job safeguard that isolates a single bad update rather than failing the whole job, plus alerting when this occurs (should never happen, so it's a strong signal something upstream is broken)                                                                                                           |
| **Snapshot/compaction job failure loop**                                                                                                                                                                                        | BullMQ job failure/retry metrics                                                                                 | A document whose compaction job keeps failing accumulates an ever-growing update log, which makes every future load slower and every future compaction attempt more expensive — a genuine death spiral for that one document                                                   | Retry/backoff (generic, per §10)                                                                            | Needs a dead-letter path with alerting after N failed attempts, and a manual/forced "best-effort partial compaction" fallback rather than infinite retry against a growing log                                                                                                                                                                                                                             |
| **OAuth provider outage** (Google or GitHub identity API down)                                                                                                                                                                  | Elevated error rate on the OAuth callback endpoint                                                               | New logins and new account linking fail; **existing sessions should be unaffected**, since session validity is Redis-based, not provider-dependent per request (§6.3) — but this needs to be verified, not assumed                                                             | Redis-backed sessions (already decouples ongoing sessions from provider uptime, if implemented as designed) | Should be an explicit test: sessions survive a simulated OAuth-provider outage; only new sign-ins are affected                                                                                                                                                                                                                                                                                             |
| **Client version skew during rollout** (Yjs library or wire-protocol version differs between an old client tab left open and a newly-deployed server)                                                                           | Not currently discussed at all                                                                                   | Worst case: a subtle encoding mismatch causes update rejection or, worse, silent misinterpretation                                                                                                                                                                             | None                                                                                                        | Needs an explicit compatibility policy: server accepts N-1 client protocol versions during rollout, and client bundles are versioned so a stale tab can detect "server has moved on" and prompt a reload rather than silently degrading                                                                                                                                                                    |
| **Cascading reconnect storm** (many clients disconnect simultaneously — e.g., a regional network blip or a server fleet restart — and all reconnect at once)                                                                    | Connection-rate spike metric                                                                                     | Reconnect handshakes (§9.3) all re-run sync-step-1/2 simultaneously, potentially spiking Postgres read load for state-vector diffing right when the system is already recovering                                                                                               | Exponential backoff is mentioned (§11.3)                                                                    | Backoff needs **jitter**, explicitly — pure exponential backoff without jitter is well known to still produce synchronized retry waves; this is a one-line fix but currently unstated                                                                                                                                                                                                                      |
| **Update-log storage exhaustion** (a specific document's log grows unboundedly because its compaction job is stuck — a special case of the compaction-failure-loop above, but from a storage/ops rather than correctness angle) | Per-document update-log size metric (not currently in §22)                                                       | Slow disk growth is generally not urgent, but an unbounded single-document log could theoretically approach any per-row/per-table size practical limits over long enough time                                                                                                  | Debounced compaction (§10) assumes it always succeeds                                                       | Add a per-document log-size ceiling metric and alert threshold well before any practical storage limit, tied to the same dead-letter path as the compaction-failure case above                                                                                                                                                                                                                             |

### 24.5 Operational Readiness

- **WebSocket-aware deployment (connection draining):** §21's deployment section treats the real-time tier like any other stateless service. It is not one. A rolling deploy must **drain connections gracefully** — signal an instance to stop accepting new room joins, allow existing sessions to finish their current edit burst or hit a grace-period timeout, and only then terminate, while clients reconnect (via the existing backoff-with-jitter, per §24.4) to a healthy instance. Deploying the real-time tier the same way as the stateless control plane (rely on the load balancer to just stop routing to a terminated instance) risks mid-edit disconnects for every active session on that instance simultaneously during every deploy.
- **Capacity headroom policy:** production traffic should be kept at a defined ceiling below the last validated load-test capacity (a common practice is operating at no more than ~60–70% of tested maximum) rather than discovering the real ceiling in production. This should be a standing operational policy, re-validated on a regular cadence (e.g., quarterly) as usage grows, not a one-time exercise.
- **Chaos / game-day practice:** each row in §24.4's failure table should correspond to a deliberately-triggered exercise in a staging environment — kill a Redis node, fail a Postgres primary, saturate one room with simulated connections — on a recurring schedule, not just as a one-time pre-launch checklist item. A failure mode that's only ever been reasoned about on paper is not the same as one that's been rehearsed.
- **Backup restore validation:** §21 mentions automated Postgres backups; this should be paired with a **scheduled, actually-executed restore test** (not just a backup-exists check), since an untested backup has an unknown RTO and an unknown chance of being restorable at all.
- **Paging policy:** on-call should page on SLO burn-rate violations (§24.3), not on raw infrastructure metrics (CPU%, etc.) in isolation — the latter produces alerts that don't map to user-visible impact and is a common source of alert fatigue that causes real incidents to be missed.
- **Noisy-neighbor / multi-tenancy isolation:** related to the hot-document failure mode above, but broader — one workspace's unusually heavy usage (very large documents, very high edit rate, very large membership) should not be able to degrade service for unrelated workspaces sharing the same instance. This isn't addressed anywhere in the current resource model and should be, at minimum, a monitored dimension (per-workspace resource consumption) even before an enforcement mechanism (quotas) is built.

---

## 25. Implementation Roadmap (Phases — Not Yet Expanded)

The following phases are proposed as the logical build order. Each will be expanded into detailed, scoped implementation prompts individually in future work — this section only establishes the sequence and its rationale.

- **Phase 0 — Foundations:** repository structure, Docker Compose environment, base Express + Next.js scaffolding, environment/config validation, CI pipeline skeleton.
- **Phase 1 — Auth & Sessions:** OAuth (Google, GitHub), Redis-backed sessions, account linking, protected route middleware.
- **Phase 2 — Workspaces & Permissions:** workspace CRUD, membership, invitations, role model, permission resolution (the foundation everything else authorizes against).
- **Phase 3 — Document Metadata & Tree:** document CRUD, nested-page tree, folders-as-documents, tags, search (Postgres FTS baseline), dashboard views.
- **Phase 4 — Real-Time Core:** WebSocket server, Socket.IO room management, Redis pub/sub adapter, Yjs integration (sync protocol + persistence + snapshot compaction), Awareness/presence.
- **Phase 5 — Rich Text Editor:** editor bindings, block types, slash commands, Markdown shortcuts, undo/redo.
- **Phase 6 — Collaboration Features:** comments, mentions, suggestions, sharing/permission UI, live cursors/avatars in the editor surface.
- **Phase 7 — Version History:** snapshot browsing, restore, comparison/diff view.
- **Phase 8 — Files & Notifications:** S3 uploads, thumbnailing, email + in-app notifications, BullMQ job suite completion.
- **Phase 9 — Admin, Audit, and Hardening:** admin panel, audit logs, security-testing pass, rate limiting rollout.
- **Phase 10 — Observability & Scale Readiness:** metrics/tracing/health checks, load testing, and validating the Stage 1→2 scaling responses from §14 before wider rollout.

---

_End of blueprint. This document should be revisited and amended as decisions evolve — treat contradictions between this document and the eventual implementation as a signal to update whichever one is wrong, not to silently drift._
