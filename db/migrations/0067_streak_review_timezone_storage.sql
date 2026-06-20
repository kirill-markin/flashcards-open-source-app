-- Migration status: Current / additive.
-- Introduces: review-time timezone storage and user active review day materialization.
-- Current guidance: new review writes may store the review timezone and local
--   date at creation time. Historical review rows intentionally remain nullable
--   here and are not mass-backfilled.

ALTER TABLE org.user_settings
  ADD COLUMN IF NOT EXISTS progress_time_zone TEXT;

COMMENT ON COLUMN org.user_settings.progress_time_zone IS
  'Most recently known IANA timezone for Progress calculations. Used only as a fallback for old review clients that do not send reviewed_time_zone.';

ALTER TABLE content.review_events
  ADD COLUMN IF NOT EXISTS reviewed_time_zone TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_local_date DATE,
  ADD COLUMN IF NOT EXISTS reviewed_time_zone_source TEXT;

COMMENT ON COLUMN content.review_events.reviewed_time_zone IS
  'IANA timezone used to compute reviewed_local_date at review write time. Nullable for historical rows and old clients with no known timezone.';
COMMENT ON COLUMN content.review_events.reviewed_local_date IS
  'Local calendar date of reviewed_at_client in reviewed_time_zone, computed once at review write time. Nullable until materialized.';
COMMENT ON COLUMN content.review_events.reviewed_time_zone_source IS
  'Source of reviewed_time_zone. client means the review payload supplied it; user_settings means org.user_settings.progress_time_zone was used as an old-client fallback.';

CREATE SCHEMA IF NOT EXISTS progress;

GRANT USAGE ON SCHEMA progress TO backend_app;

CREATE TABLE IF NOT EXISTS progress.user_active_review_days (
  reviewed_by_user_id       TEXT        NOT NULL REFERENCES org.user_settings(user_id) ON DELETE CASCADE,
  local_date                DATE        NOT NULL,
  review_count              INTEGER     NOT NULL CHECK (review_count > 0),
  first_reviewed_at_client  TIMESTAMPTZ NOT NULL,
  last_reviewed_at_client   TIMESTAMPTZ NOT NULL,
  time_zone                 TEXT        NOT NULL,
  time_zone_source          TEXT        NOT NULL CHECK (time_zone_source IN ('client', 'user_settings')),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (reviewed_by_user_id, local_date)
);

COMMENT ON TABLE progress.user_active_review_days IS
  'One materialized active review day per user/local date, computed from review-time timezone data. Counts every rating, including Again.';
COMMENT ON COLUMN progress.user_active_review_days.reviewed_by_user_id IS
  'Authenticated review author. Rows are user-scoped, not workspace-scoped, so streak reads can aggregate across accessible workspaces.';
COMMENT ON COLUMN progress.user_active_review_days.local_date IS
  'Review-time local calendar date. This value is not rewritten when the user changes timezone later.';
COMMENT ON COLUMN progress.user_active_review_days.review_count IS
  'Number of stored review events for this user/local date. Counts every rating.';
COMMENT ON COLUMN progress.user_active_review_days.time_zone IS
  'IANA timezone used for the representative first review that created or anchored this active day.';
COMMENT ON COLUMN progress.user_active_review_days.time_zone_source IS
  'Source of time_zone: client review payload or user_settings fallback.';

CREATE INDEX IF NOT EXISTS idx_user_active_review_days_user_local_date_desc
  ON progress.user_active_review_days(reviewed_by_user_id, local_date DESC);

ALTER TABLE progress.user_active_review_days ENABLE ROW LEVEL SECURITY;

GRANT SELECT (
  reviewed_by_user_id,
  local_date,
  review_count,
  first_reviewed_at_client,
  last_reviewed_at_client,
  time_zone,
  time_zone_source,
  created_at,
  updated_at
) ON TABLE progress.user_active_review_days TO backend_app;

GRANT INSERT (
  reviewed_by_user_id,
  local_date,
  review_count,
  first_reviewed_at_client,
  last_reviewed_at_client,
  time_zone,
  time_zone_source
) ON TABLE progress.user_active_review_days TO backend_app;

GRANT UPDATE (
  review_count,
  first_reviewed_at_client,
  last_reviewed_at_client,
  time_zone,
  time_zone_source,
  updated_at
) ON TABLE progress.user_active_review_days TO backend_app;

DROP POLICY IF EXISTS user_active_review_days_self_select_runtime ON progress.user_active_review_days;
CREATE POLICY user_active_review_days_self_select_runtime
  ON progress.user_active_review_days
  FOR SELECT
  TO backend_app
  USING (reviewed_by_user_id = security.current_user_id());

DROP POLICY IF EXISTS user_active_review_days_self_insert_runtime ON progress.user_active_review_days;
CREATE POLICY user_active_review_days_self_insert_runtime
  ON progress.user_active_review_days
  FOR INSERT
  TO backend_app
  WITH CHECK (reviewed_by_user_id = security.current_user_id());

DROP POLICY IF EXISTS user_active_review_days_self_update_runtime ON progress.user_active_review_days;
CREATE POLICY user_active_review_days_self_update_runtime
  ON progress.user_active_review_days
  FOR UPDATE
  TO backend_app
  USING (reviewed_by_user_id = security.current_user_id())
  WITH CHECK (reviewed_by_user_id = security.current_user_id());
