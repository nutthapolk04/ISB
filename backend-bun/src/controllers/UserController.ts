/** Users — CRUD, lookup by card/username/family (auth) */
import { authedCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import {
	listUsers,
	getUser,
	getUserPayerByUsername,
	getUserPayerByCard,
	getUserPayerByExternalId,
	familyLookup,
	createUser,
	updateUser,
	deleteUser,
} from "@/services/user_service";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";
import { errorFromService, errorResponse, successResponse } from "@/utils/ResponseUtil";
import { logger } from "@/logger";

export const UserController = {
	list: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		logger.info(`[${reqContext.requestId} (UC-01)] UserController.list() called.`);
		try {
			logger.info(`[${reqContext.requestId} (UC-01)] UserController.list() calling listUsers().`);
			const result = await listUsers({
				caller: user as any,
				q: query.q,
				shopId: query.shop_id,
				role: query.role,
				unassigned: query.unassigned === "true",
				page: query.page ? Number(query.page) : undefined,
				pageSize: query.page_size ? Number(query.page_size) : undefined,
			});
			logger.info(`[${reqContext.requestId} (UC-01)] UserController.list() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (UC-01)] UserController.list() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	byUsername: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (UC-02)] UserController.byUsername() called.`);
		try {
			logger.info(`[${reqContext.requestId} (UC-02)] UserController.byUsername() calling getUserPayerByUsername().`);
			const result = await getUserPayerByUsername(params.username);
			logger.info(`[${reqContext.requestId} (UC-02)] UserController.byUsername() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			// No extra logger.error() here — this endpoint is hit as one leg of
			// several passive scan/lookup fallback chains (RFID scanners, card
			// tap modals) that routinely probe it and expect a 404 as a normal
			// "not this one" outcome. errorFromService() already logs 4xx at
			// warn level; double-logging every routine miss as [error] here
			// was pure noise.
			return errorFromService(reqContext, e);
		}
	},

	byCard: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (UC-03)] UserController.byCard() called.`);
		try {
			logger.info(`[${reqContext.requestId} (UC-03)] UserController.byCard() calling getUserPayerByCard().`);
			const result = await getUserPayerByCard(params.uid);
			logger.info(`[${reqContext.requestId} (UC-03)] UserController.byCard() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			// Same reasoning as byUsername above — routine fallback-chain miss.
			return errorFromService(reqContext, e);
		}
	},

	byExternalId: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (UC-10)] UserController.byExternalId() called.`);
		try {
			logger.info(`[${reqContext.requestId} (UC-10)] UserController.byExternalId() calling getUserPayerByExternalId().`);
			const result = await getUserPayerByExternalId(params.externalId);
			logger.info(`[${reqContext.requestId} (UC-10)] UserController.byExternalId() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			// Same reasoning as byUsername above — routine fallback-chain miss.
			return errorFromService(reqContext, e);
		}
	},

	familyLookup: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { query } = reqContext;
		logger.info(`[${reqContext.requestId} (UC-04)] UserController.familyLookup() called.`);
		try {
			logger.info(`[${reqContext.requestId} (UC-04)] UserController.familyLookup() calling familyLookup().`);
			const result = await familyLookup(query.q);
			logger.info(`[${reqContext.requestId} (UC-04)] UserController.familyLookup() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (UC-04)] UserController.familyLookup() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	getById: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (UC-05)] UserController.getById() called.`);
		const id = parseIntParam(params.id, "user id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (UC-05)] UserController.getById() invalid user id.`);
			return errorResponse(reqContext, "Invalid user id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (UC-05)] UserController.getById() calling getUser().`);
			const result = await getUser(user as any, id);
			logger.info(`[${reqContext.requestId} (UC-05)] UserController.getById() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (UC-05)] UserController.getById() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	create: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		logger.info(`[${reqContext.requestId} (UC-06)] UserController.create() called.`);
		try {
			logger.info(`[${reqContext.requestId} (UC-06)] UserController.create() calling createUser().`);
			const result = await createUser(user as any, body);
			logger.info(`[${reqContext.requestId} (UC-06)] UserController.create() completed.`);
			return successResponse(reqContext, result, ResponseStatus.CREATED);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (UC-06)] UserController.create() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	update: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (UC-07)] UserController.update() called.`);
		const id = parseIntParam(params.id, "user id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (UC-07)] UserController.update() invalid user id.`);
			return errorResponse(reqContext, "Invalid user id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (UC-07)] UserController.update() calling updateUser().`);
			const result = await updateUser(user as any, id, body);
			logger.info(`[${reqContext.requestId} (UC-07)] UserController.update() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (UC-07)] UserController.update() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	remove: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (UC-08)] UserController.remove() called.`);
		const id = parseIntParam(params.id, "user id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (UC-08)] UserController.remove() invalid user id.`);
			return errorResponse(reqContext, "Invalid user id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (UC-08)] UserController.remove() calling deleteUser().`);
			const result = await deleteUser(user, id);
			logger.info(`[${reqContext.requestId} (UC-08)] UserController.remove() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (UC-08)] UserController.remove() error:`, e);
			return errorFromService(reqContext, e);
		}
	},
};
