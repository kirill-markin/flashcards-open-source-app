ALTER TABLE auth.guest_sessions
  ADD COLUMN IF NOT EXISTS platform TEXT CHECK (platform IN ('ios', 'android'));

COMMENT ON COLUMN auth.guest_sessions.platform IS
  'Native client platform bound to the guest session. NULL is kept only for pre-1.7.0 iOS/Android clients that create guest sessions without platform; remove this legacy unbound path after those mobile versions are no longer supported.';
