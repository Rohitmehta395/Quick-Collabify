# Base image with pnpm enabled via corepack
FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Builder stage: installs all dependencies and extracts the isolated app
FROM base AS builder
WORKDIR /workspace

# Copy workspace configuration and lockfile
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy all source code (in a real CI/CD environment, you might use tools like turbo prune, but for simplicity we copy all)
COPY apps ./apps
COPY packages ./packages

# Install the entire workspace dependencies (frozen lockfile to ensure reproducible builds)
RUN pnpm install --frozen-lockfile

# Deploy only the target application and its production dependencies into /app/deploy
# --legacy is used in pnpm 9 for non-injected workspace dependencies
RUN pnpm --filter api deploy /app/deploy --prod --legacy

# Final production stage: minimal image containing only what's necessary
FROM base AS prod
WORKDIR /app

# Copy the deployed application from the builder stage
COPY --from=builder /app/deploy ./

# The API defaults to port 4000 if not specified
EXPOSE 4000

# Start the Node.js application
CMD ["node", "src/index.js"]
