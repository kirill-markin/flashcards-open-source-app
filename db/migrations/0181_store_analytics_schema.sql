-- Migration status: Current / additive.
-- Introduces: the store_analytics schema. store_analytics.import_files keeps one row per imported App
--   Store Connect Analytics report segment or Google Play statistics CSV. Each named row table keeps
--   the rows of one report family, and store_analytics.apple_other_report_rows and
--   store_analytics.play_other_report_rows keep the rows of every report family without a table of
--   its own, keyed by report_name. Every row references the file it came from. Nothing reads or
--   writes these tables in this migration.
-- Current guidance: dimensions are TEXT, metrics are NUMERIC and dates are DATE. Columns a named row
--   table does not name are kept in its extra_columns, keyed by the store's header name. The two
--   *_other_report_rows tables keep every column of the row in columns instead.
-- Current guidance: row-level security is not enabled. These rows are store-reported aggregates
--   rather than per-person rows, so access is narrowed by grants alone: backend_app selects, inserts
--   and deletes, and reporting_readonly reads every table whole.
-- Schemas touched/read explicitly: store_analytics.
-- See also: db/migrations/0151_billing_schema.sql, docs/analytics-db-access.md.

SET LOCAL lock_timeout = '30s';

CREATE SCHEMA store_analytics;

COMMENT ON SCHEMA store_analytics IS
  'Rows of the App Store Connect Analytics reports and Google Play statistics files. Each named row '
  'table holds one report family; apple_other_report_rows and play_other_report_rows hold every family '
  'without a table of its own, keyed by report_name. Each row references the '
  'store_analytics.import_files row it was imported from.';

CREATE TABLE store_analytics.import_files (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  store TEXT NOT NULL CHECK (store IN ('app_store', 'google_play')),
  report_name TEXT NOT NULL,
  detail_level TEXT CHECK (detail_level IN ('standard', 'detailed', 'single')),
  granularity TEXT CHECK (granularity IN ('DAILY', 'WEEKLY', 'MONTHLY')),
  source_ref TEXT NOT NULL UNIQUE,
  processing_date DATE,
  file_month DATE,
  checksum TEXT,
  header TEXT[] NOT NULL,
  row_count INTEGER NOT NULL CHECK (row_count >= 0),
  report_date_from DATE,
  report_date_to DATE,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT import_files_store_shape CHECK (
    (
      store = 'app_store'
      AND detail_level IS NOT NULL
      AND granularity IS NOT NULL
      AND processing_date IS NOT NULL
      AND file_month IS NULL
    )
    OR (
      store = 'google_play'
      AND detail_level IS NULL
      AND granularity IS NULL
      AND processing_date IS NULL
    )
  ),
  CONSTRAINT import_files_report_date_range CHECK (report_date_from <= report_date_to)
);

COMMENT ON TABLE store_analytics.import_files IS
  'One row per imported App Store Connect Analytics report segment or Google Play statistics file. '
  'Deleting a row deletes every row imported from it.';
COMMENT ON COLUMN store_analytics.import_files.report_name IS
  'The App Store Connect report name exactly as the API returns it, or the Google Play object family '
  'such as stats/store_performance.';
COMMENT ON COLUMN store_analytics.import_files.detail_level IS
  'standard or detailed for an App Store report published in both variants, single for one published '
  'without that split. NULL for Google Play.';
COMMENT ON COLUMN store_analytics.import_files.source_ref IS
  'The source object: <instanceId>/<segmentId> for an App Store segment, <objectName>#<generation> for '
  'a Google Play file.';
COMMENT ON COLUMN store_analytics.import_files.header IS
  'The column header of the file in its original order.';

-- App Store Connect Analytics reports. Columns a report publishes only in its Detailed variant are
-- NULL on standard rows.

