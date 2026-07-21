#!/usr/bin/env bash
# Server deploy (prod / uat) — run ON THE SERVER after SFTP'ing dist/.
#
# Prerequisites on server:
#   - backend-bun/dist/server.js  (from ./build-dist.sh + SFTP)
#   - backend-bun/.env.prod or .env.uat
#   - Docker installed
#
# Usage:
#   ./deploy.sh prod
#   ./deploy.sh uat
set -euo pipefail

cd "$(dirname "$0")"

ENV="${1:?Usage: ./deploy.sh <prod|uat>}"
IMAGE="isb-backend"
DOCKERFILE="Dockerfile.server"

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
  echo "Missing dist/server.js"
  echo "On your dev machine run: ./backend-bun/build-dist.sh"
  echo "Then SFTP backend-bun/dist/ to this server."
  exit 1
fi

# Container listens on whatever PORT is set to in the env file — host and
# container port must match or the app won't be reachable.
APP_PORT="$(grep -E '^PORT=' "$ENV_FILE" | tail -1 | cut -d= -f2)"
if [ -z "$APP_PORT" ]; then
  echo "No PORT= set in $ENV_FILE"
  exit 1
fi

# Mount ISB photo dir into the container (host SFTP upload folder).
PHOTO_DIR="$(grep -E '^ISB_PHOTO_DIR=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"')"
PHOTO_MOUNT=()
if [ -n "$PHOTO_DIR" ]; then
  if [ ! -d "$PHOTO_DIR" ]; then
    echo "WARN: ISB_PHOTO_DIR='$PHOTO_DIR' is not a directory on this host — photos will 404 until it exists."
  fi
  PHOTO_MOUNT=(-v "${PHOTO_DIR}:${PHOTO_DIR}:ro")
  echo "==> Mounting ISB photos: ${PHOTO_DIR} (read-only)"
fi

echo "==> Building image from pre-built dist/ ($DOCKERFILE)"
docker build -f "$DOCKERFILE" -t "$IMAGE" .

echo "==> Restarting container ($CONTAINER)"
docker stop "$CONTAINER" 2>/dev/null || true
docker rm "$CONTAINER" 2>/dev/null || true

docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  -p "${APP_PORT}:${APP_PORT}" \
  --env-file "$ENV_FILE" \
  -v "$(pwd)/logs-${ENV}:/app/logs" \
  "${PHOTO_MOUNT[@]}" \
  "$IMAGE"

echo "==> Done. Tail logs with: docker logs -f $CONTAINER"
