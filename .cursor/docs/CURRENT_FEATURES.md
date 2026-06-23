# Schooney POS — Current Feature Specification

> Last updated: 2026-05-19
> Version: 2.4.0 (Phase 4 — Department Payment + Wallet Fixes)

---

## 1. System Overview

| Item | Detail |
|------|--------|
| **System Name** | Schooney POS — ISB Cooperative Payment System |
| **Purpose** | Point of Sale system for international school cooperatives, supporting multiple shops |
| **Architecture** | Monorepo: React SPA (`frontend/`) + Elysia API (`backend-bun/`) + PostgreSQL |
| **Deployment** | Vercel (frontend) + Railway (backend-bun + PostgreSQL) |
| **Frontend URL** | https://isb-beta.vercel.app |
| **Backend URL** | https://okontek-isb-project-prototype-production.up.railway.app |
| **API Docs** | `{backend_url}/docs` (Elysia Swagger) |

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, React Router v6 |
| Backend | Bun, Elysia, Drizzle ORM, postgres-js |
| Database | PostgreSQL 15+ |
| Auth | JWT (`@elysiajs/jwt`, HS256) |
| i18n | react-i18next (EN / TH) |

---

## 2. User Roles & Access Control

| Role | Module Access | Restrictions |
|------|--------------|-------------|
| **Admin** | All modules + Shop Management + Reports + Family/Topup admin | None — cross-module |
| **Manager** | POS, Receipts, Returns, Void, Shop Management (own shop only) | Scoped to assigned shop |
| **Cashier** | POS, Receipts | Scoped to assigned shop |
| **Parent** | Parent Portal (`/parent/*`) only | Linked children's wallets only |
| **Staff** | Parent Portal (own wallet) | Same as parent, no POS |

### Module Architecture

Shops are grouped into two independent modules, enforced by `RequireModule` guard:

| Module | shopId prefix | Shops |
|--------|--------------|-------|
| `canteen` | `canteen`, `canteen_*` | ISB Canteen, Thai Kitchen, Drinks & Snacks |
| `store` | everything else | Coop Shop, Sports Shop, Bookstore |

`user.shopModule` is stored at login (authoritative from `shops.module` column, fallback via `moduleOf(shopId)` prefix convention).

### Route Access Matrix

| Route | Admin | Manager | Cashier | Parent/Staff |
|-------|-------|---------|---------|-------------|
| `/` (Landing → redirect) | ✅ | ✅ | ✅ | ✅ |
| `/canteen` (Canteen POS) | ✅ | ✅ (canteen) | ✅ (canteen) | ❌ |
| `/canteen/receipts` | ✅ | ✅ (canteen) | ✅ (canteen) | ❌ |
| `/canteen/products` | ✅ | ✅ (canteen) | ❌ | ❌ |
| `/canteen/users` | ✅ | ✅ (canteen) | ❌ | ❌ |
| `/canteen/reports` | ✅ | ❌ | ❌ | ❌ |
| `/store` (Store POS) | ✅ | ✅ (store) | ✅ (store) | ❌ |
| `/store/receipts` | ✅ | ✅ (store) | ✅ (store) | ❌ |
| `/store/returns` | ✅ | ✅ (store) | ❌ | ❌ |
| `/store/void` | ✅ | ✅ (store) | ❌ | ❌ |
| `/store/management` | ✅ | ✅ (store, own shop) | ❌ | ❌ |
| `/store/management/:shopId` | ✅ | ✅ (own shop) | ❌ | ❌ |
| `/store/users` | ✅ | ✅ (store) | ❌ | ❌ |
| `/store/reports` | ✅ | ❌ | ❌ | ❌ |
| `/admin/*` | ✅ | ❌ | ❌ | ❌ |
| `/parent/dashboard` | ✅ | ❌ | ❌ | ✅ |
| `/parent/wallet/:id` | ✅ | ❌ | ❌ | ✅ |
| `/parent/transactions/:id` | ✅ | ❌ | ❌ | ✅ |
| `/parent/profile/:id` | ✅ | ❌ | ❌ | ✅ |
| `/parent/transfer` | ✅ | ❌ | ❌ | ✅ |

