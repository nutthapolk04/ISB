# Close Month Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a monthly stock-closing workflow to the Store module — snapshot system quantities, collect physical counts (UI or CSV), auto-generate adjustment movements for variances, and archive each closed period.

**Architecture:** Two new DB tables (`stock_period_closes`, `stock_period_close_items`) hold the snapshot + physical counts. On confirm, the service diffs quantities and inserts `shop_movements` rows of type `adjustment` to reconcile stock. A warning banner flags movements that post-date the snapshot but fall within the closed period.

**Tech Stack:** Bun + Elysia + Drizzle ORM (backend), React + React Query + shadcn/ui + react-router-dom (frontend), Railway PostgreSQL

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `backend-bun/drizzle/schema.ts` | Modify (append) | Two new Drizzle table definitions |
| `backend-bun/src/db/ensure_schema.ts` | Modify (append patches) | CREATE TABLE IF NOT EXISTS at boot |
| `backend-bun/src/services/close_month_service.ts` | Create | All business logic: snapshot, update items, CSV, confirm |
| `backend-bun/src/routes/shops.ts` | Modify (append routes) | 7 HTTP endpoints wired to service |
| `frontend/src/hooks/useCloseMonth.ts` | Create | React Query queries + mutations |
| `frontend/src/pages/store/CloseMonthList.tsx` | Create | List page with shop selector + table |
| `frontend/src/pages/store/CloseMonthDetail.tsx` | Create | 3-tab detail: count / CSV / summary |
| `frontend/src/App.tsx` | Modify | Add 3 routes under store module |
| `frontend/src/components/AppSidebar.tsx` | Modify | Add "ปิดรอบเดือน" nav item |
| `frontend/src/locales/en.json` | Modify | Add nav + page translation keys |
| `frontend/src/locales/th.json` | Modify | Add nav + page translation keys |

---

## Task 1: DB Schema — Two New Tables

**Files:**
- Modify: `backend-bun/drizzle/schema.ts` (append after line 1237)
- Modify: `backend-bun/src/db/ensure_schema.ts` (append to PATCHES array)

- [ ] **Step 1: Append table definitions to `drizzle/schema.ts`**

Add at the very end of the file (after `userRoles`):

```typescript
export const stockPeriodCloses = pgTable("stock_period_closes", {
  id: serial().primaryKey().notNull(),
  shopId: varchar("shop_id", { length: 50 }).notNull(),
  periodYear: integer("period_year").notNull(),
  periodMonth: integer("period_month").notNull(),
  status: varchar({ length: 10 }).notNull().default("draft"),
  closedBy: integer("closed_by"),
  closedAt: timestamp("closed_at", { withTimezone: true, mode: "string" }),
  notes: text(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
}, (table) => [
  unique("uq_stock_period_closes_shop_period").on(table.shopId, table.periodYear, table.periodMonth),
  index("ix_stock_period_closes_shop_id").using("btree", table.shopId.asc()),
  foreignKey({
    columns: [table.shopId],
    foreignColumns: [shops.id],
    name: "stock_period_closes_shop_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.closedBy],
    foreignColumns: [users.id],
    name: "stock_period_closes_closed_by_fkey",
  }),
]);

export const stockPeriodCloseItems = pgTable("stock_period_close_items", {
  id: serial().primaryKey().notNull(),
  closeId: integer("close_id").notNull(),
  productId: integer("product_id").notNull(),
  systemQty: integer("system_qty").notNull(),
  physicalQty: integer("physical_qty"),
  varianceQty: integer("variance_qty"),
  unitCost: numeric("unit_cost", { precision: 10, scale: 4 }),
  varianceValue: numeric("variance_value", { precision: 10, scale: 4 }),
  adjustmentMovementId: integer("adjustment_movement_id"),
}, (table) => [
  index("ix_stock_period_close_items_close_id").using("btree", table.closeId.asc()),
  foreignKey({
    columns: [table.closeId],
    foreignColumns: [stockPeriodCloses.id],
    name: "stock_period_close_items_close_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.productId],
    foreignColumns: [shopProducts.id],
    name: "stock_period_close_items_product_id_fkey",
  }),
  foreignKey({
    columns: [table.adjustmentMovementId],
    foreignColumns: [shopMovements.id],
    name: "stock_period_close_items_adjustment_movement_id_fkey",
  }).onDelete("set null"),
]);
```

- [ ] **Step 2: Append ensure_schema patches**

In `backend-bun/src/db/ensure_schema.ts`, add before the closing `];` of the `PATCHES` array:

