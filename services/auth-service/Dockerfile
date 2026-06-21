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
# Copy only manifests first for better layer caching.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json ./
COPY services/auth-service/package.json services/auth-service/package.json
COPY apps/ws-gateway-go/package.json apps/ws-gateway-go/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile
# Now the source, then build + prune to a self-contained bundle in /out.
COPY services/auth-service services/auth-service
RUN pnpm --filter @hsc/auth-service build \
 && pnpm --filter @hsc/auth-service deploy --prod /out

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out /app
EXPOSE 3000
CMD ["node", "dist/index.js"]