---

## 3. Demo Accounts

### Admin

| Username | Password | Role | Shop |
|----------|----------|------|------|
| `admin` | `admin1234` | Admin | All |

### Canteen Module (module = canteen)

| Username | Password | Role | Shop |
|----------|----------|------|------|
| `manager_canteen` | `manager` | Manager | ISB Canteen |
| `cashier_canteen` | `cashier` | Cashier | ISB Canteen |
| `manager_canteen_thai` | `manager` | Manager | Thai Kitchen |
| `cashier_canteen_thai` | `cashier` | Cashier | Thai Kitchen |
| `manager_canteen_drinks` | `manager` | Manager | Drinks & Snacks |
| `cashier_canteen_drinks` | `cashier` | Cashier | Drinks & Snacks |

### Store Module (module = store)

| Username | Password | Role | Shop |
|----------|----------|------|------|
| `manager_coop` | `manager` | Manager | Coop Shop |
| `cashier_coop` | `cashier` | Cashier | Coop Shop |
| `manager_sports` | `manager` | Manager | Sports Shop |
| `cashier_sports` | `cashier` | Cashier | Sports Shop |
| `manager_book` | `manager` | Manager | Bookstore |
| `cashier_book` | `cashier` | Cashier | Bookstore |

### Staff-Parents with Children (PowerSchool — password: `parent`)

| Username | Detail |
|----------|--------|
| `somchair` | Somchai RAKDEE — 3 ลูก |
| `prasitj` | Prasit JAIDEE — แต่งกับ Wanida, 2 ลูก |
| `wanidaj` | Wanida JAIDEE — คู่กับ Prasit |
| `porntips` | Pornthip SUWAN — partner Kritsada, 2 ลูก |

### Staff (no children, password: `parent`)

`jirawatj`, `phatthab`, `angkanan`, `chadb`, `narino`, `tua`, `suttinel`, `thitaphp`

### Parents (PowerSchool — password: `parent`)

| Username | Detail |
|----------|--------|
| `85001` | John Wick — 1 ลูก (คู่กับ Kate=`85002`) |
| `85002` | Kate Wick — คู่กับ John |
| `85003` | Brad Pitt — 1 ลูก |
| `70652` | Kritsada SUWAN — partner Pornthip (staff) |
| `70699` | Malee RAKDEE — partner Somchai (staff) |

---

## 4. Seeded Demo Data

| Data | Count | Details |
|------|-------|---------|
| Shops | 6 | Coop (avg_cost/store), Sports (fifo/store), Bookstore (fifo/store), Canteen (canteen), Thai Kitchen (canteen), Drinks & Snacks (canteen) |
| Products | ~35+ | ~6 Coop + ~5 Sports + ~5 Bookstore + ~20 Canteen + ~7 Thai + ~8 Drinks |
| Users (coop/canteen) | 15 | 1 admin + 3 retail managers + 3 retail cashiers + 3 canteen managers + 3 canteen cashiers + 2 manager without shop |
| Staff users | 12 | Seeded via PowerSchool fixture (jirawatj, phatthab, angkanan, chadb, narino, tua, suttinel, thitaphp, somchair, prasitj, wanidaj, porntips) |
| Parent users | 5 | 85001, 85002, 85003, 70652, 70699 |

Reset command: `cd backend && python3 seed.py --reset`

---

## 5. Module Specifications

### Module 1: Authentication ✅

| Feature | Description | API |
|---------|-------------|-----|
| Login | JWT token via username/password | `POST /auth/login` |
| Profile | Get current user info | `GET /auth/me` |
| Register | Admin creates new user account | `POST /auth/register` |
| List Users | View all user accounts | `GET /auth/users` |
| Logout | Client-side token invalidation | `POST /auth/logout` |
| Fallback | If backend unreachable, mock login for demo | — |

**Token Flow:**
1. `POST /auth/login` → returns `access_token` + `refresh_token`
2. Token stored in `localStorage("access_token")`
3. All API calls include `Authorization: Bearer {token}`

