# syntax=docker/dockerfile:1

# Build context is the REPO ROOT (see docker-compose.yml) so the pnpm workspace
# resolves. Multi-stage: `build` installs + compiles + emits a pruned prod
# bundle; `runtime` carries only that bundle.

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
# Copy every workspace manifest first (better layer caching). All are needed so
# the frozen lockfile resolves the full graph; social-service depends on the
# shared @hsc/platform package.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json ./
COPY packages/platform/package.json packages/platform/package.json
COPY services/auth-service/package.json services/auth-service/package.json
COPY services/social-service/package.json services/social-service/package.json
COPY services/chat-service/package.json services/chat-service/package.json
COPY apps/ws-gateway-go/package.json apps/ws-gateway-go/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile
# Source for the shared package + the service we build. Build platform first
# (social-service compiles against its emitted types), then prune to a
# self-contained bundle in /out (deploy injects @hsc/platform's built output).
COPY packages/platform packages/platform
COPY services/social-service services/social-service
# --legacy: bundle the workspace dep (@hsc/platform) into /out (pnpm v10 deploy
# otherwise requires inject-workspace-packages).
RUN pnpm --filter @hsc/platform build \
 && pnpm --filter @hsc/social-service build \
 && pnpm --filter @hsc/social-service deploy --prod --legacy /out

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out /app
EXPOSE 3001
CMD ["node", "dist/index.js"]
