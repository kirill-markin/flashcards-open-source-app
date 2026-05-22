const CROCKFORD_RE = /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]+$/;

/**
 * Normalizes a human-entered Crockford Base32 token by removing spaces and
 * hyphens, then uppercasing before validation.
 */
export function normalizeCrockfordToken(value: string, fieldName: string): string {
  const normalized = value.replace(/[\s-]/g, "").toUpperCase();
  if (normalized === "") {
    throw new Error(`${fieldName} must not be empty`);
  }

  if (!CROCKFORD_RE.test(normalized)) {
    throw new Error(`${fieldName} must use Crockford Base32 characters`);
  }

  return normalized;
}
