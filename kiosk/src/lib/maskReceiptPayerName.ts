/**
 * Mask payer name on kiosk receipts for privacy.
 * First name + first letter of last name + XXXX; middle names are dropped.
 * e.g. "John Noel Smit" → "John SXXXX", "Alizabeth Jane Olsen" → "Alizabeth OXXXX",
 * "Dwayne Johnson" → "Dwayne JXXXX"
 */
export function maskReceiptPayerName(fullName: string | null | undefined): string {
    if (!fullName?.trim()) return fullName ?? '';
    if (fullName.includes('Kiosk') || fullName.includes('Service Account')) {
        return fullName;
    }
    const parts = fullName.trim().split(/\s+/);
    if (parts.length < 2) return fullName.trim();
    const firstName = parts[0];
    const lastName = parts[parts.length - 1];
    const lastInitial = lastName[0];
    if (!lastInitial) return firstName;
    return `${firstName} ${lastInitial}XXXX`;
}
