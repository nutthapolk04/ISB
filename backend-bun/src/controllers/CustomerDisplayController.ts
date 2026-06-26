/** Customer display images — public list/binary; admin upload/delete/reorder */
import { authedCtx, publicCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
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
		return successResponse(reqContext, await listImages(), ResponseStatus.OK);
	},

	getBinary: async (ctx: any) => {
		const reqContext = publicCtx(ctx);
		const { params } = reqContext;
		const id = parseIntParam(params.id, "id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid id", ResponseStatus.UNPROCESSABLE);
		try {
			const bin = await getImageBinary(id);
			reqContext.set.headers["Content-Type"] = bin.contentType;
			reqContext.set.headers["Cache-Control"] = "public, max-age=3600";
			reqContext.set.headers["Content-Length"] = String(bin.sizeBytes);
			return bin.content;
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	upload: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		if (!hasRole(user.roles, "admin")) {
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		try {
			const f = (body as { file?: File }).file;
			if (!f) {
				return errorResponse(reqContext, "file is required", ResponseStatus.UNPROCESSABLE);
			}
			return successResponse(
				reqContext,
				await uploadImage({ file: f, userId: Number(user.sub) }),
				ResponseStatus.CREATED,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	delete: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		if (!hasRole(user.roles, "admin")) {
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid id", ResponseStatus.UNPROCESSABLE);
		try {
			await deleteImage(id);
			return successResponse(reqContext, undefined, ResponseStatus.NO_CONTENT);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	reorder: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		if (!hasRole(user.roles, "admin")) {
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		try {
			return successResponse(reqContext, await reorderImages(body.ordered_ids), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},
};
