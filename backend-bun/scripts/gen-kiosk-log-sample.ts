/**
 * Generate a sample kiosk audit-log file for customer review.
 *
 * The lines are produced by the kiosk's own formatter
 * (`kiosk/src/lib/kioskAuditLog.ts`), not hand-written, so what the customer
 * signs off on is byte-identical to what a device will actually write. Only the
 * timestamp is substituted — `buildAuditLine` always stamps "now", and this
 * script replays a fixed day.
 *
 * IDs, ref codes and transaction ids come from the live database so the shapes
 * are real (`20679`, `TOP-20260807-003-4f1a`, …).
 *
 * Usage:  bun run scripts/gen-kiosk-log-sample.ts [outfile]
 */
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { __test__, formatAuditTimestamp, type BillsCount } from "../../kiosk/src/lib/kioskAuditLog";

const { buildAuditLine } = __test__;

const DAY = "2026-08-07";
const DEVICE_NAME = "Kiosk 2";
const DEVICE_ID = "kiosk_service_2";
const TS_LEN = "2026-08-07 07:02:11+07:00".length;

/** Same line the device writes, re-stamped at `hhmmss` Bangkok time. */
function line(
    hhmmss: string,
    action: Parameters<typeof buildAuditLine>[0],
    fields: Parameters<typeof buildAuditLine>[1],
    trailing?: string[],
): string {
    const built = buildAuditLine(action, fields, trailing);
    const ts = formatAuditTimestamp(new Date(`${DAY}T${hhmmss}+07:00`));
    return ts + built.slice(TS_LEN);
}

function bills(counts: BillsCount): string[] {
    const s = __test__.formatBillsField(counts);
    return s ? [s] : [];
}

interface Person { isbId: string; walletId: number }

async function loadPeople(): Promise<Person[]> {
    const rows = (await db.execute(sql`
        SELECT c.external_id AS isb_id, w.id AS wallet_id
        FROM customers c
        JOIN wallets w ON w.customer_id = c.id
        WHERE c.external_id IS NOT NULL AND c.customer_kind = 'student'
        ORDER BY c.id
        LIMIT 3
    `)) as unknown as Array<{ isb_id: string; wallet_id: number }>;
    if (rows.length < 3) throw new Error("need at least 3 students with an external_id");
    return rows.map((r) => ({ isbId: r.isb_id, walletId: Number(r.wallet_id) }));
}

async function nextTxnId(): Promise<number> {
    const [r] = (await db.execute(
        sql`SELECT COALESCE(MAX(id), 0) + 1 AS n FROM wallet_transactions`,
    )) as unknown as Array<{ n: number }>;
    return Number(r.n);
}

