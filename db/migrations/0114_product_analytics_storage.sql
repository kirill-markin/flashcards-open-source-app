-- Migration status: Current / additive.
-- Introduces: append-only product analytics event storage and anonymous-to-user identity links.
-- Schemas touched/read explicitly: analytics, pg_catalog.

CREATE SCHEMA IF NOT EXISTS analytics;

CREATE TABLE IF NOT EXISTS analytics.product_events (
  event_id               UUID        PRIMARY KEY,
  schema_version         SMALLINT    NOT NULL,
  event_name             TEXT        NOT NULL,
  origin                 TEXT        NOT NULL,
  backfill_id            UUID,
  client_occurred_at     TIMESTAMPTZ,
  client_sent_at         TIMESTAMPTZ,
  server_received_at     TIMESTAMPTZ NOT NULL,
  occurred_at            TIMESTAMPTZ NOT NULL,
  ingested_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id                UUID,
  subject_user_id        UUID,
  auth_transport         TEXT,
  trust_level            TEXT        NOT NULL,
  identity_state         TEXT        NOT NULL DEFAULT 'active',
  guest_session_id       UUID,
  workspace_id           UUID,
  anonymous_id           UUID,
  session_id             UUID,
  platform               TEXT,
  app_version            TEXT,
  os_version             TEXT,
  device_model           TEXT,
  device_locale          TEXT,
  timezone               TEXT,
  country                TEXT,
  network_state          TEXT,
  screen                 TEXT,
  event_properties       JSONB       NOT NULL,
  experiment_assignments JSONB       NOT NULL DEFAULT '{}'::jsonb,
  request_id             TEXT,
  CONSTRAINT product_events_origin_valid CHECK (
    origin IN ('client', 'server', 'backfill')
  ),
  CONSTRAINT product_events_backfill_id_shape CHECK (
    (origin = 'backfill') = (backfill_id IS NOT NULL)
  ),
  CONSTRAINT product_events_client_columns_shape CHECK (
    origin = 'client'
    OR (
      client_occurred_at IS NULL
      AND client_sent_at IS NULL
      AND session_id IS NULL
      AND anonymous_id IS NULL
    )
  ),
  CONSTRAINT product_events_trust_level_valid CHECK (
    trust_level IN ('server_derived', 'authenticated_client', 'guest_client', 'backfill_derived')
  ),
  CONSTRAINT product_events_identity_state_valid CHECK (
    identity_state IN ('active', 'anonymized')
  ),
  CONSTRAINT product_events_event_properties_object CHECK (
    pg_catalog.jsonb_typeof(event_properties) = 'object'
  ),
  CONSTRAINT product_events_experiment_assignments_object CHECK (
    pg_catalog.jsonb_typeof(experiment_assignments) = 'object'
  )
);

COMMENT ON TABLE analytics.product_events IS
  'Append-only product analytics events. Every column is written either by the client or by the server, never by both. '
  'No foreign keys are declared on purpose: they would add write contention on an insert-only table and block user deletion, '
  'and reporting joins work without them. '
  'The single permitted UPDATE is the account-deletion anonymization path, which sets identity_state to anonymized and '
  'clears the person-linked columns in place. The table is otherwise append-only and no other writer may rewrite a row.';
COMMENT ON COLUMN analytics.product_events.event_id IS
  'Client-generated UUIDv7 that is also the retry dedupe key, so a redelivered batch inserts nothing new.';
COMMENT ON COLUMN analytics.product_events.schema_version IS
  'Server-stamped version of the frozen event catalog that accepted this row.';
COMMENT ON COLUMN analytics.product_events.event_name IS
  'Allowlisted catalog event name. Anything outside the catalog is rejected at ingest and never stored.';
COMMENT ON COLUMN analytics.product_events.origin IS
  'Who produced the row: client ingest, a server-derived emission, or a backfill.';
COMMENT ON COLUMN analytics.product_events.backfill_id IS
  'Identifies one backfill run so its rows can be audited or rolled back. Present exactly when origin is backfill.';
COMMENT ON COLUMN analytics.product_events.client_occurred_at IS
  'Raw device clock reading kept for diagnostics only. Never group analytics by this column.';
COMMENT ON COLUMN analytics.product_events.client_sent_at IS
  'Raw device clock reading for the batch that carried this event, used only to derive occurred_at.';
COMMENT ON COLUMN analytics.product_events.server_received_at IS
  'Server clock reading when the batch arrived, the trusted anchor of the skew correction.';
