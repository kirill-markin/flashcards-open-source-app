-- Schemas touched/read explicitly: content, auth, org, sync, security, pg_catalog.
-- Immutable claim and attempt identities remain original; access uses the canonical owner.

CREATE OR REPLACE FUNCTION content.acquire_media_upload_session_creation_claim_with_owner(
  p_user_id TEXT,
  p_workspace_id UUID,
  p_media_asset_id UUID,
  p_replica_id UUID,
  p_claim_token UUID,
  p_lease_duration_ms INTEGER
)
RETURNS TABLE (
  claim_status TEXT,
  lease_expires_at TIMESTAMPTZ,
  media_upload_session_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  canonical_owner TEXT;
  locked_at TIMESTAMPTZ;
  leased_until TIMESTAMPTZ;
  exact_claim content.media_upload_session_creation_claims%ROWTYPE;
  blocking_expires_at TIMESTAMPTZ;
  blocking_session_id UUID;
  completion_retry_at TIMESTAMPTZ;
BEGIN
  IF p_user_id IS NULL
    OR p_user_id <> pg_catalog.btrim(p_user_id)
    OR p_user_id = ''
    OR pg_catalog.char_length(p_user_id) > 200
    OR p_user_id ~ '[[:cntrl:]]'
    OR p_workspace_id IS NULL
    OR p_media_asset_id IS NULL
    OR p_replica_id IS NULL
    OR p_claim_token IS NULL
    OR p_lease_duration_ms IS NULL
    OR p_lease_duration_ms NOT BETWEEN 1 AND 3600000
  THEN
    RETURN QUERY
    SELECT 'stale'::TEXT, NULL::TIMESTAMPTZ, NULL::UUID;
    RETURN;
  END IF;

  SELECT claims.*
  INTO exact_claim
  FROM content.media_upload_session_creation_claims AS claims
  WHERE claims.claim_token = p_claim_token;
  IF FOUND AND (exact_claim.workspace_id IS DISTINCT FROM p_workspace_id
    OR exact_claim.media_asset_id IS DISTINCT FROM p_media_asset_id
    OR exact_claim.claimed_by_user_id IS DISTINCT FROM p_user_id
    OR exact_claim.claimed_by_replica_id IS DISTINCT FROM p_replica_id)
  THEN
    RETURN QUERY SELECT 'stale'::TEXT, NULL::TIMESTAMPTZ, NULL::UUID;
    RETURN;
  END IF;

  canonical_owner := auth.canonical_account_id(p_user_id);
  PERFORM auth.assert_account_write_scope(canonical_owner);

  IF security.current_user_id() IS DISTINCT FROM canonical_owner
    OR security.current_workspace_id() IS DISTINCT FROM p_workspace_id
  THEN
    RETURN QUERY
    SELECT 'access_denied'::TEXT, NULL::TIMESTAMPTZ, NULL::UUID;
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      canonical_owner || ':' || p_workspace_id::TEXT,
      0::BIGINT
    )
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'multipart-asset:'
        || p_workspace_id::TEXT
        || ':'
        || p_media_asset_id::TEXT,
      4::BIGINT
    )
  );

  PERFORM auth.assert_account_write_scope(canonical_owner);
  IF auth.canonical_account_id(p_user_id) IS DISTINCT FROM canonical_owner THEN
    RAISE EXCEPTION 'Multipart creation account scope changed; reload and retry'
      USING ERRCODE = 'P0A01';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM org.workspace_memberships AS memberships
    WHERE memberships.workspace_id = p_workspace_id
      AND memberships.user_id = canonical_owner
  ) THEN
    RETURN QUERY
    SELECT 'access_denied'::TEXT, NULL::TIMESTAMPTZ, NULL::UUID;
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM sync.workspace_replicas AS replicas
    WHERE replicas.replica_id = p_replica_id
      AND replicas.workspace_id = p_workspace_id
      AND replicas.user_id = canonical_owner
  ) THEN
    RETURN QUERY
    SELECT 'replica_mismatch'::TEXT, NULL::TIMESTAMPTZ, NULL::UUID;
    RETURN;
  END IF;

  locked_at := pg_catalog.clock_timestamp();
  SELECT claims.*
  INTO exact_claim
  FROM content.media_upload_session_creation_claims AS claims
  WHERE claims.claim_token = p_claim_token
  FOR UPDATE;

  PERFORM auth.assert_account_write_scope(canonical_owner);
  IF auth.canonical_account_id(p_user_id) IS DISTINCT FROM canonical_owner THEN
    RAISE EXCEPTION 'Multipart creation account scope changed; reload and retry'
      USING ERRCODE = 'P0A01';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM org.workspace_memberships AS memberships
    WHERE memberships.workspace_id = p_workspace_id
      AND memberships.user_id = canonical_owner
  ) THEN
    RETURN QUERY SELECT 'access_denied'::TEXT, NULL::TIMESTAMPTZ, NULL::UUID;
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM sync.workspace_replicas AS replicas
    WHERE replicas.replica_id = p_replica_id
      AND replicas.workspace_id = p_workspace_id
      AND replicas.user_id = canonical_owner
  ) THEN
    RETURN QUERY SELECT 'replica_mismatch'::TEXT, NULL::TIMESTAMPTZ, NULL::UUID;
    RETURN;
  END IF;

  IF exact_claim.claim_token IS NOT NULL THEN
    IF exact_claim.workspace_id IS DISTINCT FROM p_workspace_id
      OR exact_claim.media_asset_id IS DISTINCT FROM p_media_asset_id
      OR exact_claim.claimed_by_user_id IS DISTINCT FROM p_user_id
      OR exact_claim.claimed_by_replica_id IS DISTINCT FROM p_replica_id
    THEN
      RETURN QUERY
      SELECT 'stale'::TEXT, NULL::TIMESTAMPTZ, NULL::UUID;
      RETURN;
    ELSIF exact_claim.state = 'finalized' THEN
      RETURN QUERY
      SELECT
        'finalized'::TEXT,
        NULL::TIMESTAMPTZ,
        exact_claim.media_upload_session_id;
      RETURN;
    ELSIF exact_claim.state = 'released' THEN
      RETURN QUERY
      SELECT 'released'::TEXT, NULL::TIMESTAMPTZ, NULL::UUID;
      RETURN;
    ELSIF exact_claim.lease_expires_at > locked_at THEN
      RETURN QUERY
      SELECT
        'acquired'::TEXT,
        exact_claim.lease_expires_at,
        NULL::UUID;
      RETURN;
    END IF;

    UPDATE content.media_upload_session_creation_claims AS claims
    SET
      state = 'released',
      lease_expires_at = NULL,
      media_upload_session_id = NULL,
      updated_at = locked_at,
      finalized_at = NULL,
      released_at = locked_at
    WHERE claims.claim_token = exact_claim.claim_token
      AND claims.state = 'leased'
      AND claims.lease_expires_at <= locked_at;
    RETURN QUERY
    SELECT 'released'::TEXT, NULL::TIMESTAMPTZ, NULL::UUID;
    RETURN;
  END IF;

  UPDATE content.media_upload_session_creation_claims AS claims
  SET
    state = 'released',
    lease_expires_at = NULL,
    media_upload_session_id = NULL,
    updated_at = locked_at,
    finalized_at = NULL,
    released_at = locked_at
  WHERE claims.workspace_id = p_workspace_id
    AND claims.media_asset_id = p_media_asset_id
    AND claims.state = 'leased'
    AND claims.lease_expires_at <= locked_at;

  SELECT
    CASE
      WHEN claims.state = 'leased' THEN claims.lease_expires_at
      ELSE sessions.expires_at
    END AS blocking_expires_at,
    claims.media_upload_session_id
  INTO blocking_expires_at, blocking_session_id
  FROM content.media_upload_session_creation_claims AS claims
  LEFT JOIN content.media_upload_sessions AS sessions
    ON sessions.media_upload_session_id = claims.media_upload_session_id
  WHERE claims.workspace_id = p_workspace_id
    AND claims.media_asset_id = p_media_asset_id
    AND (
      (
        claims.state = 'leased'
        AND claims.lease_expires_at > locked_at
      )
      OR (
        claims.state = 'finalized'
        AND (
          (
            sessions.state = 'active'
            AND sessions.expires_at > locked_at
          )
          OR sessions.state IN ('completing', 'aborting')
        )
      )
    )
  ORDER BY claims.created_at, claims.claim_token
  LIMIT 1
  FOR UPDATE OF claims;
  IF FOUND THEN
    RETURN QUERY
    SELECT
      'creation_pending'::TEXT,
      blocking_expires_at,
      blocking_session_id;
    RETURN;
  END IF;

  SELECT
    CASE
      WHEN attempts.reconciliation_state = 'leased'
      THEN attempts.reconciliation_lease_expires_at
      WHEN attempts.reconciliation_state = 'pending'
      THEN attempts.reconciliation_next_attempt_at
      ELSE attempts.lease_expires_at
    END
  INTO completion_retry_at
  FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.writer_kind = 'multipart_completion'
    AND attempts.workspace_id = p_workspace_id
    AND attempts.media_asset_id = p_media_asset_id
    AND (
      (
        attempts.state = 'leased'
        AND attempts.lease_expires_at > locked_at
      )
      OR attempts.reconciliation_state IN ('pending', 'leased')
    )
  ORDER BY attempts.created_at, attempts.attempt_token
  LIMIT 1
  FOR UPDATE;
  IF FOUND THEN
    RETURN QUERY
    SELECT
      'completion_pending'::TEXT,
      completion_retry_at,
      NULL::UUID;
    RETURN;
  END IF;

  leased_until :=
    locked_at + (p_lease_duration_ms * interval '1 millisecond');
  INSERT INTO content.media_upload_session_creation_claims (
    claim_token,
    workspace_id,
    media_asset_id,
    claimed_by_user_id,
    claimed_by_replica_id,
    state,
    lease_expires_at,
    media_upload_session_id,
    created_at,
    updated_at,
    finalized_at,
    released_at
  )
  VALUES (
    p_claim_token,
    p_workspace_id,
    p_media_asset_id,
    p_user_id,
    p_replica_id,
    'leased',
    leased_until,
    NULL,
    locked_at,
    locked_at,
    NULL,
    NULL
  );

  RETURN QUERY
  SELECT 'acquired'::TEXT, leased_until, NULL::UUID;
