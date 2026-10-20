-- Migration status: Current / additive.
-- Introduces: one server-origin event that may carry anonymous_id. product_events_client_columns_shape
--   (0114_product_analytics_storage.sql) is re-added unchanged except that a row with origin =
--   'server' and event_name = 'catalog_deck_installed' may carry a non-NULL anonymous_id: the shared
--   analytics_visitor cookie the install request presented. That is what lets a report link a
--   marketing-site click to the install a signed-out browser guest made right after it, when the
--   guest's own app events never arrived.
-- Current guidance: client_occurred_at, client_sent_at and session_id stay NULL on every
--   non-client row, and anonymous_id stays NULL on every other server event and on every backfill
--   row. The install row's user_id and subject_user_id still name the installing identity, and
--   analytics.product_events_resolved.actor_id prefers them, so the carried id moves no actor. The
--   install carries NULL when the request presents no cookie (a browser that refused the
--   identifier, a native client) and when product analytics was turned off: on the request's
--   account or guest session, by a product_analytics_collection cookie reading 0, or by an
--   X-Product-Analytics-Enabled: 0 header. A browser whose consent question is still unanswered is
--   measured, as the web app measures it. Account deletion nulls anonymous_id on every row of the
--   person's user ids, this one included. This producer writes no identity link for the id, and
--   nothing is backfilled.
-- Schemas touched/read explicitly: analytics.
-- See also: db/migrations/0114_product_analytics_storage.sql,
-- db/migrations/0143_anonymous_client_identity_free_rows.sql,
-- apps/backend/src/catalog/distribution/install/index.ts,
-- apps/admin/src/reports/catalogInstallFunnel/query.ts, docs/catalog-install-funnel.md.

-- Re-added NOT VALID and never validated: the predicate is 0114's term by term with one row shape
-- admitted, so it is strictly weaker than the rule every stored row was accepted under, and a scan
-- could only confirm that. Skipping it matters because scripts/deploy/migrate.sh applies each
-- migration with --single-transaction, which holds this ALTER TABLE's ACCESS EXCLUSIVE lock on the
-- busiest append-only table until the file commits. The drop and the add commit together, so no
-- insert ever sees the table without the rule.
ALTER TABLE analytics.product_events
  DROP CONSTRAINT product_events_client_columns_shape;

ALTER TABLE analytics.product_events
  ADD CONSTRAINT product_events_client_columns_shape CHECK (
    origin = 'client'
    OR (
      client_occurred_at IS NULL
      AND client_sent_at IS NULL
      AND session_id IS NULL
      AND (
        anonymous_id IS NULL
        OR (origin = 'server' AND event_name = 'catalog_deck_installed')
      )
    )
  ) NOT VALID;

-- 0143's comment, restated in full because COMMENT ON COLUMN replaces it; only the last sentence is
-- new.
COMMENT ON COLUMN analytics.product_events.anonymous_id IS
  'Client-generated identifier used to count an actor without an account. The authenticated ingest '
  'uses a device-scoped identifier that can later resolve through analytics.identity_links; the '
  'credential-free collector stores the shared browser visitor id a producer sends, or the '
  'one-attempt catalog install journey UUID for the producers that predate it, and creates no '
  'identity link for either. It is empty on a row a visitor may not be identified by at all, which '
  'is every consent fact reported before a grant. The one server event that carries it is '
  'catalog_deck_installed: the shared browser visitor id the install request presented, NULL when '
  'the request carried none or product analytics was turned off for it. That producer writes no '
  'identity link for it, and it never changes the row''s actor, because the row''s user id takes '
  'precedence.';
