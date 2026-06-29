import type { Context, StatusMap } from "elysia";
import type { AccessTokenPayload } from "@/middleware/AuthMiddleware";
import type { AuthedRequestContext } from "@/interfaces/ServiceRequest";

/** @deprecated Use `Context` + `authedCtx()` — JWT on `store.user`. */
export type HandlerContext = AuthedRequestContext & {
	user: AccessTokenPayload;
	body: any;
	query: Record<string, any>;
	params: Record<string, string>;
};

export type SetStatus = { status?: number | keyof StatusMap };
