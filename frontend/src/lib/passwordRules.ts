/**
 * Password policy used across all create/change-password flows.
 *
 * Kept as plain data so the rules render identically in every form (Create
 * User, Change Password, Cardholder, Shop User…) without copy-pasting the
 * checklist UI. The backend must mirror these checks — see
 * backend/app/services/user_service.py.
 */

export interface PasswordRule {
  /** Stable key for translation lookup + React `key` attribute. */
  key: string;
  /** English label used when the i18n key is missing. */
  label: string;
  /** Pure function: true when the rule passes. */
  test: (pw: string) => boolean;
}

export const PASSWORD_RULES: readonly PasswordRule[] = [
  {
    key: "minLength",
    label: "At least 8 characters",
    test: (pw) => pw.length >= 8,
  },
  {
    key: "upperAndLower",
    label: "Upper- and lower-case letters",
    test: (pw) => /[A-Z]/.test(pw) && /[a-z]/.test(pw),
  },
  {
    key: "digit",
    label: "At least one number",
    test: (pw) => /\d/.test(pw),
  },
  {
    key: "special",
    label: "At least one special character (!@#$%^&*…)",
    test: (pw) => /[^A-Za-z0-9]/.test(pw),
  },
];

/** Returns true when every rule passes. Empty string never satisfies. */
export function isPasswordValid(pw: string): boolean {
  if (!pw) return false;
  return PASSWORD_RULES.every((r) => r.test(pw));
}

/** Returns the i18n key for a rule's localized label. */
export function passwordRuleI18nKey(rule: PasswordRule): string {
  return `passwordRules.${rule.key}`;
}
