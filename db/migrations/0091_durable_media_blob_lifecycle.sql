-- Migration status: Current / additive.
-- Introduces: exact-token writer reservations and cleanup claims for permanent media blobs.
-- Schemas touched/read explicitly: content, catalog, pg_catalog, public.
CREATE TABLE content.media_blob_lifecycles (
  sha256                    TEXT        PRIMARY KEY,
  storage_key               TEXT        NOT NULL UNIQUE,
  mime_type                 TEXT        NOT NULL,
  size_bytes                BIGINT      NOT NULL CHECK (size_bytes >= 0),
  normalization_version     TEXT        NOT NULL,
  cleanup_eligible_at       TIMESTAMPTZ,
  cleanup_lease_token       UUID,
  cleanup_lease_expires_at  TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT media_blob_lifecycles_sha256_normalized CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT media_blob_lifecycles_storage_key_deterministic CHECK ( storage_key = 'media/blobs/sha256/' || substring(sha256 from 1 for 2) || '/' || substring(sha256 from 3 for 2) || '/' || sha256 ),
  CONSTRAINT media_blob_lifecycles_mime_type_normalized CHECK ( mime_type = lower(btrim(mime_type)) AND mime_type ~ '^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$' ),
  CONSTRAINT media_blob_lifecycles_normalization_version_supported CHECK (normalization_version IN ('passthrough-v1', 'image-jpeg-card-v1')),
  CONSTRAINT media_blob_lifecycles_cleanup_lease_shape CHECK ( ( cleanup_lease_token IS NULL AND cleanup_lease_expires_at IS NULL ) OR ( cleanup_eligible_at IS NOT NULL AND cleanup_lease_token IS NOT NULL AND cleanup_lease_expires_at IS NOT NULL ) )
);
COMMENT ON TABLE content.media_blob_lifecycles IS 'Global immutable content-hash identity plus delayed cleanup eligibility and exact cleanup lease for one permanent media blob.';
COMMENT ON COLUMN content.media_blob_lifecycles.cleanup_eligible_at IS 'Earliest time an unreferenced permanent object may be claimed for cleanup.';
COMMENT ON COLUMN content.media_blob_lifecycles.cleanup_lease_token IS 'Exact token fencing the current cleanup claimant from writers and stale cleanup workers.';
CREATE FUNCTION content.fence_media_blob_reference(p_media_blob_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  media_blob content.media_blobs%ROWTYPE;
  lifecycle content.media_blob_lifecycles%ROWTYPE;
BEGIN
  SELECT media_blobs.* INTO media_blob
  FROM content.media_blobs AS media_blobs
  WHERE media_blobs.media_blob_id = p_media_blob_id
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Media blob reference targets a missing media blob' USING ERRCODE = '23503';
  END IF;
  INSERT INTO content.media_blob_lifecycles
    (sha256, storage_key, mime_type, size_bytes, normalization_version, created_at, updated_at)
  VALUES (
    media_blob.sha256, media_blob.storage_key, media_blob.mime_type,
    media_blob.size_bytes, media_blob.normalization_version, media_blob.created_at, media_blob.updated_at
  )
  ON CONFLICT (sha256) DO NOTHING;
  SELECT lifecycles.* INTO lifecycle
  FROM content.media_blob_lifecycles AS lifecycles
  WHERE lifecycles.sha256 = media_blob.sha256
  FOR UPDATE;
  IF NOT FOUND OR lifecycle.storage_key IS DISTINCT FROM media_blob.storage_key
    OR lifecycle.mime_type IS DISTINCT FROM media_blob.mime_type
    OR lifecycle.size_bytes IS DISTINCT FROM media_blob.size_bytes
    OR lifecycle.normalization_version IS DISTINCT FROM media_blob.normalization_version
  THEN
    RAISE EXCEPTION 'Media blob reference conflicts with immutable lifecycle metadata' USING ERRCODE = '23514';
  END IF;
  IF lifecycle.cleanup_lease_token IS NOT NULL AND lifecycle.cleanup_lease_expires_at > clock_timestamp()
  THEN
    RAISE EXCEPTION 'Media blob reference conflicts with an active cleanup claim' USING ERRCODE = '55P03';
  END IF;
  UPDATE content.media_blob_lifecycles AS lifecycles
  SET cleanup_eligible_at = NULL, cleanup_lease_token = NULL,
      cleanup_lease_expires_at = NULL, updated_at = clock_timestamp()
  WHERE lifecycles.sha256 = media_blob.sha256;
END;
$$;
CREATE FUNCTION content.fence_workspace_media_asset_reference() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.deleted_at IS NULL THEN PERFORM content.fence_media_blob_reference(NEW.media_blob_id);
    END IF;
  ELSIF NEW.deleted_at IS NULL AND (OLD.deleted_at IS NOT NULL OR NEW.media_blob_id IS DISTINCT FROM OLD.media_blob_id)
  THEN
    PERFORM content.fence_media_blob_reference(NEW.media_blob_id);
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION content.fence_catalog_media_asset_reference() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.media_blob_id IS DISTINCT FROM OLD.media_blob_id THEN
    PERFORM content.fence_media_blob_reference(NEW.media_blob_id);
  END IF;
  RETURN NEW;
END;
$$;
-- Install both reference fences before backfill so their table locks close the rolling-writer snapshot gap.
CREATE TRIGGER media_assets_blob_reference_fence BEFORE INSERT OR UPDATE ON content.media_assets
  FOR EACH ROW EXECUTE FUNCTION content.fence_workspace_media_asset_reference();
CREATE TRIGGER package_media_assets_blob_reference_fence BEFORE INSERT OR UPDATE ON catalog.package_media_assets
  FOR EACH ROW EXECUTE FUNCTION content.fence_catalog_media_asset_reference();
INSERT INTO content.media_blob_lifecycles (
  sha256, storage_key, mime_type, size_bytes, normalization_version, created_at, updated_at
)
SELECT
  media_blobs.sha256, media_blobs.storage_key, media_blobs.mime_type,
  media_blobs.size_bytes, media_blobs.normalization_version,
  media_blobs.created_at, media_blobs.updated_at
FROM content.media_blobs AS media_blobs
ON CONFLICT (sha256) DO NOTHING;
CREATE TABLE content.media_blob_writer_reservations (
  reservation_token   UUID        PRIMARY KEY DEFAULT public.gen_random_uuid(),
  sha256              TEXT        NOT NULL REFERENCES content.media_blob_lifecycles(sha256) ON DELETE RESTRICT,
  writer_kind         TEXT        NOT NULL CHECK (writer_kind IN ('direct_ingestion', 'multipart_completion', 'generated_promotion')),
  workspace_id        UUID        NOT NULL,
  media_asset_id      UUID        NOT NULL,
  operation_id        TEXT        NOT NULL,
  state               TEXT        NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'ambiguous', 'finalized', 'unreferenced')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  ambiguous_at        TIMESTAMPTZ,
  CONSTRAINT media_blob_writer_reservations_identity_unique UNIQUE (writer_kind, workspace_id, media_asset_id, operation_id),
  CONSTRAINT media_blob_writer_reservations_operation_id_safe CHECK ( operation_id = btrim(operation_id) AND char_length(operation_id) BETWEEN 1 AND 1024 ),
  CONSTRAINT media_blob_writer_reservations_state_shape CHECK ( (state = 'active' AND ambiguous_at IS NULL) OR (state = 'ambiguous' AND ambiguous_at IS NOT NULL) OR state IN ('finalized', 'unreferenced') )
);
CREATE INDEX idx_media_blob_writer_reservations_sha256 ON content.media_blob_writer_reservations(sha256, reservation_token);
CREATE INDEX idx_media_blob_lifecycles_cleanup_due ON content.media_blob_lifecycles(cleanup_eligible_at, sha256)
  WHERE cleanup_eligible_at IS NOT NULL;
