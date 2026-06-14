# Build context = monorepo root (~/ISB). Required for bun workspaces because
# bun.lock + shared/ live at the root.
#
# Railway: set "Build Context Path" to repo root, "Dockerfile Path" to
# backend-bun/Dockerfile.

FROM oven/bun:1.3-alpine AS deps
WORKDIR /app

# Copy lockfile + all workspace package.json files so bun install can resolve
# the workspace graph without copying source.
COPY package.json bun.lock ./
COPY shared/package.json ./shared/
COPY backend-bun/package.json ./backend-bun/

RUN bun install --frozen-lockfile

# ── Runtime image ───────────────────────────────────────────────────────────
FROM oven/bun:1.3-alpine
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/shared/node_modules ./shared/node_modules
COPY --from=deps /app/backend-bun/node_modules ./backend-bun/node_modules

# Source
COPY shared ./shared
COPY backend-bun ./backend-bun

WORKDIR /app/backend-bun

# Railway sets $PORT
ENV PORT=3001
EXPOSE 3001

CMD ["bun", "src/index.ts"]
