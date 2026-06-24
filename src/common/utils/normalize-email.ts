/**
 * Canonical email form used for storage and lookups. Centralised so that the
 * value written to the database always matches the value queried against it,
 * giving case-insensitive uniqueness.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