CREATE TABLE store_analytics.apple_discovery_engagement (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_file_id BIGINT NOT NULL REFERENCES store_analytics.import_files(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  granularity TEXT NOT NULL CHECK (granularity IN ('DAILY', 'WEEKLY', 'MONTHLY')),
  detail_level TEXT NOT NULL CHECK (detail_level IN ('standard', 'detailed', 'single')),
  processing_date DATE NOT NULL,
  app_apple_identifier TEXT NOT NULL,
  event TEXT,
  page_type TEXT,
  page_title TEXT,
  source_type TEXT,
  source_info TEXT,
  campaign TEXT,
  engagement_type TEXT,
  device TEXT,
  platform_version TEXT,
  territory TEXT,
  counts NUMERIC,
  unique_counts NUMERIC,
  extra_columns JSONB NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE store_analytics.apple_discovery_engagement IS
  'Rows of the App Store Discovery and Engagement report.';

CREATE TABLE store_analytics.apple_web_preview_engagement (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_file_id BIGINT NOT NULL REFERENCES store_analytics.import_files(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  granularity TEXT NOT NULL CHECK (granularity IN ('DAILY', 'WEEKLY', 'MONTHLY')),
  detail_level TEXT NOT NULL CHECK (detail_level IN ('standard', 'detailed', 'single')),
  processing_date DATE NOT NULL,
  app_apple_identifier TEXT NOT NULL,
  event TEXT,
  page_type TEXT,
  page_title TEXT,
  source_type TEXT,
  source_info TEXT,
  engagement_type TEXT,
  browser TEXT,
  browser_version TEXT,
  device TEXT,
  platform_version TEXT,
  territory TEXT,
  counts NUMERIC,
  extra_columns JSONB NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE store_analytics.apple_web_preview_engagement IS
  'Rows of the App Store Web Preview Engagement report.';

CREATE TABLE store_analytics.apple_downloads (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_file_id BIGINT NOT NULL REFERENCES store_analytics.import_files(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  granularity TEXT NOT NULL CHECK (granularity IN ('DAILY', 'WEEKLY', 'MONTHLY')),
  detail_level TEXT NOT NULL CHECK (detail_level IN ('standard', 'detailed', 'single')),
  processing_date DATE NOT NULL,
  app_apple_identifier TEXT NOT NULL,
  download_type TEXT,
  app_version TEXT,
  device TEXT,
  platform_version TEXT,
  source_type TEXT,
  source_info TEXT,
  campaign TEXT,
  page_type TEXT,
  page_title TEXT,
  pre_order TEXT,
  territory TEXT,
  counts NUMERIC,
  extra_columns JSONB NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE store_analytics.apple_downloads IS
  'Rows of the App Downloads report.';

CREATE TABLE store_analytics.apple_installs_deletions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_file_id BIGINT NOT NULL REFERENCES store_analytics.import_files(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  granularity TEXT NOT NULL CHECK (granularity IN ('DAILY', 'WEEKLY', 'MONTHLY')),
  detail_level TEXT NOT NULL CHECK (detail_level IN ('standard', 'detailed', 'single')),
  processing_date DATE NOT NULL,
  app_apple_identifier TEXT NOT NULL,
  event TEXT,
  download_type TEXT,
  app_version TEXT,
  device TEXT,
  platform_version TEXT,
  source_type TEXT,
  source_info TEXT,
  campaign TEXT,
  page_type TEXT,
  page_title TEXT,
  app_download_date DATE,
  territory TEXT,
  counts NUMERIC,
  unique_devices NUMERIC,
  extra_columns JSONB NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE store_analytics.apple_installs_deletions IS
  'Rows of the App Store Installation and Deletion report.';

CREATE TABLE store_analytics.apple_sessions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_file_id BIGINT NOT NULL REFERENCES store_analytics.import_files(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  granularity TEXT NOT NULL CHECK (granularity IN ('DAILY', 'WEEKLY', 'MONTHLY')),
  detail_level TEXT NOT NULL CHECK (detail_level IN ('standard', 'detailed', 'single')),
  processing_date DATE NOT NULL,
  app_apple_identifier TEXT NOT NULL,
  app_version TEXT,
  device TEXT,
  platform_version TEXT,
  source_type TEXT,
  source_info TEXT,
  campaign TEXT,
  page_type TEXT,
  page_title TEXT,
  app_download_date DATE,
  territory TEXT,
  sessions NUMERIC,
  total_session_duration NUMERIC,
  unique_devices NUMERIC,
  extra_columns JSONB NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE store_analytics.apple_sessions IS
  'Rows of the App Sessions report.';

CREATE TABLE store_analytics.apple_purchases (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_file_id BIGINT NOT NULL REFERENCES store_analytics.import_files(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  granularity TEXT NOT NULL CHECK (granularity IN ('DAILY', 'WEEKLY', 'MONTHLY')),
  detail_level TEXT NOT NULL CHECK (detail_level IN ('standard', 'detailed', 'single')),
  processing_date DATE NOT NULL,
  app_apple_identifier TEXT NOT NULL,
  purchase_type TEXT,
  content_name TEXT,
  content_apple_identifier TEXT,
  payment_method TEXT,
  device TEXT,
  platform_version TEXT,
  source_type TEXT,
  source_info TEXT,
  campaign TEXT,
  page_type TEXT,
  page_title TEXT,
  app_download_date DATE,
  pre_order TEXT,
  territory TEXT,
  purchases NUMERIC,
  proceeds_usd NUMERIC,
  sales_usd NUMERIC,
  paying_users NUMERIC,
  extra_columns JSONB NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE store_analytics.apple_purchases IS
  'Rows of the App Store Purchases report.';

CREATE TABLE store_analytics.apple_subscription_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_file_id BIGINT NOT NULL REFERENCES store_analytics.import_files(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  granularity TEXT NOT NULL CHECK (granularity IN ('DAILY', 'WEEKLY', 'MONTHLY')),
  detail_level TEXT NOT NULL CHECK (detail_level IN ('standard', 'detailed', 'single')),
  processing_date DATE NOT NULL,
  app_apple_identifier TEXT NOT NULL,
  event_sub_type TEXT,
  event_grouping TEXT,
  subscription_name TEXT,
  subscription_identifier TEXT,
  subscription_duration TEXT,
  billing_frequency TEXT,
  billing_period TEXT,
  subscription_group TEXT,
  subscription_group_identifier TEXT,
  offer_type TEXT,
  offer_name TEXT,
  offer_id TEXT,
  vanity_code TEXT,
  offer_pricing TEXT,
  offer_duration TEXT,
  plan_change_type TEXT,
  previous_subscription_name TEXT,
  previous_subscription_identifier TEXT,
  family_sharing TEXT,
  cancellation_reason TEXT,
  paid_service_days_recovered TEXT,
  app_download_source_type TEXT,
  app_download_source_info TEXT,
  campaign TEXT,
  page_type TEXT,
  page_title TEXT,
  pre_order TEXT,
  original_purchase_device TEXT,
  territory TEXT,
  counts NUMERIC,
  extra_columns JSONB NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE store_analytics.apple_subscription_events IS
  'Rows of the App Store subscription event report. report_date is the report''s Event Date.';

CREATE TABLE store_analytics.apple_subscription_states (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_file_id BIGINT NOT NULL REFERENCES store_analytics.import_files(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  granularity TEXT NOT NULL CHECK (granularity IN ('DAILY', 'WEEKLY', 'MONTHLY')),
  detail_level TEXT NOT NULL CHECK (detail_level IN ('standard', 'detailed', 'single')),
  processing_date DATE NOT NULL,
  app_apple_identifier TEXT NOT NULL,
  state_metric TEXT,
  state_metric_grouping TEXT,
  subscription_name TEXT,
  subscription_identifier TEXT,
  subscription_duration TEXT,
  billing_frequency TEXT,
  billing_period TEXT,
  subscription_group TEXT,
  subscription_group_identifier TEXT,
  offer_type TEXT,
  offer_name TEXT,
  offer_id TEXT,
  vanity_code TEXT,
  offer_pricing TEXT,
  offer_duration TEXT,
  family_sharing TEXT,
  cancellation_reason TEXT,
  app_download_source_type TEXT,
  app_download_source_info TEXT,
  campaign TEXT,
  page_type TEXT,
  page_title TEXT,
  pre_order TEXT,
  original_purchase_device TEXT,
  territory TEXT,
  counts NUMERIC,
  extra_columns JSONB NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE store_analytics.apple_subscription_states IS
  'Rows of the App Store subscription state report.';

CREATE TABLE store_analytics.apple_crashes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_file_id BIGINT NOT NULL REFERENCES store_analytics.import_files(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  granularity TEXT NOT NULL CHECK (granularity IN ('DAILY', 'WEEKLY', 'MONTHLY')),
  detail_level TEXT NOT NULL CHECK (detail_level IN ('standard', 'detailed', 'single')),
  processing_date DATE NOT NULL,
  app_apple_identifier TEXT NOT NULL,
  app_version TEXT,
  device TEXT,
  platform_version TEXT,
  crashes NUMERIC,
  unique_devices NUMERIC,
  extra_columns JSONB NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE store_analytics.apple_crashes IS
  'Rows of the App Crashes report.';

CREATE TABLE store_analytics.apple_opt_in (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_file_id BIGINT NOT NULL REFERENCES store_analytics.import_files(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  granularity TEXT NOT NULL CHECK (granularity IN ('DAILY', 'WEEKLY', 'MONTHLY')),
  detail_level TEXT NOT NULL CHECK (detail_level IN ('standard', 'detailed', 'single')),
  processing_date DATE NOT NULL,
  app_apple_identifier TEXT NOT NULL,
  downloading_users NUMERIC,
  users_opting_in NUMERIC,
  extra_columns JSONB NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE store_analytics.apple_opt_in IS
  'Rows of the App Opt-In report.';

CREATE TABLE store_analytics.apple_other_report_rows (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_file_id BIGINT NOT NULL REFERENCES store_analytics.import_files(id) ON DELETE CASCADE,
  report_name TEXT NOT NULL,
  report_date DATE NOT NULL,
  granularity TEXT NOT NULL CHECK (granularity IN ('DAILY', 'WEEKLY', 'MONTHLY')),
  detail_level TEXT NOT NULL CHECK (detail_level IN ('standard', 'detailed', 'single')),
  processing_date DATE NOT NULL,
  app_apple_identifier TEXT NOT NULL,
  territory TEXT,
  platform TEXT,
  device TEXT,
  build TEXT,
  release_type TEXT,
  platform_version TEXT,
  app_version TEXT,
  count NUMERIC,
  unique_devices NUMERIC,
  columns JSONB NOT NULL
);

COMMENT ON TABLE store_analytics.apple_other_report_rows IS
  'Rows of every App Store Connect Analytics report without a table of its own. columns holds every '
  'column of the row by header name; the typed columns repeat the common ones and are NULL where '
  'the report does not publish them.';

-- Google Play statistics files.

CREATE TABLE store_analytics.play_store_performance_country (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_file_id BIGINT NOT NULL REFERENCES store_analytics.import_files(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  package_name TEXT NOT NULL,
  country TEXT,
  store_listing_acquisitions NUMERIC,
  store_listing_visitors NUMERIC,
  store_listing_conversion_rate NUMERIC,
  extra_columns JSONB NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE store_analytics.play_store_performance_country IS
  'Rows of the Google Play store performance files broken down by country.';

CREATE TABLE store_analytics.play_store_performance_traffic_source (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_file_id BIGINT NOT NULL REFERENCES store_analytics.import_files(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  package_name TEXT NOT NULL,
  traffic_source TEXT,
  search_term TEXT,
  utm_source TEXT,
  utm_campaign TEXT,
  store_listing_acquisitions NUMERIC,
  store_listing_visitors NUMERIC,
  store_listing_conversion_rate NUMERIC,
  extra_columns JSONB NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE store_analytics.play_store_performance_traffic_source IS
  'Rows of the Google Play store performance files broken down by traffic source.';

CREATE TABLE store_analytics.play_installs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_file_id BIGINT NOT NULL REFERENCES store_analytics.import_files(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  package_name TEXT NOT NULL,
  breakdown TEXT NOT NULL CHECK (
    breakdown IN ('overview', 'country', 'device', 'os_version', 'app_version', 'carrier', 'language')
  ),
  breakdown_value TEXT,
  current_device_installs NUMERIC,
  installs_on_active_devices NUMERIC,
  daily_device_installs NUMERIC,
  daily_device_uninstalls NUMERIC,
  daily_device_upgrades NUMERIC,
  current_user_installs NUMERIC,
  total_user_installs NUMERIC,
  daily_user_installs NUMERIC,
  daily_user_uninstalls NUMERIC,
  extra_columns JSONB NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE store_analytics.play_installs IS
  'Rows of the Google Play installs files. breakdown names the file''s dimension and breakdown_value '
  'its value on the row, NULL for overview.';

CREATE TABLE store_analytics.play_ratings (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_file_id BIGINT NOT NULL REFERENCES store_analytics.import_files(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  package_name TEXT NOT NULL,
  breakdown TEXT NOT NULL CHECK (
    breakdown IN ('overview', 'country', 'device', 'os_version', 'app_version', 'carrier', 'language')
  ),
  breakdown_value TEXT,
  daily_average_rating NUMERIC,
  total_average_rating NUMERIC,
  extra_columns JSONB NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE store_analytics.play_ratings IS
  'Rows of the Google Play ratings files, with breakdown and breakdown_value as in play_installs.';

CREATE TABLE store_analytics.play_crashes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_file_id BIGINT NOT NULL REFERENCES store_analytics.import_files(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  package_name TEXT NOT NULL,
  breakdown TEXT NOT NULL CHECK (
    breakdown IN ('overview', 'country', 'device', 'os_version', 'app_version', 'carrier', 'language')
  ),
  breakdown_value TEXT,
  daily_crashes NUMERIC,
  daily_anrs NUMERIC,
  extra_columns JSONB NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE store_analytics.play_crashes IS
  'Rows of the Google Play crashes files, with breakdown and breakdown_value as in play_installs.';

CREATE TABLE store_analytics.play_subscriptions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_file_id BIGINT NOT NULL REFERENCES store_analytics.import_files(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  package_name TEXT NOT NULL,
  product_id TEXT,
  country TEXT,
  base_plan_id TEXT,
  offer_id TEXT,
  new_subscriptions NUMERIC,
  canceled_subscriptions NUMERIC,
  active_subscriptions NUMERIC,
  extra_columns JSONB NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE store_analytics.play_subscriptions IS
  'Rows of the Google Play financial-stats/subscriptions files.';

CREATE TABLE store_analytics.play_other_report_rows (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_file_id BIGINT NOT NULL REFERENCES store_analytics.import_files(id) ON DELETE CASCADE,
  report_name TEXT NOT NULL,
  report_date DATE NOT NULL,
  package_name TEXT NOT NULL,
  columns JSONB NOT NULL
);

COMMENT ON TABLE store_analytics.play_other_report_rows IS
  'Rows of every imported Google Play statistics file without a table of its own. report_name is the '
  'object family path and columns holds every column of the row by header name.';

-- import_file_id is indexed on every row table because the cascade from store_analytics.import_files
-- deletes by it.

CREATE INDEX idx_apple_discovery_engagement_report_date
  ON store_analytics.apple_discovery_engagement (report_date);
CREATE INDEX idx_apple_discovery_engagement_replacement
  ON store_analytics.apple_discovery_engagement (granularity, detail_level, report_date);
CREATE INDEX idx_apple_discovery_engagement_import_file
  ON store_analytics.apple_discovery_engagement (import_file_id);

CREATE INDEX idx_apple_web_preview_engagement_report_date
  ON store_analytics.apple_web_preview_engagement (report_date);
CREATE INDEX idx_apple_web_preview_engagement_replacement
  ON store_analytics.apple_web_preview_engagement (granularity, detail_level, report_date);
CREATE INDEX idx_apple_web_preview_engagement_import_file
  ON store_analytics.apple_web_preview_engagement (import_file_id);

CREATE INDEX idx_apple_downloads_report_date
  ON store_analytics.apple_downloads (report_date);
CREATE INDEX idx_apple_downloads_replacement
  ON store_analytics.apple_downloads (granularity, detail_level, report_date);
CREATE INDEX idx_apple_downloads_import_file
  ON store_analytics.apple_downloads (import_file_id);

CREATE INDEX idx_apple_installs_deletions_report_date
  ON store_analytics.apple_installs_deletions (report_date);
CREATE INDEX idx_apple_installs_deletions_replacement
  ON store_analytics.apple_installs_deletions (granularity, detail_level, report_date);
CREATE INDEX idx_apple_installs_deletions_import_file
  ON store_analytics.apple_installs_deletions (import_file_id);

CREATE INDEX idx_apple_sessions_report_date
  ON store_analytics.apple_sessions (report_date);
CREATE INDEX idx_apple_sessions_replacement
  ON store_analytics.apple_sessions (granularity, detail_level, report_date);
CREATE INDEX idx_apple_sessions_import_file
  ON store_analytics.apple_sessions (import_file_id);

CREATE INDEX idx_apple_purchases_report_date
  ON store_analytics.apple_purchases (report_date);
CREATE INDEX idx_apple_purchases_replacement
  ON store_analytics.apple_purchases (granularity, detail_level, report_date);
CREATE INDEX idx_apple_purchases_import_file
  ON store_analytics.apple_purchases (import_file_id);

CREATE INDEX idx_apple_subscription_events_report_date
  ON store_analytics.apple_subscription_events (report_date);
CREATE INDEX idx_apple_subscription_events_replacement
  ON store_analytics.apple_subscription_events (granularity, detail_level, report_date);
CREATE INDEX idx_apple_subscription_events_import_file
  ON store_analytics.apple_subscription_events (import_file_id);

CREATE INDEX idx_apple_subscription_states_report_date
  ON store_analytics.apple_subscription_states (report_date);
CREATE INDEX idx_apple_subscription_states_replacement
  ON store_analytics.apple_subscription_states (granularity, detail_level, report_date);
CREATE INDEX idx_apple_subscription_states_import_file
  ON store_analytics.apple_subscription_states (import_file_id);

CREATE INDEX idx_apple_crashes_report_date
  ON store_analytics.apple_crashes (report_date);
CREATE INDEX idx_apple_crashes_replacement
  ON store_analytics.apple_crashes (granularity, detail_level, report_date);
CREATE INDEX idx_apple_crashes_import_file
  ON store_analytics.apple_crashes (import_file_id);

CREATE INDEX idx_apple_opt_in_report_date
  ON store_analytics.apple_opt_in (report_date);
CREATE INDEX idx_apple_opt_in_replacement
  ON store_analytics.apple_opt_in (granularity, detail_level, report_date);
CREATE INDEX idx_apple_opt_in_import_file
  ON store_analytics.apple_opt_in (import_file_id);

CREATE INDEX idx_apple_other_report_rows_report_date
  ON store_analytics.apple_other_report_rows (report_date);
CREATE INDEX idx_apple_other_report_rows_replacement
  ON store_analytics.apple_other_report_rows (report_name, granularity, detail_level, report_date);
CREATE INDEX idx_apple_other_report_rows_import_file
  ON store_analytics.apple_other_report_rows (import_file_id);

CREATE INDEX idx_play_store_performance_country_report_date
  ON store_analytics.play_store_performance_country (report_date);
CREATE INDEX idx_play_store_performance_country_import_file
  ON store_analytics.play_store_performance_country (import_file_id);

CREATE INDEX idx_play_store_performance_traffic_source_report_date
  ON store_analytics.play_store_performance_traffic_source (report_date);
CREATE INDEX idx_play_store_performance_traffic_source_import_file
  ON store_analytics.play_store_performance_traffic_source (import_file_id);

CREATE INDEX idx_play_installs_report_date
  ON store_analytics.play_installs (report_date);
CREATE INDEX idx_play_installs_import_file
  ON store_analytics.play_installs (import_file_id);

CREATE INDEX idx_play_ratings_report_date
  ON store_analytics.play_ratings (report_date);
CREATE INDEX idx_play_ratings_import_file
  ON store_analytics.play_ratings (import_file_id);

CREATE INDEX idx_play_crashes_report_date
  ON store_analytics.play_crashes (report_date);
CREATE INDEX idx_play_crashes_import_file
  ON store_analytics.play_crashes (import_file_id);

CREATE INDEX idx_play_subscriptions_report_date
  ON store_analytics.play_subscriptions (report_date);
CREATE INDEX idx_play_subscriptions_import_file
  ON store_analytics.play_subscriptions (import_file_id);

CREATE INDEX idx_play_other_report_rows_report_date
  ON store_analytics.play_other_report_rows (report_date);
CREATE INDEX idx_play_other_report_rows_import_file
  ON store_analytics.play_other_report_rows (import_file_id);

-- The schema is new, so ALL TABLES names exactly the tables above. backend_app can replace rows by
-- delete and insert but cannot update them. An INSERT through an identity column needs no sequence
-- privilege.
GRANT USAGE ON SCHEMA store_analytics TO backend_app;
GRANT SELECT, INSERT, DELETE ON ALL TABLES IN SCHEMA store_analytics TO backend_app;

GRANT USAGE ON SCHEMA store_analytics TO reporting_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA store_analytics TO reporting_readonly;