COMMENT ON TABLE content.media_blob_writer_reservations IS 'Durable exact-token fences held from before a permanent object write until a definite database reference or reconciled terminal outcome.';
COMMENT ON COLUMN content.media_blob_writer_reservations.ambiguous_at IS 'Timestamp when a database commit outcome became unknown. Ambiguous reservations never become cleanup-eligible by time alone.';
CREATE FUNCTION content.reserve_media_blob_writer(p_sha256 TEXT, p_storage_key TEXT, p_mime_type TEXT, p_size_bytes BIGINT, p_normalization_version TEXT, p_writer_kind TEXT, p_workspace_id UUID, p_media_asset_id UUID, p_operation_id TEXT) RETURNS TABLE (
  reservation_token UUID,
  reservation_state TEXT,
  reservation_status TEXT
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  lifecycle content.media_blob_lifecycles%ROWTYPE;
  reservation content.media_blob_writer_reservations%ROWTYPE;
BEGIN
  IF security.current_workspace_access_allowed(p_workspace_id) IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'Permanent media blob writer requires the active workspace scope' USING ERRCODE = '42501';
  END IF;
  INSERT INTO content.media_blob_lifecycles (sha256, storage_key, mime_type, size_bytes, normalization_version)
  VALUES (p_sha256, p_storage_key, p_mime_type, p_size_bytes, p_normalization_version)
  ON CONFLICT DO NOTHING;
  SELECT lifecycles.*
  INTO lifecycle
  FROM content.media_blob_lifecycles AS lifecycles
  WHERE lifecycles.sha256 = p_sha256
  FOR UPDATE;
  IF NOT FOUND OR lifecycle.storage_key IS DISTINCT FROM p_storage_key OR lifecycle.mime_type IS DISTINCT FROM p_mime_type OR lifecycle.size_bytes IS DISTINCT FROM p_size_bytes OR lifecycle.normalization_version IS DISTINCT FROM p_normalization_version
  THEN RAISE EXCEPTION 'Permanent media blob immutable metadata conflicts with its content hash' USING ERRCODE = '23514';
  END IF;
  IF lifecycle.cleanup_lease_token IS NOT NULL AND lifecycle.cleanup_lease_expires_at > clock_timestamp()
  THEN RETURN QUERY SELECT NULL::UUID, NULL::TEXT, 'cleanup_claimed'::TEXT; RETURN;
  END IF;
  UPDATE content.media_blob_lifecycles AS lifecycles
  SET cleanup_eligible_at = NULL, cleanup_lease_token = NULL, cleanup_lease_expires_at = NULL, updated_at = clock_timestamp()
  WHERE lifecycles.sha256 = p_sha256;
  INSERT INTO content.media_blob_writer_reservations ( sha256, writer_kind, workspace_id, media_asset_id, operation_id
  )
  VALUES ( p_sha256, p_writer_kind, p_workspace_id, p_media_asset_id, p_operation_id
  )
  ON CONFLICT (writer_kind, workspace_id, media_asset_id, operation_id) DO NOTHING;
  SELECT reservations.*
  INTO reservation
  FROM content.media_blob_writer_reservations AS reservations
  WHERE reservations.writer_kind = p_writer_kind AND reservations.workspace_id = p_workspace_id AND reservations.media_asset_id = p_media_asset_id AND reservations.operation_id = p_operation_id
  FOR UPDATE;
  IF NOT FOUND OR reservation.sha256 IS DISTINCT FROM p_sha256 THEN RAISE EXCEPTION 'Permanent media blob writer identity conflicts with a different content hash' USING ERRCODE = '23514';
  END IF;
  IF reservation.state = 'unreferenced' THEN
    UPDATE content.media_blob_writer_reservations AS reservations
    SET reservation_token = public.gen_random_uuid(), state = 'active', ambiguous_at = NULL WHERE reservations.reservation_token = reservation.reservation_token RETURNING reservations.* INTO reservation;
  END IF;
  RETURN QUERY
  SELECT reservation.reservation_token, reservation.state, 'reserved'::TEXT;
END;
$$;
CREATE FUNCTION content.finalize_media_blob_writer(p_reservation_token UUID,
  p_sha256 TEXT, p_workspace_id UUID, p_media_asset_id UUID) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  reservation content.media_blob_writer_reservations%ROWTYPE;
BEGIN
  IF security.current_workspace_access_allowed(p_workspace_id) IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'Permanent media blob finalization requires the active workspace scope' USING ERRCODE = '42501';
  END IF;
  PERFORM 1
  FROM content.media_blob_lifecycles AS lifecycles
  WHERE lifecycles.sha256 = p_sha256
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false;
  END IF;
  SELECT reservations.*
  INTO reservation
  FROM content.media_blob_writer_reservations AS reservations
  WHERE reservations.reservation_token = p_reservation_token
  FOR UPDATE;
  IF NOT FOUND OR reservation.sha256 IS DISTINCT FROM p_sha256 OR reservation.workspace_id IS DISTINCT FROM p_workspace_id OR reservation.media_asset_id IS DISTINCT FROM p_media_asset_id
  THEN RETURN false;
  END IF;
  IF reservation.state = 'finalized' THEN RETURN true;
  ELSIF reservation.state = 'unreferenced' THEN RETURN false;
  END IF;
  PERFORM 1
  FROM content.media_assets AS media_assets
  INNER JOIN content.media_blobs AS media_blobs ON media_blobs.media_blob_id = media_assets.media_blob_id
  WHERE media_assets.workspace_id = p_workspace_id AND media_assets.media_asset_id = p_media_asset_id AND media_assets.deleted_at IS NULL AND media_blobs.sha256 = p_sha256;
  IF NOT FOUND THEN RETURN false;
  END IF;
  UPDATE content.media_blob_writer_reservations AS reservations
  SET state = 'finalized'
  WHERE reservations.reservation_token = p_reservation_token;
  UPDATE content.media_blob_lifecycles AS lifecycles
  SET cleanup_eligible_at = NULL, cleanup_lease_token = NULL, cleanup_lease_expires_at = NULL, updated_at = clock_timestamp()
  WHERE lifecycles.sha256 = p_sha256;
  RETURN true;
END;
$$;
CREATE FUNCTION content.mark_media_blob_writer_ambiguous(p_reservation_token UUID) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  reservation_workspace_id UUID;
BEGIN
  SELECT reservations.workspace_id INTO reservation_workspace_id
  FROM content.media_blob_writer_reservations AS reservations
  WHERE reservations.reservation_token = p_reservation_token;
  IF NOT FOUND THEN RETURN false;
  END IF;
  IF security.current_workspace_access_allowed(reservation_workspace_id) IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'Permanent media blob ambiguity requires the reservation workspace scope' USING ERRCODE = '42501';
  END IF;
  UPDATE content.media_blob_writer_reservations
  SET state = 'ambiguous', ambiguous_at = COALESCE(ambiguous_at, statement_timestamp())
  WHERE reservation_token = p_reservation_token AND state NOT IN ('finalized', 'unreferenced');
  RETURN FOUND;
END;
$$;
CREATE FUNCTION content.reconcile_media_blob_writer(p_reservation_token UUID,
  p_sha256 TEXT, p_workspace_id UUID, p_media_asset_id UUID, p_cleanup_delay_ms INTEGER) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  reservation content.media_blob_writer_reservations%ROWTYPE;
  reservation_found BOOLEAN;
  exact_reference_exists BOOLEAN;
  any_reference_exists BOOLEAN;
  reconciled_at TIMESTAMPTZ;
BEGIN
  IF security.current_workspace_access_allowed(p_workspace_id) IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'Permanent media blob reconciliation requires the active workspace scope' USING ERRCODE = '42501';
  END IF;
  IF p_cleanup_delay_ms IS NULL OR p_cleanup_delay_ms NOT BETWEEN 1 AND 604800000 THEN RAISE EXCEPTION 'p_cleanup_delay_ms must be between 1 and 604800000' USING ERRCODE = '22023';
  END IF;
  PERFORM 1
  FROM content.media_blob_lifecycles AS lifecycles
  WHERE lifecycles.sha256 = p_sha256
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 'stale';
  END IF;
  SELECT reservations.*
  INTO reservation
  FROM content.media_blob_writer_reservations AS reservations
  WHERE reservations.reservation_token = p_reservation_token
  FOR UPDATE;
  reservation_found := FOUND;
  SELECT EXISTS ( SELECT 1 FROM content.media_assets AS media_assets INNER JOIN content.media_blobs AS media_blobs ON media_blobs.media_blob_id = media_assets.media_blob_id WHERE media_assets.workspace_id = p_workspace_id AND media_assets.media_asset_id = p_media_asset_id AND media_assets.deleted_at IS NULL AND media_blobs.sha256 = p_sha256
  )
  INTO exact_reference_exists;
  IF NOT reservation_found THEN RETURN 'stale';
  END IF;
  IF reservation.sha256 IS DISTINCT FROM p_sha256 OR reservation.workspace_id IS DISTINCT FROM p_workspace_id OR reservation.media_asset_id IS DISTINCT FROM p_media_asset_id
  THEN RETURN 'stale';
  END IF;
  IF reservation.state = 'finalized' THEN RETURN 'referenced';
  ELSIF reservation.state = 'unreferenced' THEN RETURN 'unreferenced';
  END IF;
  IF exact_reference_exists THEN UPDATE content.media_blob_writer_reservations AS reservations SET state = 'finalized' WHERE reservations.reservation_token = p_reservation_token; UPDATE content.media_blob_lifecycles AS lifecycles SET cleanup_eligible_at = NULL, cleanup_lease_token = NULL, cleanup_lease_expires_at = NULL, updated_at = clock_timestamp() WHERE lifecycles.sha256 = p_sha256; RETURN 'referenced';
  END IF;
  UPDATE content.media_blob_writer_reservations AS reservations SET state = 'unreferenced'
  WHERE reservations.reservation_token = p_reservation_token;
  SELECT EXISTS ( SELECT 1 FROM content.media_assets AS media_assets INNER JOIN content.media_blobs AS media_blobs ON media_blobs.media_blob_id = media_assets.media_blob_id WHERE media_blobs.sha256 = p_sha256 AND media_assets.deleted_at IS NULL ) OR EXISTS ( SELECT 1 FROM catalog.package_media_assets AS package_media_assets INNER JOIN content.media_blobs AS media_blobs ON media_blobs.media_blob_id = package_media_assets.media_blob_id WHERE media_blobs.sha256 = p_sha256 )
  INTO any_reference_exists;
  IF NOT any_reference_exists AND NOT EXISTS ( SELECT 1 FROM content.media_blob_writer_reservations AS reservations WHERE reservations.sha256 = p_sha256 AND reservations.state NOT IN ('finalized', 'unreferenced') )
  THEN
    reconciled_at := clock_timestamp();
    UPDATE content.media_blob_lifecycles AS lifecycles SET cleanup_eligible_at = GREATEST( COALESCE(lifecycles.cleanup_eligible_at, '-infinity'::TIMESTAMPTZ), reconciled_at + (p_cleanup_delay_ms * interval '1 millisecond') ), cleanup_lease_token = NULL, cleanup_lease_expires_at = NULL, updated_at = reconciled_at WHERE lifecycles.sha256 = p_sha256;
  END IF;
  RETURN 'unreferenced';
END;
$$;
CREATE FUNCTION content.fail_media_blob_writer(p_reservation_token UUID, p_cleanup_delay_ms INTEGER) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  reservation content.media_blob_writer_reservations%ROWTYPE;
  reconciliation_status TEXT;
BEGIN
  SELECT reservations.*
  INTO reservation
  FROM content.media_blob_writer_reservations AS reservations
  WHERE reservations.reservation_token = p_reservation_token;
  IF NOT FOUND THEN RETURN false;
  END IF;
  IF security.current_workspace_access_allowed(reservation.workspace_id) IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'Permanent media blob failure requires the reservation workspace scope' USING ERRCODE = '42501';
  END IF;
  reconciliation_status := content.reconcile_media_blob_writer( p_reservation_token, reservation.sha256, reservation.workspace_id, reservation.media_asset_id, p_cleanup_delay_ms
  );
  RETURN reconciliation_status IN ('referenced', 'unreferenced');
END;
$$;
CREATE FUNCTION content.claim_media_blob_cleanup(p_sha256 TEXT, p_lease_duration_ms INTEGER) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  lifecycle content.media_blob_lifecycles%ROWTYPE;
  claimed_token UUID;
  claim_time TIMESTAMPTZ;
BEGIN
  IF p_lease_duration_ms IS NULL OR p_lease_duration_ms NOT BETWEEN 1 AND 3600000 THEN RAISE EXCEPTION 'p_lease_duration_ms must be between 1 and 3600000' USING ERRCODE = '22023';
  END IF;
  SELECT lifecycles.*
  INTO lifecycle
  FROM content.media_blob_lifecycles AS lifecycles
  WHERE lifecycles.sha256 = p_sha256
  FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL;
  END IF;
  claim_time := clock_timestamp();
  IF lifecycle.cleanup_eligible_at IS NULL OR lifecycle.cleanup_eligible_at > claim_time OR ( lifecycle.cleanup_lease_token IS NOT NULL AND lifecycle.cleanup_lease_expires_at > claim_time ) OR EXISTS ( SELECT 1 FROM content.media_blob_writer_reservations AS reservations WHERE reservations.sha256 = p_sha256 AND reservations.state NOT IN ('finalized', 'unreferenced') ) OR EXISTS ( SELECT 1 FROM content.media_assets AS media_assets INNER JOIN content.media_blobs AS media_blobs ON media_blobs.media_blob_id = media_assets.media_blob_id WHERE media_blobs.sha256 = p_sha256 AND media_assets.deleted_at IS NULL ) OR EXISTS ( SELECT 1 FROM catalog.package_media_assets AS package_media_assets INNER JOIN content.media_blobs AS media_blobs ON media_blobs.media_blob_id = package_media_assets.media_blob_id WHERE media_blobs.sha256 = p_sha256 )
  THEN RETURN NULL;
  END IF;
  claimed_token := public.gen_random_uuid();
  UPDATE content.media_blob_lifecycles AS lifecycles
  SET cleanup_lease_token = claimed_token, cleanup_lease_expires_at = claim_time + (p_lease_duration_ms * interval '1 millisecond'), updated_at = claim_time
  WHERE lifecycles.sha256 = p_sha256;
  RETURN claimed_token;
END;
$$;
CREATE FUNCTION content.generated_media_promotion_operation_applied(p_job_id UUID, p_operation_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM content.generated_media_promotion_jobs AS jobs
    WHERE jobs.job_id = p_job_id AND jobs.operation_id = p_operation_id AND jobs.state = 'applied'
  );
$$;
REVOKE ALL ON TABLE
  content.media_blob_lifecycles,
  content.media_blob_writer_reservations
FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.fence_media_blob_reference(UUID) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.fence_workspace_media_asset_reference() FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.fence_catalog_media_asset_reference() FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.reserve_media_blob_writer(TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION content.finalize_media_blob_writer(UUID, TEXT, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION content.mark_media_blob_writer_ambiguous(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION content.reconcile_media_blob_writer(UUID, TEXT, UUID, UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION content.fail_media_blob_writer(UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION content.claim_media_blob_cleanup(TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION content.generated_media_promotion_operation_applied(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content.reserve_media_blob_writer(TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, UUID, UUID, TEXT) TO backend_app;
GRANT EXECUTE ON FUNCTION content.finalize_media_blob_writer(UUID, TEXT, UUID, UUID) TO backend_app;
GRANT EXECUTE ON FUNCTION content.mark_media_blob_writer_ambiguous(UUID) TO backend_app;
GRANT EXECUTE ON FUNCTION content.reconcile_media_blob_writer(UUID, TEXT, UUID, UUID, INTEGER) TO backend_app;
GRANT EXECUTE ON FUNCTION content.fail_media_blob_writer(UUID, INTEGER) TO backend_app;
GRANT EXECUTE ON FUNCTION content.claim_media_blob_cleanup(TEXT, INTEGER) TO backend_app;
GRANT EXECUTE ON FUNCTION content.generated_media_promotion_operation_applied(UUID, UUID) TO backend_app;
