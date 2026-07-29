-- Current additive migration for multipart replacement-creation claims.
-- Schemas touched/read explicitly: content, org, sync, security.

CREATE TABLE content.media_upload_session_creation_claims (
  claim_token UUID PRIMARY KEY,
  workspace_id UUID NOT NULL
    REFERENCES org.workspaces(workspace_id)
    ON DELETE CASCADE,
  media_asset_id UUID NOT NULL,
  claimed_by_user_id TEXT NOT NULL,
  claimed_by_replica_id UUID NOT NULL
    REFERENCES sync.workspace_replicas(replica_id)
    ON DELETE CASCADE,
  state TEXT NOT NULL,
  lease_expires_at TIMESTAMPTZ,
  media_upload_session_id UUID UNIQUE
    REFERENCES content.media_upload_sessions(media_upload_session_id)
    ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  finalized_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  CONSTRAINT media_upload_session_creation_claims_user_safe
    CHECK (
      claimed_by_user_id = pg_catalog.btrim(claimed_by_user_id)
      AND claimed_by_user_id <> ''
      AND pg_catalog.char_length(claimed_by_user_id) <= 200
      AND claimed_by_user_id !~ '[[:cntrl:]]'
    ),
  CONSTRAINT media_upload_session_creation_claims_state
    CHECK (state IN ('leased', 'finalized', 'released')),
  CONSTRAINT media_upload_session_creation_claims_timestamps
    CHECK (
      updated_at >= created_at
      AND (
        (
          state = 'leased'
          AND lease_expires_at IS NOT NULL
          AND lease_expires_at > updated_at
          AND media_upload_session_id IS NULL
          AND finalized_at IS NULL
          AND released_at IS NULL
        )
        OR (
          state = 'finalized'
          AND lease_expires_at IS NULL
          AND media_upload_session_id IS NOT NULL
          AND finalized_at = updated_at
          AND released_at IS NULL
        )
        OR (
          state = 'released'
          AND lease_expires_at IS NULL
          AND media_upload_session_id IS NULL
          AND finalized_at IS NULL
          AND released_at = updated_at
        )
      )
    )
);

CREATE UNIQUE INDEX media_upload_session_creation_claims_leased_asset
  ON content.media_upload_session_creation_claims (
    workspace_id,
    media_asset_id
  )
  WHERE state = 'leased';

CREATE INDEX media_upload_session_creation_claims_asset_history
  ON content.media_upload_session_creation_claims (
    workspace_id,
    media_asset_id,
    created_at,
    claim_token
  );

COMMENT ON TABLE content.media_upload_session_creation_claims IS
  'Exact leased ownership for creating one replacement multipart upload, retained after finalization for retry fencing.';
COMMENT ON COLUMN
  content.media_upload_session_creation_claims.claim_token IS
  'Caller-generated exact fencing identity for acquire, finalize, and release retries.';
COMMENT ON COLUMN
  content.media_upload_session_creation_claims.media_upload_session_id IS
  'Replacement session persisted atomically with finalization; its nonterminal state continues to fence older completion.';

