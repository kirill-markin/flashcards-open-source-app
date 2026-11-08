-- Migration status: Current / constraint and comment change.
-- Introduces: no column. Every CHECK that 0175 and 0176 put on an os_name, device_type,
--   client_os_name or client_device_type column is re-added under its own name with watchos added to
--   the operating system families and watch to the device classes, and the four column comments
--   that list the values are restated.
-- Current guidance: os_name is one of ios, ipados, macos, watchos, android, and device_type one of
--   phone, tablet, desktop, tv, watch. The Apple Watch app is a companion of the Apple client and
--   reports platform ios, as the iPhone, iPad and Mac do; watchos and watch are what tell it apart.
--   apps/backend/src/productAnalytics/catalog.ts holds both lists. Nothing is backfilled.
-- Schemas touched/read explicitly: analytics, support, ai, sync.
-- See also: db/migrations/0175_analytics_os_name_device_type.sql,
--   db/migrations/0176_client_os_name_device_type.sql.

-- The lock wait limit and the table order, sync.installations last, follow 0176 for the reasons it
-- gives.
SET LOCAL lock_timeout = '30s';

-- Re-added NOT VALID and never validated, as 0175 and 0176 added them: validating would hold the
-- ACCESS EXCLUSIVE lock across a whole-table scan that could only confirm what the narrower rules
-- being replaced already enforced on every row written since.
ALTER TABLE analytics.product_events
  DROP CONSTRAINT product_events_os_name_valid,
  DROP CONSTRAINT product_events_device_type_valid,
  ADD CONSTRAINT product_events_os_name_valid CHECK (
    os_name IS NULL
    OR os_name IN ('ios', 'ipados', 'macos', 'watchos', 'android')
  ) NOT VALID,
  ADD CONSTRAINT product_events_device_type_valid CHECK (
    device_type IS NULL
    OR device_type IN ('phone', 'tablet', 'desktop', 'tv', 'watch')
  ) NOT VALID;

COMMENT ON COLUMN analytics.product_events.os_name IS
  'Operating system family the client reported: ios, ipados, macos, watchos or android. Unlike '
  'platform, which names the client build, it separates an iPhone, an iPad, a Mac and an Apple Watch '
  'running the same Apple client. NULL means no value is known for the row; the web client reports '
  'none. Kept on account anonymization, as platform is.';

COMMENT ON COLUMN analytics.product_events.device_type IS
  'Device class the client reported: phone, tablet, desktop, tv or watch. NULL means no value is '
  'known for the row; the web client reports none. Kept on account anonymization, as platform is.';

-- The installation and support tables are small, so their constraints are re-added validated, as
-- they were added. ai.chat_runs keeps NOT VALID for the reason above.
ALTER TABLE analytics.installation_profiles
  DROP CONSTRAINT installation_profiles_os_name_valid,
  DROP CONSTRAINT installation_profiles_device_type_valid,
  ADD CONSTRAINT installation_profiles_os_name_valid CHECK (
    os_name IS NULL
    OR os_name IN ('ios', 'ipados', 'macos', 'watchos', 'android')
  ),
  ADD CONSTRAINT installation_profiles_device_type_valid CHECK (
    device_type IS NULL
    OR device_type IN ('phone', 'tablet', 'desktop', 'tv', 'watch')
  );

ALTER TABLE support.feedback_prompt_events
  DROP CONSTRAINT feedback_prompt_events_os_name_valid,
  DROP CONSTRAINT feedback_prompt_events_device_type_valid,
  ADD CONSTRAINT feedback_prompt_events_os_name_valid CHECK (
    os_name IS NULL
    OR os_name IN ('ios', 'ipados', 'macos', 'watchos', 'android')
  ),
  ADD CONSTRAINT feedback_prompt_events_device_type_valid CHECK (
    device_type IS NULL
    OR device_type IN ('phone', 'tablet', 'desktop', 'tv', 'watch')
  );

ALTER TABLE support.feedback_submissions
  DROP CONSTRAINT feedback_submissions_os_name_valid,
  DROP CONSTRAINT feedback_submissions_device_type_valid,
  ADD CONSTRAINT feedback_submissions_os_name_valid CHECK (
    os_name IS NULL
    OR os_name IN ('ios', 'ipados', 'macos', 'watchos', 'android')
  ),
  ADD CONSTRAINT feedback_submissions_device_type_valid CHECK (
    device_type IS NULL
    OR device_type IN ('phone', 'tablet', 'desktop', 'tv', 'watch')
  );

ALTER TABLE ai.chat_runs
  DROP CONSTRAINT chat_runs_client_os_name_valid,
  DROP CONSTRAINT chat_runs_client_device_type_valid,
  ADD CONSTRAINT chat_runs_client_os_name_valid CHECK (
    client_os_name IS NULL
    OR client_os_name IN ('ios', 'ipados', 'macos', 'watchos', 'android')
  ) NOT VALID,
  ADD CONSTRAINT chat_runs_client_device_type_valid CHECK (
    client_device_type IS NULL
    OR client_device_type IN ('phone', 'tablet', 'desktop', 'tv', 'watch')
  ) NOT VALID;

ALTER TABLE sync.installations
  DROP CONSTRAINT installations_os_name_valid,
  DROP CONSTRAINT installations_device_type_valid,
  ADD CONSTRAINT installations_os_name_valid CHECK (
    os_name IS NULL
    OR os_name IN ('ios', 'ipados', 'macos', 'watchos', 'android')
  ),
  ADD CONSTRAINT installations_device_type_valid CHECK (
    device_type IS NULL
    OR device_type IN ('phone', 'tablet', 'desktop', 'tv', 'watch')
  );

COMMENT ON COLUMN sync.installations.os_name IS
  'Latest operating system family the installation reported on a sync request: ios, ipados, macos, '
  'watchos or android. A request that reports none keeps the stored value. NULL means it never '
  'reported one; the web client reports none.';

COMMENT ON COLUMN sync.installations.device_type IS
  'Latest device class the installation reported on a sync request: phone, tablet, desktop, tv or '
  'watch. A request that reports none keeps the stored value. NULL means it never reported one; the '
  'web client reports none.';
