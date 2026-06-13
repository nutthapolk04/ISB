import { Elysia, t } from "elysia";
import { requireAuth } from "@/middleware/auth";
import {
  listProducts,
  getProduct,
  searchProducts,
  getVariantByBarcode,
} from "@/services/product_service";

export const productRoutes = new Elysia({ name: "products", prefix: "/products" })
  .use(requireAuth)
  .get(
    "/search",
    async ({ query }) => {
      return await searchProducts(
        query.q,
        Number(query.skip ?? 0),
        Number(query.limit ?? 20),
      );
    },
    {
      query: t.Object({
        q: t.String({ minLength: 1 }),
        skip: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
      detail: {
        summary: "Search products by name, SKU, or barcode",
        description:
          "Exact barcode match returns first; otherwise partial match on name/SKU. Returns variant rows.",
      },
    },
  )
  .get(
    "/barcode/:barcode",
    async ({ params, set }) => {
      const variant = await getVariantByBarcode(params.barcode);
      if (!variant) {
        set.status = 404;
        return { detail: "Product variant not found" };
      }
      return variant;
    },
    {
      params: t.Object({ barcode: t.String() }),
      detail: { summary: "Get a variant by exact barcode match" },
    },
  )
  .get(
    "/:id",
    async ({ params, set }) => {
      const id = Number(params.id);
      if (!Number.isInteger(id)) {
        set.status = 422;
        return { detail: "Invalid product id" };
      }
      const product = await getProduct(id);
      if (!product) {
        set.status = 404;
        return { detail: "Product not found" };
      }
      return product;
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { summary: "Get product details with variants and category" },
    },
  )
  .get(
    "/",
    async ({ query }) => {
      return await listProducts({
        skip: Number(query.skip ?? 0),
        limit: Number(query.limit ?? 20),
        categoryId: query.category_id ? Number(query.category_id) : undefined,
        isActive: query.is_active === "true" ? true : query.is_active === "false" ? false : undefined,
      });
    },
    {
      query: t.Object({
        skip: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        category_id: t.Optional(t.String()),
        is_active: t.Optional(t.String()),
      }),
      detail: { summary: "List products with pagination + filters" },
    },
  );
