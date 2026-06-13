import { Elysia, t } from "elysia";
import { requireAuth } from "@/middleware/auth";
import {
  listUsers,
  getUser,
  getUserPayerByUsername,
  getUserPayerByCard,
  familyLookup,
} from "@/services/user_service";

function handle(set: { status?: number }) {
  return (e: unknown) => {
    const err = e as { status?: number; message?: string };
    if (err.status && err.status >= 400 && err.status < 500) {
      set.status = err.status;
      return { detail: err.message ?? "Bad request" };
    }
    throw e;
  };
}

export const userRoutes = new Elysia({ name: "users", prefix: "/users" })
  .use(requireAuth)
  .get(
    "/",
    async ({ query, user, set }) => {
      try {
        return await listUsers({
          caller: user as typeof user & { shop_id?: string | null },
          q: query.q,
          shopId: query.shop_id,
          role: query.role,
          unassigned: query.unassigned === "true",
          page: query.page ? Number(query.page) : undefined,
          pageSize: query.page_size ? Number(query.page_size) : undefined,
        });
      } catch (e) {
        return handle(set)(e);
      }
    },
    {
      query: t.Object({
        q: t.Optional(t.String()),
        shop_id: t.Optional(t.String()),
        role: t.Optional(t.String()),
        unassigned: t.Optional(t.String()),
        page: t.Optional(t.String()),
        page_size: t.Optional(t.String()),
      }),
      detail: { summary: "Paginated user list (admin/manager only)" },
    },
  )
  .get(
    "/by-username/:username",
    async ({ params, set }) => {
      try {
        return await getUserPayerByUsername(params.username);
      } catch (e) {
        return handle(set)(e);
      }
    },
    {
      params: t.Object({ username: t.String() }),
      detail: { summary: "Resolve a user payer by username for POS wallet payment" },
    },
  )
  .get(
    "/by-card/:uid",
    async ({ params, set }) => {
      try {
        return await getUserPayerByCard(params.uid);
      } catch (e) {
        return handle(set)(e);
      }
    },
    {
      params: t.Object({ uid: t.String() }),
      detail: { summary: "Resolve a user payer by NFC card UID" },
    },
  )
  .get(
    "/family-lookup",
    async ({ query, set }) => {
      try {
        return await familyLookup(query.q);
      } catch (e) {
        return handle(set)(e);
      }
    },
    {
      query: t.Object({ q: t.String({ minLength: 1 }) }),
      detail: { summary: "Lookup by employee username or family code" },
    },
  )
  .get(
    "/:id",
    async ({ params, user, set }) => {
      const id = Number(params.id);
      if (!Number.isInteger(id)) {
        set.status = 422;
        return { detail: "Invalid user id" };
      }
      try {
        return await getUser(user as typeof user & { shop_id?: string | null }, id);
      } catch (e) {
        return handle(set)(e);
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { summary: "Get a single user by id" },
    },
  );
