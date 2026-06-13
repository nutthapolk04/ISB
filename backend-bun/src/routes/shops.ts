import { Elysia, t } from "elysia";
import { requireAuth } from "@/middleware/auth";
import { listShops, getShop } from "@/services/shop_service";

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
    "/:id",
    async ({ params, set }) => {
      const shop = await getShop(params.id);
      if (!shop) {
        set.status = 404;
        return { detail: "Shop not found" };
      }
      return shop;
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { summary: "Get one shop by id" },
    },
  );