---

### Module 2: Shop Management ✅

| Feature | Description | API |
|---------|-------------|-----|
| List Shops | 2-tab view: 🍜 Canteens / 🏪 Retail — card grid per module | `GET /shops/?active_only=true` |
| Shop Stats | Total products (always); low stock count + total value (store module only) | `GET /shops/{id}/stats` |
| Create Shop | Specify ID, name, description, costing type, module | `POST /shops/` |
| Edit Shop | Update name, description, active status | `PATCH /shops/{id}` |
| Delete Shop | Hard delete if no receipts; soft delete (is_active=false) if has receipts | `DELETE /shops/{id}` |
| Shop Module | `module` column on shops (`canteen` or `store`) drives module routing + stock semantics | — |

**Shop Types** (store module only — canteen ignores costing):

- `avg_cost` — Weighted average cost recalculation on receive
- `fifo` — First-In First-Out lot tracking

**Shop Modules:**

- `canteen` — Canteen POS routes (`/canteen/*`); menu-oriented UI; **no stock or cost tracking** — items are made-to-order, not stocked. Costing-type badge is hidden on the shop card.
- `store` — Store POS routes (`/store/*`); inventory + returns UI; full stock/movement/FIFO tracking

---

### Module 3: Inventory Management ✅ (store module only)

> **Canteen note:** canteen shops have menu CRUD only — `Stock Receive`, `Stock Adjust`, `Movement History`, and `FIFO Lots` are not surfaced in the canteen UI and seed sets `stock = 0` / `avg_cost = 0` for every canteen item.

| Feature | Description | Scope | API |
|---------|-------------|-------|-----|
| List Products | Per-shop products with search, category filter | both | `GET /shops/{id}/products` |
| Create Product | Code, barcode, name, category, dual pricing, VAT, initial stock | both (canteen ignores stock fields) | `POST /shops/{id}/products` |
| Edit Product | Update product details (not stock directly) | both | `PATCH /shops/{id}/products/{pid}` |
| Delete Product | Soft delete | both | `DELETE /shops/{id}/products/{pid}` |
| Categories CRUD | Per-shop product categories | both | `GET/POST/PATCH/DELETE /shops/{id}/categories` |
| Stock Receive | Batch receive with cost per unit | store only | `POST /shops/{id}/receive` |
| Stock Adjust | Manual adjustment with reason | store only | `POST /shops/{id}/adjust` |
| Movement History | View all stock movements | store only | `GET /shops/{id}/movements` |
| FIFO Lots | View lot details for FIFO shops | store only | `GET /shops/{id}/products/{pid}/fifo-lots` |

**Product Fields:**

| Field | Description |
|-------|-------------|
| `product_code` | Unique code per shop (e.g. P001) |
| `barcode` | EAN-13 or custom barcode |
| `name` | Product display name |
| `category` | Category name (from shop categories) |
| `external_price` | Retail price (public) |
| `internal_price` | Internal/staff price |
| `vat_percent` | VAT percentage (0 or 7) |
| `avg_cost` | Calculated cost (auto for avg_cost, from lots for FIFO) |
| `stock` | Current stock quantity (negative allowed) |
| `min_stock` | Low stock threshold |

**Costing Logic:**
- **Avg Cost shops:** `new_avg = (current_qty * current_avg + new_qty * new_cost) / (current_qty + new_qty)`
- **FIFO shops:** Each receive creates a lot; deductions consume oldest lots first; phantom lot for negative stock

---

### Module 4: POS Checkout ✅

| Feature | Description | API |
|---------|-------------|-----|
| Product Search | Search by barcode, product code, or name | Client-side filter |
| Barcode Scan | Type/scan barcode → auto-add to cart | Client-side |
| Cart Management | Add, remove, adjust quantity | Client-side state |
| Price Modes | Retail (external_price) / Internal (internal_price) | Client-side toggle |
| Checkout | Create receipt + deduct stock | `POST /pos/checkout` |

**Payment Methods:**

