import jwt from "@elysiajs/jwt";
import { Elysia, type Context } from "elysia";
import type { UserRole } from "@isb/shared";
import { Role } from "@/enumerate/UserRole";
import ResponseStatus from "@/constants/ResponseStatus";
import { config } from "@/lib/config";
import { logger } from "@/logger";
import { errorResponse } from "@/utils/ResponseUtil";

export interface AccessTokenPayload {
	sub: string;
	username: string;
	email: string;
	roles: UserRole[];
	is_superuser: boolean;
	shop_id: string | null;
	shop_module: string | null;
	family_code: string | null;
	exp: number;
	type: "access" | "refresh";
	sid?: string;
}

type AuthContext = Context & {
	jwt: { verify: (token: string) => Promise<AccessTokenPayload | false> };
	store?: { user?: AccessTokenPayload };
};

export const jwtPlugin = new Elysia({ name: "jwt-plugin" }).use(
	jwt({
		name: "jwt",
		secret: config.jwtSecret,
		alg: "HS256",
	}),
);

function bearerToken(context: Context): string | null {
	const authHeader =
		context.request.headers.get("authorization") ??
		context.request.headers.get("Authorization");
	if (!authHeader?.startsWith("Bearer ")) return null;
	return authHeader.slice(7) || null;
}

export function hasRole(roles: UserRole[], ...allowed: UserRole[]): boolean {
	return roles.some((r) => allowed.includes(r));
}

function rolesFromPayload(user: AccessTokenPayload): UserRole[] {
	return user.roles ?? [];
}

/**
 * Validate Bearer access token and attach payload to `context.store.user`.
 * Returns `true` on success or an error response body.
 */
export async function validateToken(context: AuthContext) {
	try {
		const token = bearerToken(context);
		if (!token) {
			return errorResponse(
				context,
				"Authorization header is required",
				ResponseStatus.UNAUTHORIZED,
			);
		}

		const payload = (await context.jwt.verify(token)) as AccessTokenPayload | false;
		if (!payload || payload.type !== "access") {
			return errorResponse(
				context,
				"Invalid or expired token",
				ResponseStatus.UNAUTHORIZED,
			);
		}

		context.store = { ...context.store, user: payload };
		return true;
	} catch {
		return errorResponse(
			context,
			"Token validation failed",
			ResponseStatus.UNAUTHORIZED,
		);
	}
}

/**
 * Role guard for handlers using `context.store.user` (see `authMiddleware`).
 */
export function validateRole(allowedRoles: (Role | string)[]) {
	return async (context: Context & { store?: { user?: AccessTokenPayload } }) => {
		try {
			const user = context.store?.user;
			if (!user) {
				return errorResponse(
					context,
					"User not authenticated",
					ResponseStatus.UNAUTHORIZED,
				);
			}

			const userRoles = rolesFromPayload(user);
			if (userRoles.length === 0) {
				return errorResponse(
					context,
					"User role not found",
					ResponseStatus.UNAUTHORIZED,
				);
			}

			const allowed = allowedRoles.map((r) => String(r)) as UserRole[];
			if (!hasRole(userRoles, ...allowed)) {
				return errorResponse(
					context,
					`Access denied. Required roles: ${allowed.join(", ")}`,
					ResponseStatus.FORBIDDEN,
				);
			}

			return true;
		} catch (error) {
			return errorResponse(
				context,
				"Role validation failed",
				ResponseStatus.INTERNAL_ERROR,
				error instanceof Error ? error.message : "Unknown error",
			);
		}
	};
}

/** Hash password with bcrypt (cost 10). */
export async function encodePassword(password: string): Promise<string> {
	return Bun.password.hash(password, { algorithm: "bcrypt", cost: 10 });
}

/** Compare plain password against a bcrypt hash from the database. */
export async function validatePassword(
	inputPassword: string,
	storedPassword: string,
): Promise<boolean> {
	try {
		return await Bun.password.verify(inputPassword, storedPassword, "bcrypt");
	} catch (error) {
		logger.error(
			`Password validation error: ${error instanceof Error ? error.message : error}`,
		);
		return false;
	}
}
