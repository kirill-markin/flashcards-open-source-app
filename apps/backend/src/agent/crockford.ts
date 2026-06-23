import { randomBytes } from "node:crypto";

const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CROCKFORD_RE = /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]+$/;

/**
 * Creates a fixed-length Crockford Base32 token. The emitted alphabet avoids
 * the most ambiguous uppercase letters to make retyping more reliable.
 */
export function createCrockfordToken(length: number): string {
  const chars: Array<string> = [];
  while (chars.length < length) {
    const bytes = randomBytes(length - chars.length);
    for (const byte of bytes) {
      chars.push(CROCKFORD_ALPHABET[byte % CROCKFORD_ALPHABET.length] ?? "");
    }
  }

  return chars.join("");
}

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
