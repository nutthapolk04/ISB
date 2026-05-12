# Schooney POS — ISB Cooperative Payment System

ระบบจุดขาย (POS) สำหรับสหกรณ์โรงเรียนนานาชาติ รองรับหลายร้านค้า, หลายวิธีชำระเงิน, ระบบคืน/แลกสินค้า, และการจัดการสต๊อกแบบ Avg Cost / FIFO

## Project Structure

```
trial-isb-coop/
├── frontend/          React 18 + TypeScript + Vite + shadcn/ui
├── backend/           FastAPI + SQLAlchemy + PostgreSQL
├── AGENTS.md          Developer guidelines & coding standards
└── BOOKSTORE_POS_SPECIFICATION.md   Full system specification
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, React Router v6 |
| Backend | Python 3.11+, FastAPI, SQLAlchemy 2.0, Alembic |
| Database | PostgreSQL 15+ |
| Auth | JWT (python-jose) + bcrypt |
| i18n | react-i18next (EN / TH) |

## Quick Start

### Prerequisites

- Node.js 18+ & npm
- Python 3.9+
- PostgreSQL 15+

### 1. Database Setup

```bash
createdb isb_coop_pos
```

### 2. Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Configure database connection
# Edit .env → DATABASE_URL=postgresql://localhost:5432/isb_coop_pos

alembic upgrade head
python3 seed.py            # Creates 4 shops, 21 products, 9 demo users
uvicorn app.main:app --reload --port 8000
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev                # Starts at http://localhost:5173
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

## Seeded Shops & Products

| Shop | Type | Products | Description |
|------|------|----------|-------------|
| Coop Shop | Avg Cost | 6 items | Stationery, drinks, household |
| Sports Shop | FIFO | 5 items | Sportswear, equipment |
| Cafeteria | Avg Cost | 5 items | Meals, drinks, snacks |
| Bookstore | FIFO | 5 items | Textbooks, supplies |

## Features

### Implemented (Phase 1)

- **Authentication** — JWT login/logout, role-based access (Admin / Manager / Cashier / Parent)
- **Shop Management** — CRUD shops, per-shop employees, shop info editing
- **Inventory** — Products, categories, stock receive (batch), stock adjust, movement history
- **Costing** — Weighted Average Cost & FIFO lot tracking
- **POS Checkout** — Barcode scan/search, cart, multi-payment (cash/card/QR/department), receipt generation
- **Receipts** — List, search, detail view, void with stock restoration
- **Returns & Exchange** — Create return requests, approve/reject, refund, exchange with stock update
- **i18n** — Full English / Thai translation

### Implemented (Phase 2)

- **Wallet System** — Student prepaid wallet, balance, top-up via PromptPay QR, transaction history
- **Parent Portal** — Family dashboard, child profiles, wallet management per child
- **Family Links** — Parent ↔ Student linking (admin-managed), `parent_child_links` table
- **Parent Self-Confirm Topup** — Parent creates QR → pays → self-confirms → wallet credited instantly (no admin step)
- **Card Controls** — Freeze/unfreeze card, set daily spending limit
- **Allergy & Dietary Info** — Per-student allergy fields, visible to cashier at POS
- **Admin Topup Approval** — Admin view of pending top-ups, manual confirm (alternative to parent self-confirm)
- **Customer Management** — Student profiles (student_code, grade, card_uid, allergies, dietary_notes, daily_limit)

### Planned (Phase 2 — Remaining)

- Department Budget Control & Alerts
- Approval Workflow
- Offline Mode + Sync
- Advanced Reports (daily executive, product out, budget status)
- PowerSchool Sync (allergy data auto-import)

### Planned (Phase 3)

- Automated Testing (Vitest + Testing Library)
- Docker Containerization
- CI/CD Pipeline
- Security Audit

## API Documentation

Backend provides auto-generated Swagger UI:

```
http://localhost:8000/docs
```

### Key API Groups

| Group | Prefix | Endpoints |
|-------|--------|-----------|
| Auth | `/api/v1/auth` | login, register, me, users, logout |
| Shops | `/api/v1/shops` | CRUD, stats |
| Inventory | `/api/v1/shops/{id}` | products, categories, receive, adjust, movements, FIFO lots |
| POS | `/api/v1/pos` | checkout, receipt list/detail, void |
| Returns | `/api/v1/returns` | create, list, update, delete, refund, exchange |
| Exchange | `/api/v1/exchange` | available products |
| Receipts Search | `/api/v1/receipts` | search by receipt number |
| Return History | `/api/v1/return-history` | processed returns |
| Wallets | `/api/v1/wallets` | me, family, detail, transactions, topup (QR), parent-confirm, admin-confirm |
| Customers | `/api/v1/customers` | by-code, by-card, detail, freeze, limit, allergies, create, list |
| Family | `/api/v1/family` | me (children), links CRUD |

## Deployment

| Component | Platform | Root Directory |
|-----------|----------|---------------|
| Frontend | Vercel | `frontend/` |
| Backend | Railway | `backend/` |

### Environment Variables

**Frontend (Vercel):**
```
VITE_API_BASE_URL=https://<your-backend>.up.railway.app/api/v1
```

**Backend (Railway):**
```
DATABASE_URL=<provided by Railway PostgreSQL>
SECRET_KEY=<your-production-secret>
CORS_ORIGINS=https://<your-frontend>.vercel.app
DEBUG=false
```

### Seed/Reset Data

```bash
cd backend
python3 seed.py            # Incremental (skip existing)
python3 seed.py --reset    # Drop all data + re-seed clean
```

## Project Commands

### Frontend

```bash
cd frontend
npm run dev          # Dev server (localhost:5173)
npm run build        # Production build
npm run preview      # Preview built app
npm run lint         # ESLint
npx tsc --noEmit     # TypeScript check
```

### Backend

```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000    # Dev server
alembic upgrade head                          # Run migrations
alembic revision --autogenerate -m "desc"     # Create migration
pytest                                        # Run tests
black app/                                    # Format code
```

## Architecture

```
Browser (React SPA)
    │
    │  HTTPS / JSON
    ▼
FastAPI (REST API)
    │
    │  SQLAlchemy ORM
    ▼
PostgreSQL
    ├── shops, shop_products, shop_categories
    ├── receipts, receipt_items
    ├── return_requests
    ├── users, roles, permissions
    ├── fifo_lots, shop_movements
    └── wallets, departments, audit_logs (Phase 2)
```

## License

Private — ISB Cooperative School Project
