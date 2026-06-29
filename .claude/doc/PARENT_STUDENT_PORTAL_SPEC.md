# Schooney — Parent / Student Portal Specification

> Phase: 2 (extends Phase 1 POS system)
> Last updated: 2026-04-17
> Target users: Parents, Students, ISB Staff

---

## 1. Overview

เพิ่มส่วนของ **Parent/Student Portal** ที่แยกจากหน้า admin/manager/cashier เดิม โดยเน้น:

- **Family-linked data model** — เชื่อมผู้ปกครองกับบุตรหลาน (1 parent → N students, 1 student → N parents)
- **Wallet-first experience** — ยอดเงิน, เติมเงิน, ประวัติ เป็น primary flow
- **Safety-critical info** — ข้อมูลแพ้อาหารซิงค์จาก PowerSchool ที่ทั้ง parent และ cashier เห็นตรงกัน
- **Parent control** — อายัดบัตร, limit รายวัน

---

## 2. Current State Audit

| Component | Status | Note |
|-----------|--------|------|
| Wallet DB model (`Wallet`, `WalletTransaction`) | ✅ มี | ฟิลด์ครบ: balance, tx types (TOPUP/DEDUCTION/REFUND/ADJUSTMENT) |
| Wallet REST API | ❌ ไม่มี | ต้องสร้าง `/api/v1/wallets` router |
| Customer model | ⚠️ basic | มี name/photo/email แต่ไม่มี parent relation, grade, allergy |
| Parent/Student user roles | ❌ ไม่มี | User.role รองรับแค่ admin/manager/cashier |
| SSO (Azure/Google) | ❌ ไม่มี | ใช้ JWT username/password เท่านั้น |
| Allergy / PowerSchool | ❌ ไม่มี | ไม่มี field, ไม่มี integration |
| Card management (freeze/limit) | ❌ ไม่มี | ไม่มี card_number, ไม่มี daily_limit |
| PWA / Offline mode | ❌ ไม่มี | ต้องติดตั้ง service worker + IndexedDB |

---

## 3. Feature List & Gap Analysis

### Feature 1: Authentication (SSO + Manual + ID Mapping)

| Sub-feature | Backend | Frontend | Priority |
|-------------|---------|----------|----------|
| SSO Login (Azure/Google @isbd.th) | ❌ Need OAuth2 flow + identity provider config | ❌ SSO button + callback handler | P1 |
| Manual Login (fallback) | ✅ ใช้ของเดิมได้ | ✅ มีฟอร์มแล้ว | — |
| External ID Mapping (sub/oid ↔ internal User.id) | ❌ ต้องเพิ่ม `UserExternalIdentity` table | — | P1 |
| Role: `parent`, `student` | ❌ เพิ่มใน User.role + require_role update | ✅ UserRole union + route guards | P1 |

**Schema:**
```
UserExternalIdentity
  id, user_id (FK), provider (azure|google|manual),
  external_sub (unique), email, display_name, created_at
```

---

### Feature 2: Family Dashboard

| Sub-feature | Backend | Frontend | Priority |
|-------------|---------|----------|----------|
| Family Switcher (1 parent → N students) | ❌ Need `ParentChildLink` table | ❌ Dropdown/tab switcher | P1 |
| Balance Overview (Real-time) | ❌ `GET /wallets/family` endpoint | ❌ Dashboard card grid | P1 |
| Quick Actions (Top-up, QR Pay) | — | ❌ Shortcut buttons | P1 |

**Schema:**
```
ParentChildLink
  parent_user_id (FK users), child_customer_id (FK customers),
  relation (father|mother|guardian), created_at
  UNIQUE(parent_user_id, child_customer_id)
```

---

### Feature 3: Wallet & Top-up

| Sub-feature | Backend | Frontend | Priority |
|-------------|---------|----------|----------|
| Top-up via PromptPay (Dynamic QR) | ❌ Need PromptPay gateway integration | ❌ QR display page | P1 |
| Top-up via Alipay / WeChat Pay | ❌ Need cross-border gateway | ❌ Payment redirect | P2 |
| Top-up via Credit Card (+3% fee) | ❌ Need Omise/Stripe integration | ❌ Card form | P2 |
| Refund Status | ⚠️ CreditNote model exists, need API | ❌ Refund tracking page | P1 |
| Split Wallet (per-student) | ✅ Wallet model already 1:1 to customer | ❌ UI shows per-child balance | P1 |