| Method | Frontend Label | Backend Enum | Validation |
|--------|---------------|-------------|------------|
| Cash | เงินสด | `cash` | Must enter amount >= total |
| Student Card | บัตรนักเรียน | `wallet` | Card tap simulation |
| QR/PromptPay | QR/พร้อมเพย์ | `credit_card` | QR scan simulation |
| Department | แผนก | `department` | Search by dept code; debits department wallet |

**Checkout Payload:**
```json
{
  "transaction_mode": "sale | internal_issue",
  "payment_method": "cash | credit_card | wallet | bank_transfer",
  "items": [
    { "product_variant_id": 1, "quantity": 2, "unit_price": 5.00, "discount": 0 }
  ],
  "notes": "optional"
}
```

**Response:** Receipt object with `receipt_number` (format: `R-YYYYMMDD-NNN`)

**Side Effects:**
- Stock deducted per item
- ShopMovement recorded (type: `sale` or `internal_use`)
- FIFO lots consumed (for FIFO shops)

---

### Module 5: Receipt Management ✅

| Feature | Description | API |
|---------|-------------|-----|
| List Receipts | All receipts with search by receipt number | `GET /pos/receipt` |
| Receipt Detail | View items, prices, payment method, status | `GET /pos/receipt/{id}` |
| KPI Dashboard | Total sales (active), receipt count, today's sales | Calculated client-side |
| Status Display | Active (green) / Voided (red) badge | — |

---

### Module 6: Void Transaction ✅

| Feature | Description | API |
|---------|-------------|-----|
| List Transactions | All receipts (active shown clickable, voided grayed out) | `GET /pos/receipt` |
| Void Receipt | Select → enter reason → confirm | `POST /pos/void/{id}` |
| Stock Restore | Automatically restores stock for all items | Backend auto |
| Movement Log | Records movement type=`void` | Backend auto |
| Double-void Guard | Already voided receipts cannot be voided again | Backend validation |

---

### Module 7: Returns & Exchange ✅

| Feature | Description | API |
|---------|-------------|-----|
| Search Receipt | Find receipt by receipt number | `GET /receipts/search?receiptId=` |
| Create Return | Select items + quantities + reason | `POST /returns/create` |
| List Returns | All return requests (pending/approved/rejected) | `GET /returns` |
| Approve/Reject | Change status from pending | `PUT /returns/{id}` |
| Delete Return | Remove pending return request | `DELETE /returns/{id}` |
| Refund (Cash) | Process cash refund | `POST /returns/{id}/refund` |
| Refund (Card) | Process card refund | `POST /returns/{id}/refund` |
| Exchange | Return items + get new items | `POST /returns/{id}/exchange` |
| Available Products | Products available for exchange | `GET /exchange/products` |

**Return Request Fields:**
```
receiptId, productCode, productName, quantity, returnQuantity,
price, reason, status, priceType, returnStatus
```

**Refund Payload:**
```json
{
  "returnItems": [{ "productCode": "P001", "returnQuantity": 2 }],
  "refundMethod": "cash | card",
  "reason": "..."
}
```

**Exchange Payload:**
```json
{
  "returnItems": [{ "productCode": "P001", "returnQuantity": 2 }],
  "exchangeItems": [{ "productCode": "SP001", "quantity": 1 }],
  "difference": 175.0,
  "reason": "..."
}
```

**Side Effects:**
- Refund: restore stock for returned items
- Exchange: restore stock for returned items + deduct stock for new items
- Movement recorded for both operations

---

### Module 8: Return History ✅

| Feature | Description | API |
|---------|-------------|-----|
| List History | Processed returns (non-pending) | `GET /return-history` |
| Detail Dialog | Return/exchange items, values, difference, reason | Client-side dialog |
| Search | Filter by receipt number or reason | Client-side filter |

---

### Module 9: Employee Management ⚠️ Partial

| Feature | Description | Storage |
|---------|-------------|---------|
| List Employees | Per-shop employee list | localStorage |
| Add Employee | Creates real backend user account (can login) | API `POST /auth/register` + localStorage |
| Edit Employee | Update name, role | localStorage only |
| Delete Employee | Remove from shop | localStorage only |

