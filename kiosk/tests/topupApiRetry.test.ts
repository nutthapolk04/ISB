import { describe, expect, test } from 'bun:test';
import { retryTopupApi, TOPUP_API_MAX_ATTEMPTS } from '../src/lib/topupApiRetry';

describe('retryTopupApi', () => {
    test('returns on first success', async () => {
        let calls = 0;
        const result = await retryTopupApi(async () => {
            calls += 1;
            return 'ok';
        });
        expect(result).toBe('ok');
        expect(calls).toBe(1);
    });

    test('retries until success', async () => {
        let calls = 0;
        const result = await retryTopupApi(async () => {
            calls += 1;
            if (calls < 3) throw new Error('fail');
            return 42;
        }, 3, 0);
        expect(result).toBe(42);
        expect(calls).toBe(3);
    });

    test('throws after max attempts', async () => {
        let calls = 0;
        await expect(
            retryTopupApi(async () => {
                calls += 1;
                throw new Error('always fail');
            }, TOPUP_API_MAX_ATTEMPTS, 0),
        ).rejects.toThrow('always fail');
        expect(calls).toBe(TOPUP_API_MAX_ATTEMPTS);
    });
});
