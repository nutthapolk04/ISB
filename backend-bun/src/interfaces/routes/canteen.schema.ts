import { t } from "elysia";

export const canteenCloseDay = {
    params: t.Object({ shopId: t.String() }),
    detail: { tags: ["Shops"], summary: "Close canteen day for a shop" },
};