**Limitation:** No shop-employee relation table in backend. Employee assignment is stored in `localStorage` per browser session. Backend only stores the user account (username, password, email).

**Seed Data:** 8 demo employees (2 per shop) auto-loaded on first visit.

---

### Module 10: Reports ❌ UI Only (No Backend)

| Feature | Status |
|---------|--------|
| 7 Report Types (Sales, Stock, Returns, Payment, Top Selling, Profit/Loss, Department) | UI cards exist |
| Date Range Picker | Works |
| CSV Export | Works (but hardcoded sample data) |
| Backend API | Not implemented |
| Real Data | Not available |

---

### Module 11: Internationalization (i18n) ✅

| Feature | Description |
|---------|-------------|
| Languages | English (en) + Thai (th) |
| Switcher | Toggle in UI header |
| Files | `frontend/src/locales/en.json`, `frontend/src/locales/th.json` |
| Coverage | Nearly all pages (some new pages have inline fallback text) |

---

### Module 12: Customer / Student Management ✅ (Phase 2)

| Feature | Description | API |
|---------|-------------|-----|
| Student Profile | name, student_code, grade, card_uid, allergies, dietary_notes | `GET /customers/{id}` |
| Lookup by Code | Find student by student_code | `GET /customers/by-code/{code}` |
| Lookup by Card | Find student by NFC card UID | `GET /customers/by-card/{uid}` |
| Create Student | Admin creates new student profile + auto-creates wallet | `POST /customers/` |
| List Students | Admin view of all students | `GET /customers/` |
| Freeze Card | Toggle card freeze (prevent spending) | `POST /customers/{id}/freeze` |
| Daily Limit | Set/update daily spending cap | `PATCH /customers/{id}/limit` |
| Update Allergies | Update allergy & dietary notes | `PATCH /customers/{id}/allergies` |
| Search Members | Unified search (students + staff/parents + departments) | `GET /customers/search` + `GET /departments/` |
| Canteen Member Search | Search modal in Canteen POS finds students, staff, parents, departments | Frontend |

**Student Fields:**

| Field | Description |
|-------|-------------|
| `student_code` | Unique school ID (e.g. S001) |
| `grade` | Grade level (e.g. "G10") |
| `card_uid` | NFC/RFID card UID for POS tap-to-pay |
| `card_frozen` | If true, wallet spending blocked |
| `daily_limit` | Max spend per day (NULL = no limit) |
| `allergies` | Allergy tags (shown to cashier) |
| `dietary_notes` | Free-text dietary info |
| `powerschool_sync_at` | Last PowerSchool sync timestamp |

---

### Module 13: Wallet System ✅ (Phase 2)

| Feature | Description | API |
|---------|-------------|-----|
| Wallet Balance | View student wallet balance | `GET /wallets/{wallet_id}` |
| My Wallet | Student views own wallet | `GET /wallets/me` |
| Family Wallets | Parent views all children's wallets | `GET /wallets/family` |
| Transaction History | Wallet tx history with date filter | `GET /wallets/{wallet_id}/transactions` |
| Create Topup QR | Generate PromptPay QR intent | `POST /wallets/{wallet_id}/topup` |
| Parent Self-Confirm | Parent confirms payment → instant credit (auto, no admin) | `POST /wallets/topup/{ref_code}/parent-confirm` |

**Topup Flow (Parent Self-Confirm):**
1. Parent enters amount → `POST /wallets/{id}/topup` → QR dialog opens
2. Parent scans QR with bank app, transfers money
3. Parent clicks "ยืนยันการโอน" → `POST /wallets/topup/{ref_code}/parent-confirm`
4. Wallet credited immediately, dialog closes, balance updates

**WalletTransaction Types:** `TOPUP`, `DEDUCTION`, `REFUND`, `ADJUSTMENT`

**PaymentIntent Statuses:** `pending` → `confirmed` | `cancelled`

---

### Module 14: Parent Portal ✅ (Phase 2)

