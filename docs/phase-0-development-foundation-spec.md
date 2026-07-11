# Phase 0 — Development Foundation: Engineering Specification

**Status:** Draft for team review — implementation begins only after sign-off
**Scope:** Roadmap Phase 0 only (`implementation-roadmap.md`)
**Precondition:** none — this is the first implementation document
**Rule in effect:** no application code is written against this spec until it is approved; no Phase 1 work begins until Phase 0's acceptance criteria (§18) are met in full

---

## 1. Goals

- Produce a professional engineering foundation that every subsequent phase builds on without needing to revisit tooling, structure, or process decisions.
- Make the "decision surface" for foundational choices (monorepo vs. multi-repo, package manager, branching model, logging library, etc.) explicit and closed *now*, so later phases spend their effort on product work, not infrastructure debate.
- Ensure a new engineer can go from `git clone` to a fully running local stack, and from a first commit to a merged, CI-verified PR, using only what this phase establishes.
- Establish patterns (config validation, structured logging, error handling, commit conventions) that are correct on day one, since retrofitting them across a growing codebase later is materially more expensive than deciding them once here.

## 2. Scope

This phase covers everything required to develop, lint, test (at the infrastructure level), containerize, and CI-gate the project — with **zero application features**. Concretely in scope:

- Repository and folder structure (monorepo layout)
- Docker and Docker Compose for local development
- Environment variable contract and startup-time validation
- Configuration system shared across services
- Logging and error-handling architecture (patterns, not business logic)
- Git workflow: branching, commit conventions, hooks
- Linting, formatting, and their enforcement
- CI pipeline (GitHub Actions)
- Dependency management policy
- Baseline security posture for the repository and containers
- Coding/naming/documentation standards that all future phases follow
- A working `/health` endpoint and a placeholder frontend page — the only "functional" code in this phase, included solely to prove the pipeline end-to-end

## 3. Non-Goals

Explicitly **not** part of this phase, to prevent scope creep into Phase 1+:

- No authentication, no `User`/`Identity` tables, no OAuth setup (Phase 1)
- No workspace, document, or any other domain table beyond a trivial migration smoke test
- No real-time process logic (Socket.IO handlers, Yjs) — the process is scaffolded (Dockerfile, entrypoint, health check) but contains no domain logic
- No production deployment configuration (Vercel/Railway specifics) — this phase is about local development and CI; deployment-target configuration is addressed when there's something worth deploying
- No UI design system beyond installing and theming shadcn/ui's base tokens — no product screens
- No performance tuning, no observability stack (metrics/tracing) — that's Phase 21, once there's real traffic to observe

## 4. Repository Structure

### 4.1 Monorepo vs. Multi-Repo Decision

| Approach | Pros | Cons |
|---|---|---|
| **Multi-repo** (separate repos for frontend, API, real-time service, worker) | Clean deploy boundaries; independent versioning; smaller individual checkouts | Cross-cutting changes (a shared Zod schema used by both frontend and backend, per architecture §18/§19) require coordinated PRs across repos and versioned package publishing just to share code internally; a small team pays this coordination tax on nearly every phase, since most phases touch both an API contract and its consuming UI |
| **Monorepo** (single repo, multiple packages/apps) | Shared Zod schemas, config, and types live in one place and are consumed directly (no publish/version step for internal code); one PR can span a schema change and its consumers atomically; single CI pipeline, single source of truth for tooling versions | Requires workspace tooling (below) to keep packages properly isolated; a misconfigured build can accidentally couple packages that shouldn't be coupled |
| **Selected: Monorepo** | — | — |

**Reasoning:** the architecture explicitly relies on sharing validation logic (Zod schemas) between the Next.js frontend and the Express backend "written once conceptually" (architecture §3.2, §18). A multi-repo setup would force either duplicated schema definitions (a correctness risk — the two copies *will* drift) or a published internal package with a release cycle, which is disproportionate overhead for a small team executing a sequential, one-phase-at-a-time roadmap. The monorepo is the only option that makes the shared-schema principle actually convenient rather than aspirational.

### 4.2 Workspace Tooling