COMMENT ON COLUMN analytics.product_events.occurred_at IS
  'Skew-corrected event time, server_received_at - (client_sent_at - client_occurred_at). '
  'This is the only column analytics queries should group by.';
COMMENT ON COLUMN analytics.product_events.ingested_at IS
  'Insertion time and the checkpoint column for incremental aggregation. '
  'A backfilled or long-offline event has an old occurred_at and a new ingested_at, and that is intentional.';
COMMENT ON COLUMN analytics.product_events.user_id IS
  'Authenticated account that owned the request, taken from the request context and never from the client body.';
COMMENT ON COLUMN analytics.product_events.subject_user_id IS
  'Identity the request acted as, which differs from user_id for guest sessions.';
COMMENT ON COLUMN analytics.product_events.auth_transport IS
  'Transport that authenticated the request, recorded so client trust can be audited after the fact.';
COMMENT ON COLUMN analytics.product_events.trust_level IS
  'How much the row can be trusted: server_derived is a server observation, the client levels are claims the server only framed.';
COMMENT ON COLUMN analytics.product_events.identity_state IS
  'Set to anonymized when the account is deleted. Anonymization is irreversible and keeps no mapping back to the person.';
COMMENT ON COLUMN analytics.product_events.guest_session_id IS
  'Server-known guest session behind the request, never a client-supplied value.';
COMMENT ON COLUMN analytics.product_events.workspace_id IS
  'Workspace selected for the request. It identifies a resource, not a person, so it survives anonymization.';
COMMENT ON COLUMN analytics.product_events.anonymous_id IS
  'Device-scoped identifier the client generated before sign-in, resolved to an account through analytics.identity_links.';
COMMENT ON COLUMN analytics.product_events.session_id IS
  'Client-scoped foreground session identifier, unrelated to any authentication session.';
COMMENT ON COLUMN analytics.product_events.platform IS
  'Client platform normalized by the server from the request headers, not from the event body.';
COMMENT ON COLUMN analytics.product_events.app_version IS
  'Client app version validated by the server from the request headers, not from the event body.';
COMMENT ON COLUMN analytics.product_events.country IS
  'Country resolved from the edge request header. The IP address itself is never stored.';
COMMENT ON COLUMN analytics.product_events.network_state IS
  'Client connectivity enum captured per event and never once per batch: a queued batch is flushed only once the device '
  'is back online, so a batch-level capture would record the state of the flush and could never report offline at all. '
  'Used to separate offline behavior from product behavior.';
COMMENT ON COLUMN analytics.product_events.screen IS
  'Platform-independent surface enum so funnels compare across clients. Native screen names are never sent.';
COMMENT ON COLUMN analytics.product_events.event_properties IS
  'Per-event properties allowlisted by the catalog. Every value is an allowlisted enum member, a non-negative integer, or '
  'a string the catalog binds to a fixed format such as a deck slug. It never contains free text, which is why it '
  'survives anonymization intact.';
COMMENT ON COLUMN analytics.product_events.experiment_assignments IS
  'Flat map of experiment key to assigned variant that was active on the client at event time. Both keys and variants are '
  'bound to a fixed identifier format at ingest and are never free text, because anonymization deliberately leaves this '
  'column in place.';
COMMENT ON COLUMN analytics.product_events.request_id IS
  'Backend request id of the ingesting request, so one event can be correlated with its CloudWatch record.';

CREATE INDEX IF NOT EXISTS idx_product_events_ingested_at_brin
  ON analytics.product_events USING brin (ingested_at);

CREATE INDEX IF NOT EXISTS idx_product_events_occurred_at
  ON analytics.product_events (occurred_at);

-- Every additional index is write amplification on an insert-only table, so composite indexes
-- such as (event_name, occurred_at) are added only when a concrete query needs them.
ALTER TABLE analytics.product_events SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.02
);

CREATE TABLE IF NOT EXISTS analytics.identity_links (
  link_id      UUID        PRIMARY KEY,
  anonymous_id UUID        NOT NULL,
  user_id      UUID        NOT NULL,
  linked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  source       TEXT        NOT NULL,
  CONSTRAINT identity_links_source_valid CHECK (
    source IN ('server_derived', 'authenticated_client')
  ),
  CONSTRAINT identity_links_anonymous_user_unique UNIQUE (anonymous_id, user_id)
);

COMMENT ON TABLE analytics.identity_links IS
  'The anonymous tail belongs only to the first link for a given anonymous_id; later links for the same anonymous_id '
  'count from their own linked_at and never claim earlier history. Analytics event rows are never rewritten to backfill '
  'identity. Misattribution on a shared device is silent and irreversible, so undercounting is preferred over claiming '
  'another person''s history.';
