# Base image with pnpm enabled via corepack
FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Builder stage: installs all dependencies and builds the Next.js app
FROM base AS builder
WORKDIR /workspace

# Copy workspace configuration and lockfile
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy all source code
COPY apps ./apps
COPY packages ./packages

# Install the entire workspace dependencies (including devDependencies required for build)
RUN pnpm install --frozen-lockfile

# Build the Next.js web application
RUN pnpm --filter web build

# Deploy only the production dependencies and package files into /app/deploy
RUN pnpm --filter web deploy /app/deploy --prod --legacy

# Final production stage: minimal image
FROM base AS prod
WORKDIR /app

# Copy the deployed application (which has production node_modules)
COPY --from=builder /app/deploy ./

# Manually copy the build output (.next folder is normally ignored by pnpm deploy if in .gitignore)
COPY --from=builder /workspace/apps/web/.next ./.next
COPY --from=builder /workspace/apps/web/public ./public

# Next.js default port
EXPOSE 3000

# Start the Next.js web application in production mode
CMD ["node_modules/.bin/next", "start"]