```typescript
  // ── Close Month: monthly stock period closes ──────────────────────────────
  {
    sql: `CREATE TABLE IF NOT EXISTS stock_period_closes (
      id SERIAL PRIMARY KEY,
      shop_id VARCHAR(50) NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      period_year INTEGER NOT NULL,
      period_month INTEGER NOT NULL,
      status VARCHAR(10) NOT NULL DEFAULT 'draft',
      closed_by INTEGER REFERENCES users(id),
      closed_at TIMESTAMPTZ,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_stock_period_closes_shop_period UNIQUE (shop_id, period_year, period_month)
    )`,
    label: "CREATE stock_period_closes",
  },
  {
    sql: `CREATE INDEX IF NOT EXISTS ix_stock_period_closes_shop_id ON stock_period_closes(shop_id)`,
    label: "idx stock_period_closes.shop_id",
  },
  {
    sql: `CREATE TABLE IF NOT EXISTS stock_period_close_items (
      id SERIAL PRIMARY KEY,
      close_id INTEGER NOT NULL REFERENCES stock_period_closes(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES shop_products(id),
      system_qty INTEGER NOT NULL,
      physical_qty INTEGER,
      variance_qty INTEGER,
      unit_cost NUMERIC(10,4),
      variance_value NUMERIC(10,4),
      adjustment_movement_id INTEGER REFERENCES shop_movements(id) ON DELETE SET NULL
    )`,
    label: "CREATE stock_period_close_items",
  },
  {
    sql: `CREATE INDEX IF NOT EXISTS ix_stock_period_close_items_close_id ON stock_period_close_items(close_id)`,
    label: "idx stock_period_close_items.close_id",
  },
```

- [ ] **Step 3: Restart backend and verify tables exist**

```bash
cd backend-bun && bun run src/index.ts
```

Expected log lines:
```
[ensureSchema] + CREATE stock_period_closes
[ensureSchema] + CREATE stock_period_close_items
```

- [ ] **Step 4: Commit**

```bash
git add backend-bun/drizzle/schema.ts backend-bun/src/db/ensure_schema.ts
git commit -m "feat: add stock_period_closes and stock_period_close_items tables"
```

---

## Task 2: Backend Service

**Files:**
- Create: `backend-bun/src/services/close_month_service.ts`

- [ ] **Step 1: Create the service file**

```typescript
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { pgClient } from "@/db/client";
import {
  stockPeriodCloses,
  stockPeriodCloseItems,
  shopMovements,
  shopProducts,
} from "@/db/schema";

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface CloseItemDTO {
  id: number;
  product_id: number;
  product_name: string;
  system_qty: number;
  physical_qty: number | null;
  variance_qty: number | null;
  unit_cost: string | null;
  variance_value: string | null;
  adjustment_movement_id: number | null;
}

export interface CloseDTO {
  id: number;
  shop_id: string;
  period_year: number;
  period_month: number;
  status: string;
  closed_by: number | null;
  closed_at: string | null;
  notes: string | null;
  created_at: string;
  items: CloseItemDTO[];
  has_backdated_movements: boolean;
}

export interface CloseSummaryDTO {
  id: number;
  shop_id: string;
  period_year: number;
  period_month: number;
  status: string;
  closed_by: number | null;
  closed_at: string | null;
  notes: string | null;
  created_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function err(msg: string, status: number): Error {
  return Object.assign(new Error(msg), { status });
}

async function fetchItems(closeId: number): Promise<CloseItemDTO[]> {
  const rows = await db
    .select({
      id: stockPeriodCloseItems.id,
      product_id: stockPeriodCloseItems.productId,
      product_name: shopProducts.name,
      system_qty: stockPeriodCloseItems.systemQty,
      physical_qty: stockPeriodCloseItems.physicalQty,
      variance_qty: stockPeriodCloseItems.varianceQty,
      unit_cost: stockPeriodCloseItems.unitCost,
      variance_value: stockPeriodCloseItems.varianceValue,
      adjustment_movement_id: stockPeriodCloseItems.adjustmentMovementId,
    })
    .from(stockPeriodCloseItems)
    .leftJoin(shopProducts, eq(stockPeriodCloseItems.productId, shopProducts.id))
    .where(eq(stockPeriodCloseItems.closeId, closeId))
    .orderBy(shopProducts.name);

  return rows.map((r) => ({
    ...r,
    product_name: r.product_name ?? `product#${r.product_id}`,
  }));
}

