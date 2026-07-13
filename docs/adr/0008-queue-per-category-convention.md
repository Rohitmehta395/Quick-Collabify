# 8. Use One Queue Per Job Category

Date: 2026-07-14
Status: Accepted

## Context

Phase 2 introduces BullMQ for background job processing, starting with a welcome email job. Future phases will introduce vastly different background tasks, such as search indexing, document snapshot compaction, and workspace invitations. We need to decide how to structure queues in BullMQ: a single monolithic queue differentiated by a `type` field, or a separate queue for each distinct job category.

## Decision

We will use **one queue per job category** (e.g., `email_queue`, `compaction_queue`).

## Consequences

- **Pros:**
  - **Tuning and Isolation:** Each queue can have its own concurrency, priority, and retry configuration tuned to its specific characteristics (e.g., CPU-heavy compaction vs. lightweight external API calls).
  - **Monitoring:** Backlogs or failures in one queue are naturally isolated. "How backed up is compaction?" is a direct metric rather than a filtered query.
  - **Scaling:** Workers can be scaled horizontally per-queue if certain categories experience higher load.
- **Cons:**
  - Increases the nominal number of queues to manage and configure as the system grows.
  - Workers must explicitly register processors for multiple queues if they are intended to handle more than one category.
