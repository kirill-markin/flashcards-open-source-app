-- Migration status: Current / additive.
-- Introduces: auth.guest_sessions.creation_idempotency_key, so a client that lost the response to
--   POST /guest-auth/session can retry the same key and be handed its existing guest identity back
--   instead of leaking a second guest user, a second workspace and a second analytics actor for one
--   device, plus the partial unique index that holds the at-most-one-live-session-per-key invariant
--   the creation path enforces.
-- Schemas touched/read explicitly: auth.

ALTER TABLE auth.guest_sessions
  ADD COLUMN IF NOT EXISTS creation_idempotency_key TEXT;

-- Partial for both predicates, and both are load-bearing.
--
-- NULL is excluded because every shipped client creates guest sessions without a key and must stay
-- outside this constraint entirely.
--
-- revoked_at IS NULL is excluded because the creation path treats a revoked session for a key as
-- absent and mints a new guest rather than resurrecting a credential that upgrade or deletion
-- already retired. A lifetime-unique index would refuse to store that new guest's key, and the only
-- way to keep creating would be to leave the key unstored, which silently drops the retry protection
-- this column exists for. The predicate matches the creation path's own lookup, which is likewise
-- restricted to live sessions, and mirrors idx_guest_sessions_active_hash from 0031.
CREATE UNIQUE INDEX IF NOT EXISTS idx_guest_sessions_active_creation_idempotency_key
  ON auth.guest_sessions (creation_idempotency_key)
  WHERE creation_idempotency_key IS NOT NULL AND revoked_at IS NULL;

COMMENT ON COLUMN auth.guest_sessions.creation_idempotency_key IS
  'Opaque client-generated key for one guest session creation attempt, sent as idempotencyKey on '
  'POST /guest-auth/session. It is only ever compared, never parsed or logged. The route accepts it '
  'only as 32 to 200 lowercase hexadecimal characters, which is a floor on shape, not a guarantee '
  'of randomness: it rejects obviously non-random values such as a fixed label or an install id in '
  'canonical UUID form, but a hyphen-stripped install id and any other 32-character lowercase-hex '
  'constant pass it, so generating the key randomly per attempt stays a client obligation. A retry '
  'carrying a key that still names a live guest session rotates that session''s secret and returns '
  'the existing guest user and workspace, so a lost response cannot leave a device with two guest '
  'identities. The key is cleared here, and a fresh guest is created instead, once the named '
  'session''s user has been bound to a real account, because a key buys a guest token by design and '
  'must never buy one for an account. NULL is the shipped-client shape and always creates a fresh '
  'guest.';
