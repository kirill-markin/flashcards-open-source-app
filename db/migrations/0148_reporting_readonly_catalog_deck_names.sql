-- Migration status: Current / additive.
-- Introduces: read-only reporting access to the two catalog columns that turn a package version id
--   into a deck name, so an admin report can label a deck instead of printing a raw UUID.
-- Current guidance: the admin catalog install funnel carries the deck it is looking at as
--   analytics.product_events.event_properties ->> 'package_version_id'
--   (apps/admin/src/reports/catalogInstallFunnel/query.ts), and this grant is what lets that funnel
--   group visits by the deck behind that version. That needs exactly two things: the
--   version-to-package edge catalog.package_versions(package_version_id, package_id), and the
--   package's current public key catalog.packages(package_id, slug). The slug is the label this
--   report prints, so title, summary, description, status, review, authoring and educational
--   columns, the version's own frozen slug, and every other catalog table stay hidden.
-- Current guidance: the slug is already public. The public catalog serves a published deck by it at
--   GET /v1/catalog/packages/:packageSlug (apps/backend/src/routes/catalog/public.ts) and the deck
--   page on the marketing site is addressed by it, so this grant exposes nothing the catalog does
--   not already publish.
-- Current guidance: db/migrations/0083_catalog_kernel.sql granted USAGE ON SCHEMA catalog to
--   backend_app only, so reporting_readonly needs that usage here. It holds no table grant and no
--   default privilege in catalog, so the usage grant by itself reaches no table and the two column
--   lists below are the whole of the access. The catalog tables carry no row-level security, so no
--   policy accompanies this grant.
-- Schemas touched/read explicitly: catalog.
-- See also: db/migrations/0044_reporting_readonly_role.sql, db/migrations/0083_catalog_kernel.sql.

GRANT USAGE ON SCHEMA catalog TO reporting_readonly;

GRANT SELECT (
  package_version_id,
  package_id
) ON TABLE catalog.package_versions TO reporting_readonly;

GRANT SELECT (
  package_id,
  slug
) ON TABLE catalog.packages TO reporting_readonly;
