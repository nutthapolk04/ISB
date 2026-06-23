import { Elysia, t } from "elysia";
import { requireAuth } from "@/middleware/auth";
import {
  searchCustomers,
  getCustomerByCode,
  getCustomerByCard,
  getCustomer,
  listCustomers,
} from "@/services/customer_service";

export const customerRoutes = new Elysia({ name: "customers", prefix: "/customers" })
  .use(requireAuth)
  .get(
    "/search",
    async ({ query, set }) => {
      try {
        return await searchCustomers({
          q: query.q,
          limit: query.limit ? Number(query.limit) : undefined,
        });
      } catch (e: unknown) {
        const err = e as { status?: number; message?: string };
        if (err.status === 400) {
          set.status = 400;
          return { detail: err.message ?? "Bad request" };
        }
        throw e;
      }
    },
    {
      query: t.Object({
        q: t.String({ minLength: 1 }),
        limit: t.Optional(t.Nullable(t.String())),
      }),
      detail: {
        summary: "Search customers/users",
        description:
          "Searches Customer + User tables. Returns StudentProfileResponse rows. user_id != null indicates a user-payer flow.",
      },
    },
  )
  .get(
    "/by-code/:code",
    async ({ params, set }) => {
      const c = await getCustomerByCode(params.code);
      if (!c) {
        set.status = 404;
        return { detail: "Customer not found" };
      }
      return c;
    },
    {
      params: t.Object({ code: t.String() }),
      detail: { summary: "Lookup by student_code or customer_code" },
    },
  )
  .get(
    "/by-card/:uid",
    async ({ params, set }) => {
      const c = await getCustomerByCard(params.uid);
      if (!c) {
        set.status = 404;
        return { detail: "Card not bound" };
      }
      return c;
    },
    {
      params: t.Object({ uid: t.String() }),
      detail: { summary: "Lookup by NFC card UID" },
    },
  )
  .get(
    "/",
    async ({ query }) => {
      return await listCustomers({
        skip: query.skip ? Number(query.skip) : undefined,
        limit: query.limit ? Number(query.limit) : undefined,
        search: query.search ?? undefined,
        isActive:
          query.is_active === "true" ? true : query.is_active === "false" ? false : undefined,
      });
    },
    {
      query: t.Object({
        skip: t.Optional(t.Nullable(t.String())),
        limit: t.Optional(t.Nullable(t.String())),
        search: t.Optional(t.Nullable(t.String())),
        is_active: t.Optional(t.Nullable(t.String())),
      }),
      detail: { summary: "List customers (paginated)" },
    },
  )
  .get(
    "/:id",
    async ({ params, set }) => {
      const id = Number(params.id);
      if (!Number.isInteger(id)) {
        set.status = 422;
        return { detail: "Invalid customer id" };
      }
      const c = await getCustomer(id);
      if (!c) {
        set.status = 404;
        return { detail: "Customer not found" };
      }
      return c;
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { summary: "Get customer by numeric id" },
    },
  );
