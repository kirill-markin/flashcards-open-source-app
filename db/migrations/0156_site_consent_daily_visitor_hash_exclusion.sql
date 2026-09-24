-- Migration status: Current / additive.
-- Introduces: nothing new. It drops and re-adds
--   analytics.product_events.product_events_daily_visitor_hash_shape so the list of event names the
--   daily visitor hash is refused on names eight events rather than three: the marketing site got
--   its own consent banner, reported as site_consent_prompt_shown, site_consent_granted and
--   site_consent_declined, and its own collection switch, reported as site_collection_disabled and
--   site_collection_enabled. The database has to refuse the hash on those exactly as it refuses it
--   on consent_prompt_shown, consent_granted and consent_declined.
-- Current guidance: why the list grew rather than being replaced by a rule. Six of the eight names
--   are identity-free by catalog rule, so a generic rule would have covered them, but both grants
--   are identity-bearing on purpose - a grant is the moment a visitor id may exist at all - and the
--   backend's identityFree check alone would therefore let a grant carry a hash. The consent
--   decision is never recorded beside an identifier of any kind, whichever banner asked, so each
--   grant has to be excluded by name.
-- Current guidance: why the collection switch is on the list as well as the consent decision. "This
--   browser turned collection off" is the same kind of fact as a refusal and exactly what this
--   constraint exists to protect. The backend already refuses the hash on both directions through
--   its identityFree check, so naming them here changes no stored row; what it adds is the database
--   backstop every consent fact already had, instead of leaving isDailyVisitorHashAllowed in
--   apps/backend/src/productAnalytics/dailyVisitorHash.ts as the only guard, which a writer that
--   builds the row directly never reaches.
-- Current guidance: a rename, a fourth banner or another site fact that must never carry a hash
--   needs another migration here. The names live twice on purpose:
--   apps/backend/src/productAnalytics/dailyVisitorHash.ts excludes the six consent names by name and
--   refuses every identityFree catalog entry besides, which is the broader of the two rules. The
--   duplication is the point, so the database refuses the hash whatever writer builds the row.
-- Current guidance: 0144 is immutable and its header still describes the three facts that existed
--   when it ran, as does the COMMENT ON COLUMN it installed. Read this file for the current list;
--   db/migrations/README.md carries that correction. Everything else 0144 states about the hash is
--   unchanged: it is not an actor, it is never linked to a visitor id or an account, its salt is
--   deleted when its UTC day ends, and no raw IP is stored.
-- Current guidance: NOT VALID for the reason 0144 and 0143 give. scripts/deploy/migrate.sh applies
--   each migration with --single-transaction, so the ACCESS EXCLUSIVE lock this ALTER TABLE takes is
--   held until the file commits, and validating would hold the busiest append-only table against
--   every read and every analytics insert for a whole-table scan. The scan could only confirm what
--   no stored row can violate: not one of the five new names has ever been accepted, because they
--   reach the collector for the first time with the deploy that carries this migration. NOT VALID
--   still enforces the rule on every future insert and update.
-- Schemas touched/read explicitly: analytics.
-- See also: db/migrations/0144_anonymous_client_daily_visitor_hash.sql,
-- db/migrations/0143_anonymous_client_identity_free_rows.sql, db/migrations/README.md,
-- apps/backend/src/productAnalytics/dailyVisitorHash.ts,
-- apps/backend/src/productAnalytics/catalog.ts, docs/anonymous-client-analytics.md.

ALTER TABLE analytics.product_events
  DROP CONSTRAINT product_events_daily_visitor_hash_shape;

ALTER TABLE analytics.product_events
  ADD CONSTRAINT product_events_daily_visitor_hash_shape CHECK (
    daily_visitor_hash IS NULL
    OR (
      trust_level = 'anonymous_client'
      AND anonymous_id IS NULL
      AND event_name NOT IN (
        'consent_prompt_shown',
        'consent_granted',
        'consent_declined',
        'site_consent_prompt_shown',
        'site_consent_granted',
        'site_consent_declined',
        'site_collection_disabled',
        'site_collection_enabled'
      )
      AND daily_visitor_hash ~ '^[0-9a-f]{32}$'
    )
  ) NOT VALID;
