export const TOPUP_API_MAX_ATTEMPTS = 3;
export const TOPUP_API_RETRY_DELAY_MS = 500;

export async function retryTopupApi<T>(
    fn: () => Promise<T>,
    maxAttempts = TOPUP_API_MAX_ATTEMPTS,
    delayMs = TOPUP_API_RETRY_DELAY_MS,
): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (e) {
            lastError = e;
            if (attempt < maxAttempts) {
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }
    }
    throw lastError;
}
