import { Elysia, t } from "elysia";
import {
  checkApiKey,
  mapValidationError,
  syncAuthFailed,
  syncProcessingFailed,
  syncSuccess,
  syncValidationFailed,
} from "@/lib/isb_sync_response";

type SyncSet = { status?: number | string };
import {
  processDepartmentBatch,
  processFamilyBatch,
  processStaffBatch,
} from "@/services/isb_sync_service";

const staffLoginSchema = t.Object({
  loginId: t.String(),
  email: t.String(),
});

const smartCardSchema = t.Object({ cardNumber: t.String() });

const staffItemSchema = t.Object({
  customerId: t.Number(),
  customerType: t.Literal("Staff"),
  staffType: t.String(),
  department: t.String(),
  familyCode: t.Number(),
  firstName: t.String(),
  lastName: t.String(),
  hasChildren: t.Boolean(),
  profileImage: t.String(),
  smartCard: smartCardSchema,
  login: staffLoginSchema,
});

const parentSchema = t.Object({
  customerId: t.Number(),
  customerType: t.Union([t.Literal("Parent"), t.Literal("Staff")]),
  firstName: t.String(),
  lastName: t.String(),
  profileImage: t.String(),
  login: t.String(),
  smartCard: smartCardSchema,
});

const studentSchema = t.Object({
  customerId: t.Number(),
  customerType: t.Literal("Student"),
  firstName: t.String(),
  lastName: t.String(),
  grade: t.String(),
  schoolType: t.String(),
  profileImage: t.String(),
  smartCard: smartCardSchema,
});

const DEPARTMENT_ALLOWED_KEYS = new Set([
  "departmentId",
  "customerType",
  "departmentDescription",
  "login",
]);

function parseDepartmentBatchBody(raw: unknown): {
  ok: true;
  departments: Array<{
    departmentId: number;
    customerType: "Department";
    departmentDescription: string;
    login?: { loginId: string; email: string } | null;
  }>;
} | {
  ok: false;
  errors: Array<Record<string, unknown>>;
} {
  const errors: Array<Record<string, unknown>> = [];
  if (!raw || typeof raw !== "object" || !("departments" in raw)) {
    return {
      ok: false,
      errors: [{ type: "missing", loc: ["body", "departments"], msg: "Field required" }],
    };
  }
  const departments = (raw as { departments: unknown }).departments;
  if (!Array.isArray(departments)) {
    return {
      ok: false,
      errors: [{ type: "type_error", loc: ["body", "departments"], msg: "Expected array" }],
    };
  }

  const parsed: Array<{
    departmentId: number;
    customerType: "Department";
    departmentDescription: string;
    login?: { loginId: string; email: string } | null;
  }> = [];

  for (let i = 0; i < departments.length; i++) {
    const item = departments[i];
    let itemHasError = false;
    if (!item || typeof item !== "object") {
      errors.push({ type: "type_error", loc: ["body", "departments", i], msg: "Expected object" });
      continue;
    }
    const rec = item as Record<string, unknown>;
    for (const key of Object.keys(rec)) {
      if (!DEPARTMENT_ALLOWED_KEYS.has(key)) {
        errors.push({
          type: "extra_forbidden",
          loc: ["body", "departments", i, key],
          msg: `Unexpected field '${key}'`,
        });
        itemHasError = true;
      }
    }
    if (typeof rec.departmentId !== "number" || !Number.isInteger(rec.departmentId)) {
      errors.push({ type: "missing", loc: ["body", "departments", i, "departmentId"], msg: "Field required" });
      itemHasError = true;
    }
    if (rec.customerType !== "Department") {
      errors.push({ type: "literal_error", loc: ["body", "departments", i, "customerType"], msg: "Expected 'Department'" });
      itemHasError = true;
    }
    if (typeof rec.departmentDescription !== "string") {
      errors.push({ type: "missing", loc: ["body", "departments", i, "departmentDescription"], msg: "Field required" });
      itemHasError = true;
    }
    if (rec.login !== undefined && rec.login !== null) {
      const login = rec.login as Record<string, unknown>;
      if (typeof login.loginId !== "string" || typeof login.email !== "string") {
        errors.push({ type: "type_error", loc: ["body", "departments", i, "login"], msg: "Invalid login object" });
        itemHasError = true;
      }
    }
    if (itemHasError) continue;

    parsed.push({
      departmentId: rec.departmentId as number,
      customerType: "Department",
      departmentDescription: rec.departmentDescription as string,
      login: rec.login === undefined
        ? undefined
        : rec.login === null
          ? null
          : rec.login as { loginId: string; email: string },
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, departments: parsed };
}

async function handleBatchResult(
  set: SyncSet,
  result: { success: number; failed: number; errors: Array<{ index: number; id: string | number; error: string }> },
) {
  if (result.failed > 0) {
    return syncProcessingFailed(set, result.errors);
  }
  return syncSuccess();
}

/**
 * Public ISB vendor sync routes — x-api-key only (no JWT).
 * Mounted on the root app before requireAuth.
 */
export const isbSyncRoutes = new Elysia({ name: "isb-sync", prefix: "/api/v1" })
  .onError(({ code, error, set }) => {
    if (code === "VALIDATION") {
      return syncValidationFailed(set, mapValidationError(error));
    }
  })
  .post(
    "/sync/staffs",
    async ({ body, headers, set }) => {
      if (!checkApiKey(headers as Record<string, string | undefined>)) {
        return syncAuthFailed(set);
      }
      try {
        const result = await processStaffBatch(body.staffs);
        return await handleBatchResult(set, result);
      } catch (e) {
        set.status = 500;
        return {
          status: "FAILED" as const,
          code: "500",
          message: (e as Error).message,
        };
      }
    },
    {
      body: t.Object({
        staffs: t.Array(staffItemSchema),
      }),
    },
  )
  .post(
    "/sync/families",
    async ({ body, headers, set }) => {
      if (!checkApiKey(headers as Record<string, string | undefined>)) {
        return syncAuthFailed(set);
      }
      try {
        const result = await processFamilyBatch(body.families);
        return await handleBatchResult(set, result);
      } catch (e) {
        set.status = 500;
        return {
          status: "FAILED" as const,
          code: "500",
          message: (e as Error).message,
        };
      }
    },
    {
      body: t.Object({
        families: t.Array(
          t.Object({
            familyCode: t.Number(),
            notificationEmails: t.Array(t.String()),
            mainParent: parentSchema,
            secondaryParent: t.Nullable(parentSchema),
            students: t.Array(studentSchema),
          }),
        ),
      }),
    },
  )
  .post(
    "/sync/departments",
    async ({ request, headers, set }) => {
      if (!checkApiKey(headers as Record<string, string | undefined>)) {
        return syncAuthFailed(set);
      }
      let raw: unknown;
      try {
        raw = await request.json();
      } catch {
        return syncValidationFailed(set, [
          { type: "json_invalid", loc: ["body"], msg: "Invalid JSON body" },
        ]);
      }
      const parsed = parseDepartmentBatchBody(raw);
      if (!parsed.ok) {
        return syncValidationFailed(set, parsed.errors);
      }
      try {
        const result = await processDepartmentBatch(parsed.departments);
        return await handleBatchResult(set, result);
      } catch (e) {
        set.status = 500;
        return {
          status: "FAILED" as const,
          code: "500",
          message: (e as Error).message,
        };
      }
    },
  );
