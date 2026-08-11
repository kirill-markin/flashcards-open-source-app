-- Current additive migration for workspace-independent catalog image ingestion.
-- Schemas touched/read explicitly: content, catalog, pg_catalog.

ALTER TABLE content.media_blobs
  DROP CONSTRAINT IF EXISTS media_blobs_normalization_version_supported,
  ADD CONSTRAINT media_blobs_normalization_version_supported CHECK (
    normalization_version IN (
      'passthrough-v1', 'image-jpeg-card-v1',
      'image-jpeg-catalog-cover-v1'
    )
  );
ALTER TABLE content.media_blob_lifecycles
  DROP CONSTRAINT IF EXISTS media_blob_lifecycles_normalization_version_supported,
  ADD CONSTRAINT media_blob_lifecycles_normalization_version_supported CHECK (
    normalization_version IN (
      'passthrough-v1', 'image-jpeg-card-v1',
      'image-jpeg-catalog-cover-v1'
    )
  );

ALTER TABLE content.media_blob_writer_attempts
  DROP CONSTRAINT IF EXISTS media_blob_writer_attempts_normalization_supported,
  ADD CONSTRAINT media_blob_writer_attempts_normalization_supported CHECK (
    requested_normalization_version IN (
      'passthrough-v1', 'image-jpeg-card-v1'
    )
    AND normalization_version IN (
      'passthrough-v1', 'image-jpeg-card-v1',
      'image-jpeg-catalog-cover-v1'
    )
  );

CREATE FUNCTION
content.direct_media_blob_writer_attempt_requested_payload_valid_internal(
  p_payload content.direct_media_blob_writer_attempt_payload
)
RETURNS BOOLEAN
LANGUAGE SQL IMMUTABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
  SELECT p_payload.user_id IS NOT NULL
    AND p_payload.user_id = pg_catalog.btrim(p_payload.user_id)
    AND p_payload.user_id <> ''
    AND p_payload.workspace_id IS NOT NULL
    AND p_payload.media_asset_id IS NOT NULL
    AND p_payload.operation_id IS NOT NULL
    AND p_payload.operation_id = pg_catalog.btrim(p_payload.operation_id)
    AND pg_catalog.char_length(p_payload.operation_id) BETWEEN 1 AND 1024
    AND p_payload.replica_id IS NOT NULL
    AND p_payload.sha256 ~ '^[0-9a-f]{64}$'
    AND p_payload.storage_key =
      'media/blobs/sha256/'
      || pg_catalog.substring(p_payload.sha256, 1, 2)
      || '/' || pg_catalog.substring(p_payload.sha256, 3, 2)
      || '/' || p_payload.sha256
    AND p_payload.mime_type = pg_catalog.lower(pg_catalog.btrim(p_payload.mime_type))
    AND p_payload.mime_type ~
      '^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$'
    AND p_payload.size_bytes >= 0
    AND p_payload.normalization_version IN (
      'passthrough-v1', 'image-jpeg-card-v1'
    )
    AND p_payload.asset_created_at IS NOT NULL
    AND p_payload.client_updated_at IS NOT NULL;
$$;