**New endpoints:**
```
GET    /api/v1/wallets/me              — current user's wallet
GET    /api/v1/wallets/family          — all linked children balances
POST   /api/v1/wallets/{id}/topup      — initiate top-up (returns QR/payment URL)
GET    /api/v1/wallets/{id}/transactions — transaction history
POST   /api/v1/wallets/topup/webhook   — payment gateway callback
```

---

### Feature 4: Transaction History

| Sub-feature | Backend | Frontend | Priority |
|-------------|---------|----------|----------|
| Itemized Receipts (shop + items) | ✅ Receipt + ReceiptItem มีข้อมูลครบ | ❌ Receipt list page for parent | P1 |
| Discount details (item + bill, ฿ / %) | ✅ มี discount field ใน Receipt/Item (just added) | ❌ Display breakdown | P1 |
| Statement Export (CSV/PDF) | ❌ Need export endpoint | ❌ Download button | P2 |
| Date range filter | ⚠️ API มี but need pagination | ❌ Date picker UI | P1 |

---

### Feature 5: Profile & Allergy Info

| Sub-feature | Backend | Frontend | Priority |
|-------------|---------|----------|----------|
| Allergy fields on Customer | ❌ Add `allergies` (JSON/text), `dietary_notes` | ❌ Display on profile | P1 |
| PowerSchool sync | ❌ Need scheduled job + API credential | — | P2 |
| Photo ID (for card tap) | ✅ `photo_url` already on Customer | ❌ Display on profile | P1 |
| Allergy Alert on POS | ⚠️ Backend need flag, Frontend Store need banner | ❌ Warning banner on checkout | P1 |

**Schema addition (Customer):**
```sql
ALTER TABLE customers ADD COLUMN allergies TEXT;         -- comma-separated or JSON
ALTER TABLE customers ADD COLUMN dietary_notes TEXT;
ALTER TABLE customers ADD COLUMN grade VARCHAR(20);      -- G7, G10, etc
ALTER TABLE customers ADD COLUMN student_code VARCHAR(20) UNIQUE;
ALTER TABLE customers ADD COLUMN powerschool_sync_at TIMESTAMPTZ;
```

---

### Feature 6: Card Management

| Sub-feature | Backend | Frontend | Priority |
|-------------|---------|----------|----------|
| Freeze / Unfreeze Card | ❌ Add `card_frozen` to Customer + endpoint | ❌ Toggle button | P1 |
| Daily Spending Limit | ❌ Add `daily_limit` to Customer + enforcement in POS checkout | ❌ Limit setting UI | P2 |
| Card Number / NFC UID | ❌ Add `card_uid` (for tap-to-pay hardware) | — | P2 |
| Lost card alert (notify parent) | ❌ Need notification system | ❌ Alert banner | P2 |

**Schema addition (Customer):**
```sql
ALTER TABLE customers ADD COLUMN card_uid VARCHAR(50) UNIQUE;
ALTER TABLE customers ADD COLUMN card_frozen BOOLEAN DEFAULT false;
ALTER TABLE customers ADD COLUMN daily_limit NUMERIC(10,2);
```

**POS checkout changes:** Before deducting wallet, check:
1. `card_frozen = false`
2. Today's wallet deductions + new amount ≤ `daily_limit` (if set)

---

### Feature 7: Offline Mode / PWA

| Sub-feature | Work | Priority |
|-------------|------|----------|
| PWA manifest + service worker | ❌ Need `vite-plugin-pwa` config | P2 |
| IndexedDB cache (wallet balance, allergies) | ❌ Need cache layer | P2 |
| Offline indicator banner | ❌ Need network status hook | P2 |
| Queue offline actions (top-up → sync on reconnect) | ❌ Complex — Phase 3 | P3 |

---

## 4. Proposed User Flows

### Flow 1: Parent first login
```
1. Open portal → click "Login with ISB Microsoft"
2. Azure OAuth redirect → callback with token
3. Backend verifies token → lookup UserExternalIdentity
   - Match found → issue JWT for linked User.id
   - No match → auto-create user as "parent" role, require admin link-to-children
4. Redirect to Family Dashboard
```

