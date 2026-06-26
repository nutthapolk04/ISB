import { and, eq } from "drizzle-orm";
import { db, pgClient } from "@/db/client";
import { users, roles, userRoles, permissions, rolePermissions, shops } from "@/db/schema";
import { config } from "@/lib/config";

const ACCESS_TOKEN_EXPIRE_MINUTES = 30;
const REFRESH_TOKEN_EXPIRE_DAYS = 7;

export interface TokenResponseDTO {
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
}

export interface RoleResponseDTO {
  id: number;
  name: string;
  description: string | null;
}

export interface UserResponseDTO {
  id: number;
  username: string;
  email: string;
  full_name: string;
  is_active: boolean;
  is_superuser: boolean;
  role: string | null;
  roles: RoleResponseDTO[];
  shop_id: string | null;
  shop_module: string | null;
  family_code: string | null;
}

export interface MeResponseDTO {
  user: UserResponseDTO;
  permissions: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64");
}

function signHs256(data: string, secret: string): string {
  const h = new Bun.CryptoHasher("sha256", secret);
  h.update(data);
  return base64url(h.digest());
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export interface AccessTokenClaims {
  sub: string;
  username: string;
  email: string;
  roles: string[];
  is_superuser: boolean;
  // Shop scoping — embedded so request handlers can clamp queries to the
  // caller's shop without re-querying the users table on every request.
  // null = unscoped (e.g. admin or multi-shop manager).
  shop_id: string | null;
  shop_module: string | null;
  family_code: string | null;
  exp: number;
  type: "access";
  sid?: string;
}

interface RefreshClaims {
  sub: string;
  exp: number;
  type: "refresh";
}

function encodeJwt(payload: object): string {
  const header = { alg: "HS256", typ: "JWT" };
  const body = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const sig = signHs256(body, config.jwtSecret);
  return `${body}.${sig}`;
}

function decodeJwt<T>(token: string): T {
  const parts = token.split(".");
  if (parts.length !== 3) {
    const err = new Error("Malformed token");
    (err as { status?: number }).status = 401;
    throw err;
  }
  const [headerB64, payloadB64, sig] = parts;
  const expected = signHs256(`${headerB64}.${payloadB64}`, config.jwtSecret);
  if (!timingSafeEqualStr(sig, expected)) {
    const err = new Error("Invalid token signature");
    (err as { status?: number }).status = 401;
    throw err;
  }
  const payload = JSON.parse(base64urlDecode(payloadB64).toString()) as T & { exp?: number };
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    const err = new Error("Token expired");
    (err as { status?: number }).status = 401;
    throw err;
  }
  return payload;
}

function generateSessionToken(): string {
  return crypto.getRandomValues(new Uint8Array(32))
    .reduce((s, b) => s + b.toString(16).padStart(2, "0"), "");
}

async function getRoleNames(userId: number): Promise<RoleResponseDTO[]> {
  return db
    .select({ id: roles.id, name: roles.name, description: roles.description })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId));
}

async function getPermissionNames(userId: number): Promise<string[]> {
  const rows = await db
    .selectDistinct({ name: permissions.name })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(userRoles.userId, userId));
  return rows.map((r) => r.name).sort();
}

// ── Authentication ────────────────────────────────────────────────────────

async function findUserByUsername(username: string): Promise<typeof users.$inferSelect | null> {
  const rows = await db.select().from(users).where(eq(users.username, username)).limit(1);
  return rows[0] ?? null;
}

async function findUserById(id: number): Promise<typeof users.$inferSelect | null> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function login(username: string, password: string): Promise<TokenResponseDTO> {
  const user = await findUserByUsername(username);
  if (!user) {
    const err = new Error("Invalid username or password");
    (err as { status?: number }).status = 401;
    throw err;
  }
  // Bun.password.verify handles bcrypt $2a / $2b / $2y prefixes natively.
  const ok = await Bun.password.verify(password, user.hashedPassword);
  if (!ok) {
    const err = new Error("Invalid username or password");
    (err as { status?: number }).status = 401;
    throw err;
  }
  if (!user.isActive) {
    const err = new Error("Account is inactive");
    (err as { status?: number }).status = 403;
    throw err;
  }
  return createTokens(user);
}

