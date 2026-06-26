/**
 * Service Request Interfaces
 * ---------------------------------------------------------------
 * Base context injected into Elysia (e.g. requestId for tracing).
 * Authed routes: JWT payload on `store.user` (see validateToken / requireAuth).
 */
import type { AccessTokenPayload } from "@/middleware/AuthMiddleware";
import type { Context } from "elysia";

export interface RequestContext extends Context {
    requestId: string;
    body: any;
}

export interface AuthedRequestContext extends RequestContext {
    store: { user: AccessTokenPayload };
}

export function authedUser(ctx: AuthedRequestContext): AccessTokenPayload {
    return ctx.store.user;
}

/** Authed handler setup: reqContext + JWT user from store. */
export function authedCtx(ctx: Context) {
    const reqContext = ctx as AuthedRequestContext;
    const user = reqContext.store?.user ?? (ctx as { user?: AccessTokenPayload }).user;
    if (!user) {
        throw new Error("Missing authenticated user on context");
    }
    if (!reqContext.store?.user) {
        reqContext.store = { ...reqContext.store, user };
    }
    return { reqContext, user };
}

/** Public handler setup. */
export function publicCtx(ctx: Context) {
    return ctx as RequestContext;
}
