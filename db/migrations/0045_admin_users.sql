-- Migration status: Current / canonical.
-- Introduces: auth.admin_users as the source of truth for deployed admin access entitlements.
-- Current guidance: admin access is keyed by normalized email so self-hosters can declaratively bootstrap grants before the first admin login.
-- Current guidance: bootstrap config sync is handled by migration/deploy code outside this SQL file, while manual grant lifecycle remains operator-owned.
-- See also: docs/admin-app.md.

CREATE TABLE IF NOT EXISTS auth.admin_users (
  email TEXT PRIMARY KEY,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by TEXT NOT NULL,
  revoked_at TIMESTAMPTZ,
  note TEXT,
  source TEXT NOT NULL CHECK (source IN ('bootstrap', 'manual')),
  CONSTRAINT admin_users_email_normalized CHECK (email = lower(btrim(email))),
  CONSTRAINT admin_users_revoked_after_granted CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);

COMMENT ON TABLE auth.admin_users IS
  'Server-side admin entitlements keyed by normalized email. Active grants have revoked_at IS NULL.';

COMMENT ON COLUMN auth.admin_users.email IS
  'Normalized lower-case trimmed email used as the admin access key.';

COMMENT ON COLUMN auth.admin_users.granted_at IS
  'Server timestamp when this admin entitlement became active.';

COMMENT ON COLUMN auth.admin_users.granted_by IS
  'Actor label that explains who granted the entitlement, including bootstrap labels such as bootstrap:ADMIN_EMAILS.';

COMMENT ON COLUMN auth.admin_users.revoked_at IS
  'Server timestamp when this entitlement was revoked. NULL means the grant is active.';

COMMENT ON COLUMN auth.admin_users.note IS
  'Optional operator note describing the reason for the grant or revoke state.';

COMMENT ON COLUMN auth.admin_users.source IS
  'Current entitlement provenance. bootstrap is declaratively managed from ADMIN_EMAILS; manual is operator-managed.';

GRANT SELECT ON TABLE auth.admin_users TO backend_app;