async function main(): Promise<void> {
    const [a, b, c] = await loadPeople();
    let txn = await nextTxnId();
    const nextTxn = (): number => txn++;

    // Cash refs are crypto.randomUUID() on the device; QR refs are the payment
    // intent's ref_code. Both are reproduced verbatim in shape.
    const cashRef = (n: number) => `7f3a1c${n}e-4b2d-4a91-9c${n}0-2e6b8d4a71c${n}`;
    const qrRef = (n: number, suffix: string) => `TOP-20260807-00${n}-${suffix}`;

    const lines: string[] = [
        // ── The one non-audit line the kiosk can emit (kioskStore.ts:105).
        //    It goes through logKioskEvent('system', …) directly, so it carries
        //    no timestamp and no [ACTION] tag — shown here as-is rather than
        //    tidied up, because this is what a real export would contain.
        "Bootstrap failed: Network request failed",

        // ── Morning: network not up yet. Only failures are logged; the
        //    recovery is silent, which is why there is no matching "ok" line.
        line("07:02:11", "PING", { status: "failed", reason: "Network request failed" }),
        line("07:03:11", "PING", { status: "failed", reason: "Network request failed" }),

        // ── Cash top-up, straight through.
        line("07:31:04", "TAP", { isb_id: a.isbId }),
        line("07:31:22", "TOPUP", {
            ref: cashRef(1), method: "CASH", payer_id: a.isbId, receiver_id: a.isbId,
            target_amount: 500, status: "begin",
        }),
        line("07:32:03", "TOPUP", {
            ref: cashRef(1), method: "CASH", payer_id: a.isbId, receiver_id: a.isbId,
            target_amount: 500, actual_amount: 500, status: "success",
        }, [...bills({ 500: 1 }), `transaction_id=${nextTxn()}`]),

        // ── QR top-up, straight through. Sibling receives; payer is the tapped card.
        line("08:05:12", "TAP", { isb_id: a.isbId }),
        line("08:05:30", "TOPUP", {
            ref: qrRef(1, "4f1a"), method: "QR", payer_id: a.isbId, receiver_id: b.isbId,
            target_amount: 300, status: "begin",
        }),
        line("08:06:58", "TOPUP", {
            ref: qrRef(1, "4f1a"), method: "QR", payer_id: a.isbId, receiver_id: b.isbId,
            target_amount: 300, actual_amount: 300, status: "success",
        }, [`transaction_id=${nextTxn()}`]),

        // ── Cash cancelled after one note was already stacked. The 100 is in
        //    the box and has to reconcile against CLEAR-CASH-BOX below.
        line("08:41:37", "TAP", { isb_id: c.isbId }),
        line("08:41:55", "TOPUP", {
            ref: cashRef(2), method: "CASH", payer_id: c.isbId, receiver_id: c.isbId,
            target_amount: 1000, status: "begin",
        }),
        line("08:43:12", "TOPUP", {
            ref: cashRef(2), method: "CASH", payer_id: c.isbId, receiver_id: c.isbId,
            target_amount: 1000, actual_amount: 100, status: "cancelled",
        }, bills({ 100: 1 })),

        // ── Cash abandoned mid-session — idle timeout with 1,500 stacked.
        line("09:15:02", "TAP", { isb_id: a.isbId }),
        line("09:15:19", "TOPUP", {
            ref: cashRef(3), method: "CASH", payer_id: a.isbId, receiver_id: a.isbId,
            target_amount: 2000, status: "begin",
        }),
        line("09:17:49", "TOPUP", {
            ref: cashRef(3), method: "CASH", payer_id: a.isbId, receiver_id: a.isbId,
            target_amount: 2000, actual_amount: 1500, status: "timeout",
        }, bills({ 1000: 1, 500: 1 })),

        // ── The case the log exists for: cash taken, server unreachable. The
        //    device keeps the pending top-up and retries; note the same `ref`
        //    on both lines and retry=true on the second.
        line("10:02:31", "TAP", { isb_id: b.isbId }),
        line("10:02:44", "TOPUP", {
            ref: cashRef(4), method: "CASH", payer_id: b.isbId, receiver_id: b.isbId,
            target_amount: 700, status: "begin",
        }),
        line("10:03:58", "TOPUP", {
            ref: cashRef(4), method: "CASH", payer_id: b.isbId, receiver_id: b.isbId,
            target_amount: 700, actual_amount: 700, status: "failed",
        }, [...bills({ 500: 1, 100: 2 }), 'reason="Network request failed"']),
        line("10:05:12", "TOPUP", {
            ref: cashRef(4), method: "CASH", payer_id: b.isbId, receiver_id: b.isbId,
            target_amount: 700, actual_amount: 700, status: "success",
        }, [...bills({ 500: 1, 100: 2 }), `transaction_id=${nextTxn()}`, "retry=true"]),

        // ── QR expired without being scanned.
        line("11:20:44", "TAP", { isb_id: c.isbId }),
        line("11:20:58", "TOPUP", {
            ref: qrRef(2, "9b73"), method: "QR", payer_id: c.isbId, receiver_id: c.isbId,
            target_amount: 500, status: "begin",
        }),
        line("11:25:58", "TOPUP", {
            ref: qrRef(2, "9b73"), method: "QR", payer_id: c.isbId, receiver_id: c.isbId,
            target_amount: 500, actual_amount: 0, status: "timeout",
        }),

        // ── QR cancelled by the user.
        line("12:47:03", "TAP", { isb_id: a.isbId }),
        line("12:47:21", "TOPUP", {
            ref: qrRef(3, "c204"), method: "QR", payer_id: a.isbId, receiver_id: a.isbId,
            target_amount: 200, status: "begin",
        }),
        line("12:47:52", "TOPUP", {
            ref: qrRef(3, "c204"), method: "QR", payer_id: a.isbId, receiver_id: a.isbId,
            target_amount: 200, actual_amount: 0, status: "cancelled",
        }),

        // ── QR rejected by the gateway.
        line("13:30:16", "TAP", { isb_id: b.isbId }),
        line("13:30:33", "TOPUP", {
            ref: qrRef(4, "e18d"), method: "QR", payer_id: b.isbId, receiver_id: b.isbId,
            target_amount: 1000, status: "begin",
        }),
        line("13:31:47", "TOPUP", {
            ref: qrRef(4, "e18d"), method: "QR", payer_id: b.isbId, receiver_id: b.isbId,
            target_amount: 1000, actual_amount: 0, status: "failed",
        }, ['reason="Payment rejected by gateway (RC=14)"']),

        // ── End of day: technician opens the cabinet, empties the box, locks up.
        //    2,800 = 500 + 100 + 1,500 + 700 — every stacked note above.
        line("16:40:05", "UNLOCK", {}),
        line("16:41:38", "CLEAR-CASH-BOX", { amount: 2800 }, bills({ 1000: 1, 500: 3, 100: 3 })),
        line("16:45:12", "LOCK", {}),
    ];

    const header = [
        `Kiosk device: ${DEVICE_NAME} (${DEVICE_ID})`,
        `Exported: ${DAY}T17:00:00.000Z`,
        `Day: ${DAY}`,
        "---",
    ];

    const out = [...header, ...lines].join("\n") + "\n";
    const path = process.argv[2] ?? `../docs/kiosk/kiosk-log-sample-${DAY}.txt`;
    await Bun.write(path, out);
    console.log(`${lines.length} lines → ${path}`);
}

await main();
process.exit(0);