END;
$$;

CREATE OR REPLACE FUNCTION content.finalize_media_upload_session_creation_claim_with_owner(
  p_user_id TEXT,
  p_workspace_id UUID,
  p_media_asset_id UUID,
  p_replica_id UUID,
  p_claim_token UUID,
  p_media_upload_session_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  canonical_owner TEXT;
  locked_at TIMESTAMPTZ;
  claim content.media_upload_session_creation_claims%ROWTYPE;
  session content.media_upload_sessions%ROWTYPE;
BEGIN
  IF p_user_id IS NULL
    OR p_user_id <> pg_catalog.btrim(p_user_id)
    OR p_user_id = ''
    OR pg_catalog.char_length(p_user_id) > 200
    OR p_user_id ~ '[[:cntrl:]]'
    OR p_workspace_id IS NULL
    OR p_media_asset_id IS NULL
    OR p_replica_id IS NULL
    OR p_claim_token IS NULL
    OR p_media_upload_session_id IS NULL
  THEN
    RETURN 'stale';
  END IF;
  SELECT claims.*
  INTO claim
  FROM content.media_upload_session_creation_claims AS claims
  WHERE claims.claim_token = p_claim_token;
  IF NOT FOUND OR claim.workspace_id IS DISTINCT FROM p_workspace_id
    OR claim.media_asset_id IS DISTINCT FROM p_media_asset_id
    OR claim.claimed_by_user_id IS DISTINCT FROM p_user_id
    OR claim.claimed_by_replica_id IS DISTINCT FROM p_replica_id
  THEN
    RETURN 'claim_lost';
  END IF;

  canonical_owner := auth.canonical_account_id(p_user_id);
  PERFORM auth.assert_account_write_scope(canonical_owner);

  IF security.current_user_id() IS DISTINCT FROM canonical_owner
    OR security.current_workspace_id() IS DISTINCT FROM p_workspace_id
  THEN
    RETURN 'access_denied';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      canonical_owner || ':' || p_workspace_id::TEXT,
      0::BIGINT
    )
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'multipart-asset:'
        || p_workspace_id::TEXT
        || ':'
        || p_media_asset_id::TEXT,
      4::BIGINT
    )
  );

  PERFORM auth.assert_account_write_scope(canonical_owner);
  IF auth.canonical_account_id(p_user_id) IS DISTINCT FROM canonical_owner THEN
    RAISE EXCEPTION 'Multipart creation account scope changed; reload and retry'
      USING ERRCODE = 'P0A01';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM org.workspace_memberships AS memberships
    WHERE memberships.workspace_id = p_workspace_id
      AND memberships.user_id = canonical_owner
  ) THEN
    RETURN 'access_denied';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM sync.workspace_replicas AS replicas
    WHERE replicas.replica_id = p_replica_id
      AND replicas.workspace_id = p_workspace_id
      AND replicas.user_id = canonical_owner
  ) THEN
    RETURN 'replica_mismatch';
  END IF;

  locked_at := pg_catalog.clock_timestamp();
  SELECT claims.*
  INTO claim
  FROM content.media_upload_session_creation_claims AS claims
  WHERE claims.claim_token = p_claim_token
    AND claims.workspace_id = p_workspace_id
    AND claims.media_asset_id = p_media_asset_id
    AND claims.claimed_by_user_id = p_user_id
    AND claims.claimed_by_replica_id = p_replica_id
  FOR UPDATE;

  PERFORM auth.assert_account_write_scope(canonical_owner);
  IF auth.canonical_account_id(p_user_id) IS DISTINCT FROM canonical_owner THEN
    RAISE EXCEPTION 'Multipart creation account scope changed; reload and retry'
      USING ERRCODE = 'P0A01';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM org.workspace_memberships AS memberships
    WHERE memberships.workspace_id = p_workspace_id
      AND memberships.user_id = canonical_owner
  ) THEN
    RETURN 'access_denied';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM sync.workspace_replicas AS replicas
    WHERE replicas.replica_id = p_replica_id
      AND replicas.workspace_id = p_workspace_id
      AND replicas.user_id = canonical_owner
  ) THEN
    RETURN 'replica_mismatch';
  END IF;

  IF claim.claim_token IS NULL THEN
    RETURN 'claim_lost';
  ELSIF claim.state = 'finalized' THEN
    RETURN CASE
      WHEN claim.media_upload_session_id = p_media_upload_session_id
      THEN 'finalized'
      ELSE 'claim_lost'
    END;
  ELSIF claim.state = 'released' THEN
    RETURN 'released';
  ELSIF claim.lease_expires_at <= locked_at THEN
    UPDATE content.media_upload_session_creation_claims AS claims
    SET
      state = 'released',
      lease_expires_at = NULL,
      media_upload_session_id = NULL,
      updated_at = locked_at,
      finalized_at = NULL,
      released_at = locked_at
    WHERE claims.claim_token = claim.claim_token
      AND claims.state = 'leased';
    RETURN 'released';
  END IF;

  SELECT sessions.*
  INTO session
  FROM content.media_upload_sessions AS sessions
  WHERE sessions.media_upload_session_id = p_media_upload_session_id
  FOR UPDATE;

  PERFORM auth.assert_account_write_scope(canonical_owner);
  IF auth.canonical_account_id(p_user_id) IS DISTINCT FROM canonical_owner THEN
    RAISE EXCEPTION 'Multipart creation account scope changed; reload and retry'
      USING ERRCODE = 'P0A01';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM org.workspace_memberships AS memberships
    WHERE memberships.workspace_id = p_workspace_id
      AND memberships.user_id = canonical_owner
  ) THEN
    RETURN 'access_denied';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM sync.workspace_replicas AS replicas
    WHERE replicas.replica_id = p_replica_id
      AND replicas.workspace_id = p_workspace_id
      AND replicas.user_id = canonical_owner
  ) THEN
    RETURN 'replica_mismatch';
  END IF;

  IF session.media_upload_session_id IS NULL THEN
    RETURN 'session_not_found';
  ELSIF session.workspace_id IS DISTINCT FROM p_workspace_id
    OR session.media_asset_id IS DISTINCT FROM p_media_asset_id
    OR session.last_modified_by_replica_id IS DISTINCT FROM p_replica_id
    OR session.state IS DISTINCT FROM 'active'
    OR session.expires_at <= locked_at
    OR session.created_at < claim.created_at
  THEN
    RETURN 'session_mismatch';
  END IF;

  UPDATE content.media_upload_session_creation_claims AS claims
  SET
    state = 'finalized',
    lease_expires_at = NULL,
    media_upload_session_id = p_media_upload_session_id,
    updated_at = locked_at,
    finalized_at = locked_at,
    released_at = NULL
  WHERE claims.claim_token = claim.claim_token
    AND claims.state = 'leased'
    AND claims.lease_expires_at > locked_at;
  IF NOT FOUND THEN
    RETURN 'claim_lost';
  END IF;
  RETURN 'finalized';
