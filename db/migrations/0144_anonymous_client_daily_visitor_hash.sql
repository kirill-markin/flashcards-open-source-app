-- Migration status: Current / additive.
-- Introduces: analytics.daily_visitor_hash_salts and analytics.product_events.daily_visitor_hash, a
--   server-derived identifier that links one browser's cookieless marketing-site events within one
--   UTC day and never across days. The credential-free collector computes it only for a row that
--   carries no anonymous_id and is not one of the three consent facts, as the first 32 lowercase hex
--   characters of sha256(salt || source IP || 0x00 || User-Agent), where the salt is the random
--   value this table holds for the UTC day of server_received_at. Nothing is written to the browser,
--   and no raw IP is stored anywhere. When either input is missing the column stays NULL.
-- Current guidance: the hash is not an actor. It is never folded into actor_id, never written to
--   analytics.identity_links, and never linked to a later analytics_visitor cookie id or account,
--   including when the same browser consents later that day; a report reads it as its own column.
--   A salt is kept only for its own UTC day: a scheduled backend job deletes every ended day's salt at
--   00:00 UTC whether or not any traffic arrives, and the backend refuses to create a salt for a day
--   that has ended by the database clock or that a later day's salt has replaced, storing a NULL hash
--   for such a late event instead. Once a day's salt is deleted, no stored hash from that day can be
--   recomputed from an IP and a User-Agent. Many people behind one IP and one User-Agent share a hash,
--   an accepted inaccuracy. None of the three consent facts ever carries it: consent_prompt_shown and
--   consent_declined are identity-free by catalog rule, so a prompt or refusal row stays as
--   identity-free as 0143 made it, and consent_granted is excluded with them so the consent decision
--   is never recorded beside a hash of any kind.
-- Schemas touched/read explicitly: analytics, pg_catalog.
-- See also: db/migrations/0143_anonymous_client_identity_free_rows.sql,
-- db/migrations/0137_audience_context.sql, apps/backend/src/productAnalytics/dailyVisitorHash.ts,
-- infra/aws/lib/scheduled-jobs/daily-visitor-hash-salt-expiry.ts, docs/anonymous-client-analytics.md.

CREATE TABLE analytics.daily_visitor_hash_salts (
  utc_day DATE PRIMARY KEY,
  salt BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT daily_visitor_hash_salts_salt_length CHECK (pg_catalog.octet_length(salt) = 32)
);

COMMENT ON TABLE analytics.daily_visitor_hash_salts IS
  'One random 32-byte salt per UTC day for analytics.product_events.daily_visitor_hash. The backend '
  'creates a day''s salt on its first cookieless event, but never for a day that has ended by the '
  'database clock or that a later day''s salt has replaced, and a scheduled job deletes every ended '
  'day''s salt at 00:00 UTC. Once a salt is deleted, no hash from its day can be recomputed. Readable by '
  'backend_app alone: no reporting role is granted any column, because a readable salt would let '
  'anyone holding an IP and a User-Agent test whether they produced a stored hash.';

ALTER TABLE analytics.daily_visitor_hash_salts ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, DELETE ON TABLE analytics.daily_visitor_hash_salts TO backend_app;

CREATE POLICY daily_visitor_hash_salts_backend ON analytics.daily_visitor_hash_salts
  FOR ALL TO backend_app USING (true) WITH CHECK (true);

ALTER TABLE analytics.product_events ADD COLUMN daily_visitor_hash TEXT;

