/** Top-up report — show full name with ISB external_id in parentheses. */

export interface TopupPartyRow {
  topped_by: string;
  topped_by_external_id?: string | null;
  recipient_name: string;
  recipient_external_id?: string | null;
  recipient_code?: string | null;
}

export function formatTopupPartyName(
  name: string,
  externalId?: string | null,
  fallbackCode?: string | null,
): string {
  const suffix = externalId?.trim() || fallbackCode?.trim();
  if (!suffix || suffix === "—" || !name || name === "—") return name;
  return `${name} (${suffix})`;
}

export function formatTopupToppedBy(row: Pick<TopupPartyRow, "topped_by" | "topped_by_external_id">): string {
  return formatTopupPartyName(row.topped_by, row.topped_by_external_id);
}

export function formatTopupRecipient(
  row: Pick<TopupPartyRow, "recipient_name" | "recipient_external_id" | "recipient_code">,
): string {
  return formatTopupPartyName(row.recipient_name, row.recipient_external_id, row.recipient_code);
}