END;
$$;

CREATE OR REPLACE FUNCTION content.release_media_upload_session_creation_claim_with_owner(
  p_user_id TEXT,
  p_workspace_id UUID,
  p_media_asset_id UUID,
  p_replica_id UUID,
  p_claim_token UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  canonical_owner TEXT;
  claim_released_at TIMESTAMPTZ;
  claim content.media_upload_session_creation_claims%ROWTYPE;
BEGIN
  IF p_user_id IS NULL
    OR p_user_id <> pg_catalog.btrim(p_user_id)
    OR p_user_id = ''
    OR pg_catalog.char_length(p_user_id) > 200
    OR p_user_id ~ '[[:cntrl:]]'
    OR p_workspace_id IS NULL
    OR p_media_asset_id IS NULL
    OR p_replica_id IS NULL
    OR p_claim_token IS NULL
  THEN
    RETURN 'stale';
  END IF;
  SELECT claims.*
  INTO claim
  FROM content.media_upload_session_creation_claims AS claims
  WHERE claims.claim_token = p_claim_token;
  IF NOT FOUND OR claim.workspace_id IS DISTINCT FROM p_workspace_id
    OR claim.media_asset_id IS DISTINCT FROM p_media_asset_id
    OR claim.claimed_by_user_id IS DISTINCT FROM p_user_id
    OR claim.claimed_by_replica_id IS DISTINCT FROM p_replica_id
  THEN
    RETURN 'claim_lost';
  END IF;

  canonical_owner := auth.canonical_account_id(p_user_id);
  PERFORM auth.assert_account_write_scope(canonical_owner);

  IF security.current_user_id() IS DISTINCT FROM canonical_owner
    OR security.current_workspace_id() IS DISTINCT FROM p_workspace_id
  THEN
    RETURN 'access_denied';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      canonical_owner || ':' || p_workspace_id::TEXT,
      0::BIGINT
    )
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'multipart-asset:'
        || p_workspace_id::TEXT
        || ':'
        || p_media_asset_id::TEXT,
      4::BIGINT
    )
  );

  PERFORM auth.assert_account_write_scope(canonical_owner);
  IF auth.canonical_account_id(p_user_id) IS DISTINCT FROM canonical_owner THEN
    RAISE EXCEPTION 'Multipart creation account scope changed; reload and retry'
      USING ERRCODE = 'P0A01';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM org.workspace_memberships AS memberships
    WHERE memberships.workspace_id = p_workspace_id
      AND memberships.user_id = canonical_owner
  ) THEN
    RETURN 'access_denied';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM sync.workspace_replicas AS replicas
    WHERE replicas.replica_id = p_replica_id
      AND replicas.workspace_id = p_workspace_id
      AND replicas.user_id = canonical_owner
  ) THEN
    RETURN 'replica_mismatch';
  END IF;

  SELECT claims.*
  INTO claim
  FROM content.media_upload_session_creation_claims AS claims
  WHERE claims.claim_token = p_claim_token
    AND claims.workspace_id = p_workspace_id
    AND claims.media_asset_id = p_media_asset_id
    AND claims.claimed_by_user_id = p_user_id
    AND claims.claimed_by_replica_id = p_replica_id
  FOR UPDATE;

  PERFORM auth.assert_account_write_scope(canonical_owner);
  IF auth.canonical_account_id(p_user_id) IS DISTINCT FROM canonical_owner THEN
    RAISE EXCEPTION 'Multipart creation account scope changed; reload and retry'
      USING ERRCODE = 'P0A01';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM org.workspace_memberships AS memberships
    WHERE memberships.workspace_id = p_workspace_id
      AND memberships.user_id = canonical_owner
  ) THEN
    RETURN 'access_denied';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM sync.workspace_replicas AS replicas
    WHERE replicas.replica_id = p_replica_id
      AND replicas.workspace_id = p_workspace_id
      AND replicas.user_id = canonical_owner
  ) THEN
    RETURN 'replica_mismatch';
  END IF;

  IF claim.claim_token IS NULL THEN
    RETURN 'claim_lost';
  ELSIF claim.state = 'finalized' THEN
    RETURN 'finalized';
  ELSIF claim.state = 'released' THEN
    RETURN 'released';
  END IF;

  claim_released_at := pg_catalog.clock_timestamp();
  UPDATE content.media_upload_session_creation_claims AS claims
  SET
    state = 'released',
    lease_expires_at = NULL,
    media_upload_session_id = NULL,
    updated_at = claim_released_at,
    finalized_at = NULL,
    released_at = claim_released_at
  WHERE claims.claim_token = claim.claim_token
    AND claims.state = 'leased';
  IF NOT FOUND THEN
    RETURN 'claim_lost';
  END IF;
  RETURN 'released';
