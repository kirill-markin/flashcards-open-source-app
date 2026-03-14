-- Backfill missing card createdAt values in sync.changes payloads and allow
-- backend_app to move a device row between workspaces the same user can access.

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

UPDATE sync.changes AS changes
SET payload = jsonb_set(
  changes.payload,
  '{createdAt}',
  pg_temp.to_canonical_jsonb_timestamp(cards.created_at),
  true
)
FROM content.cards AS cards
WHERE changes.workspace_id = cards.workspace_id
  AND changes.entity_type = 'card'
  AND changes.entity_id = cards.card_id::text
  AND (
    NOT (changes.payload ? 'createdAt')
    OR changes.payload->'createdAt' IS NULL
    OR changes.payload->'createdAt' = 'null'::jsonb
  );

DROP POLICY IF EXISTS devices_scoped_select_runtime ON sync.devices;
DROP POLICY IF EXISTS devices_scoped_insert_runtime ON sync.devices;
DROP POLICY IF EXISTS devices_scoped_update_runtime ON sync.devices;
DROP POLICY IF EXISTS devices_scoped_delete_runtime ON sync.devices;

CREATE POLICY devices_scoped_select_runtime
  ON sync.devices
  FOR SELECT
  TO backend_app
  USING (
    security.user_has_workspace_access(workspace_id)
    AND user_id = security.current_user_id()
  );

CREATE POLICY devices_scoped_insert_runtime
  ON sync.devices
  FOR INSERT
  TO backend_app, auth_app
  WITH CHECK (
    security.current_workspace_access_allowed(workspace_id)
    AND user_id = security.current_user_id()
  );

CREATE POLICY devices_scoped_update_runtime
  ON sync.devices
  FOR UPDATE
  TO backend_app
  USING (
    security.user_has_workspace_access(workspace_id)
    AND user_id = security.current_user_id()
  )
  WITH CHECK (
    security.current_workspace_access_allowed(workspace_id)
    AND user_id = security.current_user_id()
  );

CREATE POLICY devices_scoped_delete_runtime
  ON sync.devices
  FOR DELETE
  TO backend_app
  USING (
    security.user_has_workspace_access(workspace_id)
    AND user_id = security.current_user_id()
  );
