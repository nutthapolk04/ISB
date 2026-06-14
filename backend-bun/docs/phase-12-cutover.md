# Phase 12 — Cutover Plan

**Status:** ready to begin staged rollout. 143 endpoints ported to Bun (commit `daeb502`).

The cutover uses **Vercel rewrites at the frontend edge** (see `routing-strategy.md`) so each endpoint can be flipped to Bun independently and rolled back by removing the rewrite. The frontend code never changes.

---

## Pre-cutover checklist

- [ ] Deploy Bun backend to Railway as a separate service (e.g. `isb-bun`)
- [ ] Confirm `JWT_SECRET` env var matches FastAPI's `SECRET_KEY` (token interop)
- [ ] Confirm `DATABASE_URL` points to **the same** prod DB
- [ ] Confirm `CORS_ORIGINS` includes all FE origins (incl. kiosk)
- [ ] Rotate the prod DB password (leaked in chat history twice during migration)
- [ ] Boot Bun → verify all 143 routes register (`bun src/index.ts` logs them)
- [ ] Run Phase 1 contract tests against prod DB: `bun test` (8/8 expected)

## Endpoints staying on FastAPI (do NOT rewrite)

These 3 routes are intentionally 501 on Bun:
- `POST /api/v1/sync/run`
- `POST /api/v1/sync/powerschool`
- `POST /api/v1/wallets/:id/topup` **when `payment_method=bay_qr` or `bay_easypay`** — Bun returns 501; client must call FastAPI directly for those methods. Since the FE doesn't know which method until runtime, the simplest path is: keep `POST /wallets/:id/topup` rewrite on FastAPI for now, only flip it after the PYMT gateway HTTP client is ported.

## Staged rollout (low → high risk)

### Wave 1 — Reads (zero write risk)

```json
{ "source": "/api/v1/shops",                "destination": "https://isb-bun.up.railway.app/api/v1/shops" },
{ "source": "/api/v1/shops/:path*",         "destination": "https://isb-bun.up.railway.app/api/v1/shops/:path*" },
{ "source": "/api/v1/products",             "destination": "https://isb-bun.up.railway.app/api/v1/products" },
{ "source": "/api/v1/products/:path*",      "destination": "https://isb-bun.up.railway.app/api/v1/products/:path*" },
{ "source": "/api/v1/customers",            "destination": "https://isb-bun.up.railway.app/api/v1/customers" },
{ "source": "/api/v1/customers/:path*",     "destination": "https://isb-bun.up.railway.app/api/v1/customers/:path*" },
{ "source": "/api/v1/reports/:path*",       "destination": "https://isb-bun.up.railway.app/api/v1/reports/:path*" },
{ "source": "/api/v1/departments",          "destination": "https://isb-bun.up.railway.app/api/v1/departments" },
{ "source": "/api/v1/users",                "destination": "https://isb-bun.up.railway.app/api/v1/users" },
{ "source": "/api/v1/users/:path*",         "destination": "https://isb-bun.up.railway.app/api/v1/users/:path*" },
{ "source": "/api/v1/users-admin/:path*",   "destination": "https://isb-bun.up.railway.app/api/v1/users-admin/:path*" },
{ "source": "/api/v1/admin/settings",       "destination": "https://isb-bun.up.railway.app/api/v1/admin/settings" },
{ "source": "/api/v1/admin/settings/:path*","destination": "https://isb-bun.up.railway.app/api/v1/admin/settings/:path*" },
{ "source": "/api/v1/admin/audit-logs",     "destination": "https://isb-bun.up.railway.app/api/v1/admin/audit-logs" },
{ "source": "/api/v1/customer-display/images",       "destination": "https://isb-bun.up.railway.app/api/v1/customer-display/images" },
{ "source": "/api/v1/customer-display/images/:path*","destination": "https://isb-bun.up.railway.app/api/v1/customer-display/images/:path*" }
```

Smoke-test each: load matching FE screen, hit endpoint via DevTools, confirm response shape matches FastAPI.

### Wave 2 — Auth + light writes

```json
{ "source": "/api/v1/auth/:path*",            "destination": "https://isb-bun.up.railway.app/api/v1/auth/:path*" },
{ "source": "/api/v1/me",                     "destination": "https://isb-bun.up.railway.app/api/v1/me" },
{ "source": "/api/v1/family/:path*",          "destination": "https://isb-bun.up.railway.app/api/v1/family/:path*" },
{ "source": "/api/v1/spending-groups/:path*", "destination": "https://isb-bun.up.railway.app/api/v1/spending-groups/:path*" },
{ "source": "/api/v1/uom/:path*",             "destination": "https://isb-bun.up.railway.app/api/v1/uom/:path*" }
```

Auth flip is critical — token signing must match. Verify by:
1. Login on FastAPI → token works on Bun
2. Login on Bun → token works on FastAPI
3. Logout on Bun invalidates `session_token`

### Wave 3 — Wallet + inventory

