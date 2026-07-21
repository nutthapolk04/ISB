# Backend deploy — demo / prod / uat

Three environments, two deploy paths:

| Env   | Where        | Build                         | Deploy |
|-------|--------------|-------------------------------|--------|
| demo  | Railway      | Docker multi-stage on Railway | push to git → auto deploy |
| prod  | Own server   | Local `build-dist.sh`         | SFTP `dist/` → `./deploy.sh prod` |
| uat   | Own server   | Local `build-dist.sh`         | SFTP `dist/` → `./deploy.sh uat` |

## demo (Railway)

- **Dockerfile:** `backend-bun/Dockerfile` (multi-stage, builds inside Docker)
- **Build context:** monorepo root (`/`)
- **Config:** `railway.json` at repo root
- **Details:** see [railway-deploy.md](./railway-deploy.md)

Railway clones the repo, runs `bun install` + `bun run build` in the image, ships `dist/server.js`. No need to commit or SFTP `dist/`.

## prod / uat (own server)

### 1. Build locally (dev machine)

From repo root:

```bash
chmod +x backend-bun/build-dist.sh   # once
./backend-bun/build-dist.sh
```

Output: `backend-bun/dist/` (gitignored).

### 2. SFTP to server

Upload `backend-bun/dist/` to the same path on the server (merge/replace).

Also ensure on server:

- `backend-bun/deploy.sh`
- `backend-bun/Dockerfile.server`
- `backend-bun/.env.prod` or `.env.uat`
  - `ISB_PHOTO_DIR=/sftp/sftp-client/upload` (must exist on the host)
  - `BACKEND_BASE_URL=https://<public-api-host>` (used in `photo_url` stored after sync)
  - Do **not** put the filesystem path in `ISB_PHOTO_BASE_URL` — that var is for http(s) CDN URLs only.

`deploy.sh` bind-mounts `ISB_PHOTO_DIR` into the container read-only so
`GET /api/v1/profile-photos/:filename` can read SFTP uploads.

### 3. Deploy on server

```bash
cd backend-bun
chmod +x deploy.sh   # once
./deploy.sh prod     # or uat
```

Uses `Dockerfile.server` — copies existing `dist/` only (no compile on server).

### Logs

```bash
docker logs -f isb-backend-prod   # or isb-backend-uat
```

Host log volume: `backend-bun/logs-prod/` / `logs-uat/`.

## Dockerfiles

| File                 | Used by   | Context        | Builds? |
|----------------------|-----------|----------------|---------|
| `Dockerfile`         | Railway   | repo root      | yes (in Docker) |
| `Dockerfile.server`  | prod/uat  | `backend-bun/` | no — expects `dist/` |

## Quick reference

```bash
# Local → server (prod/uat)
./backend-bun/build-dist.sh
# SFTP backend-bun/dist/ → server
ssh server 'cd backend-bun && ./deploy.sh prod'

# demo
git push   # Railway builds from Dockerfile automatically
```
