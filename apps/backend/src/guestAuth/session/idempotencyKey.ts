import { HttpError } from "../../shared/errors";

// The key can rotate a lost-response credential: it must stay secret and random per attempt.
// Shape validation cannot prove randomness; lifecycle instructions live in docs/auth-service.md.
const guestSessionIdempotencyKeyMinimumLength = 32;
const guestSessionIdempotencyKeyMaximumLength = 200;
const guestSessionIdempotencyKeyPattern = /^[0-9a-f]+$/;

export function parseGuestSessionIdempotencyKeyValue(value: unknown): string | null {
  // An explicit JSON null means absent, not invalid. Serializers that encode unset optional fields
  // rather than omitting them — kotlinx.serialization does by default — send it on every no-key
  // call, and that path must stay the shipped-client behaviour instead of a 400.
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value !== "string"
    || value.length < guestSessionIdempotencyKeyMinimumLength
    || value.length > guestSessionIdempotencyKeyMaximumLength
    || !guestSessionIdempotencyKeyPattern.test(value)
  ) {
    throw new HttpError(
      400,
      `idempotencyKey must be ${guestSessionIdempotencyKeyMinimumLength} to ${guestSessionIdempotencyKeyMaximumLength} lowercase hexadecimal characters generated randomly for one creation attempt`,
      "GUEST_SESSION_IDEMPOTENCY_KEY_INVALID",
    );
  }

  return value;
}

