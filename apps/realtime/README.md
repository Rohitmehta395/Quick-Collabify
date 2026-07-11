# Realtime WebSocket Service

The dedicated WebSocket server for the collaborative workspace, built using raw `ws`.

## Responsibilities

- Manage active client connections for live documents.
- Broadcast operational transforms or CRDT updates between connected clients.
- Maintain a high-concurrency, stateful connection pool.

## Commands

- `pnpm dev`: Start the realtime server in watch mode.
- `pnpm start`: Start the compiled production server.