### Flow 2: Top-up
```
1. Dashboard → tap "Top-up" on child's card
2. Choose amount + payment method (PromptPay default)
3. Backend creates PaymentIntent → returns QR + ref_id
4. Display QR, poll GET /payments/{ref_id}/status
5. Webhook from gateway → credit wallet + mark as TOPUP txn
6. UI shows success → balance updates
```

### Flow 3: Student buys at canteen (cashier side)
```
1. Cashier scans student card UID
2. POS calls GET /customers/by-card/{uid}
   - If card_frozen → block transaction, show red banner
   - Show allergy warning if customer has allergies
3. Cashier scans items → checkout with payment_method=wallet
4. Backend checks daily_limit before deducting
5. WalletTransaction DEDUCTION recorded
6. Parent sees balance change in real-time (WebSocket or polling)
```

---

## 5. Implementation Roadmap

### Phase 2A (MVP — 4 weeks)

| Week | Tasks |
|------|-------|
| 1 | Backend: User roles (parent/student), ParentChildLink, Wallet router, UserExternalIdentity |
| 1 | Backend: Customer schema additions (allergies, grade, student_code, card_uid, card_frozen) |
| 2 | Backend: Top-up flow (PromptPay mock gateway first), webhook handler |
| 2 | Backend: Manual SSO skip — username/password parent login |
| 3 | Frontend: Parent login + Family Dashboard + Balance overview |
| 3 | Frontend: Top-up page with QR display |
| 4 | Frontend: Transaction history + Profile/Allergy page |
| 4 | Testing + Documentation |

### Phase 2B (Enhanced — 4 weeks)

| Week | Tasks |
|------|-------|
| 5 | SSO integration (Azure/Google OAuth2) |
| 5 | Card freeze/unfreeze UI + enforcement |
| 6 | Daily limit UI + POS enforcement |
| 6 | Statement export (CSV/PDF) |
| 7 | PowerSchool sync job (allergies/grade) |
| 7 | Allergy alert banner on POS checkout |
| 8 | Credit card / Alipay / WeChat Pay integrations |

### Phase 2C (Offline — 2 weeks)

| Week | Tasks |
|------|-------|
| 9 | PWA manifest, service worker, IndexedDB cache |
| 10 | Offline indicator, cached balance/allergy display |

---

## 6. New Database Tables & Schema Changes

### New Tables

```sql
-- Link parents (User) to children (Customer)
CREATE TABLE parent_child_links (
  id SERIAL PRIMARY KEY,
  parent_user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  child_customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  relation VARCHAR(20) NOT NULL DEFAULT 'guardian',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(parent_user_id, child_customer_id)
);

-- External identity mapping (SSO)
CREATE TABLE user_external_identities (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(20) NOT NULL,       -- azure | google | manual
  external_sub VARCHAR(255) NOT NULL,   -- OIDC sub claim
  email VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider, external_sub)
);
```

### Schema Changes

```sql
-- User role expansion
ALTER TABLE users ALTER COLUMN role TYPE VARCHAR(20);  -- add 'parent', 'student' values

-- Customer = Student profile
ALTER TABLE customers ADD COLUMN student_code VARCHAR(20) UNIQUE;
ALTER TABLE customers ADD COLUMN grade VARCHAR(20);
ALTER TABLE customers ADD COLUMN allergies TEXT;
ALTER TABLE customers ADD COLUMN dietary_notes TEXT;
ALTER TABLE customers ADD COLUMN card_uid VARCHAR(50) UNIQUE;
ALTER TABLE customers ADD COLUMN card_frozen BOOLEAN DEFAULT false;
ALTER TABLE customers ADD COLUMN daily_limit NUMERIC(10,2);
ALTER TABLE customers ADD COLUMN powerschool_sync_at TIMESTAMPTZ;
```

---

## 7. New API Endpoints

### Auth / Family
```
POST   /api/v1/auth/sso/azure            — Azure OAuth callback
POST   /api/v1/auth/sso/google           — Google OAuth callback
GET    /api/v1/auth/family               — current parent's linked children
POST   /api/v1/admin/parent-link         — admin links parent ↔ child (fallback)
```

