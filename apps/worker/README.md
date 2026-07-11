# Background Worker Service

The asynchronous background job processor for the workspace, built using BullMQ and Redis.

## Responsibilities

- Execute heavy or non-blocking tasks out-of-band (e.g., email notifications, document exports, cache warming).
- Consume jobs queued by the API or Realtime services via Redis.

## Commands

- `pnpm dev`: Start the worker process in watch mode.
- `pnpm start`: Start the compiled production worker process.
