/** Shops — CRUD, products, barcodes, requisition, balance-file, close-month, stock reports (auth) */
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
	listGroupsForShop,
	setGroupsForShop,
} from "@/services/spending_group_service";
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
import { getBalanceFile, exportBalanceFile } from "@/services/balance_file_service";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";
import { errorFromService, errorResponse, successResponse } from "@/utils/ResponseUtil";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type BalanceFileQuery = {
	year?: string | null;
	month?: string | null;
	product_id?: string | null;
};

function parseBalanceFileQuery(
	reqContext: AuthedRequestContext,
	query: BalanceFileQuery,
):
	| { error: ReturnType<typeof errorResponse> }
	| { year: number; month: number | null; productId: number | null } {
	const year = Number(query.year);
	const month = query.month ? Number(query.month) : null;
	const productId = query.product_id ? Number(query.product_id) : null;
	if (!Number.isInteger(year) || year < 2000 || year > 2999) {
		return { error: errorResponse(reqContext, "Invalid year", ResponseStatus.UNPROCESSABLE) };
	}
	if (month !== null && (!Number.isInteger(month) || month < 1 || month > 12)) {
		return { error: errorResponse(reqContext, "Invalid month (1-12)", ResponseStatus.UNPROCESSABLE) };
	}
	return { year, month, productId };
}

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
		logger.info(`[${reqContext.requestId} (SH-01)] ShopController.list() called.`);
		try {
			logger.info(`[${reqContext.requestId} (SH-01)] ShopController.list() calling listShopsService().`);
			const activeOnly = query.active_only !== "false";
			const module =
				query.module === "canteen" || query.module === "store" ? query.module : undefined;
			const result = await listShopsService({ activeOnly, module });
			logger.info(`[${reqContext.requestId} (SH-01)] ShopController.list() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SH-01)] ShopController.list() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	create: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		logger.info(`[${reqContext.requestId} (SH-02)] ShopController.create() called.`);
		if (!user.is_superuser) {
			logger.warn(`[${reqContext.requestId} (SH-02)] ShopController.create() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (SH-02)] ShopController.create() calling createShopService().`);
			const result = await createShopService({
				...body,
				description: body.description ?? undefined,
				allow_department_charge: body.allow_department_charge ?? undefined,
				uses_dual_pricing: body.uses_dual_pricing ?? undefined,
				shop_number: body.shop_number ?? undefined,
			});
			logger.info(`[${reqContext.requestId} (SH-02)] ShopController.create() completed.`);
			return successResponse(reqContext, result, ResponseStatus.CREATED);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SH-02)] ShopController.create() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	listLowStock: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		logger.info(`[${reqContext.requestId} (SH-03)] ShopController.listLowStock() called.`);
		try {
			logger.info(`[${reqContext.requestId} (SH-03)] ShopController.listLowStock() calling listLowStockService().`);
			const result = await listLowStockService();
			logger.info(`[${reqContext.requestId} (SH-03)] ShopController.listLowStock() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SH-03)] ShopController.listLowStock() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	get: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (SH-04)] ShopController.get() called.`);
		try {
			logger.info(`[${reqContext.requestId} (SH-04)] ShopController.get() calling getShopService().`);
			const shop = await getShopService(params.shopId);
			if (!shop) return errorResponse(reqContext, "Shop not found", ResponseStatus.NOT_FOUND);
			logger.info(`[${reqContext.requestId} (SH-04)] ShopController.get() completed.`);
			return successResponse(reqContext, shop, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SH-04)] ShopController.get() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	update: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (SH-05)] ShopController.update() called.`);
		if (!user.is_superuser) {
			logger.warn(`[${reqContext.requestId} (SH-05)] ShopController.update() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (SH-05)] ShopController.update() calling updateShopService().`);
			const result = await updateShopService(params.shopId, body);
			logger.info(`[${reqContext.requestId} (SH-05)] ShopController.update() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SH-05)] ShopController.update() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	delete: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (SH-06)] ShopController.delete() called.`);
		if (!user.is_superuser) {
			logger.warn(`[${reqContext.requestId} (SH-06)] ShopController.delete() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (SH-06)] ShopController.delete() calling deleteShopService().`);
			const result = await deleteShopService(params.shopId);
			logger.info(`[${reqContext.requestId} (SH-06)] ShopController.delete() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SH-06)] ShopController.delete() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	updateVoidShortcuts: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (SH-07)] ShopController.updateVoidShortcuts() called.`);
		const isAdmin = user.is_superuser || hasRole(user.roles, "admin");
		const isManagerOfShop =
			hasRole(user.roles, "manager") && user.shop_id === params.shopId;
		if (!isAdmin && !isManagerOfShop) {
			logger.warn(`[${reqContext.requestId} (SH-07)] ShopController.updateVoidShortcuts() forbidden.`);
			return errorResponse(
				reqContext,
				"Only the shop's manager (or admin) can edit void shortcuts",
				ResponseStatus.FORBIDDEN,
			);
		}
		try {
			logger.info(`[${reqContext.requestId} (SH-07)] ShopController.updateVoidShortcuts() calling updateVoidShortcutsService().`);
			const result = await updateVoidShortcutsService(params.shopId, body.shortcuts);
			logger.info(`[${reqContext.requestId} (SH-07)] ShopController.updateVoidShortcuts() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SH-07)] ShopController.updateVoidShortcuts() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	listSpendingGroups: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (SH-30)] ShopController.listSpendingGroups() called.`);
		try {
			logger.info(`[${reqContext.requestId} (SH-30)] ShopController.listSpendingGroups() calling listGroupsForShop().`);
			const result = await listGroupsForShop(params.shopId);
			logger.info(`[${reqContext.requestId} (SH-30)] ShopController.listSpendingGroups() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SH-30)] ShopController.listSpendingGroups() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	setSpendingGroups: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (SH-31)] ShopController.setSpendingGroups() called.`);
		if (!user.is_superuser && !hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (SH-31)] ShopController.setSpendingGroups() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (SH-31)] ShopController.setSpendingGroups() calling setGroupsForShop().`);
			const result = await setGroupsForShop(params.shopId, body.spending_group_ids);
			logger.info(`[${reqContext.requestId} (SH-31)] ShopController.setSpendingGroups() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SH-31)] ShopController.setSpendingGroups() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	stats: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (SH-08)] ShopController.stats() called.`);
		try {
			logger.info(`[${reqContext.requestId} (SH-08)] ShopController.stats() calling shopStatsService().`);
			const result = await shopStatsService(params.shopId);
			logger.info(`[${reqContext.requestId} (SH-08)] ShopController.stats() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SH-08)] ShopController.stats() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	listProducts: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params, query } = reqContext;
		logger.info(`[${reqContext.requestId} (SH-09)] ShopController.listProducts() called.`);
		try {
			logger.info(`[${reqContext.requestId} (SH-09)] ShopController.listProducts() calling listShopProductsService().`);
			const result = await listShopProductsService(params.shopId, {
				search: query.search ?? undefined,
				category: query.category ?? undefined,
				includeInactive: query.include_inactive === "true",
			});
			logger.info(`[${reqContext.requestId} (SH-09)] ShopController.listProducts() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SH-09)] ShopController.listProducts() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	listCategories: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (SH-10)] ShopController.listCategories() called.`);
		try {
			logger.info(`[${reqContext.requestId} (SH-10)] ShopController.listCategories() calling listShopCategoriesService().`);
			const result = await listShopCategoriesService(params.shopId);
			logger.info(`[${reqContext.requestId} (SH-10)] ShopController.listCategories() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SH-10)] ShopController.listCategories() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	listBarcodes: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (SH-11)] ShopController.listBarcodes() called.`);
		const pid = parseIntParam(params.productId, "product id", reqContext.set);
		if (pid === null) return errorResponse(reqContext, "Invalid product id", ResponseStatus.UNPROCESSABLE);
		try {
			logger.info(`[${reqContext.requestId} (SH-11)] ShopController.listBarcodes() calling listProductBarcodesService().`);
			const result = await listProductBarcodesService(params.shopId, pid);
			logger.info(`[${reqContext.requestId} (SH-11)] ShopController.listBarcodes() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SH-11)] ShopController.listBarcodes() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	addBarcode: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (SH-12)] ShopController.addBarcode() called.`);
		if (!hasRole(user.roles, "admin", "manager")) {
			logger.warn(`[${reqContext.requestId} (SH-12)] ShopController.addBarcode() forbidden.`);
			return errorResponse(reqContext, "Insufficient role", ResponseStatus.FORBIDDEN);
		}
		const pid = parseIntParam(params.productId, "product id", reqContext.set);
		if (pid === null) return errorResponse(reqContext, "Invalid product id", ResponseStatus.UNPROCESSABLE);
		try {
			logger.info(`[${reqContext.requestId} (SH-12)] ShopController.addBarcode() calling addProductBarcodeService().`);
			const result = await addProductBarcodeService({
				shopId: params.shopId,
				productId: pid,
				barcode: body.barcode,
				label: body.label ?? null,
			});
			logger.info(`[${reqContext.requestId} (SH-12)] ShopController.addBarcode() completed.`);
			return successResponse(reqContext, result, ResponseStatus.CREATED);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SH-12)] ShopController.addBarcode() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	deleteBarcode: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (SH-13)] ShopController.deleteBarcode() called.`);
		if (!hasRole(user.roles, "admin", "manager")) {
			logger.warn(`[${reqContext.requestId} (SH-13)] ShopController.deleteBarcode() forbidden.`);
			return errorResponse(reqContext, "Insufficient role", ResponseStatus.FORBIDDEN);
		}
		const pid = parseIntParam(params.productId, "product id", reqContext.set);
		const bid = parseIntParam(params.barcodeId, "barcode id", reqContext.set);
		if (pid === null || bid === null) {
			return errorResponse(reqContext, "Invalid id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (SH-13)] ShopController.deleteBarcode() calling deleteProductBarcodeService().`);
			await deleteProductBarcodeService({ shopId: params.shopId, productId: pid, barcodeId: bid });
			logger.info(`[${reqContext.requestId} (SH-13)] ShopController.deleteBarcode() completed.`);
			return successResponse(reqContext, undefined, ResponseStatus.NO_CONTENT);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SH-13)] ShopController.deleteBarcode() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	listFifoLots: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (SH-14)] ShopController.listFifoLots() called.`);
		const pid = parseIntParam(params.productId, "product id", reqContext.set);
		if (pid === null) return errorResponse(reqContext, "Invalid product id", ResponseStatus.UNPROCESSABLE);
		try {
			logger.info(`[${reqContext.requestId} (SH-14)] ShopController.listFifoLots() calling listFifoLotsService().`);
			const result = await listFifoLotsService(params.shopId, pid);
			logger.info(`[${reqContext.requestId} (SH-14)] ShopController.listFifoLots() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SH-14)] ShopController.listFifoLots() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	listMovements: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params, query } = reqContext;
		logger.info(`[${reqContext.requestId} (SH-15)] ShopController.listMovements() called.`);
		try {
			logger.info(`[${reqContext.requestId} (SH-15)] ShopController.listMovements() calling listShopMovementsService().`);
			const result = await listShopMovementsService(params.shopId, {
				productId: query.product_id ? Number(query.product_id) : undefined,
				type: query.type ?? undefined,
				limit: query.limit ? Math.min(Math.max(Number(query.limit), 1), 1000) : undefined,
			});
			logger.info(`[${reqContext.requestId} (SH-15)] ShopController.listMovements() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SH-15)] ShopController.listMovements() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	listAuditLogs: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params, query } = reqContext;
		logger.info(`[${reqContext.requestId} (SH-16)] ShopController.listAuditLogs() called.`);
		try {
			logger.info(`[${reqContext.requestId} (SH-16)] ShopController.listAuditLogs() calling listShopAuditLogsService().`);
			const result = await listShopAuditLogsService(params.shopId, {
				action: query.action ?? undefined,
				limit: query.limit ? Math.min(Math.max(Number(query.limit), 1), 200) : undefined,
				offset: query.offset ? Math.max(Number(query.offset), 0) : undefined,
			});
			logger.info(`[${reqContext.requestId} (SH-16)] ShopController.listAuditLogs() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SH-16)] ShopController.listAuditLogs() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	requisition: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (SH-17)] ShopController.requisition() called.`);
		try {
			logger.info(`[${reqContext.requestId} (SH-17)] ShopController.requisition() calling getShopService().`);
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
				// Department budget charges are allowed at every shop — no
				// per-shop opt-in flag anymore (previously gated on
				// shop.allow_department_charge).
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

			logger.info(`[${reqContext.requestId} (SH-17)] ShopController.requisition() calling checkout().`);
			const result = await checkout({
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
			logger.info(`[${reqContext.requestId} (SH-17)] ShopController.requisition() completed.`);
			return successResponse(reqContext, result, ResponseStatus.CREATED);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SH-17)] ShopController.requisition() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	reorderProducts: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (SH-18)] ShopController.reorderProducts() called.`);
		if (!hasRole(user.roles, "admin", "manager")) {
			logger.warn(`[${reqContext.requestId} (SH-18)] ShopController.reorderProducts() forbidden.`);
			return errorResponse(reqContext, "Admin/manager only", ResponseStatus.FORBIDDEN);
		}
		try {
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
				.catch((e) => {
					logger.warn(`[${reqContext.requestId} (SH-18)] ShopController.reorderProducts() failed to record product_order_history (non-fatal):`, e);
				});

			logger.info(`[${reqContext.requestId} (SH-18)] ShopController.reorderProducts() completed.`);
			return successResponse(reqContext, { version: nextVersion, updated }, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SH-18)] ShopController.reorderProducts() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	monthlyStockReport: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, query } = reqContext;
		logger.info(`[${reqContext.requestId} (SH-19)] ShopController.monthlyStockReport() called.`);
		if (!hasRole(user.roles, "admin", "manager")) {
			logger.warn(`[${reqContext.requestId} (SH-19)] ShopController.monthlyStockReport() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const { start_date, end_date } = query;
		if (!start_date || !end_date || !DATE_RE.test(start_date) || !DATE_RE.test(end_date)) {
			return errorResponse(reqContext, "Invalid date range", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (SH-19)] ShopController.monthlyStockReport() calling getMonthlyStockReport().`);
			const result = await getMonthlyStockReport(params.shopId, start_date, end_date);
			logger.info(`[${reqContext.requestId} (SH-19)] ShopController.monthlyStockReport() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SH-19)] ShopController.monthlyStockReport() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	exportMonthlyStockReport: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, query } = reqContext;
		logger.info(`[${reqContext.requestId} (SH-20)] ShopController.exportMonthlyStockReport() called.`);
		if (!hasRole(user.roles, "admin", "manager")) {
			logger.warn(`[${reqContext.requestId} (SH-20)] ShopController.exportMonthlyStockReport() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const { start_date, end_date } = query;
		if (!start_date || !end_date || !DATE_RE.test(start_date) || !DATE_RE.test(end_date)) {
			return errorResponse(reqContext, "Invalid date range", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (SH-20)] ShopController.exportMonthlyStockReport() calling exportMonthlyStockReport().`);
			const buffer = await exportMonthlyStockReport(params.shopId, start_date, end_date);
			logger.info(`[${reqContext.requestId} (SH-20)] ShopController.exportMonthlyStockReport() completed.`);
			return new Response(buffer, {
				headers: {
					"Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
					"Content-Disposition": `attachment; filename="stock-report-${start_date}-to-${end_date}.xlsx"`,
				},
			});
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SH-20)] ShopController.exportMonthlyStockReport() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	balanceFile: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, query } = reqContext;
		logger.info(`[${reqContext.requestId} (SH-28)] ShopController.balanceFile() called.`);
		if (!hasRole(user.roles, "admin", "manager")) {
			logger.warn(`[${reqContext.requestId} (SH-28)] ShopController.balanceFile() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const parsed = parseBalanceFileQuery(reqContext, query);
		if ("error" in parsed) return parsed.error;
		const { year, month, productId } = parsed;
		try {
			logger.info(`[${reqContext.requestId} (SH-28)] ShopController.balanceFile() calling getBalanceFile().`);
			const result = await getBalanceFile(params.shopId, year, month, productId);
			logger.info(`[${reqContext.requestId} (SH-28)] ShopController.balanceFile() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SH-28)] ShopController.balanceFile() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	exportBalanceFile: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, query } = reqContext;
		logger.info(`[${reqContext.requestId} (SH-29)] ShopController.exportBalanceFile() called.`);
		if (!hasRole(user.roles, "admin", "manager")) {
			logger.warn(`[${reqContext.requestId} (SH-29)] ShopController.exportBalanceFile() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const parsed = parseBalanceFileQuery(reqContext, query);
		if ("error" in parsed) return parsed.error;
		const { year, month, productId } = parsed;
		try {
			logger.info(`[${reqContext.requestId} (SH-29)] ShopController.exportBalanceFile() calling exportBalanceFile().`);
			const buffer = await exportBalanceFile(params.shopId, year, month, productId);
			const suffix = month !== null ? `-${String(month).padStart(2, "0")}` : "";
			logger.info(`[${reqContext.requestId} (SH-29)] ShopController.exportBalanceFile() completed.`);
			return new Response(buffer, {
				headers: {
					"Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
					"Content-Disposition": `attachment; filename="balance-file-${year}${suffix}.xlsx"`,
				},
			});
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SH-29)] ShopController.exportBalanceFile() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	listCloseMonth: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (SH-21)] ShopController.listCloseMonth() called.`);
		if (!hasRole(user.roles, "admin", "manager")) {
			logger.warn(`[${reqContext.requestId} (SH-21)] ShopController.listCloseMonth() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (SH-21)] ShopController.listCloseMonth() calling listCloses().`);
			const result = await listCloses(params.shopId);
			logger.info(`[${reqContext.requestId} (SH-21)] ShopController.listCloseMonth() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SH-21)] ShopController.listCloseMonth() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	createCloseMonth: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (SH-22)] ShopController.createCloseMonth() called.`);
		if (!hasRole(user.roles, "admin", "manager")) {
			logger.warn(`[${reqContext.requestId} (SH-22)] ShopController.createCloseMonth() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (SH-22)] ShopController.createCloseMonth() calling createClose().`);
			const result = await createClose(params.shopId, body.period_year, body.period_month);
			logger.info(`[${reqContext.requestId} (SH-22)] ShopController.createCloseMonth() completed.`);
			return successResponse(reqContext, result, ResponseStatus.CREATED);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SH-22)] ShopController.createCloseMonth() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	getCloseMonth: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (SH-23)] ShopController.getCloseMonth() called.`);
		if (!hasRole(user.roles, "admin", "manager")) {
			logger.warn(`[${reqContext.requestId} (SH-23)] ShopController.getCloseMonth() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.closeId, "close id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid close id", ResponseStatus.UNPROCESSABLE);
		try {
			logger.info(`[${reqContext.requestId} (SH-23)] ShopController.getCloseMonth() calling getClose().`);
			const { error, close } = await assertCloseForShop(id, params.shopId, reqContext);
			if (error) return error;
			logger.info(`[${reqContext.requestId} (SH-23)] ShopController.getCloseMonth() completed.`);
			return successResponse(reqContext, close!, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SH-23)] ShopController.getCloseMonth() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	patchCloseMonthItems: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (SH-24)] ShopController.patchCloseMonthItems() called.`);
		if (!hasRole(user.roles, "admin", "manager")) {
			logger.warn(`[${reqContext.requestId} (SH-24)] ShopController.patchCloseMonthItems() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.closeId, "close id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid close id", ResponseStatus.UNPROCESSABLE);
		try {
			const { error } = await assertCloseForShop(id, params.shopId, reqContext);
			if (error) return error;
			logger.info(`[${reqContext.requestId} (SH-24)] ShopController.patchCloseMonthItems() calling bulkUpdateItems().`);
			await bulkUpdateItems(id, body.updates);
			logger.info(`[${reqContext.requestId} (SH-24)] ShopController.patchCloseMonthItems() completed.`);
			return successResponse(reqContext, { ok: true }, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SH-24)] ShopController.patchCloseMonthItems() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	importCloseMonthExcel: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (SH-25)] ShopController.importCloseMonthExcel() called.`);
		if (!hasRole(user.roles, "admin", "manager")) {
			logger.warn(`[${reqContext.requestId} (SH-25)] ShopController.importCloseMonthExcel() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.closeId, "close id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid close id", ResponseStatus.UNPROCESSABLE);
		try {
			const { error } = await assertCloseForShop(id, params.shopId, reqContext);
			if (error) return error;
			logger.info(`[${reqContext.requestId} (SH-25)] ShopController.importCloseMonthExcel() calling importExcel().`);
			const buffer = await body.file.arrayBuffer();
			const result = await importExcel(id, buffer);
			logger.info(`[${reqContext.requestId} (SH-25)] ShopController.importCloseMonthExcel() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SH-25)] ShopController.importCloseMonthExcel() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	exportCloseMonthExcel: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (SH-26)] ShopController.exportCloseMonthExcel() called.`);
		if (!hasRole(user.roles, "admin", "manager")) {
			logger.warn(`[${reqContext.requestId} (SH-26)] ShopController.exportCloseMonthExcel() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.closeId, "close id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid close id", ResponseStatus.UNPROCESSABLE);
		try {
			const { error } = await assertCloseForShop(id, params.shopId, reqContext);
			if (error) return error;
			logger.info(`[${reqContext.requestId} (SH-26)] ShopController.exportCloseMonthExcel() calling exportExcel().`);
			const buffer = await exportExcel(id);
			logger.info(`[${reqContext.requestId} (SH-26)] ShopController.exportCloseMonthExcel() completed.`);
			return new Response(buffer, {
				headers: {
					"Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
					"Content-Disposition": `attachment; filename="close-${params.closeId}.xlsx"`,
				},
			});
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SH-26)] ShopController.exportCloseMonthExcel() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	confirmCloseMonth: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (SH-27)] ShopController.confirmCloseMonth() called.`);
		if (!hasRole(user.roles, "admin", "manager")) {
			logger.warn(`[${reqContext.requestId} (SH-27)] ShopController.confirmCloseMonth() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.closeId, "close id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid close id", ResponseStatus.UNPROCESSABLE);
		try {
			const { error } = await assertCloseForShop(id, params.shopId, reqContext);
			if (error) return error;
			logger.info(`[${reqContext.requestId} (SH-27)] ShopController.confirmCloseMonth() calling confirmClose().`);
			const result = await confirmClose(id, Number(user.sub));
			logger.info(`[${reqContext.requestId} (SH-27)] ShopController.confirmCloseMonth() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SH-27)] ShopController.confirmCloseMonth() error:`, e);
			return errorFromService(reqContext, e);
		}
	},
};