```json
{ "source": "/api/v1/wallets/me",                    "destination": "https://isb-bun.up.railway.app/api/v1/wallets/me" },
{ "source": "/api/v1/wallets/family",                "destination": "https://isb-bun.up.railway.app/api/v1/wallets/family" },
{ "source": "/api/v1/wallets/transfer",              "destination": "https://isb-bun.up.railway.app/api/v1/wallets/transfer" },
{ "source": "/api/v1/wallets/topup/:path*",          "destination": "https://isb-bun.up.railway.app/api/v1/wallets/topup/:path*" },
{ "source": "/api/v1/wallets/:id",                   "destination": "https://isb-bun.up.railway.app/api/v1/wallets/:id" },
{ "source": "/api/v1/wallets/:id/transactions",      "destination": "https://isb-bun.up.railway.app/api/v1/wallets/:id/transactions" },
{ "source": "/api/v1/wallets/:id/adjust",            "destination": "https://isb-bun.up.railway.app/api/v1/wallets/:id/adjust" },
{ "source": "/api/v1/wallets/:id/cashier-topup",     "destination": "https://isb-bun.up.railway.app/api/v1/wallets/:id/cashier-topup" },
{ "source": "/api/v1/admin/departments/:path*",      "destination": "https://isb-bun.up.railway.app/api/v1/admin/departments/:path*" },
{ "source": "/api/v1/admin/adjustment-report",       "destination": "https://isb-bun.up.railway.app/api/v1/admin/adjustment-report" },
{ "source": "/api/v1/admin/transfer-report",         "destination": "https://isb-bun.up.railway.app/api/v1/admin/transfer-report" }
```

**Watchpoint:** wallet writes are the highest-risk before POS. Verify a small-amount cashier topup mutates correctly, then `wallets/me` reads the new balance.

### Wave 4 — Returns + bundles + price panels + cardholders

```json
{ "source": "/api/v1/returns",                       "destination": "https://isb-bun.up.railway.app/api/v1/returns" },
{ "source": "/api/v1/returns/:path*",                "destination": "https://isb-bun.up.railway.app/api/v1/returns/:path*" },
{ "source": "/api/v1/return-history",                "destination": "https://isb-bun.up.railway.app/api/v1/return-history" },
{ "source": "/api/v1/refund/:path*",                 "destination": "https://isb-bun.up.railway.app/api/v1/refund/:path*" },
{ "source": "/api/v1/cardholders",                   "destination": "https://isb-bun.up.railway.app/api/v1/cardholders" },
{ "source": "/api/v1/sync-logs",                     "destination": "https://isb-bun.up.railway.app/api/v1/sync-logs" },
{ "source": "/api/v1/sync-logs/:path*",              "destination": "https://isb-bun.up.railway.app/api/v1/sync-logs/:path*" },
{ "source": "/api/v1/sync-audit/:path*",             "destination": "https://isb-bun.up.railway.app/api/v1/sync-audit/:path*" },
{ "source": "/api/v1/sync/logs",                     "destination": "https://isb-bun.up.railway.app/api/v1/sync/logs" },
{ "source": "/api/v1/sync/stats",                    "destination": "https://isb-bun.up.railway.app/api/v1/sync/stats" }
```

### Wave 5 — POS (highest risk, last)

```json
{ "source": "/api/v1/pos/receipt",                   "destination": "https://isb-bun.up.railway.app/api/v1/pos/receipt" },
{ "source": "/api/v1/pos/receipt/:id",               "destination": "https://isb-bun.up.railway.app/api/v1/pos/receipt/:id" },
{ "source": "/api/v1/pos/void/:id",                  "destination": "https://isb-bun.up.railway.app/api/v1/pos/void/:id" },
{ "source": "/api/v1/pos/checkout",                  "destination": "https://isb-bun.up.railway.app/api/v1/pos/checkout" },
{ "source": "/api/v1/canteen/:path*",                "destination": "https://isb-bun.up.railway.app/api/v1/canteen/:path*" }
```

**Watchpoint:** POS checkout is the transactional core. Roll out by shop:
1. Add the rewrite during a low-traffic window (after school hours)
2. Run a 10–20 baht test transaction on each shop type (canteen=avg_cost, bookstore=FIFO)
3. Verify the wallet balance + stock + shop_movements row + audit_logs row + receipt_items rows all match expectation
4. Monitor for 24h before flipping the next shop

### NOT yet ported (keep on FastAPI)

```json
// DO NOT add a rewrite for these:
// POST /api/v1/sync/run
// POST /api/v1/sync/powerschool
// POST /api/v1/bay/callback (gateway → server, lives wherever Bun is deployed —
//                            update the BAY merchant config to point at Bun
//                            ONLY after Bun is stable in Waves 3+)
```

---

## Rollback playbook

For any wave:
1. Notice misbehavior (wrong response shape, 500s, data mismatch)
2. Remove the offending rewrite from `vercel.json`
3. Redeploy frontend (~30s)
4. FE goes back to FastAPI for that path
5. Open issue + reproduce locally, fix in Bun, re-test, then re-add rewrite

Bun rollback is **zero data loss** — both backends read/write the same DB.

---

## After full cutover

When Wave 5 has been stable for 1–2 weeks:
1. Stop the FastAPI Railway service (don't delete yet — keep rollback option)
2. Wait one more week monitoring Bun
3. Delete FastAPI Railway service
4. Remove Vercel rewrites (all paths now point at Bun by default — flip the FE's `API_BASE_URL` env var)
5. Delete `backend/` from the monorepo
6. Update `CLAUDE.md` and project docs to reflect single-backend reality
