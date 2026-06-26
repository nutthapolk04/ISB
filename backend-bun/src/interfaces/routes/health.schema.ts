import { t } from "elysia";

export const health = {
    response: t.Object({
        status: t.String(),
        version: t.String(),
        service: t.String(),
        db: t.String(),
        timestamp: t.String(),
    }),
    detail: { tags: ["Health"], summary: "Service health and database connectivity" },
};
