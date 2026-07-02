/**
 * RFID card UID normalization for lookup.
 *
 * Readers emit the same NFC chip UID in different formats:
 * - hex forward:     D183880F
 * - hex reversed:    0F8883D1  (byte order)
 * - decimal:         3515058191
 *
 * DB stores one canonical form (often PowerSchool / kiosk reversed hex).
 * Expand scanned input to all equivalents before matching.
 */

function parseHexUid(s: string): string | null {
  let t = s.trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]+$/.test(t)) return null;
  // Some readers drop a leading 0 nibble (e.g. 0F883D1 vs 0F8883D1).
  if (t.length % 2 === 1) t = `0${t}`;
  return t.toUpperCase();
}

function reverseHexBytes(hex: string): string | null {
  const n = parseHexUid(hex);
  if (!n || n.length < 2) return null;
  const bytes = n.match(/.{2}/g);
  if (!bytes) return null;
  return bytes.reverse().join("");
}

function decimalToHexUid(decimal: string): string | null {
  const d = decimal.trim();
  if (!/^\d+$/.test(d)) return null;
  try {
    let hex = BigInt(d).toString(16).toUpperCase();
    if (hex.length % 2 === 1) hex = `0${hex}`;
    return hex;
  } catch {
    return null;
  }
}

function hexToDecimal(hex: string): string | null {
  const n = parseHexUid(hex);
  if (!n) return null;
  try {
    return BigInt(`0x${n}`).toString(10);
  } catch {
    return null;
  }
}

/** All card_uid string variants to try when matching a scan against the DB. */
export function expandCardUidCandidates(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const out = new Set<string>();
  const add = (v: string | null | undefined) => {
    if (v && v.length > 0) out.add(v);
  };

  add(trimmed);
  add(trimmed.toUpperCase());
  add(trimmed.toLowerCase());

  const hex = parseHexUid(trimmed);
  if (hex) {
    add(hex);
    add(hexToDecimal(hex));
    const rev = reverseHexBytes(hex);
    if (rev) {
      add(rev);
      add(hexToDecimal(rev));
    }
  }

  if (/^\d+$/.test(trimmed)) {
    const fromDec = decimalToHexUid(trimmed);
    if (fromDec) {
      add(fromDec);
      add(reverseHexBytes(fromDec));
    }
  }

  return [...out];
}
