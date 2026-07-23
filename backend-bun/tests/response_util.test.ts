import { describe, expect, it } from "bun:test";
import { errorFromService } from "@/utils/ResponseUtil";

function mockCtx() {
	return {
		set: { status: 200 as number | string | undefined },
		requestId: "test-req-id",
	};
}

describe("errorFromService", () => {
	it("returns plain string detail when service error has no code", () => {
		const ctx = mockCtx();
		const err = new Error("Wallet not found");
		(err as { status?: number }).status = 404;

		const body = errorFromService(ctx as never, err);

		expect(ctx.set.status).toBe(404);
		expect(body).toEqual({ detail: "Wallet not found" });
	});

	it("returns structured detail when service error has code", () => {
		const ctx = mockCtx();
		const err = new Error("ยอด wallet จะติดลบเกินขีดจำกัด");
		(err as { status?: number; code?: string; params?: Record<string, unknown> }).status = 400;
		(err as { code?: string }).code = "EXCEEDS_NEGATIVE_CREDIT_LIMIT";
		(err as { params?: Record<string, unknown> }).params = {
			balance: "50.00",
			amount: "80.00",
			maxOverdraft: "0.00",
		};

		const body = errorFromService(ctx as never, err);

		expect(ctx.set.status).toBe(400);
		expect(body).toEqual({
			detail: {
				code: "EXCEEDS_NEGATIVE_CREDIT_LIMIT",
				message: "ยอด wallet จะติดลบเกินขีดจำกัด",
				params: {
					balance: "50.00",
					amount: "80.00",
					maxOverdraft: "0.00",
				},
			},
		});
	});

	it("includes params and maps blocking to blocking_shops", () => {
		const ctx = mockCtx();
		const blocking = [{ id: "canteen", name: "Canteen" }];
		const err = new Error("Cannot delete — 1 shop(s) still linked.");
		Object.assign(err, {
			status: 409,
			code: "GROUP_HAS_LINKED_SHOPS",
			params: { count: 1 },
			blocking,
		});

		const body = errorFromService(ctx as never, err);

		expect(ctx.set.status).toBe(409);
		expect(body).toEqual({
			detail: {
				code: "GROUP_HAS_LINKED_SHOPS",
				message: "Cannot delete — 1 shop(s) still linked.",
				params: { count: 1 },
				blocking_shops: blocking,
			},
		});
	});

	it("rethrows unexpected errors without status", () => {
		const ctx = mockCtx();
		const err = new Error("connection reset");
		expect(() => errorFromService(ctx as never, err)).toThrow("connection reset");
	});
});
