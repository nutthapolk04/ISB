import { pgClient, pingDb } from "@/db/client";
import { logger } from "@/logger";

let verified = false;

/**
 * Verify the Postgres pool (DATABASE_URL) is reachable at startup.
 * The actual client lives in @/db/client — services import `db` from there.
 */
export async function connectDB(verbose = true): Promise<void> {
  if (verified) return;

  const ok = await pingDb();
  if (!ok) {
    throw new Error("Failed to connect to PostgreSQL — check DATABASE_URL");
  }

  verified = true;

  if (verbose) {
    const [{ current_database: dbName }] = await pgClient<{ current_database: string }[]>`
      SELECT current_database()
    `;
    logger.info(`[Database] Connected to PostgreSQL (${dbName})`);
  }
}

export default connectDB;
