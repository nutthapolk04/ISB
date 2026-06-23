# Repository Guidelines

## Project Structure

```
ISB/
├── frontend/          React 18 + TypeScript + Vite + shadcn/ui
├── backend-bun/       Bun + Elysia + Drizzle ORM + PostgreSQL
├── .cursor/
│   ├── rules/         Role-based agent rules (*.mdc)
│   └── docs/          Specs, feature docs, how-to guides
└── AGENTS.md          This file (Cursor reads automatically)
```

### Frontend (`frontend/`)

The Vite + React app bootstraps in `frontend/src/main.tsx`. `frontend/src/App.tsx` wires routing, the sidebar shell, and shared providers (React Query, toasters, tooltip). Feature UI lives under `frontend/src/pages`; reusable widgets sit in `frontend/src/components` (shadcn primitives in `frontend/src/components/ui`). Use `frontend/src/hooks` for shared logic and `frontend/src/lib` for helpers. Static assets are in `frontend/public`. Tailwind/shadcn config: `frontend/tailwind.config.ts`, `frontend/components.json`.

### Backend (`backend-bun/`)

Elysia app entry: `backend-bun/src/index.ts`. Routes in `backend-bun/src/routes/`, business logic in `backend-bun/src/services/`, auth in `backend-bun/src/middleware/auth.ts`. Env vars only via `backend-bun/src/lib/config.ts`. Schema: Drizzle (`backend-bun/drizzle/`). See `backend-bun/README.md` for layout and migration notes.

## Build, Test, and Development Commands

### Frontend (from `frontend/`)

- `npm run dev` — Vite dev server at http://localhost:5173
- `npm run build` — production bundle in `dist/`
- `npm run preview` — serve `dist` locally
- `npm run lint` — ESLint; run before committing
- `npx tsc -p tsconfig.app.json --noEmit` — TypeScript check

### Backend (from `backend-bun/`)

- `bun run dev` — hot-reload dev server (default http://localhost:3001)
- `bun run start` — production server
- `bun test` — run tests (`bun:test`)
- `bun run db:introspect` — regenerate Drizzle schema from Postgres
- `bun run db:generate` / `bun run db:migrate` — Drizzle migrations

Install deps from repo root: `bun install` (Bun workspace).

## Coding Style

- TypeScript for all new frontend and backend code
- Frontend: `@/*` path alias, PascalCase components/pages, `useX` hooks, two-space indent, Tailwind utilities (with `clsx` / `tailwind-merge`)
- Backend: thin routes, logic in `services/`, no `process.env` outside `lib/config.ts`
- i18n: `frontend/src/locales/en.json` + `th.json` — keep keys in sync

## Testing

- Frontend: Vitest + Testing Library — `*.test.tsx` near code or in `src/__tests__`
- Backend: `bun test` in `backend-bun/tests/`
- Cover happy paths for checkout, inventory, wallet, and role-based access before review

## Commit & Pull Request Guidelines

Short imperative commit subjects (`Add payment methods UI`, `Fix wallet top-up callback`). PRs: describe the change, reference issues, include UI screenshots when relevant, note config changes. Ensure `npm run lint`, `npm run build` (frontend), and `bun test` (backend) pass locally.

## Documentation

Detailed specs and guides live in `.cursor/docs/`. Use `@project-docs.mdc` or read directly:

| Document | Purpose |
|----------|---------|
| `CURRENT_FEATURES.md` | Implemented features and API reference |
| `FUNCTIONAL_SPEC_VS_REQUIREMENTS.md` | Requirement traceability |
| `HOW_TO_GUIDE.md` | End-user how-to (Thai) |
| `BOOKSTORE_POS_SPECIFICATION.md` | Original POS requirement baseline |
| `PARENT_STUDENT_PORTAL_SPEC.md` | Parent/student portal spec |
| `SPENDING_LIMIT_PLAN.md` | Spending group / daily limit plan |

## UI Toolkit

Add shadcn primitives via `frontend/components.json`. Keep Toast, Tooltip, Sidebar, and React Query providers in `App.tsx` — feature pages consume them, don't re-instantiate.
