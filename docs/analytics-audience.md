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
- [Trusted connection context](../apps/backend/src/geolocation/requestCountry.ts) and
  [daily country sampling](../apps/backend/src/productAnalytics/installationCountry.ts):
  API Gateway source address only; no forwarded-address headers. Auth relays, agent/MCP
  requests and batches without device context do not supply human geography.
- [SQL schema, reporting grants, and country-writer transaction contract](../db/migrations/0137_audience_context.sql)
- [Account and linked-guest deletion](../apps/backend/src/auth/accountDeletion.ts)
- [Country retention](../apps/backend/src/productAnalytics/countryRetention.ts),
  [daily schedule](../infra/aws/lib/scheduled-jobs/country-retention.ts) and
  [failure/staleness alarms](../infra/aws/lib/monitoring.ts)
- [Feedback connection-country snapshot](../db/migrations/0138_feedback_connection_country.sql):
  saved only with the initial submission; existing locale/timezone snapshots remain intact.
- [Gateway access log fields](../infra/aws/lib/gateways/api-gateway-access-log.ts):
  raw IP is excluded; request identifiers and operational error fields remain available.

Country supports aggregate audience analysis, not precise location. Detailed sparse periods
expire by `last_seen` after 90 days; daily cleanup can lag by one scheduling interval and
alerts when it cannot finish. Reads must apply the 90-day cutoff even before cleanup runs.
The first known country stays on the installation profile until its deletion. Feedback
country follows the feedback row's account-deletion lifecycle. IP addresses are used only
in request memory for lookup, without analytics persistence.

Sparse periods are samples, not proof of continuous presence or a daily activity ledger.
Do not infer location across unsampled gaps, assign upload country to offline events, or
claim exact arbitrary-range country uniques from these periods or summed daily aggregates.
Older detailed history is unavailable. Privacy notice and store declarations are a separate
publication deliverable; this implementation makes no compliance or consent-exemption claim.
