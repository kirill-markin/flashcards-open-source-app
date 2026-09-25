-- Migration status: Current / additive.
-- Introduces: no schema change. It restates analytics.product_events.country, which now carries two
--   meanings instead of one: the legacy per-event country of an authenticated row, and the
--   ingest-time country of a credential-free collector row, derived by the backend from the address
--   the request arrived from. The column was already nullable and already selected by
--   analytics.product_events_resolved, so the collector needed neither a column nor a grant; what it
--   needed was for the comment to stop saying the country is legacy and nothing else.
-- Current guidance: the credential-free country is derived at ingest and stored as two letters, with
--   no raw address kept anywhere, and no region or city derived from it. It is withheld from two
--   kinds of row: an event whose catalog entry is identityFree, which may be stored beside nothing
--   that describes the visitor, and a request from the auth origin, whose sign-in funnel is posted
--   server-side from the auth Lambda, so its address is that service's egress address rather than a
--   visitor's. It is NULL for an ordinary unplaceable visitor too: an address the GeoLite database
--   cannot place, and a request that reached the backend with no direct source address of its own.
--   A lookup that fails outright refuses the event rather than storing NULL, because this table is
--   append-only and a fabricated NULL could never be repaired, while the producer retries a refused
--   event under its own idempotent event id. An address that reaches the collector through a relay
--   or a VPN yields that relay's country, which is what the column means and not an error in it.
--   Nothing is backfilled: the table is append-only and no country can be reconstructed after the
--   fact, so a row written before the backend that fills it simply carries NULL. Account deletion
--   reaches the authenticated half of this column only: apps/backend/src/auth/accountDeletion.ts
--   clears it by user_id, and product_events_anonymous_client_shape (0143) forbids a user_id on a
--   credential-free row, so no deletion can ever reach the country of one. The authenticated batch
--   route keeps writing this column exactly as it did, and installation country sampling stays in
--   analytics.installation_country_observations.
-- Schemas touched/read explicitly: analytics.
-- See also: db/migrations/0137_audience_context.sql, db/migrations/0114_product_analytics_storage.sql,
-- apps/backend/src/routes/anonymousAnalytics.ts, apps/backend/src/geolocation/requestCountry.ts,
-- docs/anonymous-client-analytics.md, docs/geolite-country.md.

COMMENT ON COLUMN analytics.product_events.country IS
  'Two-letter country of the row, from one of two producers. On an authenticated row it is the '
  'legacy per-event country, retained for compatibility. On a credential-free collector row it is '
  'the country the backend derived at ingest from the address the request arrived from, which can '
  'be a relay''s address rather than the visitor''s. It is NULL there for an identity-free event, '
  'for the auth origin''s server-side sign-in funnel, for an address the GeoLite database cannot '
  'place, and for a request that reached the backend with no direct source address of its own. The '
  'address itself is never stored, and no region or city is derived from it. Nothing is backfilled, '
  'so NULL also means a row stored before its producer filled the column. Installation country '
  'samples belong to analytics.installation_country_observations; upload country must not be '
  'projected back onto queued events. Cleared on account deletion on an authenticated row; a '
  'credential-free row carries no account to delete, so nothing clears its country.';
