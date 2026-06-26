import { eq } from "drizzle-orm";
import type { Context, StatusMap } from "elysia";
import ResponseStatus from "@/constants/ResponseStatus";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import type { AccessTokenPayload } from "@/middleware/AuthUtils";

type AuthContext = Context & { user?: AccessTokenPayload; userId?: string };

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

/** Numeric user id from JWT (`sub` claim) on an authenticated request. */
export function resolveActorId(ctx: AuthContext, fallback?: string): number | null {
	const sub = ctx.user?.sub ?? ctx.userId ?? fallback;
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
