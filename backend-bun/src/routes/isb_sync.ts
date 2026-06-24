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

const departmentItemSchema = t.Object(
  {
    departmentId: t.Number(),
    customerType: t.Literal("Department"),
    departmentDescription: t.String(),
    login: t.Optional(t.Nullable(staffLoginSchema)),
    smartCard: t.Optional(smartCardSchema),
  });

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
    async ({ body, headers, set }) => {
      if (!checkApiKey(headers as Record<string, string | undefined>)) {
        return syncAuthFailed(set);
      }
      try {
        const result = await processDepartmentBatch(body.departments);
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
        departments: t.Array(departmentItemSchema),
      }),
    },
  );
