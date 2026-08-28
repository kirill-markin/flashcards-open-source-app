-- Migration status: Current / additive.
-- Introduces: web as an accepted auth.guest_sessions.platform value, so a signed-out browser can
--   hold a guest credential for the analytics ingest endpoint, which always requires authentication.
--   A web guest identity exists for measurement only and never carries an offline workspace. It is
--   refused by default on every authenticated surface through apps/backend/src/guestAuth/
--   webPlatform.ts, which the request-context loader applies to every route; analytics ingest is the
--   only caller that opts in.
-- Schemas touched/read explicitly: auth, pg_catalog.

-- 0055 added the column with an inline CHECK, so the constraint carries the name PostgreSQL derived
-- rather than one this repository chose. Dropping the CHECK by shape instead of by name keeps a name
-- that differs from the derived default from silently leaving the old two-value constraint in place
-- beside the new one, which would reject every web guest session in production.
--
-- The shape is pinned to conkey, the single platform column, rather than to a definition that merely
-- mentions the column. This file is immutable once merged and replays in order on every fresh
-- database, so a later migration's multi-column check that happens to reference platform must not be
-- dropped by this one on that replay.
DO $$
DECLARE
  platform_attnum smallint;
  platform_constraint RECORD;
BEGIN
  SELECT attnum INTO STRICT platform_attnum
  FROM pg_catalog.pg_attribute
  WHERE attrelid = 'auth.guest_sessions'::regclass
    AND attname = 'platform'
    AND attnum > 0
    AND NOT attisdropped;

  FOR platform_constraint IN
    SELECT conname
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'auth.guest_sessions'::regclass
      AND contype = 'c'
      AND conkey = ARRAY[platform_attnum]
  LOOP
    EXECUTE format(
      'ALTER TABLE auth.guest_sessions DROP CONSTRAINT %I',
      platform_constraint.conname
    );
  END LOOP;
END
$$;

ALTER TABLE auth.guest_sessions
  ADD CONSTRAINT guest_sessions_platform_check
  CHECK (platform IN ('ios', 'android', 'web'));

COMMENT ON COLUMN auth.guest_sessions.platform IS
  'Client platform bound to the guest session. ios and android guest sessions own an offline '
  'workspace and can be upgraded into an account; web guest sessions exist only so a signed-out '
  'browser can authenticate an analytics batch, and every other authenticated surface refuses '
  'them. NULL is kept '
  'only for pre-1.7.0 iOS/Android clients that create guest sessions without platform; remove this '
  'legacy unbound path after those mobile versions are no longer supported.';
