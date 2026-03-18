-- Migration status: Historical / partially superseded.
-- Introduces: deleted-account tombstones that block stale-token reprovisioning during account deletion.
-- Current guidance: the tombstone table remains relevant, but the legacy app-role grants in this migration are historical and later account-delete cleanup was refined.
-- Replaced or refined by: db/migrations/0024_auth_runtime_roles.sql, db/migrations/0025_remove_legacy_app_role.sql, db/migrations/0029_account_delete_auth_cleanup.sql.
-- See also: docs/architecture.md.
-- Deleted-account tombstones prevent stale Cognito JWTs from reprovisioning
-- a just-deleted account before those tokens naturally expire.

CREATE TABLE IF NOT EXISTS auth.deleted_subjects (
  subject_sha256 TEXT        PRIMARY KEY,
  deleted_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, DELETE ON auth.deleted_subjects TO app;
