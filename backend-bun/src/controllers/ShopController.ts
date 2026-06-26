/** Shops — CRUD, products, barcodes, requisition, close-month, stock reports (auth) */
import { authedCtx, type AuthedRequestContext } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users, shops as shopsTable, shopProducts, productOrderHistory } from "@/db/schema";
import { logger } from "@/logger";
import { hasRole } from "@/middleware/AuthMiddleware";
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
import { parseIntParam } from "@/utils/ControllerValidatorUtils";
import { errorFromService, errorResponse, successResponse } from "@/utils/ResponseUtil";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function assertCloseForShop(closeId: number, shopId: string, reqContext: AuthedRequestContext) {
	const close = await getClose(closeId);
	if (close.shop_id !== shopId) {
		return { error: errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN), close: null };
	}
	return { error: null, close };
}

export const ShopController = {
	list: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { query } = reqContext;
		const activeOnly = query.active_only !== "false";
		const module =
			query.module === "canteen" || query.module === "store" ? query.module : undefined;
		return successResponse(
			reqContext,
			await listShopsService({ activeOnly, module }),
			ResponseStatus.OK,
		);
	},

	create: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		if (!user.is_superuser) {
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		try {
			return successResponse(
				reqContext,
				await createShopService({
					...body,
					description: body.description ?? undefined,
					allow_department_charge: body.allow_department_charge ?? undefined,
					uses_dual_pricing: body.uses_dual_pricing ?? undefined,
					spending_group_id: body.spending_group_id ?? undefined,
				}),
				ResponseStatus.CREATED,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	listLowStock: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		try {
			return successResponse(reqContext, await listLowStockService(), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	get: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		const shop = await getShopService(params.shopId);
		if (!shop) return errorResponse(reqContext, "Shop not found", ResponseStatus.NOT_FOUND);
		return successResponse(reqContext, shop, ResponseStatus.OK);
	},

	update: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		if (!user.is_superuser) {
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		try {
			return successResponse(reqContext, await updateShopService(params.shopId, body), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	delete: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		if (!user.is_superuser) {
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		try {
			return successResponse(reqContext, await deleteShopService(params.shopId), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	updateVoidShortcuts: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		const isAdmin = user.is_superuser || hasRole(user.roles, "admin");
		const isManagerOfShop =
			hasRole(user.roles, "manager") && user.shop_id === params.shopId;
		if (!isAdmin && !isManagerOfShop) {
			return errorResponse(
				reqContext,
				"Only the shop's manager (or admin) can edit void shortcuts",
				ResponseStatus.FORBIDDEN,
			);
		}
		try {
			return successResponse(
				reqContext,
				await updateVoidShortcutsService(params.shopId, body.shortcuts),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	stats: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		try {
			return successResponse(reqContext, await shopStatsService(params.shopId), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	listProducts: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params, query } = reqContext;
		try {
			return successResponse(
				reqContext,
				await listShopProductsService(params.shopId, {
					search: query.search ?? undefined,
					category: query.category ?? undefined,
					includeInactive: query.include_inactive === "true",
				}),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	listCategories: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		try {
			return successResponse(reqContext, await listShopCategoriesService(params.shopId), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	listBarcodes: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		const pid = parseIntParam(params.productId, "product id", reqContext.set);
		if (pid === null) return errorResponse(reqContext, "Invalid product id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(reqContext, await listProductBarcodesService(params.shopId, pid), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	addBarcode: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		if (!hasRole(user.roles, "admin", "manager")) {
			return errorResponse(reqContext, "Insufficient role", ResponseStatus.FORBIDDEN);
		}
		const pid = parseIntParam(params.productId, "product id", reqContext.set);
		if (pid === null) return errorResponse(reqContext, "Invalid product id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(
				reqContext,
				await addProductBarcodeService({
					shopId: params.shopId,
					productId: pid,
					barcode: body.barcode,
					label: body.label ?? null,
				}),
				ResponseStatus.CREATED,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	deleteBarcode: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		if (!hasRole(user.roles, "admin", "manager")) {
			return errorResponse(reqContext, "Insufficient role", ResponseStatus.FORBIDDEN);
		}
		const pid = parseIntParam(params.productId, "product id", reqContext.set);
		const bid = parseIntParam(params.barcodeId, "barcode id", reqContext.set);
		if (pid === null || bid === null) {
			return errorResponse(reqContext, "Invalid id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			await deleteProductBarcodeService({ shopId: params.shopId, productId: pid, barcodeId: bid });
			return successResponse(reqContext, undefined, ResponseStatus.NO_CONTENT);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	listFifoLots: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		const pid = parseIntParam(params.productId, "product id", reqContext.set);
		if (pid === null) return errorResponse(reqContext, "Invalid product id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(reqContext, await listFifoLotsService(params.shopId, pid), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	listMovements: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params, query } = reqContext;
		try {
			return successResponse(
				reqContext,
				await listShopMovementsService(params.shopId, {
					productId: query.product_id ? Number(query.product_id) : undefined,
					type: query.type ?? undefined,
					limit: query.limit ? Math.min(Math.max(Number(query.limit), 1), 1000) : undefined,
				}),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	listAuditLogs: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params, query } = reqContext;
		try {
			return successResponse(
				reqContext,
				await listShopAuditLogsService(params.shopId, {
					action: query.action ?? undefined,
					limit: query.limit ? Math.min(Math.max(Number(query.limit), 1), 200) : undefined,
					offset: query.offset ? Math.max(Number(query.offset), 0) : undefined,
				}),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	requisition: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		try {
			const shop = await getShopService(params.shopId);
			if (!shop) return errorResponse(reqContext, "Shop not found", ResponseStatus.NOT_FOUND);

			const reqRows = await db
				.select({ id: users.id, isActive: users.isActive })
				.from(users)
				.where(eq(users.id, body.requester_user_id))
				.limit(1);
			if (!reqRows[0]) return errorResponse(reqContext, "Requester not found", ResponseStatus.NOT_FOUND);
			if (!reqRows[0].isActive) {
				return errorResponse(reqContext, "Requester is not active", ResponseStatus.BAD_REQUEST);
			}

			if (body.pay_mode === "department") {
				if (!body.payer_department_id) {
					return errorResponse(
						reqContext,
						"Department charge requires payer_department_id",
						ResponseStatus.UNPROCESSABLE,
					);
				}
				if (!shop.allow_department_charge) {
					return errorResponse(
						reqContext,
						`Shop '${params.shopId}' does not accept department charges`,
						ResponseStatus.BAD_REQUEST,
					);
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
					return errorResponse(
						reqContext,
						`Product ${line.product_id} not found in shop '${params.shopId}'`,
						ResponseStatus.NOT_FOUND,
					);
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

			return successResponse(
				reqContext,
				await checkout({
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
				}),
				ResponseStatus.CREATED,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	reorderProducts: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		if (!hasRole(user.roles, "admin", "manager")) {
			return errorResponse(reqContext, "Admin/manager only", ResponseStatus.FORBIDDEN);
		}

		const shop = await db
			.select({ id: shopsTable.id, productsOrderVersion: shopsTable.productsOrderVersion })
			.from(shopsTable)
			.where(eq(shopsTable.id, params.shopId))
			.limit(1);
		if (!shop[0]) return errorResponse(reqContext, "Shop not found", ResponseStatus.NOT_FOUND);

		const currentVersion = shop[0].productsOrderVersion ?? 0;
		if (body.version !== currentVersion) {
			const products = await db
				.select({ id: shopProducts.id, sort_order: shopProducts.sortOrder, name: shopProducts.name })
				.from(shopProducts)
				.where(eq(shopProducts.shopId, params.shopId));
			products.sort(
				(a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name),
			);
			return successResponse(
				reqContext,
				{
					current_version: currentVersion,
					products: products.map((p) => ({ id: p.id, sort_order: p.sort_order, name: p.name })),
				},
				ResponseStatus.CONFLICT,
			);
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
			.catch(() => {});

		return successResponse(reqContext, { version: nextVersion, updated }, ResponseStatus.OK);
	},

	monthlyStockReport: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, query } = reqContext;
		if (!hasRole(user.roles, "admin", "manager")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const { start_date, end_date } = query;
		if (!start_date || !end_date || !DATE_RE.test(start_date) || !DATE_RE.test(end_date)) {
			return errorResponse(reqContext, "Invalid date range", ResponseStatus.UNPROCESSABLE);
		}
		try {
			return successResponse(
				reqContext,
				await getMonthlyStockReport(params.shopId, start_date, end_date),
				ResponseStatus.OK,
			);
		} catch (e) {
			logger.error("[monthly-stock-report] error:", e);
			return errorFromService(reqContext, e);
		}
	},

	exportMonthlyStockReport: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, query } = reqContext;
		if (!hasRole(user.roles, "admin", "manager")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const { start_date, end_date } = query;
		if (!start_date || !end_date || !DATE_RE.test(start_date) || !DATE_RE.test(end_date)) {
			return errorResponse(reqContext, "Invalid date range", ResponseStatus.UNPROCESSABLE);
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
			return errorFromService(reqContext, e);
		}
	},

	listCloseMonth: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		if (!hasRole(user.roles, "admin", "manager")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			return successResponse(reqContext, await listCloses(params.shopId), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	createCloseMonth: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		if (!hasRole(user.roles, "admin", "manager")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			return successResponse(
				reqContext,
				await createClose(params.shopId, body.period_year, body.period_month),
				ResponseStatus.CREATED,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	getCloseMonth: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		if (!hasRole(user.roles, "admin", "manager")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.closeId, "close id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid close id", ResponseStatus.UNPROCESSABLE);
		try {
			const { error, close } = await assertCloseForShop(id, params.shopId, reqContext);
			if (error) return error;
			return successResponse(reqContext, close!, ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	patchCloseMonthItems: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		if (!hasRole(user.roles, "admin", "manager")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.closeId, "close id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid close id", ResponseStatus.UNPROCESSABLE);
		try {
			const { error } = await assertCloseForShop(id, params.shopId, reqContext);
			if (error) return error;
			await bulkUpdateItems(id, body.updates);
			return successResponse(reqContext, { ok: true }, ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	importCloseMonthExcel: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		if (!hasRole(user.roles, "admin", "manager")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.closeId, "close id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid close id", ResponseStatus.UNPROCESSABLE);
		try {
			const { error } = await assertCloseForShop(id, params.shopId, reqContext);
			if (error) return error;
			const buffer = await body.file.arrayBuffer();
			return successResponse(reqContext, await importExcel(id, buffer), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	exportCloseMonthExcel: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		if (!hasRole(user.roles, "admin", "manager")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.closeId, "close id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid close id", ResponseStatus.UNPROCESSABLE);
		try {
			const { error } = await assertCloseForShop(id, params.shopId, reqContext);
			if (error) return error;
			const buffer = await exportExcel(id);
			return new Response(buffer, {
				headers: {
					"Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
					"Content-Disposition": `attachment; filename="close-${params.closeId}.xlsx"`,
				},
			});
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	confirmCloseMonth: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		if (!hasRole(user.roles, "admin", "manager")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.closeId, "close id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid close id", ResponseStatus.UNPROCESSABLE);
		try {
			const { error } = await assertCloseForShop(id, params.shopId, reqContext);
			if (error) return error;
			return successResponse(reqContext, await confirmClose(id, Number(user.sub)), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},
};
