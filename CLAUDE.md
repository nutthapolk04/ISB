# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## System Overview

**ISB** is a school payment system with POS (Point of Sale) for canteen/store, parent wallet portal, and admin dashboard. The architecture separates **backend** (Bun/Elysia), **frontend** (React/Vite), and **kiosk** (Vue/Capacitor Android). The system has two shop types:
- **Canteen** (RFID-first, no stock management) — shop_id starts with "canteen"
- **Store** (inventory-driven) — all other shop_ids

See `SYSTEM_SPEC.md` for user roles, modules, and feature matrix.

## Stack & Tools

| Layer | Technology | Key Files |
|-------|-----------|-----------|
| **Backend** | Bun + Elysia + Drizzle ORM | `backend-bun/src/`, `backend-bun/drizzle/schema.ts` |
| **Frontend** | React 18 + TypeScript + Vite + shadcn/ui | `frontend/src/` |
| **Database** | PostgreSQL 18 | Schema: `backend-bun/drizzle/schema.ts` |
| **i18n** | react-i18next | `frontend/src/locales/{en,th}.json` |
| **Auth** | JWT (HS256) | `backend-bun/src/middleware/AuthMiddleware.ts` |

## Development Setup

### Prerequisites
- **Bun** >= 1.3.0
- **Node** >= 18 (PM2 needs it; apps run on Bun)
- **Docker** (for Postgres)
- **PM2** (optional, for local multi-process: `npm install -g pm2`)

### Quickstart
```bash
# 1. Start database
docker compose up -d

# 2. Install deps from repo root
bun install

# 3. Dev servers (via PM2 or direct):
#    Option A — Both via PM2 (from repo root):
pm2 start ecosystem.config.cjs

#    Option B — Separate terminals:
cd backend-bun && bun run dev    # http://localhost:3001, API at :3001/api/v1
cd frontend && bun --bun run dev # http://localhost:8080

# 4. Check health
curl http://localhost:3001/health  # backend
curl http://localhost:3001/docs     # OpenAPI / Swagger UI (live)
```

