/**
 * Load test harness — capacity planning per docs/perf-security-loadtest-plan-TH.html §4.
 * Baseline = 300 req/min (matches the global rate limit). Run at 1x/2x/5x/6x to see
 * how the system behaves as load climbs past the configured limit.
 *
 * Usage (from backend-bun/):
 *   bun run loadtest -- --multiplier 1
 *   bun run loadtest -- --multiplier 5 --url http://18.139.154.196:19500 --path /api/v1/admin/settings/public
 *   bun run loadtest -- --multiplier 2 --duration 30
 */
import autocannon from "autocannon";

const BASELINE_RPM = 300;

function argValue(flag: string, fallback: string): string {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const multiplier = Number(argValue("--multiplier", "1"));
const baseUrl = argValue("--url", process.env.LOADTEST_URL ?? "http://localhost:3001");
const path = argValue("--path", "/api/v1/admin/settings/public");
const duration = Number(argValue("--duration", "60"));

const overallRate = Math.round((BASELINE_RPM / 60) * multiplier);
const connections = Math.max(10, overallRate);

console.log(
  `Target: ${baseUrl}${path} | multiplier: ${multiplier}x | rate: ${overallRate} req/s (${overallRate * 60} req/min) | duration: ${duration}s | connections: ${connections}`,
);

const result = await autocannon({
  url: `${baseUrl}${path}`,
  connections,
  overallRate,
  duration,
});

const statusCodes = result.statusCodeStats ?? {};
console.log("\n=== Results ===");
console.log(`Requests: ${result.requests.total} total, ${result.requests.average.toFixed(1)}/s average`);
console.log(
  `Latency (ms): p50=${result.latency.p50} p95=${result.latency.p97_5} p99=${result.latency.p99} max=${result.latency.max}`,
);
console.log(`2xx: ${result["2xx"] ?? 0}  Non-2xx/errors: ${result.non2xx ?? 0}  Timeouts: ${result.timeouts}`);
console.log("Status codes:", statusCodes);
