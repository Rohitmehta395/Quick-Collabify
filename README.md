# Real-Time Collaborative Workspace

A real-time collaborative note-taking application using WebSockets, Next.js, and PostgreSQL, organized in a highly scalable monorepo architecture.

## Architecture

This project is a **pnpm workspace monorepo** consisting of four primary applications:
1. **Web (`apps/web`)**: The frontend React client powered by Next.js.
2. **API (`apps/api`)**: The core REST API powered by Express.js and Prisma (PostgreSQL).
3. **Realtime (`apps/realtime`)**: A WebSocket server utilizing standard `ws` for live collaboration sync.
4. **Worker (`apps/worker`)**: A background job processor using BullMQ (Redis) for heavy async tasks.

Shared libraries are located in `packages/`:
- `@workspace/config`: Centralized environment validation using Zod.
- `@workspace/logger`: Standardized structured logging using Pino.
- `@workspace/errors`: Common error classes for standard HTTP error responses.

## Prerequisites

- **Node.js**: v20+
- **pnpm**: v9+ (Install via `npm i -g pnpm`)
- **Docker & Docker Compose**: Required for running the local PostgreSQL and Redis databases.

## Local Setup

1. **Install dependencies:**
   ```bash
   pnpm install
   ```
2. **Setup environment variables:**
   Copy the example environment file:
   ```bash
   cp .env.example .env
   ```
3. **Start local databases (PostgreSQL & Redis):**
   ```bash
   docker compose -f infra/compose/docker-compose.yml up -d postgres redis
   ```
4. **Run database migrations & generate Prisma client:**
   ```bash
   pnpm --filter api prisma:migrate
   pnpm --filter api prisma:generate
   ```
5. **Start all development servers:**
   ```bash
   pnpm dev
   ```

## Useful Commands

- `pnpm lint`: Lint all packages using ESLint.
- `pnpm format`: Format all code using Prettier.
- `pnpm test`: Run the Vitest test suite across the workspace.
- `pnpm approve-builds`: Authorize build scripts after adding new native dependencies.

## Design Decisions

See the Architecture Decision Records in `docs/adr/` for the history and rationale of technical decisions (e.g., monorepo setup, test runner choices).
