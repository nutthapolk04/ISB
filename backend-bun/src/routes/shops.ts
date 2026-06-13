import { Elysia, t } from "elysia";
import { requireAuth } from "@/middleware/auth";
import { listShops, getShop } from "@/services/shop_service";
import {
  listShopProducts,
  listShopCategories,
} from "@/services/shop_product_service";

export const shopRoutes = new Elysia({ name: "shops", prefix: "/shops" })
  .use(requireAuth)
  .get(
    "/",
    async ({ query }) => {
      const activeOnly = query.active_only !== "false";
      const module =
        query.module === "canteen" || query.module === "store"
          ? query.module
          : undefined;
      return await listShops({ activeOnly, module });
    },
    {
      query: t.Object({
        active_only: t.Optional(t.String()),
        module: t.Optional(t.Union([t.Literal("canteen"), t.Literal("store")])),
      }),
      detail: {
        summary: "List shops",
        description:
          "Active shops by default. Filter by module (canteen|store). Mirrors FastAPI /api/v1/shops/.",
      },
    },
  )
  .get(
    "/:shopId",
    async ({ params, set }) => {
      const shop = await getShop(params.shopId);
      if (!shop) {
        set.status = 404;
        return { detail: "Shop not found" };
      }
      return shop;
    },
    {
      params: t.Object({ shopId: t.String() }),
      detail: { summary: "Get one shop by id" },
    },
  )
  .get(
    "/:shopId/products",
    async ({ params, query, set }) => {
      try {
        return await listShopProducts(params.shopId, {
          search: query.search,
          category: query.category,
          includeInactive: query.include_inactive === "true",
        });
      } catch (e: unknown) {
        const err = e as { status?: number; message?: string };
        if (err.status === 404) {
          set.status = 404;
          return { detail: err.message ?? "Shop not found" };
        }
        throw e;
      }
    },
    {
      params: t.Object({ shopId: t.String() }),
      query: t.Object({
        search: t.Optional(t.String()),
        category: t.Optional(t.String()),
        include_inactive: t.Optional(t.String()),
      }),
      detail: {
        summary: "List products in a shop",
        description:
          "Active products by default, sorted by sort_order then name. Supports text search and category filter.",
      },
    },
  )
  .get(
    "/:shopId/categories",
    async ({ params, set }) => {
      try {
        return await listShopCategories(params.shopId);
      } catch (e: unknown) {
        const err = e as { status?: number; message?: string };
        if (err.status === 404) {
          set.status = 404;
          return { detail: err.message ?? "Shop not found" };
        }
        throw e;
      }
    },
    {
      params: t.Object({ shopId: t.String() }),
      detail: { summary: "List categories in a shop" },
    },
  );
