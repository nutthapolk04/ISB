/**
 * Demonstrates that RateLimitMiddleware's in-memory Map does NOT survive
 * scale-out: the 300 req/min cap is enforced per-process, so N instances
 * behind a load balancer effectively allow 300*N req/min from one client IP.
 *
 * Usage: bun scripts/test-rate-limit-scaleout.ts
 * Requires a valid .env (DATABASE_URL, JWT_SECRET) — spawns two real
 * server instances against the same DB (schema patches are idempotent).
 */
import { spawn } from "bun";

const PORT_BASELINE = 4100;
const PORT_A = 4101;
const PORT_B = 4102;
const REQUESTS_PER_INSTANCE = 350; // > the 300/min limit

async function waitForHealth(port: number, timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(`http://localhost:${port}/health`);
            if (res.status === 200) return;
        } catch {
            // not up yet
        }
        await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error(`Instance on port ${port} did not become healthy in time`);
}

async function fireRequests(ports: number[], countPerPort: number): Promise<{ ok: number; limited: number }> {
    const tasks: Promise<number>[] = [];
    for (const port of ports) {
        for (let i = 0; i < countPerPort; i++) {
            tasks.push(fetch(`http://localhost:${port}/health`).then((r) => r.status));
        }
    }
    const statuses = await Promise.all(tasks);
    const ok = statuses.filter((s) => s === 200).length;
    const limited = statuses.filter((s) => s === 429).length;
    return { ok, limited };
}

function spawnInstance(port: number) {
    return spawn({
        cmd: ["bun", "src/index.ts"],
        cwd: import.meta.dir + "/..",
        env: { ...process.env, PORT: String(port) },
        stdout: "ignore",
        stderr: "ignore",
    });
}

async function main() {
    // Baseline and scale-out phases use disjoint instances/ports — each
    // instance's 60s rate-limit window must start fresh, otherwise reusing
    // an instance across phases contaminates the result (an instance
    // exhausted by an earlier phase looks "capped" for the wrong reason).
    console.log(`Spawning baseline instance on :${PORT_BASELINE}...`);
    const procBaseline = spawnInstance(PORT_BASELINE);
    try {
        await waitForHealth(PORT_BASELINE);
        console.log(`── Baseline: ${REQUESTS_PER_INSTANCE} requests to a SINGLE instance (port ${PORT_BASELINE}) ──`);
        const baseline = await fireRequests([PORT_BASELINE], REQUESTS_PER_INSTANCE);
        console.log(`  200 OK: ${baseline.ok}   429 Too Many Requests: ${baseline.limited}`);
        console.log(baseline.limited > 0 ? "  -> rate limit correctly kicks in on a single instance.\n" : "  -> unexpected: no requests were limited.\n");
    } finally {
        procBaseline.kill();
    }

    console.log(`Spawning instance A on :${PORT_A} and instance B on :${PORT_B} (both fresh)...`);
    const procA = spawnInstance(PORT_A);
    const procB = spawnInstance(PORT_B);
    try {
        await Promise.all([waitForHealth(PORT_A), waitForHealth(PORT_B)]);
        console.log("Both instances healthy.\n");

        console.log(`── Scale-out: ${REQUESTS_PER_INSTANCE} requests to EACH of 2 FRESH instances (same client IP) ──`);
        const scaleOut = await fireRequests([PORT_A, PORT_B], REQUESTS_PER_INSTANCE);
        console.log(`  Total requests sent: ${REQUESTS_PER_INSTANCE * 2}`);
        console.log(`  200 OK: ${scaleOut.ok}   429 Too Many Requests: ${scaleOut.limited}`);
        if (scaleOut.ok > 300) {
            console.log(`  -> BUG CONFIRMED: ${scaleOut.ok} requests succeeded from one client, well above the intended 300/min cap.`);
        } else {
            console.log("  -> cap held across instances (unexpected if store is still per-process in-memory).");
        }
    } finally {
        procA.kill();
        procB.kill();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
