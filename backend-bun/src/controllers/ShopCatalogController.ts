/** Shop catalog — bundles, price panels, products, stock, categories (auth; write: admin | manager) */
import { authedCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import { hasRole } from "@/middleware/AuthMiddleware";
import {
	listBundles,
	getBundle,
	checkBundleStock,
	createBundle,
	updateBundle,
	deleteBundle,
	reorderBundles,
} from "@/services/bundle_service";
import {
	createShopProduct,
	updateShopProduct,
	deleteShopProduct,
	receiveStock,
	adjustStock,
	createShopCategory,
	updateShopCategory,
	deleteShopCategory,
} from "@/services/shop_product_service";
import {
	listPanels,
	createPanel,
	updatePanel,
	deletePanel,
	getPanelItems,
	setItemPrice,
	setBundleItemPrice,
} from "@/services/price_panel_service";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";
import { errorFromService, errorResponse, successResponse } from "@/utils/ResponseUtil";

export const ShopCatalogController = {
	listBundles: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params, query } = reqContext;
		try {
			return successResponse(
				reqContext,
				await listBundles(params.shopId, query.include_inactive === "true"),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	getBundle: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		const id = parseIntParam(params.bundleId, "bundle id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid bundle id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(reqContext, await getBundle(params.shopId, id), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	createBundle: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		if (!hasRole(user.roles, "admin", "manager")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			return successResponse(
				reqContext,
				await createBundle(params.shopId, body as Parameters<typeof createBundle>[1]),
				ResponseStatus.CREATED,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	updateBundle: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		if (!hasRole(user.roles, "admin", "manager")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.bundleId, "bundle id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid bundle id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(reqContext, await updateBundle(params.shopId, id, body), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	deleteBundle: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		if (!hasRole(user.roles, "admin", "manager")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.bundleId, "bundle id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid bundle id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(reqContext, await deleteBundle(params.shopId, id), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	reorderBundles: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		if (!hasRole(user.roles, "admin", "manager", "cashier")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			return successResponse(reqContext, await reorderBundles(params.shopId, body.sort_map), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	checkBundleStock: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		const id = parseIntParam(params.bundleId, "bundle id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid bundle id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(reqContext, await checkBundleStock(params.shopId, id), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	listPricePanels: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		try {
			return successResponse(reqContext, await listPanels(params.shopId), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	createPricePanel: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		if (!hasRole(user.roles, "admin", "manager")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			return successResponse(
				reqContext,
				await createPanel(params.shopId, body.name, body.color ?? null),
				ResponseStatus.CREATED,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	updatePricePanel: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		if (!hasRole(user.roles, "admin", "manager")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.panelId, "panel id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid panel id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(reqContext, await updatePanel(params.shopId, id, body), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	deletePricePanel: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		if (!hasRole(user.roles, "admin", "manager")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.panelId, "panel id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid panel id", ResponseStatus.UNPROCESSABLE);
		try {
			await deletePanel(params.shopId, id);
			return successResponse(reqContext, undefined, ResponseStatus.NO_CONTENT);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	getPricePanelItems: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		const id = parseIntParam(params.panelId, "panel id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid panel id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(reqContext, await getPanelItems(params.shopId, id), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	setPricePanelItemPrice: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		if (!hasRole(user.roles, "admin", "manager", "cashier")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const panelId = parseIntParam(params.panelId, "panel id", reqContext.set);
		const productId = parseIntParam(params.productId, "product id", reqContext.set);
		if (panelId === null || productId === null) {
			return errorResponse(reqContext, "Invalid id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			return successResponse(
				reqContext,
				await setItemPrice(params.shopId, panelId, productId, body),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	setPricePanelBundleItemPrice: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		if (!hasRole(user.roles, "admin", "manager", "cashier")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const panelId = parseIntParam(params.panelId, "panel id", reqContext.set);
		const bundleId = parseIntParam(params.bundleId, "bundle id", reqContext.set);
		if (panelId === null || bundleId === null) {
			return errorResponse(reqContext, "Invalid id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			return successResponse(
				reqContext,
				await setBundleItemPrice(params.shopId, panelId, bundleId, body),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	createProduct: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		if (!hasRole(user.roles, "admin", "manager")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			return successResponse(
				reqContext,
				await createShopProduct(
					params.shopId,
					body as Parameters<typeof createShopProduct>[1],
					Number(user.sub),
				),
				ResponseStatus.CREATED,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	updateProduct: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		const id = parseIntParam(params.productId, "product id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid product id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(reqContext, await updateShopProduct(user, params.shopId, id, body), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	deleteProduct: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		if (!hasRole(user.roles, "admin", "manager")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.productId, "product id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid product id", ResponseStatus.UNPROCESSABLE);
		try {
			await deleteShopProduct(user, params.shopId, id);
			return successResponse(reqContext, undefined, ResponseStatus.NO_CONTENT);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	receiveStock: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		if (!hasRole(user.roles, "admin", "manager")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			return successResponse(
				reqContext,
				await receiveStock({
					shopId: params.shopId,
					items: body.items as Parameters<typeof receiveStock>[0]["items"],
					userId: Number(user.sub),
				}),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	adjustStock: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		if (!hasRole(user.roles, "admin", "manager")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			return successResponse(
				reqContext,
				await adjustStock({
					shopId: params.shopId,
					productId: body.product_id,
					delta: body.delta,
					reason: body.reason,
					costPerUnit: body.cost_per_unit ?? null,
					userId: Number(user.sub),
				}),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	createCategory: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		if (!hasRole(user.roles, "admin", "manager")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			return successResponse(
				reqContext,
				await createShopCategory(params.shopId, body.name),
				ResponseStatus.CREATED,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	updateCategory: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		if (!hasRole(user.roles, "admin", "manager")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			return successResponse(
				reqContext,
				await updateShopCategory(params.shopId, params.categoryId, body.name),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	deleteCategory: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		if (!hasRole(user.roles, "admin", "manager")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			await deleteShopCategory(params.shopId, params.categoryId);
			return successResponse(reqContext, undefined, ResponseStatus.NO_CONTENT);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},
};
