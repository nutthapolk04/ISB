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

# Remove one layer of surrounding quotes from .env values (Docker --env-file quirk).
strip_env_value() {
  local v="$1"
  v="${v#\"}"; v="${v%\"}"
  v="${v#\'}"; v="${v%\'}"
  printf '%s' "$v"
}

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
APP_PORT="$(strip_env_value "$(grep -E '^PORT=' "$ENV_FILE" | tail -1 | cut -d= -f2-)")"
if [ -z "$APP_PORT" ]; then
  echo "No PORT= set in $ENV_FILE"
  exit 1
fi

# Mount ISB photo dir into the container (host SFTP upload folder).
# ISB_PHOTO_DIR must be an absolute path on the host, e.g. /sftp/sftp-client/upload
PHOTO_DIR="$(strip_env_value "$(grep -E '^ISB_PHOTO_DIR=' "$ENV_FILE" | tail -1 | cut -d= -f2-)")"
PHOTO_MOUNT=()
PHOTO_ENV=()
if [ -n "$PHOTO_DIR" ]; then
  if [ ! -d "$PHOTO_DIR" ]; then
    echo "WARN: ISB_PHOTO_DIR='$PHOTO_DIR' is not a directory on this host — photos will 404 until it exists."
  fi
  PHOTO_MOUNT=(-v "${PHOTO_DIR}:${PHOTO_DIR}:ro")
  # Override env-file value so stray quotes in .env.uat don't break path.resolve().
  PHOTO_ENV=(-e "ISB_PHOTO_DIR=${PHOTO_DIR}")
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
  "${PHOTO_ENV[@]}" \
  -v "$(pwd)/logs-${ENV}:/app/logs" \
  "${PHOTO_MOUNT[@]}" \
  "$IMAGE"

echo "==> Done. Tail logs with: docker logs -f $CONTAINER"
