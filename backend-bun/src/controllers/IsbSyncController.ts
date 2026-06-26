import type { HandlerContext } from "@/controllers/types";
import {
    checkApiKey,
    syncAuthFailed,
    syncProcessingFailed,
    syncSuccess,
} from "@/lib/isb_sync_response";
import {
    processDepartmentBatch,
    processFamilyBatch,
    processStaffBatch,
} from "@/services/isb_sync_service";

async function handleBatchResult(
    set: { status?: number | string },
    result: { success: number; failed: number; errors: Array<{ index: number; id: string | number; error: string }> },
) {
    if (result.failed > 0) {
        return syncProcessingFailed(set, result.errors);
    }
    return syncSuccess();
}

export const IsbSyncController = {
    staffs: async (ctx: any) => {
        const { body, headers, set } = ctx;
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

    families: async (ctx: any) => {
        const { body, headers, set } = ctx;
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

    departments: async (ctx: any) => {
        const { body, headers, set } = ctx;
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
};
