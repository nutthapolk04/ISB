/**
 * Display rules for the admin User Detail page that are worth pinning.
 */

/**
 * Whether to render the family group card (members + notification/login emails).
 *
 * A `family_code` alone is not enough. An ISB "other" cardholder is a visitor
 * purchase card, not a household member — every family-scoped permission and
 * listing on the backend already excludes the role — yet the card is driven
 * purely by `family_code`, which upsertOther still stores verbatim from ISB's
 * payload (2026-08 decision).
 *
 * That matters because when a parent becomes an "other", ISB stops sending
 * their family in /sync/families ENTIRELY. Nothing reconciles the old
 * household until family_sweep_service fires hours later, and the sweep skips
 * role='other' rows, so if ISB's others payload carries the ORIGINAL family
 * code the card would render that stale household — including the person's own
 * former login email — on their page indefinitely. Hiding it here holds
 * regardless of what ISB sends, of sync timing, and of the sweep.
 */
export function shouldShowFamilyCard(
    role: string | null | undefined,
    familyCode: string | null | undefined,
): boolean {
    if (!familyCode) return false;
    return role !== "other";
}
