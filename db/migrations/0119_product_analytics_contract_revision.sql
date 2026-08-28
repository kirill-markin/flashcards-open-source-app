-- Migration status: Current / additive plus a one-time data reset.
-- Introduces: analytics.product_events.details, the (event_name, occurred_at) index the rewritten
--   admin dashboard reads, analytics.derive_server_event_id as the in-database twin of the backend's
--   server-derived event id derivation, and the deletion of every event row written under the
--   pre-revision catalog.
-- Schemas touched/read explicitly: analytics, pg_catalog.

ALTER TABLE analytics.product_events
  ADD COLUMN IF NOT EXISTS details JSONB;

-- The column is schema-less by design, so a key allowlist or a per-value rule would be a contract
-- this migration cannot state. What is bounded instead is the only thing that stays meaningful
-- without one: the object shape, so a reader can always address it by key, and the serialized size
-- of a single row's payload, so no producer can turn an indefinitely retained table into a log sink.
-- The cap is measured on the jsonb text rendering rather than on the stored representation, because
-- that rendering is what every reader sees and what a producer can reason about before writing.
ALTER TABLE analytics.product_events
  ADD CONSTRAINT product_events_details_shape CHECK (
    details IS NULL
    OR (
      pg_catalog.jsonb_typeof(details) = 'object'
      AND pg_catalog.octet_length(details::text) <= 2000
    )
  );

COMMENT ON COLUMN analytics.product_events.details IS
  'Free-form, deliberately schema-less detail about how the row itself was produced, such as which '
  'production table a backfilled fact was reconstructed from. It is written only by server-derived '
  'producers and by backfills. The client ingest path has no field for it and must never gain one: '
  'a client-writable free-form column is exactly the channel event_properties was bound to fixed '
  'formats to avoid. Like event_properties and experiment_assignments, this column survives account '
  'anonymization untouched, so nothing that identifies a person may ever be written here - not a '
  'name, an email, a device identifier, free text a person typed, or anything joinable back to '
  'them. It is derivation provenance, not observation payload.';

-- The rule the comment above states is enforced rather than left advisory. 0114 bound the
-- client-owned columns to origin 'client' with product_events_client_columns_shape; this is the
-- mirror of that constraint, for the one column the client must never write. It is worth a
-- constraint rather than a convention because details survives account anonymization untouched, so
-- anything a client managed to write here would outlive the account deletion meant to remove it.
ALTER TABLE analytics.product_events
  ADD CONSTRAINT product_events_details_client_shape CHECK (
    origin <> 'client'
    OR details IS NULL
  );

-- 0114 revoked the analytics schema's default table privileges for reporting_readonly and granted
-- that role one explicit column list per table instead, so a column added later stays invisible to
-- reporting until it is named in a grant of its own. This is that grant. Column grants are
-- additive, so it extends the 0114 list rather than replacing it.
GRANT SELECT (details) ON TABLE analytics.product_events TO reporting_readonly;

-- No privilege is granted to backend_app for this column, and none is needed: server-derived
-- producers write it through the INSERT 0114 already granted. The UPDATE 0114 granted on this table
-- exists solely for the account-deletion anonymization path, which clears the person-linked columns
-- in place; that grant is table-wide and therefore already reaches this column, so nothing here can
-- narrow it further. What keeps details out of that path is the rule stated on the column above:
-- nothing person-linked is ever stored in it, so anonymization has nothing to clear here and must
-- not add it to its SET list.

-- 0114 states that every additional index is write amplification on an insert-only table, and that a
-- composite index such as this one is added only when a concrete query needs it. This is that query:
-- the rewritten admin dashboard reads a single event_name over a date range and groups it by day and
-- by actor. idx_product_events_occurred_at (0114) leads on occurred_at alone, so that panel scans
-- every event name in the range and discards all but one; leading on event_name reduces the scan to
-- the rows the panel actually reports, and keeping occurred_at as the second key column holds the
-- date range inside the same index scan.
CREATE INDEX IF NOT EXISTS idx_product_events_event_name_occurred_at
  ON analytics.product_events (event_name, occurred_at);