CREATE FUNCTION
content.multipart_media_blob_writer_attempt_requested_payload_valid_internal(
  p_payload content.multipart_media_blob_writer_attempt_payload
)
RETURNS BOOLEAN
LANGUAGE SQL IMMUTABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
  SELECT p_payload.user_id IS NOT NULL
    AND p_payload.user_id = pg_catalog.btrim(p_payload.user_id)
    AND p_payload.user_id <> ''
    AND p_payload.workspace_id IS NOT NULL
    AND p_payload.media_upload_session_id IS NOT NULL
    AND p_payload.media_asset_id IS NOT NULL
    AND p_payload.replica_id IS NOT NULL
    AND p_payload.last_operation_id IS NOT NULL
    AND p_payload.last_operation_id = pg_catalog.btrim(p_payload.last_operation_id)
    AND pg_catalog.char_length(p_payload.last_operation_id) BETWEEN 1 AND 1024
    AND p_payload.sha256 ~ '^[0-9a-f]{64}$'
    AND p_payload.staging_storage_key =
      'media/uploads/workspaces/'
      || pg_catalog.lower(p_payload.workspace_id::TEXT)
      || '/assets/' || pg_catalog.lower(p_payload.media_asset_id::TEXT)
      || '/sessions/' || pg_catalog.lower(p_payload.media_upload_session_id::TEXT)
    AND p_payload.blob_storage_key =
      'media/blobs/sha256/'
      || pg_catalog.substring(p_payload.sha256, 1, 2)
      || '/' || pg_catalog.substring(p_payload.sha256, 3, 2)
      || '/' || p_payload.sha256
    AND p_payload.s3_upload_id IS NOT NULL
    AND p_payload.s3_upload_id = pg_catalog.btrim(p_payload.s3_upload_id)
    AND p_payload.s3_upload_id <> ''
    AND p_payload.mime_type = pg_catalog.lower(pg_catalog.btrim(p_payload.mime_type))
    AND p_payload.mime_type ~
      '^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$'
    AND p_payload.size_bytes > 0
    AND p_payload.part_size_bytes > 0
    AND p_payload.part_count BETWEEN 1 AND 10000
    AND p_payload.asset_created_at IS NOT NULL
    AND p_payload.client_updated_at IS NOT NULL
    AND p_payload.session_expires_at IS NOT NULL
    AND p_payload.normalization_version IN (
      'passthrough-v1', 'image-jpeg-card-v1'
    )
    AND p_payload.completed_parts_fingerprint ~ '^[0-9a-f]{64}$';
$$;

CREATE OR REPLACE FUNCTION content.direct_media_blob_writer_attempt_payload_valid_internal(
  p_payload content.direct_media_blob_writer_attempt_payload
)
RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  requested_payload content.direct_media_blob_writer_attempt_payload := p_payload;
BEGIN
  IF p_payload.normalization_version = 'image-jpeg-catalog-cover-v1' THEN
    requested_payload.normalization_version := 'passthrough-v1';
  END IF;
  RETURN p_payload.normalization_version IN (
    'passthrough-v1', 'image-jpeg-card-v1',
    'image-jpeg-catalog-cover-v1'
  ) AND content.direct_media_blob_writer_attempt_requested_payload_valid_internal(
    requested_payload
  ) IS TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION content.multipart_media_blob_writer_attempt_payload_valid_internal(
  p_payload content.multipart_media_blob_writer_attempt_payload
)
RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  requested_payload content.multipart_media_blob_writer_attempt_payload := p_payload;
BEGIN
  IF p_payload.normalization_version = 'image-jpeg-catalog-cover-v1' THEN
    requested_payload.normalization_version := 'passthrough-v1';
  END IF;
  RETURN p_payload.normalization_version IN (
    'passthrough-v1', 'image-jpeg-card-v1',
    'image-jpeg-catalog-cover-v1'
  ) AND content.multipart_media_blob_writer_attempt_requested_payload_valid_internal(
    requested_payload
  ) IS TRUE;
END;
$$;

ALTER FUNCTION content.begin_direct_media_blob_writer_attempt_with_owner(
  UUID, INTEGER, content.direct_media_blob_writer_attempt_payload
) RENAME TO begin_direct_media_blob_writer_attempt_0109_internal;
ALTER FUNCTION content.begin_media_upload_session_completion_attempt_with_owner(
  UUID, INTEGER, content.multipart_media_blob_writer_attempt_payload
) RENAME TO begin_media_upload_session_completion_attempt_0109_internal;
ALTER FUNCTION
content.begin_media_upload_session_completion_attempt_at_lease_target_with_owner(
  UUID, TIMESTAMPTZ, content.multipart_media_blob_writer_attempt_payload
) RENAME TO begin_multipart_writer_attempt_at_lease_0109_internal;

