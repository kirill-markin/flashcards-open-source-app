-- Migration status: Current / additive.
-- Introduces: anonymous-client analytics trust and the catalog install journey lookup index.
-- Schemas touched/read explicitly: analytics.

ALTER TABLE analytics.product_events
  ADD CONSTRAINT product_events_trust_level_catalog_journey_valid CHECK (
    trust_level IN (
      'server_derived',
      'authenticated_client',
      'guest_client',
      'anonymous_client',
      'backfill_derived'
    )
  ) NOT VALID;

ALTER TABLE analytics.product_events
  VALIDATE CONSTRAINT product_events_trust_level_catalog_journey_valid;

ALTER TABLE analytics.product_events
  DROP CONSTRAINT product_events_trust_level_valid;

ALTER TABLE analytics.product_events
  RENAME CONSTRAINT product_events_trust_level_catalog_journey_valid
  TO product_events_trust_level_valid;

ALTER TABLE analytics.product_events
  ADD CONSTRAINT product_events_anonymous_client_shape CHECK (
    trust_level <> 'anonymous_client'
    OR (
      origin = 'client'
      AND user_id IS NULL
      AND subject_user_id IS NULL
      AND auth_transport IS NULL
      AND guest_session_id IS NULL
      AND workspace_id IS NULL
      AND session_id IS NULL
      AND anonymous_id IS NOT NULL
    )
  );

COMMENT ON COLUMN analytics.product_events.trust_level IS
  'How much the row can be trusted: server_derived is a server observation; authenticated_client and '
  'guest_client are authenticated request claims; anonymous_client is an unauthenticated, event-only '
  'catalog journey claim with no account, guest, workspace, or session identity; backfill_derived is '
  'reconstructed from server storage.';

COMMENT ON COLUMN analytics.product_events.anonymous_id IS
  'Client-generated identifier used to count an actor without an account. The authenticated ingest '
  'uses a device-scoped identifier that can later resolve through analytics.identity_links; the '
  'anonymous catalog collector uses the one-attempt install journey UUID and creates no identity link.';

COMMENT ON COLUMN analytics.product_events.platform IS
  'Client platform normalized by the server. Authenticated ingest accepts an allowlisted request '
  'header; the anonymous catalog install collector is a browser-only flow and stamps web directly.';

CREATE INDEX IF NOT EXISTS idx_product_events_catalog_install_journey
  ON analytics.product_events (
    (event_properties ->> 'install_journey_id'),
    occurred_at
  )
  WHERE event_properties ? 'install_journey_id';