END;
$$;

CREATE OR REPLACE FUNCTION content.handoff_media_upload_session_completion_attempt_0099_internal(
  p_attempt_token UUID,
  p_reservation_token UUID,
  p_payload content.multipart_media_blob_writer_attempt_payload
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  canonical_owner TEXT;
  attempt content.media_blob_writer_attempts%ROWTYPE;
  session content.media_upload_sessions%ROWTYPE;
  identity_status TEXT;
  canonical_payload BOOLEAN;
  handed_off_at TIMESTAMPTZ;
BEGIN
  IF p_attempt_token IS NULL
    OR p_reservation_token IS NULL
    OR content.multipart_media_blob_writer_attempt_payload_valid_internal(
      p_payload
    ) IS DISTINCT FROM true
  THEN
    RETURN 'stale_attempt';
  END IF;

  SELECT attempts.*
  INTO attempt
  FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.attempt_token = p_attempt_token;
  identity_status :=
    content.multipart_media_blob_writer_attempt_identity_status_internal(
      attempt,
      p_reservation_token,
      p_payload
    );
  IF identity_status <> 'ready' THEN
    RETURN identity_status;
  END IF;

  canonical_owner := auth.canonical_account_id(p_payload.user_id);
  PERFORM auth.assert_account_write_scope(canonical_owner);

  IF security.current_user_id() IS DISTINCT FROM canonical_owner
    OR security.current_workspace_id() IS DISTINCT FROM p_payload.workspace_id
  THEN
    RETURN 'access_denied';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      canonical_owner || ':' || p_payload.workspace_id::TEXT,
      0::BIGINT
    )
  );


  PERFORM auth.assert_account_write_scope(canonical_owner);
  IF auth.canonical_account_id(p_payload.user_id) IS DISTINCT FROM canonical_owner THEN
    RAISE EXCEPTION 'Multipart handoff account scope changed; reload and retry'
      USING ERRCODE = 'P0A01';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM org.workspace_memberships AS memberships
    WHERE memberships.workspace_id = p_payload.workspace_id
      AND memberships.user_id = canonical_owner
  ) THEN
    RETURN 'access_denied';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM sync.workspace_replicas AS replicas
    WHERE replicas.replica_id = p_payload.replica_id
      AND replicas.workspace_id = p_payload.workspace_id
      AND replicas.user_id = canonical_owner
  ) THEN
    RETURN 'ownership_mismatch';
  END IF;

  SELECT sessions.*
  INTO session
  FROM content.media_upload_sessions AS sessions
  WHERE sessions.media_upload_session_id = p_payload.media_upload_session_id
  FOR UPDATE;

  SELECT attempts.*
  INTO attempt
  FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.attempt_token = p_attempt_token
  FOR UPDATE;

  identity_status :=
    content.multipart_media_blob_writer_attempt_identity_status_internal(
      attempt,
      p_reservation_token,
      p_payload
    );
  IF identity_status <> 'ready' THEN
    RETURN identity_status;
  END IF;

  PERFORM auth.assert_account_write_scope(canonical_owner);
  IF auth.canonical_account_id(p_payload.user_id) IS DISTINCT FROM canonical_owner THEN
    RAISE EXCEPTION 'Multipart handoff account scope changed; reload and retry'
      USING ERRCODE = 'P0A01';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM org.workspace_memberships AS memberships
    WHERE memberships.workspace_id = p_payload.workspace_id
      AND memberships.user_id = canonical_owner
  ) THEN
    RETURN 'access_denied';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM sync.workspace_replicas AS replicas
    WHERE replicas.replica_id = p_payload.replica_id
      AND replicas.workspace_id = p_payload.workspace_id
      AND replicas.user_id = canonical_owner
  ) THEN
    RETURN 'ownership_mismatch';
  END IF;

  IF attempt.reconciliation_state IN ('pending', 'leased') THEN
    RETURN 'already_pending';
  ELSIF attempt.reconciliation_state = 'applied' THEN
    RETURN 'already_applied';
  ELSIF attempt.reconciliation_state = 'failed' THEN
    RETURN 'failed';
  END IF;

  IF attempt.state <> 'leased' THEN
    RETURN COALESCE(attempt.outcome, 'stale_attempt');
  END IF;

  IF session.media_upload_session_id IS NULL
    OR session.workspace_id IS DISTINCT FROM p_payload.workspace_id
    OR session.media_asset_id IS DISTINCT FROM p_payload.media_asset_id
    OR session.last_modified_by_replica_id IS DISTINCT FROM p_payload.replica_id
    OR session.last_operation_id IS DISTINCT FROM p_payload.last_operation_id
    OR session.media_blob_sha256 IS DISTINCT FROM p_payload.sha256
    OR session.staging_storage_key IS DISTINCT FROM p_payload.staging_storage_key
    OR session.blob_storage_key IS DISTINCT FROM p_payload.blob_storage_key
    OR session.s3_upload_id IS DISTINCT FROM p_payload.s3_upload_id
    OR session.mime_type IS DISTINCT FROM p_payload.mime_type
    OR session.size_bytes IS DISTINCT FROM p_payload.size_bytes
    OR session.part_size_bytes IS DISTINCT FROM p_payload.part_size_bytes
    OR session.part_count IS DISTINCT FROM p_payload.part_count
    OR session.source_url IS DISTINCT FROM p_payload.source_url
    OR session.asset_created_at IS DISTINCT FROM p_payload.asset_created_at
    OR session.client_updated_at IS DISTINCT FROM p_payload.client_updated_at
    OR session.expires_at IS DISTINCT FROM p_payload.session_expires_at
  THEN
    RETURN 'stale_attempt';
  END IF;

  IF session.state = 'aborting' THEN
    RETURN 'aborting';
  ELSIF session.state = 'aborted' THEN
    RETURN 'aborted';
  ELSIF session.state <> 'completing' THEN
    RETURN 'stale_attempt';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM content.media_blob_writer_reservations AS reservations
    WHERE reservations.reservation_token = p_reservation_token
      AND reservations.writer_kind = 'multipart_completion'
      AND reservations.workspace_id = p_payload.workspace_id
      AND reservations.media_asset_id = p_payload.media_asset_id
      AND reservations.operation_id =
        p_payload.media_upload_session_id::TEXT
      AND reservations.sha256 = p_payload.sha256
      AND reservations.state IN ('active', 'ambiguous', 'finalized')
    FOR UPDATE
  ) THEN
    RETURN 'writer_conflict';
  END IF;

  PERFORM auth.assert_account_write_scope(canonical_owner);
  IF auth.canonical_account_id(p_payload.user_id) IS DISTINCT FROM canonical_owner THEN
    RAISE EXCEPTION 'Multipart handoff account scope changed; reload and retry'
      USING ERRCODE = 'P0A01';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM org.workspace_memberships AS memberships
    WHERE memberships.workspace_id = p_payload.workspace_id
      AND memberships.user_id = canonical_owner
  ) THEN
    RETURN 'access_denied';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM sync.workspace_replicas AS replicas
    WHERE replicas.replica_id = p_payload.replica_id
      AND replicas.workspace_id = p_payload.workspace_id
      AND replicas.user_id = canonical_owner
  ) THEN
    RETURN 'ownership_mismatch';
  END IF;

  canonical_payload :=
    content.multipart_media_blob_writer_attempt_payload_canonical_valid_internal(
      p_payload
    );
  handed_off_at := pg_catalog.clock_timestamp();
  IF canonical_payload THEN
    UPDATE content.media_blob_writer_attempts AS attempts
    SET
      state = 'expired',
      outcome = 'stale_attempt',
      terminal_at = handed_off_at,
      reconciliation_state = 'pending',
      reconciliation_retry_count = 0,
      reconciliation_next_attempt_at = handed_off_at,
      reconciliation_lease_token = NULL,
      reconciliation_lease_owner = NULL,
      reconciliation_lease_expires_at = NULL,
      reconciliation_last_error_code = NULL,
      reconciliation_last_error_message = NULL,
      reconciliation_handed_off_at = handed_off_at,
      reconciliation_updated_at = handed_off_at,
      reconciliation_applied_at = NULL
    WHERE attempts.attempt_token = p_attempt_token
      AND attempts.state = 'leased'
      AND attempts.reconciliation_state IS NULL;
  ELSE
    UPDATE content.media_blob_writer_attempts AS attempts
    SET
      state = 'expired',
      outcome = 'stale_attempt',
      terminal_at = handed_off_at,
      reconciliation_state = 'leased',
      reconciliation_retry_count = 0,
      reconciliation_next_attempt_at = handed_off_at,
      reconciliation_lease_token = public.gen_random_uuid(),
      reconciliation_lease_owner = 'legacy-invalid-payload',
      reconciliation_lease_expires_at =
        handed_off_at + interval '1 microsecond',
      reconciliation_last_error_code =
        'INVALID_RECONCILIATION_PAYLOAD',
      reconciliation_last_error_message =
        'Durable multipart completion payload is invalid.',
      reconciliation_handed_off_at = handed_off_at,
      reconciliation_updated_at = handed_off_at,
      reconciliation_applied_at = NULL
    WHERE attempts.attempt_token = p_attempt_token
      AND attempts.state = 'leased'
      AND attempts.reconciliation_state IS NULL;
  END IF;
  IF NOT FOUND THEN
    RETURN 'stale_attempt';
  END IF;

  RETURN 'handed_off';
