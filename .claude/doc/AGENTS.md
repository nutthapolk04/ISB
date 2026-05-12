# Repository Guidelines

## Project Structure & Module Organization
The Vite + React app bootstraps in `src/main.tsx`, while `src/App.tsx` wires up routing, the sidebar shell, and shared providers (React Query, toasters, tooltip). Feature UI lives under `src/pages`, and reusable widgets/design tokens sit inside `src/components` (with shadcn primitives nested in `src/components/ui`). Use `src/hooks` for shared logic and `src/lib` for helpers such as formatting or query clients. Static assets reside in `public`, and Tailwind/shadcn configuration is centralized in `tailwind.config.ts` and `components.json`.

## Build, Test, and Development Commands

### Frontend (run from `frontend/`)
- `npm run dev` — start the Vite dev server with hot reloading at http://localhost:5173.
- `npm run build` — create an optimized production bundle in `dist`.
- `npm run preview` — serve the `dist` bundle locally to verify production output.
- `npm run lint` — lint all TypeScript/TSX files via `eslint.config.js`; run before committing.
- `npx tsc -p tsconfig.app.json --noEmit` — TypeScript type check (preferred over `npx tsc --noEmit`).

### Backend (run from `backend/`)
- `bash start.sh` — run schema migrations then start the server (used in production on Railway).
- `uvicorn app.main:app --reload --port 8000` — dev server only (no schema migration).
- **Note:** This project does NOT use Alembic. Schema changes are raw SQL patches in `start.sh` applied via SQLAlchemy `engine.begin()` per-statement. Do not generate or run Alembic migrations.

## Coding Style & Naming Conventions
Use TypeScript for all new code, rely on the `@/*` path alias, and favor functional React components. Components and pages should use PascalCase filenames (`AppSidebar.tsx`, `Store.tsx`), while hooks use the `useX` camelCase pattern inside `src/hooks`. Maintain two-space indentation, keep JSX props on separate lines when numerous, and express UI styling through Tailwind utility classes (augment with `clsx` and `tailwind-merge` when composing). Run `npm run lint` to keep React Hook rules and the shadcn import order intact.

## Testing Guidelines
The repo presently lacks automated tests; add Vitest + Testing Library when implementing meaningful logic. Place specs near the code as `*.test.tsx` or inside `src/__tests__`, mock `@tanstack/react-query` calls, and cover at least the happy path for checkout, inventory adjustments, and sidebar navigation. Aim to exercise user-visible flows (form validation, toasts, navigation) before requesting review.

## Commit & Pull Request Guidelines
Recent commits use short imperative summaries (`Simplify theme colors`, `Add payment methods UI`). Follow that style, keep scope focused, and include context in the body when touching data flows or theme tokens. Pull requests should describe the change, reference tracking issues, include before/after screenshots for UI shifts, and note any config updates (`tailwind.config.ts`, `components.json`). Ensure `npm run lint` and `npm run build` succeed locally before requesting review.

## UI Toolkit & Configuration Tips
When adding new primitives, generate them via shadcn (`components.json`) so tokens remain consistent, and record any Tailwind plugin changes in `tailwind.config.ts`. Keep Toast, Tooltip, Sidebar, and React Query providers centralized in `App.tsx`; feature pages should consume them rather than re-instantiating providers.
