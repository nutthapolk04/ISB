import { Elysia, t } from "elysia";
import { jwtPlugin, requireAuth, hasRole } from "@/middleware/auth";
import {
  KNOWN_FLAGS,
  SCHOOL_KEYS,
  getPublicSettings,
  getSchoolSettings,
  listKnown,
  setSchoolSettings,
  setValue,
} from "@/services/settings_service";

/**
 * Public endpoint group — no auth. Mounted on its own to avoid the requireAuth
 * middleware applied by adminSettingsRoutes.
 */
export const publicSettingsRoutes = new Elysia({ name: "public-settings" })
  .get(
    "/api/v1/admin/settings/public",
    async () => await getPublicSettings(),
    { detail: { summary: "Public school display fields — no auth required" } },
  );

export const adminSettingsRoutes = new Elysia({ name: "admin-settings", prefix: "/admin/settings" })
  .use(requireAuth)
  .get(
    "/",
    async ({ user, set }) => {
      if (!hasRole(user.roles, "admin")) {
        set.status = 403;
        return { detail: "Admin only" };
      }
      return await listKnown();
    },
    { detail: { summary: "List all known feature flags + values" } },
  )
  .get(
    "/school",
    async ({ user, set }) => {
      if (!hasRole(user.roles, "admin")) {
        set.status = 403;
        return { detail: "Admin only" };
      }
      return await getSchoolSettings();
    },
    { detail: { summary: "Read school identity settings (admin)" } },
  )
  .put(
    "/school",
    async ({ user, body, set }) => {
      if (!hasRole(user.roles, "admin")) {
        set.status = 403;
        return { detail: "Admin only" };
      }
      const userId = Number(user.sub);
      return await setSchoolSettings(body, userId);
    },
    {
      body: t.Object({
        school_name: t.Optional(t.Nullable(t.String())),
        school_address: t.Optional(t.Nullable(t.String())),
        school_tax_id: t.Optional(t.Nullable(t.String())),
        school_phone: t.Optional(t.Nullable(t.String())),
        school_logo_url: t.Optional(t.Nullable(t.String())),
        school_cover_url: t.Optional(t.Nullable(t.String())),
        school_receipt_footer: t.Optional(t.Nullable(t.String())),
      }),
      detail: { summary: "Bulk update school identity settings (admin)" },
    },
  )
  .put(
    "/:key",
    async ({ params, body, user, set }) => {
      if (!hasRole(user.roles, "admin")) {
        set.status = 403;
        return { detail: "Admin only" };
      }
      const key = params.key;
      if (!(key in KNOWN_FLAGS) && !SCHOOL_KEYS.has(key)) {
        set.status = 404;
        return { detail: `Unknown setting key '${key}'` };
      }
      const userId = Number(user.sub);
      const newValue = await setValue(key, body.value, userId);
      return { key, value: newValue };
    },
    {
      params: t.Object({ key: t.String() }),
      body: t.Object({ value: t.Any() }),
      detail: { summary: "Update a single setting by key (admin)" },
    },
  );
