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

## Authentication & Local Development

This API uses **Arctic** for OAuth authentication. For local development, you will need to register OAuth applications to acquire client credentials:

1. **Google**: Create an OAuth 2.0 Client ID in the Google Cloud Console. Set the authorized redirect URI to `http://localhost:3001/auth/google/callback`.
2. **GitHub**: Create an OAuth App in GitHub Developer Settings. Set the authorization callback URL to `http://localhost:3001/auth/github/callback`.

Once created, populate the corresponding `OAUTH_*` credentials in your root `.env` file (see `.env.example`).