ALTER TABLE content.media_upload_session_creation_claims
  ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION content.acquire_media_upload_session_creation_claim_with_owner(
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

  IF security.current_user_id() IS DISTINCT FROM p_user_id
    OR security.current_workspace_id() IS DISTINCT FROM p_workspace_id
  THEN
    RETURN QUERY
    SELECT 'access_denied'::TEXT, NULL::TIMESTAMPTZ, NULL::UUID;
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_user_id || ':' || p_workspace_id::TEXT,
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

  IF NOT EXISTS (
    SELECT 1
    FROM org.workspace_memberships AS memberships
    WHERE memberships.workspace_id = p_workspace_id
      AND memberships.user_id = p_user_id
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
      AND replicas.user_id = p_user_id
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
  IF FOUND THEN
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

CREATE FUNCTION content.finalize_media_upload_session_creation_claim_with_owner(
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
  IF security.current_user_id() IS DISTINCT FROM p_user_id
    OR security.current_workspace_id() IS DISTINCT FROM p_workspace_id
  THEN
    RETURN 'access_denied';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_user_id || ':' || p_workspace_id::TEXT,
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

  IF NOT EXISTS (
    SELECT 1
    FROM org.workspace_memberships AS memberships
    WHERE memberships.workspace_id = p_workspace_id
      AND memberships.user_id = p_user_id
  ) THEN
    RETURN 'access_denied';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM sync.workspace_replicas AS replicas
    WHERE replicas.replica_id = p_replica_id
      AND replicas.workspace_id = p_workspace_id
      AND replicas.user_id = p_user_id
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
  IF NOT FOUND THEN
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
  IF NOT FOUND THEN
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

CREATE FUNCTION content.release_media_upload_session_creation_claim_with_owner(
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
  IF security.current_user_id() IS DISTINCT FROM p_user_id
    OR security.current_workspace_id() IS DISTINCT FROM p_workspace_id
  THEN
    RETURN 'access_denied';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_user_id || ':' || p_workspace_id::TEXT,
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

  IF NOT EXISTS (
    SELECT 1
    FROM org.workspace_memberships AS memberships
    WHERE memberships.workspace_id = p_workspace_id
      AND memberships.user_id = p_user_id
  ) THEN
    RETURN 'access_denied';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM sync.workspace_replicas AS replicas
    WHERE replicas.replica_id = p_replica_id
      AND replicas.workspace_id = p_workspace_id
      AND replicas.user_id = p_user_id
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
  IF NOT FOUND THEN
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

CREATE FUNCTION content.lock_upload_creation_claim_for_completion_internal(
  p_workspace_id UUID,
  p_media_asset_id UUID,
  p_media_upload_session_id UUID
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  locked_at TIMESTAMPTZ;
  blocking_expires_at TIMESTAMPTZ;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'multipart-asset:'
        || p_workspace_id::TEXT
        || ':'
        || p_media_asset_id::TEXT,
      4::BIGINT
    )
  );
  locked_at := pg_catalog.clock_timestamp();

  SELECT
    CASE
      WHEN claims.state = 'leased' THEN claims.lease_expires_at
      ELSE sessions.expires_at
    END
  INTO blocking_expires_at
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
        AND claims.media_upload_session_id IS DISTINCT FROM p_media_upload_session_id
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
  RETURN blocking_expires_at;
END;
$$;

ALTER FUNCTION content.handoff_media_upload_session_completion_attempt(
  UUID,
  UUID,
  content.multipart_media_blob_writer_attempt_payload
)
  RENAME TO handoff_media_upload_session_completion_attempt_0099_internal;

REVOKE ALL ON FUNCTION
  content.handoff_media_upload_session_completion_attempt_0099_internal(
    UUID,
    UUID,
    content.multipart_media_blob_writer_attempt_payload
  )
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;

CREATE FUNCTION content.handoff_media_upload_session_completion_attempt(
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

  IF security.current_user_id() IS DISTINCT FROM p_payload.user_id
    OR security.current_workspace_id() IS DISTINCT FROM p_payload.workspace_id
  THEN
    RETURN 'access_denied';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_payload.user_id || ':' || p_payload.workspace_id::TEXT,
      0::BIGINT
    )
  );
  IF NOT EXISTS (
    SELECT 1
    FROM org.workspace_memberships AS memberships
    WHERE memberships.workspace_id = p_payload.workspace_id
      AND memberships.user_id = p_payload.user_id
  ) THEN
    RETURN 'access_denied';
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

ALTER FUNCTION
  content.begin_media_upload_session_completion_attempt_with_owner(
    UUID,
    INTEGER,
    content.multipart_media_blob_writer_attempt_payload
  )
  RENAME TO begin_media_upload_session_completion_attempt_0099_internal;

REVOKE ALL ON FUNCTION
  content.begin_media_upload_session_completion_attempt_0099_internal(
    UUID,
    INTEGER,
    content.multipart_media_blob_writer_attempt_payload
  )
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;

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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  creation_claim_expires_at TIMESTAMPTZ;
  existing_attempt content.media_blob_writer_attempts%ROWTYPE;
  fence_status TEXT;
BEGIN
  IF p_attempt_token IS NULL
    OR p_lease_duration_ms IS NULL
    OR p_lease_duration_ms NOT BETWEEN 1 AND 3600000
    OR content.multipart_media_blob_writer_attempt_payload_valid_internal(
      p_payload
    ) IS DISTINCT FROM true
  THEN
    RETURN QUERY
    SELECT
      'stale'::TEXT,
      NULL::UUID,
      NULL::TEXT,
      NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF security.current_user_id() IS DISTINCT FROM p_payload.user_id
    OR security.current_workspace_id() IS DISTINCT FROM p_payload.workspace_id
  THEN
    RETURN QUERY
    SELECT
      'access_denied'::TEXT,
      NULL::UUID,
      NULL::TEXT,
      NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  SELECT attempts.*
  INTO existing_attempt
  FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.attempt_token = p_attempt_token
    AND attempts.state <> 'leased'
    AND attempts.reconciliation_state IS DISTINCT FROM 'pending'
    AND attempts.reconciliation_state IS DISTINCT FROM 'leased'
  FOR UPDATE;

  IF FOUND THEN
    IF existing_attempt.user_id IS DISTINCT FROM security.current_user_id()
      OR existing_attempt.workspace_id IS DISTINCT FROM
        security.current_workspace_id()
    THEN
      RETURN QUERY
      SELECT
        'access_denied'::TEXT,
        NULL::UUID,
        NULL::TEXT,
        NULL::TIMESTAMPTZ;
      RETURN;
    END IF;

    fence_status :=
      content.multipart_media_blob_writer_terminal_replay_status_internal(
        existing_attempt,
        p_payload
      );
    IF fence_status <> 'ready' THEN
      RETURN QUERY
      SELECT
        fence_status,
        NULL::UUID,
        NULL::TEXT,
        NULL::TIMESTAMPTZ;
      RETURN;
    END IF;

    RETURN QUERY
    SELECT
      existing_attempt.outcome,
      NULL::UUID,
      NULL::TEXT,
      NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_payload.user_id || ':' || p_payload.workspace_id::TEXT,
      0::BIGINT
    )
  );
  creation_claim_expires_at :=
    content.lock_upload_creation_claim_for_completion_internal(
      p_payload.workspace_id,
      p_payload.media_asset_id,
      p_payload.media_upload_session_id
  );
  IF creation_claim_expires_at IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM org.workspace_memberships AS memberships
      WHERE memberships.workspace_id = p_payload.workspace_id
        AND memberships.user_id = p_payload.user_id
    ) THEN
      RETURN QUERY
      SELECT
        'access_denied'::TEXT,
        NULL::UUID,
        NULL::TEXT,
        NULL::TIMESTAMPTZ;
      RETURN;
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM sync.workspace_replicas AS replicas
      WHERE replicas.replica_id = p_payload.replica_id
        AND replicas.workspace_id = p_payload.workspace_id
        AND replicas.user_id = p_payload.user_id
    ) THEN
      RETURN QUERY
      SELECT
        'replica_mismatch'::TEXT,
        NULL::UUID,
        NULL::TEXT,
        NULL::TIMESTAMPTZ;
      RETURN;
    END IF;
    RETURN QUERY
    SELECT
      'busy'::TEXT,
      NULL::UUID,
      NULL::TEXT,
      creation_claim_expires_at;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT *
  FROM content.begin_media_upload_session_completion_attempt_0099_internal(
    p_attempt_token,
    p_lease_duration_ms,
    p_payload
  );
