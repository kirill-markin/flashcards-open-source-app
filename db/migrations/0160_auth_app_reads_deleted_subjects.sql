-- Migration status: Current / one privilege.
-- Introduces: SELECT on auth.deleted_subjects for auth_app.
-- Schemas touched/read explicitly: auth.
-- See also: db/migrations/0019_account_delete_tombstones.sql,
--   db/migrations/0024_auth_runtime_roles.sql, docs/auth-service.md.

-- The auth service reads the tombstones so it refuses to create an account for a deleted subject.
GRANT SELECT ON TABLE auth.deleted_subjects TO auth_app;
