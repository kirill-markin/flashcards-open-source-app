-- Current additive migration for independently owned catalog collection covers.
-- Schemas touched/read explicitly: catalog, content, org, sync, pg_catalog.

ALTER TABLE catalog.collections
  ADD COLUMN cover_media_blob_id UUID
    REFERENCES content.media_blobs(media_blob_id) ON DELETE RESTRICT;

CREATE INDEX idx_collections_cover_media_blob
  ON catalog.collections(cover_media_blob_id)
  WHERE cover_media_blob_id IS NOT NULL;

COMMENT ON COLUMN catalog.collections.cover_media_blob_id IS
  'Current independently uploaded collection cover; legacy cover_package_id remains available for backward compatibility.';

CREATE FUNCTION content.fence_catalog_collection_cover_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.cover_media_blob_id IS NOT NULL THEN
      PERFORM content.fence_media_blob_reference(NEW.cover_media_blob_id);
    END IF;
  ELSIF NEW.cover_media_blob_id IS NOT NULL
    AND NEW.cover_media_blob_id IS DISTINCT FROM OLD.cover_media_blob_id
  THEN
    PERFORM content.fence_media_blob_reference(NEW.cover_media_blob_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER collections_cover_media_blob_reference_fence
BEFORE INSERT OR UPDATE OF cover_media_blob_id ON catalog.collections
FOR EACH ROW
EXECUTE FUNCTION content.fence_catalog_collection_cover_reference();

CREATE FUNCTION content.lock_media_blob_lifecycles_for_references(
  p_media_blob_ids UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  expected_count BIGINT;
  ordered_media_blob_ids UUID[];
  ordered_sha256s TEXT[];
  requested_index INTEGER;
  locked_sha256 TEXT;
BEGIN
  IF p_media_blob_ids IS NULL
    OR pg_catalog.array_position(p_media_blob_ids, NULL) IS NOT NULL
  THEN
    RAISE EXCEPTION 'p_media_blob_ids must be a non-null array of media blob ids'
      USING ERRCODE = '22023';
  END IF;

  SELECT pg_catalog.count(DISTINCT requested.media_blob_id)
  INTO expected_count
  FROM pg_catalog.unnest(p_media_blob_ids) AS requested(media_blob_id);
  IF expected_count = 0 THEN
    RETURN;
  END IF;

  SELECT
    pg_catalog.array_agg(blobs.media_blob_id ORDER BY blobs.sha256),
    pg_catalog.array_agg(blobs.sha256 ORDER BY blobs.sha256)
  INTO ordered_media_blob_ids, ordered_sha256s
  FROM content.media_blobs AS blobs
  WHERE blobs.media_blob_id = ANY(p_media_blob_ids);
  IF COALESCE(pg_catalog.cardinality(ordered_media_blob_ids), 0) <> expected_count
  THEN
    RAISE EXCEPTION 'Media blob lifecycle lock request targets a missing media blob'
      USING ERRCODE = '23503';
  END IF;

  FOREACH locked_sha256 IN ARRAY ordered_sha256s
  LOOP
    PERFORM 1
    FROM content.media_blob_lifecycles AS lifecycles
    WHERE lifecycles.sha256 = locked_sha256
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Media blob lifecycle lock request targets missing lifecycle metadata'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  FOR requested_index IN 1..pg_catalog.cardinality(ordered_media_blob_ids)
  LOOP
    PERFORM 1
    FROM content.media_blobs AS blobs
    WHERE blobs.media_blob_id = ordered_media_blob_ids[requested_index]
      AND blobs.sha256 = ordered_sha256s[requested_index]
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Media blob lifecycle lock request targets a missing media blob'
        USING ERRCODE = '23503';
    END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION content.lock_media_blob_lifecycles_for_reference_swap(
  p_old_media_blob_id UUID,
  p_new_media_blob_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  requested_media_blob_ids UUID[];
BEGIN
  IF p_new_media_blob_id IS NULL THEN
    RAISE EXCEPTION 'p_new_media_blob_id is required' USING ERRCODE = '22023';
  END IF;
  requested_media_blob_ids := CASE
    WHEN p_old_media_blob_id IS NULL
      OR p_old_media_blob_id = p_new_media_blob_id
    THEN ARRAY[p_new_media_blob_id]
    ELSE ARRAY[p_old_media_blob_id, p_new_media_blob_id]
  END;
  BEGIN
    PERFORM content.lock_media_blob_lifecycles_for_references(
      requested_media_blob_ids
    );
  EXCEPTION
    WHEN foreign_key_violation THEN
      RAISE EXCEPTION 'Media blob reference swap targets a missing media blob'
        USING ERRCODE = '23503';
    WHEN check_violation THEN
      RAISE EXCEPTION 'Media blob reference swap targets missing lifecycle metadata'
        USING ERRCODE = '23514';
  END;
END;
$$;

CREATE FUNCTION content.lock_catalog_package_version_media_blob_lifecycles(
  p_package_id UUID,
  p_version_media_blob_ids UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  requested_media_blob_ids UUID[];
BEGIN
  IF p_package_id IS NULL THEN
    RAISE EXCEPTION 'p_package_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_version_media_blob_ids IS NULL
    OR pg_catalog.array_position(p_version_media_blob_ids, NULL) IS NOT NULL
  THEN
    RAISE EXCEPTION 'p_version_media_blob_ids must be a non-null array of media blob ids'
      USING ERRCODE = '22023';
  END IF;

  SELECT pg_catalog.array_agg(requested.media_blob_id)
  INTO requested_media_blob_ids
  FROM (
    SELECT assets.media_blob_id
    FROM catalog.package_media_assets AS assets
    WHERE assets.package_id = p_package_id
      AND assets.package_version_id IS NULL
    UNION
    SELECT version_media.media_blob_id
    FROM pg_catalog.unnest(p_version_media_blob_ids)
      AS version_media(media_blob_id)
  ) AS requested;

  PERFORM content.lock_media_blob_lifecycles_for_references(
    COALESCE(requested_media_blob_ids, ARRAY[]::UUID[])
  );
END;
$$;

CREATE OR REPLACE FUNCTION content.media_blob_has_active_reference_internal(
  p_sha256 TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM content.media_assets AS assets
    INNER JOIN content.media_blobs AS blobs
      ON blobs.media_blob_id = assets.media_blob_id
    WHERE blobs.sha256 = p_sha256
      AND assets.deleted_at IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM catalog.package_media_assets AS assets
    INNER JOIN content.media_blobs AS blobs
      ON blobs.media_blob_id = assets.media_blob_id
    WHERE blobs.sha256 = p_sha256
  ) OR EXISTS (
    SELECT 1
    FROM catalog.collections AS collections
    INNER JOIN content.media_blobs AS blobs
      ON blobs.media_blob_id = collections.cover_media_blob_id
    WHERE blobs.sha256 = p_sha256
  );
$$;

CREATE OR REPLACE FUNCTION content.terminalize_media_blob_writers_before_workspace_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  owner_user_id TEXT;
  affected_sha256s TEXT[];
  affected_sha256 TEXT;
  terminalized_at TIMESTAMPTZ;
BEGIN
  FOR owner_user_id IN
    SELECT owners.user_id
    FROM (
      SELECT memberships.user_id
      FROM org.workspace_memberships AS memberships
      WHERE memberships.workspace_id = OLD.workspace_id
      UNION
      SELECT snapshots.user_id
      FROM content.media_blob_writer_owner_snapshots AS snapshots
      WHERE snapshots.workspace_id = OLD.workspace_id
      UNION
      SELECT attempts.user_id
      FROM content.media_blob_writer_attempts AS attempts
      WHERE attempts.workspace_id = OLD.workspace_id
    ) AS owners
    ORDER BY owners.user_id
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        owner_user_id || ':' || OLD.workspace_id::TEXT,
        0::BIGINT
      )
    );
  END LOOP;

  PERFORM 1
  FROM content.media_upload_sessions AS sessions
  WHERE sessions.workspace_id = OLD.workspace_id
  ORDER BY sessions.media_upload_session_id
  FOR UPDATE;

  PERFORM 1
  FROM sync.workspace_sync_metadata AS metadata
  WHERE metadata.workspace_id = OLD.workspace_id
  FOR UPDATE;

  SELECT pg_catalog.array_agg(DISTINCT writers.sha256 ORDER BY writers.sha256)
  INTO affected_sha256s
  FROM (
    SELECT reservations.sha256
    FROM content.media_blob_writer_reservations AS reservations
    WHERE reservations.workspace_id = OLD.workspace_id
      AND reservations.writer_kind IN (
        'direct_ingestion',
        'multipart_completion'
      )
    UNION
    SELECT attempts.sha256
    FROM content.media_blob_writer_attempts AS attempts
    WHERE attempts.workspace_id = OLD.workspace_id
  ) AS writers;

  IF affected_sha256s IS NULL THEN
    RETURN OLD;
  END IF;

  FOREACH affected_sha256 IN ARRAY affected_sha256s
  LOOP
    PERFORM 1
    FROM content.media_blob_lifecycles AS lifecycles
    WHERE lifecycles.sha256 = affected_sha256
    FOR UPDATE;
  END LOOP;

  PERFORM 1
  FROM content.media_blob_writer_reservations AS reservations
  WHERE reservations.workspace_id = OLD.workspace_id
    AND reservations.writer_kind IN (
      'direct_ingestion',
      'multipart_completion'
    )
  ORDER BY
    reservations.sha256,
    reservations.writer_kind,
    reservations.media_asset_id,
    reservations.operation_id
  FOR UPDATE;

  PERFORM 1
  FROM content.media_blob_writer_owner_snapshots AS snapshots
  WHERE snapshots.workspace_id = OLD.workspace_id
  ORDER BY snapshots.reservation_token
  FOR UPDATE;

  PERFORM 1
  FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.workspace_id = OLD.workspace_id
  ORDER BY
    attempts.writer_kind,
    attempts.media_asset_id,
    attempts.operation_id,
    attempts.attempt_token
  FOR UPDATE;

  PERFORM 1
  FROM content.media_assets AS assets
  WHERE assets.workspace_id = OLD.workspace_id
  ORDER BY assets.media_asset_id
  FOR UPDATE;

  PERFORM 1
  FROM content.media_blobs AS blobs
  WHERE blobs.sha256 = ANY(affected_sha256s)
  ORDER BY blobs.sha256
  FOR SHARE;

  DELETE FROM content.media_upload_sessions AS sessions
  WHERE sessions.workspace_id = OLD.workspace_id;

  DELETE FROM content.media_assets AS assets
  WHERE assets.workspace_id = OLD.workspace_id;

  UPDATE content.media_blob_writer_reservations AS reservations
  SET state = 'unreferenced'
  WHERE reservations.workspace_id = OLD.workspace_id
    AND reservations.writer_kind IN (
      'direct_ingestion',
      'multipart_completion'
    )
    AND reservations.state <> 'unreferenced';

  terminalized_at := pg_catalog.clock_timestamp();

  UPDATE content.media_blob_writer_attempts AS attempts
  SET
    state = 'cancelled',
    outcome = 'aborted',
    terminal_at = terminalized_at
  WHERE attempts.workspace_id = OLD.workspace_id
    AND attempts.state = 'leased';

  UPDATE content.media_blob_lifecycles AS lifecycles
  SET
    cleanup_eligible_at = GREATEST(
      COALESCE(
        lifecycles.cleanup_eligible_at,
        '-infinity'::TIMESTAMPTZ
      ),
      terminalized_at + interval '1 hour'
    ),
    cleanup_lease_token = CASE
      WHEN lifecycles.cleanup_lease_expires_at =
        'infinity'::TIMESTAMPTZ
      THEN lifecycles.cleanup_lease_token
      ELSE NULL
    END,
    cleanup_lease_expires_at = CASE
      WHEN lifecycles.cleanup_lease_expires_at =
        'infinity'::TIMESTAMPTZ
      THEN lifecycles.cleanup_lease_expires_at
      ELSE NULL
    END,
    updated_at = terminalized_at
  WHERE lifecycles.sha256 = ANY(affected_sha256s)
    AND NOT EXISTS (
      SELECT 1
      FROM content.media_assets AS assets
      INNER JOIN content.media_blobs AS blobs
        ON blobs.media_blob_id = assets.media_blob_id
      WHERE blobs.sha256 = lifecycles.sha256
        AND assets.deleted_at IS NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM catalog.package_media_assets AS assets
      INNER JOIN content.media_blobs AS blobs
        ON blobs.media_blob_id = assets.media_blob_id
      WHERE blobs.sha256 = lifecycles.sha256
    )
    AND NOT EXISTS (
      SELECT 1
      FROM catalog.collections AS collections
      INNER JOIN content.media_blobs AS blobs
        ON blobs.media_blob_id = collections.cover_media_blob_id
      WHERE blobs.sha256 = lifecycles.sha256
    )
    AND NOT EXISTS (
      SELECT 1
      FROM content.media_blob_writer_reservations AS reservations
      WHERE reservations.sha256 = lifecycles.sha256
        AND reservations.state NOT IN ('finalized', 'unreferenced')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM content.media_blob_writer_attempts AS attempts
      WHERE attempts.sha256 = lifecycles.sha256
        AND attempts.state = 'leased'
    );

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION content.fence_catalog_collection_cover_reference()
FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION
  content.lock_media_blob_lifecycles_for_references(UUID[])
FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION
  content.lock_media_blob_lifecycles_for_reference_swap(UUID, UUID)
FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION
  content.lock_catalog_package_version_media_blob_lifecycles(UUID, UUID[])
FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.media_blob_has_active_reference_internal(TEXT)
FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION
  content.terminalize_media_blob_writers_before_workspace_delete()
FROM PUBLIC, backend_app, auth_app, reporting_readonly;
GRANT EXECUTE ON FUNCTION
  content.lock_media_blob_lifecycles_for_reference_swap(UUID, UUID)
TO backend_app;
GRANT EXECUTE ON FUNCTION
  content.lock_catalog_package_version_media_blob_lifecycles(UUID, UUID[])
TO backend_app;
