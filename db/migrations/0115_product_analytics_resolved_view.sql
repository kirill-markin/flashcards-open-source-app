-- Migration status: Current / additive.
-- Introduces: read-time identity resolution over the append-only product analytics events, the
--   UPDATE grant and policy that let a server-derived identity link supersede an earlier
--   client-claimed one for the same pair, the user_id indexes the account-deletion anonymization
--   path needs on the 0114 tables, and the corrected analytics.product_events comments on
--   workspace_id, event_id and server_received_at, since 0114 is immutable.
-- Schemas touched/read explicitly: analytics.

CREATE OR REPLACE VIEW analytics.product_events_resolved AS
SELECT
  product_events.event_id,
  product_events.schema_version,
  product_events.event_name,
  -- origin stays visible instead of being filtered here: it exists for auditing and rollback, and a
  -- backfilled row carries a fact derived from a real product row with a real timestamp.
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
  -- Resolution order, most trusted first:
  --   1. the guest upgrade the server performed itself, read through subject_user_id
  --   2. the row's own user_id, which the server took from the request context at write time
  --   3. the first link on the row's client-chosen anonymous_id
  --   4. the anonymous_id itself, so an unresolved row still counts as one actor
  COALESCE(
    first_guest_upgrade_link.user_id,
    product_events.user_id,
    first_anonymous_link.user_id,
    product_events.anonymous_id
  ) AS actor_id
FROM analytics.product_events AS product_events
-- The row's own user_id outranks any link on its anonymous_id, and that order is the whole point.
-- Ingestion is authenticated, so a stored row already names the account whose request carried it,
-- while an anonymous_id is device-scoped and is not rotated when a second account signs in on that
-- device. Ranking the first link on the anonymous_id higher would hand every event the second
-- account ever sends from that device to the first account, permanently, including events that name
-- the second account themselves. Step 3 therefore only ever resolves a row that carries no user_id
-- at all, which is exactly the anonymous tail the first link is entitled to.
--
-- The guest upgrade outranks user_id instead, because there the row's user_id is the pre-upgrade
-- guest identity and the upgrade is the server's own observation that this guest became that
-- account. It cannot reach anybody else's rows: its key is subject_user_id, which the server takes
-- from the request context and never from a body, and it reads only links the server derived
-- itself, which no client can write. The only rows whose subject_user_id is a merged-away guest
-- user id are that guest's own rows.
--
-- Two link shapes exist, and they are resolved through two separate joins on purpose rather than
-- through one join over a shared key.
--
-- anonymous_id is a value the client chose and sent, while subject_user_id is a real account or
-- guest user id the server took from the request context. Resolving both through a single key would
-- put those two namespaces into one key space: an authenticated ingest could then claim an
-- anonymous_id equal to somebody else's guest user id, and that claimed link would attach to the
-- victim's rows through the subject_user_id side and redirect their actor_id. It would also decide
-- precedence by column instead of by trust, letting a client-claimed link outrank the server-derived
-- link the upgrade itself observed.
--
-- Keeping the joins apart makes each namespace single-sourced: the client's anonymous_id resolves
-- through links a client can claim, and the server's subject_user_id resolves only through links the
-- server derived from an upgrade it performed itself.
--
-- Each subquery keeps at most one link per anonymous_id, so neither join can duplicate an event row.
-- A row may match both joins, and that is not a duplicate either: COALESCE picks exactly one of
-- them. The earliest link wins, so the anonymous tail is attributed once and a later link for the
-- same anonymous_id counts only from its own linked_at. link_id breaks a linked_at tie so the same
-- link wins on every read.
LEFT JOIN (
  SELECT DISTINCT ON (identity_links.anonymous_id)
    identity_links.anonymous_id,
    identity_links.user_id
  FROM analytics.identity_links AS identity_links
  WHERE identity_links.source = 'authenticated_client'
  ORDER BY identity_links.anonymous_id, identity_links.linked_at, identity_links.link_id
) AS first_anonymous_link
  -- The client namespace: an authenticated ingest request links the client's own anonymous_id, and
  -- such a link can only ever name the account that sent it. Restricting the source both ways is
  -- what keeps a client-chosen anonymous_id from picking up a guest-upgrade link out of the server
  -- namespace.
  --
  -- This join decides nothing today, and that is the intended steady state rather than a missing
  -- feature: it sits third in the COALESCE, so it can only reach actor_id for a row whose user_id is
  -- NULL, and every row stored so far carries one, because ingest is authenticated and both server
  -- producers set it. The source filter is likewise inert for the same reason. It stays because a
  -- future ingest path could store a row with no user_id, and that anonymous tail is exactly what a
  -- link on the client's own anonymous_id is entitled to resolve.
  ON first_anonymous_link.anonymous_id = product_events.anonymous_id
LEFT JOIN (
  SELECT DISTINCT ON (identity_links.anonymous_id)
    identity_links.anonymous_id,
    identity_links.user_id
  FROM analytics.identity_links AS identity_links
  WHERE identity_links.source = 'server_derived'
  ORDER BY identity_links.anonymous_id, identity_links.linked_at, identity_links.link_id
) AS first_guest_upgrade_link
  -- The server namespace: the guest upgrade links the guest user id, which the guest's own events
  -- carry as subject_user_id. A guest's client rows are read this way too, not only the rows the
  -- backend emitted: a guest-transport request writes the guest user id into user_id and
  -- subject_user_id alike, so both halves of that guest's history resolve to the account through the
  -- one link the upgrade wrote.
  ON first_guest_upgrade_link.anonymous_id = product_events.subject_user_id;

