import { eq } from "drizzle-orm";
import type { Context, StatusMap } from "elysia";
import ResponseStatus from "@/constants/ResponseStatus";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import type { AccessTokenPayload } from "@/middleware/AuthMiddleware";

type AuthContext = Context & {
	store?: { user?: AccessTokenPayload };
	user?: AccessTokenPayload;
	userId?: string;
};

function jwtPayload(ctx: AuthContext): AccessTokenPayload | undefined {
	return ctx.store?.user ?? ctx.user;
}

export function parseIntParam(
	value: string,
	_label: string,
	set: { status?: number | keyof StatusMap },
): number | null {
	const n = Number(value);
	if (!Number.isInteger(n)) {
		set.status = ResponseStatus.UNPROCESSABLE;
		return null;
	}
	return n;
}

/** Numeric user id from JWT (`sub` claim). Prefer `store.user` after requireAuth. */
export function resolveActorId(ctx: AuthContext, fallback?: string): number | null {
	const sub = jwtPayload(ctx)?.sub ?? ctx.userId ?? fallback;
	if (!sub) return null;
	const n = Number(sub);
	return Number.isInteger(n) ? n : null;
}

export async function resolveActor(
	ctx: AuthContext,
	fallback?: string,
): Promise<{ userId: number; username: string } | null> {
	const userId = resolveActorId(ctx, fallback);
	if (!userId) return null;
	const [user] = await db
		.select({ id: users.id, username: users.username })
		.from(users)
		.where(eq(users.id, userId))
		.limit(1);
	if (!user) return null;
	return { userId: user.id, username: user.username ?? "unknown" };
}