export async function createTokens(user: typeof users.$inferSelect): Promise<TokenResponseDTO> {
  const sid = generateSessionToken();
  await db.update(users).set({ sessionToken: sid }).where(eq(users.id, user.id));

  // Roles: prefer the user_roles M2M table (RBAC), fall back to the legacy
  // users.role column for accounts that haven't been migrated to RBAC yet
  // (PowerSchool-seeded parents/students typically only have users.role set).
  const roleNamesFromRbac = (await getRoleNames(user.id)).map((r) => r.name);
  const roleNames = roleNamesFromRbac.length > 0
    ? roleNamesFromRbac
    : (user.role ? [user.role] : []);
  // Derive shop capability from shop_id: a user assigned to a shop must be
  // able to operate that shop's POS even when their primary RBAC role is
  // something else (e.g. a parent who is also a shop manager).
  const SHOP_ROLES = ["manager", "cashier", "kitchen", "canteen_owner"];
  if (user.shopId && !roleNames.some((r) => SHOP_ROLES.includes(r))) {
    roleNames.push("manager");
  }
  const now = Math.floor(Date.now() / 1000);
  const accessClaims: AccessTokenClaims = {
    sub: String(user.id),
    username: user.username,
    email: user.email,
    roles: roleNames,
    is_superuser: user.isSuperuser,
    shop_id: user.shopId ?? null,
    shop_module: user.shopModule ?? null,
    family_code: user.familyCode ?? null,
    exp: now + ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    type: "access",
    sid,
  };
  const refreshClaims: RefreshClaims = {
    sub: String(user.id),
    exp: now + REFRESH_TOKEN_EXPIRE_DAYS * 86_400,
    type: "refresh",
  };
  return {
    access_token: encodeJwt(accessClaims),
    refresh_token: encodeJwt(refreshClaims),
    token_type: "bearer",
  };
}

export async function refresh(refreshToken: string): Promise<TokenResponseDTO> {
  const claims = decodeJwt<RefreshClaims>(refreshToken);
  if (claims.type !== "refresh") {
    const err = new Error("Not a refresh token");
    (err as { status?: number }).status = 401;
    throw err;
  }
  const user = await findUserById(Number(claims.sub));
  if (!user || !user.isActive) {
    const err = new Error("User not found or inactive");
    (err as { status?: number }).status = 401;
    throw err;
  }
  return createTokens(user);
}

export async function logout(userId: number): Promise<void> {
  // Invalidate by rotating session_token so any outstanding access token's `sid`
  // claim no longer matches.
  await db.update(users).set({ sessionToken: null }).where(eq(users.id, userId));
}

// ── User × Role management (admin only) ───────────────────────────────────

async function notFoundUser(): Promise<never> {
  const err = new Error("User not found") as Error & { status?: number };
  err.status = 404;
  throw err;
}

export async function listUserRoles(userId: number): Promise<RoleResponseDTO[]> {
  const user = await findUserById(userId);
  if (!user) await notFoundUser();
  return getRoleNames(userId);
}

export async function assignRoleToUser(
  userId: number,
  roleName: string,
): Promise<RoleResponseDTO[]> {
  const name = roleName.trim();
  if (!name) {
    const err = new Error("role_name is required") as Error & { status?: number };
    err.status = 400;
    throw err;
  }

  const user = await findUserById(userId);
  if (!user) await notFoundUser();

  // Upsert role by name — auto-create if missing (mirrors FastAPI behaviour)
  let roleRow = (await db.select().from(roles).where(eq(roles.name, name)).limit(1))[0];
  if (!roleRow) {
    const [inserted] = await db
      .insert(roles)
      .values({
        name,
        description: `Auto-created for ${name}`,
        isActive: true,
      })
      .returning();
    roleRow = inserted;
  }

  // Idempotent link
  const existing = await db
    .select()
    .from(userRoles)
    .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleRow.id)))
    .limit(1);
  if (existing.length === 0) {
    await db.insert(userRoles).values({ userId, roleId: roleRow.id });
  }

  return getRoleNames(userId);
}

