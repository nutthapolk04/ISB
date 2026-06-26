/** Customer display images — public list/binary; admin upload/delete/reorder */
import { authedCtx, publicCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import { logger } from "@/logger";
import { hasRole } from "@/middleware/AuthMiddleware";
import {
	listImages,
	getImageBinary,
	reorderImages,
	deleteImage,
	uploadImage,
} from "@/services/customer_display_service";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";
import { errorFromService, errorResponse, successResponse } from "@/utils/ResponseUtil";

export const CustomerDisplayController = {
	listPublic: async (ctx: any) => {
		const reqContext = publicCtx(ctx);
		logger.info(`[${reqContext.requestId} (CD-01)] CustomerDisplayController.listPublic() called.`);
		try {
			logger.info(`[${reqContext.requestId} (CD-01)] CustomerDisplayController.listPublic() calling listImages().`);
			const result = await listImages();
			logger.info(`[${reqContext.requestId} (CD-01)] CustomerDisplayController.listPublic() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (CD-01)] CustomerDisplayController.listPublic() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	getBinary: async (ctx: any) => {
		const reqContext = publicCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (CD-02)] CustomerDisplayController.getBinary() called.`);
		const id = parseIntParam(params.id, "id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid id", ResponseStatus.UNPROCESSABLE);
		try {
			logger.info(`[${reqContext.requestId} (CD-02)] CustomerDisplayController.getBinary() calling getImageBinary().`);
			const bin = await getImageBinary(id);
			reqContext.set.headers["Content-Type"] = bin.contentType;
			reqContext.set.headers["Cache-Control"] = "public, max-age=3600";
			reqContext.set.headers["Content-Length"] = String(bin.sizeBytes);
			logger.info(`[${reqContext.requestId} (CD-02)] CustomerDisplayController.getBinary() completed.`);
			return bin.content;
		} catch (e) {
			logger.error(`[${reqContext.requestId} (CD-02)] CustomerDisplayController.getBinary() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	upload: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		logger.info(`[${reqContext.requestId} (CD-03)] CustomerDisplayController.upload() called.`);
		if (!hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (CD-03)] CustomerDisplayController.upload() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		try {
			const f = (body as { file?: File }).file;
			if (!f) {
				return errorResponse(reqContext, "file is required", ResponseStatus.UNPROCESSABLE);
			}
			logger.info(`[${reqContext.requestId} (CD-03)] CustomerDisplayController.upload() calling uploadImage().`);
			const result = await uploadImage({ file: f, userId: Number(user.sub) });
			logger.info(`[${reqContext.requestId} (CD-03)] CustomerDisplayController.upload() completed.`);
			return successResponse(reqContext, result, ResponseStatus.CREATED);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (CD-03)] CustomerDisplayController.upload() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	delete: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (CD-04)] CustomerDisplayController.delete() called.`);
		if (!hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (CD-04)] CustomerDisplayController.delete() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid id", ResponseStatus.UNPROCESSABLE);
		try {
			logger.info(`[${reqContext.requestId} (CD-04)] CustomerDisplayController.delete() calling deleteImage().`);
			await deleteImage(id);
			logger.info(`[${reqContext.requestId} (CD-04)] CustomerDisplayController.delete() completed.`);
			return successResponse(reqContext, undefined, ResponseStatus.NO_CONTENT);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (CD-04)] CustomerDisplayController.delete() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	reorder: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		logger.info(`[${reqContext.requestId} (CD-05)] CustomerDisplayController.reorder() called.`);
		if (!hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (CD-05)] CustomerDisplayController.reorder() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (CD-05)] CustomerDisplayController.reorder() calling reorderImages().`);
			const result = await reorderImages(body.ordered_ids);
			logger.info(`[${reqContext.requestId} (CD-05)] CustomerDisplayController.reorder() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (CD-05)] CustomerDisplayController.reorder() error:`, e);
			return errorFromService(reqContext, e);
		}
	},
};
