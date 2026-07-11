# 1. Use Monorepo Architecture

Date: 2026-07-11
Status: Accepted

## Context

We are building a real-time collaborative notes application consisting of a frontend web app, a backend REST API, a WebSocket realtime service, and a background worker. These services share significant overlap in domain logic, data models (Prisma schema), utilities (logging, errors), and configuration validation. We needed to decide whether to place these services in independent repositories (polyrepo) or co-locate them in a single repository (monorepo).

## Decision

We will use a **Monorepo Architecture** to contain all applications and shared packages.

## Consequences

- **Pros:**
  - Effortless code sharing across boundaries (e.g., frontend and backend sharing the same validation schemas).
  - Atomic commits across services (updating an API endpoint and the frontend that consumes it in a single PR).
  - Streamlined dependency management and unified tooling (linting, formatting).
- **Cons:**
  - Requires advanced CI/CD setups to ensure we only build and deploy what has changed.
  - Can grow large over time, requiring strict boundaries to prevent "big ball of mud" coupling.
