-- Auto-provision missing workspace structures for existing users and ensure
-- every workspace has a scheduler-settings seed row in sync.changes.

CREATE FUNCTION pg_temp.to_canonical_jsonb_timestamp(value TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT CASE
    WHEN value IS NULL THEN 'null'::jsonb
    ELSE to_jsonb(
      to_char(
        date_trunc('milliseconds', value AT TIME ZONE 'UTC'),
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    )
  END
$$;

-- Restore missing owner memberships when user_settings already points at a
-- workspace but the mapping row is missing.
INSERT INTO org.workspace_memberships (workspace_id, user_id, role)
SELECT user_settings.workspace_id, user_settings.user_id, 'owner'
FROM org.user_settings AS user_settings
WHERE user_settings.workspace_id IS NOT NULL
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- Create default workspace/device/membership triples for users that still have
-- no workspace memberships at all.
WITH users_without_memberships AS (
  SELECT
    user_settings.user_id,
    md5(user_settings.user_id || ':auto-provision-workspace') AS workspace_digest,
    md5(user_settings.user_id || ':auto-provision-device') AS device_digest,
    now() AS provisioned_at
  FROM org.user_settings AS user_settings
  WHERE NOT EXISTS (
    SELECT 1
    FROM org.workspace_memberships AS memberships
    WHERE memberships.user_id = user_settings.user_id
  )
),
prepared_users AS (
  SELECT
    user_id,
    (
      substr(workspace_digest, 1, 8) || '-' ||
      substr(workspace_digest, 9, 4) || '-' ||
      substr(workspace_digest, 13, 4) || '-' ||
      substr(workspace_digest, 17, 4) || '-' ||
      substr(workspace_digest, 21, 12)
    )::uuid AS workspace_id,
    (
      substr(device_digest, 1, 8) || '-' ||
      substr(device_digest, 9, 4) || '-' ||
      substr(device_digest, 13, 4) || '-' ||
      substr(device_digest, 17, 4) || '-' ||
      substr(device_digest, 21, 12)
    )::uuid AS device_id,
    provisioned_at
  FROM users_without_memberships
)
INSERT INTO org.workspaces (
  workspace_id,
  name,
  fsrs_client_updated_at,
  fsrs_last_modified_by_device_id,
  fsrs_last_operation_id
)
SELECT
  prepared_users.workspace_id,
  'Personal',
  prepared_users.provisioned_at,
  prepared_users.device_id,
  'migration-0018-bootstrap-workspace-' || prepared_users.workspace_id::text
FROM prepared_users
ON CONFLICT (workspace_id) DO NOTHING;

WITH users_without_memberships AS (
  SELECT
    user_settings.user_id,
    md5(user_settings.user_id || ':auto-provision-workspace') AS workspace_digest,
    md5(user_settings.user_id || ':auto-provision-device') AS device_digest,
    now() AS provisioned_at
  FROM org.user_settings AS user_settings
  WHERE NOT EXISTS (
    SELECT 1
    FROM org.workspace_memberships AS memberships
    WHERE memberships.user_id = user_settings.user_id
  )
),
prepared_users AS (
  SELECT
    user_id,
    (
      substr(workspace_digest, 1, 8) || '-' ||
      substr(workspace_digest, 9, 4) || '-' ||
      substr(workspace_digest, 13, 4) || '-' ||
      substr(workspace_digest, 17, 4) || '-' ||
      substr(workspace_digest, 21, 12)
    )::uuid AS workspace_id,
    (
      substr(device_digest, 1, 8) || '-' ||
      substr(device_digest, 9, 4) || '-' ||
      substr(device_digest, 13, 4) || '-' ||
      substr(device_digest, 17, 4) || '-' ||
      substr(device_digest, 21, 12)
    )::uuid AS device_id,
    provisioned_at
  FROM users_without_memberships
)
INSERT INTO sync.devices (
  device_id,
  workspace_id,
  user_id,
  platform,
  app_version,
  created_at,
  last_seen_at
)
SELECT
  prepared_users.device_id,
  prepared_users.workspace_id,
  prepared_users.user_id,
  'ios',
  'migration-0018-auto-provision',
  prepared_users.provisioned_at,
  prepared_users.provisioned_at
FROM prepared_users
ON CONFLICT (device_id) DO NOTHING;

WITH users_without_memberships AS (
  SELECT
    user_settings.user_id,
    md5(user_settings.user_id || ':auto-provision-workspace') AS workspace_digest
  FROM org.user_settings AS user_settings
  WHERE NOT EXISTS (
    SELECT 1
    FROM org.workspace_memberships AS memberships
    WHERE memberships.user_id = user_settings.user_id
  )
),
prepared_users AS (
  SELECT
    user_id,
    (
      substr(workspace_digest, 1, 8) || '-' ||
      substr(workspace_digest, 9, 4) || '-' ||
      substr(workspace_digest, 13, 4) || '-' ||
      substr(workspace_digest, 17, 4) || '-' ||
      substr(workspace_digest, 21, 12)
    )::uuid AS workspace_id
  FROM users_without_memberships
)
INSERT INTO org.workspace_memberships (workspace_id, user_id, role)
SELECT
  prepared_users.workspace_id,
  prepared_users.user_id,
  'owner'
FROM prepared_users
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- Ensure selected workspace points at an accessible membership. For NULL or
-- inaccessible values choose the earliest membership by workspace created_at.
WITH earliest_accessible_workspace AS (
  SELECT
    user_settings.user_id,
    (
      SELECT memberships.workspace_id
      FROM org.workspace_memberships AS memberships
      INNER JOIN org.workspaces AS workspaces
        ON workspaces.workspace_id = memberships.workspace_id
      WHERE memberships.user_id = user_settings.user_id
      ORDER BY workspaces.created_at ASC, workspaces.workspace_id ASC
      LIMIT 1
    ) AS workspace_id
  FROM org.user_settings AS user_settings
)
UPDATE org.user_settings AS user_settings
SET workspace_id = earliest_accessible_workspace.workspace_id
FROM earliest_accessible_workspace
WHERE user_settings.user_id = earliest_accessible_workspace.user_id
  AND earliest_accessible_workspace.workspace_id IS NOT NULL
  AND (
    user_settings.workspace_id IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM org.workspace_memberships AS memberships
      WHERE memberships.user_id = user_settings.user_id
        AND memberships.workspace_id = user_settings.workspace_id
    )
  );

-- Ensure every workspace has at least one scheduler-settings snapshot in the
-- global sync feed.
INSERT INTO sync.changes (
  workspace_id,
  entity_type,
  entity_id,
  action,
  device_id,
  operation_id,
  payload,
  recorded_at
)
SELECT
  workspaces.workspace_id,
  'workspace_scheduler_settings',
  workspaces.workspace_id::text,
  'upsert',
  workspaces.fsrs_last_modified_by_device_id,
  workspaces.fsrs_last_operation_id,
  jsonb_build_object(
    'algorithm', workspaces.fsrs_algorithm,
    'desiredRetention', workspaces.fsrs_desired_retention,
    'learningStepsMinutes', workspaces.fsrs_learning_steps_minutes,
    'relearningStepsMinutes', workspaces.fsrs_relearning_steps_minutes,
    'maximumIntervalDays', workspaces.fsrs_maximum_interval_days,
    'enableFuzz', workspaces.fsrs_enable_fuzz,
    'clientUpdatedAt', pg_temp.to_canonical_jsonb_timestamp(workspaces.fsrs_client_updated_at),
    'lastModifiedByDeviceId', workspaces.fsrs_last_modified_by_device_id::text,
    'lastOperationId', workspaces.fsrs_last_operation_id,
    'updatedAt', pg_temp.to_canonical_jsonb_timestamp(workspaces.fsrs_updated_at)
  ),
  workspaces.fsrs_updated_at
FROM org.workspaces AS workspaces
WHERE NOT EXISTS (
  SELECT 1
  FROM sync.changes AS changes
  WHERE changes.workspace_id = workspaces.workspace_id
    AND changes.entity_type = 'workspace_scheduler_settings'
    AND changes.entity_id = workspaces.workspace_id::text
);