-- The in-database twin of deriveServerDerivedProductAnalyticsEventId in
-- apps/backend/src/productAnalytics/serverEvents.ts. It exists so a backfill written in SQL derives
-- exactly the id the live emitter derives for the same operation: backfilled and live rows then
-- collide on the primary key of an append-only table and are counted once, instead of both being
-- stored and double-counting every reconstructed fact.
--
-- The two implementations must never diverge. Neither may be changed without the other, and the
-- equality is proved for fixed vectors by
-- apps/backend/src/productAnalytics/serverEvents.postgres.integration.ts, which runs both sides
-- against each other. The salt below is a plain constant in that same public source file, so
-- restating it here publishes nothing that was not already published; like there, it must never
-- change, because every id ever stored was derived from it.
--
-- PostgreSQL 18 has sha256(bytea) built in, so no extension is involved. The digest is laid out as a
-- UUID only because event_id is a uuid column: its version and variant nibbles carry no meaning,
-- exactly as 0115's corrected comment on event_id says.
--
-- STRICT so a NULL argument yields NULL and fails loudly against the NOT NULL primary key, rather
-- than silently hashing a shorter string. A NULL *element* inside key_parts needs no such guard,
-- because array_to_string is given its three-argument form: the '' null_string renders a NULL
-- element as the empty string, which is exactly what Array.prototype.join does on the TypeScript
-- side. The two-argument form would drop the element instead and derive an id that no live emission
-- could ever collide with, so the third argument is what makes this twin exact for key_parts built
-- out of columns that are nullable at the schema level, and not only for NULL-free ones. It is
-- byte-identical to the two-argument form for every input that has no NULL element.
CREATE FUNCTION analytics.derive_server_event_id(
  event_name TEXT,
  key_parts TEXT[]
)
RETURNS UUID
LANGUAGE SQL
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $$
  SELECT (
    pg_catalog.substr(derived.digest, 1, 8)
    || '-' || pg_catalog.substr(derived.digest, 9, 4)
    || '-' || pg_catalog.substr(derived.digest, 13, 4)
    || '-' || pg_catalog.substr(derived.digest, 17, 4)
    || '-' || pg_catalog.substr(derived.digest, 21, 12)
  )::uuid
  FROM (
    SELECT pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(
          pg_catalog.array_to_string(
            ARRAY[
              'flashcards-open-source-app:product-analytics:server-derived-event-id:v1',
              event_name
            ] || key_parts,
            ':',
            ''
          ),
          'UTF8'
        )
      ),
      'hex'
    ) AS digest
  ) AS derived;
$$;

COMMENT ON FUNCTION analytics.derive_server_event_id(TEXT, TEXT[]) IS
  'In-database twin of deriveServerDerivedProductAnalyticsEventId in '
  'apps/backend/src/productAnalytics/serverEvents.ts, so a SQL backfill derives exactly the event_id '
  'the live emitter derives for the same operation and the two rows collide on the primary key '
  'instead of double-counting the fact. The two implementations must never diverge; '
  'apps/backend/src/productAnalytics/serverEvents.postgres.integration.ts proves they agree on fixed '
  'vectors. A NULL element inside key_parts renders as the empty string, exactly as '
  'Array.prototype.join does on the TypeScript side, so key_parts built out of nullable columns '
  'needs no coalescing or filtering by the caller.';

-- Every row stored so far is deleted, unconditionally, because every one of them was written under
-- the pre-revision event catalog. What is stored is one day of low-volume, web-only rows. Everything
-- server-derived in it is re-derived from the production tables by the later backfill, and the
-- derivation above is what makes those reconstructed rows land on the same ids, so the only thing
-- actually lost is the client events of that single day. Keeping them instead would mean carrying
-- rows from a retired contract indefinitely, plus a permanent note on every query and every reader
-- explaining which day to exclude and why, which is a worse cost than losing one day of early
-- traffic.
--
-- Migrations run as the database owner (infra/aws/lib/migration-runner.ts passes
-- DB_OWNER_SECRET_ARN), so this statement needs no grant and backend_app still has no DELETE on the
-- table: the application role stays unable to remove an event row.
--
-- analytics.identity_links is deliberately not touched. A link is a fact about which anonymous
-- identity became which account, it is still true after this revision, and the backfill depends on
-- those links to resolve the actors of the rows it reconstructs.
DELETE FROM analytics.product_events;
