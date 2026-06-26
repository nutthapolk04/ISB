import { Elysia, type Context } from "elysia";
import type { UserRole } from "@isb/shared";
import { Role } from "@/enumerate/UserRole";
import {
	type AccessTokenPayload,
	jwtPlugin,
	validateRole,
	validateToken,
	hasRole,
} from "@/utils/AuthUtils";

export type { AccessTokenPayload };
export { hasRole, jwtPlugin };

/**
 * Per-route auth guard: validates JWT then optional roles.
 * Requires `jwtPlugin` on the same app/plugin chain.
 */
export const authMiddleware = (allowedRoles?: (Role | string)[]) => {
	return async (context: Context & { jwt: unknown; store?: { user?: AccessTokenPayload } }) => {
		const tokenResult = await validateToken(context as Parameters<typeof validateToken>[0]);
		if (tokenResult !== true) return tokenResult;

		if (allowedRoles && allowedRoles.length > 0) {
			const roleResult = await validateRole(allowedRoles)(context);
			if (roleResult !== true) return roleResult;
		}
	};
};

/** JWT auth — validates in derive, sets `store.user`, exposes `user` for handlers. */
export const requireAuth = new Elysia({ name: "require-auth" })
	.use(jwtPlugin)
	.derive({ as: "scoped" }, async (ctx: any) => {
		const header = ctx.headers["authorization"] ?? ctx.headers["Authorization"];
		if (!header || !header.startsWith("Bearer ")) {
			ctx.set.status = 401;
			throw new Error("Missing Bearer token");
		}
		const token = header.slice(7);
		const payload = (await ctx.jwt.verify(token)) as AccessTokenPayload | false;
		if (!payload || payload.type !== "access") {
			ctx.set.status = 401;
			throw new Error("Invalid or expired token");
		}
		ctx.store = { ...ctx.store, user: payload };
		return {
			user: payload,
			userId: payload.sub,
			userRoles: payload.roles,
		};
	});

export function requireRoles(...allowed: UserRole[]) {
	return new Elysia({ name: `roles:${allowed.join(",")}` }).onBeforeHandle((ctx: any) => {
		const user = ctx.store?.user;
		if (!user || !hasRole(user.roles, ...allowed)) {
			ctx.set.status = 403;
			throw new Error("Forbidden");
		}
	});
}
