import type { HandlerContext } from "@/controllers/types";
import {
    listProducts,
    getProduct,
    searchProducts,
    getVariantByBarcode,
} from "@/services/product_service";
import { handleServiceError } from "@/utils/ResponseUtil";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";

export const ProductController = {
    search: async (ctx: any) => {
        const { query } = ctx;
        return await searchProducts(
            query.q,
            Number(query.skip ?? 0),
            Number(query.limit ?? 20),
        );
    },

    getByBarcode: async (ctx: any) => {
        const { params, set } = ctx;
        const variant = await getVariantByBarcode(params.barcode);
        if (!variant) {
            set.status = 404;
            return { detail: "Product variant not found" };
        }
        return variant;
    },

    getById: async (ctx: any) => {
        const { params, set } = ctx;
        const id = parseIntParam(params.id, "product id", set);
        if (id === null) return { detail: "Invalid product id" };
        const product = await getProduct(id);
        if (!product) {
            set.status = 404;
            return { detail: "Product not found" };
        }
        return product;
    },

    list: async (ctx: any) => {
        const { query } = ctx;
        return await listProducts({
            skip: Number(query.skip ?? 0),
            limit: Number(query.limit ?? 20),
            categoryId: query.category_id ? Number(query.category_id) : undefined,
            isActive:
                query.is_active === "true" ? true : query.is_active === "false" ? false : undefined,
        });
    },
};
