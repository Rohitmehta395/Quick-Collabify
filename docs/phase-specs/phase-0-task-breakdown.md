# Phase 0 — Task Breakdown

**Source spec:** `phase-0-development-foundation-spec.md`
**Rule in effect:** tasks are implemented strictly in order, one at a time. A task is not started until its listed dependencies are merged to `main`.
**Total tasks:** 30

---

### P0-T01 — Repository Initialization

- **Goal:** Initialize the git repository with the baseline files every subsequent task assumes exist.
- **Files affected:** `.gitignore`, `LICENSE` (if applicable), `README.md` (stub only — real content in T30).
- **Dependencies:** none.
- **Estimated time:** 30 min.
- **Verification steps:** `git status` is clean after initial commit; `.gitignore` correctly excludes `node_modules`, `.env`, build output directories, and OS/editor cruft (verified by creating a throwaway `.env` and confirming `git status` doesn't show it).
- **Git commit message:** `chore: initialize repository`

---

### P0-T02 — pnpm Workspace Configuration

- **Goal:** Establish the monorepo's workspace root — pnpm as the package manager, workspace member globs, root scripts.
- **Files affected:** `package.json` (root), `pnpm-workspace.yaml`, `.npmrc`.
- **Dependencies:** P0-T01.
- **Estimated time:** 30 min.
- **Verification steps:** `pnpm install` succeeds at the repo root with zero workspace members yet declared (an empty install is a valid state at this point); `pnpm -v` matches the version pinned in `.npmrc`/`package.json`'s `engines` field.
- **Git commit message:** `chore: configure pnpm workspace`

---

### P0-T03 — Folder Skeleton

- **Goal:** Create the full `apps/`, `packages/`, `infra/`, `docs/` folder structure per the spec's §4.3, each with a placeholder `README.md` stating its purpose (no functional code yet).
- **Files affected:** `apps/{web,api,realtime,worker}/README.md`, `packages/{config,schemas,logger,errors,ui}/README.md`, `infra/{docker,compose}/.gitkeep`, `docs/{architecture,adr,phase-specs}/`.
- **Dependencies:** P0-T02.
- **Estimated time:** 45 min.
- **Verification steps:** Directory tree matches the spec's §4.3 layout exactly; every `apps/*` and `packages/*` folder has a non-empty `README.md`.
- **Git commit message:** `chore: scaffold monorepo folder structure`

---

### P0-T04 — ESLint Base Configuration

- **Goal:** Set up the shared ESLint flat config at the repo root, including the strict rules called for given the JS-only stack (`no-undef`, `no-unused-vars` as error, `eqeqeq`, import-order) and the custom `apps/*`→`packages/*` one-directional import-boundary rule.
- **Files affected:** `eslint.config.js` (root), root `package.json` (devDependencies + lint script).
- **Dependencies:** P0-T03.
- **Estimated time:** 60 min.
- **Verification steps:** Running lint against a deliberately-violating throwaway file (unused variable, and a fake `packages/*` file importing from `apps/*`) produces the expected errors; running lint against a clean file passes.
- **Git commit message:** `chore: configure ESLint base rules and import boundaries`

---

### P0-T05 — Prettier Configuration

- **Goal:** Add Prettier with a shared config and disable any ESLint formatting rules that would conflict with it.
- **Files affected:** `.prettierrc`, `.prettierignore`, root `package.json` (devDependencies + format script), `eslint.config.js` (add `eslint-config-prettier`).
- **Dependencies:** P0-T04.
- **Estimated time:** 30 min.
- **Verification steps:** `prettier --check .` passes on a freshly formatted throwaway file and fails on a deliberately misformatted one; confirm ESLint no longer flags any pure-formatting issue Prettier already owns.
- **Git commit message:** `chore: configure Prettier and resolve ESLint conflicts`

---

### P0-T06 — Husky Pre-Commit Hook

- **Goal:** Install Husky and configure a `pre-commit` hook running `lint-staged` (ESLint + Prettier against staged files only).
- **Files affected:** `.husky/pre-commit`, root `package.json` (`lint-staged` config block, `prepare` script).
- **Dependencies:** P0-T05.
- **Estimated time:** 45 min.
- **Verification steps:** Staging a file with a lint violation and attempting to commit is blocked with a clear error; staging a clean file commits successfully; confirm the hook actually runs after a fresh `pnpm install` on a clean clone (tests the `prepare` script wiring).
- **Git commit message:** `chore: add Husky pre-commit hook with lint-staged`

---

### P0-T07 — Commitlint Setup

- **Goal:** Enforce Conventional Commits via a `commit-msg` Husky hook.
- **Files affected:** `commitlint.config.js`, `.husky/commit-msg`, root `package.json` (devDependencies).
- **Dependencies:** P0-T06.
- **Estimated time:** 30 min.
- **Verification steps:** A commit message not following Conventional Commits format (e.g., `"fixed stuff"`) is rejected; a properly formatted message (e.g., `"chore: test commitlint"`) is accepted.
- **Git commit message:** `chore: add commitlint with Conventional Commits enforcement`

---

### P0-T08 — Scaffold `packages/config`

- **Goal:** Create the `packages/config` package's own `package.json` and internal folder structure (no schemas yet — just the package shell, wired into the pnpm workspace).
- **Files affected:** `packages/config/package.json`, `packages/config/src/` (empty entry file).
- **Dependencies:** P0-T03.
- **Estimated time:** 30 min.
- **Verification steps:** `pnpm install` at the root recognizes `packages/config` as a workspace member (`pnpm list -r` shows it); a throwaway import from another workspace package resolves correctly.
- **Git commit message:** `chore: scaffold packages/config package`

---

### P0-T09 — API Environment Schema & Loader

- **Goal:** Define the Zod schema for every environment variable `apps/api` needs, plus the startup-time parse-and-fail-fast loader function, inside `packages/config`.
- **Files affected:** `packages/config/src/api-config.js` (or equivalent), `packages/config/src/load-config.js` (shared loader utility).
- **Dependencies:** P0-T08.
- **Estimated time:** 60 min.
- **Verification steps:** Calling the loader with a complete, valid mock environment returns a correctly-shaped config object; calling it with a missing required variable throws a clear, specific error identifying exactly which variable is missing/malformed.
- **Git commit message:** `feat(config): add API environment schema and loader`

---

### P0-T10 — Realtime & Worker Environment Schemas

- **Goal:** Define Zod schemas (and reuse the shared loader from T09) for `apps/realtime` and `apps/worker`.
- **Files affected:** `packages/config/src/realtime-config.js`, `packages/config/src/worker-config.js`.
- **Dependencies:** P0-T09.
- **Estimated time:** 45 min.
- **Verification steps:** Same fail-fast behavior verified independently for both schemas with their own required variables (e.g., `REDIS_URL` for the worker).
- **Git commit message:** `feat(config): add realtime and worker environment schemas`

---

### P0-T11 — Web Environment Schema & `.env.example`

- **Goal:** Define the (smaller, public-only) Zod schema for `apps/web`, then produce the root `.env.example` covering every variable declared across all four schemas, with real usable local values for non-secrets and clearly-marked placeholders for secrets.
- **Files affected:** `packages/config/src/web-config.js`, `.env.example` (root).
- **Dependencies:** P0-T10.
- **Estimated time:** 45 min.
- **Verification steps:** Every variable name in all four schemas appears in `.env.example`; every variable name in `.env.example` exists in some schema (manual cross-check now — the automated CI check comes in T28); copying `.env.example` to `.env` and loading each schema against it succeeds with no errors.
- **Git commit message:** `chore: add web environment schema and root .env.example`

---

### P0-T12 — Scaffold `packages/logger` with Pino

- **Goal:** Create the `packages/logger` package with a base Pino instance configured for structured JSON output, consistent field names, and secret-redaction rules.
- **Files affected:** `packages/logger/package.json`, `packages/logger/src/logger.js`.
- **Dependencies:** P0-T08 (workspace pattern established).
- **Estimated time:** 60 min.
- **Verification steps:** Logging a test message produces valid, correctly-shaped JSON on stdout; logging an object containing a `password` or `token` field confirms it is redacted in the output.
- **Git commit message:** `feat(logger): add structured Pino logger with redaction`

---

### P0-T13 — Correlation ID Propagation

- **Goal:** Add `AsyncLocalStorage`-based correlation-ID generation and propagation to `packages/logger`, with a helper to generate/attach an ID at a request or socket-event entry point.
- **Files affected:** `packages/logger/src/correlation.js`, `packages/logger/src/logger.js` (integrate correlation ID into every log line automatically).
- **Dependencies:** P0-T12.
- **Estimated time:** 60 min.
- **Verification steps:** A test that establishes a correlation-ID context, then calls a nested function that logs, confirms the correlation ID appears in the nested log line without being explicitly passed as an argument.
- **Git commit message:** `feat(logger): add correlation ID propagation via AsyncLocalStorage`

---

### P0-T14 — Scaffold `packages/errors`

- **Goal:** Define the `OperationalError` base class (with HTTP-status-equivalent code and machine-readable error code) and the convention for treating anything else as a `ProgrammerError`, plus the shared error-envelope shape referenced by the architecture doc's API philosophy.
- **Files affected:** `packages/errors/package.json`, `packages/errors/src/operational-error.js`, `packages/errors/src/envelope.js`.
- **Dependencies:** P0-T08 (workspace pattern established).
- **Estimated time:** 45 min.
- **Verification steps:** Instantiating an `OperationalError` subclass and passing it through the envelope helper produces the exact documented envelope shape; a plain `Error` passed through the same helper produces the generic, internals-free shape.
- **Git commit message:** `feat(errors): add OperationalError taxonomy and response envelope`

---

### P0-T15 — Scaffold `packages/schemas`

- **Goal:** Create the `packages/schemas` package shell (empty of domain schemas — those arrive with the phases that need them — but with the shared Zod-usage conventions and export pattern established).
- **Files affected:** `packages/schemas/package.json`, `packages/schemas/src/index.js`.
- **Dependencies:** P0-T08.
- **Estimated time:** 30 min.
- **Verification steps:** Package resolves correctly as a workspace member from a throwaway import in another package; confirms the export pattern (named exports per §21 of the spec) is in place even with nothing substantive exported yet.
- **Git commit message:** `chore: scaffold packages/schemas package`

---

### P0-T16 — Scaffold `packages/ui`

- **Goal:** Initialize `packages/ui` with Tailwind CSS configuration and shadcn/ui base design tokens only — no actual components yet.
- **Files affected:** `packages/ui/package.json`, `packages/ui/tailwind.config.js`, `packages/ui/src/tokens.css` (or equivalent).
- **Dependencies:** P0-T08.
- **Estimated time:** 45 min.
- **Verification steps:** Tailwind builds successfully against the token config with no errors; confirms the package is consumable (even if empty of components) from `apps/web`.
- **Git commit message:** `chore: scaffold packages/ui with base design tokens`

---

### P0-T17 — Scaffold `apps/api` (Express Bootstrap)

- **Goal:** Create the Express app's process entry point, wiring in `packages/config`'s API loader and `packages/logger` at startup — no routes yet beyond process bootstrap.
- **Files affected:** `apps/api/package.json`, `apps/api/src/index.js`, `apps/api/src/app.js`.
- **Dependencies:** P0-T09, P0-T12.
- **Estimated time:** 60 min.
- **Verification steps:** Running the process with a valid `.env` starts successfully and logs a structured "server started" message; running it with a deliberately broken `.env` fails fast with the expected config-validation error (per T09) and a non-zero exit code.
- **Git commit message:** `feat(api): bootstrap Express process with config and logging`

---

### P0-T18 — API Health Endpoint & Error Middleware

- **Goal:** Add the `/health` endpoint and the centralized error-handling middleware (using `packages/errors`) to `apps/api`.
- **Files affected:** `apps/api/src/routes/health.js`, `apps/api/src/middleware/error-handler.js`, `apps/api/src/app.js` (wire both in).
- **Dependencies:** P0-T17, P0-T14.
- **Estimated time:** 60 min.
- **Verification steps:** `GET /health` returns 200 with the expected body; a route that deliberately throws an `OperationalError` returns the correct status code and envelope; a route that deliberately throws a generic `Error` returns a generic 500 without leaking stack details in the response body (while still being fully logged server-side).
- **Git commit message:** `feat(api): add health endpoint and centralized error handling`

---

### P0-T19 — Scaffold `apps/realtime`

- **Goal:** Create the Socket.IO process's entry point and a health-check endpoint, wired to `packages/config`'s realtime loader and `packages/logger` — no room/auth/Yjs logic (that's Phase 12).
- **Files affected:** `apps/realtime/package.json`, `apps/realtime/src/index.js`.
- **Dependencies:** P0-T10, P0-T12.
- **Estimated time:** 45 min.
- **Verification steps:** Process starts successfully against a valid environment and exposes a working health check; confirms zero domain logic exists per the Phase 0 non-goals.
- **Git commit message:** `chore: scaffold apps/realtime process`

---

### P0-T20 — Scaffold `apps/worker`

- **Goal:** Create the BullMQ worker process's entry point, connecting to Redis via `packages/config`'s worker loader, with no real job handlers registered yet.
- **Files affected:** `apps/worker/package.json`, `apps/worker/src/index.js`.
- **Dependencies:** P0-T10, P0-T12.
- **Estimated time:** 45 min.
- **Verification steps:** Process starts successfully, confirms a live Redis connection (logged), and exits cleanly on shutdown signal; confirms zero real jobs exist per the Phase 0 non-goals.
- **Git commit message:** `chore: scaffold apps/worker process`

---

### P0-T21 — Scaffold `apps/web`

- **Goal:** Initialize the Next.js 15 App Router project, wire in Tailwind + `packages/ui`'s tokens, and add a single placeholder page that calls the API's `/health` endpoint and displays the result.
- **Files affected:** `apps/web/package.json`, `apps/web/app/layout.js`, `apps/web/app/page.js`, `apps/web/next.config.js`.
- **Dependencies:** P0-T16, P0-T18 (needs a real `/health` endpoint to call).
- **Estimated time:** 75 min.
- **Verification steps:** `pnpm dev` in `apps/web` serves the placeholder page; the page successfully displays a "healthy" status fetched live from the running API process.
- **Git commit message:** `feat(web): bootstrap Next.js app with health-check placeholder page`

---

### P0-T22 — Dockerfiles: `api` and `realtime`

- **Goal:** Write the multi-stage Dockerfile (`base`/`dev`/`prod` targets) for `apps/api` and `apps/realtime`.
- **Files affected:** `infra/docker/api.Dockerfile`, `infra/docker/realtime.Dockerfile`.
- **Dependencies:** P0-T18, P0-T19.
- **Estimated time:** 75 min.
- **Verification steps:** `docker build --target prod` succeeds for both and produces a runnable image; `docker run` against the `prod` image for `api` successfully serves `/health`.
- **Git commit message:** `chore: add multi-stage Dockerfiles for api and realtime`

---

### P0-T23 — Dockerfiles: `worker` and `web`

- **Goal:** Write the multi-stage Dockerfile for `apps/worker` and `apps/web`.
- **Files affected:** `infra/docker/worker.Dockerfile`, `infra/docker/web.Dockerfile`.
- **Dependencies:** P0-T20, P0-T21.
- **Estimated time:** 75 min.
- **Verification steps:** `docker build --target prod` succeeds for both; `docker run` against the `worker` image confirms it starts and connects to a reachable Redis; `docker run` against the `web` image serves the placeholder page.
- **Git commit message:** `chore: add multi-stage Dockerfiles for worker and web`

---

### P0-T24 — Docker Compose Assembly

- **Goal:** Write `docker-compose.yml` wiring all six services (`postgres`, `redis`, `api`, `realtime`, `worker`, `web`) with healthchecks and `condition: service_healthy` dependency gating, per spec §6.
- **Files affected:** `infra/compose/docker-compose.yml`.
- **Dependencies:** P0-T22, P0-T23, P0-T11 (needs `.env.example` finalized).
- **Estimated time:** 75 min.
- **Verification steps:** `docker-compose up` from a clean clone (with `.env` copied from `.env.example`) brings up all six services successfully; confirm via `docker-compose ps` that dependent services genuinely wait for Postgres/Redis healthchecks, not just container start (test by temporarily breaking the Postgres healthcheck and confirming `api` does not start).
- **Git commit message:** `chore: add Docker Compose configuration for local development`

---

### P0-T25 — Prisma Initialization & Smoke-Test Migration

- **Goal:** Initialize Prisma against `DATABASE_URL`, with a trivial smoke-test model/migration (per architecture §7's phase-0 note) proving the migration pipeline works — no domain tables yet.
- **Files affected:** `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/`.
- **Dependencies:** P0-T24 (needs a running Postgres to migrate against).
- **Estimated time:** 45 min.
- **Verification steps:** `prisma migrate dev` runs successfully against the Compose-provided Postgres; the smoke-test table exists in the database afterward; `prisma migrate deploy` (the production-style command) also succeeds against a clean database.
- **Git commit message:** `chore: initialize Prisma with smoke-test migration`

---

### P0-T26 — Vitest Setup & Health Endpoint Test

- **Goal:** Configure Vitest at the workspace root and write the `/health` endpoint smoke test for `apps/api`.
- **Files affected:** `vitest.config.js` (root or per-app), `apps/api/src/routes/health.test.js`, root `package.json` (test script).
- **Dependencies:** P0-T18.
- **Estimated time:** 45 min.
- **Verification steps:** `pnpm test` runs and passes the health-endpoint test; a deliberately broken assertion in the test file fails as expected (confirms the test is actually exercising the endpoint, not vacuously passing).
- **Git commit message:** `test(api): add Vitest setup and health endpoint smoke test`

---

### P0-T27 — Config Validation Test

- **Goal:** Write the test proving the config loader (T09) fails fast and clearly on a malformed/incomplete environment.
- **Files affected:** `packages/config/src/load-config.test.js`.
- **Dependencies:** P0-T26 (Vitest configured), P0-T09.
- **Estimated time:** 30 min.
- **Verification steps:** Test passes, confirming both the missing-variable case and the malformed-value case (e.g., a non-numeric `PORT`) each produce a specific, identifiable error rather than a generic failure or a silent pass-through.
- **Git commit message:** `test(config): add config validation failure tests`

---

### P0-T28 — GitHub Actions CI Pipeline

- **Goal:** Write the CI workflow: setup/cache, lint, format-check, `.env.example`-vs-schema sync check, build, test, and Docker build smoke test for all four apps (per spec §17).
- **Files affected:** `.github/workflows/ci.yml`.
- **Dependencies:** P0-T04–P0-T07 (lint/format/hooks), P0-T11 (.env.example), P0-T22–P0-T23 (Dockerfiles), P0-T26–P0-T27 (tests).
- **Estimated time:** 90 min.
- **Verification steps:** Open a throwaway PR with a deliberate lint violation and confirm CI fails at the lint step specifically (not a later step); fix it and confirm the full pipeline passes; open a second throwaway PR with `.env.example` deliberately out of sync with a schema and confirm the env-contract check catches it specifically.
- **Git commit message:** `ci: add GitHub Actions pipeline for lint, test, and build`

---

### P0-T29 — Branch Protection & Dependabot

- **Goal:** Configure GitHub branch protection on `main` (require the CI workflow + one review approval before merge) and add a Dependabot configuration for automated dependency update PRs.
- **Files affected:** `.github/dependabot.yml`; branch protection is a GitHub repository setting, not a file, but should be documented in `docs/adr/` or the root README for team visibility.
- **Dependencies:** P0-T28.
- **Estimated time:** 30 min.
- **Verification steps:** Attempt to push directly to `main` and confirm it's rejected; confirm a PR cannot be merged until CI passes and a review is approved; confirm Dependabot opens at least one test PR (or is confirmed configured correctly via GitHub's UI) for an intentionally-outdated dependency.
- **Git commit message:** `chore: configure branch protection and Dependabot`

---

### P0-T30 — ADRs and Final Documentation Pass

- **Goal:** Write the Architecture Decision Records for the major Phase 0 decisions (monorepo vs. multi-repo, pnpm selection, Pino selection, Vitest selection, trunk-based development) and finalize the root and per-package/app READMEs, including the full local setup steps.
- **Files affected:** `docs/adr/0001-monorepo-vs-multi-repo.md`, `docs/adr/0002-package-manager-selection.md`, `docs/adr/0003-logging-library-selection.md`, `docs/adr/0004-test-runner-selection.md`, `docs/adr/0005-branching-strategy.md`, root `README.md`, all `apps/*`/`packages/*` `README.md` files.
- **Dependencies:** P0-T01 through P0-T29 (this is the final, closing task — it documents and verifies everything else).
- **Estimated time:** 90 min.
- **Verification steps:** A teammate unfamiliar with the setup follows only the root `README.md` from a clean clone and reaches a fully working local stack with zero undocumented steps (this is the literal test — have someone other than the implementer perform it); every acceptance criterion in `phase-0-development-foundation-spec.md` §25 is checked off against the actual repository state.
- **Git commit message:** `docs: add Phase 0 ADRs and finalize setup documentation`

---

## Task Dependency Graph (Summary)

```
T01 → T02 → T03 → T04 → T05 → T06 → T07
                 ↳ T08 → T09 → T10 → T11
                        ↳ T12 → T13
                        ↳ T14
                        ↳ T15
                        ↳ T16
T09,T12 → T17 → T18
T10,T12 → T19
T10,T12 → T20
T16,T18 → T21
T18,T19 → T22
T20,T21 → T23
T22,T23,T11 → T24
T24 → T25
T18 → T26 → T27
T04-T07,T11,T22,T23,T26,T27 → T28 → T29
T01-T29 → T30
```

**Note on parallelism:** several tasks in the T09–T16 range (schemas, logger, errors, ui) have no dependency on each other and can be executed in parallel by different engineers if the team is larger than one — the sequencing above reflects the *safest single-engineer order*, not a strict requirement that every task must be serialized if more people are available. Given the working agreement's "one phase at a time" rule applies at the phase level, not necessarily the task level, this is a reasonable place to parallelize if useful.
