-- Migration status: Current / canonical.
-- Introduces: the persistent read-only reporting role used for operator analytics against private storage.
-- Current guidance: reporting_readonly is part of the baseline schema in every environment, but the operator access path remains optional and is provisioned separately by infra.
-- Current guidance: reporting_readonly is limited to org, content, and sync reads for manual operator analytics and must not be reused as an application runtime role.
-- Current guidance: this migration owns the persistent role attributes, role-level session settings, and connection limit for reporting_readonly.
-- Current guidance: password rotation for reporting_readonly is managed outside the schema by migration runners and environment secrets.
-- See also: infra/aws/README.md.
-- Create the baseline analytical reporting role and keep its grants and RLS policies read-only.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reporting_readonly') THEN
    CREATE ROLE reporting_readonly LOGIN;
  END IF;
END
$$;

ALTER ROLE reporting_readonly
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOREPLICATION;

GRANT CONNECT ON DATABASE flashcards TO reporting_readonly;

GRANT USAGE ON SCHEMA org TO reporting_readonly;
GRANT USAGE ON SCHEMA content TO reporting_readonly;
GRANT USAGE ON SCHEMA sync TO reporting_readonly;

REVOKE SELECT ON ALL TABLES IN SCHEMA org FROM reporting_readonly;
REVOKE SELECT ON ALL TABLES IN SCHEMA content FROM reporting_readonly;
REVOKE SELECT ON ALL TABLES IN SCHEMA sync FROM reporting_readonly;

ALTER DEFAULT PRIVILEGES IN SCHEMA org
  REVOKE SELECT ON TABLES FROM reporting_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA content
  REVOKE SELECT ON TABLES FROM reporting_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA sync
  REVOKE SELECT ON TABLES FROM reporting_readonly;

GRANT SELECT ON TABLE org.user_settings TO reporting_readonly;
GRANT SELECT ON TABLE org.workspaces TO reporting_readonly;
GRANT SELECT ON TABLE org.workspace_memberships TO reporting_readonly;
GRANT SELECT ON TABLE content.cards TO reporting_readonly;
GRANT SELECT ON TABLE content.decks TO reporting_readonly;
GRANT SELECT ON TABLE content.review_events TO reporting_readonly;
GRANT SELECT ON TABLE sync.workspace_replicas TO reporting_readonly;
GRANT SELECT ON TABLE sync.installations TO reporting_readonly;

DROP POLICY IF EXISTS user_settings_reporting_readonly_select ON org.user_settings;
CREATE POLICY user_settings_reporting_readonly_select
  ON org.user_settings
  FOR SELECT
  TO reporting_readonly
  USING (true);

DROP POLICY IF EXISTS workspace_memberships_reporting_readonly_select ON org.workspace_memberships;
CREATE POLICY workspace_memberships_reporting_readonly_select
  ON org.workspace_memberships
  FOR SELECT
  TO reporting_readonly
  USING (true);

DROP POLICY IF EXISTS workspaces_reporting_readonly_select ON org.workspaces;
CREATE POLICY workspaces_reporting_readonly_select
  ON org.workspaces
  FOR SELECT
  TO reporting_readonly
  USING (true);

DROP POLICY IF EXISTS cards_reporting_readonly_select ON content.cards;
CREATE POLICY cards_reporting_readonly_select
  ON content.cards
  FOR SELECT
  TO reporting_readonly
  USING (true);

DROP POLICY IF EXISTS decks_reporting_readonly_select ON content.decks;
CREATE POLICY decks_reporting_readonly_select
  ON content.decks
  FOR SELECT
  TO reporting_readonly
  USING (true);

DROP POLICY IF EXISTS review_events_reporting_readonly_select ON content.review_events;
CREATE POLICY review_events_reporting_readonly_select
  ON content.review_events
  FOR SELECT
  TO reporting_readonly
  USING (true);

DROP POLICY IF EXISTS workspace_replicas_reporting_readonly_select ON sync.workspace_replicas;
CREATE POLICY workspace_replicas_reporting_readonly_select
  ON sync.workspace_replicas
  FOR SELECT
  TO reporting_readonly
  USING (true);

DROP POLICY IF EXISTS installations_reporting_readonly_select ON sync.installations;
CREATE POLICY installations_reporting_readonly_select
  ON sync.installations
  FOR SELECT
  TO reporting_readonly
  USING (true);

ALTER ROLE reporting_readonly SET default_transaction_read_only = on;
ALTER ROLE reporting_readonly SET statement_timeout = '30s';
ALTER ROLE reporting_readonly SET lock_timeout = '5s';
ALTER ROLE reporting_readonly SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE reporting_readonly CONNECTION LIMIT 3;