export async function removeRoleFromUser(
  userId: number,
  roleName: string,
): Promise<RoleResponseDTO[]> {
  const user = await findUserById(userId);
  if (!user) await notFoundUser();

  const roleRow = (await db.select().from(roles).where(eq(roles.name, roleName)).limit(1))[0];
  if (roleRow) {
    await db
      .delete(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleRow.id)));
  }

  return getRoleNames(userId);
}

export async function me(userId: number): Promise<MeResponseDTO> {
  const user = await findUserById(userId);
  if (!user) {
    const err = new Error("User not found");
    (err as { status?: number }).status = 404;
    throw err;
  }
  const [rbacRoles, perms] = await Promise.all([
    getRoleNames(user.id),
    getPermissionNames(user.id),
  ]);

  let shopModule: string | null = user.shopModule ?? null;
  if (!shopModule && user.shopId) {
    const sr = await db.select({ module: shops.module }).from(shops).where(eq(shops.id, user.shopId)).limit(1);
    if (sr[0]) shopModule = sr[0].module;
  }

  return {
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      full_name: user.fullName,
      is_active: user.isActive,
      is_superuser: user.isSuperuser,
      role: user.role ?? null,
      roles: rbacRoles.length > 0
        ? rbacRoles
        : (user.role ? [{ id: 0, name: user.role, description: null }] : []),
      shop_id: user.shopId ?? null,
      shop_module: shopModule,
      family_code: user.familyCode ?? null,
    },
    permissions: perms,
  };
}

// ── Mock SSO (lookup by email) ────────────────────────────────────────────

export async function mockSso(email: string): Promise<TokenResponseDTO> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || !trimmed.includes("@")) {
    const err = new Error("Valid email required");
    (err as { status?: number }).status = 400;
    throw err;
  }
  const rows = await db.select().from(users).where(eq(users.email, trimmed)).limit(1);
  const user = rows[0];
  if (!user) {
    const err = new Error("This email is not registered in the system. Please contact your school administrator.");
    (err as { status?: number }).status = 404;
    throw err;
  }
  if (!user.isActive) {
    const err = new Error("Account is inactive");
    (err as { status?: number }).status = 403;
    throw err;
  }
  return createTokens(user);
}

export async function googleSso(accessToken: string): Promise<TokenResponseDTO> {
  if (!accessToken) {
    const err = new Error("access_token is required");
    (err as { status?: number }).status = 400;
    throw err;
  }
  let userinfo: { email?: string; email_verified?: boolean };
  try {
    const resp = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) {
      const err = new Error("Invalid or expired Google token");
      (err as { status?: number }).status = 401;
      throw err;
    }
    userinfo = (await resp.json()) as { email?: string; email_verified?: boolean };
  } catch (e) {
    if ((e as { status?: number }).status) throw e;
    const err = new Error("Cannot reach Google authentication service");
    (err as { status?: number }).status = 503;
    throw err;
  }
  const email = (userinfo.email ?? "").trim().toLowerCase();
  if (!email) {
    const err = new Error("Email not found in Google token");
    (err as { status?: number }).status = 400;
    throw err;
  }
  if (!userinfo.email_verified) {
    const err = new Error("Google email is not verified");
    (err as { status?: number }).status = 400;
    throw err;
  }
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0];
  if (!user) {
    const err = new Error("This Google account is not registered in the system. Please contact your school administrator.");
    (err as { status?: number }).status = 404;
    throw err;
  }
  if (!user.isActive) {
    const err = new Error("Account is inactive");
    (err as { status?: number }).status = 403;
    throw err;
  }
  return createTokens(user);
}
