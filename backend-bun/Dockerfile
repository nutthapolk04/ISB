# Railway deploy (demo) — build context MUST be the monorepo root.
# Builds backend-bun inside Docker; do not commit dist/ to git.
#
# For prod/uat on your own server, use Dockerfile.server + build-dist.sh instead.

FROM oven/bun:1.3-alpine AS builder
WORKDIR /app

# Workspace install: copy lockfile + all workspace package manifests first (layer cache).
COPY package.json bun.lock ./
COPY shared/package.json ./shared/
COPY backend-bun/package.json ./backend-bun/
COPY frontend/package.json ./frontend/
COPY kiosk/package.json ./kiosk/
# kiosk links this local plugin via file: — must exist before `bun install`.
COPY plugins/capacitor-hardware/package.json ./plugins/capacitor-hardware/
COPY plugins/capacitor-hardware/dist ./plugins/capacitor-hardware/dist/

RUN bun install --frozen-lockfile

# Source needed for the bundle + shared workspace types.
COPY shared ./shared
COPY backend-bun ./backend-bun

WORKDIR /app/backend-bun
RUN bun run build

# ── Runtime image: bundled output only (no node_modules) ─────────────────────
FROM oven/bun:1.3-alpine
WORKDIR /app

COPY --from=builder /app/backend-bun/dist ./dist

ENV PORT=3001
EXPOSE 3001

CMD ["bun", "dist/server.js"]