async function hasBackdatedMovements(closeId: number): Promise<boolean> {
  const [close] = await db
    .select({ shopId: stockPeriodCloses.shopId, year: stockPeriodCloses.periodYear, month: stockPeriodCloses.periodMonth, createdAt: stockPeriodCloses.createdAt })
    .from(stockPeriodCloses)
    .where(eq(stockPeriodCloses.id, closeId))
    .limit(1);
  if (!close) return false;

  const rows = await pgClient<{ count: string }[]>`
    SELECT COUNT(*)::text AS count
    FROM shop_movements
    WHERE shop_id = ${close.shopId}
      AND DATE_PART('year', date::date) = ${close.year}
      AND DATE_PART('month', date::date) = ${close.month}
      AND created_at > ${close.createdAt}
    LIMIT 1
  `;
  return parseInt(rows[0]?.count ?? "0", 10) > 0;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function listCloses(shopId: string): Promise<CloseSummaryDTO[]> {
  const rows = await db
    .select()
    .from(stockPeriodCloses)
    .where(eq(stockPeriodCloses.shopId, shopId))
    .orderBy(
      sql`${stockPeriodCloses.periodYear} DESC`,
      sql`${stockPeriodCloses.periodMonth} DESC`,
    );
  return rows.map((r) => ({
    id: r.id,
    shop_id: r.shopId,
    period_year: r.periodYear,
    period_month: r.periodMonth,
    status: r.status,
    closed_by: r.closedBy,
    closed_at: r.closedAt,
    notes: r.notes,
    created_at: r.createdAt,
  }));
}

export async function createClose(
  shopId: string,
  periodYear: number,
  periodMonth: number,
): Promise<CloseDTO> {
  const existing = await db
    .select({ id: stockPeriodCloses.id })
    .from(stockPeriodCloses)
    .where(
      and(
        eq(stockPeriodCloses.shopId, shopId),
        eq(stockPeriodCloses.periodYear, periodYear),
        eq(stockPeriodCloses.periodMonth, periodMonth),
      ),
    )
    .limit(1);
  if (existing[0]) throw err("Period already exists for this shop and month", 409);

  const products = await db
    .select({ id: shopProducts.id, stock: shopProducts.stock, avgCost: shopProducts.avgCost })
    .from(shopProducts)
    .where(and(eq(shopProducts.shopId, shopId), eq(shopProducts.isActive, true)));

  const [close] = await db
    .insert(stockPeriodCloses)
    .values({ shopId, periodYear, periodMonth, status: "draft" })
    .returning();

  if (products.length > 0) {
    await db.insert(stockPeriodCloseItems).values(
      products.map((p) => ({
        closeId: close.id,
        productId: p.id,
        systemQty: p.stock,
        unitCost: p.avgCost,
      })),
    );
  }

  return getClose(close.id);
}

export async function getClose(closeId: number): Promise<CloseDTO> {
  const [close] = await db
    .select()
    .from(stockPeriodCloses)
    .where(eq(stockPeriodCloses.id, closeId))
    .limit(1);
  if (!close) throw err("Close period not found", 404);

  const [items, backdated] = await Promise.all([
    fetchItems(closeId),
    hasBackdatedMovements(closeId),
  ]);

  return {
    id: close.id,
    shop_id: close.shopId,
    period_year: close.periodYear,
    period_month: close.periodMonth,
    status: close.status,
    closed_by: close.closedBy,
    closed_at: close.closedAt,
    notes: close.notes,
    created_at: close.createdAt,
    items,
    has_backdated_movements: backdated,
  };
}

export async function bulkUpdateItems(
  closeId: number,
  updates: { item_id: number; physical_qty: number }[],
): Promise<void> {
  const [close] = await db
    .select({ status: stockPeriodCloses.status })
    .from(stockPeriodCloses)
    .where(eq(stockPeriodCloses.id, closeId))
    .limit(1);
  if (!close) throw err("Close period not found", 404);
  if (close.status === "closed") throw err("Cannot update a closed period", 409);

  for (const u of updates) {
    const varianceQty = null; // will be computed on confirm
    await db
      .update(stockPeriodCloseItems)
      .set({ physicalQty: u.physical_qty })
      .where(
        and(eq(stockPeriodCloseItems.id, u.item_id), eq(stockPeriodCloseItems.closeId, closeId)),
      );
  }
}

export async function importCsv(
  closeId: number,
  csvText: string,
): Promise<{ imported: number; skipped: number }> {
  const [close] = await db
    .select({ status: stockPeriodCloses.status })
    .from(stockPeriodCloses)
    .where(eq(stockPeriodCloses.id, closeId))
    .limit(1);
  if (!close) throw err("Close period not found", 404);
  if (close.status === "closed") throw err("Cannot update a closed period", 409);

  const lines = csvText.trim().split("\n");
  // Skip header row
  const dataLines = lines.slice(1);

  let imported = 0;
  let skipped = 0;

  for (const line of dataLines) {
    const cols = line.split(",");
    const itemId = parseInt(cols[0]?.trim() ?? "", 10);
    const physicalQty = parseInt(cols[3]?.trim() ?? "", 10);

    if (isNaN(itemId) || isNaN(physicalQty)) {
      skipped++;
      continue;
    }

    const affected = await db
      .update(stockPeriodCloseItems)
      .set({ physicalQty })
      .where(
        and(eq(stockPeriodCloseItems.id, itemId), eq(stockPeriodCloseItems.closeId, closeId)),
      );
    imported++;
  }

  return { imported, skipped };
}

export async function exportCsv(closeId: number): Promise<string> {
  const items = await fetchItems(closeId);
  const header = "item_id,product_name,system_qty,physical_qty";
  const rows = items.map(
    (i) => `${i.id},${JSON.stringify(i.product_name)},${i.system_qty},${i.physical_qty ?? ""}`,
  );
  return [header, ...rows].join("\n");
}

export async function confirmClose(closeId: number, userId: number): Promise<CloseDTO> {
  const [close] = await db
    .select()
    .from(stockPeriodCloses)
    .where(eq(stockPeriodCloses.id, closeId))
    .limit(1);
  if (!close) throw err("Close period not found", 404);
  if (close.status === "closed") throw err("Period already confirmed", 409);

  const items = await fetchItems(closeId);
  const unfilled = items.filter((i) => i.physical_qty === null);
  if (unfilled.length > 0) {
    throw err(`${unfilled.length} item(s) still need physical count before confirming`, 422);
  }

  const today = new Date().toISOString().slice(0, 10);
  const monthLabel = `${close.periodYear}-${String(close.periodMonth).padStart(2, "0")}`;

  await pgClient.begin(async (tx) => {
    for (const item of items) {
      const variance = item.physical_qty! - item.system_qty;

      let varianceValue: string | null = null;
      if (item.unit_cost !== null) {
        varianceValue = (variance * parseFloat(item.unit_cost)).toFixed(4);
      }

      if (variance === 0) {
        await tx`
          UPDATE stock_period_close_items
          SET variance_qty = 0, variance_value = 0
          WHERE id = ${item.id}
        `;
        continue;
      }

      // Fetch current stock for movement audit trail
      const [product] = await tx<{ stock: number; name: string }[]>`
        SELECT stock, name FROM shop_products WHERE id = ${item.product_id} LIMIT 1
      `;
      const stockBefore = product?.stock ?? 0;
      const stockAfter = stockBefore + variance;

      // Insert adjustment movement
      const [movement] = await tx<{ id: number }[]>`
        INSERT INTO shop_movements (date, product_id, product_name, shop_id, type, quantity, stock_before, stock_after, cost_per_unit, note, created_by)
        VALUES (${today}, ${item.product_id}, ${product?.name ?? item.product_name}, ${close.shopId}, 'adjustment', ${variance}, ${stockBefore}, ${stockAfter}, ${item.unit_cost ?? null}, ${"ปิดรอบ " + monthLabel}, ${userId})
        RETURNING id
      `;

      // Update product stock
      await tx`UPDATE shop_products SET stock = ${stockAfter} WHERE id = ${item.product_id}`;

      // Update close item
      await tx`
        UPDATE stock_period_close_items
        SET variance_qty = ${variance}, variance_value = ${varianceValue}, adjustment_movement_id = ${movement.id}
        WHERE id = ${item.id}
      `;
    }

    // Mark period as closed
    await tx`
      UPDATE stock_period_closes
      SET status = 'closed', closed_by = ${userId}, closed_at = NOW()
      WHERE id = ${closeId}
    `;
  });

  return getClose(closeId);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd backend-bun && bun build src/index.ts --dry-run 2>&1 | head -20
```

Expected: no errors (or only irrelevant warnings).

- [ ] **Step 3: Commit**

```bash
git add backend-bun/src/services/close_month_service.ts
git commit -m "feat: add close_month_service with snapshot, bulk update, CSV, confirm"
```

---

## Task 3: Backend Routes

**Files:**
- Modify: `backend-bun/src/routes/shops.ts`

- [ ] **Step 1: Add service import at top of `shops.ts`**

After the existing imports (around line 24), add:

```typescript
import {
  listCloses,
  createClose,
  getClose,
  bulkUpdateItems,
  importCsv,
  exportCsv,
  confirmClose,
} from "@/services/close_month_service";
```

- [ ] **Step 2: Append 7 routes at the end of `shopRoutes`**

Add before the closing `;` of `shopRoutes`:

```typescript
  // ─── Close Month ────────────────────────────────────────────────────────────

  .get(
    "/:shopId/close-month",
    async ({ params, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) {
        set.status = 403;
        return { detail: "Forbidden" };
      }
      try {
        return await listCloses(params.shopId);
      } catch (e) {
        return handleErr(set, e);
      }
    },
    { params: t.Object({ shopId: t.String() }) },
  )

  .post(
    "/:shopId/close-month",
    async ({ params, body, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) {
        set.status = 403;
        return { detail: "Forbidden" };
      }
      try {
        set.status = 201;
        return await createClose(
          params.shopId,
          (body as { period_year: number; period_month: number }).period_year,
          (body as { period_year: number; period_month: number }).period_month,
        );
      } catch (e) {
        return handleErr(set, e);
      }
    },
    {
      params: t.Object({ shopId: t.String() }),
      body: t.Object({
        period_year: t.Number({ minimum: 2000, maximum: 2100 }),
        period_month: t.Number({ minimum: 1, maximum: 12 }),
      }),
    },
  )

  .get(
    "/:shopId/close-month/:closeId",
    async ({ params, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) {
        set.status = 403;
        return { detail: "Forbidden" };
      }
      try {
        return await getClose(parseInt(params.closeId));
      } catch (e) {
        return handleErr(set, e);
      }
    },
    { params: t.Object({ shopId: t.String(), closeId: t.String() }) },
  )

  .patch(
    "/:shopId/close-month/:closeId/items",
    async ({ params, body, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) {
        set.status = 403;
        return { detail: "Forbidden" };
      }
      try {
        await bulkUpdateItems(parseInt(params.closeId), (body as { updates: { item_id: number; physical_qty: number }[] }).updates);
        return { ok: true };
      } catch (e) {
        return handleErr(set, e);
      }
    },
    {
      params: t.Object({ shopId: t.String(), closeId: t.String() }),
      body: t.Object({
        updates: t.Array(
          t.Object({ item_id: t.Number(), physical_qty: t.Number({ minimum: 0 }) }),
        ),
      }),
    },
  )

  .post(
    "/:shopId/close-month/:closeId/import-csv",
    async ({ params, body, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) {
        set.status = 403;
        return { detail: "Forbidden" };
      }
      try {
        const csvText = await (body as { file: File }).file.text();
        return await importCsv(parseInt(params.closeId), csvText);
      } catch (e) {
        return handleErr(set, e);
      }
    },
    {
      params: t.Object({ shopId: t.String(), closeId: t.String() }),
      body: t.Object({ file: t.File() }),
      type: "multipart/form-data",
    },
  )

  .get(
    "/:shopId/close-month/:closeId/export-csv",
    async ({ params, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) {
        set.status = 403;
        return { detail: "Forbidden" };
      }
      try {
        const csv = await exportCsv(parseInt(params.closeId));
        set.headers = {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="close-${params.closeId}.csv"`,
        };
        return csv;
      } catch (e) {
        return handleErr(set, e);
      }
    },
    { params: t.Object({ shopId: t.String(), closeId: t.String() }) },
  )

  .post(
    "/:shopId/close-month/:closeId/confirm",
    async ({ params, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) {
        set.status = 403;
        return { detail: "Forbidden" };
      }
      try {
        return await confirmClose(parseInt(params.closeId), user.id);
      } catch (e) {
        return handleErr(set, e);
      }
    },
    { params: t.Object({ shopId: t.String(), closeId: t.String() }) },
  )
```

- [ ] **Step 3: Verify backend starts without error**

```bash
cd backend-bun && bun run src/index.ts
```

Expected: no TypeScript errors, server starts on port 3001.

- [ ] **Step 4: Smoke test with curl**

```bash
# Replace SHOP_ID and TOKEN with real values
curl -H "Authorization: Bearer TOKEN" \
  http://localhost:3001/api/v1/shops/SHOP_ID/close-month
```

Expected: `[]` (empty array, 200 OK)

- [ ] **Step 5: Commit**

```bash
git add backend-bun/src/routes/shops.ts
git commit -m "feat: add close-month API routes (7 endpoints)"
```

---

## Task 4: Frontend Hook

**Files:**
- Create: `frontend/src/hooks/useCloseMonth.ts`

- [ ] **Step 1: Create the hook file**

```typescript
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface CloseItem {
  id: number;
  product_id: number;
  product_name: string;
  system_qty: number;
  physical_qty: number | null;
  variance_qty: number | null;
  unit_cost: string | null;
  variance_value: string | null;
  adjustment_movement_id: number | null;
}

export interface CloseDetail {
  id: number;
  shop_id: string;
  period_year: number;
  period_month: number;
  status: string;
  closed_by: number | null;
  closed_at: string | null;
  notes: string | null;
  created_at: string;
  items: CloseItem[];
  has_backdated_movements: boolean;
}

export interface CloseSummary {
  id: number;
  shop_id: string;
  period_year: number;
  period_month: number;
  status: string;
  closed_by: number | null;
  closed_at: string | null;
  notes: string | null;
  created_at: string;
}

const closeMonthKeys = {
  list: (shopId: string) => ["close-month", shopId] as const,
  detail: (closeId: number) => ["close-month-detail", closeId] as const,
};

export function useCloseList(shopId: string) {
  return useQuery({
    queryKey: closeMonthKeys.list(shopId),
    queryFn: () => api.get<CloseSummary[]>(`/shops/${shopId}/close-month`),
    enabled: !!shopId,
  });
}

export function useCloseDetail(shopId: string, closeId: number) {
  return useQuery({
    queryKey: closeMonthKeys.detail(closeId),
    queryFn: () => api.get<CloseDetail>(`/shops/${shopId}/close-month/${closeId}`),
    enabled: !!shopId && !!closeId,
  });
}

export function useCreateClose(shopId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { period_year: number; period_month: number }) =>
      api.post<CloseDetail>(`/shops/${shopId}/close-month`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: closeMonthKeys.list(shopId) }),
  });
}

export function useBulkUpdateItems(shopId: string, closeId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (updates: { item_id: number; physical_qty: number }[]) =>
      api.patch<{ ok: boolean }>(`/shops/${shopId}/close-month/${closeId}/items`, { updates }),
    onSuccess: () => qc.invalidateQueries({ queryKey: closeMonthKeys.detail(closeId) }),
  });
}

export function useImportCsv(shopId: string, closeId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api.postFormData<{ imported: number; skipped: number }>(
        `/shops/${shopId}/close-month/${closeId}/import-csv`,
        form,
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: closeMonthKeys.detail(closeId) }),
  });
}

export function useConfirmClose(shopId: string, closeId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<CloseDetail>(`/shops/${shopId}/close-month/${closeId}/confirm`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: closeMonthKeys.detail(closeId) });
      qc.invalidateQueries({ queryKey: closeMonthKeys.list(shopId) });
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/useCloseMonth.ts
git commit -m "feat: add useCloseMonth React Query hooks"
```

---

## Task 5: Frontend List Page

**Files:**
- Create: `frontend/src/pages/store/CloseMonthList.tsx`

- [ ] **Step 1: Create the list page**

```typescript
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useCloseList, useCreateClose } from "@/hooks/useCloseMonth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

const MONTH_NAMES_TH = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

export default function CloseMonthList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const shopId = user?.shopId ?? "";

  const { data: closes = [], isLoading } = useCloseList(shopId);
  const createClose = useCreateClose(shopId);

  const [open, setOpen] = useState(false);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  async function handleCreate() {
    try {
      const result = await createClose.mutateAsync({ period_year: year, period_month: month });
      setOpen(false);
      navigate(`/store/close-month/${result.id}`);
    } catch (e: any) {
      toast.error(e?.message ?? "เกิดข้อผิดพลาด");
    }
  }

  if (!shopId) {
    return <div className="p-6 text-muted-foreground">ไม่พบร้านค้าที่กำหนด</div>;
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">ปิดรอบเดือน</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>+ เริ่มปิดรอบ</Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>เลือกรอบที่ต้องการปิด</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 pt-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-muted-foreground">ปี</label>
                  <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">เดือน</label>
                  <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MONTH_NAMES_TH.map((n, i) => (
                        <SelectItem key={i + 1} value={String(i + 1)}>{n}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button
                className="w-full"
                onClick={handleCreate}
                disabled={createClose.isPending}
              >
                {createClose.isPending ? "กำลังสร้าง..." : "สร้างรอบปิด"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground">กำลังโหลด...</div>
      ) : closes.length === 0 ? (
        <div className="text-muted-foreground">ยังไม่มีรอบปิดเดือน</div>
      ) : (
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-3 text-left">เดือน</th>
                <th className="p-3 text-left">สถานะ</th>
                <th className="p-3 text-left">วันที่ปิด</th>
              </tr>
            </thead>
            <tbody>
              {closes.map((c) => (
                <tr
                  key={c.id}
                  className="border-t cursor-pointer hover:bg-muted/30"
                  onClick={() => navigate(`/store/close-month/${c.id}`)}
                >
                  <td className="p-3">
                    {MONTH_NAMES_TH[c.period_month - 1]} {c.period_year}
                  </td>
                  <td className="p-3">
                    <Badge variant={c.status === "closed" ? "success" : "secondary"}>
                      {c.status === "closed" ? "ปิดแล้ว" : "ร่าง"}
                    </Badge>
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {c.closed_at
                      ? new Date(c.closed_at).toLocaleDateString("th-TH")
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/store/CloseMonthList.tsx
git commit -m "feat: add CloseMonthList page"
```

---

## Task 6: Frontend Detail Page

**Files:**
- Create: `frontend/src/pages/store/CloseMonthDetail.tsx`

- [ ] **Step 1: Create the detail page**

```typescript
import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  useCloseDetail,
  useBulkUpdateItems,
  useImportCsv,
  useConfirmClose,
} from "@/hooks/useCloseMonth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

const MONTH_NAMES_TH = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

export default function CloseMonthDetail() {
  const { closeId } = useParams<{ closeId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const shopId = user?.shopId ?? "";
  const id = parseInt(closeId ?? "0");

  const { data: close, isLoading } = useCloseDetail(shopId, id);
  const bulkUpdate = useBulkUpdateItems(shopId, id);
  const importCsv = useImportCsv(shopId, id);
  const confirm = useConfirmClose(shopId, id);

  const [localQty, setLocalQty] = useState<Record<number, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const isClosed = close?.status === "closed";

  function getQty(itemId: number, fallback: number | null): string {
    if (itemId in localQty) return localQty[itemId];
    return fallback !== null ? String(fallback) : "";
  }

  async function handleSave() {
    const updates = Object.entries(localQty)
      .map(([id, qty]) => ({ item_id: parseInt(id), physical_qty: parseInt(qty) }))
      .filter((u) => !isNaN(u.physical_qty));
    if (updates.length === 0) return;
    try {
      await bulkUpdate.mutateAsync(updates);
      setLocalQty({});
      toast.success("บันทึกแล้ว");
    } catch (e: any) {
      toast.error(e?.message ?? "เกิดข้อผิดพลาด");
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await importCsv.mutateAsync(file);
      toast.success(`นำเข้า ${result.imported} รายการ (ข้าม ${result.skipped} รายการ)`);
    } catch (err: any) {
      toast.error(err?.message ?? "นำเข้าไม่สำเร็จ");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleConfirm() {
    if (!window.confirm("ยืนยันปิดรอบเดือนนี้? ระบบจะสร้างรายการปรับสต๊อกตามผลต่าง")) return;
    try {
      await confirm.mutateAsync();
      toast.success("ปิดรอบเดือนสำเร็จ");
    } catch (e: any) {
      toast.error(e?.message ?? "เกิดข้อผิดพลาด");
    }
  }

  function handleExportCsv() {
    window.open(
      `${import.meta.env.VITE_API_BASE_URL}/shops/${shopId}/close-month/${id}/export-csv`,
      "_blank",
    );
  }

  if (isLoading) return <div className="p-6 text-muted-foreground">กำลังโหลด...</div>;
  if (!close) return <div className="p-6 text-muted-foreground">ไม่พบข้อมูล</div>;

  const filledCount = close.items.filter((i) => {
    const v = localQty[i.id];
    return v !== undefined ? v !== "" : i.physical_qty !== null;
  }).length;
  const totalCount = close.items.length;

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate("/store/close-month")}
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          ← กลับ
        </button>
        <h1 className="text-xl font-semibold">
          ปิดรอบ {MONTH_NAMES_TH[close.period_month - 1]} {close.period_year}
        </h1>
        <Badge variant={isClosed ? "success" : "secondary"}>
          {isClosed ? "ปิดแล้ว" : "ร่าง"}
        </Badge>
      </div>

      {/* Warning banner */}
      {close.has_backdated_movements && (
        <div className="rounded-md border border-yellow-400 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          มีรายการ movement ที่เกิดขึ้นหลังจากสร้างรอบนี้ ข้อมูลอาจไม่ตรงกับความเป็นจริง
        </div>
      )}

      <Tabs defaultValue="count">
        <TabsList>
          <TabsTrigger value="count">นับสต๊อก ({filledCount}/{totalCount})</TabsTrigger>
          <TabsTrigger value="csv">นำเข้า CSV</TabsTrigger>
          <TabsTrigger value="summary">สรุป</TabsTrigger>
        </TabsList>

        {/* Tab 1: Physical count */}
        <TabsContent value="count" className="space-y-3">
          {!isClosed && (
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={handleSave}
                disabled={bulkUpdate.isPending || Object.keys(localQty).length === 0}
              >
                {bulkUpdate.isPending ? "กำลังบันทึก..." : "บันทึก"}
              </Button>
            </div>
          )}
          <div className="rounded-md border overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-3 text-left">สินค้า</th>
                  <th className="p-3 text-right">ในระบบ</th>
                  <th className="p-3 text-right">นับจริง</th>
                  <th className="p-3 text-right">ผลต่าง</th>
                </tr>
              </thead>
              <tbody>
                {close.items.map((item) => {
                  const physical = getQty(item.id, item.physical_qty);
                  const physNum = physical !== "" ? parseInt(physical) : null;
                  const variance = physNum !== null ? physNum - item.system_qty : null;
                  return (
                    <tr key={item.id} className="border-t">
                      <td className="p-3">{item.product_name}</td>
                      <td className="p-3 text-right tabular-nums">{item.system_qty}</td>
                      <td className="p-3 text-right">
                        {isClosed ? (
                          <span className="tabular-nums">{item.physical_qty ?? "—"}</span>
                        ) : (
                          <Input
                            type="number"
                            min={0}
                            className="w-24 text-right ml-auto"
                            value={physical}
                            onChange={(e) =>
                              setLocalQty((prev) => ({ ...prev, [item.id]: e.target.value }))
                            }
                          />
                        )}
                      </td>
                      <td
                        className={`p-3 text-right tabular-nums ${
                          variance === null ? "text-muted-foreground" :
                          variance < 0 ? "text-red-600" :
                          variance > 0 ? "text-green-600" : ""
                        }`}
                      >
                        {variance === null ? "—" : variance > 0 ? `+${variance}` : variance}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* Tab 2: CSV */}
        <TabsContent value="csv" className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              ดาวน์โหลด template แล้วกรอก physical_qty จากนั้นอัปโหลดกลับ
            </p>
            <Button variant="outline" onClick={handleExportCsv}>
              ดาวน์โหลด CSV Template
            </Button>
          </div>
          {!isClosed && (
            <div className="space-y-2">
              <p className="text-sm font-medium">อัปโหลด CSV ที่กรอกแล้ว</p>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="text-sm"
                onChange={handleImport}
                disabled={importCsv.isPending}
              />
              {importCsv.isPending && (
                <p className="text-sm text-muted-foreground">กำลังนำเข้า...</p>
              )}
            </div>
          )}
        </TabsContent>

        {/* Tab 3: Summary */}
        <TabsContent value="summary" className="space-y-4">
          <div className="rounded-md border overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-3 text-left">สินค้า</th>
                  <th className="p-3 text-right">ในระบบ</th>
                  <th className="p-3 text-right">นับจริง</th>
                  <th className="p-3 text-right">ผลต่าง</th>
                  <th className="p-3 text-right">มูลค่าต่าง</th>
                </tr>
              </thead>
              <tbody>
                {close.items
                  .filter((i) => i.physical_qty !== null)
                  .map((item) => {
                    const v = item.physical_qty! - item.system_qty;
                    const val = item.unit_cost
                      ? (v * parseFloat(item.unit_cost)).toFixed(2)
                      : null;
                    return (
                      <tr key={item.id} className="border-t">
                        <td className="p-3">{item.product_name}</td>
                        <td className="p-3 text-right tabular-nums">{item.system_qty}</td>
                        <td className="p-3 text-right tabular-nums">{item.physical_qty}</td>
                        <td
                          className={`p-3 text-right tabular-nums ${
                            v < 0 ? "text-red-600" : v > 0 ? "text-green-600" : ""
                          }`}
                        >
                          {v > 0 ? `+${v}` : v}
                        </td>
                        <td
                          className={`p-3 text-right tabular-nums ${
                            v < 0 ? "text-red-600" : v > 0 ? "text-green-600" : ""
                          }`}
                        >
                          {val !== null ? `฿${val}` : "—"}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>

          {!isClosed && (
            <div className="flex justify-end">
              <Button
                onClick={handleConfirm}
                disabled={confirm.isPending || filledCount < totalCount}
                variant="default"
              >
                {confirm.isPending
                  ? "กำลังปิดรอบ..."
                  : filledCount < totalCount
                  ? `ยังกรอกไม่ครบ (${filledCount}/${totalCount})`
                  : "ยืนยันปิดรอบ"}
              </Button>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/store/CloseMonthDetail.tsx
git commit -m "feat: add CloseMonthDetail page with 3-tab workflow"
```

---

## Task 7: Wire Up Router + Sidebar + i18n

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/AppSidebar.tsx`
- Modify: `frontend/src/locales/en.json`
- Modify: `frontend/src/locales/th.json`

- [ ] **Step 1: Add imports to `App.tsx`**

At the top with other store imports (after `import StoreRequisition`):

```typescript
import CloseMonthList from "./pages/store/CloseMonthList";
import CloseMonthDetail from "./pages/store/CloseMonthDetail";
```

- [ ] **Step 2: Add routes to `App.tsx`**

Inside the `<Route element={<RequireModule module="store" />}>` block, after the existing store routes (around line 296, after the `audit-logs` route), add:

```tsx
<Route element={<RequireRole roles={["admin", "manager"]} />}>
  <Route path="/store/close-month" element={<CloseMonthList />} />
  <Route path="/store/close-month/:closeId" element={<CloseMonthDetail />} />
</Route>
```

- [ ] **Step 3: Add nav item to `AppSidebar.tsx`**

In the `nav.groupStore` section (around line 118), add after `nav.storeReturns`:

```typescript
{ titleKey: "nav.storeCloseMonth", url: "/store/close-month", icon: CalendarCheck, roles: ["admin", "manager"], matchPrefix: true },
```

Also add the icon import at the top of `AppSidebar.tsx`:
```typescript
import { CalendarCheck } from "lucide-react";
```

- [ ] **Step 4: Add i18n keys to `en.json`**

In `frontend/src/locales/en.json`, under the `nav` object, add:

```json
"storeCloseMonth": "Close Month"
```

- [ ] **Step 5: Add i18n keys to `th.json`**

In `frontend/src/locales/th.json`, under the `nav` object, add:

```json
"storeCloseMonth": "ปิดรอบเดือน"
```

- [ ] **Step 6: Start frontend and verify**

```bash
cd frontend && bun run dev
```

1. Open browser → navigate to `/store/close-month`
2. Verify "ปิดรอบเดือน" appears in sidebar
3. Verify list page loads without error
4. Click "+ เริ่มปิดรอบ" → select a month → click "สร้างรอบปิด"
5. Verify redirect to detail page with product list
6. Enter physical quantities → click "บันทึก"
7. Go to "สรุป" tab → verify variance shown → click "ยืนยันปิดรอบ"
8. Verify status changes to "ปิดแล้ว"
9. Go back to list → verify closed period appears

- [ ] **Step 7: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/AppSidebar.tsx frontend/src/locales/en.json frontend/src/locales/th.json
git commit -m "feat: wire up close-month routes, sidebar nav, and i18n"
```

---

## Self-Review

### Spec Coverage
- [x] Monthly close with snapshot → Task 2 `createClose()`
- [x] Physical count via UI → Task 6 count tab
- [x] Physical count via CSV → Task 6 CSV tab + Task 2 `importCsv()`
- [x] Auto adjustment movements on variance → Task 2 `confirmClose()`
- [x] Warning-only for backdated movements → Task 2 `hasBackdatedMovements()`, Task 6 banner
- [x] Admin + Manager roles only → Task 3 all routes check `hasRole("admin","manager")`
- [x] List with history → Task 5
- [x] Read-only view for closed periods → Task 6 `isClosed` guards
- [x] Unique constraint prevents duplicate closes → Task 1 schema + Task 2 createClose check
- [x] Block confirm when items unfilled → Task 2 `confirmClose()` + Task 6 button disabled

### Edge Cases Covered
- [x] Empty product list (no items) → handled in `createClose()`
- [x] Duplicate period → 409 from service
- [x] Confirm already-closed → 409 from service
- [x] CSV with invalid rows → skipped, count returned
- [x] All variances zero → no movements created, period still closes
