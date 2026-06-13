# Phase 1 Routing Strategy

During the strangler migration the frontend must call the **new** Elysia
backend for ported endpoints and continue calling **FastAPI** for everything
else. We want to switch endpoints one at a time without redeploying the
frontend each time and without changing client code.

## Decision: Vercel rewrites + env-driven base URL

Two layers:

1. **Frontend has one `API_BASE_URL`** (already exists, points at FastAPI).
   It does **not** know about Elysia.
2. **Vercel `rewrites` config** on the frontend project intercepts specific
   paths and forwards them to Elysia. Everything else falls through to
   FastAPI.

This means:

- Frontend code stays untouched. `apiClient.get('/api/v1/shops')` works
  whether `/api/v1/shops` lives on FastAPI or Elysia.
- Adding a migrated endpoint = one line in `vercel.json` + deploy.
- Rollback = remove the rewrite + redeploy. Zero code change.

```
Browser
  │
  ▼  /api/v1/shops
Vercel Edge
  ├─ matches /api/v1/shops/* → proxy to https://isb-bun.up.railway.app
  └─ all other /api/v1/*     → proxy to https://isb-production.up.railway.app
                                       (FastAPI)
```

## Configuration

In `frontend/vercel.json` (or the kiosk's `vercel.json` if it shares the API):

```json
{
  "rewrites": [
    {
      "source": "/api/v1/shops",
      "destination": "https://isb-bun.up.railway.app/api/v1/shops"
    },
    {
      "source": "/api/v1/shops/:path*",
      "destination": "https://isb-bun.up.railway.app/api/v1/shops/:path*"
    }
  ]
}
```

> Two rules per resource — first matches the bare path, second matches
> sub-paths. `/api/v1/shops/canteen` falls through the second rule.

## Token interop (already wired in Phase 0)

Both backends accept the same HS256 JWT because they share `SECRET_KEY`/
`JWT_SECRET`. A user logs in via FastAPI, the token works on Elysia, and
vice versa. Nothing extra is needed at the rewrite layer — the
`Authorization` header is forwarded verbatim.

## CORS

The frontend talks to the **same origin** (Vercel) for both backends — CORS
is not involved because the rewrite is server-side. Direct browser-to-Elysia
calls are not part of this strategy.

## Choosing what to migrate first

Each rewrite line is a feature flag. Order matters:

1. **Phase 1 endpoints first** (read-only resources). Failures here only
   affect display, not transactions.
2. **Wallet ops** later — these write state and are high-blast-radius.
3. **POS sale flows last** — transaction integrity is mission-critical.

Before adding a rewrite, the corresponding Elysia route must pass its
contract test against the same production DB.

## Rollback

Two ways:

- **Soft rollback** — remove the line(s) from `vercel.json`, redeploy.
  Frontend hits FastAPI again. Recovery time: ~1 minute.
- **Hard rollback** — Vercel "Revert to previous deployment" if a rewrite
  shipped alongside other changes that need to be reverted together.

## Open question (not blocking Phase 1)

Where does Elysia get deployed? Two options:

- **New Railway service** in the same project (e.g. `isb-bun`). Same
  Postgres, same network, separate deploys. **Recommended.**
- **Same service as FastAPI** using a different port and a process manager.
  Less isolation, more deploy coupling. Not recommended.

This decision is for Phase 0's "deploy Elysia to Railway" task, which we
deferred until after the first endpoint is contract-verified — which it
now is.
