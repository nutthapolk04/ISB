# Schooney Payment System — Functional Specification vs. Customer Requirements

> **System:** Schooney Payment System (ISB Cooperative)
> **Document type:** Requirement-to-implementation traceability (functional spec)
> **Audience:** ISB stakeholders, PM, development team, QA
> **Last updated:** 2026-04-22 (Phase 3 Sprint 3 — Canteen Module)
> **Legend:** ✅ Full · ⚠️ Partial · ❌ Missing · 🆕 Added beyond original spec

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Module-by-Module Functional Spec](#2-module-by-module-functional-spec)
3. [Business Rule Overrides Summary](#3-business-rule-overrides-summary)
4. [Gap Analysis — Missing Features](#4-gap-analysis--missing-features)
5. [Phase 3 Sprint 1+2 Deliverables (Added Beyond Spec)](#5-phase-3-sprint-12-deliverables)
6. [API Endpoint Reference](#6-api-endpoint-reference)
7. [Frontend Route Reference](#7-frontend-route-reference)
8. [Database Schema Status](#8-database-schema-status)
9. [Known Limitations](#9-known-limitations)
10. [Recommendations — Next Steps](#10-recommendations)

---

## 1. Executive Summary

### Requirement Sources

| Source | Document | Scope |
|--------|----------|-------|
| R-BASE | [BOOKSTORE_POS_SPECIFICATION.md](BOOKSTORE_POS_SPECIFICATION.md) | Original 12-module POS spec |
| R-OVERRIDE | Internal — Schooney business rules | Negative balance/stock allowed, family wallet, pricing tier, sub-merchant, offline, hardware |
| R-PHASE2 | [PARENT_STUDENT_PORTAL_SPEC.md](PARENT_STUDENT_PORTAL_SPEC.md) | Parent/Student portal (7 features) |
| R-PHASE3 | Internal — admin control features | Family Relationship, Wallet Control, Safety/Health, Card Security (modules A–D) |

### Coverage Dashboard

| # | Module | Source | Coverage | Status |
|---|--------|--------|:--------:|--------|
| 1 | Product & Barcode Management | R-BASE §1 | 75% | ⚠️ |
| 2 | Pricing System | R-BASE §2 + R-OVERRIDE | 60% | ⚠️ |
| 3 | POS Engine | R-BASE §3 | 85% | ⚠️ |
| 4 | Inventory Engine | R-BASE §4 + R-OVERRIDE | 95% | ✅ |
| 5 | Receipt & Transaction Control | R-BASE §5 | 80% | ✅ |
| 6 | Return & Exchange Engine | R-BASE §6 | 90% | ✅ |
| 7 | Wallet System | R-BASE §7 + R-OVERRIDE | 95% | ✅ |
| 8 | Reporting Engine | R-BASE §8 | 20% | ❌ |
| 9 | Product Out Report | R-BASE §9 | 30% | ❌ |
| 10 | Budget Control | R-BASE §10 | 10% | ❌ |
| 11 | Budget Alert System | R-BASE §11 | 0% | ❌ |
| 12 | Approval Workflow | R-BASE §12 | 10% | ❌ |
| 13 | Sub-merchant / Shop System 🆕 | R-OVERRIDE | 100% | ✅ |
| 13b | Canteen Module (dual-module architecture) 🆕 | R-OVERRIDE | 100% | ✅ |
| 14 | Parent Portal & Family | R-PHASE2 | 85% | ✅ |
| 15 | Admin Family/Wallet/Safety Control 🆕 | R-PHASE3 | 95% | ✅ |
| 16 | Offline / PWA / Hardware | R-OVERRIDE | 15% | ❌ |

**Overall coverage:** ~60% of full original spec + Phase 2/3 additions

**Critical path (built):** POS → Inventory → Returns → Wallet → Parent Portal → Admin controls
**Critical path (missing):** Reports backend, Budget Control, Approval Workflow

---

## 2. Module-by-Module Functional Spec

### Module 1: Product & Barcode Management

**Source:** R-BASE §1

| Requirement | Status | Implementation | Note |
|-------------|:------:|----------------|------|
| Products with multiple variants | ⚠️ | `shop_products` table (1 row = 1 variant) | Variants modelled as flat products per shop; no parent-variant hierarchy |
| Variant types (color, size, custom) | ❌ | — | Not supported — flat product model |
| Unique barcode per variant | ✅ | `shop_products.barcode` unique | |
| Individual stock per variant | ✅ | `shop_products.stock` | |
| Low stock threshold | ✅ | `shop_products.min_stock` | |
| Pricing per variant | ✅ | `external_price`, `internal_price` | |
| Barcode auto-generation (Code128/EAN13) | ❌ | — | Manual entry only |
| Label printing | ❌ | — | Not built |
| Barcode fast lookup | ✅ | `GET /products/barcode/{barcode}` + `GET /shops/{id}/products?search=` | |
| Sales-by-variant report | ❌ | — | Reports backend not built |
| Stock-by-variant report | ✅ | `/shops/{id}/movements` | |

**Known gap:** Full variant matrix (parent product + variants) replaced by flat per-shop products. Adequate for current scope; revisit if multi-size apparel becomes common.

---

### Module 2: Pricing System

**Source:** R-BASE §2 + R-OVERRIDE (pricing tier by department)

| Requirement | Status | Implementation | Note |
|-------------|:------:|----------------|------|
| Cost price + retail price | ✅ | `shop_products.avg_cost` + `external_price` | |
| Customer types: Public / Internal Staff | ⚠️ | `external_price` / `internal_price` toggle in POS | No customer_types table; manual toggle |
| Sales mode (retail price) | ✅ | POS checkout default | |
| Internal Issue Mode (cost price + budget deduct) | ⚠️ | POS `transaction_mode=internal_issue` uses internal_price | Budget deduction not wired (Module 10) |
| Cashier cannot see cost price | ❌ | — | No role-based price masking yet |
| Admin sees all prices | ✅ | Full visibility | |
| Price change logged in audit | ❌ | — | No audit log API |
| **Pricing tier by department** (override) | ❌ | — | Not built — need PricingTier table |

**Override note:** Pricing tier deferred to future phase (low demand for prototype).

---

### Module 3: POS Engine

**Source:** R-BASE §3 + R-OVERRIDE (barcode scanner, offline)

| Requirement | Status | Implementation | Note |
|-------------|:------:|----------------|------|
| POS loads < 2s | ✅ | Vite build, lazy routes | |
| Rapid barcode scanning | ✅ | `frontend/src/pages/Store.tsx` — keyboard input listener | |
| Sub-second product search | ✅ | Client-side filter + `/shops/{id}/products` | |
| Search by name/SKU/barcode | ✅ | All three supported | |
| Keyboard hotkeys | ⚠️ | Enter-to-add, ESC-to-clear | Not full hotkey matrix |
| Touch screen support | ✅ | Tailwind responsive | |
| Quick action buttons | ✅ | Payment mode buttons, discount quick-apply | |
| USB/Bluetooth scanner | ✅ | Browser keyboard input route | |
| Real-time stock display | ✅ | Cart shows current stock | |
| Product images | ⚠️ | Placeholder — `photo_url` on products not consistently used | |
| Quick discount/promotion | ✅ | Item-level + bill-level (฿/%) in [Store.tsx](../frontend/src/pages/Store.tsx) | |
| Multi-item cart | ✅ | Local React state | |
| 10+ concurrent terminals | ⚠️ | Backend supports; no load test | |
| Offline mode / local queue | ❌ | — | No service worker, no IndexedDB |
| Auto-sync on reconnect | ❌ | — | — |
| Online/offline status indicator | ⚠️ | ServerStatusIndicator component exists (basic ping only) | |

**Override applied:** Negative stock allowed — POS does NOT block sale when stock=0 (spec said "block").

**Override applied:** Negative wallet balance allowed — with per-student `negative_credit_limit` cap.

---

### Module 4: Inventory Engine

**Source:** R-BASE §4 + R-OVERRIDE (negative stock, avg cost)

| Requirement | Status | Implementation | Note |
|-------------|:------:|----------------|------|
| Sales deducts stock | ✅ | `pos_service.checkout` | |
| Internal issue deducts stock | ✅ | Same checkout path | |
| Return increases stock | ✅ | `returns_service` | |
| Exchange adjusts both | ✅ | `/returns/{id}/exchange` | |
| Void restores stock | ✅ | `pos_service.void_receipt` | |
| Real-time stock on POS | ✅ | Live via API | |
| ~~Block sale if insufficient stock~~ | 🆕 | **Override: allow negative stock** | Does not block |
| Low stock alert | ✅ | `min_stock` + shop stats | |
| Stock Movement Report | ✅ | `GET /shops/{id}/movements` | |
| Stock Valuation | ⚠️ | Via shop stats (total_value) | |
| Excel export | ⚠️ | Receipts page only | No inventory CSV yet |
| **Avg Cost recalc** (override) | ✅ | `shop.shop_type = avg_cost` auto-recalcs on receive | |
| **FIFO lots** (override/addition) | ✅ | `fifo_lots` table + consumption logic | |

---

### Module 5: Receipt & Transaction Control

**Source:** R-BASE §5

| Requirement | Status | Implementation | Note |
|-------------|:------:|----------------|------|
| Receipt immutable after creation | ✅ | No UPDATE path on receipts | |
| Receipt search by number/date/customer | ⚠️ | By number only (`/pos/receipt?q=`) | |
| Receipt reprint | ⚠️ | Download button exists, no PDF gen | |
| Full receipt detail view | ✅ | `/receipts` + `/pos/receipt/{id}` | |
| Credit Note (returns) | ⚠️ | `credit_notes` model exists, no API | |
| Refund Slip | ⚠️ | Part of refund response, no separate doc | |
| Audit trail (create/return/exchange/void/reprint) | ⚠️ | Receipt status tracks void; no full audit log table populated | |
| Audit log export (CSV/Excel) | ❌ | — | Not built |
| **Receipt.shop_id tracking** 🆕 | ✅ | Added Phase 3 Sprint 1 | Required for multi-shop reporting |

---

### Module 6: Return & Exchange Engine

**Source:** R-BASE §6 + R-OVERRIDE (exchange via topup difference)

| Requirement | Status | Implementation | Note |
|-------------|:------:|----------------|------|
| Partial return | ✅ | Per-item quantity in `returns/create` | |
| Partial exchange | ✅ | `exchangeItems[]` payload | |
| Product refund | ✅ | refundMethod flow | |
| Wallet refund (credit to wallet) | ✅ | Creates WalletTransaction REFUND | |
| Cash refund | ✅ | refundMethod=cash | |
| Mandatory return reason | ✅ | Required field | |
| Return reasons (defective/size/changed mind/other) | ✅ | Free text; no enum yet | |
| Return without receipt (admin approval) | ❌ | — | Not supported |
| Return % / reason / product reports | ❌ | — | Reports backend not built |
| **Exchange via topup difference** (override) | ⚠️ | Difference calculated; customer pays/receives as adjustment | No automatic wallet top-up integration |

---

### Module 7: Wallet System

**Source:** R-BASE §7 + R-OVERRIDE (negative allowed, family wallet)

| Requirement | Status | Implementation | Note |
|-------------|:------:|----------------|------|
| Wallet top-up | ✅ | `POST /wallets/{id}/topup` + PromptPay QR | |
| Wallet deduction at POS | ✅ | Payment method `wallet` | |
| Wallet refund | ✅ | Auto on return-to-wallet | |
| Balance before/after display | ✅ | Stored in WalletTransaction | |
| Real-time balance update | ✅ | Post-checkout refresh | |
| Customer photo display | ✅ | Cloudinary `photo_url` 🆕 | |
| Wallet card in POS | ✅ | Student lookup UI | |
| Transaction history | ✅ | `GET /wallets/{id}/transactions` (date filter) | |
| ~~Block if insufficient balance~~ | 🆕 | **Override:** negative allowed up to `negative_credit_limit` per student | |
| Department account exception (negative + track) | ⚠️ | Negative limit is per-student, not per-department | Department wallets deferred |
| Accounting separation (top-up ≠ revenue) | ✅ | Separate `WalletTransaction` types | |
| Wallet Usage Report | ❌ | — | Reports backend not built |
| Wallet Top-Up Report | ❌ | — | — |
| Outstanding Balance Report | ❌ | — | — |
| **Family Shared Wallet** (override) | ⚠️ | Individual wallets + **parent sibling transfer** 🆕 (`POST /wallets/transfer`) | Decided against shared pool — per ISB preference |
| **Admin Balance Adjustment + Audit** 🆕 | ✅ | `POST /wallets/{id}/adjust` with reason + reference_ticket | Phase 3 Sprint 1 |

---

### Module 8: Reporting Engine

**Source:** R-BASE §8 + R-OVERRIDE (multi-branch)

| Requirement | Status | Implementation | Note |
|-------------|:------:|----------------|------|
| Daily Executive Report | ❌ | UI card only, no backend | |
| Gross Sales / Product Refund / Wallet Refund / Net Sales | ❌ | — | |
| Payment method breakdown | ❌ | — | |
| Sales vs Internal Issue split | ❌ | — | |
| Cancelled receipts section | ❌ | — | |
| Daily report | ❌ | — | |
| Date range custom | ⚠️ | UI picker works, hardcoded data | |
| PDF/Excel export | ⚠️ | CSV button works on sample data | |
| **Multi-branch reporting** (override) | ❌ | — | Despite `receipts.shop_id` ready, no aggregation layer |

**Known gap:** This is the largest unaddressed module — 7 report cards in UI, zero backend aggregation endpoints.

---

### Module 9: Product Out Report

**Source:** R-BASE §9

| Requirement | Status | Implementation | Note |
|-------------|:------:|----------------|------|
| Sales out category | ⚠️ | Derivable from shop_movements but no report endpoint | |
| Internal issue category | ⚠️ | Same | |
| Return category | ⚠️ | Same | |
| Adjustment category | ⚠️ | Same | |
| Date filtering | ⚠️ | `/shops/{id}/movements` supports | |
| Category filtering | ⚠️ | Movement type filter | |
| Excel export | ❌ | — | |
| Summary totals | ❌ | — | |

**Assessment:** Data available, aggregation API missing. ~1 week to build.

---

### Module 10: Budget Control

**Source:** R-BASE §10

| Requirement | Status | Implementation | Note |
|-------------|:------:|----------------|------|
| Annual / Used / Remaining budget per department | ⚠️ | `departments`, `budget_transactions` tables exist, no API | |
| Internal issue deducts budget | ❌ | — | Not wired to POS checkout |
| Real-time budget update | ❌ | — | |
| Department wallets | ❌ | — | |

**Assessment:** DB scaffolding done, zero API + UI.

---

### Module 11: Budget Alert System

**Source:** R-BASE §11

| Requirement | Status | Implementation | Note |
|-------------|:------:|----------------|------|
| Warning threshold % | ❌ | — | |
| Critical threshold 100% | ❌ | — | |
| POS warning banner | ❌ | — | |
| Email notifications | ❌ | — | No SMTP/SES config |
| Auto-block on overflow | ❌ | — | |

---

### Module 12: Approval Workflow

**Source:** R-BASE §12

| Requirement | Status | Implementation | Note |
|-------------|:------:|----------------|------|
| Budget override request | ❌ | `approval_requests` table exists, no API | |
| Large transaction approval | ❌ | — | |
| Special discount approval | ❌ | — | |
| Return without receipt approval | ❌ | — | |
| Approval queue UI | ❌ | — | |
| Approval history | ❌ | — | |

---

### Module 13: Sub-merchant / Shop System 🆕

**Source:** R-OVERRIDE — "multi-shop under ISB Cooperative"

| Requirement | Status | Implementation | Note |
|-------------|:------:|----------------|------|
| Multiple shops under one cooperative | ✅ | `shops` table (6 seeded: Coop, Sports, Bookstore + Canteen, Thai Kitchen, Drinks & Snacks) | |
| Per-shop products / categories | ✅ | `shop_products`, `shop_categories` | |
| Per-shop stock/movement audit | ✅ | `shop_movements` | |
| Per-shop costing method | ✅ | `shop.shop_type ∈ {avg_cost, fifo}` | |
| Shop manager / cashier assignment | ⚠️ | `User.shop_id` exists; role-to-module routing works; employee-shop UX partially in localStorage | |
| Shop stats dashboard | ✅ | `GET /shops/{id}/stats` | |
| Receipt tracks shop_id 🆕 | ✅ | Phase 3 Sprint 1 — `receipts.shop_id` | Enables future multi-branch reporting |
| **Shop module column** 🆕 | ✅ | Phase 3 Sprint 3 — `shops.module ∈ {canteen, store}` | Authoritative for module routing at login |
| **Delete shop** 🆕 | ✅ | Phase 3 Sprint 3 — `DELETE /shops/{id}` hard/soft based on receipt FK | |
| **2-tab ShopManagement UI** 🆕 | ✅ | Phase 3 Sprint 3 — Canteen tab + Retail tab, scoped add/edit | |

### Module 13b: Canteen Module 🆕

**Source:** R-OVERRIDE — Canteen (โรงอาหาร) is architecturally separate from Coop/Store

| Requirement | Status | Implementation | Note |
|-------------|:------:|----------------|------|
| Canteen POS (menu-driven) | ✅ | `Canteen.tsx` — per-user shopId driven, supports Thai Kitchen, Drinks & Snacks, ISB Canteen | |
| Canteen receipts | ✅ | `/canteen/receipts` — shared `Receipts` component scoped to canteen shop | |
| Canteen product management | ✅ | `/canteen/products` — `CanteenProducts.tsx` admin/manager only | |
| Canteen user management | ✅ | `/canteen/users` — `CanteenUsers.tsx` admin/manager only | |
| Canteen reports | ✅ | `/canteen/reports` — admin only (shared Reports component, UI-only) | |
| Module isolation | ✅ | `RequireModule` guard — canteen users cannot access `/store/*` and vice versa | |
| Module detection | ✅ | `user.shopModule` from `shops.module` (authoritative) + `moduleOf(shopId)` prefix fallback | |
| Mock fallback in prod | ✅ | MOCK_USERS includes all 6 canteen accounts; no DEV gate (works on Vercel) | |

---

### Module 14: Parent Portal & Family

**Source:** R-PHASE2

| Feature | Status | Implementation | Note |
|---------|:------:|----------------|------|
| **Authentication — SSO (Azure/Google)** | ⚠️ | Mock SSO (`POST /auth/sso/mock`) only | Real OAuth not configured |
| Manual login fallback | ✅ | Username/password | |
| External ID mapping | ❌ | `user_external_identities` table not created | |
| Role: parent, student | ✅ | `user.role` + multi-role junction 🆕 | |
| **Family Dashboard** | ✅ | `/parent/dashboard` — child cards with balance/allergy/frozen badges | |
| Family switcher (parent → N children) | ✅ | Multi-child cards on dashboard | |
| Balance overview real-time | ✅ | `GET /wallets/family` | |
| Quick actions (topup, transfer) | ✅ | Dashboard buttons | |
| **Wallet — PromptPay top-up** | ✅ | QR generation + parent self-confirm flow | Mock gateway (no real PromptPay signing) |
| Alipay / WeChat Pay | ❌ | — | Deferred |
| Credit card top-up (+3% fee) | ❌ | — | Deferred |
| Refund status tracking | ⚠️ | Visible in transaction history | No dedicated page |
| Split wallet per-student | ✅ | 1:1 wallet-to-customer | |
| **Transaction History** | ✅ | `/parent/transactions/:id` with date range + shop_name | |
| Statement export CSV/PDF | ⚠️ | CSV export button exists | PDF not built |
| **Profile & Allergy** | ✅ | `/parent/profile/:id` | |
| Allergy fields (allergies + dietary_notes) | ✅ | Phase 2 schema | |
| PowerSchool sync | ❌ | `powerschool_sync_at` field exists, no sync job | |
| Allergy alert on POS | ✅ | Store.tsx displays allergy banner before checkout | |
| Admin allergy override note 🆕 | ✅ | Separate field, shown distinctly on POS | Phase 3 Sprint 1 |
| **Card Management — freeze/unfreeze** | ✅ | `POST /customers/{id}/freeze` | |
| Daily spending limit | ✅ | `PATCH /customers/{id}/limit` + POS enforcement | |
| Card UID / NFC | ✅ | Manual + WebUSB stub 🆕 | Phase 3 Sprint 2 |
| Lost card alert (notify parent) | ❌ | — | No notification system |
| **PWA / Offline** | ❌ | No service worker, no manifest | |
| IndexedDB cache | ❌ | — | |
| Offline indicator | ⚠️ | Basic ServerStatusIndicator | |

---

### Module 15: Admin Family / Wallet / Safety Control 🆕

**Source:** R-PHASE3 (modules A–D)

#### A. Family Relationship Manager

| Feature | Status | Implementation |
|---------|:------:|----------------|
| Family tree visualization | ✅ | `/admin/families` — grouped card view by parent 🆕 Sprint 2 |
| Manual link/unlink | ✅ | Admin create/delete via `/family/links` |
| Internal ID mapping | ❌ | Deferred — no legacy system to map |

#### B. Centralized Wallet Control

| Feature | Status | Implementation |
|---------|:------:|----------------|
| **Balance Adjustment + Audit** | ✅ | `/admin/wallet-adjust` + `POST /wallets/{id}/adjust` with reason/ticket 🆕 Sprint 1 |
| **Negative Credit Limit config** | ✅ | `customers.negative_credit_limit` + enforcement in pos_service 🆕 Sprint 1 |
| Wallet Transfer History | ✅ | Sibling transfer logged as ADJUSTMENT with `reference_type=sibling_transfer` 🆕 Sprint 2 |
| Graduation auto-transfer balance | ✅ | `POST /customers/{id}/graduate` 🆕 Sprint 2 |

#### C. Safety & Health Integration

| Feature | Status | Implementation |
|---------|:------:|----------------|
| **Allergy Override Note** | ✅ | Separate `allergy_override_note` from PowerSchool `allergies`, shown distinctly in POS 🆕 Sprint 1 |
| **Profile Image Management** | ✅ | Cloudinary upload via `POST /customers/{id}/photo` 🆕 Sprint 2 |

#### D. Card & Access Security

| Feature | Status | Implementation |
|---------|:------:|----------------|
| **RFID Card Binding UI** | ✅ | Manual UID entry + WebUSB stub in `/admin/customer/:id` 🆕 Sprint 2 |
| **Global Freeze (family-level)** | ✅ | `POST /family/freeze-all` — freeze/unfreeze all children of a parent 🆕 Sprint 1 |

#### Prototype Screens (Phase 3)

| Screen | Status | Location |
|--------|:------:|----------|
| Search & Profile View | ✅ | `/admin/customer/:customerId` — all-in-one 🆕 |
| Transaction Insight (wallet tx + shop name) | ✅ | Wallet tx API includes shop_name JOIN |
| Admin Adjustment Form | ✅ | `/admin/wallet-adjust` with reason + ticket |

---

### Module 16: Offline / PWA / Hardware

**Source:** R-OVERRIDE

| Requirement | Status | Implementation | Note |
|-------------|:------:|----------------|------|
| Offline-first architecture | ❌ | — | Not built |
| Local sync layer | ❌ | — | |
| IndexedDB queue | ❌ | — | |
| PWA manifest | ❌ | No `manifest.json` | |
| Service worker | ❌ | — | |
| Future: Electron/Tauri .exe | ❌ | — | |
| Barcode scanner (USB/Bluetooth) | ✅ | Via browser keyboard input | Tested with common USB scanners |
| EDC machine integration | ⚠️ | Payment method simulated only | No real EDC |
| NFC card reader (WebUSB) | ⚠️ | Stub + manual entry | Phase 2 of feature (needs hardware test) |

---

## 3. Business Rule Overrides Summary

| # | Override | Source | Status | Applied at |
|---|----------|--------|:------:|-----------|
| O1 | Negative wallet balance allowed (per-student cap) | R-OVERRIDE | ✅ | [pos_service.py](../backend/app/services/pos_service.py) + Store.tsx banner |
| O2 | Negative stock allowed (no block) | R-OVERRIDE | ✅ | [inventory_service.py](../backend/app/services/inventory_service.py) — deduct proceeds, creates phantom FIFO lot |
| O3 | Avg Cost calculation (weighted) | R-OVERRIDE | ✅ | `shop.shop_type = avg_cost` — auto recalc on receive |
| O4 | Sub-merchant (multi-shop) | R-OVERRIDE | ✅ | `shops` table, per-shop everything |
| O5 | Family shared wallet | R-OVERRIDE | ⚠️ → per ISB decision: **individual wallets + parent-driven sibling transfer** | `POST /wallets/transfer` |
| O6 | Pricing tier by department | R-OVERRIDE | ❌ | Not built — deferred |
| O7 | Exchange via top-up difference | R-OVERRIDE | ⚠️ | `/returns/{id}/exchange` returns difference; no auto-topup |
| O8 | Multi-branch reporting | R-OVERRIDE | ❌ | `shop_id` on receipts ready; no aggregation API |
| O9 | Offline-first PWA | R-OVERRIDE | ❌ | Not built |
| O10 | Hardware (barcode / EDC) | R-OVERRIDE | ⚠️ | Barcode works; EDC simulated |
| O11 | English-first UI | R-OVERRIDE | ⚠️ | i18n EN+TH with toggle; some new pages TH-first |
| O12 | Cashier cannot see cost price | R-BASE | ❌ | No role-based price masking |

---

## 4. Gap Analysis — Missing Features

Ranked by business priority (prototype → go-live path):

### Priority 1 — Blockers for go-live

| Feature | Spec ref | Effort (dev-week) | Why critical |
|---------|----------|:-----------------:|--------------|
| Reports backend (Daily Executive, Product Out, Sales) | M8, M9 | 2–3 | Store managers need daily close-out |
| Real permission enforcement (backend `check_permission` is stub) | R-BASE Security | 0.5 | Production risk |
| Receipt PDF generation | M5 | 1 | Customer-facing receipts |
| Audit log populated + export | M5 | 1 | Compliance / accountability |

### Priority 2 — Strongly requested

| Feature | Spec ref | Effort | Why |
|---------|----------|:------:|-----|
| Budget Control (per-department) | M10 | 2 | Staff/internal-issue workflow |
| Budget Alert System | M11 | 1 | Ties to M10 |
| Approval Workflow | M12 | 1.5 | Override authority tracking |
| Real SSO (Azure/Google OAuth) | R-PHASE2 F1 | 1 | Convenience for ISB parents |
| Statement PDF export | R-PHASE2 F4 | 0.5 | Parent requests |
| Pricing tier by department | R-OVERRIDE | 1 | Staff discount structure |

### Priority 3 — Nice-to-have

| Feature | Spec ref | Effort | Note |
|---------|----------|:------:|------|
| PWA + offline sync | R-OVERRIDE + R-PHASE2 F7 | 3 | Complex; needs offline-first redesign |
| PowerSchool live sync | R-PHASE2 F5 | 2 | Requires ISB IT credentials |
| Real payment gateways (Omise/Stripe, Alipay, WeChat) | R-PHASE2 F3 | 2 | Keep PromptPay mock for now |
| Product variants (parent + N variants) | M1 | 1.5 | Current flat model works |
| Return-without-receipt | M6 | 1 | Rare |
| Email / push notifications (lost card, alerts) | M11, R-PHASE2 F6 | 1.5 | No SMTP infra yet |
| WebUSB NFC reader (real protocol) | R-PHASE3 D | 1 | Needs hardware validation |

**Total Priority 1+2 effort:** ~11–12 dev-weeks to reach production-ready.

---

## 5. Phase 3 Sprint 1+2 Deliverables

**Note:** These features are NOT in the original R-BASE spec — added for ISB-specific admin needs. All implemented and deployed.

### Sprint 1 (2026-04-17 to 2026-04-19)

| Feature | Backend | Frontend | API/Path |
|---------|---------|----------|----------|
| Negative credit limit (per-student overdraft cap) | ✅ `customers.negative_credit_limit` + pos_service enforcement | ✅ CustomerDetail page editor | `PATCH /customers/{id}/negative-limit` |
| Wallet balance adjustment + audit | ✅ `wallet_service.adjust_balance()` | ✅ [WalletAdjust.tsx](../frontend/src/pages/admin/WalletAdjust.tsx) | `POST /wallets/{id}/adjust` |
| Receipt.shop_id tracking | ✅ Added to receipt creation | ✅ Shown in tx history | — |
| Allergy Override Note | ✅ `customers.allergy_override_note` | ✅ Distinct section in Store.tsx + CustomerDetail | `PATCH /customers/{id}/allergies` |
| Global family freeze | ✅ `family_service.freeze_all` | ✅ [FamilyLinks.tsx](../frontend/src/pages/admin/FamilyLinks.tsx) | `POST /family/freeze-all` |
| Multi-role `require_role()` | ✅ `user.role` + `user_roles` junction union | ✅ Route guards accept multiple roles | — |

### Sprint 2 (2026-04-20 to 2026-04-21)

| Feature | Backend | Frontend | API/Path |
|---------|---------|----------|----------|
| Family Tree Group Card View | — | ✅ Refactored FamilyLinks to grouped cards | — |
| Sibling Wallet Transfer | ✅ `wallet_service.transfer_between_siblings()` | ✅ [Transfer.tsx](../frontend/src/pages/parent/Transfer.tsx) | `POST /wallets/transfer` |
| Graduation auto-transfer | ✅ `POST /customers/{id}/graduate` — handles 0/1/N siblings | ✅ CustomerDetail dialog | `POST /customers/{id}/graduate` |
| Cloudinary profile image | ✅ `upload_service.py` + config env var | ✅ Avatar upload in CustomerDetail | `POST /customers/{id}/photo` |
| Admin Customer Detail (all-in-one) | — | ✅ [CustomerDetail.tsx](../frontend/src/pages/admin/CustomerDetail.tsx) (~666 lines) | `/admin/customer/:id` |
| Multi-role admin API | ✅ `/users/{id}/roles` CRUD | — (UI deferred) | `GET/POST/DELETE /auth/users/{id}/roles` |
| RFID binding UI (manual + WebUSB stub) | ✅ `PATCH /customers/{id}/card` | ✅ Bind dialog in CustomerDetail | `PATCH /customers/{id}/card` |

### Sprint 3 (2026-04-22) — Canteen Module + Shop Architecture

| Feature | Backend | Frontend | Notes |
|---------|---------|----------|-------|
| `shops.module` column | ✅ Added `module VARCHAR(20) DEFAULT 'store'`; start.sh patches existing rows | ✅ `AuthContext` fetches `/shops/{id}` at login to populate `user.shopModule` | Authoritative source for module routing |
| Canteen module routing | — | ✅ `RequireModule` guard, `AppSidebar` module filtering | Canteen/store are fully isolated — no cross-contamination |
| Canteen POS (`/canteen`) | — | ✅ `Canteen.tsx` uses `user.shopId` dynamically (supports Thai, Drinks, Canteen) | Fixed hardcoded `CANTEEN_SHOP_ID = "canteen"` |
| Canteen product management | — | ✅ `CanteenProducts.tsx` at `/canteen/products` | Admin/manager only |
| Canteen user management | — | ✅ `CanteenUsers.tsx` at `/canteen/users` | Admin/manager only |
| Store route prefix | — | ✅ All store routes migrated to `/store/*` prefix | Fixed 404s (`/management/bookstore` → `/store/management/bookstore`) |
| ShopManagement 2-tab UI | — | ✅ Tabs: 🍜 โรงอาหาร / 🏪 สหกรณ์/ค้าปลีก; pre-fills module on create | Admin sees both tabs; manager sees own module tab |
| Shop DELETE endpoint | ✅ Hard delete if no receipts; soft delete (is_active=false) otherwise | ✅ Delete button in ShopManagement with status message | `DELETE /shops/{id}` returns `ShopDeleteResponse` |
| Admin user management | — | ✅ `UserManagement.tsx`, `UserDetail.tsx` with shop dropdown | `/admin/users`, `/admin/users/:id` |
| Demo account mock fallback (prod) | — | ✅ Removed `import.meta.env.DEV` gate; added 6 canteen mock users | Works on Vercel even without backend migration |
| Sidebar branding | — | ✅ `nav.systemTitle` → "ISB" (was "ระบบสหกรณ์") | Updated en.json + th.json |
| Login demo accounts panel | — | ✅ Full list: admin + 6 canteen + 6 retail + 12 staff + 5 parents | Accurate as of DB seed |

---

## 6. API Endpoint Reference

**Total: 67 endpoints across 9 routers** (all versioned under `/api/v1/`)

### Auth (9)

| Method | Path | Role | Description |
|--------|------|------|-------------|
| POST | `/auth/login` | Public | Username/password → JWT |
| POST | `/auth/sso/mock` | Public | Mock SSO, auto-create parent |
| GET | `/auth/me` | Auth | Current user + permissions |
| POST | `/auth/register` | Admin | Create user |
| GET | `/auth/users` | Auth | List users |
| GET | `/auth/users/{id}/roles` | Admin | List secondary roles 🆕 |
| POST | `/auth/users/{id}/roles` | Admin | Assign role 🆕 |
| DELETE | `/auth/users/{id}/roles/{name}` | Admin | Remove role 🆕 |
| POST | `/auth/logout` | Auth | Logout hint |

### Shops (5)

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/shops/` | Auth | List shops |
| POST | `/shops/` | Admin | Create shop |
| GET | `/shops/{id}` | Auth | Shop detail |
| PATCH | `/shops/{id}` | Admin | Update shop |
| GET | `/shops/{id}/stats` | Auth | Shop KPIs |

### Inventory (12, nested under shop)

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/shops/{id}/categories` | Auth | List categories |
| POST | `/shops/{id}/categories` | Auth | Create category |
| PATCH | `/shops/{id}/categories/{cid}` | Auth | Update category |
| DELETE | `/shops/{id}/categories/{cid}` | Auth | Delete category |
| GET | `/shops/{id}/products` | Auth | List shop products |
| POST | `/shops/{id}/products` | Auth | Create product |
| PATCH | `/shops/{id}/products/{pid}` | Auth | Update product |
| DELETE | `/shops/{id}/products/{pid}` | Auth | Delete product |
| GET | `/shops/{id}/products/{pid}/fifo-lots` | Auth | FIFO lots |
| POST | `/shops/{id}/receive` | Auth | Receive stock |
| POST | `/shops/{id}/adjust` | Auth | Adjust stock |
| GET | `/shops/{id}/movements` | Auth | Movement history |

### Products (7, global lookup)

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/products/search` | Auth | Search by name/SKU/barcode |
| GET | `/products/` | Auth | List with pagination |
| GET | `/products/{id}` | Auth | Product detail |
| POST | `/products/` | create_product perm | Create |
| PUT | `/products/{id}` | update_product perm | Update |
| DELETE | `/products/{id}` | delete_product perm | Delete |
| GET | `/products/barcode/{barcode}` | Auth | By barcode |

### POS (4)

| Method | Path | Role | Description |
|--------|------|------|-------------|
| POST | `/pos/checkout` | Auth | Checkout + stock deduct |
| GET | `/pos/receipt` | Auth | List receipts |
| GET | `/pos/receipt/{id}` | Auth | Receipt detail |
| POST | `/pos/void/{id}` | Admin/Manager | Void + restore |

### Returns (11)

| Method | Path | Role | Description |
|--------|------|------|-------------|
| POST | `/returns/create` | Admin/Manager | Create return |
| GET | `/returns` | Admin/Manager | List |
| GET | `/returns/by-receipt` | Admin/Manager | By receipt |
| GET | `/returns/{id}` | Admin/Manager | Detail |
| PUT | `/returns/{id}` | Admin/Manager | Update/approve/reject |
| DELETE | `/returns/{id}` | Admin/Manager | Delete |
| POST | `/returns/{id}/refund` | Admin/Manager | Process refund |
| POST | `/returns/{id}/exchange` | Admin/Manager | Process exchange |
| GET | `/return-history` | Admin/Manager | History |
| GET | `/receipts/search` | Admin/Manager | Lookup receipt |
| GET | `/exchange/products` | Admin/Manager | Exchange pool |

### Wallets (10)

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/wallets/me` | Auth | Student: own |
| GET | `/wallets/family` | Parent/Admin | All linked children |
| GET | `/wallets/{id}` | Auth | Specific wallet |
| GET | `/wallets/{id}/transactions` | Auth | Tx history + date filter |
| POST | `/wallets/{id}/topup` | Parent/Admin | Create topup intent |
| GET | `/wallets/topup/pending` | Admin | Pending list |
| POST | `/wallets/topup/{ref}/confirm` | Admin | Admin confirm |
| POST | `/wallets/topup/{ref}/parent-confirm` | Parent | Self-confirm |
| POST | `/wallets/transfer` | Parent/Admin | Sibling transfer 🆕 |
| POST | `/wallets/{id}/adjust` | Admin | Manual adjust + audit 🆕 |

### Customers (12)

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/customers/by-code/{code}` | Auth | Lookup by student_code |
| GET | `/customers/by-card/{uid}` | Auth | Lookup by NFC |
| GET | `/customers/{id}` | Auth | Profile |
| POST | `/customers/{id}/freeze` | Parent/Admin | Freeze/unfreeze |
| PATCH | `/customers/{id}/limit` | Parent/Admin | Daily limit |
| PATCH | `/customers/{id}/allergies` | Admin/Manager | Allergies + override note |
| PATCH | `/customers/{id}/negative-limit` | Admin | Overdraft limit 🆕 |
| PATCH | `/customers/{id}/card` | Admin | Bind/unbind NFC 🆕 |
| POST | `/customers/` | Admin | Create student |
| POST | `/customers/{id}/photo` | Admin | Upload photo 🆕 |
| POST | `/customers/{id}/graduate` | Admin | Mark graduated + transfer 🆕 |
| GET | `/customers/` | Admin/Manager | List students |

### Family (5)

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/family/me` | Parent/Admin | Own children |
| GET | `/family/links` | Admin | All links |
| POST | `/family/links` | Admin | Create link |
| DELETE | `/family/links/{id}` | Admin | Delete link |
| POST | `/family/freeze-all` | Admin/Parent | Global freeze 🆕 |

---

## 7. Frontend Route Reference

**Total: 28 routes** (defined in [App.tsx](../frontend/src/App.tsx))

Routes are now organized into 3 module groups enforced by `RequireModule`:

### Canteen Module (`RequireModule module="canteen"`)

| Route | Component | Roles | Purpose |
|-------|-----------|-------|---------|
| `/canteen` | Canteen | manager, cashier | Canteen POS — uses user.shopId dynamically |
| `/canteen/receipts` | Receipts | manager, cashier | Canteen receipt list |
| `/canteen/products` | CanteenProducts | admin, manager | Menu management per canteen shop |
| `/canteen/users` | CanteenUsers | admin, manager | Canteen staff management |
| `/canteen/reports` | Reports | admin | Reports (UI only) |

### Store Module (`RequireModule module="store"`)

| Route | Component | Roles | Purpose |
|-------|-----------|-------|---------|
| `/store` | Store | manager, cashier | Coop/retail POS |
| `/store/receipts` | Receipts | manager, cashier | Store receipt list |
| `/store/returns` | Returns | admin, manager | Process returns |
| `/store/return-history` | ReturnHistory | admin, manager | Historical returns |
| `/store/void` | Void | admin, manager | Void transaction |
| `/store/management` | ShopManagement | admin, manager | 2-tab shop list (Canteens / Retail) |
| `/store/management/:shopId` | ShopDetail | admin, manager | Inventory/staff/customers per shop |
| `/store/users` | StoreUsers | admin, manager | Store staff management |
| `/store/reports` | Reports | admin | Reports (UI only) |

### Admin Routes (no module guard)

| Route | Component | Roles | Purpose |
|-------|-----------|-------|---------|
| `/admin` | AdminDashboard | admin | Admin overview |
| `/admin/users` | UserManagement | admin | User list + create |
| `/admin/users/:userId` | UserDetail | admin | User detail + shop assignment |
| `/admin/families` | FamilyLinks | admin | Family tree (grouped cards) |
| `/admin/topups` | TopupConfirm | admin | Pending topup confirmation |
| `/admin/wallet-adjust` | WalletAdjust | admin | Credit/debit + audit trail |
| `/admin/customer/:customerId` | CustomerDetail | admin | All-in-one student profile |
| `/admin/reports` | Reports | admin | Cross-shop reports |

### Parent/Staff Portal

| Route | Component | Roles | Purpose |
|-------|-----------|-------|---------|
| `/parent/dashboard` | FamilyDashboard | parent, admin | Children cards |
| `/parent/wallet/:customerId` | WalletDetail | parent, admin | Balance + topup QR |
| `/parent/transactions/:customerId` | TransactionHistory | parent, admin | Date range + shop_name |
| `/parent/profile/:customerId` | StudentProfile | parent, admin | Info + limits + freeze |
| `/parent/transfer` | Transfer | parent, admin | Sibling transfer |

### Public & Shared

| Route | Component | Roles | Purpose |
|-------|-----------|-------|---------|
| `/login` | Login | public | JWT login + mock SSO |
| `/` | Landing | auth | Role-based redirect to correct module |
| `*` | NotFound | any | 404 |

---

## 8. Database Schema Status

| Table | Status | Used by | New in |
|-------|:------:|---------|:------:|
| `users` | ✅ | Auth | M1 |
| `roles`, `permissions`, `user_roles`, `role_permissions` | ✅ | Multi-role RBAC | M1 + Sprint 1 |
| `shops` | ✅ | Sub-merchant | M13 |
| `shop_products` | ✅ | Flat per-shop products | M13 |
| `shop_categories` | ✅ | Shop categories | M13 |
| `shop_movements` | ✅ | Audit trail | M13 |
| `fifo_lots` | ✅ | FIFO cost tracking | M4 |
| `receipts` | ✅ | Sales | M5 |
| `receipts.shop_id` | 🆕 | Phase 3 Sprint 1 | — |
| `receipt_items` | ✅ | Line items | M5 |
| `return_requests` | ✅ | Returns/exchanges | M6 |
| `wallets` | ✅ | Prepaid balance | M7 |
| `wallet_transactions` | ✅ | TOPUP/DEDUCTION/REFUND/ADJUSTMENT | M7 |
| `payment_intents` | ✅ | PromptPay QR state | Phase 2 |
| `customers` | ✅ | Student profiles | M7 + Phase 2/3 |
| `customers.student_code, grade, allergies, dietary_notes, card_uid, card_frozen, daily_limit, powerschool_sync_at` | ✅ | Phase 2 | — |
| `customers.negative_credit_limit, allergy_override_note` | 🆕 | Phase 3 Sprint 1 | — |
| `customers.photo_url` | ✅ | Cloudinary 🆕 Sprint 2 | — |
| `parent_child_links` | ✅ | Family relationships | Phase 2 |
| `departments`, `budget_transactions` | ❌ (model only, no API) | Budget Control (deferred) | M10 |
| `credit_notes` | ❌ (model only, no API) | Returns doc (deferred) | M5 |
| `approval_requests` | ❌ (model only, no API) | Approval Workflow (deferred) | M12 |
| `audit_logs` | ❌ (model only, no API) | Audit trail (deferred) | M5 |
| `products`, `product_variants`, `categories` | ⚠️ (legacy) | Not used — shop_products replaces | M1 |

**Active tables:** 16. **Scaffolded-but-unused:** 4. **Legacy:** 3.

---

## 9. Known Limitations

| Area | Limitation | Impact | Priority |
|------|-----------|--------|:--------:|
| Reports backend | UI only, hardcoded sample data | Daily close-out impossible in production | 🔴 P1 |
| Permission enforcement | Backend `check_permission()` is a stub | Security risk | 🔴 P1 |
| Receipt PDF | Button exists, no generation | Customer can't get printed receipt | 🔴 P1 |
| Audit log | Table exists, never written | Compliance gap | 🟡 P2 |
| Budget Control | Models only, no API/UI | Staff internal-issue flow broken | 🟡 P2 |
| SSO | Mock only, no real Azure/Google | Manual onboarding needed | 🟡 P2 |
| PowerSchool sync | Field placeholder, no job | Allergies entered manually by admin | 🟡 P2 |
| Employee-Shop relation | Stored in localStorage | Lost on browser clear | 🟡 P2 |
| Payment methods | Card/QR/Dept all simulated | No real money flow | 🟠 P3 |
| Pagination | Most list endpoints load all | Slow at 1000+ records | 🟠 P3 |
| Refresh token rotation | Token exists, rotation not implemented | Long sessions expire hard | 🟠 P3 |
| Product variants | Flat per-shop only | No parent-variant matrix | 🟠 P3 |
| Return without receipt | Not supported | Rare edge case | 🟢 P4 |
| Pricing tier by dept | Not built | Deferred | 🟢 P4 |
| Offline / PWA | Not built | No resilience to network drops | 🟠 P3 |

---

## 10. Recommendations — Next Steps

### 🔴 Phase 4 Sprint 1 — Go-live blockers (~3–4 weeks)

1. **Reports backend** — implement Daily Executive, Product Out, Sales-by-shop aggregation endpoints. ~2 weeks.
2. **Real permission enforcement** — replace `check_permission()` stub with role-permission lookup. ~0.5 week.
3. **Receipt PDF generation** — `reportlab` already in requirements; wire to `/pos/receipt/{id}/pdf`. ~1 week.
4. **Audit log population** — log create/void/return/exchange/price-change events to `audit_logs` table + export endpoint. ~1 week.

### 🟡 Phase 4 Sprint 2 — Strongly requested (~4–5 weeks)

5. **Budget Control** — expose department CRUD, wire internal-issue to budget deduction, show remaining budget in POS. ~2 weeks.
6. **Budget Alert System** — threshold config + warning banner + email (requires SMTP setup). ~1 week.
7. **Approval Workflow** — create/list/approve API + admin queue UI. ~1.5 weeks.
8. **Real Azure/Google OAuth SSO** — msal (Python) + callback handler. ~1 week.

### 🟠 Phase 4 Sprint 3 — Production polish (~3 weeks)

9. **Statement PDF** — parent CSV/PDF export enhancement. ~0.5 week.
10. **Pricing tier by department** — PricingTier table + POS selection. ~1 week.
11. **Pagination** — standard cursor pagination on list endpoints. ~0.5 week.
12. **Employee-Shop relation** — move from localStorage to DB with migration. ~1 week.

### 🟢 Phase 5 (future)

- PWA + offline sync (~3 weeks)
- PowerSchool live sync job (~2 weeks)
- Real payment gateways — Omise/Stripe + Alipay/WeChat (~2 weeks)
- Product variant matrix (~1.5 weeks)
- Email / push notifications (~1.5 weeks)
- WebUSB NFC real protocol (~1 week + hardware)

### Decisions needed before Phase 4 starts

1. **SSO provider scope** — Azure only? Both Azure + Google? Neither (stay manual)?
2. **Permission model** — role-based vs permission-based granularity? Current roles: admin/manager/cashier/parent/student. Is that enough?
3. **Budget scope** — which departments? Annual budget amounts? Who approves override?
4. **Report format** — PDF vs Excel vs both? Who receives daily reports automatically?
5. **Audit log retention** — how long? Export cadence?

---

## Document History

| Date | Version | Change |
|------|---------|--------|
| 2026-04-21 | 1.0 | Initial issue — covers R-BASE + overrides + Phase 2 + Phase 3 Sprint 1/2 |
| 2026-04-22 | 1.1 | Phase 3 Sprint 3 — Canteen module (dual-module architecture), shop.module column, DELETE shop endpoint, route restructure (/store/*, /canteen/*), admin user management, sidebar "ISB" branding, demo accounts updated |

*For the latest feature snapshot, see [CURRENT_FEATURES.md](CURRENT_FEATURES.md). For original customer requirement, see [BOOKSTORE_POS_SPECIFICATION.md](BOOKSTORE_POS_SPECIFICATION.md).*