**Critical:** `.env` files are in TWO places:
- `repo-root/.env` (frontend reads this, but not typically used in dev)
- `backend-bun/.env` (backend's actual config; must have `DATABASE_URL` and `JWT_SECRET`)

Both must point to the same Postgres.

## Backend Commands

*Run from `backend-bun/` or use `bun --cwd backend-bun`*

```bash
# Development
bun run dev                    # Hot-reload server (default :3001)
bun test                       # Run all tests (bun:test)
bun test --timeout=5000        # Single test with longer timeout

# Database
bun run db:generate --name <migration_name>  # Generate migration from schema.ts changes
bun run db:migrate             # Apply pending migrations
bun run db:studio              # Drizzle Studio at http://localhost:5555 (local DB only)
bun run db:introspect          # Regenerate schema.ts from live Postgres

# Build & Deploy (see production.config.cjs / staging.config.cjs)
bun run build                  # Minified bundle → ./dist
bun run prod:start             # Build + start with PM2 (production)
bun run prod:restart           # Rebuild + restart
bun run prod:logs              # Tail PM2 logs

# Scripts (data ops)
bun run db:seed-admin          # Create admin user
bun run db:seed-demo           # Populate demo data
bun run db:seed-kiosk          # Create kiosk service user
```

## Frontend Commands

*Run from `frontend/` or use `bun --cwd frontend`*

```bash
# Development
bun --bun run dev              # Vite dev server (http://localhost:8080; uses Bun runtime)
bun run build                  # Production bundle (minified, optimized)
bun run lint                   # ESLint
npx tsc -p tsconfig.app.json --noEmit  # TypeScript check (required before commit)

# Testing
bun run test                   # Vitest (headless)
bun run test:watch             # Vitest watch mode

# Preview
bun run preview                # Serve dist/ locally (test production build)
```

## Architecture & Code Organization

### Backend Layout (`backend-bun/src/`)

```
src/
├── index.ts                   # Entry: just imports server.ts
├── server.ts                  # Boot + listen
├── app.ts                     # CORS, Swagger, error handler, router setup
├── routes.ts                  # Route groups (mounted on app)
├── controllers/               # HTTP handlers — thin, delegate to services
├── interfaces/routes/         # TypeBox schemas for request/response per domain
├── services/                  # Business logic (checkout, inventory, wallet, auth, etc.)
├── middleware/                # Auth, CORS, logging
├── db/
│   ├── client.ts              # Postgres + Drizzle client
│   └── schema.ts              # Re-exports ../../drizzle/schema.ts
├── lib/config.ts              # Env vars (fail-fast); ONLY place to read process.env
├── utils/                     # Utilities (auth, validation, response formatting)
└── logger.ts                  # Winston logger
```

**Key principle:** Controllers route → Services handle logic. All env access via `lib/config.ts`. All auth via `AuthMiddleware`.

### Frontend Layout (`frontend/src/`)

```
src/
├── main.tsx                   # React entry
├── App.tsx                    # Router, providers (React Query, Toast, etc.)
├── pages/                     # Feature pages (Canteen, Store, Admin, Parent)
├── components/                # Reusable widgets (shadcn/ui primitives in ./ui/)
├── hooks/                     # Shared logic (useCanteenCart, useRecentColors, etc.)
├── lib/                       # Utilities (format, API client, auth, etc.)
├── contexts/                  # React Context (Auth, SchoolInfo, etc.)
├── types/                     # TypeScript interfaces
└── locales/                   # i18n (en.json, th.json) — keep keys in sync
```

**Key principle:** Use `@/*` path alias. Prefer Base Components (shadcn/ui). No inline styles. Responsive first (Tailwind breakpoints).

### Database Schema

Source of truth: `backend-bun/drizzle/schema.ts` (hand-edited). Any schema change:
1. Edit `schema.ts` by hand
2. Run `bun run db:generate --name <description>`
3. Review generated migration in `backend-bun/drizzle/`
4. Run `bun run db:migrate`

Historical note: Before 2026-07-21, schema changes went through `backend-bun/src/db/ensure_schema.ts` (idempotent patches). That mechanism is deprecated; all new changes use Drizzle migrations.

## Conventions & Guardrails

### Backend
- **Routes:** One route file per resource, mounted in `routes.ts`
- **Controllers:** Cast `ctx` → `AuthedRequestContext`, log with `requestId` prefix, use `successResponse` / `errorResponse`
- **Services:** Pure business logic; no HTTP concerns
- **Auth:** Require via `requireAuth` at router level; user in `ctx.store.user`
- **Validation:** At API boundary (controllers); use TypeBox schemas in `interfaces/routes/`
- **Errors:** Global error handler in `app.ts`; never leave unhandled exceptions
- **Tests:** Use `bun:test` in `backend-bun/tests/`; cover happy paths for checkout, wallet, role checks

### Frontend
- **Components:** PascalCase; use shadcn/ui (add via `components.json`)
- **Hooks:** camelCase `useX`; keep state logic in hooks
- **Styling:** Tailwind utilities only; `clsx` for conditionals, `tailwind-merge` for conflicts
- **i18n:** Keep `locales/en.json` and `locales/th.json` keys in sync; use `useTranslation()` hook
- **Type Safety:** Full TypeScript; run `tsc --noEmit` before commit
- **Routing:** React Router v6; guards in `App.tsx` (RequireAuth, RequireModule, etc.)
- **State:** React Query for server state, `useState` for UI state
- **Tests:** Vitest + Testing Library; `*.test.tsx` near code or in `__tests__`

### Both
- **No hardcoded secrets:** Use env vars via `backend-bun/src/lib/config.ts` (backend) or `.env` (frontend)
- **Commit messages:** Imperative, short (`Add payment methods UI`, not `added`, `Adding`)
- **PR checks before merging:** `npm run lint` (frontend), `npx tsc --noEmit` (frontend), `bun test` (backend)

## Common Workflows

### Add a new API endpoint
1. Add route in `backend-bun/src/routes.ts`
2. Create schema in `backend-bun/src/interfaces/routes/<domain>.ts` (TypeBox)
3. Write handler in `backend-bun/src/controllers/<Domain>Controller.ts`
4. Implement logic in `backend-bun/src/services/<domain>_service.ts`
5. Test with `bun test` from `backend-bun/`
6. Frontend: call via `api.get/post/patch/delete()` from `frontend/src/lib/api.ts`

### Add a new database column
1. Edit `backend-bun/drizzle/schema.ts`
2. Run `bun run db:generate --name add_<column>_to_<table>` (from `backend-bun/`)
3. Review generated SQL in `backend-bun/drizzle/<timestamp>_*.sql`
4. Run `bun run db:migrate`
5. Update backend service / controller if needed
6. Update frontend query / mutation if needed

### Manage feature flags or config
All runtime config comes from **env vars**. Add to `backend-bun/.env`, read via `backend-bun/src/lib/config.ts`. For frontend: add to `frontend/.env`, read via `import.meta.env`.

### Debug a flaky test
Backend: `bun test --timeout=10000 <test_file>` or add `.only` to isolate. Frontend: `bun run test:watch`, then rerun.

### Check a production deployment
- **Backend:** `bun run prod:logs` (via PM2)
- **Database:** Restore to local via `docker run ... pg_dump` from Railway `DATABASE_PUBLIC_URL` (see `LOCAL_DEV.md`)
- **API docs:** http://localhost:3001/docs (Swagger UI)

## Role-Based Rules (Cursor/Claude)

Cursor rules live in `.cursor/rules/*.mdc`. Key roles:
- `backend-engineer.mdc` — API, business logic, DB
- `frontend-engineer.mdc` — React UI, Tailwind, API integration
- `orchestrator.mdc` — Multi-step workflows, delegation
- `security-reviewer.mdc` — Auth, data leaks, injection
- `software-architect.mdc` — Design, API contracts, schema

When working in a specific area, load the relevant rule for guidance.

## Important Notes

1. **Active Backend:** `backend-bun/` is deployed. `backend/` (Python FastAPI) is retired — migrations there are historical.
2. **Plugin Rebuild:** After editing `capacitor-hardware/`, run `plugin build` + `bun install` so kiosk sees fresh types.
3. **RFID Reader:** Canteen POS uses AC1252 reader via NSSM service `rfid-bridge` (Windows) → ws://localhost:9001.
4. **Receipt Printer:** Kiosk USB printer (0519:2013) via UsbManager; ESC/POS raster from `escpos.ts`.
5. **Per-Category Ordering:** Product sort_order per category (not global). Backend reorder API expects `category` parameter.

## Project Status & Known Issues

See `SECURITY_FIXES_COMPLETED.md` and `WEEKLY_SUMMARY.md` for recent work. Key integrations:
- **Paywire EDC:** Integrated (2026-07-16), nginx CSP fix applied
- **ACR1252 RFID:** Deployed on Windows POS (2026-07-16)
- **Balance/Spending:** Family balance top-up and grade-based spend limits working

## Documentation

- **Detailed specs:** `.cursor/docs/` or `.claude/doc/`
- **Feature matrix:** `SYSTEM_SPEC.md` (roles × modules × routes)
- **Local dev:** `docs/LOCAL_DEV.md`
- **Security:** `SECURITY_FIXES_COMPLETED.md`, `SECURITY_CODE_REVIEW.md`
