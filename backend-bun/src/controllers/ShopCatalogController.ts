/** Shop catalog — bundles, price panels, products, stock, categories (auth; write: admin | manager) */
import { authedCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import { logger } from "@/logger";
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
		logger.info(`[${reqContext.requestId} (SC-01)] ShopCatalogController.listBundles() called.`);
		try {
			logger.info(`[${reqContext.requestId} (SC-01)] ShopCatalogController.listBundles() calling listBundles().`);
			const result = await listBundles(params.shopId, query.include_inactive === "true");
			logger.info(`[${reqContext.requestId} (SC-01)] ShopCatalogController.listBundles() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SC-01)] ShopCatalogController.listBundles() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	getBundle: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (SC-02)] ShopCatalogController.getBundle() called.`);
		const id = parseIntParam(params.bundleId, "bundle id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid bundle id", ResponseStatus.UNPROCESSABLE);
		try {
			logger.info(`[${reqContext.requestId} (SC-02)] ShopCatalogController.getBundle() calling getBundle().`);
			const result = await getBundle(params.shopId, id);
			logger.info(`[${reqContext.requestId} (SC-02)] ShopCatalogController.getBundle() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SC-02)] ShopCatalogController.getBundle() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	createBundle: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (SC-03)] ShopCatalogController.createBundle() called.`);
		if (!hasRole(user.roles, "admin", "manager")) {
			logger.warn(`[${reqContext.requestId} (SC-03)] ShopCatalogController.createBundle() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (SC-03)] ShopCatalogController.createBundle() calling createBundle().`);
			const result = await createBundle(params.shopId, body as Parameters<typeof createBundle>[1]);
			logger.info(`[${reqContext.requestId} (SC-03)] ShopCatalogController.createBundle() completed.`);
			return successResponse(reqContext, result, ResponseStatus.CREATED);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SC-03)] ShopCatalogController.createBundle() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	updateBundle: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (SC-04)] ShopCatalogController.updateBundle() called.`);
		if (!hasRole(user.roles, "admin", "manager")) {
			logger.warn(`[${reqContext.requestId} (SC-04)] ShopCatalogController.updateBundle() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.bundleId, "bundle id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid bundle id", ResponseStatus.UNPROCESSABLE);
		try {
			logger.info(`[${reqContext.requestId} (SC-04)] ShopCatalogController.updateBundle() calling updateBundle().`);
			const result = await updateBundle(params.shopId, id, body);
			logger.info(`[${reqContext.requestId} (SC-04)] ShopCatalogController.updateBundle() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SC-04)] ShopCatalogController.updateBundle() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	deleteBundle: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (SC-05)] ShopCatalogController.deleteBundle() called.`);
		if (!hasRole(user.roles, "admin", "manager")) {
			logger.warn(`[${reqContext.requestId} (SC-05)] ShopCatalogController.deleteBundle() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.bundleId, "bundle id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid bundle id", ResponseStatus.UNPROCESSABLE);
		try {
			logger.info(`[${reqContext.requestId} (SC-05)] ShopCatalogController.deleteBundle() calling deleteBundle().`);
			const result = await deleteBundle(params.shopId, id);
			logger.info(`[${reqContext.requestId} (SC-05)] ShopCatalogController.deleteBundle() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SC-05)] ShopCatalogController.deleteBundle() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	reorderBundles: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (SC-06)] ShopCatalogController.reorderBundles() called.`);
		if (!hasRole(user.roles, "admin", "manager", "cashier")) {
			logger.warn(`[${reqContext.requestId} (SC-06)] ShopCatalogController.reorderBundles() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (SC-06)] ShopCatalogController.reorderBundles() calling reorderBundles().`);
			const result = await reorderBundles(params.shopId, body.sort_map);
			logger.info(`[${reqContext.requestId} (SC-06)] ShopCatalogController.reorderBundles() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SC-06)] ShopCatalogController.reorderBundles() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	checkBundleStock: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (SC-07)] ShopCatalogController.checkBundleStock() called.`);
		const id = parseIntParam(params.bundleId, "bundle id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid bundle id", ResponseStatus.UNPROCESSABLE);
		try {
			logger.info(`[${reqContext.requestId} (SC-07)] ShopCatalogController.checkBundleStock() calling checkBundleStock().`);
			const result = await checkBundleStock(params.shopId, id);
			logger.info(`[${reqContext.requestId} (SC-07)] ShopCatalogController.checkBundleStock() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SC-07)] ShopCatalogController.checkBundleStock() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	listPricePanels: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (SC-08)] ShopCatalogController.listPricePanels() called.`);
		try {
			logger.info(`[${reqContext.requestId} (SC-08)] ShopCatalogController.listPricePanels() calling listPanels().`);
			const result = await listPanels(params.shopId);
			logger.info(`[${reqContext.requestId} (SC-08)] ShopCatalogController.listPricePanels() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SC-08)] ShopCatalogController.listPricePanels() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	createPricePanel: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (SC-09)] ShopCatalogController.createPricePanel() called.`);
		if (!hasRole(user.roles, "admin", "manager")) {
			logger.warn(`[${reqContext.requestId} (SC-09)] ShopCatalogController.createPricePanel() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (SC-09)] ShopCatalogController.createPricePanel() calling createPanel().`);
			const result = await createPanel(params.shopId, body.name, body.color ?? null);
			logger.info(`[${reqContext.requestId} (SC-09)] ShopCatalogController.createPricePanel() completed.`);
			return successResponse(reqContext, result, ResponseStatus.CREATED);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SC-09)] ShopCatalogController.createPricePanel() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	updatePricePanel: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (SC-10)] ShopCatalogController.updatePricePanel() called.`);
		if (!hasRole(user.roles, "admin", "manager")) {
			logger.warn(`[${reqContext.requestId} (SC-10)] ShopCatalogController.updatePricePanel() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.panelId, "panel id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid panel id", ResponseStatus.UNPROCESSABLE);
		try {
			logger.info(`[${reqContext.requestId} (SC-10)] ShopCatalogController.updatePricePanel() calling updatePanel().`);
			const result = await updatePanel(params.shopId, id, body);
			logger.info(`[${reqContext.requestId} (SC-10)] ShopCatalogController.updatePricePanel() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SC-10)] ShopCatalogController.updatePricePanel() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	deletePricePanel: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (SC-11)] ShopCatalogController.deletePricePanel() called.`);
		if (!hasRole(user.roles, "admin", "manager")) {
			logger.warn(`[${reqContext.requestId} (SC-11)] ShopCatalogController.deletePricePanel() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.panelId, "panel id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid panel id", ResponseStatus.UNPROCESSABLE);
		try {
			logger.info(`[${reqContext.requestId} (SC-11)] ShopCatalogController.deletePricePanel() calling deletePanel().`);
			await deletePanel(params.shopId, id);
			logger.info(`[${reqContext.requestId} (SC-11)] ShopCatalogController.deletePricePanel() completed.`);
			return successResponse(reqContext, undefined, ResponseStatus.NO_CONTENT);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SC-11)] ShopCatalogController.deletePricePanel() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	getPricePanelItems: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (SC-12)] ShopCatalogController.getPricePanelItems() called.`);
		const id = parseIntParam(params.panelId, "panel id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid panel id", ResponseStatus.UNPROCESSABLE);
		try {
			logger.info(`[${reqContext.requestId} (SC-12)] ShopCatalogController.getPricePanelItems() calling getPanelItems().`);
			const result = await getPanelItems(params.shopId, id);
			logger.info(`[${reqContext.requestId} (SC-12)] ShopCatalogController.getPricePanelItems() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SC-12)] ShopCatalogController.getPricePanelItems() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	setPricePanelItemPrice: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (SC-13)] ShopCatalogController.setPricePanelItemPrice() called.`);
		if (!hasRole(user.roles, "admin", "manager", "cashier")) {
			logger.warn(`[${reqContext.requestId} (SC-13)] ShopCatalogController.setPricePanelItemPrice() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const panelId = parseIntParam(params.panelId, "panel id", reqContext.set);
		const productId = parseIntParam(params.productId, "product id", reqContext.set);
		if (panelId === null || productId === null) {
			return errorResponse(reqContext, "Invalid id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (SC-13)] ShopCatalogController.setPricePanelItemPrice() calling setItemPrice().`);
			const result = await setItemPrice(params.shopId, panelId, productId, body);
			logger.info(`[${reqContext.requestId} (SC-13)] ShopCatalogController.setPricePanelItemPrice() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SC-13)] ShopCatalogController.setPricePanelItemPrice() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	setPricePanelBundleItemPrice: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (SC-14)] ShopCatalogController.setPricePanelBundleItemPrice() called.`);
		if (!hasRole(user.roles, "admin", "manager", "cashier")) {
			logger.warn(`[${reqContext.requestId} (SC-14)] ShopCatalogController.setPricePanelBundleItemPrice() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const panelId = parseIntParam(params.panelId, "panel id", reqContext.set);
		const bundleId = parseIntParam(params.bundleId, "bundle id", reqContext.set);
		if (panelId === null || bundleId === null) {
			return errorResponse(reqContext, "Invalid id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (SC-14)] ShopCatalogController.setPricePanelBundleItemPrice() calling setBundleItemPrice().`);
			const result = await setBundleItemPrice(params.shopId, panelId, bundleId, body);
			logger.info(`[${reqContext.requestId} (SC-14)] ShopCatalogController.setPricePanelBundleItemPrice() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SC-14)] ShopCatalogController.setPricePanelBundleItemPrice() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	createProduct: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (SC-15)] ShopCatalogController.createProduct() called.`);
		if (!hasRole(user.roles, "admin", "manager")) {
			logger.warn(`[${reqContext.requestId} (SC-15)] ShopCatalogController.createProduct() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (SC-15)] ShopCatalogController.createProduct() calling createShopProduct().`);
			const result = await createShopProduct(
				params.shopId,
				body as Parameters<typeof createShopProduct>[1],
				Number(user.sub),
			);
			logger.info(`[${reqContext.requestId} (SC-15)] ShopCatalogController.createProduct() completed.`);
			return successResponse(reqContext, result, ResponseStatus.CREATED);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SC-15)] ShopCatalogController.createProduct() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	updateProduct: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (SC-16)] ShopCatalogController.updateProduct() called.`);
		const id = parseIntParam(params.productId, "product id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid product id", ResponseStatus.UNPROCESSABLE);
		try {
			logger.info(`[${reqContext.requestId} (SC-16)] ShopCatalogController.updateProduct() calling updateShopProduct().`);
			const result = await updateShopProduct(user, params.shopId, id, body);
			logger.info(`[${reqContext.requestId} (SC-16)] ShopCatalogController.updateProduct() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SC-16)] ShopCatalogController.updateProduct() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	deleteProduct: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (SC-17)] ShopCatalogController.deleteProduct() called.`);
		if (!hasRole(user.roles, "admin", "manager")) {
			logger.warn(`[${reqContext.requestId} (SC-17)] ShopCatalogController.deleteProduct() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.productId, "product id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid product id", ResponseStatus.UNPROCESSABLE);
		try {
			logger.info(`[${reqContext.requestId} (SC-17)] ShopCatalogController.deleteProduct() calling deleteShopProduct().`);
			await deleteShopProduct(user, params.shopId, id);
			logger.info(`[${reqContext.requestId} (SC-17)] ShopCatalogController.deleteProduct() completed.`);
			return successResponse(reqContext, undefined, ResponseStatus.NO_CONTENT);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SC-17)] ShopCatalogController.deleteProduct() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	receiveStock: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (SC-18)] ShopCatalogController.receiveStock() called.`);
		if (!hasRole(user.roles, "admin", "manager")) {
			logger.warn(`[${reqContext.requestId} (SC-18)] ShopCatalogController.receiveStock() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (SC-18)] ShopCatalogController.receiveStock() calling receiveStock().`);
			const result = await receiveStock({
				shopId: params.shopId,
				items: body.items as Parameters<typeof receiveStock>[0]["items"],
				userId: Number(user.sub),
			});
			logger.info(`[${reqContext.requestId} (SC-18)] ShopCatalogController.receiveStock() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SC-18)] ShopCatalogController.receiveStock() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	adjustStock: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (SC-19)] ShopCatalogController.adjustStock() called.`);
		if (!hasRole(user.roles, "admin", "manager")) {
			logger.warn(`[${reqContext.requestId} (SC-19)] ShopCatalogController.adjustStock() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (SC-19)] ShopCatalogController.adjustStock() calling adjustStock().`);
			const result = await adjustStock({
				shopId: params.shopId,
				productId: body.product_id,
				delta: body.delta,
				reason: body.reason,
				costPerUnit: body.cost_per_unit ?? null,
				userId: Number(user.sub),
			});
			logger.info(`[${reqContext.requestId} (SC-19)] ShopCatalogController.adjustStock() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SC-19)] ShopCatalogController.adjustStock() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	createCategory: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (SC-20)] ShopCatalogController.createCategory() called.`);
		if (!hasRole(user.roles, "admin", "manager")) {
			logger.warn(`[${reqContext.requestId} (SC-20)] ShopCatalogController.createCategory() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (SC-20)] ShopCatalogController.createCategory() calling createShopCategory().`);
			const result = await createShopCategory(params.shopId, body.name);
			logger.info(`[${reqContext.requestId} (SC-20)] ShopCatalogController.createCategory() completed.`);
			return successResponse(reqContext, result, ResponseStatus.CREATED);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SC-20)] ShopCatalogController.createCategory() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	updateCategory: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (SC-21)] ShopCatalogController.updateCategory() called.`);
		if (!hasRole(user.roles, "admin", "manager")) {
			logger.warn(`[${reqContext.requestId} (SC-21)] ShopCatalogController.updateCategory() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (SC-21)] ShopCatalogController.updateCategory() calling updateShopCategory().`);
			const result = await updateShopCategory(params.shopId, params.categoryId, body.name);
			logger.info(`[${reqContext.requestId} (SC-21)] ShopCatalogController.updateCategory() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SC-21)] ShopCatalogController.updateCategory() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	deleteCategory: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (SC-22)] ShopCatalogController.deleteCategory() called.`);
		if (!hasRole(user.roles, "admin", "manager")) {
			logger.warn(`[${reqContext.requestId} (SC-22)] ShopCatalogController.deleteCategory() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (SC-22)] ShopCatalogController.deleteCategory() calling deleteShopCategory().`);
			await deleteShopCategory(params.shopId, params.categoryId);
			logger.info(`[${reqContext.requestId} (SC-22)] ShopCatalogController.deleteCategory() completed.`);
			return successResponse(reqContext, undefined, ResponseStatus.NO_CONTENT);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SC-22)] ShopCatalogController.deleteCategory() error:`, e);
			return errorFromService(reqContext, e);
		}
	},
};
