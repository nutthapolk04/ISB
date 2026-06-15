import { Elysia } from "elysia";
import jwt from "@elysiajs/jwt";
import { config } from "@/lib/config";
import type { UserRole } from "@isb/shared";

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
