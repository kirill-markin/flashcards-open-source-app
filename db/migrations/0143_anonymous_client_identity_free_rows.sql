-- Migration status: Current / additive.
-- Introduces: identity-free anonymous client rows. An anonymous_client row may now carry no
-- anonymous_id, which is what lets a browser report the consent facts that precede any identity at
-- all: the prompt it was shown, and a refusal. Storing an identifier beside either of those would
-- be the very processing the refusal withholds, and a per-request random id substituted in its
-- place would be an identifier again, so the column is left empty rather than filled.
-- Current guidance: anonymous_id stays optional on an anonymous_client row and is still a claim the
-- collector never verifies; every other identity column stays forbidden on that trust level. A row
-- with no anonymous_id resolves to actor_id NULL in analytics.product_events_resolved, whose
-- identity joins are already LEFT JOINs, so it counts as an event that belongs to no actor rather
-- than dropping out of the view. A row that does carry an anonymous_id carries an unverified
-- caller-supplied claim, so a report that counts people excludes trust_level = 'anonymous_client'
-- outright rather than resolving either row to an actor; docs/anonymous-client-analytics.md states
-- that reading.
-- Schemas touched/read explicitly: analytics.
-- See also: db/migrations/0134_catalog_install_journey_analytics.sql,
-- db/migrations/0137_audience_context.sql, docs/anonymous-client-analytics.md,
-- docs/analytics-visitor-identity.md.

-- Added NOT VALID and never validated, deliberately. The predicate below is 0134's
-- product_events_anonymous_client_shape term by term, minus `AND anonymous_id IS NOT NULL` and
-- dropping nothing else, so it is strictly weaker than the rule every stored row was already
-- accepted under: a scan could only confirm what those rows cannot violate. NOT VALID skips that
-- scan while still enforcing the rule on every future insert and update, which is all this
-- migration is for. The scan is worth skipping because scripts/deploy/migrate.sh applies each
-- migration with --single-transaction, so the ACCESS EXCLUSIVE lock this ALTER TABLE takes is held
-- until the file commits: validating here would hold the busiest append-only table in the database
-- against every read and every analytics insert for the length of a whole-table scan.
ALTER TABLE analytics.product_events
  ADD CONSTRAINT product_events_anonymous_client_identity_free_shape CHECK (
    trust_level <> 'anonymous_client'
    OR (
      origin = 'client'
      AND user_id IS NULL
      AND subject_user_id IS NULL
      AND auth_transport IS NULL
      AND guest_session_id IS NULL
      AND workspace_id IS NULL
      AND session_id IS NULL
    )
  ) NOT VALID;

ALTER TABLE analytics.product_events
  DROP CONSTRAINT product_events_anonymous_client_shape;

ALTER TABLE analytics.product_events
  RENAME CONSTRAINT product_events_anonymous_client_identity_free_shape
  TO product_events_anonymous_client_shape;

COMMENT ON COLUMN analytics.product_events.trust_level IS
  'How much the row can be trusted: server_derived is a server observation; authenticated_client and '
  'guest_client are authenticated request claims; anonymous_client is an unauthenticated, event-only '
  'browser claim with no account, guest, workspace, or session identity, and optionally not even an '
  'anonymous one; backfill_derived is reconstructed from server storage.';

COMMENT ON COLUMN analytics.product_events.platform IS
  'Client platform normalized by the server. Authenticated ingest accepts an allowlisted request '
  'header; the credential-free collector is reachable only from the browser origins on its CORS '
  'allowlist and stamps web directly.';

COMMENT ON COLUMN analytics.product_events.anonymous_id IS
  'Client-generated identifier used to count an actor without an account. The authenticated ingest '
  'uses a device-scoped identifier that can later resolve through analytics.identity_links; the '
  'credential-free collector stores the shared browser visitor id a producer sends, or the '
  'one-attempt catalog install journey UUID for the producers that predate it, and creates no '
  'identity link for either. It is empty on a row a visitor may not be identified by at all, which '
  'is every consent fact reported before a grant.';
