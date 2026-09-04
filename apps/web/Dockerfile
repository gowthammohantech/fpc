# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────
# @fpc/web — Vite build served by nginx, which also reverse-proxies /api to
# the API service so the browser only ever sees one origin.
#
# Build from the REPOSITORY ROOT, not from apps/web:
#
#   docker build -f apps/web/Dockerfile -t fpc-web .
# ─────────────────────────────────────────────────────────────

ARG NODE_VERSION=22-alpine
ARG NGINX_VERSION=1.27-alpine
ARG PNPM_VERSION=11.9.0

FROM node:${NODE_VERSION} AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/api-client/package.json packages/api-client/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
RUN pnpm install --frozen-lockfile --filter @fpc/web...

COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
# The workspace packages resolve through their built dist/, so they precede the
# app's own typecheck-and-bundle step.
RUN pnpm --filter @fpc/shared build \
    && pnpm --filter @fpc/api-client build \
    && pnpm --filter @fpc/web build

FROM nginx:${NGINX_VERSION} AS runner

# Defaults for a Railway deploy: the platform overrides PORT, and API_URL points
# at the API over private networking. Both are substituted into the config at
# container start, so one image works across environments.
ENV PORT=8080
ENV API_URL=http://server.railway.internal:4000
# Railway's internal DNS. On a plain Docker network, override with 127.0.0.11.
ENV RESOLVER=[fd12::10]
# Without this filter envsubst would also blank nginx's own $uri, $host and
# friends, since the entrypoint substitutes every variable it finds.
ENV NGINX_ENVSUBST_FILTER=^(PORT|API_URL|RESOLVER)$

COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --quiet --spider "http://127.0.0.1:${PORT}/healthz" || exit 1
