# Audience analytics

UI language belongs to the event and is captured before offline queuing. Device language,
timezone, and current app/OS versions describe the installation at upload time. Country is
a daily server observation of an installation, with sparse change periods; it must never
be assigned retroactively to offline events. Missing values remain unknown. No historical
backfill or account-global language inference is performed.

- [Event and installation types](../apps/backend/src/productAnalytics/types.ts)
- [Authenticated event wire validation](../apps/backend/src/productAnalytics/validation.ts):
  optional per-event `uiLocale`; old queued events remain valid.
- [Catalog collector wire validation](../apps/backend/src/productAnalytics/catalogJourney.ts):
  optional `uiLocale`, independent of `deviceLocale`.
- [Request headers and installation identity](../apps/backend/src/routes/productAnalytics.ts):
  batch `anonymousId` plus normalized header platform; catalog journey IDs are excluded.
- [Atomic persistence and metadata throttling](../apps/backend/src/productAnalytics/writer.ts)
- [SQL schema, reporting grants, and country-writer transaction contract](../db/migrations/0137_audience_context.sql)
- [Account and linked-guest deletion](../apps/backend/src/auth/accountDeletion.ts)

Country runtime sampling and retention are separate consumers of the schema. Deploy the
additive schema and ingest contract before deploying clients that emit the new field.
