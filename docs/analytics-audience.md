# Audience analytics

UI language belongs to the event and is captured before offline queuing. Device language,
timezone, and current app/OS versions describe the installation at upload time. Country is
a daily server observation of an installation, with sparse change periods; it must never
be assigned retroactively to offline events. Missing values remain unknown, and no account-global
language is inferred. The only historical backfills are event `os_name` and `device_type`
([rules](../db/migrations/0177_backfill_analytics_os_name_device_type.sql)) and installation
profile `os_name`, `device_type` and `device_model`
([rules](../db/migrations/0178_backfill_installation_profiles_os_device.sql)), each filled only
where it is certain.

- [Event and installation types](../apps/backend/src/productAnalytics/types.ts)
- [Authenticated event wire validation](../apps/backend/src/productAnalytics/validation.ts) and
  [credential-free collector wire validation](../apps/backend/src/productAnalytics/anonymousEvent.ts);
  see [anonymous client analytics](anonymous-client-analytics.md)
- [Request headers and installation identity](../apps/backend/src/routes/productAnalytics.ts)
- [Atomic persistence and metadata throttling](../apps/backend/src/productAnalytics/writer.ts)
- [Trusted connection context](../apps/backend/src/geolocation/requestCountry.ts) and
  [daily country sampling](../apps/backend/src/productAnalytics/installationCountry.ts):
  the API Gateway source address only. Auth relays, agent/MCP requests and batches without device
  context supply no human geography.
- [SQL schema, reporting grants, and country-writer transaction contract](../db/migrations/0137_audience_context.sql)
- [Account and linked-guest deletion](../apps/backend/src/auth/accountDeletion.ts)
- [Country retention](../apps/backend/src/productAnalytics/countryRetention.ts),
  [daily schedule](../infra/aws/lib/scheduled-jobs/country-retention.ts) and
  [failure/staleness alarms](../infra/aws/lib/monitoring.ts)
- [Synthetic actor detection](../apps/backend/src/productAnalytics/syntheticActorDetector.ts) and
  its [daily schedule](../infra/aws/lib/scheduled-jobs/synthetic-actor-detector.ts), recording into
  [`analytics.excluded_actors`](../db/migrations/0140_analytics_excluded_actors.sql)
- [Probable Android test bursts](../db/migrations/0171_probable_android_burst_actors.sql), which the
  [shared exclusion rule](admin-app.md#who-counts-as-a-person) drops, are a materialized view an
  [hourly job](../infra/aws/lib/scheduled-jobs/probable-android-burst-refresh.ts) refreshes, so a
  change reaches reports at the next refresh.
- [Probable scraper-fleet visitors](../db/migrations/0226_probable_scraper_fleet_worldwide_rule.sql), by
  actor and by daily visitor hash, are a materialized view the same
  [hourly job](../infra/aws/lib/scheduled-jobs/probable-android-burst-refresh.ts) refreshes.
- [Feedback connection-country snapshot](../db/migrations/0138_feedback_connection_country.sql)
- [Gateway access log fields](../infra/aws/lib/gateways/api-gateway-access-log.ts): raw IP is excluded.

Country supports aggregate audience analysis, not precise location. Detailed sparse periods
expire by the [retention cutoff](../apps/backend/src/productAnalytics/countryRetention.ts), which
states what readers owe it. The first known country stays on the
installation profile until its deletion, and feedback country follows the feedback row's
account-deletion lifecycle. IP addresses are used only in request memory for lookup.

Sparse periods are samples, not proof of continuous presence or a daily activity ledger.
Do not infer location across unsampled gaps, assign upload country to offline events, or
claim exact arbitrary-range country uniques from these periods or summed daily aggregates.
Privacy notice and store declarations are a separate publication deliverable; this implementation
makes no compliance or consent-exemption claim.

## Automation installations

A client may declare that its installation runs under automation. Only `true` marks it, and the
stored marker is never cleared ([where it is stored](../apps/backend/src/sync/identity/replica.ts),
[migration](../db/migrations/0141_sync_installation_automation_marker.sql)). A marked installation
stops product analytics for every server fact that resolves its replica, `review_answered` and the
card and deck content facts ([review answers](../apps/backend/src/productAnalytics/serverFacts/reviewAnswers.ts),
[content writes](../apps/backend/src/productAnalytics/serverFacts/contentWrites.ts)), and for
everything it uploads through the [client ingest](../apps/backend/src/routes/productAnalytics.ts).
Those are the facts no in-app switch could prevent, because the backend derives them from synced
data. Reports also hide the actors
[`automationInstallationActorIdsSqlLines`](../apps/backend/src/reviewMetricsSql.ts) selects from
marked installations; raw events stay stored.

A marked installation still produces events, so read residue as these producers rather than as a
marker defect: server facts attributed to no replica, such as AI, catalog installs, guest upgrade,
friendships and the [decision facts](../apps/backend/src/productAnalytics/serverFacts/decisionFacts.ts);
reviews through an `ai_chat` or `agent_connection` replica, which has no installation; and the
[billing facts](../apps/backend/src/productAnalytics/serverFacts/billingFacts.ts), exempt by the
decision their module header records.

Accepted rather than fixed: `sync.claim_installation` hands an installation to whoever presents its
id with the matching platform, so a takeover can mark somebody's real device, and with no unset path
that installation's replica-resolving facts stay suppressed permanently.

Declarations:

- [Android](../apps/android/app/src/main/java/com/flashcardsopensourceapp/app/automation/AutomationEnvironment.kt),
  sent on every sync body and analytics batch; Device Run sessions receive the argument from
  [the submission script](../scripts/android/run-android-device-run.sh).
- [Apple](../apps/ios/Flashcards/Flashcards/App/AutomationRun.swift), decided once per process and
  sent through the same sync and batch contract. Marked runs disable client recording before startup
  and throughout preference refresh and toggle, without storing a forced opt-out or pushing
  preferences onto the linked review account; see [harness/logging](ios-ci-cd.md#automation-marker) and
  [signed native/database verification](macos-ci-cd.md#development-analytics-verification).
- [Web](../apps/web/src/analytics/deliveryRuntime.ts), on authenticated analytics batches only; web
  sync requests and credential-free collector events carry no declaration.

## Test-distribution installations

A client may also declare `isTestDistribution`: its installation did not come from the public store
(TestFlight, App Review or a developer build). It is stored the same one-way way
([migration](../db/migrations/0222_sync_installation_test_distribution_marker.sql)), suppresses no
producer, and [`testDistributionInstallationActorIdsSqlLines`](../apps/backend/src/reviewMetricsSql.ts)
drops every person such an installation belongs to, signed in or not. Android and web cannot tell and
send nothing.
