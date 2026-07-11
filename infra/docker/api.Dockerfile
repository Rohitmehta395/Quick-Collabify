# Base stage with pnpm enabled via corepack
FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /workspace

# Development stage: runs with hot-reload via watch and has all dependencies
FROM base AS dev
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/realtime/package.json ./apps/realtime/
COPY apps/worker/package.json ./apps/worker/
COPY apps/web/package.json ./apps/web/
COPY packages ./packages
RUN pnpm install --frozen-lockfile
COPY apps/api ./apps/api
EXPOSE 3001
CMD ["pnpm", "--filter", "api", "dev"]

# Production builder stage: installs all deps and deploys the isolated app
FROM base AS builder
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/realtime/package.json ./apps/realtime/
COPY apps/worker/package.json ./apps/worker/
COPY apps/web/package.json ./apps/web/
COPY packages ./packages
RUN pnpm install --frozen-lockfile
COPY apps/api ./apps/api
RUN pnpm --filter api deploy /app/deploy --prod --legacy

# Final production stage: minimal runner image
FROM base AS prod
WORKDIR /app
COPY --from=builder /app/deploy ./
EXPOSE 3001
CMD ["node", "src/index.js"]