| Approach | Pros | Cons |
|---|---|---|
| **npm workspaces** | Zero extra tooling, ships with npm | Weaker dependency isolation (npm's flat `node_modules` historically allows "phantom dependencies" — a package importing something it never declared, that happens to be hoisted from a sibling package) |
| **Yarn workspaces (Classic or Berry)** | Mature, widely used | Berry's Plug'n'Play mode has real compatibility friction with some tooling; Classic has the same phantom-dependency risk as npm |
| **pnpm workspaces** | Strict, symlinked `node_modules` structure that makes phantom dependencies fail loudly (a package cannot import something it didn't explicitly declare) — this is a meaningful correctness benefit for a project that is deliberately JavaScript-only (no TypeScript compiler to catch a wrong import at build time, per the stack requirement); fast, disk-efficient (content-addressable store shared across projects) | Slightly less universal familiarity than npm; a few older or poorly-behaved packages assume npm/yarn's flatter structure and occasionally need a workaround |
| **Selected: pnpm workspaces** | — | — |

**Reasoning:** given the project is JavaScript, not TypeScript, one of this codebase's biggest correctness risks is exactly the class of bug pnpm's strictness prevents — silently importing a module that isn't actually a declared dependency of the package doing the importing. This is a case where the package-manager choice directly compensates for a stack constraint already fixed elsewhere.

### 4.3 Folder Architecture

```
apps/
  web/            → Next.js 15 frontend
  api/            → Express control-plane (REST)
  realtime/       → Socket.IO real-time-plane process (scaffolded only in Phase 0)
  worker/         → BullMQ worker process (scaffolded only in Phase 0)
packages/
  config/         → Shared environment/config validation (Zod schemas + loader)
  schemas/        → Shared Zod schemas for domain objects, reused by web (forms) and api (request validation) per architecture §18
  logger/         → Shared structured-logging setup, reused by api/realtime/worker
  ui/             → Shared shadcn/ui-based component primitives (design tokens only in Phase 0; real components arrive with the phases that need them)
infra/
  docker/         → Dockerfiles per app
  compose/        → docker-compose.yml and any environment-specific overrides
docs/
  architecture/   → collaborative-workspace-architecture-blueprint.md, implementation-roadmap.md (this repo's source-of-truth docs)
  adr/            → Architecture Decision Records (see §25)
  phase-specs/    → Phase-by-phase specs like this document
.github/
  workflows/      → CI pipeline definitions
```

**Reasoning for `apps/` + `packages/` split (a standard, well-understood monorepo convention):** anything deployable/runnable as its own process lives in `apps/`; anything that exists purely to be imported by multiple apps lives in `packages/`. This boundary is what prevents the monorepo's main risk (accidental coupling) — a `packages/*` module must never import from `apps/*`, only the reverse, and this rule is enforced in the linter config (§14), not left as a convention people might forget.

Each `apps/*` and `packages/*` directory gets its own `package.json` (pnpm workspace member) and its own `README.md` per the documentation standard in §22.

## 5. Docker Strategy

### 5.1 Single Multi-Stage Dockerfile vs. Separate Dev/Prod Dockerfiles

| Approach | Pros | Cons |
|---|---|---|
| **Separate Dockerfiles** (`Dockerfile.dev`, `Dockerfile.prod`) | Each is simple and single-purpose | Duplicated base-image/dependency-install logic between the two; the two files drift over time (a fix applied to one is forgotten in the other) — a known, common source of "works locally, breaks in prod" bugs |
| **Single multi-stage Dockerfile with named targets** (`base`, `dev`, `build`, `prod`) | One file, one source of truth for base image and dependency installation; `docker build --target dev` vs `--target prod` selects the right output from the same definition; standard, well-understood Docker pattern | Slightly more upfront complexity to write correctly |
| **Selected: Single multi-stage Dockerfile per app, with named targets** | — | — |

Each of `apps/web`, `apps/api`, `apps/realtime`, `apps/worker` gets its own multi-stage `Dockerfile` in `infra/docker/`, targeting: `base` (shared OS + pnpm setup), `dev` (installs dev dependencies, runs with hot-reload), `prod` (production install only, no dev dependencies, smallest practical image).

### 5.2 Base Image

`node:20-alpine` is the baseline for all four apps' images — Alpine keeps image size and attack surface down; Node 20 is the LTS baseline this project pins to (see §26, "decisions that must never change later" — the Node major version is a foundational pin, not a per-phase choice).

## 6. Docker Compose Design

### 6.1 Services

| Service | Purpose | Notes |
|---|---|---|
| `postgres` | Primary datastore | Named volume for data persistence across restarts; healthcheck (`pg_isready`) gating dependent services |
| `redis` | Sessions, cache, pub/sub, job queue (architecture §8) | Healthcheck (`redis-cli ping`) gating dependent services |
| `api` | Control-plane Express process | Depends on `postgres` + `redis` healthchecks passing before starting, not just "container started" |
| `realtime` | Real-time-plane Socket.IO process | Scaffolded only — starts, passes its health check, has no domain logic yet |
| `worker` | BullMQ worker process | Scaffolded only — starts, connects to Redis, has no real jobs yet (Phase 2 adds the first one) |
| `web` | Next.js frontend | Depends on `api` being healthy |

### 6.2 Design Decisions

- **`depends_on` with `condition: service_healthy`**, not just default `depends_on` (which only waits for container start, not actual readiness) — this directly prevents the class of local-dev flakiness where the API starts before Postgres is actually accepting connections.
- **Named volumes for Postgres data**, so `docker-compose down` (without `-v`) preserves local data across restarts, but a clean `-v` teardown is available and documented for "start completely fresh" scenarios.
- **A single root `.env` file**, read by Compose and by each service's own config loader (§9) — not per-service `.env` files, to avoid the drift risk of keeping multiple environment files in sync locally.
- **No production secrets ever in `docker-compose.yml`** — only local-development defaults (e.g., a hardcoded local Postgres password), explicitly documented as dev-only and never reused in any deployed environment (§21).

## 7. Environment Variable Contract

### 7.1 Naming Convention

`SCREAMING_SNAKE_CASE`, with a service-scoping prefix only where a variable is genuinely service-specific and could otherwise be ambiguous (e.g., `API_PORT` vs `REALTIME_PORT`); variables genuinely shared across services (e.g., `DATABASE_URL`, `REDIS_URL`) are unprefixed.

### 7.2 Contract Rules

- Every environment variable consumed anywhere in the codebase must be declared in a Zod schema in `packages/config` (§8) — no direct, unvalidated `process.env.X` access anywhere in application code. This is enforced by a lint rule (§14), not just a convention.
- `.env.example` is committed and kept in sync with the actual schema — CI includes a check (§17) that fails if a variable exists in the schema but not in `.env.example`, or vice versa, preventing the two from silently drifting.
- Variables are classified into two categories, both validated but handled differently operationally:
  - **Configuration** (non-secret: ports, log level, feature flags) — safe to have sensible defaults and appear in `.env.example` with real example values.
  - **Secrets** (OAuth client secrets, database credentials, API keys) — `.env.example` shows the variable name with a placeholder (`OAUTH_GOOGLE_CLIENT_SECRET=changeme`), never a real or real-looking value, and these are the specific variables injected via the deployment platform's secret manager in non-local environments (per architecture §15/§19).

## 8. Configuration System

### 8.1 Approach

A single `packages/config` module, imported by every app (`api`, `realtime`, `worker`, and — for the subset of config the browser needs — `web`), responsible for:

1. Defining one Zod schema per app (each app validates only the variables it actually needs, not a single giant shared schema every app partially ignores).
2. Parsing `process.env` against that schema **once, at process startup**, before any other module runs.
3. Failing fast (non-zero exit, clear error listing exactly which variables are missing/malformed) rather than allowing a malformed config to be discovered deep inside a request handler.
4. Exporting a single, already-validated config object for the rest of the app to import — application code never touches `process.env` directly.

### 8.2 Why This Matters Given the JS-Only Constraint

Without TypeScript, there is no compiler to catch "this code assumes `PORT` is a number but it's actually a string from `process.env`." The Zod-at-startup pattern is this project's substitute for that category of safety, and it is treated as non-negotiable (architecture §19 already establishes this at the API-request-validation level; this phase extends the identical principle to configuration itself, applied consistently from the very first process that boots).

## 9. Logging Architecture

### 9.1 Library Choice

| Approach | Pros | Cons |
|---|---|---|
| **Winston** | Very configurable, widely known | Structured JSON output requires more manual configuration to get right and stay fast; historically slower than newer alternatives under high throughput |
| **Pino** | Structured JSON by default; among the fastest Node logging libraries (low overhead matters specifically on the real-time process's hot broadcast path, per architecture §11.5); simple, opinionated API that's hard to misuse into unstructured output | Less flexible formatting out of the box (rarely a real constraint here, since structured JSON is exactly what's wanted per architecture §22) |
| **Selected: Pino** | — | — |

### 9.2 Design

- All four apps log structured JSON via a shared `packages/logger` wrapper (consistent field names — `timestamp`, `level`, `correlationId`, `service`, `message`, plus arbitrary structured context — across every process, so log aggregation later doesn't have to reconcile four different shapes).
- **Correlation IDs:** generated at the entry point of a request (REST) or socket event (real-time), propagated through `AsyncLocalStorage` so nested function calls can log with the correlation ID automatically attached without threading it through every function signature manually. This is the mechanism architecture §22's tracing/observability section depends on, and it must exist from Phase 0, since retrofitting correlation-ID propagation into an already-large codebase is far more error-prone than establishing it before there's any business logic to thread it through.
- **Redaction:** the logger wrapper is configured to redact known-sensitive field names (`password`, `token`, `secret`, `authorization` headers, session cookies) at the serialization level, so a developer accidentally logging a full request object doesn't leak a secret into log storage — this is a blanket safeguard, not something each phase has to remember individually.
- **Log levels:** `error` (something broke, needs attention), `warn` (unexpected but handled), `info` (meaningful business events — request completed, job finished), `debug` (verbose, off by default in all non-local environments). Level is itself an environment variable (`LOG_LEVEL`), validated by the config system above.

## 10. Error Handling Strategy

### 10.1 Error Taxonomy

A shared `packages/config`-adjacent error module (or its own small `packages/errors` package — a decision left open only in the sense of "own package vs. folder inside `packages/config`," not in principle) defines:

- **`OperationalError`** (base class) — an expected, handleable failure (validation failure, not-found, unauthorized). Carries an HTTP-status-equivalent code and a machine-readable error code, matching the consistent error envelope architecture §18 already commits to.
- **`ProgrammerError`** (or simply: anything that is *not* an `OperationalError`) — a bug. These are never shown to the user with their raw message/stack; they're logged with full detail (via the Pino setup above) and surfaced to the client as a generic "something went wrong" response, since exposing internals of an unexpected error is both a security risk and rarely actionable for the caller.

### 10.2 Handling Per Process Type

- **API (Express):** a single centralized error-handling middleware, last in the middleware chain, maps `OperationalError` subclasses to the correct status code and the consistent envelope (architecture §18); anything else is logged as a `ProgrammerError` and returns a generic 500.
- **Real-time (Socket.IO):** equivalent centralized handling at the socket-event level — an unhandled error in an event handler must never crash the whole process or silently swallow the failure; it's caught, logged, and the specific socket is informed/disconnected as appropriate, without affecting other connections.
- **Worker (BullMQ):** job failures are caught by BullMQ's own retry mechanism (architecture §10), but the *logging* of a job failure follows the same `OperationalError`/`ProgrammerError` distinction, so job-failure logs are consistently structured with everything else.
- **Process-level safety net:** every process registers `uncaughtException`/`unhandledRejection` handlers that log the error with full context and then **exit the process** (relying on the container orchestrator to restart it) rather than continuing in a potentially corrupted state — "log and continue" on a truly unexpected error is explicitly rejected as a pattern, since it risks silent data corruption more than a clean, logged restart does.

## 11. Development Workflow

1. Branch from `main` (per branching strategy, §12).
2. Local development against `docker-compose up` (hot-reload enabled in each app's `dev` Docker target, or run natively against the Compose-provided Postgres/Redis if a contributor prefers native `pnpm dev` over containerized app processes — both are supported, Postgres/Redis are always containerized).
3. Commit using Conventional Commits (§13), enforced by a commit-msg hook (§15).
4. Push, open a PR against `main`.
5. CI (§17) must pass: lint, format-check, env-schema/`.env.example` sync check, build, and (from this phase forward) any tests that phase introduces.
6. At least one review approval required (branch protection rule) before merge.
7. Merge via squash-merge to `main`, keeping `main`'s history one commit per PR, readable and bisectable.

## 12. Git Branching Strategy

| Approach | Pros | Cons |
|---|---|---|
| **GitFlow** (long-lived `develop` + `main`, release branches, hotfix branches) | Clear separation of "in progress" vs. "released" | Designed for projects with distinct release trains and long-lived parallel work; this project is executing one sequential, single-team roadmap phase at a time — GitFlow's ceremony (merging to `develop`, then to `main` at release time) adds process overhead with no corresponding benefit here |
| **Trunk-based development** (`main` always deployable, short-lived feature branches merged frequently) | Matches the roadmap's own "one phase at a time, always deployable at the end of each phase" principle directly; CI on every PR keeps `main` trustworthy; simple mental model | Requires discipline to keep branches short-lived and CI genuinely gating merges (not a real con given this team is already committed to phase discipline) |
| **Selected: Trunk-based development** | — | — |

**Reasoning:** the roadmap's own working agreement ("every phase should leave the application in a deployable state") *is* the trunk-based development principle, restated. Adopting GitFlow's release-branch ceremony on top of a roadmap that already defines its own deployable checkpoints (each phase's Definition of Done) would be redundant process.

## 13. Commit Conventions

**Conventional Commits**, exactly as anticipated in the architecture doc (§19): `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`, `ci:`, `build:`, optionally scoped (e.g., `feat(api): add health endpoint`). Enforced by commitlint via a Husky `commit-msg` hook (§15) — not left as a style guideline, since consistent, machine-parseable commit history is what makes automated changelog generation and `git log`-based debugging actually useful later.

## 14. Linting

- **ESLint**, flat config (`eslint.config.js`), shared base config in the repo root, with per-app overrides only where genuinely necessary (e.g., `apps/web` needs React/JSX-specific rules that `apps/api` doesn't).
- Given the JS-only constraint, the ESLint config leans deliberately strict to compensate for the lack of a type checker: `no-undef`, `no-unused-vars` (error, not warn), `eqeqeq`, `no-implicit-coercion`, import-order enforcement, and — critically — a custom or configured rule enforcing the `apps/*` → `packages/*` one-directional-only import boundary from §4.3, so that boundary is enforced by tooling, not memory.
- A rule forbidding direct `process.env` access outside `packages/config` (§8.2), enforced via `no-restricted-syntax` or an equivalent, so the configuration-system discipline can't quietly erode as the codebase grows.

## 15. Formatting

- **Prettier**, with `eslint-config-prettier` disabling any ESLint formatting rules that would conflict (ESLint owns code-quality rules, Prettier owns formatting — the two are not allowed to fight each other over the same concern).
- Formatting is enforced at commit time (via `lint-staged`, §16) and re-verified in CI (§17) — CI is the actual gate; the pre-commit hook is a convenience that catches issues before they ever reach CI, not a substitute for it (a contributor can bypass a local hook; they cannot bypass CI on a protected branch).

## 16. Git Hooks

Via **Husky** + **lint-staged**:

- **`pre-commit`:** runs ESLint and Prettier against staged files only (fast, scoped feedback).
- **`commit-msg`:** runs commitlint against the commit message (§13).
- **`pre-push`:** optionally runs the (currently minimal) test suite before allowing a push — included from Phase 0 so the pattern exists, even though there's little to test yet; later phases' test suites run through this same hook without any hook-configuration change.

## 17. GitHub Actions Pipeline

A single workflow, triggered on every PR against `main` and on pushes to `main`:

1. **Setup:** checkout, install pnpm, restore/populate the pnpm store cache (keyed on the lockfile hash, so unchanged dependencies don't get re-downloaded every run).
2. **Lint:** ESLint across the whole workspace.
3. **Format check:** `prettier --check` (not `--write` — CI verifies, it doesn't fix).
4. **Env contract check:** verify `.env.example` and the `packages/config` Zod schemas are in sync (§7.2).
5. **Build:** `pnpm -r build` (or the equivalent per-app build step) across all workspace apps — catching, at minimum, syntax errors and broken imports across the `apps/*` → `packages/*` boundary, in the absence of a TypeScript compiler.
6. **Test:** `pnpm -r test` — currently minimal/empty per app, but the step exists and is gating from day one, per §19's requirement.
7. **Docker build smoke test:** build each app's `prod` Docker target (§5.1) to catch container-specific breakage early, without yet pushing/deploying any image.

Branch protection on `main` requires all of the above to pass, plus at least one review approval, before merge is allowed.

## 18. Dependency Management

- **pnpm workspaces** (§4.2) with a single committed lockfile (`pnpm-lock.yaml`) at the repo root — one lockfile for the whole monorepo, not one per app, so dependency resolution is consistent across all apps and CI installs deterministically.
- **Automated dependency updates:** Dependabot (or Renovate — either is acceptable; Dependabot is the lower-setup-friction default given native GitHub integration) configured to open PRs for outdated/vulnerable dependencies, gated through the same CI pipeline as any other PR — dependency bumps are never merged without passing lint/build/test, exactly like feature work.
- **New-dependency policy:** adding a new dependency to any `apps/*` or `packages/*` package requires a one-line justification in the PR description (what it does, why an existing dependency in the stack can't cover it) — a lightweight, non-bureaucratic check against dependency sprawl, not a formal approval process.
- **Version pinning:** exact versions (no `^`/`~` ranges) for dependencies shared across multiple workspace packages (to avoid two packages in the same monorepo silently resolving to different minor versions of the same library); caret ranges are acceptable for app-local, non-shared dependencies where the maintenance burden of exact pinning outweighs the benefit.

## 19. Local Development Setup

Documented in the root `README.md` (per §22), the process is:

1. `git clone` the repository.
2. `cp .env.example .env` (no manual value-hunting required for local development — every default in `.env.example` is a real, working local value, since none of it is a production secret, per §7.2).
3. `pnpm install` at the repo root (installs all workspace packages via pnpm's workspace resolution).
4. `docker-compose up` — brings up Postgres, Redis, and all four app processes, gated by healthchecks (§6.2).
5. Visit the frontend URL; confirm the placeholder page successfully calls the API's `/health` endpoint (this is the literal Phase 0 acceptance test, per §18 of the roadmap and §20 of this document).

No step in this process should require a Slack message to a teammate to figure out — that's the actual bar for this section being complete.

## 20. Security Considerations (Phase 0 Scope)

- `.env` is git-ignored; `.env.example` never contains a real secret (§7.2).
- Dependency vulnerability scanning runs in CI (via `pnpm audit` or Dependabot security alerts) — not blocking every PR on every low-severity advisory (that produces alert fatigue and gets ignored), but at minimum surfaced and reviewed on a regular cadence, with high/critical findings blocking merge.
- Docker images use the Alpine base (§5.2) specifically to minimize attack surface; `prod` targets never include dev dependencies or source maps that could leak internal structure.
- No default/example credentials in `docker-compose.yml` are ever reused outside local development — this is stated explicitly in the Compose file's comments, not left to assumption, since "the docker-compose password accidentally became the staging password" is a real, common mistake class.
- The `apps/*` → `packages/*` import boundary (§4.3) is itself a mild security-adjacent concern beyond code cleanliness — it prevents, for example, a frontend-facing package from accidentally importing something that pulls in server-only secrets-handling code into a client bundle.

## 21. Coding Standards

- **JSDoc on exported functions in `packages/*`** (the shared code every app depends on) — since there's no TypeScript compiler to document a function's contract for consumers, JSDoc comments describing parameters/return shapes are treated as load-bearing documentation for shared code specifically (not required with the same rigor for app-internal, non-exported functions, where the cost/benefit is weaker).
- **Zod as the runtime type system** everywhere a shape needs to be trusted across a boundary (already established for config in §8 and anticipated for API/forms in architecture §18) — this is the single most important coding standard in a JS-only codebase and is treated as non-negotiable, not a style preference.
- **Named exports preferred over default exports** — default exports allow a consumer to import the same thing under a different name in every file, which becomes a real readability/refactoring cost across a growing monorepo; named exports keep names consistent everywhere.
- **Pure functions preferred where reasonable**, particularly for anything that will need dedicated unit tests later (permission resolution in Phase 7 is the clearest future example, but the standard is set now so it's already the default habit).

## 22. Naming Conventions

| Element | Convention | Example |
|---|---|---|
| Files | kebab-case | `permission-resolver.js` |
| Variables, functions | camelCase | `resolvePermission()` |
| React components | PascalCase | `WorkspaceSwitcher.jsx` |
| Constants (module-level, truly constant) | SCREAMING_SNAKE_CASE | `MAX_UPLOAD_SIZE_BYTES` |
| Environment variables | SCREAMING_SNAKE_CASE | `DATABASE_URL` |
| Prisma models | PascalCase (Prisma convention), mapped to snake_case table/column names via `@map`/`@@map` | model `WorkspaceMember` → table `workspace_members` |
| Redis keys | colon-delimited namespace, established now for every future phase to follow | `session:{sessionId}`, `presence:{documentId}:{userId}`, `permcache:{userId}:{documentId}` |
| Git branches | `type/short-description` | `feat/phase-0-docker-compose` |

Establishing the Redis key-naming pattern here, even though nothing uses Redis meaningfully until Phase 1 (sessions), is deliberate: every later phase that touches Redis (presence in Phase 12, permission cache in Phase 7, job queues in Phase 2) inherits one consistent namespacing convention instead of each phase inventing its own.

## 23. Documentation Standards

- Every `apps/*` and `packages/*` directory has its own `README.md`: what it is, how to run it in isolation (where meaningful), and any package-specific setup notes.
- **Architecture Decision Records (ADRs)** live in `docs/adr/`, one file per significant decision, numbered sequentially (`0001-monorepo-vs-multi-repo.md`, `0002-package-manager-selection.md`, etc.) — the comparisons and reasoning in §4 through §18 of this document are exactly ADR material and should be extracted into that format as part of this phase's deliverables, so future engineers can find "why did we choose pnpm" without re-reading this entire spec.
- The root `README.md` covers the local setup steps from §19 and links to `docs/architecture/` (the frozen blueprint and roadmap) and `docs/adr/`.
- Comments in code follow the "why, not what" standard already set in architecture §19 — restated here as the concrete Phase 0 policy every future phase inherits.

## 24. Testing Strategy for Phase 0

### 24.1 Test Runner Choice

| Approach | Pros | Cons |
|---|---|---|
| **Jest** | Extremely widely used, huge ecosystem | Slower in large workspaces; ESM support has historically required extra configuration friction, relevant given this is a modern, ESM-leaning JS stack |
| **Vitest** | Fast (Vite-powered), native ESM support out of the box, Jest-compatible API (low switching cost for anyone with Jest experience), integrates cleanly with a pnpm-workspace monorepo | Younger ecosystem than Jest (not a meaningful risk at this project's scale) |
| **Selected: Vitest** | — | — |

### 24.2 What Phase 0 Actually Tests

There is no business logic yet, so this phase's "tests" are infrastructure-verification, not unit tests of application behavior:

- A smoke test asserting the `/health` endpoint returns a 200 with the expected shape.
- A config-validation test: given a deliberately malformed/incomplete environment, the config loader (§8) throws a clear, specific error rather than allowing the process to start silently misconfigured.
- The CI pipeline itself (§17) is the primary "test" of this phase — a PR with a lint violation, a formatting violation, an out-of-sync `.env.example`, and a broken build should each be independently verified to fail CI as expected, and a clean PR should be verified to pass.

## 25. Acceptance Criteria

Phase 0 is complete when **all** of the following are true:

1. A new engineer can clone the repo, run the four-step setup in §19, and reach a working `/health`-backed placeholder page with zero undocumented manual steps.
2. `docker-compose up` brings up all six services (§6.1) successfully, with Postgres/Redis healthchecks correctly gating dependent service startup.
3. Every environment variable used anywhere in the codebase is declared in a Zod schema in `packages/config` and mirrored in `.env.example`; CI fails if these fall out of sync.
4. A deliberately malformed environment (e.g., a missing required variable) causes the affected process to fail fast at startup with a clear error, not fail deep inside a request.
5. ESLint, Prettier, commitlint, and the `apps/*`→`packages/*` import-boundary rule are all enforced both locally (Husky hooks) and in CI (the actual gate).
6. The GitHub Actions pipeline (§17) runs on every PR and blocks merge on any failing step; branch protection on `main` requires it plus one review approval.
7. All four app Docker images (`web`, `api`, `realtime`, `worker`) build successfully via their `prod` targets, even though `realtime` and `worker` contain no domain logic yet.
8. Structured JSON logging with correlation-ID propagation is functioning and verifiable (a request through the API produces a log line with a correlation ID; nested calls within that request carry the same ID).
9. The centralized error-handling pattern (§10) is in place and demonstrably works (an intentionally-thrown `OperationalError` in the placeholder route produces the correct status code and envelope; an intentionally-thrown generic error produces a generic 500 without leaking internals).
10. At least the two Vitest tests described in §24.2 exist and pass in CI.
11. `docs/adr/` contains ADRs for each major decision in this document (monorepo choice, package manager, logging library, test runner, branching strategy — at minimum).
12. Root and per-package `README.md` files exist per §23.

## 26. Risks

| Risk | Mitigation |
|---|---|
| **Over-investing in foundation tooling before there's any product to justify it** — a real failure mode for "let's set this up properly" phases | This spec's scope (§2/§3) is deliberately bounded; anything not explicitly listed as in-scope is out of scope by default, and the acceptance criteria (§25) are the actual stopping point, not "keep polishing until it feels done" |
| **pnpm-specific tooling friction** with a library that assumes npm/yarn's flatter `node_modules` | Address on a case-by-case basis if/when it occurs (pnpm's `shamefully-hoist` escape hatch exists for exactly this); not worth pre-solving for a problem that may never materialize |
| **Docker Compose / production environment drift** — local dev "working" doesn't guarantee production parity, especially since production deployment targets (Vercel/Railway) aren't finalized in this phase | Explicitly deferred to a later phase's concern (production deployment configuration, not Phase 0's job) rather than trying to solve for an undetermined target now |
| **The `apps/*`→`packages/*` boundary rule being annoying enough that people route around it** (e.g., duplicating a schema locally instead of fixing an import) | The rule is enforced by lint (§14), not convention, specifically to remove the temptation — a lint failure is a clear, immediate signal, whereas a convention is easy to quietly violate under time pressure |

## 27. Common Mistakes

- Adding real business logic to `apps/realtime` or `apps/worker` "since I'm already in there" — both are explicitly scaffolding-only in this phase (§3); resist the urge to get ahead of the roadmap.
- Committing a `.env` file by accident — verify `.gitignore` covers it before the first commit, not after.
- Letting `.env.example` drift from the actual Zod schemas by editing one without the other — this is exactly what the CI check in §17 step 4 exists to catch; don't treat that check as optional or silence it.
- Using default exports "just this once" — small inconsistencies here compound into real refactoring friction once dozens of files exist.
- Treating Husky hooks as sufficient enforcement and skipping the equivalent CI checks — hooks are a convenience, not a gate; someone will eventually `--no-verify` past a hook, and CI must catch it regardless.
- Scattering `process.env.X` access throughout early route handlers "temporarily" — this is precisely the discipline that's hardest to retrofit once dozens of files depend on the pattern; get it right in the very first route.

## 28. Decisions That Must Never Change Later

These are the choices in this document with real migration cost if reversed after Phase 1+ begins depending on them. They are called out explicitly so the team treats them as settled, not as ongoing bikeshedding targets:

- **Monorepo structure** (§4.1) — reversing this later means untangling every shared-schema import across every app.
- **pnpm as the package manager** (§4.2) — switching package managers mid-project means regenerating lockfiles and re-validating dependency resolution across every workspace package.
- **Node 20 (LTS) as the runtime baseline** (§5.2) — a major Node version bump later is a deliberate, tested upgrade project, not a Phase 0 concern, but the *initial* baseline should not be casually changed once containers/CI are built around it.
- **The environment-variable contract pattern** (§7–8: Zod-validated, centralized, no direct `process.env` access) — retrofitting this discipline onto a codebase that grew without it is far more expensive than establishing it now, before any application code exists.
- **The Redis key-namespacing convention** (§22) — changing key formats after Phase 1's sessions and later phases' presence/cache/queue keys are in use requires a coordinated migration across every Redis consumer simultaneously.
- **Conventional Commits** (§13) — not costly to reverse technically, but the value of commit history is cumulative; switching conventions partway through fragments the changelog-generation and history-search benefit this pattern exists to provide.
- **The centralized error taxonomy (`OperationalError` vs. everything else) and the consistent API error envelope** (§10, echoing architecture §18) — every future phase's API endpoints and error-handling tests assume this shape; changing it later means touching every endpoint that was built against the old contract.

---

*This document requires team review and explicit sign-off before implementation begins. Once approved, Phase 0 is implemented in full against this specification, verified against §25's acceptance criteria, before any Phase 1 planning begins.*
