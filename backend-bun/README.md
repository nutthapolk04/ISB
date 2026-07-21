# ISB Backend — Bun + Elysia

The backend, written in TypeScript on Bun. It replaced the Python FastAPI
service in `../backend/` via the strangler pattern; that cutover is complete —
`../backend/` is retired and only `backend-bun/` is deployed. `../backend/`'s
Alembic migrations are historical only and are not run anywhere.

## Stack

| Concern        | Tool                                         |
| -------------- | -------------------------------------------- |
| Runtime        | Bun (>= 1.3)                                 |
| HTTP framework | Elysia                                       |
| ORM            | Drizzle ORM                                  |
| DB driver      | postgres-js                                  |
| Validation     | TypeBox (built into Elysia)                  |
| Auth           | `@elysiajs/jwt` (HS256)                      |
| Tests          | `bun:test`                                   |
| Schema source  | `drizzle/schema.ts`, hand-edited — source of truth |

## Layout

```
backend-bun/
├── src/
│   ├── index.ts             # entry → server.ts
│   ├── server.ts            # boot + listen
│   ├── app.ts               # cors, swagger, onError, router
│   ├── routes.ts            # wire all endpoint groups
│   ├── controllers/         # HTTP handlers (delegate to services)
│   ├── interfaces/routes/   # TypeBox body/query + Swagger detail per domain
│   ├── db/
│   │   ├── client.ts        # postgres + drizzle client
│   │   ├── schema.ts        # re-exports ../../drizzle/schema.ts for @/db/schema imports
│   │   └── ensure_schema.ts # historical idempotent patches — do not add new ones, see Migrations below
│   ├── services/            # business logic, no HTTP concerns
│   ├── middleware/
│   │   ├── AuthMiddleware.ts # JWT requireAuth + authMiddleware
│   │   └── ...
│   ├── utils/
│   │   └── AuthUtils.ts      # validateToken, validateRole, password helpers
│   └── lib/
│       └── config.ts        # env vars (fail-fast)
├── tests/                   # bun:test
├── drizzle/                 # generated migrations
├── drizzle.config.ts
├── package.json
└── tsconfig.json
```

## Quick start

```bash
# 1. Copy env template
cp .env.example .env
# Edit .env: paste DATABASE_URL (Railway DATABASE_PUBLIC_URL) and JWT_SECRET

# 2. Install deps (from repo root — Bun workspace)
cd ..
bun install

# 3. Apply the schema to a fresh Postgres (or bring an existing one up to date)
cd backend-bun
bun run db:migrate

# 4. Run dev server
bun run dev
# → http://localhost:3001/health
# → http://localhost:3001/docs (OpenAPI / Swagger UI)

# 5. Run tests
bun test
```

## Environment

| Var            | Required | Description                                          |
| -------------- | -------- | ---------------------------------------------------- |
| `DATABASE_URL` | yes      | Postgres connection string (use `DATABASE_PUBLIC_URL` from Railway) |
| `JWT_SECRET`   | yes      | Signing secret for issued JWTs                       |
| `PORT`         | no       | Default `3001`                                       |
| `CORS_ORIGINS` | no       | Comma-separated. Default permissive.                 |
| `NODE_ENV`     | no       | `development` / `production`                         |

## Conventions

- One route file per resource, mounted by `index.ts`.
- Business logic lives in `services/`; routes should be thin.
- All env access goes through `lib/config.ts`. No `process.env` elsewhere.
- All non-trivial endpoints require `requireAuth` from `AuthMiddleware`; protect at the router level.

## Schema migrations

`drizzle/schema.ts` is the source of truth. For any schema change:

```bash
# 1. Edit drizzle/schema.ts by hand (add/change a table or column)
# 2. Generate a migration file from the diff
bun run db:generate --name <short_description>
# 3. Apply it
bun run db:migrate
```

This replaces the old convention (still visible in `src/db/ensure_schema.ts`)
of hand-writing an idempotent `ALTER TABLE ... IF NOT EXISTS` patch for every
change and running it at server boot. `ensure_schema.ts`'s existing patches
are left in place (harmless — every deployed environment already has those
columns, so they just no-op on every boot) but **no new patches should be
added there**; new schema changes go through `db:generate`/`db:migrate`
instead.

The migration history was squashed to a single `0000_baseline.sql` on
2026-07-21 (see git history) because the prior chain (`0000`–`0005`) was
missing incremental snapshots in `drizzle/meta/` and had drifted from the
live schema — most changes over time went through `ensure_schema.ts` instead
of Drizzle migrations, so the two mechanisms disagreed about history. The new
baseline was generated from (and matches) the current `drizzle/schema.ts`,
and was verified by applying it via `drizzle-kit migrate` to a fresh, empty
Postgres database.

**Existing databases (dev/uat/demo/prod) predate this baseline** and already
have this schema applied (via the old patch mechanism) — running
`db:migrate` against them as-is would try to `CREATE TABLE` on tables that
already exist and fail. Before using `db:migrate` against one of those
environments, reconcile it first: either

- (a) wipe and rebuild it from the baseline (fine for a throwaway/demo
  environment — `DROP DATABASE` + `CREATE DATABASE` + `bun run db:migrate`), or
- (b) mark the baseline as already applied without running it, so only
  migrations generated *after* it actually execute there:
  ```sql
  CREATE SCHEMA IF NOT EXISTS drizzle;
  CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
    id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint
  );
  INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
  VALUES ('<sha256 of drizzle/0000_baseline.sql>', <unix_ms_from_drizzle/meta/_journal.json>);
  ```
  The hash is just `sha256sum drizzle/0000_baseline.sql` (or `shasum -a 256` on
  macOS) — plain content hash, nothing fancier. `created_at` is the `when`
  value already recorded for this migration in `drizzle/meta/_journal.json`.
