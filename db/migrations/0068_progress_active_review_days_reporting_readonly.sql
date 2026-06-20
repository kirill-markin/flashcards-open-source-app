-- Migration status: Current / additive.
-- Introduces: reporting-read access to materialized Progress active review days.
-- Current guidance: used by backend system jobs to find active-day materialization
--   gaps without giving the write-capable backend runtime a global RLS bypass.

GRANT USAGE ON SCHEMA progress TO reporting_readonly;

GRANT SELECT (
  reviewed_by_user_id,
  local_date
) ON TABLE progress.user_active_review_days TO reporting_readonly;

DROP POLICY IF EXISTS user_active_review_days_reporting_readonly_select ON progress.user_active_review_days;
CREATE POLICY user_active_review_days_reporting_readonly_select
  ON progress.user_active_review_days
  FOR SELECT
  TO reporting_readonly
  USING (true);
