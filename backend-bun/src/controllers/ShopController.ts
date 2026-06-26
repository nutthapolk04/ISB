import type { SetStatus } from "@/controllers/types";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users, shops as shopsTable, shopProducts, productOrderHistory } from "@/db/schema";
import { hasRole } from "@/middleware/AuthUtils";
import {
    listShops as listShopsService,
    getShop as getShopService,
    createShop as createShopService,
    updateShop as updateShopService,
    deleteShop as deleteShopService,
    shopStats as shopStatsService,
    listLowStock as listLowStockService,
    updateVoidShortcuts as updateVoidShortcutsService,
} from "@/services/shop_service";
import {
    listShopProducts as listShopProductsService,
    listShopCategories as listShopCategoriesService,
    listProductBarcodes as listProductBarcodesService,
    addProductBarcode as addProductBarcodeService,
    deleteProductBarcode as deleteProductBarcodeService,
    listFifoLots as listFifoLotsService,
    listShopMovements as listShopMovementsService,
    listShopAuditLogs as listShopAuditLogsService,
} from "@/services/shop_product_service";
import { checkout } from "@/services/pos_checkout_service";
import {
    listCloses,
    createClose,
    getClose,
    bulkUpdateItems,
    importExcel,
    exportExcel,
    confirmClose,
} from "@/services/close_month_service";
import { getMonthlyStockReport, exportMonthlyStockReport } from "@/services/monthly_stock_service";
import { adminOnly, forbidden, handleServiceError } from "@/utils/ResponseUtil";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function managerOrAdmin(set: SetStatus) {
    return forbidden(set, "Forbidden");
}

async function assertCloseForShop(
    closeId: number,
    shopId: string,
    set: SetStatus,
) {
    const close = await getClose(closeId);
    if (close.shop_id !== shopId) {
        set.status = 403;
        return { error: { detail: "Forbidden" } as const, close: null };
    }
    return { error: null, close };
}