-- Added NOT VALID and never validated, for the reason 0143 gives: scripts/deploy/migrate.sh applies
-- each migration with --single-transaction, so the ACCESS EXCLUSIVE lock this ALTER TABLE takes is
-- held until the file commits, and validating would hold the busiest append-only table against
-- every read and every analytics insert for a whole-table scan. The scan could only confirm what
-- every stored row cannot violate: the column was added empty just above. NOT VALID still enforces
-- the rule on every future insert and update. The consent-fact names are listed here as well as in
-- the backend so the database refuses the hash on a consent fact whatever writer builds the row.
ALTER TABLE analytics.product_events
  ADD CONSTRAINT product_events_daily_visitor_hash_shape CHECK (
    daily_visitor_hash IS NULL
    OR (
      trust_level = 'anonymous_client'
      AND anonymous_id IS NULL
      AND event_name NOT IN ('consent_prompt_shown', 'consent_granted', 'consent_declined')
      AND daily_visitor_hash ~ '^[0-9a-f]{32}$'
    )
  ) NOT VALID;

COMMENT ON COLUMN analytics.product_events.daily_visitor_hash IS
  'Server-derived identifier that links one browser''s cookieless events within one UTC day: the '
  'first 32 lowercase hex characters of sha256(salt || source IP || 0x00 || User-Agent), with the '
  'salt analytics.daily_visitor_hash_salts held for the UTC day of server_received_at. Set only on an '
  'anonymous_client row with no anonymous_id that is not a consent fact, and NULL when the request '
  'had no source IP or no User-Agent or arrived after its UTC day had ended. The same browser gets a '
  'different value every UTC day. It is '
  'not an actor: never part of actor_id, never linked to anonymous_id, an identity link or an '
  'account. No raw IP is stored.';

-- 0137's definition unchanged, with the new column appended last so existing column positions,
-- identity resolution and view grants survive.
CREATE OR REPLACE VIEW analytics.product_events_resolved AS
SELECT
  product_events.event_id,
  product_events.schema_version,
  product_events.event_name,
  product_events.origin,
  product_events.backfill_id,
  product_events.client_occurred_at,
  product_events.client_sent_at,
  product_events.server_received_at,
  product_events.occurred_at,
  product_events.ingested_at,
  product_events.user_id,
  product_events.subject_user_id,
  product_events.auth_transport,
  product_events.trust_level,
  product_events.identity_state,
  product_events.guest_session_id,
  product_events.workspace_id,
  product_events.anonymous_id,
  product_events.session_id,
  product_events.platform,
  product_events.app_version,
  product_events.os_version,
  product_events.device_model,
  product_events.device_locale,
  product_events.timezone,
  product_events.country,
  product_events.network_state,
  product_events.screen,
  product_events.event_properties,
  product_events.experiment_assignments,
  product_events.request_id,
  COALESCE(
    first_guest_upgrade_link.user_id,
    product_events.user_id,
    first_anonymous_link.user_id,
    product_events.anonymous_id
  ) AS actor_id,
  product_events.ui_locale,
  product_events.daily_visitor_hash
FROM analytics.product_events AS product_events
LEFT JOIN (
  SELECT DISTINCT ON (identity_links.anonymous_id)
    identity_links.anonymous_id,
    identity_links.user_id
  FROM analytics.identity_links AS identity_links
  WHERE identity_links.source = 'authenticated_client'
  ORDER BY identity_links.anonymous_id, identity_links.linked_at, identity_links.link_id
) AS first_anonymous_link
  ON first_anonymous_link.anonymous_id = product_events.anonymous_id
LEFT JOIN (
  SELECT DISTINCT ON (identity_links.anonymous_id)
    identity_links.anonymous_id,
    identity_links.user_id
  FROM analytics.identity_links AS identity_links
  WHERE identity_links.source = 'server_derived'
  ORDER BY identity_links.anonymous_id, identity_links.linked_at, identity_links.link_id
) AS first_guest_upgrade_link
  ON first_guest_upgrade_link.anonymous_id = product_events.subject_user_id;

-- 0114 revoked default reporting access in this schema, so the new column is granted explicitly.
GRANT SELECT (daily_visitor_hash) ON TABLE analytics.product_events TO reporting_readonly;
GRANT SELECT ON analytics.product_events_resolved TO reporting_readonly;
