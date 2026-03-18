-- Migration status: Historical / partially superseded.
-- Introduces: initial sequence grants for the legacy shared runtime role app.
-- Current guidance: the legacy app-role grants are historical; the current runtime-role split is defined by db/migrations/0024_auth_runtime_roles.sql and finalized by db/migrations/0025_remove_legacy_app_role.sql.
-- Replaced or refined by: db/migrations/0024_auth_runtime_roles.sql, db/migrations/0025_remove_legacy_app_role.sql.
-- See also: docs/architecture.md.
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA org TO app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA content TO app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA sync TO app;

ALTER DEFAULT PRIVILEGES IN SCHEMA org
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO app;

ALTER DEFAULT PRIVILEGES IN SCHEMA content
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO app;

ALTER DEFAULT PRIVILEGES IN SCHEMA sync
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO app;
