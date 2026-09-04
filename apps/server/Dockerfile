# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────
# @fpc/server — Express API image
#
# Build from the REPOSITORY ROOT, not from apps/server: this is a pnpm
# workspace and the API resolves @fpc/shared through the lockfile.
#
#   docker build -f apps/server/Dockerfile -t fpc-server .
# ─────────────────────────────────────────────────────────────

ARG NODE_VERSION=22-alpine
ARG PNPM_VERSION=11.9.0

FROM node:${NODE_VERSION} AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Pinned rather than left to corepack's bundled default: pnpm-workspace.yaml
# uses settings only pnpm 11 understands.
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

# Manifests alone form the dependency layer, so editing application source
# reuses the cached install instead of paying for it again.
FROM base AS manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/api-client/package.json packages/api-client/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/

FROM manifests AS build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @fpc/server...
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/server ./apps/server
# @fpc/shared is consumed through its built dist/, so it has to precede the API.
RUN pnpm --filter @fpc/shared build && pnpm --filter @fpc/server build

# The same install without dev dependencies. Resolved from the identical
# lockfile, so the runtime tree matches what was built above.
FROM manifests AS prod-deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter @fpc/server...

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=4000
# Railway's private networking is IPv6-only; the default resolution order would
# hand back an A record the platform cannot route.
ENV NODE_OPTIONS=--dns-result-order=ipv6first

COPY --from=prod-deps /app ./
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/server/dist ./apps/server/dist
# Read at runtime by the fixture mail and statement drivers, relative to cwd.
# Owned by node because the seed writes generated invoice PDFs back into it.
COPY --chown=node:node apps/server/fixtures ./apps/server/fixtures

# STORAGE_DRIVER=local writes here. Without a mounted volume the contents are
# ephemeral, which is why azure is the production driver.
RUN mkdir -p /app/apps/server/.data/blobs && chown -R node:node /app/apps/server/.data

USER node
WORKDIR /app/apps/server
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# node directly rather than `pnpm start`: one less process between the platform
# and the signal handlers that close the server and the Mongo connection.
CMD ["node", "dist/index.js"]
