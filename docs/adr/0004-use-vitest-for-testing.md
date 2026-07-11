# 4. Use Vitest for Testing

Date: 2026-07-11
Status: Accepted

## Context

We need a robust test runner for unit and integration testing across the workspace. We considered `Jest` and `Vitest`.

## Decision

We will use **Vitest** as our primary testing framework.

## Consequences

- **Pros:**
  - Native ESM and TypeScript support out of the box without complex transpilation steps or babel configs.
  - API is mostly compatible with Jest, making it a familiar transition.
  - Very fast execution due to underlying Vite/esbuild usage.
- **Cons:**
  - A newer ecosystem than Jest, meaning potentially fewer edge-case plugins or community workarounds.
