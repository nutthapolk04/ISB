# Railway deploy — Bun backend

See also [deploy.md](./deploy.md) for the full demo / prod / uat matrix.

## One-time setup

1. **Create a new Railway service** in the same project as the FastAPI backend
   (so they share the project's Postgres database).
   - Name: `isb-bun` (or whatever — only the public URL matters for the
     vercel rewrite target).

2. **Build settings**
   - Source: this monorepo
   - Build context: **repo root** (`/`) — NOT `backend-bun/`. The bun
     workspace needs `bun.lock` + `shared/` at the build context.
   - Dockerfile path: `backend-bun/Dockerfile`
   - Railway should auto-detect `backend-bun/railway.json` and use it.

3. **Environment variables** (Service Variables tab)

   Copy these names from `backend-bun/.env.example` and fill values:

   | Key | Value source |
   |---|---|
   | `DATABASE_URL` | Same as FastAPI service. In Railway, link via `${{Postgres.DATABASE_URL}}` |
   | `JWT_SECRET` | **EXACT** copy of FastAPI's `SECRET_KEY` — token interop depends on this |
   | `PORT` | Railway sets this automatically. Leave blank. |
   | `CORS_ORIGINS` | `https://isb-beta.vercel.app,https://isb-kiosk.vercel.app,http://localhost:5173,http://localhost:5174` (adjust to actual FE origins) |
   | `FRONTEND_BASE_URL` | `https://isb-beta.vercel.app` (for PYMT EASYPay redirects) |
   | `PYMT_BASE_URL` | Same as FastAPI |
   | `PYMT_MERCHANT_TOKEN` | Same as FastAPI |

4. **Generate public domain** — Settings → Networking → Generate Domain.
   Note the URL, e.g. `isb-bun-production.up.railway.app`.

5. **First deploy** — push to main, or trigger via Railway dashboard.

## Smoke tests after first deploy

Replace `<bun>` with the generated Railway domain.

```bash
# Health (public, no auth)
curl -s https://<bun>/health
# → {"status":"ok",...}

# Swagger docs
curl -sI https://<bun>/docs | head -1
# → HTTP/2 200

# Login via FastAPI works on Bun (token interop)
TOKEN=$(curl -sX POST https://isb-production.up.railway.app/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<pwd>"}' | jq -r .access_token)
curl -s https://<bun>/api/v1/me -H "Authorization: Bearer $TOKEN"
# → {"sub":"1","username":"admin",...}

# Read endpoint via Bun
curl -s https://<bun>/api/v1/shops -H "Authorization: Bearer $TOKEN" | jq '. | length'
# → number of shops, matching FastAPI exactly
```

## When to flip vercel rewrites

Only after **all** of the above pass. See `phase-12-cutover.md` for the
staged rollout plan (Wave 1 reads → Wave 5 POS).

## Rollback

1. Vercel → frontend/vercel.json → remove rewrites for the misbehaving paths
2. Redeploy frontend (≈30s)
3. Investigate Bun service logs on Railway
4. Fix + redeploy Bun, then re-add the rewrites

Zero data loss — both backends share the same DB.

## Decommissioning FastAPI (after Wave 5 stable for 1-2 weeks)

1. Stop the FastAPI Railway service (don't delete yet)
2. Monitor Bun for 1 more week
3. Delete the FastAPI service
4. Remove `frontend/vercel.json` rewrites (or flip them all to Bun)
5. Update FE `API_BASE_URL` env to point at Bun directly
6. `git rm -r backend/` from the monorepo
