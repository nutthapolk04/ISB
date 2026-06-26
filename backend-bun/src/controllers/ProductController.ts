/** Products — search, list, get by id/barcode (auth) */
import type { Context } from "elysia";
import { authedCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import {
	listProducts,
	getProduct,
	searchProducts,
	getVariantByBarcode,
} from "@/services/product_service";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";
import { errorResponse, successResponse } from "@/utils/ResponseUtil";

export const ProductController = {
	search: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { query } = reqContext;
		return successResponse(
			reqContext,
			await searchProducts(query.q, Number(query.skip ?? 0), Number(query.limit ?? 20)),
			ResponseStatus.OK,
		);
	},

	getByBarcode: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		const variant = await getVariantByBarcode(params.barcode);
		if (!variant) {
			return errorResponse(reqContext, "Product variant not found", ResponseStatus.NOT_FOUND);
		}
		return successResponse(reqContext, variant, ResponseStatus.OK);
	},

	getById: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		const id = parseIntParam(params.id, "product id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid product id", ResponseStatus.UNPROCESSABLE);
		const product = await getProduct(id);
		if (!product) {
			return errorResponse(reqContext, "Product not found", ResponseStatus.NOT_FOUND);
		}
		return successResponse(reqContext, product, ResponseStatus.OK);
	},

	list: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { query } = reqContext;
		return successResponse(
			reqContext,
			await listProducts({
				skip: Number(query.skip ?? 0),
				limit: Number(query.limit ?? 20),
				categoryId: query.category_id ? Number(query.category_id) : undefined,
				isActive:
					query.is_active === "true" ? true : query.is_active === "false" ? false : undefined,
			}),
			ResponseStatus.OK,
		);
	},
};
