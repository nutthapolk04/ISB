#!/usr/bin/env bash
set -euo pipefail
# Context is backend-bun/ itself now — the image only needs dist/, built
# locally beforehand (`bun run build`) and dragged over along with this file.
cd "$(dirname "$0")"

ENV="${1:?Usage: ./deploy.sh <prod|uat>}"
IMAGE="isb-backend"

case "$ENV" in
  prod) CONTAINER="isb-backend-prod"; ENV_FILE=".env.prod" ;;
  uat)  CONTAINER="isb-backend-uat";  ENV_FILE=".env.uat" ;;
  *) echo "Unknown env '$ENV' (use prod or uat)"; exit 1 ;;
esac

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE — copy it onto the server before deploying."
  exit 1
fi

if [ ! -f "dist/server.js" ]; then
  echo "Missing dist/server.js — run 'bun run build' locally and drag dist/ over first."
  exit 1
fi

# Container listens on whatever PORT is set to in the env file — host and
# container port must match or the app won't be reachable.
APP_PORT="$(grep -E '^PORT=' "$ENV_FILE" | tail -1 | cut -d= -f2)"
if [ -z "$APP_PORT" ]; then
  echo "No PORT= set in $ENV_FILE"
  exit 1
fi

echo "==> Building image"
docker build -t "$IMAGE" .

echo "==> Restarting container ($CONTAINER)"
docker stop "$CONTAINER" 2>/dev/null || true
docker rm "$CONTAINER" 2>/dev/null || true

docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  -p "${APP_PORT}:${APP_PORT}" \
  --env-file "$ENV_FILE" \
  -v "$(pwd)/logs-${ENV}:/app/logs" \
  "$IMAGE"

echo "==> Done. Tail logs with: docker logs -f $CONTAINER"
