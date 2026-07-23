/**
 * RFID card UID normalization for client-side search/filter.
 *
 * Mirrors backend-bun/src/lib/card_uid.ts — keep the two in sync. Readers
 * emit the same NFC chip UID in different formats (hex forward, hex
 * reversed by byte order, or decimal), so a scanned value typed into a
 * search box needs to be expanded to every equivalent form before matching
 * against a stored card_uid, or a scan in the "wrong" format for that page
 * silently finds nothing.
 */

function parseHexUid(s: string): string | null {
  let t = s.trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]+$/.test(t)) return null;
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

/**
 * Converts a raw scan to the card's canonical hex form — the DB stores
 * byte-reversed hex (e.g. a reader emitting decimal "0030569343" is the same
 * physical card as hex "7F73D201"). Used to make the converted value visible
 * in a search box right after a scan, instead of relying only on the
 * candidate-expansion done at match time.
 */
export function toCanonicalCardUid(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;

  if (/^\d+$/.test(trimmed)) {
    const hex = decimalToHexUid(trimmed);
    const rev = hex ? reverseHexBytes(hex) : null;
    if (rev) return rev;
  }

  const hex = parseHexUid(trimmed);
  if (hex) return hex;

  return trimmed;
}

/** All card_uid string variants to try when matching a scan against a list. */
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
