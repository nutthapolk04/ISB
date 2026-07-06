/** Products — search, list, get by id/barcode (auth) */
import { authedCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import { logger } from "@/logger";
import {
	listProducts,
	getProduct,
	searchProducts,
	getVariantByBarcode,
} from "@/services/product_service";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";
import { errorFromService, errorResponse, successResponse } from "@/utils/ResponseUtil";

export const ProductController = {
	search: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { query } = reqContext;
		logger.info(`[${reqContext.requestId} (PD-01)] ProductController.search() called.`);
		try {
			logger.info(`[${reqContext.requestId} (PD-01)] ProductController.search() calling searchProducts().`);
			const result = await searchProducts(query.q, Number(query.skip ?? 0), Number(query.limit ?? 20));
			logger.info(`[${reqContext.requestId} (PD-01)] ProductController.search() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (PD-01)] ProductController.search() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	getByBarcode: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (PD-02)] ProductController.getByBarcode() called.`);
		try {
			logger.info(`[${reqContext.requestId} (PD-02)] ProductController.getByBarcode() calling getVariantByBarcode().`);
			const variant = await getVariantByBarcode(params.barcode);
			if (!variant) {
				logger.warn(`[${reqContext.requestId} (PD-02)] ProductController.getByBarcode() not found.`);
				return errorResponse(reqContext, "Product variant not found", ResponseStatus.NOT_FOUND);
			}
			logger.info(`[${reqContext.requestId} (PD-02)] ProductController.getByBarcode() completed.`);
			return successResponse(reqContext, variant, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (PD-02)] ProductController.getByBarcode() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	getById: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (PD-03)] ProductController.getById() called.`);
		const id = parseIntParam(params.id, "product id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (PD-03)] ProductController.getById() invalid product id.`);
			return errorResponse(reqContext, "Invalid product id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (PD-03)] ProductController.getById() calling getProduct().`);
			const product = await getProduct(id);
			if (!product) {
				logger.warn(`[${reqContext.requestId} (PD-03)] ProductController.getById() not found.`);
				return errorResponse(reqContext, "Product not found", ResponseStatus.NOT_FOUND);
			}
			logger.info(`[${reqContext.requestId} (PD-03)] ProductController.getById() completed.`);
			return successResponse(reqContext, product, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (PD-03)] ProductController.getById() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	list: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { query } = reqContext;
		logger.info(`[${reqContext.requestId} (PD-04)] ProductController.list() called.`);
		try {
			logger.info(`[${reqContext.requestId} (PD-04)] ProductController.list() calling listProducts().`);
			const result = await listProducts({
				skip: Number(query.skip ?? 0),
				limit: Number(query.limit ?? 20),
				categoryId: query.category_id ? Number(query.category_id) : undefined,
				isActive:
					query.is_active === "true" ? true : query.is_active === "false" ? false : undefined,
			});
			logger.info(`[${reqContext.requestId} (PD-04)] ProductController.list() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (PD-04)] ProductController.list() error:`, e);
			return errorFromService(reqContext, e);
		}
	},
};