| Page | Route | Description |
|------|-------|-------------|
| Family Dashboard | `/parent/dashboard` | All children cards: balance, allergy alerts, quick actions |
| Wallet Detail | `/parent/wallet/:customerId` | Balance card, topup QR flow, last 10 transactions |
| Transaction History | `/parent/transactions/:customerId` | Full history with date range filter + CSV export |
| Student Profile | `/parent/student/:customerId` | Student info, card freeze toggle, daily limit editor |

---

### Module 15: Family Link Management ✅ (Phase 2)

| Feature | Description | API |
|---------|-------------|-----|
| My Children | Parent lists their linked children | `GET /family/me` |
| All Links | Admin view all parent-child links | `GET /family/links` |
| Create Link | Admin links a parent user to a student | `POST /family/links` |
| Delete Link | Admin removes a link | `DELETE /family/links/{link_id}` |

**Schema:** `parent_child_links(id, parent_user_id, child_customer_id, relation, created_at)`

---

### Module 16: Topup Flow — Auto-Confirm (Phase 2.1)

> **Removed:** the previous `/admin/topups` confirmation page and admin manual-confirmation endpoints. Topups are now semi-automatic: parent generates a QR intent, pays externally, and the parent app calls `parent-confirm` which credits the wallet immediately. No admin gating.

| Feature | Description | Route/API |
|---------|-------------|-----------|
| Create QR Intent | Parent generates a top-up reference + PromptPay payload | `POST /wallets/{wallet_id}/topup` |
| Parent Confirm | After paying, parent app calls confirm → wallet credited; `confirmed_via=parent_self` recorded for audit | `POST /wallets/topup/{ref_code}/parent-confirm` |
| Family Link Admin | Admin manages parent-child links | `/admin/families` |

**Audit trail:** `payment_intents.status` / `confirmed_at` / `confirmed_by` / `confirmed_via` columns retained for history. `WalletTransaction` rows are still written on each credit.

---

### Module 17: Department Wallet System ✅

| Feature | Description | API |
|---------|-------------|-----|
| List Departments | List with wallet balance | `GET /departments/` |
| Department Wallet Adjust | Admin credits/debits dept wallet | `POST /admin/departments/{id}/adjust` |
| Transaction History | Last N transactions per dept | `GET /admin/departments/{id}/transactions` |
| POS Department Charge | Charge purchase to dept wallet | `POST /pos/checkout` with `payer_kind=department` |
| Dept Search in POS | Search by dept code (D0001) in RFID modal + Member Search modal | Frontend only |

---

### Module 18: Receipt Improvements ✅

- Receipt dialog (`ReceiptDetailDialog`) shows: shop name (seller), cashier name, payer card/account
- Wallet balance in receipt = `balance_after` at time of purchase (not current balance)
- Used in both Admin dashboard and Parent transaction history

---

## 6. API Endpoint Summary

### Auth (5 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/auth/login` | Login → JWT tokens |
| GET | `/api/v1/auth/me` | Current user profile |
| POST | `/api/v1/auth/register` | Create user (admin only) |
| GET | `/api/v1/auth/users` | List all users |
| POST | `/api/v1/auth/logout` | Logout hint |

### Shops (6 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/shops/` | List shops |
| POST | `/api/v1/shops/` | Create shop (with module field) |
| GET | `/api/v1/shops/{id}` | Get shop |
| PATCH | `/api/v1/shops/{id}` | Update shop |
| DELETE | `/api/v1/shops/{id}` | Delete shop (hard if no receipts, soft otherwise) |
| GET | `/api/v1/shops/{id}/stats` | Shop KPIs |

### Inventory (11 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/shops/{id}/products` | List products |
| POST | `/api/v1/shops/{id}/products` | Create product |
| PATCH | `/api/v1/shops/{id}/products/{pid}` | Update product |
| DELETE | `/api/v1/shops/{id}/products/{pid}` | Delete product |
| GET | `/api/v1/shops/{id}/products/{pid}/fifo-lots` | FIFO lots |
| GET | `/api/v1/shops/{id}/categories` | List categories |
| POST | `/api/v1/shops/{id}/categories` | Create category |
| PATCH | `/api/v1/shops/{id}/categories/{cid}` | Update category |
| DELETE | `/api/v1/shops/{id}/categories/{cid}` | Delete category |
| POST | `/api/v1/shops/{id}/receive` | Receive stock (batch) |
| POST | `/api/v1/shops/{id}/adjust` | Adjust stock |

