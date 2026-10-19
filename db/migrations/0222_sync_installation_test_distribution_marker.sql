-- Migration status: Current / canonical.
-- Introduces: the test-distribution marker a client declares about its own installation.
-- Current guidance: only a client declaration sets the marker and nothing clears it; the shared
-- report exclusion rule (apps/backend/src/reviewMetricsSql.ts) drops every person such an
-- installation belongs to. reporting_readonly reads it through its table-level SELECT on
-- sync.installations (0044), so no grant changes.
-- Schemas touched/read explicitly: sync.
-- See also: db/migrations/0141_sync_installation_automation_marker.sql,
-- docs/analytics-audience.md.

ALTER TABLE sync.installations
  ADD COLUMN is_test_distribution BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN sync.installations.is_test_distribution IS
  'The installation declared it was not installed from the public store (TestFlight, App Review or '
  'a developer build), so the people it belongs to are not product analytics. Only a client '
  'declaration sets it, and nothing clears it. FALSE is both "declared nothing" and "cannot tell", '
  'which is what every Android, web and already released client reports.';
