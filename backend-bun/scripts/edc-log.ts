/**
 * Collapse the multi-line `[EDC] terminal event` log blocks into one grep-able
 * line each.
 *
 * The logger pretty-prints its metadata, so a single terminal event spans ~14
 * lines in the log file. That is fine for reading one event but useless for
 * `tail -f` on a live POS, and impossible to grep for a combination of fields
 * ("approved but never sent to checkout" needs two lines matched together).
 *
 * Usage:
 *   tail -f logs-uat/2026-08-06.log | bun run scripts/edc-log.ts
 *   bun run scripts/edc-log.ts logs-uat/2026-08-06.log
 *   bun run scripts/edc-log.ts logs-uat/2026-08-06.log --unrecorded
 *
 * Flags:
 *   --unrecorded   only rows the terminal approved that never reached checkout
 *                  (the 2026-08-06 incident shape)
 *   --keys         also print the raw bridge field keys, which is how we find
 *                  out which key actually carries the approval code
 */

export { }; // top-level await needs this file to be a module

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const file = args.find((a) => !a.startsWith("--"));
const onlyUnrecorded = flags.has("--unrecorded");
const showKeys = flags.has("--keys");

const HEADER = "[EDC] terminal event";

interface Block {
    ts: string;
    [k: string]: string;
}

let current: Block | null = null;

/** Pull `"key": value` out of a pretty-printed metadata line. */
function parseField(line: string): [string, string] | null {
    const m = line.match(/^\s*"([^"]+)":\s*(.*?),?\s*$/);
    if (!m) return null;
    return [m[1], m[2].replace(/^"|"$/g, "")];
}

function flush(): void {
    if (!current) return;
    const b = current;
    current = null;

    const approved = b.responseCode === "00" || ["Y1", "Y3", "DR", "DI"].includes(b.responseCode ?? "");
    if (onlyUnrecorded && !(approved && b.checkoutAttempted === "false")) return;

    // Flag the shape that means "money taken, nothing recorded".
    const alarm = approved && b.checkoutAttempted === "false" ? " ⚠ NOT RECORDED" : "";

    const parts = [
        b.ts,
        (b.event ?? "?").padEnd(7),
        (b.context ?? "?").padEnd(12),
        `shop=${(b.shopId ?? "-").padEnd(8)}`,
        `code=${(b.responseCode ?? "-").padEnd(4)}`,
        `appr=${(b.hasApprovalCode ?? "-").padEnd(5)}`,
        `checkout=${(b.checkoutAttempted ?? "-").padEnd(5)}`,
        `THB ${b.amount ?? "-"}`,
    ];
    let line = parts.join("  ") + alarm;
    if (showKeys && b.fieldKeys) {
        // fieldKeys arrives as a JSON-encoded array string; flatten it.
        const keys = b.fieldKeys.replace(/\\n/g, "").replace(/[[\]"\\]/g, "").split(",").map((s) => s.trim()).filter(Boolean);
        line += `\n    keys: ${keys.join(" ")}`;
    }
    console.log(line);
}

function handleLine(line: string): void {
    const idx = line.indexOf(HEADER);
    if (idx >= 0) {
        flush(); // defensive: a truncated previous block should not swallow this one
        current = { ts: line.slice(1, 20) };
        return;
    }
    if (!current) return;
    if (/^\s*\}\s*$/.test(line)) {
        flush();
        return;
    }
    const kv = parseField(line);
    if (kv) current[kv[0]] = kv[1];
}

if (file) {
    const text = await Bun.file(file).text();
    for (const line of text.split("\n")) handleLine(line);
    flush();
} else {
    // Streaming mode for `tail -f` — print each event as it lands.
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of Bun.stdin.stream()) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) handleLine(line);
    }
    if (buffer) handleLine(buffer);
    flush();
}