### POS (4 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/pos/checkout` | Create receipt + deduct stock |
| GET | `/api/v1/pos/receipt` | List receipts |
| GET | `/api/v1/pos/receipt/{id}` | Get receipt detail |
| POST | `/api/v1/pos/void/{id}` | Void receipt + restore stock |

### Returns (10 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/returns/create` | Create return request(s) |
| GET | `/api/v1/returns` | List returns |
| GET | `/api/v1/returns/{id}` | Get return |
| PUT | `/api/v1/returns/{id}` | Update return (approve/reject) |
| DELETE | `/api/v1/returns/{id}` | Delete return |
| POST | `/api/v1/returns/{id}/refund` | Process refund |
| POST | `/api/v1/returns/{id}/exchange` | Process exchange |
| GET | `/api/v1/return-history` | Processed returns |
| GET | `/api/v1/receipts/search` | Search receipt by number |
| GET | `/api/v1/exchange/products` | Available products for exchange |

### Movements (1 endpoint)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/shops/{id}/movements` | Stock movement history |

### Wallets (10 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/wallets/me` | Student: own wallet |
| GET | `/api/v1/wallets/family` | Parent: all children wallets |
| GET | `/api/v1/wallets/{wallet_id}` | Get specific wallet |
| GET | `/api/v1/wallets/{wallet_id}/transactions` | Wallet transaction history |
| POST | `/api/v1/wallets/{wallet_id}/topup` | Create topup intent + QR |
| POST | `/api/v1/wallets/topup/{ref_code}/parent-confirm` | Parent: self-confirm topup → auto-credit |
| POST | `/api/v1/wallets/transfer` | Sibling transfer |
| POST | `/api/v1/wallets/{id}/adjust` | Admin manual adjust + audit trail |

### Customers (12 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/customers/by-code/{code}` | Lookup by student_code |
| GET | `/api/v1/customers/by-card/{uid}` | Lookup by NFC card UID |
| GET | `/api/v1/customers/{id}` | Get student profile |
| POST | `/api/v1/customers/{id}/freeze` | Toggle card freeze |
| PATCH | `/api/v1/customers/{id}/limit` | Set daily spending limit |
| PATCH | `/api/v1/customers/{id}/allergies` | Update allergy info + override note |
| PATCH | `/api/v1/customers/{id}/negative-limit` | Set overdraft limit |
| PATCH | `/api/v1/customers/{id}/card` | Bind/unbind NFC card |
| POST | `/api/v1/customers/{id}/photo` | Upload profile photo (Cloudinary) |
| POST | `/api/v1/customers/{id}/graduate` | Mark graduated + balance transfer |
| POST | `/api/v1/customers/` | Create student (admin) |
| GET | `/api/v1/customers/` | List all students (admin) |

### Family (5 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/family/me` | Parent: list own children |
| GET | `/api/v1/family/links` | Admin: all parent-child links |
| POST | `/api/v1/family/links` | Admin: create link |
| DELETE | `/api/v1/family/links/{link_id}` | Admin: remove link |
| POST | `/api/v1/family/freeze-all` | Global freeze/unfreeze all children |

### Auth (9 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/auth/login` | Login → JWT tokens |
| POST | `/api/v1/auth/sso/mock` | Mock SSO auto-create parent |
| GET | `/api/v1/auth/me` | Current user profile |
| POST | `/api/v1/auth/register` | Create user (admin only) |
| GET | `/api/v1/auth/users` | List all users |
| GET | `/api/v1/auth/users/{id}/roles` | List secondary roles |
| POST | `/api/v1/auth/users/{id}/roles` | Assign role |
| DELETE | `/api/v1/auth/users/{id}/roles/{name}` | Remove role |
| POST | `/api/v1/auth/logout` | Logout hint |

**Total: ~70 active endpoints**

---

## 7. Database Schema (Active Tables)

