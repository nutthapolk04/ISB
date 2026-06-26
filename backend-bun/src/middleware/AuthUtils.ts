import jwt from "@elysiajs/jwt";
import { Elysia } from "elysia";
import type { UserRole } from "@isb/shared";
import { config } from "@/lib/config";
import { logger } from "@/logger";

export interface AccessTokenPayload {
	sub: string;
	username: string;
	email: string;
	roles: UserRole[];
	is_superuser: boolean;
	// Shop scoping claims (embedded so handlers can scope queries without
	// touching the users table). null = unscoped (admin / regional manager).
	shop_id: string | null;
	shop_module: string | null;
	family_code: string | null;
	exp: number;
	type: "access" | "refresh";
	sid?: string;
}

export const jwtPlugin = new Elysia({ name: "jwt-plugin" }).use(
	jwt({
		name: "jwt",
		secret: config.jwtSecret,
		alg: "HS256",
	}),
);

export const requireAuth = new Elysia({ name: "require-auth" })
	.use(jwtPlugin)
	.derive({ as: "scoped" }, async ({ jwt, headers, set }) => {
		const header = headers["authorization"] ?? headers["Authorization"];
		if (!header || !header.startsWith("Bearer ")) {
			set.status = 401;
			throw new Error("Missing Bearer token");
		}
		const token = header.slice(7);
		const payload = (await jwt.verify(token)) as AccessTokenPayload | false;
		if (!payload || payload.type !== "access") {
			set.status = 401;
			throw new Error("Invalid or expired token");
		}
		return {
			user: payload,
			userId: payload.sub,
			userRoles: payload.roles,
		};
	});

export function hasRole(roles: UserRole[], ...allowed: UserRole[]): boolean {
	return roles.some((r) => allowed.includes(r));
}

export function requireRoles(...allowed: UserRole[]) {
	return new Elysia({ name: `roles:${allowed.join(",")}` }).onBeforeHandle(
		(ctx: any) => {
			const { user, set } = ctx;
			if (!hasRole(user.roles, ...allowed)) {
				set.status = 403;
				throw new Error("Forbidden");
			}
		},
	);
}

/** Hash password with bcrypt (cost 10). */
export async function encodePassword(password: string): Promise<string> {
	return Bun.password.hash(password, {
		algorithm: "bcrypt",
		cost: 10,
	});
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
