# Build context = backend-bun/ itself. Expects dist/server.js to already
# exist (run `bun run build` locally before building this image) — the
# image only ships the pre-bundled output, not source or node_modules.

FROM oven/bun:1.3-alpine
WORKDIR /app

COPY dist ./dist

ENV PORT=3001
EXPOSE 3001

CMD ["bun", "dist/server.js"]