| Table | Status | Description |
|-------|--------|-------------|
| `users` | ✅ Active | User accounts (username, email, password hash, role, shop_id) |
| `roles`, `permissions`, `user_roles`, `role_permissions` | ⚠️ Partial | RBAC structure exists, enforcement is a stub |
| `shops` | ✅ Active | Shop/sub-merchant (id, name, shop_type, module, is_active) — module column added Phase 3 |
| `shop_products` | ✅ Active | Products per shop (pricing, stock, cost) |
| `shop_categories` | ✅ Active | Categories per shop |
| `shop_movements` | ✅ Active | Stock movement audit log |
| `fifo_lots` | ✅ Active | FIFO lot tracking per product |
| `receipts` | ✅ Active | Sales receipts (immutable, voidable) — includes shop_id |
| `receipt_items` | ✅ Active | Line items per receipt |
| `return_requests` | ✅ Active | Return/exchange tracking |
| `customers` | ✅ Active | Student profiles (student_code, grade, card_uid, card_frozen, daily_limit, allergies, dietary_notes, allergy_override_note, negative_credit_limit, photo_url, powerschool_sync_at) |
| `wallets` | ✅ Active | Student prepaid wallet (balance, is_active) |
| `wallet_transactions` | ✅ Active | Wallet tx history (TOPUP/DEDUCTION/REFUND/ADJUSTMENT) |
| `payment_intents` | ✅ Active | PromptPay QR topup intents (pending/confirmed/cancelled) |
| `parent_child_links` | ✅ Active | Parent ↔ Student relationships (relation type, timestamps) |
| `departments`, `budget_transactions` | ❌ No API | Budget control models exist, no API yet |
| `credit_notes` | ❌ No API | Credit note model exists, not used |
| `approval_requests` | ❌ No API | Approval workflow model, not used |
| `audit_logs` | ❌ No API | Audit trail model, not used |
| `products`, `product_variants`, `categories` | ⚠️ Legacy | Global catalog (not used, shop_products used instead) |

---

## 8. Known Limitations

| Area | Limitation |
|------|-----------|
| **Employee-Shop relation** | Employee management scoped to shop via backend `shop_id` column on users |
| **Permission enforcement** | Backend `check_permission()` is a stub — all authenticated users pass |
| **Card/Payment verification** | All payment methods are simulated (no real card reader or payment gateway) |
| **Reports** | UI only, no backend data aggregation |
| **Receipt PDF** | Download button exists but no PDF generation |
| **Pagination** | Most list endpoints load all records |
| **Refresh token** | Token exists but rotation flow not implemented |
| **Department charge** | Requires shop to have `allow_department_charge=true` |
| **Receipt PDF download** | Button exists, not yet implemented |
| **PowerSchool sync** | Fixture-based (demo only, no live API) |

---

## 9. Not Yet Implemented

| Module | DB Model | API | Frontend | Priority |
|--------|----------|-----|----------|----------|
| Budget Control / Department wallet | ✅ exists | ✅ API | ✅ Frontend (dept wallet adjust, balance, transaction history via `/admin/departments/{id}/adjust` and `/admin/departments/{id}/transactions`) | Phase 4 — Done |
| Approval Workflow | ✅ exists | ❌ | ❌ | Phase 2 |
| Reports (real data) | — | ⚠️ Partial | Canteen daily report exists, full reports still UI-only | Phase 2 |
| PowerSchool Sync | — | ❌ | ❌ | Phase 2 |
| Alipay / WeChat Pay topup | — | ❌ | ❌ | Phase 2 |
| Credit Card topup | — | ❌ | ❌ | Phase 2 |
| Offline Mode + Sync | — | ❌ | ❌ | Phase 2 |
| Receipt PDF export | — | ❌ | button exists | Phase 2 |
| Permission Enforcement | — | ⚠️ stub | — | Phase 1 backlog |
| Automated Testing | — | ❌ | ❌ | Phase 3 |
| Docker / CI-CD | Dockerfile exists | — | — | Phase 3 |
| Security Audit | — | — | — | Phase 3 |
