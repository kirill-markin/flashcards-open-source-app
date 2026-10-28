# Catalog install facts

What the marketing-site to web-app catalog import flow records: independent facts in `analytics.product_events`, with any funnel over them assembled at analysis time. The flow creates no guest user, workspace or visitor identity of its own.

- Event catalog, owning every fact's properties and the retired names still accepted: [`catalog.ts`](../apps/backend/src/productAnalytics/catalog.ts)
- Collector: [anonymous client analytics](anonymous-client-analytics.md); browser identity: [analytics visitor identity](analytics-visitor-identity.md)
- Web producer: [`catalogInstall.ts`](../apps/web/src/analytics/catalogInstall.ts); server install fact: [`install/index.ts`](../apps/backend/src/catalog/distribution/install/index.ts); database contract: [`0134`](../db/migrations/0134_catalog_install_journey_analytics.sql)
- Admin deck funnel: [its query](../apps/admin/src/reports/catalogInstallFunnel/query.ts), which derives an ordered 24-hour activation cohort and reports seven-day study and independent coverage separately

The facts are the site's `catalog_install_clicked` and deck-page `site_page_viewed`, the web app's `catalog_install_preview_ready`, `catalog_install_failed` and `catalog_deck_install_started`, and the server's `catalog_deck_installed`, each carrying `package_version_id`. Entry into the import screen is `screen_viewed`, and sign-in is the generic `signin_*` facts.

Producers never send a raw URL, referrer, email, user or workspace identifier, free text, or identity-link input, and a telemetry failure never blocks or delays navigation, authentication, preview, synchronization or installation.

## Reporting

- Use `occurred_at` for time ranges. Only the server's `catalog_deck_installed` is a completed installation; `catalog_deck_install_started` is intent. Acquisition device context comes from the click, never from the server fact.
- A credential-free row carries the visitor identity as `anonymous_id` and resolves onto the account once the web app records an `authenticated_client` link for it; signed-in rows and the server install carry the account already, and a sign-in is read from the first screen view the same browser sends with an account credential. An import made as a signed-out web browser guest names the guest, which the visitor's rows never resolve onto; its own `guest_client` rows carry the visitor's `analytics_visitor` cookie as `anonymous_id`, and so does its server install unless product analytics was turned off for the request ([`0229`](../db/migrations/0229_server_install_visitor_id.sql)). That cookie survives a logout and an account switch.
- The auth origin's current `anonymous_client` sign-in rows join through the same visitor id but stay out of reports by the [trusted-actor rule](../apps/admin/src/filters/filterSql.ts); its older `guest_client` rows reach the account only through a best-effort link and cannot reliably be joined.
- A click stored with no `anonymousId` sits under its per-attempt `install_journey_id`, which matches no later row; that is every click made before the site and the app shared one registrable domain.
- `screen_viewed` names no deck version, and a browser that refused consent resolves to a NULL actor. The preview moment on the account's side is the `catalog_import_confirm` screen view, because `catalog_install_preview_ready` reaches the account only through the visitor link.
- Activation follows the first-ever eligible identified web click per resolved actor, selected into the UTC range. It requires an actor, original `anonymous_id` and package version; subsequent clicks do not re-enter the cohort. A server installation of that version must follow within 24 hours, then a persisted review must follow the installation within the same 24 hours from the click. Every clicker remains in the denominator; recent cohorts show observed outcomes with a visible maturing count.
- Attribution retains direct resolved-actor matches and adds guest/account actors observed through that click's visitor id on trusted web facts or a server installation of the clicked package. Associations are bounded by the click's follow-up and use the shared actor exclusions; activation accepts associations observed within 24 hours. They are report-local browser associations, not global identity links.
- Seven-day study is separate: only members of the same first-click cohort with seven full days of follow-up enter its denominator, and their persisted reviews from click through day seven count regardless of installation. The ordered activation metric therefore differs from an any-review experiment metric. `review_answered` carries no deck or card identity, so activity is anywhere in the product, never deck-level retention.
- Independent traffic and server-installer totals are coverage counts with no conversion ratios. Cookieless visitor-days cannot establish cross-host attribution; unlinked installs and missing identity are unattributable. Client platform selects the acquisition click and its derived outcomes; independent server-install coverage has no acquisition platform.

## Manual acceptance

1. Generate one UUIDv7 event ID and a real published package version.
2. POST a valid `catalog_install_clicked` body from each configured marketing, app, and auth origin.
   Confirm a `200`, `{"accepted":true}`, and an `X-Request-Id` response header.
3. Repeat the identical event ID. Confirm another `200` and exactly one matching
   `analytics.product_events` row.
4. Submit a server-only event name, an extra `email` field, a malformed UUID, a non-language locale,
   a future event time, and a body larger than 8 KiB. Confirm each is rejected and no row is stored.
5. POST `catalog_install_landed` and each `catalog_install_signin_*` name with an
   `install_journey_id`, as a released client does. Confirm each is accepted and stored.
6. Confirm one catalog install with `installJourneyId` and one without. Verify both succeed, and that
   each writes one server-origin `catalog_deck_installed` row carrying the route's
   `package_version_id` and no `install_journey_id`.
7. Query the events through `reporting_readonly`, ordered by `occurred_at`, and confirm all anonymous
   rows have null `user_id`, `subject_user_id`, `workspace_id`, `guest_session_id`, `session_id`, and
   `auth_transport`.