END;
$$;

CREATE OR REPLACE FUNCTION content.handoff_media_upload_session_completion_attempt(
  p_attempt_token UUID,
  p_reservation_token UUID,
  p_payload content.multipart_media_blob_writer_attempt_payload
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  canonical_owner TEXT;
  attempt content.media_blob_writer_attempts%ROWTYPE;
  creation_claim_expires_at TIMESTAMPTZ;
  identity_status TEXT;
BEGIN
  IF p_attempt_token IS NULL
    OR p_reservation_token IS NULL
    OR content.multipart_media_blob_writer_attempt_payload_valid_internal(
      p_payload
    ) IS DISTINCT FROM true
  THEN
    RETURN 'stale_attempt';
  END IF;

  SELECT attempts.*
  INTO attempt
  FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.attempt_token = p_attempt_token;
  identity_status :=
    content.multipart_media_blob_writer_attempt_identity_status_internal(
      attempt,
      p_reservation_token,
      p_payload
    );
  IF identity_status <> 'ready' THEN
    RETURN identity_status;
  END IF;

  canonical_owner := auth.canonical_account_id(p_payload.user_id);
  PERFORM auth.assert_account_write_scope(canonical_owner);

  IF security.current_user_id() IS DISTINCT FROM canonical_owner
    OR security.current_workspace_id() IS DISTINCT FROM p_payload.workspace_id
  THEN
    RETURN 'access_denied';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      canonical_owner || ':' || p_payload.workspace_id::TEXT,
      0::BIGINT
    )
  );

  PERFORM auth.assert_account_write_scope(canonical_owner);
  IF auth.canonical_account_id(p_payload.user_id) IS DISTINCT FROM canonical_owner THEN
    RAISE EXCEPTION 'Multipart handoff account scope changed; reload and retry'
      USING ERRCODE = 'P0A01';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM org.workspace_memberships AS memberships
    WHERE memberships.workspace_id = p_payload.workspace_id
      AND memberships.user_id = canonical_owner
  ) THEN
    RETURN 'access_denied';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM sync.workspace_replicas AS replicas
    WHERE replicas.replica_id = p_payload.replica_id
      AND replicas.workspace_id = p_payload.workspace_id
      AND replicas.user_id = canonical_owner
  ) THEN
    RETURN 'ownership_mismatch';
  END IF;

  creation_claim_expires_at :=
    content.lock_upload_creation_claim_for_completion_internal(
      p_payload.workspace_id,
      p_payload.media_asset_id,
      p_payload.media_upload_session_id
    );
  IF creation_claim_expires_at IS NULL THEN
    RETURN content.handoff_media_upload_session_completion_attempt_0099_internal(
      p_attempt_token,
      p_reservation_token,
      p_payload
    );
  END IF;

  SELECT attempts.*
  INTO attempt
  FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.attempt_token = p_attempt_token
  FOR UPDATE;

  identity_status :=
    content.multipart_media_blob_writer_attempt_identity_status_internal(
      attempt,
      p_reservation_token,
      p_payload
    );
  IF identity_status <> 'ready' THEN
    RETURN identity_status;
  END IF;

  PERFORM auth.assert_account_write_scope(canonical_owner);
  IF auth.canonical_account_id(p_payload.user_id) IS DISTINCT FROM canonical_owner THEN
    RAISE EXCEPTION 'Multipart handoff account scope changed; reload and retry'
      USING ERRCODE = 'P0A01';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM org.workspace_memberships AS memberships
    WHERE memberships.workspace_id = p_payload.workspace_id
      AND memberships.user_id = canonical_owner
  ) THEN
    RETURN 'access_denied';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM sync.workspace_replicas AS replicas
    WHERE replicas.replica_id = p_payload.replica_id
      AND replicas.workspace_id = p_payload.workspace_id
      AND replicas.user_id = canonical_owner
  ) THEN
    RETURN 'ownership_mismatch';
  END IF;

  IF attempt.reconciliation_state IN ('pending', 'leased') THEN
    RETURN 'already_pending';
  ELSIF attempt.reconciliation_state = 'applied' THEN
    RETURN 'already_applied';
  ELSIF attempt.reconciliation_state = 'failed' THEN
    RETURN 'failed';
  ELSIF attempt.state <> 'leased' THEN
    RETURN COALESCE(attempt.outcome, 'stale_attempt');
  END IF;

  RETURN 'stale_attempt';
END;
$$;
