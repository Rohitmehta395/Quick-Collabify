# Core REST API

The main RESTful backend for the collaborative workspace application, built using Express.js and Prisma.

## Responsibilities

- Exposes HTTP endpoints for document and user management.
- Manages PostgreSQL interactions via Prisma ORM.
- Enforces HTTP-level authentication and authorization.

## Commands

- `pnpm dev`: Start the server in watch mode using native Node.js `--watch`.
- `pnpm start`: Start the compiled server.
- `pnpm prisma:generate`: Re-generate the Prisma client after schema changes.
- `pnpm prisma:migrate`: Apply pending migrations to the development database.
