# Schooney POS — ISB Cooperative Payment System

ระบบจุดขาย (POS) สำหรับสหกรณ์โรงเรียนนานาชาติ รองรับหลายร้านค้า, หลายวิธีชำระเงิน, ระบบคืน/แลกสินค้า, และการจัดการสต๊อกแบบ Avg Cost / FIFO

> Project documentation for Cursor agents. Developer guidelines: [`AGENTS.md`](../../AGENTS.md) (repo root).

## Project Structure

```
ISB/
├── frontend/              React 18 + TypeScript + Vite + shadcn/ui
├── backend-bun/           Bun + Elysia + Drizzle ORM + PostgreSQL
├── AGENTS.md              Developer guidelines (Cursor auto-loads)
├── .cursor/
│   ├── rules/             Role-based agent rules
│   └── docs/              This folder — specs & guides
└── BOOKSTORE_POS_SPECIFICATION.md   (see below)
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, React Router v6, React Query |
| Backend | Bun, Elysia, Drizzle ORM, postgres-js, TypeBox |
| Database | PostgreSQL 15+ |
| Auth | JWT (`@elysiajs/jwt`, HS256) |
| i18n | react-i18next (EN / TH) |

## Quick Start

### Prerequisites

- Node.js 18+ & npm (frontend)
- Bun >= 1.3 (backend)
- PostgreSQL 15+

### 1. Database Setup

```bash
createdb isb_coop_pos
```

### 2. Backend

```bash
# From repo root
bun install

cd backend-bun
cp .env.example .env
# Edit .env → DATABASE_URL, JWT_SECRET

bun run db:introspect   # optional: sync Drizzle schema from DB
bun run dev             # http://localhost:3001/health
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev             # http://localhost:5173
```

## Demo Accounts

| Username | Password | Role | Shop |
|----------|----------|------|------|
| `admin` | `admin1234` | Admin | All shops |
| `manager_coop` | `manager` | Manager | Coop Shop |
| `manager_sports` | `manager` | Manager | Sports Shop |
| `manager_cafe` | `manager` | Manager | Cafeteria |
| `manager_book` | `manager` | Manager | Bookstore |
| `cashier_coop` | `cashier` | Cashier | Coop Shop |
| `cashier_sports` | `cashier` | Cashier | Sports Shop |
| `cashier_cafe` | `cashier` | Cashier | Cafeteria |
| `cashier_book` | `cashier` | Cashier | Bookstore |

## Documentation Index

| File | Description |
|------|-------------|
| [CURRENT_FEATURES.md](CURRENT_FEATURES.md) | Implemented features, roles, API groups |
| [FUNCTIONAL_SPEC_VS_REQUIREMENTS.md](FUNCTIONAL_SPEC_VS_REQUIREMENTS.md) | Requirement traceability matrix |
| [HOW_TO_GUIDE.md](HOW_TO_GUIDE.md) | End-user how-to guide (Thai) |
| [BOOKSTORE_POS_SPECIFICATION.md](BOOKSTORE_POS_SPECIFICATION.md) | Original POS requirement baseline |
| [PARENT_STUDENT_PORTAL_SPEC.md](PARENT_STUDENT_PORTAL_SPEC.md) | Parent/student portal specification |
| [SPENDING_LIMIT_PLAN.md](SPENDING_LIMIT_PLAN.md) | Spending group / daily limit plan |

## API Documentation

Backend Swagger UI (when running locally):

```
http://localhost:3001/docs
```

## Deployment

| Component | Platform | Root Directory |
|-----------|----------|---------------|
| Frontend | Vercel | `frontend/` |
| Backend | Railway | `backend-bun/` |

### Environment Variables

**Frontend (Vercel):**

```
VITE_API_BASE_URL=https://<your-backend>.up.railway.app/api/v1
```

**Backend (Railway):**

```
DATABASE_URL=<Railway PostgreSQL>
JWT_SECRET=<production secret>
CORS_ORIGINS=https://<your-frontend>.vercel.app
NODE_ENV=production
```

## Project Commands

### Frontend

```bash
cd frontend
npm run dev
npm run build
npm run lint
npx tsc -p tsconfig.app.json --noEmit
```

### Backend

```bash
cd backend-bun
bun run dev
bun test
bun run db:migrate
```

## Architecture

```
Browser (React SPA)
    │
    │  HTTPS / JSON
    ▼
Elysia (Bun) — backend-bun/
    │
    │  Drizzle ORM
    ▼
PostgreSQL
```

## License

Private — ISB Cooperative School Project
