# Build context = monorepo root (~/ISB). Required for bun workspaces
# because bun.lock + shared/ live at the root.
#
# Single-stage to avoid losing Bun's workspace symlink layout when copying
# node_modules across stages. Bun's resolver expects both the hoisted
# /app/node_modules and per-workspace /app/<ws>/node_modules to be present
# in whichever form bun install produced them.

FROM oven/bun:1.3-alpine
WORKDIR /app

# Copy workspace manifests + lockfile first so the bun install layer caches
# when only source changes.
COPY package.json bun.lock ./
COPY shared/package.json ./shared/
COPY backend-bun/package.json ./backend-bun/
COPY frontend/package.json ./frontend/
COPY kiosk/package.json ./kiosk/

RUN bun install --frozen-lockfile

# Source — only the workspaces we actually run at runtime.
COPY shared ./shared
COPY backend-bun ./backend-bun

WORKDIR /app/backend-bun

ENV PORT=3001
EXPOSE 3001

CMD ["bun", "src/index.ts"]
