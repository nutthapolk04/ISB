import type { SetStatus } from "@/controllers/types";
import { hasRole } from "@/middleware/AuthUtils";
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
import { forbidden, handleServiceError } from "@/utils/ResponseUtil";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";

function managerOrAdmin(set: SetStatus) {
    return forbidden(set, "Forbidden");
}

export const ShopCatalogController = {
    listBundles: async ({ params, query, set }: any) => {
        try {
            return await listBundles(params.shopId, query.include_inactive === "true");
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    getBundle: async ({ params, set }: any) => {
        const id = parseIntParam(params.bundleId, "bundle id", set);
        if (id === null) return { detail: "Invalid bundle id" };
        try {
            return await getBundle(params.shopId, id);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    createBundle: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "manager")) return managerOrAdmin(set);
        try {
            set.status = 201;
            return await createBundle(params.shopId, body as Parameters<typeof createBundle>[1]);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    updateBundle: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "manager")) return managerOrAdmin(set);
        const id = parseIntParam(params.bundleId, "bundle id", set);
        if (id === null) return { detail: "Invalid bundle id" };
        try {
            return await updateBundle(params.shopId, id, body);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    deleteBundle: async (ctx: any) => {
        const { params, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "manager")) return managerOrAdmin(set);
        const id = parseIntParam(params.bundleId, "bundle id", set);
        if (id === null) return { detail: "Invalid bundle id" };
        try {
            return await deleteBundle(params.shopId, id);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    reorderBundles: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "manager", "cashier")) return managerOrAdmin(set);
        try {
            return await reorderBundles(params.shopId, body.sort_map);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    checkBundleStock: async ({ params, set }: any) => {
        const id = parseIntParam(params.bundleId, "bundle id", set);
        if (id === null) return { detail: "Invalid bundle id" };
        try {
            return await checkBundleStock(params.shopId, id);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    listPricePanels: async ({ params, set }: any) => {
        try {
            return await listPanels(params.shopId);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    createPricePanel: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "manager")) return managerOrAdmin(set);
        try {
            set.status = 201;
            return await createPanel(params.shopId, body.name, body.color ?? null);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    updatePricePanel: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "manager")) return managerOrAdmin(set);
        const id = parseIntParam(params.panelId, "panel id", set);
        if (id === null) return { detail: "Invalid panel id" };
        try {
            return await updatePanel(params.shopId, id, body);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    deletePricePanel: async (ctx: any) => {
        const { params, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "manager")) return managerOrAdmin(set);
        const id = parseIntParam(params.panelId, "panel id", set);
        if (id === null) return { detail: "Invalid panel id" };
        try {
            await deletePanel(params.shopId, id);
            set.status = 204;
            return null;
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    getPricePanelItems: async ({ params, set }: any) => {
        const id = parseIntParam(params.panelId, "panel id", set);
        if (id === null) return { detail: "Invalid panel id" };
        try {
            return await getPanelItems(params.shopId, id);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    setPricePanelItemPrice: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "manager", "cashier")) return managerOrAdmin(set);
        const panelId = parseIntParam(params.panelId, "panel id", set);
        const productId = parseIntParam(params.productId, "product id", set);
        if (panelId === null || productId === null) return { detail: "Invalid id" };
        try {
            return await setItemPrice(params.shopId, panelId, productId, body);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    setPricePanelBundleItemPrice: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "manager", "cashier")) return managerOrAdmin(set);
        const panelId = parseIntParam(params.panelId, "panel id", set);
        const bundleId = parseIntParam(params.bundleId, "bundle id", set);
        if (panelId === null || bundleId === null) return { detail: "Invalid id" };
        try {
            return await setBundleItemPrice(params.shopId, panelId, bundleId, body);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    createProduct: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "manager")) return managerOrAdmin(set);
        try {
            set.status = 201;
            return await createShopProduct(
                params.shopId,
                body as Parameters<typeof createShopProduct>[1],
                Number(user.sub),
            );
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    updateProduct: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        const id = parseIntParam(params.productId, "product id", set);
        if (id === null) return { detail: "Invalid product id" };
        try {
            return await updateShopProduct(user, params.shopId, id, body);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    deleteProduct: async (ctx: any) => {
        const { params, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "manager")) return managerOrAdmin(set);
        const id = parseIntParam(params.productId, "product id", set);
        if (id === null) return { detail: "Invalid product id" };
        try {
            await deleteShopProduct(user, params.shopId, id);
            set.status = 204;
            return null;
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    receiveStock: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "manager")) return managerOrAdmin(set);
        try {
            return await receiveStock({
                shopId: params.shopId,
                items: body.items as Parameters<typeof receiveStock>[0]["items"],
                userId: Number(user.sub),
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    adjustStock: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "manager")) return managerOrAdmin(set);
        try {
            return await adjustStock({
                shopId: params.shopId,
                productId: body.product_id,
                delta: body.delta,
                reason: body.reason,
                costPerUnit: body.cost_per_unit ?? null,
                userId: Number(user.sub),
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    createCategory: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "manager")) return managerOrAdmin(set);
        try {
            set.status = 201;
            return await createShopCategory(params.shopId, body.name);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    updateCategory: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "manager")) return managerOrAdmin(set);
        try {
            return await updateShopCategory(params.shopId, params.categoryId, body.name);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    deleteCategory: async (ctx: any) => {
        const { params, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "manager")) return managerOrAdmin(set);
        try {
            await deleteShopCategory(params.shopId, params.categoryId);
            set.status = 204;
            return null;
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },
};