COMMENT ON VIEW analytics.product_events_resolved IS
  'The anonymous tail belongs only to the first link for a given anonymous_id. Later links for the same anonymous_id '
  'count from their own linked_at and never claim earlier history. Event rows are never rewritten; identity is resolved '
  'at read time so a wrong link is fixed by correcting one row instead of millions. On a shared device, misattribution '
  'is silent and irreversible, so this view deliberately undercounts rather than claiming another person''s history. '
  'actor_id resolves in this order: the guest upgrade the server observed itself, read through subject_user_id; then the '
  'row''s own user_id, which the server took from the request context; then the first link on the row''s client-chosen '
  'anonymous_id; then the anonymous_id itself. A row that already names an account keeps it, so a second account signing '
  'in on a device whose anonymous_id was never rotated is never reported as the first account, and each account is '
  'counted for the events that name it. A link on an anonymous_id therefore resolves only a row that names no account at '
  'all. Two link shapes are resolved here, in two separate namespaces. The client-chosen anonymous_id resolves through '
  'links an authenticated ingest request writes. The server-set subject_user_id resolves only through links the server '
  'derived from a guest upgrade it performed itself, so a client-claimed link can never reach another person''s rows or '
  'outrank the upgrade the server observed.';

-- Account-deletion anonymization is the only writer that looks these tables up by user_id: it
-- anonymizes analytics.product_events rows with user_id = ANY(...) and deletes the account's
-- analytics.identity_links rows by user_id, both inside the deletion transaction. 0114 created
-- neither index and is immutable, so without them the deletion sequentially scans an indefinitely
-- retained event table and the only deadline is the Lambda timeout, which rolls the whole deletion
-- back. These exist for that write path, not as query-path indexes on an append-only table.
CREATE INDEX IF NOT EXISTS idx_product_events_user_id
  ON analytics.product_events (user_id);

CREATE INDEX IF NOT EXISTS idx_identity_links_user_id
  ON analytics.identity_links (user_id);

-- A link's source is the one column a second observation of the same pair may rewrite, and only
-- towards the server: the guest upgrade is something the backend watched happen, while an
-- authenticated_client link is a claim a request carried, so whichever of the two arrives second
-- must not decide the pair's trust. The view above reads the server namespace through
-- source = 'server_derived', so a client claim left in place on a pair the upgrade also observed
-- would silently drop that guest's entire resolution. The insert therefore upgrades the source on
-- conflict, which needs an UPDATE privilege 0114 did not grant and a policy row level security
-- requires. The privilege is column-scoped to source on purpose: anonymous_id, user_id and above all
-- linked_at, which bounds how far back a link may claim history, stay immutable at the database
-- level rather than by convention.
GRANT UPDATE (source) ON TABLE analytics.identity_links TO backend_app;

DROP POLICY IF EXISTS identity_links_backend_update ON analytics.identity_links;
CREATE POLICY identity_links_backend_update
  ON analytics.identity_links
  FOR UPDATE
  TO backend_app
  USING (true)
  WITH CHECK (true);

-- The 0114 comment on this column says it identifies a resource and survives anonymization. That is
-- no longer true, and 0114 is immutable, so the corrected text is restated here.
COMMENT ON COLUMN analytics.product_events.workspace_id IS
  'Workspace selected for the request. It is cleared during account-deletion anonymization, because a workspace id can be '
  'joined back to the deleted person through tables that outlive the account, such as auth.guest_upgrade_history, which '
  'carries workspace ids beside the user ids and is readable by reporting_readonly.';

-- The 0114 comment on this column calls event_id a client-generated UUIDv7 that is also the batch
-- retry dedupe key. This migration ships beside the first rows for which neither half holds: a
-- server-derived emission has no batch, and its id is a digest of the operation the event reports,
-- laid out as a UUID with arbitrary version and variant nibbles. UUIDv7 is time-ordered, so a reader
-- trusting the old text would sort or keyset-paginate this table by event_id, or read an approximate
-- creation time out of it, and be silently wrong for every server-derived row. A backfill or dedupe
-- author would likewise assume client provenance. 0114 is immutable, so the corrected text is
-- restated here.
COMMENT ON COLUMN analytics.product_events.event_id IS
  'Dedupe key for the row, and the only column a redelivered write conflicts on. For origin = ''client'' it is the '
  'client-generated UUIDv7 that makes a redelivered batch insert nothing new. For origin = ''server'' it is a stable value '
  'the backend derives from the operation the event reports, so a replayed operation is still counted once; it is shaped '
  'like a UUID, but its version, variant and timestamp bits carry no meaning. event_id is therefore not time-ordered '
  'across this table: never sort by it, keyset-paginate on it, or read a creation time out of it. Group and order by '
  'occurred_at, and checkpoint on ingested_at.';

-- The 0114 comment on this column presents it as the batch arrival anchor of the skew correction.
-- That holds only for client rows: a server-derived row has no batch and no client clock to correct.
-- 0114 is immutable, so the corrected text is restated here.
COMMENT ON COLUMN analytics.product_events.server_received_at IS
  'For origin = ''client'', the server clock reading when the batch arrived, the trusted anchor of the skew correction. A '
  'server-derived row has no batch and no client clock to correct, so it simply repeats occurred_at, the time the backend '
  'observed the event. Reading this column as delivery latency is meaningful only for client rows.';

GRANT SELECT ON analytics.product_events_resolved TO reporting_readonly;
