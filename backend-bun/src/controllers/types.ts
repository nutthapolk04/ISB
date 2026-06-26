import type { Context, StatusMap } from "elysia";
import type { AccessTokenPayload } from "@/middleware/AuthUtils";

/** Elysia context after route schemas + optional requireAuth derive */
export type HandlerContext = Context & {
    user: AccessTokenPayload;
    body: any;
    query: Record<string, any>;
    params: Record<string, string>;
};

export type PublicHandlerContext = Context & {
    body: any;
    query: Record<string, any>;
    params: Record<string, string>;
};

export type SetStatus = { status?: number | keyof StatusMap };