CREATE FUNCTION content.begin_direct_media_blob_writer_attempt_with_owner(
  p_attempt_token UUID,
  p_lease_duration_ms INTEGER,
  p_payload content.direct_media_blob_writer_attempt_payload
)
RETURNS TABLE (
  attempt_status TEXT,
  reservation_token UUID,
  normalization_version TEXT,
  lease_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
  IF content.direct_media_blob_writer_attempt_requested_payload_valid_internal(
    p_payload
  ) IS DISTINCT FROM true
  THEN
    RETURN QUERY
    SELECT 'stale'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;
  RETURN QUERY
  SELECT * FROM content.begin_direct_media_blob_writer_attempt_0109_internal(
    p_attempt_token, p_lease_duration_ms, p_payload
  );
END;
$$;

CREATE FUNCTION content.begin_media_upload_session_completion_attempt_with_owner(
  p_attempt_token UUID,
  p_lease_duration_ms INTEGER,
  p_payload content.multipart_media_blob_writer_attempt_payload
)
RETURNS TABLE (
  attempt_status TEXT,
  reservation_token UUID,
  normalization_version TEXT,
  lease_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
  IF content.multipart_media_blob_writer_attempt_requested_payload_valid_internal(
    p_payload
  ) IS DISTINCT FROM true
  THEN
    RETURN QUERY
    SELECT 'stale'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;
  RETURN QUERY
  SELECT *
  FROM content.begin_media_upload_session_completion_attempt_0109_internal(
    p_attempt_token, p_lease_duration_ms, p_payload
  );
END;
$$;

CREATE FUNCTION
content.begin_media_upload_session_completion_attempt_at_lease_target_with_owner(
  p_attempt_token UUID,
  p_lease_expires_at TIMESTAMPTZ,
  p_payload content.multipart_media_blob_writer_attempt_payload
)
RETURNS TABLE (
  attempt_status TEXT,
  reservation_token UUID,
  normalization_version TEXT,
  lease_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
  IF content.multipart_media_blob_writer_attempt_requested_payload_valid_internal(
    p_payload
  ) IS DISTINCT FROM true
  THEN
    RETURN QUERY
    SELECT 'stale'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;
  RETURN QUERY
  SELECT *
  FROM content.begin_multipart_writer_attempt_at_lease_0109_internal(
    p_attempt_token, p_lease_expires_at, p_payload
  );
END;
$$;

CREATE FUNCTION content.media_blob_has_active_reference_internal(p_sha256 TEXT)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM content.media_assets AS assets
    INNER JOIN content.media_blobs AS blobs
      ON blobs.media_blob_id = assets.media_blob_id
    WHERE blobs.sha256 = p_sha256 AND assets.deleted_at IS NULL
  ) OR EXISTS (
    SELECT 1 FROM catalog.package_media_assets AS assets
    INNER JOIN content.media_blobs AS blobs
      ON blobs.media_blob_id = assets.media_blob_id
    WHERE blobs.sha256 = p_sha256
  );
$$;

CREATE OR REPLACE FUNCTION content.media_blob_cleanup_blocked_internal(
  p_sha256 TEXT
)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
  SELECT content.media_blob_has_active_reference_internal(p_sha256)
    OR EXISTS (
      SELECT 1 FROM content.media_blob_writer_reservations AS reservations
      WHERE reservations.sha256 = p_sha256
        AND reservations.state IN ('active', 'ambiguous')
    ) OR EXISTS (
      SELECT 1 FROM content.media_blob_writer_attempts AS attempts
      WHERE attempts.sha256 = p_sha256
        AND (attempts.state = 'leased'
          OR attempts.reconciliation_state IN ('pending', 'leased'))
    ) OR EXISTS (
      SELECT 1 FROM content.generated_media_promotion_jobs AS jobs
      WHERE jobs.sha256 = p_sha256 AND jobs.state IN ('pending', 'leased')
    );
$$;

CREATE FUNCTION content.admit_catalog_image_blob_write(
  p_sha256 TEXT,
  p_storage_key TEXT,
  p_mime_type TEXT,
  p_size_bytes BIGINT,
  p_normalization_version TEXT,
  p_cleanup_delay_ms INTEGER
)
RETURNS TABLE (normalization_version TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  lifecycle content.media_blob_lifecycles%ROWTYPE;
  admitted_at TIMESTAMPTZ;
  admitted_cleanup_at TIMESTAMPTZ;
BEGIN
  IF p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$'
    OR p_storage_key IS DISTINCT FROM (
      'media/blobs/sha256/' || pg_catalog.substring(p_sha256, 1, 2)
      || '/' || pg_catalog.substring(p_sha256, 3, 2) || '/' || p_sha256
    )
    OR p_mime_type IS DISTINCT FROM 'image/jpeg'
    OR p_size_bytes IS NULL OR p_size_bytes < 0
    OR p_normalization_version NOT IN (
      'image-jpeg-card-v1', 'image-jpeg-catalog-cover-v1'
    )
  THEN
    RAISE EXCEPTION 'Catalog image blob admission metadata is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF p_cleanup_delay_ms IS NULL
    OR p_cleanup_delay_ms NOT BETWEEN 60000 AND 604800000
  THEN
    RAISE EXCEPTION 'p_cleanup_delay_ms must be between 60000 and 604800000'
      USING ERRCODE = '22023';
  END IF;

  admitted_at := pg_catalog.clock_timestamp();
  admitted_cleanup_at :=
    admitted_at + (p_cleanup_delay_ms * interval '1 millisecond');
  INSERT INTO content.media_blob_lifecycles (
    sha256, storage_key, mime_type, size_bytes, normalization_version,
    cleanup_eligible_at
  ) VALUES (
    p_sha256, p_storage_key, p_mime_type, p_size_bytes,
    p_normalization_version, admitted_cleanup_at
  ) ON CONFLICT (sha256) DO NOTHING;

  SELECT lifecycles.* INTO lifecycle
  FROM content.media_blob_lifecycles AS lifecycles
  WHERE lifecycles.sha256 = p_sha256 FOR UPDATE;
  IF NOT FOUND OR lifecycle.storage_key IS DISTINCT FROM p_storage_key
    OR lifecycle.mime_type IS DISTINCT FROM p_mime_type
    OR lifecycle.size_bytes IS DISTINCT FROM p_size_bytes
  THEN
    RAISE EXCEPTION 'Catalog image blob conflicts with immutable lifecycle metadata'
      USING ERRCODE = '23514';
  END IF;
  IF lifecycle.cleanup_lease_token IS NOT NULL
    AND lifecycle.cleanup_lease_expires_at > admitted_at
  THEN
    RAISE EXCEPTION 'Catalog image blob admission conflicts with an active cleanup claim'
      USING ERRCODE = '55P03';
  END IF;

  UPDATE content.media_blob_lifecycles AS lifecycles SET
    cleanup_eligible_at = CASE
      WHEN content.media_blob_has_active_reference_internal(p_sha256)
      THEN NULL
      ELSE GREATEST(
        COALESCE(lifecycles.cleanup_eligible_at, '-infinity'::TIMESTAMPTZ),
        admitted_cleanup_at
      )
    END,
    cleanup_lease_token = NULL,
    cleanup_lease_expires_at = NULL,
    updated_at = admitted_at
  WHERE lifecycles.sha256 = p_sha256 RETURNING lifecycles.* INTO lifecycle;
  RETURN QUERY SELECT lifecycle.normalization_version;
END;
$$;

CREATE FUNCTION content.schedule_media_blob_cleanup(
  p_media_blob_id UUID,
  p_cleanup_delay_ms INTEGER
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  media_blob content.media_blobs%ROWTYPE;
  lifecycle content.media_blob_lifecycles%ROWTYPE;
  scheduled_at TIMESTAMPTZ;
BEGIN
  IF p_media_blob_id IS NULL THEN
    RAISE EXCEPTION 'p_media_blob_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_cleanup_delay_ms IS NULL
    OR p_cleanup_delay_ms NOT BETWEEN 1 AND 604800000
  THEN
    RAISE EXCEPTION 'p_cleanup_delay_ms must be between 1 and 604800000'
      USING ERRCODE = '22023';
  END IF;
  SELECT blobs.* INTO media_blob FROM content.media_blobs AS blobs
  WHERE blobs.media_blob_id = p_media_blob_id FOR SHARE;
  IF NOT FOUND THEN RETURN false;
  END IF;
  SELECT lifecycles.* INTO lifecycle
  FROM content.media_blob_lifecycles AS lifecycles
  WHERE lifecycles.sha256 = media_blob.sha256 FOR UPDATE;
  IF NOT FOUND OR lifecycle.storage_key IS DISTINCT FROM media_blob.storage_key
    OR lifecycle.mime_type IS DISTINCT FROM media_blob.mime_type
    OR lifecycle.size_bytes IS DISTINCT FROM media_blob.size_bytes
    OR lifecycle.normalization_version IS DISTINCT FROM media_blob.normalization_version
  THEN
    RAISE EXCEPTION 'Media blob cleanup scheduling conflicts with immutable lifecycle metadata'
      USING ERRCODE = '23514';
  END IF;

  scheduled_at := pg_catalog.clock_timestamp();
  IF lifecycle.cleanup_lease_token IS NOT NULL
    AND lifecycle.cleanup_lease_expires_at > scheduled_at
  THEN
    RAISE EXCEPTION 'Media blob cleanup scheduling conflicts with an active cleanup claim'
      USING ERRCODE = '55P03';
  END IF;
  IF content.media_blob_has_active_reference_internal(media_blob.sha256) THEN
    UPDATE content.media_blob_lifecycles AS lifecycles SET
      cleanup_eligible_at = NULL,
      cleanup_lease_token = NULL,
      cleanup_lease_expires_at = NULL,
      updated_at = scheduled_at
    WHERE lifecycles.sha256 = media_blob.sha256;
    RETURN false;
  END IF;
  UPDATE content.media_blob_lifecycles AS lifecycles SET
    cleanup_eligible_at = GREATEST(
      COALESCE(lifecycles.cleanup_eligible_at, '-infinity'::TIMESTAMPTZ),
      scheduled_at + (p_cleanup_delay_ms * interval '1 millisecond')
    ),
    cleanup_lease_token = NULL,
    cleanup_lease_expires_at = NULL,
    updated_at = scheduled_at
  WHERE lifecycles.sha256 = media_blob.sha256;
  RETURN true;
END;
$$;

COMMENT ON FUNCTION content.admit_catalog_image_blob_write(
  TEXT, TEXT, TEXT, BIGINT, TEXT, INTEGER
) IS 'Durably admits a catalog image object write without a workspace asset and leaves an unattached write cleanup-eligible after the bounded admission window.';
COMMENT ON FUNCTION content.schedule_media_blob_cleanup(UUID, INTEGER) IS
  'Schedules a replaced, globally unreferenced permanent media blob for delayed cleanup.';

REVOKE ALL ON FUNCTION content.media_blob_has_active_reference_internal(TEXT)
FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION
content.direct_media_blob_writer_attempt_requested_payload_valid_internal(
  content.direct_media_blob_writer_attempt_payload
) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION
content.multipart_media_blob_writer_attempt_requested_payload_valid_internal(
  content.multipart_media_blob_writer_attempt_payload
) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.direct_media_blob_writer_attempt_payload_valid_internal(
  content.direct_media_blob_writer_attempt_payload
) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.multipart_media_blob_writer_attempt_payload_valid_internal(
  content.multipart_media_blob_writer_attempt_payload
) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.begin_direct_media_blob_writer_attempt_0109_internal(
  UUID, INTEGER, content.direct_media_blob_writer_attempt_payload
) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION
content.begin_media_upload_session_completion_attempt_0109_internal(
  UUID, INTEGER, content.multipart_media_blob_writer_attempt_payload
) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION
content.begin_multipart_writer_attempt_at_lease_0109_internal(
  UUID, TIMESTAMPTZ, content.multipart_media_blob_writer_attempt_payload
) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.begin_direct_media_blob_writer_attempt_with_owner(
  UUID, INTEGER, content.direct_media_blob_writer_attempt_payload
) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.begin_media_upload_session_completion_attempt_with_owner(
  UUID, INTEGER, content.multipart_media_blob_writer_attempt_payload
) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION
content.begin_media_upload_session_completion_attempt_at_lease_target_with_owner(
  UUID, TIMESTAMPTZ, content.multipart_media_blob_writer_attempt_payload
) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.admit_catalog_image_blob_write(
  TEXT, TEXT, TEXT, BIGINT, TEXT, INTEGER
) FROM PUBLIC, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.schedule_media_blob_cleanup(UUID, INTEGER)
FROM PUBLIC, auth_app, reporting_readonly;
GRANT EXECUTE ON FUNCTION content.admit_catalog_image_blob_write(
  TEXT, TEXT, TEXT, BIGINT, TEXT, INTEGER
) TO backend_app;
GRANT EXECUTE ON FUNCTION content.schedule_media_blob_cleanup(UUID, INTEGER)
TO backend_app;
GRANT EXECUTE ON FUNCTION content.begin_direct_media_blob_writer_attempt_with_owner(
  UUID, INTEGER, content.direct_media_blob_writer_attempt_payload
) TO backend_app;
GRANT EXECUTE ON FUNCTION content.begin_media_upload_session_completion_attempt_with_owner(
  UUID, INTEGER, content.multipart_media_blob_writer_attempt_payload
) TO backend_app;
GRANT EXECUTE ON FUNCTION
content.begin_media_upload_session_completion_attempt_at_lease_target_with_owner(
  UUID, TIMESTAMPTZ, content.multipart_media_blob_writer_attempt_payload
) TO backend_app;
