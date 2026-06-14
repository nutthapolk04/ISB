# Build context = monorepo root (~/ISB). Required for bun workspaces because
# bun.lock + shared/ live at the root.
#
# Railway: set "Build Context Path" to repo root, "Dockerfile Path" to
# backend-bun/Dockerfile.

FROM oven/bun:1.3-alpine AS deps
WORKDIR /app

# Copy lockfile + all workspace package.json files so bun install can resolve
# the workspace graph. We need every workspace declared in the root
# package.json (frontend, kiosk, shared, backend-bun) even though we only
# build backend-bun — bun refuses install otherwise.
COPY package.json bun.lock ./
COPY shared/package.json ./shared/
COPY backend-bun/package.json ./backend-bun/
COPY frontend/package.json ./frontend/
COPY kiosk/package.json ./kiosk/

RUN bun install --frozen-lockfile

# ── Runtime image ───────────────────────────────────────────────────────────
FROM oven/bun:1.3-alpine
WORKDIR /app

# Bun hoists workspace node_modules to /app/node_modules; per-workspace
# node_modules dirs are NOT created. Copy only the root one.
COPY --from=deps /app/node_modules ./node_modules

# Source
COPY shared ./shared
COPY backend-bun ./backend-bun

WORKDIR /app/backend-bun

# Railway sets $PORT
ENV PORT=3001
EXPOSE 3001

CMD ["bun", "src/index.ts"]