### Wallet
```
GET    /api/v1/wallets/me                — wallet of current user (if student)
GET    /api/v1/wallets/family            — all children wallets (if parent)
GET    /api/v1/wallets/{id}/transactions — history with date range filter
POST   /api/v1/wallets/{id}/topup        — create top-up intent
GET    /api/v1/payments/{ref_id}/status  — poll payment status
POST   /api/v1/payments/webhook          — gateway callback (public, signed)
```

### Card / Profile
```
GET    /api/v1/customers/by-card/{uid}   — cashier looks up by NFC UID
POST   /api/v1/customers/{id}/freeze     — parent freezes/unfreezes
PATCH  /api/v1/customers/{id}/limit      — parent sets daily_limit
POST   /api/v1/customers/{id}/allergies  — update (or synced from PowerSchool)
```

### Statement
```
GET    /api/v1/statements/export         — CSV/PDF download with filters
```

---

## 8. New Frontend Routes

```
/parent/dashboard            — Family Dashboard (balance overview + switcher)
/parent/wallet/:customerId   — Wallet detail + top-up
/parent/transactions/:customerId — Transaction history
/parent/profile/:customerId  — Profile + allergy + card management
/parent/statement            — Export

/student/home                — Student's own wallet view
/student/profile             — Own profile

/auth/sso/callback           — SSO redirect handler
```

### Role-based access

| Route | admin | manager | cashier | parent | student |
|-------|-------|---------|---------|--------|---------|
| /parent/* | — | — | — | ✅ (own children) | — |
| /student/* | — | — | — | — | ✅ (own data) |
| /management/* | ✅ | ✅ | — | — | — |
| / (POS) | ✅ | ✅ | ✅ | — | — |

---

## 9. Security Considerations

- **Parent authorization check**: backend must verify `parent_user_id` is linked to `child_customer_id` before returning any child data
- **SSO sub mapping**: never trust email alone — always use `sub` claim as stable ID
- **Webhook verification**: PromptPay/Omise webhooks must verify signature
- **Rate limiting**: top-up endpoint needs rate limit to prevent gateway abuse
- **Audit log**: card freeze/unfreeze + daily_limit changes must log to `audit_logs`
- **PII**: allergies are medical data — log access, encrypt at rest if required

---

## 10. Out of Scope (Phase 3+)

- Real-time push notifications (FCM/APNS)
- Multi-language parent emails (delivery notifications)
- Parent mobile app (native iOS/Android)
- Integrated school portal SSO beyond Azure/Google
- Biometric login
- Voucher / gift card system
- Sibling fund transfer between wallets

---

## 11. Dependencies to Research

| Need | Candidate Library/Service |
|------|--------------------------|
| PromptPay QR generation | `promptparse` (Python) or `promptpay-qr` (JS) |
| Credit card gateway | Omise (TH) / Stripe |
| Azure OAuth2 | `msal` (Python) or direct OIDC flow |
| Google OAuth2 | `google-auth` (Python) |
| PWA tooling | `vite-plugin-pwa` + `workbox-window` |
| IndexedDB wrapper | `dexie` (TS) |
| Date range CSV/PDF | `openpyxl` (✅ already in requirements) / `reportlab` (✅ already in requirements) |

---

## Summary Table

| Module | Backend effort | Frontend effort | External deps | Priority |
|--------|----------------|-----------------|---------------|----------|
| 1. Auth (SSO + ID map) | Medium | Medium | Azure/Google app registration | P1 |
| 2. Family Dashboard | Small | Medium | — | P1 |
| 3. Wallet & Top-up | Large | Medium | PromptPay gateway | P1 |
| 4. Transaction History | Small | Small | — | P1 |
| 5. Profile & Allergy | Medium | Small | PowerSchool API | P1/P2 |
| 6. Card Management | Medium | Small | NFC hardware (card UID) | P1/P2 |
| 7. PWA / Offline | Medium | Medium | — | P2 |

**Total estimate**: Phase 2A (MVP) = ~4 weeks backend-heavy; Phase 2B = ~4 weeks; Phase 2C = ~2 weeks
