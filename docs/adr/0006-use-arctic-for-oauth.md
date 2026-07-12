# 6. Use Arctic for OAuth Client

Date: 2026-07-12
Status: Accepted

## Context

For our authentication and identity foundation, we need to support OAuth 2.0 sign-in against multiple providers (Google and GitHub) using the Authorization Code flow with PKCE (where supported). We need a library that simplifies OAuth URL generation, state/PKCE verification, and token exchange, without tightly coupling us to a specific monolithic framework or imposing an opaque "black-box" authentication architecture (like Passport or NextAuth).

## Decision

We will use **Arctic** (`arctic`) as our OAuth client library.

## Consequences

- **Pros:**
  - Provides a clean, framework-agnostic API for generating authorization URLs and exchanging codes.
  - Implements PKCE (Proof Key for Code Exchange) by default for supported providers.
  - Keeps our authentication flow completely under our control (we manage our own routes, Redis state storage, and session lifecycles).
  - Lightweight and strictly focused on OAuth integration rather than session/user management.
- **Cons:**
  - Requires us to manually wire up our own Redis state storage and cookie management for the `state` and PKCE `code_verifier`, which is more boilerplate than an all-in-one auth framework, but gives us the necessary control for our architecture.