export const ShopController = {
    list: async ({ query }: any) => {
        const activeOnly = query.active_only !== "false";
        const module =
            query.module === "canteen" || query.module === "store" ? query.module : undefined;
        return await listShopsService({ activeOnly, module });
    },

    create: async (ctx: any) => {
        const { body, user, set } = ctx;
        if (!user.is_superuser) return adminOnly(set);
        try {
            set.status = 201;
            return await createShopService({
                ...body,
                description: body.description ?? undefined,
                allow_department_charge: body.allow_department_charge ?? undefined,
                uses_dual_pricing: body.uses_dual_pricing ?? undefined,
                spending_group_id: body.spending_group_id ?? undefined,
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    listLowStock: async ({ set }: any) => {
        try {
            return await listLowStockService();
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    get: async ({ params, set }: any) => {
        const shop = await getShopService(params.shopId);
        if (!shop) {
            set.status = 404;
            return { detail: "Shop not found" };
        }
        return shop;
    },

    update: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!user.is_superuser) return adminOnly(set);
        try {
            return await updateShopService(params.shopId, body);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    delete: async (ctx: any) => {
        const { params, user, set } = ctx;
        if (!user.is_superuser) return adminOnly(set);
        try {
            return await deleteShopService(params.shopId);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    updateVoidShortcuts: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        const isAdmin = user.is_superuser || hasRole(user.roles, "admin");
        const isManagerOfShop =
            hasRole(user.roles, "manager") && user.shop_id === params.shopId;
        if (!isAdmin && !isManagerOfShop) {
            set.status = 403;
            return { detail: "Only the shop's manager (or admin) can edit void shortcuts" };
        }
        try {
            return await updateVoidShortcutsService(params.shopId, body.shortcuts);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    stats: async ({ params, set }: any) => {
        try {
            return await shopStatsService(params.shopId);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    listProducts: async ({ params, query, set }: any) => {
        try {
            return await listShopProductsService(params.shopId, {
                search: query.search ?? undefined,
                category: query.category ?? undefined,
                includeInactive: query.include_inactive === "true",
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    listCategories: async ({ params, set }: any) => {
        try {
            return await listShopCategoriesService(params.shopId);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    listBarcodes: async ({ params, set }: any) => {
        const pid = parseIntParam(params.productId, "product id", set);
        if (pid === null) return { detail: "Invalid product id" };
        try {
            return await listProductBarcodesService(params.shopId, pid);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    addBarcode: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "manager")) {
            return forbidden(set, "Insufficient role");
        }
        const pid = parseIntParam(params.productId, "product id", set);
        if (pid === null) return { detail: "Invalid product id" };
        try {
            set.status = 201;
            return await addProductBarcodeService({
                shopId: params.shopId,
                productId: pid,
                barcode: body.barcode,
                label: body.label ?? null,
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    deleteBarcode: async (ctx: any) => {
        const { params, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "manager")) {
            return forbidden(set, "Insufficient role");
        }
        const pid = parseIntParam(params.productId, "product id", set);
        const bid = parseIntParam(params.barcodeId, "barcode id", set);
        if (pid === null || bid === null) return { detail: "Invalid id" };
        try {
            await deleteProductBarcodeService({ shopId: params.shopId, productId: pid, barcodeId: bid });
            set.status = 204;
            return null;
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    listFifoLots: async ({ params, set }: any) => {
        const pid = parseIntParam(params.productId, "product id", set);
        if (pid === null) return { detail: "Invalid product id" };
        try {
            return await listFifoLotsService(params.shopId, pid);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    listMovements: async ({ params, query, set }: any) => {
        try {
            return await listShopMovementsService(params.shopId, {
                productId: query.product_id ? Number(query.product_id) : undefined,
                type: query.type ?? undefined,
                limit: query.limit ? Math.min(Math.max(Number(query.limit), 1), 1000) : undefined,
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    listAuditLogs: async ({ params, query, set }: any) => {
        try {
            return await listShopAuditLogsService(params.shopId, {
                action: query.action ?? undefined,
                limit: query.limit ? Math.min(Math.max(Number(query.limit), 1), 200) : undefined,
                offset: query.offset ? Math.max(Number(query.offset), 0) : undefined,
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    requisition: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        try {
            const shop = await getShopService(params.shopId);
            if (!shop) {
                set.status = 404;
                return { detail: "Shop not found" };
            }

            const reqRows = await db
                .select({ id: users.id, isActive: users.isActive })
                .from(users)
                .where(eq(users.id, body.requester_user_id))
                .limit(1);
            if (!reqRows[0]) {
                set.status = 404;
                return { detail: "Requester not found" };
            }
            if (!reqRows[0].isActive) {
                set.status = 400;
                return { detail: "Requester is not active" };
            }

            if (body.pay_mode === "department") {
                if (!body.payer_department_id) {
                    set.status = 422;
                    return { detail: "Department charge requires payer_department_id" };
                }
                if (!shop.allow_department_charge) {
                    set.status = 400;
                    return { detail: `Shop '${params.shopId}' does not accept department charges` };
                }
            }

            const items: Array<{
                product_variant_id: number;
                quantity: number;
                unit_price: number;
                discount: number;
                options: never[];
                price_override?: number;
            }> = [];

            for (const line of body.items) {
                const p = await db
                    .select()
                    .from(shopProducts)
                    .where(eq(shopProducts.id, line.product_id))
                    .limit(1);
                if (!p[0] || p[0].shopId !== params.shopId) {
                    set.status = 404;
                    return { detail: `Product ${line.product_id} not found in shop '${params.shopId}'` };
                }
                const internal = p[0].internalPrice != null ? Number(p[0].internalPrice) : null;
                const external = p[0].externalPrice != null ? Number(p[0].externalPrice) : 0;
                const unitPrice = internal ?? external;
                const item = {
                    product_variant_id: p[0].id,
                    quantity: line.qty,
                    unit_price: unitPrice,
                    discount: 0,
                    options: [] as never[],
                    ...(body.pay_mode === "free" ? { price_override: 0 } : {}),
                };
                items.push(item);
            }

            let paymentMethod: string;
            let payerKind: "user" | "department";
            let payerUserId: number | null;
            let payerDepartmentId: number | null;

            if (body.pay_mode === "free") {
                paymentMethod = "cash";
                payerKind = "user";
                payerUserId = null;
                payerDepartmentId = null;
            } else if (body.pay_mode === "department") {
                paymentMethod = "department";
                payerKind = "department";
                payerUserId = null;
                payerDepartmentId = body.payer_department_id ?? null;
            } else {
                paymentMethod = "wallet";
                payerKind = "user";
                payerUserId = body.requester_user_id;
                payerDepartmentId = null;
            }

            set.status = 201;
            return await checkout({
                transaction_mode: "INTERNAL_ISSUE",
                payment_method: paymentMethod,
                items,
                userId: Number(user.sub),
                customer_id: null,
                payer_kind: payerKind,
                payer_user_id: payerUserId,
                payer_department_id: payerDepartmentId,
                requester_user_id: body.requester_user_id,
                notes: body.notes ?? null,
                shop_id: params.shopId,
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    reorderProducts: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "manager")) {
            return forbidden(set, "Admin/manager only");
        }

        const shop = await db
            .select({ id: shopsTable.id, productsOrderVersion: shopsTable.productsOrderVersion })
            .from(shopsTable)
            .where(eq(shopsTable.id, params.shopId))
            .limit(1);
        if (!shop[0]) {
            set.status = 404;
            return { detail: "Shop not found" };
        }

        const currentVersion = shop[0].productsOrderVersion ?? 0;
        if (body.version !== currentVersion) {
            const products = await db
                .select({ id: shopProducts.id, sort_order: shopProducts.sortOrder, name: shopProducts.name })
                .from(shopProducts)
                .where(eq(shopProducts.shopId, params.shopId));
            products.sort(
                (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name),
            );
            set.status = 409;
            return {
                current_version: currentVersion,
                products: products.map((p) => ({ id: p.id, sort_order: p.sort_order, name: p.name })),
            };
        }

        const sortMap: Record<string, number> = body.sort_map;
        const productIds = Object.keys(sortMap)
            .map(Number)
            .filter((n) => !Number.isNaN(n));
        let updated = 0;
        for (const pid of productIds) {
            const newOrder = sortMap[String(pid)];
            const result = await db
                .update(shopProducts)
                .set({ sortOrder: newOrder })
                .where(eq(shopProducts.id, pid));
            if (result.count > 0) updated++;
        }

        const nextVersion = currentVersion + 1;
        await db
            .update(shopsTable)
            .set({ productsOrderVersion: nextVersion })
            .where(eq(shopsTable.id, params.shopId));

        await db
            .insert(productOrderHistory)
            .values({
                shopId: params.shopId,
                version: nextVersion,
                sortMap: sortMap as Record<string, number>,
                changedBy: Number(user.sub),
                source: body.source ?? "drag",
            })
            .catch(() => { });

        return { version: nextVersion, updated };
    },

    monthlyStockReport: async (ctx: any) => {
        const { params, query, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "manager")) return managerOrAdmin(set);
        const { start_date, end_date } = query;
        if (!start_date || !end_date || !DATE_RE.test(start_date) || !DATE_RE.test(end_date)) {
            set.status = 422;
            return { detail: "Invalid date range" };
        }
        try {
            return await getMonthlyStockReport(params.shopId, start_date, end_date);
        } catch (e) {
            console.error("[monthly-stock-report] error:", e);
            return handleServiceError(set)(e);
        }
    },

    exportMonthlyStockReport: async (ctx: any) => {
        const { params, query, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "manager")) return managerOrAdmin(set);
        const { start_date, end_date } = query;
        if (!start_date || !end_date || !DATE_RE.test(start_date) || !DATE_RE.test(end_date)) {
            set.status = 422;
            return { detail: "Invalid date range" };
        }
        try {
            const buffer = await exportMonthlyStockReport(params.shopId, start_date, end_date);
            return new Response(buffer, {
                headers: {
                    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    "Content-Disposition": `attachment; filename="stock-report-${start_date}-to-${end_date}.xlsx"`,
                },
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    listCloseMonth: async ({ params, user, set }: any) => {
        if (!hasRole(user.roles, "admin", "manager")) return managerOrAdmin(set);
        try {
            return await listCloses(params.shopId);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    createCloseMonth: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "manager")) return managerOrAdmin(set);
        try {
            set.status = 201;
            return await createClose(params.shopId, body.period_year, body.period_month);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    getCloseMonth: async ({ params, user, set }: any) => {
        if (!hasRole(user.roles, "admin", "manager")) return managerOrAdmin(set);
        const id = parseIntParam(params.closeId, "close id", set);
        if (id === null) return { detail: "Invalid close id" };
        try {
            const { error, close } = await assertCloseForShop(id, params.shopId, set);
            if (error) return error;
            return close!;
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    patchCloseMonthItems: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "manager")) return managerOrAdmin(set);
        const id = parseIntParam(params.closeId, "close id", set);
        if (id === null) return { detail: "Invalid close id" };
        try {
            const { error } = await assertCloseForShop(id, params.shopId, set);
            if (error) return error;
            await bulkUpdateItems(id, body.updates);
            return { ok: true };
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    importCloseMonthExcel: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "manager")) return managerOrAdmin(set);
        const id = parseIntParam(params.closeId, "close id", set);
        if (id === null) return { detail: "Invalid close id" };
        try {
            const { error } = await assertCloseForShop(id, params.shopId, set);
            if (error) return error;
            const buffer = await body.file.arrayBuffer();
            return await importExcel(id, buffer);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    exportCloseMonthExcel: async (ctx: any) => {
        const { params, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "manager")) return managerOrAdmin(set);
        const id = parseIntParam(params.closeId, "close id", set);
        if (id === null) return { detail: "Invalid close id" };
        try {
            const { error } = await assertCloseForShop(id, params.shopId, set);
            if (error) return error;
            const buffer = await exportExcel(id);
            return new Response(buffer, {
                headers: {
                    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    "Content-Disposition": `attachment; filename="close-${params.closeId}.xlsx"`,
                },
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    confirmCloseMonth: async (ctx: any) => {
        const { params, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "manager")) return managerOrAdmin(set);
        const id = parseIntParam(params.closeId, "close id", set);
        if (id === null) return { detail: "Invalid close id" };
        try {
            const { error } = await assertCloseForShop(id, params.shopId, set);
            if (error) return error;
            return await confirmClose(id, Number(user.sub));
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },
};
