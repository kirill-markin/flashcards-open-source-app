-- Migration status: Current / additive.
-- Introduces: analytics.product_events.automated_client, the credential-free collector's record of
--   whether the request that reported the event came from an automated client - a bot, a crawler, a
--   headless browser or an HTTP library - rather than from a person's browser. The collector decides
--   it from the request's User-Agent alone, at insert time: a missing or empty User-Agent counts as
--   automated, and any other first has every known colliding vendor token cut out of it - device and
--   product names that carry a marker inside them, such as the CUBOT handset brand Chrome puts into
--   a mobile User-Agent, which contains "bot" - and only what remains is matched case-insensitively
--   against one fixed list of self-announcing markers. Both lists, the markers and the colliding
--   tokens, are held in apps/backend/src/productAnalytics/automatedClient.ts. The User-Agent itself
--   is stored in no analytics table: this column keeps the verdict and nothing else, and no row of
--   analytics.product_events carries the header. Outside the analytics store it is not gone -
--   infra/aws/lib/gateways/api-gateway-access-log.ts puts the verbatim User-Agent of every request
--   into the API Gateway access log, and infra/aws/lib/gateways/api-gateway.ts retains that log
--   group for one week - so the claim is about this table, not about the platform.
-- Current guidance: TRUE means the request announced itself as automated, FALSE means it did not,
--   and NULL means the code that stored the row did not assess it. That covers more than one
--   situation, and the ones seen so far are these. A row stored before this migration. A row on any
--   other trust level, because no other ingest classifies a User-Agent. And a collector row stored
--   by a backend build that does not fill this column: in a normal deploy that is the window
--   between this migration applying and the backend that fills it reaching production, because
--   infra/aws/lib/stack.ts makes the API Lambda depend on the migration gate, so one deploy applies
--   this file first and swaps the writing code in afterwards; a later deliberate deploy of an older
--   build would write such a row again, outside any window. Every row of that last case is an
--   anonymous_client row with NULL here, and analytics.product_events is append-only, so an
--   unassessed row can never be filled in afterwards.
--   Every row this collector stores is marked, the three consent facts included: one boolean about
--   bot-ness is not an identifier, so it takes nothing back from 0143's identity-free rows or from
--   0144 leaving those facts without a daily_visitor_hash, and exempting them would let an
--   automated client stay unmarked by reporting a consent fact. Those rows already carry
--   server-derived values - request_id, server_received_at, the skew-corrected occurred_at and the
--   platform 0143 documents the server stamping - so this is not a new kind of value for them, only
--   the first one the server derives about the nature of the client rather than about the request
--   or its timing. A report that excludes automated traffic excludes automated_client IS TRUE and
--   must not read NULL as "a person": on an anonymous_client row NULL means the code that stored
--   the row did not assess it, not that the request was human. Reading "a
--   person" as automated_client IS FALSE silently drops those rows. FALSE is equally not proof of a
--   person - it is one unverified claim a client makes about itself, which an automated client is
--   free to withhold by sending an ordinary browser User-Agent. IP reputation, request rate and
--   behaviour are deliberately no part of this column. Such rows are marked rather than refused, so
--   the traffic stays stored and countable and each report decides for itself whether to read it.
-- Schemas touched/read explicitly: analytics.
-- See also: db/migrations/0143_anonymous_client_identity_free_rows.sql,
-- db/migrations/0144_anonymous_client_daily_visitor_hash.sql,
-- apps/backend/src/productAnalytics/automatedClient.ts,
-- apps/backend/src/routes/anonymousAnalytics.ts, docs/anonymous-client-analytics.md.

ALTER TABLE analytics.product_events ADD COLUMN automated_client BOOLEAN;

-- Added NOT VALID and never validated, for the reason 0143 and 0144 give: scripts/deploy/migrate.sh
-- applies each migration with --single-transaction, so the ACCESS EXCLUSIVE lock this ALTER TABLE
-- takes is held until the file commits, and validating would hold the busiest append-only table in
-- the database against every read and every analytics insert for a whole-table scan. That scan could
-- only confirm what every stored row cannot violate: the column was added empty just above. NOT VALID
-- still enforces the rule on every future insert and update. The rule is one-directional on purpose:
-- only the credential-free collector reads a User-Agent, so no other trust level may carry a verdict,
-- while an anonymous_client row is left free to be NULL because every row stored before this
-- migration is.
ALTER TABLE analytics.product_events
  ADD CONSTRAINT product_events_automated_client_shape CHECK (
    automated_client IS NULL
    OR trust_level = 'anonymous_client'
  ) NOT VALID;

COMMENT ON COLUMN analytics.product_events.automated_client IS
  'Whether the credential-free collector judged the reporting request to come from an automated '
  'client - a bot, crawler, headless browser or HTTP library - from its User-Agent alone, with a '
  'missing or empty User-Agent counted as automated. Any other User-Agent is matched against one '
  'fixed marker list only after the known colliding vendor tokens - device and product names that '
  'carry a marker inside them - have been cut out of it, so a marker buried in a device model does '
  'not fire; apps/backend/src/productAnalytics/automatedClient.ts holds both lists. TRUE is such a '
  'match, FALSE is no such match, and NULL means the code that stored the row did not assess it, '
  'the cases seen so far being a row stored before this column existed, a row on a trust level '
  'other than anonymous_client, where no User-Agent is read, and a collector row stored by a '
  'backend build that does not fill this column, as in the window between this column being added '
  'and the backend that fills it being deployed over it. A report excluding automated traffic '
  'excludes TRUE and must not read NULL as a person, nor write FALSE for a person. FALSE is an '
  'unverified self-claim, not proof of one: an automated client can send an ordinary browser '
  'User-Agent. No User-Agent is stored in this table or any other analytics table; the API Gateway '
  'access log keeps the request header for one week outside the analytics store.';

-- 0144's definition unchanged, with the new column appended last so existing column positions,
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
  product_events.daily_visitor_hash,
  product_events.automated_client
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
GRANT SELECT (automated_client) ON TABLE analytics.product_events TO reporting_readonly;
GRANT SELECT ON analytics.product_events_resolved TO reporting_readonly;