END;
$$;

COMMENT ON FUNCTION
  content.acquire_media_upload_session_creation_claim_with_owner(
    TEXT,
    UUID,
    UUID,
    UUID,
    UUID,
    INTEGER
  ) IS
  'Acquires one exact leased replacement-creation claim unless completion or another nonterminal replacement already owns the media asset.';
COMMENT ON FUNCTION
  content.finalize_media_upload_session_creation_claim_with_owner(
    TEXT,
    UUID,
    UUID,
    UUID,
    UUID,
    UUID
  ) IS
  'Finalizes the exact live claim only after its matching active replacement upload session exists in the same transaction.';
COMMENT ON FUNCTION
  content.release_media_upload_session_creation_claim_with_owner(
    TEXT,
    UUID,
    UUID,
    UUID,
    UUID
  ) IS
  'Releases the exact pre-persistence claim and safely replays finalized or released outcomes.';
COMMENT ON FUNCTION
  content.handoff_media_upload_session_completion_attempt(
    UUID,
    UUID,
    content.multipart_media_blob_writer_attempt_payload
  ) IS
  'Hands off exact multipart completion unless a live replacement-creation claim owns the media asset.';

REVOKE ALL ON TABLE content.media_upload_session_creation_claims
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION
  content.acquire_media_upload_session_creation_claim_with_owner(
    TEXT,
    UUID,
    UUID,
    UUID,
    UUID,
    INTEGER
  )
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION
  content.finalize_media_upload_session_creation_claim_with_owner(
    TEXT,
    UUID,
    UUID,
    UUID,
    UUID,
    UUID
  )
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION
  content.release_media_upload_session_creation_claim_with_owner(
    TEXT,
    UUID,
    UUID,
    UUID,
    UUID
  )
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION
  content.lock_upload_creation_claim_for_completion_internal(UUID, UUID, UUID)
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION
  content.handoff_media_upload_session_completion_attempt(
    UUID,
    UUID,
    content.multipart_media_blob_writer_attempt_payload
  )
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION
  content.begin_media_upload_session_completion_attempt_with_owner(
    UUID,
    INTEGER,
    content.multipart_media_blob_writer_attempt_payload
  )
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;

GRANT EXECUTE ON FUNCTION
  content.acquire_media_upload_session_creation_claim_with_owner(
    TEXT,
    UUID,
    UUID,
    UUID,
    UUID,
    INTEGER
  )
  TO backend_app;
GRANT EXECUTE ON FUNCTION
  content.finalize_media_upload_session_creation_claim_with_owner(
    TEXT,
    UUID,
    UUID,
    UUID,
    UUID,
    UUID
  )
  TO backend_app;
GRANT EXECUTE ON FUNCTION
  content.release_media_upload_session_creation_claim_with_owner(
    TEXT,
    UUID,
    UUID,
    UUID,
    UUID
  )
  TO backend_app;
GRANT EXECUTE ON FUNCTION
  content.handoff_media_upload_session_completion_attempt(
    UUID,
    UUID,
    content.multipart_media_blob_writer_attempt_payload
  )
  TO backend_app;
GRANT EXECUTE ON FUNCTION
  content.begin_media_upload_session_completion_attempt_with_owner(
    UUID,
    INTEGER,
    content.multipart_media_blob_writer_attempt_payload
  )
  TO backend_app;
