/** Constant-time string comparison — use for secrets/signatures/API keys to avoid timing attacks. */
export function timingSafeEqual(a: string, b: string): boolean {
    const bufA = new TextEncoder().encode(a);
    const bufB = new TextEncoder().encode(b);
    let diff = bufA.length ^ bufB.length;
    for (let i = 0; i < Math.min(bufA.length, bufB.length); i++) diff |= bufA[i] ^ bufB[i];
    return diff === 0;
}
