# 3. Use Pino for Logging

Date: 2026-07-11
Status: Accepted

## Context
We need a unified logging strategy across our Node.js services (API, WebSocket, Worker) to ensure consistent, parseable, and high-performance logs. We considered standard `console.log`, `winston`, and `pino`.

## Decision
We will use **Pino** as our standard logging library, wrapped in a shared `@workspace/logger` package.

## Consequences
- **Pros:**
  - High performance with extremely low overhead.
  - Emits JSON logs by default, which is perfect for structured log ingestion in production.
  - Easily format logs for local development readability using `pino-pretty`.
- **Cons:**
  - Requires developers to pipe logs through `pino-pretty` locally if they prefer human-readable formatting over raw JSON.
