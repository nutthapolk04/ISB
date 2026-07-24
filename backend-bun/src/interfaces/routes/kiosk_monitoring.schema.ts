import { t } from "elysia";

export const kioskMonitoringList = {
    detail: { tags: ["Admin"], summary: "List kiosks with online/offline status and assigned custodians" },
};

export const kioskMonitoringSetCustodians = {
    params: t.Object({ kiosk_user_id: t.String() }),
    body: t.Object({
        custodian_user_ids: t.Array(t.Number()),
    }),
    detail: { tags: ["Admin"], summary: "Replace the set of staff notified when this kiosk goes offline/online" },
};