COMMENT ON COLUMN analytics.identity_links.linked_at IS
  'Server time the link was observed, which bounds how far back a non-first link may claim history.';
COMMENT ON COLUMN analytics.identity_links.source IS
  'server_derived comes from the guest upgrade itself; authenticated_client comes from an authenticated ingest request.';

-- No standalone anonymous_id index: the UNIQUE (anonymous_id, user_id) constraint above already
-- creates a btree whose leading column is anonymous_id, and that serves every lookup by anonymous_id.

ALTER TABLE analytics.product_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.identity_links ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA analytics TO backend_app;
-- UPDATE on product_events exists solely for the account-deletion anonymization path, which sets
-- identity_state to anonymized and clears the person-linked columns. The table is append-only for
-- every other writer. DELETE on identity_links exists for that same path: a link is person-linked
-- in both of its columns, so it is removed rather than anonymized in place.
GRANT SELECT, INSERT, UPDATE ON TABLE analytics.product_events TO backend_app;
GRANT SELECT, INSERT, DELETE ON TABLE analytics.identity_links TO backend_app;

DROP POLICY IF EXISTS product_events_backend_select ON analytics.product_events;
CREATE POLICY product_events_backend_select
  ON analytics.product_events
  FOR SELECT
  TO backend_app
  USING (true);

DROP POLICY IF EXISTS product_events_backend_insert ON analytics.product_events;
CREATE POLICY product_events_backend_insert
  ON analytics.product_events
  FOR INSERT
  TO backend_app
  WITH CHECK (true);

-- Matches the UPDATE grant above: the account-deletion anonymization path is the only writer that
-- may rewrite an existing row.
DROP POLICY IF EXISTS product_events_backend_update ON analytics.product_events;
CREATE POLICY product_events_backend_update
  ON analytics.product_events
  FOR UPDATE
  TO backend_app
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS identity_links_backend_select ON analytics.identity_links;
CREATE POLICY identity_links_backend_select
  ON analytics.identity_links
  FOR SELECT
  TO backend_app
  USING (true);

DROP POLICY IF EXISTS identity_links_backend_insert ON analytics.identity_links;
CREATE POLICY identity_links_backend_insert
  ON analytics.identity_links
  FOR INSERT
  TO backend_app
  WITH CHECK (true);

-- Matches the DELETE grant above: account deletion removes the person's links outright.
DROP POLICY IF EXISTS identity_links_backend_delete ON analytics.identity_links;
CREATE POLICY identity_links_backend_delete
  ON analytics.identity_links
  FOR DELETE
  TO backend_app
  USING (true);

GRANT USAGE ON SCHEMA analytics TO reporting_readonly;

-- The column-level grants below are the only reporting access to this schema, so a table or view
-- added to analytics later must grant its columns explicitly instead of inheriting anything. The
-- companion REVOKE SELECT ON ALL TABLES that older reporting migrations pair with this is omitted on
-- purpose: both tables are created in this migration and neither ever carried a table-wide grant.
ALTER DEFAULT PRIVILEGES IN SCHEMA analytics
  REVOKE SELECT ON TABLES FROM reporting_readonly;

GRANT SELECT (
  event_id,
  schema_version,
  event_name,
  origin,
  backfill_id,
  client_occurred_at,
  client_sent_at,
  server_received_at,
  occurred_at,
  ingested_at,
  user_id,
  subject_user_id,
  auth_transport,
  trust_level,
  identity_state,
  guest_session_id,
  workspace_id,
  anonymous_id,
  session_id,
  platform,
  app_version,
  os_version,
  device_model,
  device_locale,
  timezone,
  country,
  network_state,
  screen,
  event_properties,
  experiment_assignments,
  request_id
) ON TABLE analytics.product_events TO reporting_readonly;

GRANT SELECT (
  link_id,
  anonymous_id,
  user_id,
  linked_at,
  source
) ON TABLE analytics.identity_links TO reporting_readonly;

DROP POLICY IF EXISTS product_events_reporting_readonly_select ON analytics.product_events;
CREATE POLICY product_events_reporting_readonly_select
  ON analytics.product_events
  FOR SELECT
  TO reporting_readonly
  USING (true);

DROP POLICY IF EXISTS identity_links_reporting_readonly_select ON analytics.identity_links;
CREATE POLICY identity_links_reporting_readonly_select
  ON analytics.identity_links
  FOR SELECT
  TO reporting_readonly
  USING (true);
