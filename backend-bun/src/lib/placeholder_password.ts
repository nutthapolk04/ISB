/**
 * Shared placeholder password for ISB-sync auto-provisioned accounts
 * (parent / staff / student login shells). Admin-created accounts with
 * hand-set passwords never use this value.
 */
export const SYNC_PLACEHOLDER_PASSWORD = "parent";

/** True on deployed environments where password login must not accept the sync placeholder. */
export function passwordLoginBlockedInCurrentEnv(): boolean {
    const env = process.env.APP_ENV ?? "";
    return env === "prod" || env === "uat";
}

export async function isSyncPlaceholderPasswordHash(hashedPassword: string): Promise<boolean> {
    return Bun.password.verify(SYNC_PLACEHOLDER_PASSWORD, hashedPassword);
}
