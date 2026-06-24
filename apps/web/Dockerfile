# syntax=docker/dockerfile:1

# Build context is the REPO ROOT (see docker-compose.yml) so the pnpm workspace
# resolves. Multi-stage: `build` installs + compiles the Relay SPA to static
# assets; the runtime stage is nginx serving those assets and proxying the
# same-origin /api/* prefix to the edge front door (infra/nginx/web.conf).

FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

# Every workspace manifest first (better layer caching). All are needed so the
# frozen lockfile resolves the full graph.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json ./
COPY packages/platform/package.json packages/platform/package.json
COPY services/auth-service/package.json services/auth-service/package.json
COPY services/social-service/package.json services/social-service/package.json
COPY services/chat-service/package.json services/chat-service/package.json
COPY apps/ws-gateway-go/package.json apps/ws-gateway-go/package.json
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Source + build. `vite build` emits static assets to apps/web/dist. The client
# addresses the backend at the same-origin default (/api, ws from page origin),
# so no build-time API URL is needed.
COPY apps/web apps/web
RUN pnpm --filter @hsc/web build

FROM nginx:1.27-alpine AS runtime
# Front-door config (serve the SPA + proxy /api to the edge) and the built assets.
COPY infra/nginx/web.conf /etc/nginx/nginx.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
