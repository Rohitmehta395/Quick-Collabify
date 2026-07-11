# 2. Use pnpm for Package Management

Date: 2026-07-11
Status: Accepted

## Context
A monorepo requires a robust package manager to handle workspace linking, dependency hoisting, and fast installation times across multiple sub-projects. The standard choices are npm workspaces, Yarn workspaces, or pnpm workspaces.

## Decision
We will use **pnpm** and its workspace feature as our package manager.

## Consequences
- **Pros:**
  - Strict dependency resolution. `pnpm` avoids ghost dependencies by using a content-addressable store and symlinking packages.
  - Significantly faster installation times and lower disk space usage compared to npm/Yarn.
  - Excellent, built-in monorepo support (e.g., `pnpm --filter`).
  - Production deployment primitives (`pnpm deploy --prod`) make containerizing single services extremely efficient.
- **Cons:**
  - Strict linking can sometimes expose missing dependencies in poorly configured third-party packages.
  - Team members must install and learn `pnpm` instead of defaulting to `npm`.
