# Audience analytics

UI language belongs to the event and is captured before offline queuing. Device language,
timezone, and current app/OS versions describe the installation at upload time. Country is
a daily server observation of an installation, with sparse change periods; it must never
be assigned retroactively to offline events. Missing values remain unknown. No historical
backfill or account-global language inference is performed.

- [Event and installation types](../apps/backend/src/productAnalytics/types.ts)
- [Authenticated event wire validation](../apps/backend/src/productAnalytics/validation.ts):
  optional per-event `uiLocale`; old queued events remain valid.
- [Credential-free collector wire validation](../apps/backend/src/productAnalytics/anonymousEvent.ts):
  optional `uiLocale`, independent of `deviceLocale`. See
  [anonymous client analytics](anonymous-client-analytics.md).
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
- [Synthetic actor detection](../apps/backend/src/productAnalytics/syntheticActorDetector.ts) and
  its [daily schedule](../infra/aws/lib/scheduled-jobs/synthetic-actor-detector.ts): records
  reviewing actors that no human produced into
  [`analytics.excluded_actors`](../db/migrations/0140_analytics_excluded_actors.sql), one row per
  matched analytics actor id, with a per-actor log record and a Sentry warning on an unusually
  large run.
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

## Automation installations

A client may declare that its installation runs under automation. The declaration is stored on the
installation, is never cleared, and stops product analytics for the three producers that resolve a
replica (`review_answered`, `card_created` and `deck_created`) plus everything that installation
uploads through the client ingest. Those three are the ones no in-app switch could prevent, because
the backend derives them from synced data rather than from anything the client sends. Absence of the
declaration and an explicit `false` are the same negative case, and only `true` marks anything, so a
client that says nothing, or that always sends `false`, behaves exactly as before.

Deliberately not covered, and still emitted for a marked installation: `ai_message_sent`,
`catalog_deck_installed`, `guest_upgrade_completed`, `friend_invitation_created` and
`friendship_created`, none of which is attributed to a replica, and any review answered through an
`ai_chat` or `agent_connection` replica, whose `installation_id` is NULL and which therefore carries
no marker by design. A marked installation is not an installation that produces zero events; read
residue as these producers rather than as a defect in the marker.

Also accepted rather than fixed: `sync.claim_installation` hands an installation to whoever presents
its id with the matching platform, so a takeover can mark an installation that was somebody's real
device, and there is no unset path to undo it. That zeroes the three replica-resolving producers for
that installation permanently.

- [Sync wire declaration](../apps/backend/src/sync/contracts/input.ts) and
  [where it is stored](../apps/backend/src/sync/identity/replica.ts): only `true` marks anything,
  persisted by the request that registers the installation and read back by every later claim.
- [Column, stickiness rule and claim read-back](../db/migrations/0141_sync_installation_automation_marker.sql)
- [Server-derived producers](../apps/backend/src/productAnalytics/serverFacts/replicaPlatforms.ts):
  the marker is joined onto the replica and its facts are dropped before emission, in
  [review answers](../apps/backend/src/productAnalytics/serverFacts/reviewAnswers.ts) and
  [content creations](../apps/backend/src/productAnalytics/serverFacts/contentCreations.ts).
- [Client ingest](../apps/backend/src/routes/productAnalytics.ts): a batch declaring
  `isAutomation: true` is validated, answered, and stored nowhere;
  `analytics_events_ingest_automation_dropped` records it.
- [Android declaration](../apps/android/app/src/main/java/com/flashcardsopensourceapp/app/automation/AutomationEnvironment.kt):
  emulator detection, an `isAutomation` instrumentation argument, or the `firebase.test.lab` device
  setting; decided and logged once per process as `event=automation_environment_resolved` with each
  signal as its own field, then sent on every sync body and analytics batch.
  Firebase Test Lab runs on real hardware, where the emulator check sees nothing, and is covered
  twice: the argument arrives from
  [the submission script](../scripts/android/run-android-firebase-test-lab.sh), and the device
  setting marks the run on its own if that argument is ever dropped on the way.
- [iOS declaration](../apps/ios/Flashcards/Flashcards/App/AutomationRun.swift): simulator detection
  or the `FLASHCARDS_AUTOMATION_RUN` environment signal, with an explicit negative value of that
  variable overriding both, decided once per launch and sent on every sync request and analytics
  batch; the harness side is in [`ios-ci-cd.md`](ios-ci-cd.md#automation-marker).
