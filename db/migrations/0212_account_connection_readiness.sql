-- Schemas touched/read explicitly: auth, org, content, ai, catalog, sync, pg_catalog.
ALTER TABLE auth.account_connection_proofs
  ADD COLUMN operation_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  ADD COLUMN retain_until TIMESTAMPTZ NOT NULL DEFAULT (clock_timestamp()+INTERVAL '24 hours'),
  ADD CONSTRAINT connection_terminal_secret CHECK (state NOT IN ('committed','cancelled') OR challenge_ciphertext IS NULL);

CREATE INDEX ON auth.account_connection_proofs(retain_until);
CREATE INDEX ON auth.account_connection_proofs(expires_at);

CREATE TABLE auth.account_connection_suggestions (
  suggestion_sha256 TEXT PRIMARY KEY CHECK (suggestion_sha256 ~ '^[0-9a-f]{64}$'),
  attempt_sha256 TEXT NOT NULL UNIQUE,
  provider_proof JSONB NOT NULL,
  source_session JSONB NOT NULL,
  mailbox_session JSONB NOT NULL,
  binding_sha256 TEXT NOT NULL,
  client_type TEXT NOT NULL,
  origin TEXT,
  verified_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  CHECK (source_session->>'account' <> mailbox_session->>'account'),
  CHECK ((client_type = 'web') = (origin IS NOT NULL))
);
CREATE INDEX ON auth.account_connection_suggestions(expires_at);
REVOKE ALL ON auth.account_connection_suggestions FROM PUBLIC,auth_app,backend_app,reporting_readonly;

-- Only the trusted completion module supplies the provider-authoritative mailbox principal.
CREATE FUNCTION auth.capture_account_connection_suggestion(
  suggestion TEXT, attempt_hash TEXT, claim UUID, mailbox_subject TEXT, mailbox_username TEXT, mailbox_email TEXT
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE attempt auth.social_attempts%ROWTYPE; source JSONB; mailbox JSONB; expiry TIMESTAMPTZ;
BEGIN
  SELECT * INTO attempt FROM auth.social_attempts WHERE attempt_sha256 = attempt_hash;
  source := auth.connection_principal_snapshot(attempt.snapshot_subject,NULL);
  mailbox := auth.connection_principal_snapshot(mailbox_subject,mailbox_email);
  -- Missing established/enrolled authority is an unavailable suggestion, not a failed normal login.
  IF source IS NULL OR mailbox IS NULL OR source->>'account' = mailbox->>'account'
    OR mailbox->>'username' IS DISTINCT FROM mailbox_username OR mailbox->>'enrolledAt' IS NULL
    OR mailbox_email IS NULL OR mailbox_email <> lower(btrim(mailbox_email))
    OR mailbox_email ~ '@(privaterelay\.appleid\.com|private\.icloud\.com)$'
    OR attempt.snapshot_method_activated_at IS NULL OR attempt.verified_at IS NULL
    OR attempt.verified_at <= clock_timestamp()-INTERVAL '120 seconds'
    OR attempt.reconnect_disabled_at IS NOT NULL OR attempt.reenable_disabled_at IS NOT NULL THEN RETURN NULL; END IF;
  PERFORM auth.lock_connection_principals(ARRAY[attempt.snapshot_subject,mailbox_subject]);
  PERFORM auth.assert_social_attempt_live(attempt);
  IF auth.principal_session_status(attempt.snapshot_subject,floor(extract(epoch FROM attempt.verified_at))::BIGINT) <> 'valid'
    OR auth.principal_session_status(mailbox_subject,(mailbox->>'minimumAuthTime')::BIGINT) <> 'valid' THEN RETURN NULL; END IF;
  SELECT * INTO attempt FROM auth.social_attempts WHERE attempt_sha256 = attempt_hash FOR UPDATE;
  IF attempt.claim_id IS DISTINCT FROM claim OR claim IS NULL OR attempt.purpose <> 'login'
    OR attempt.phase <> 'provider_enrolling' OR attempt.current_subject IS NOT NULL
    OR attempt.expires_at <= clock_timestamp() OR attempt.verified_at > clock_timestamp()+INTERVAL '30 seconds'
    OR source IS DISTINCT FROM auth.connection_principal_snapshot(attempt.snapshot_subject,NULL)
    OR mailbox IS DISTINCT FROM auth.connection_principal_snapshot(mailbox_subject,mailbox_email) THEN
    RAISE EXCEPTION 'Trusted collision login changed before capture' USING ERRCODE = '23514';
  END IF;
  PERFORM auth.assert_unreserved_auth_attempt(attempt_hash);
  expiry := LEAST(attempt.verified_at+INTERVAL '120 seconds',attempt.expires_at);
  INSERT INTO auth.account_connection_suggestions VALUES(suggestion,attempt_hash,
    to_jsonb(attempt)-'secret_ciphertext'-'result_ciphertext',source,mailbox,
    attempt.binding_sha256,attempt.client_type,attempt.origin,attempt.verified_at,expiry);
  RETURN expiry;
END;
$$;
REVOKE ALL ON FUNCTION auth.capture_account_connection_suggestion(TEXT,TEXT,UUID,TEXT,TEXT,TEXT) FROM PUBLIC,backend_app;
GRANT EXECUTE ON FUNCTION auth.capture_account_connection_suggestion(TEXT,TEXT,UUID,TEXT,TEXT,TEXT) TO auth_app;

CREATE FUNCTION auth.adopt_account_connection_suggestion(
  operation TEXT, subject TEXT, username TEXT, original_auth_time BIGINT, binding TEXT, client TEXT, origin TEXT,
  suggestion TEXT, capability TEXT
) RETURNS SETOF auth.account_connection_proofs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE saved auth.account_connection_suggestions%ROWTYPE; proof auth.social_attempts%ROWTYPE;
  receipt auth.account_connection_proofs%ROWTYPE;
BEGIN
  SELECT * INTO saved FROM auth.account_connection_suggestions WHERE suggestion_sha256 = suggestion;
  IF NOT FOUND THEN RAISE EXCEPTION 'Connection suggestion expired or already adopted' USING ERRCODE = '23514'; END IF;
  PERFORM auth.lock_connection_principals(ARRAY[saved.source_session->>'subject',saved.mailbox_session->>'subject']);
  proof := jsonb_populate_record(NULL::auth.social_attempts,saved.provider_proof);
  PERFORM auth.assert_social_attempt_live(proof);
  SELECT * INTO proof FROM auth.social_attempts WHERE attempt_sha256 = saved.attempt_sha256 FOR UPDATE;
  SELECT * INTO saved FROM auth.account_connection_suggestions WHERE suggestion_sha256 = suggestion FOR UPDATE;
  IF NOT FOUND OR proof.attempt_sha256 IS NULL OR proof.phase IS DISTINCT FROM 'redeemed' OR proof.purpose <> 'login'
    OR proof.proved_subject IS DISTINCT FROM subject OR proof.proved_username IS DISTINCT FROM username
    OR proof.verified_at IS DISTINCT FROM saved.verified_at OR proof.expires_at <= clock_timestamp()
    OR capability IS DISTINCT FROM 'canonical-account-v1' OR saved.expires_at <= clock_timestamp()
    OR saved.source_session->>'subject' IS DISTINCT FROM subject OR saved.source_session->>'username' IS DISTINCT FROM username
    OR saved.binding_sha256 IS DISTINCT FROM binding OR saved.client_type IS DISTINCT FROM client
    OR saved.origin IS DISTINCT FROM origin OR auth.principal_session_status(subject,original_auth_time) <> 'valid'
    OR saved.source_session IS DISTINCT FROM auth.connection_principal_snapshot(subject,NULL)
    OR saved.mailbox_session IS DISTINCT FROM auth.connection_principal_snapshot(
      saved.mailbox_session->>'subject',saved.mailbox_session->>'email')
    OR auth.principal_session_status(subject,floor(extract(epoch FROM saved.verified_at))::BIGINT) <> 'valid'
    OR auth.principal_session_status(saved.mailbox_session->>'subject',
      (saved.mailbox_session->>'minimumAuthTime')::BIGINT) <> 'valid' THEN
    RAISE EXCEPTION 'Connection suggestion requires its original fresh principal and transport' USING ERRCODE = '23514';
  END IF;
  PERFORM auth.assert_social_attempt_live(proof);
  PERFORM auth.assert_unreserved_auth_attempt(proof.attempt_sha256);
  INSERT INTO auth.account_connection_proofs(operation_sha256,source_subject,source_username,source_auth_time,source_session,
    source_account,source_attempt_sha256,source_proof,binding_sha256,client_type,origin,capability,state,
    target_account,target_subject,target_username,target_email,target_session,provider_session,provider_snapshot,
    target_verified_at,target_expires_at,expires_at)
  VALUES(operation,subject,username,original_auth_time,saved.source_session,saved.source_session->>'account',
    proof.attempt_sha256,to_jsonb(proof)-'secret_ciphertext'-'result_ciphertext',binding,client,origin,capability,'proved',
    saved.mailbox_session->>'account',saved.mailbox_session->>'subject',saved.mailbox_session->>'username',
    saved.mailbox_session->>'email',saved.mailbox_session,saved.source_session,
    saved.provider_proof,saved.verified_at,saved.expires_at,saved.expires_at) RETURNING * INTO receipt;
  DELETE FROM auth.account_connection_suggestions WHERE suggestion_sha256 = suggestion;
  RETURN NEXT receipt;
END;
$$;
REVOKE ALL ON FUNCTION auth.adopt_account_connection_suggestion(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT)
FROM PUBLIC,auth_app,backend_app,reporting_readonly;

CREATE OR REPLACE FUNCTION auth.guard_connection_receipt_binding() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF ROW(NEW.operation_id,NEW.retain_until,NEW.operation_sha256,NEW.source_subject,NEW.source_username,NEW.source_auth_time,NEW.source_session,
      NEW.source_account,NEW.source_attempt_sha256,NEW.source_proof,NEW.binding_sha256,NEW.client_type,NEW.origin,NEW.capability,NEW.created_at,NEW.expires_at)
    IS DISTINCT FROM ROW(OLD.operation_id,OLD.retain_until,OLD.operation_sha256,OLD.source_subject,OLD.source_username,OLD.source_auth_time,OLD.source_session,
      OLD.source_account,OLD.source_attempt_sha256,OLD.source_proof,OLD.binding_sha256,OLD.client_type,OLD.origin,OLD.capability,OLD.created_at,OLD.expires_at)
    OR OLD.target_account IS NOT NULL AND NEW.target_account IS DISTINCT FROM OLD.target_account
    OR OLD.target_attempt_sha256 IS NOT NULL AND NEW.target_attempt_sha256 IS DISTINCT FROM OLD.target_attempt_sha256
    OR OLD.target_subject IS NOT NULL AND ROW(NEW.target_subject,NEW.target_username,NEW.target_email,NEW.target_session)
      IS DISTINCT FROM ROW(OLD.target_subject,OLD.target_username,OLD.target_email,OLD.target_session)
    OR OLD.target_verified_at IS NOT NULL AND ROW(NEW.target_verified_at,NEW.target_expires_at,NEW.target_auth_time,NEW.provider_session,NEW.provider_snapshot)
      IS DISTINCT FROM ROW(OLD.target_verified_at,OLD.target_expires_at,OLD.target_auth_time,OLD.provider_session,OLD.provider_snapshot)
    OR OLD.state IN ('committed','cancelled') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Connection proof binding is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION auth.guard_connection_receipt_binding() FROM PUBLIC,auth_app,backend_app;

-- Durable baselines have no receipt FK: transient proof retention cannot reveal omitted workspaces.
CREATE TABLE org.workspace_starter_baselines (
  workspace_id UUID PRIMARY KEY REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE,
  operation_id UUID NOT NULL,
  baseline JSONB NOT NULL CHECK (jsonb_typeof(baseline) = 'object')
);
REVOKE ALL ON org.workspace_starter_baselines FROM PUBLIC,auth_app,backend_app,reporting_readonly;

-- Membership identity and the visibility marker change during union; meaningful roots do not.
CREATE FUNCTION org.workspace_starter_baseline(target_workspace_id UUID) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT jsonb_build_object('workspace',encode(sha256(convert_to((to_jsonb(w)-'starter_suppressed_at')::TEXT,'UTF8')),'hex'),
    'cards',encode(sha256(convert_to(COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY card_id) FROM content.cards c
      WHERE c.workspace_id=w.workspace_id),'[]'::JSONB)::TEXT,'UTF8')),'hex'))
  FROM org.workspaces w WHERE w.workspace_id=target_workspace_id
    AND (SELECT count(*) FROM content.cards WHERE workspace_id=target_workspace_id) <= 1;
$$;
REVOKE ALL ON FUNCTION org.workspace_starter_baseline(UUID) FROM PUBLIC,auth_app,backend_app,reporting_readonly;

CREATE FUNCTION org.workspace_is_unused_starter(target_workspace_id UUID, historical_baseline JSONB) RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM org.workspaces AS workspace
    WHERE workspace.workspace_id = target_workspace_id
      AND (workspace.creation_origin = 'automatic_starter'
        OR workspace.creation_origin = 'unknown' AND historical_baseline IS NOT NULL
          AND historical_baseline = org.workspace_starter_baseline(target_workspace_id))
      AND workspace.name = 'Personal'
      AND workspace.fsrs_algorithm = 'fsrs-6'
      AND workspace.fsrs_desired_retention = 0.9
      AND workspace.fsrs_learning_steps_minutes = '[1,10]'::jsonb
      AND workspace.fsrs_relearning_steps_minutes = '[10]'::jsonb
      AND workspace.fsrs_maximum_interval_days = 36500
      AND workspace.fsrs_enable_fuzz = true
      AND (SELECT count(*) FROM org.workspace_memberships WHERE workspace_id = target_workspace_id) = 1
      AND EXISTS (SELECT 1 FROM org.workspace_memberships
        WHERE workspace_id = target_workspace_id AND role = 'owner')
      AND (SELECT count(*) FROM content.cards WHERE workspace_id = target_workspace_id) <= 1
      AND NOT EXISTS (
        SELECT 1 FROM content.cards AS card
        WHERE card.workspace_id = target_workspace_id AND NOT COALESCE(
          card.deleted_at IS NULL
          AND card.card_type = 'basic'
          AND card.front_text <> ''
          AND (workspace.creation_origin = 'unknown' OR (
            card.metadata->'version' = '1'::jsonb
          AND CASE WHEN jsonb_typeof(card.metadata) = 'object' THEN
            card.metadata - ARRAY['version', 'source', 'onboardingDemo'] END = '{}'::jsonb
          AND (card.metadata->'source' = 'null'::jsonb OR card.metadata->'source' = jsonb_build_object(
            'label', NULL, 'author', NULL, 'comment', NULL, 'importedAt', NULL, 'importId', NULL,
            'createdAt', to_char(date_trunc('milliseconds', card.created_at AT TIME ZONE 'UTC'),
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
          AND jsonb_typeof(card.metadata->'onboardingDemo') = 'object'
          AND card.metadata->'onboardingDemo'->'version' = '1'::jsonb
          AND CASE WHEN jsonb_typeof(card.metadata->'onboardingDemo') = 'object' THEN
            (card.metadata->'onboardingDemo') - ARRAY[
              'version', 'frontText', 'backText', 'tags', 'cardType', 'wasEdited'] END = '{}'::jsonb
          AND (NOT (card.metadata->'onboardingDemo' ? 'wasEdited')
            OR card.metadata->'onboardingDemo'->'wasEdited' = 'false'::jsonb)
          AND card.metadata->'onboardingDemo'->'frontText' = to_jsonb(card.front_text)
          AND card.metadata->'onboardingDemo'->'backText' = to_jsonb(card.back_text)
          AND card.metadata->'onboardingDemo'->'cardType' = to_jsonb(card.card_type)
          AND card.metadata->'onboardingDemo'->'tags' = to_jsonb(ARRAY(
            SELECT DISTINCT tag FROM unnest(card.tags) AS tag ORDER BY tag))
          AND card.tags = ARRAY['demo']::text[]))
          AND card.due_at IS NULL AND card.reps = 0 AND card.lapses = 0
          AND card.fsrs_card_state = 'new' AND card.fsrs_step_index IS NULL
          AND card.fsrs_stability IS NULL AND card.fsrs_difficulty IS NULL
          AND card.fsrs_last_reviewed_at IS NULL AND card.fsrs_scheduled_days IS NULL,
          false)
      )
      -- Stored roots include tombstones and terminal/archived history. Replicas,
      -- bootstrap hot rows and ordinary demo-sync idempotency alone prove no adoption.
      AND NOT EXISTS (SELECT 1 FROM content.decks WHERE workspace_id = target_workspace_id)
      AND NOT EXISTS (SELECT 1 FROM content.review_events WHERE workspace_id = target_workspace_id)
      AND NOT EXISTS (SELECT 1 FROM ai.chat_sessions WHERE workspace_id = target_workspace_id)
      AND NOT EXISTS (SELECT 1 FROM content.media_assets WHERE workspace_id = target_workspace_id)
      AND NOT EXISTS (SELECT 1 FROM content.media_upload_sessions WHERE workspace_id = target_workspace_id)
      AND NOT EXISTS (SELECT 1 FROM content.media_upload_session_creation_claims WHERE workspace_id = target_workspace_id)
      AND NOT EXISTS (SELECT 1 FROM content.media_blob_writer_reservations WHERE workspace_id = target_workspace_id)
      AND NOT EXISTS (SELECT 1 FROM content.media_blob_writer_attempts WHERE workspace_id = target_workspace_id)
      AND NOT EXISTS (SELECT 1 FROM content.generated_media_promotion_jobs WHERE workspace_id = target_workspace_id)
      AND NOT EXISTS (SELECT 1 FROM catalog.package_versions WHERE source_workspace_id = target_workspace_id)
      AND NOT EXISTS (SELECT 1 FROM sync.catalog_package_install_idempotency WHERE workspace_id = target_workspace_id)
  );
$$;
REVOKE ALL ON FUNCTION org.workspace_is_unused_starter(UUID,JSONB) FROM PUBLIC, backend_app, auth_app;


CREATE OR REPLACE FUNCTION org.workspace_is_unused_starter(target_workspace_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT org.workspace_is_unused_starter(target_workspace_id,
    (SELECT baseline FROM org.workspace_starter_baselines WHERE workspace_id=target_workspace_id));
$$;
REVOKE ALL ON FUNCTION org.workspace_is_unused_starter(UUID) FROM PUBLIC,auth_app,backend_app,reporting_readonly;

CREATE FUNCTION auth.preview_account_union_with_baselines(source_user_id TEXT, target_user_id TEXT,
  row_limit INTEGER, workspace_limit INTEGER, historical_baselines JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE account_ids TEXT[] := ARRAY[source_user_id, target_user_id]; workspace_ids UUID[];
  owner_count INTEGER; fingerprint TEXT; roots JSONB; preferred UUID; suppressed UUID[];
BEGIN
  IF historical_baselines IS NULL OR jsonb_typeof(historical_baselines) <> 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(historical_baselines)) > 256 THEN
    RAISE EXCEPTION 'Bounded historical workspace baselines required' USING ERRCODE = '54000';
  END IF;
  IF row_limit IS NULL OR row_limit NOT BETWEEN 1 AND 50000
    OR workspace_limit IS NULL OR workspace_limit NOT BETWEEN 1 AND 256 THEN
    RAISE EXCEPTION 'Account union requires row budget 1..50000 and workspace budget 1..256'
      USING ERRCODE = '54000';
  END IF;
  IF source_user_id IS NULL OR target_user_id IS NULL OR source_user_id = target_user_id
    OR btrim(source_user_id) = '' OR btrim(target_user_id) = '' THEN
    RAISE EXCEPTION 'Account union requires two distinct accounts' USING ERRCODE = '23514';
  END IF;
  PERFORM auth.assert_account_live(source_user_id);
  PERFORM auth.assert_account_live(target_user_id);
  IF (SELECT count(*) FROM org.user_settings WHERE user_id = ANY(account_ids)) <> 2
    OR (SELECT count(DISTINCT user_id) FROM auth.user_identities
      WHERE user_id = ANY(account_ids) AND provider_type = 'cognito') <> 2 THEN
    RAISE EXCEPTION 'Account union requires two existing established account profiles' USING ERRCODE = '23514';
  END IF;
  SELECT ARRAY(SELECT DISTINCT workspace_id FROM org.workspace_memberships
    WHERE user_id = ANY(account_ids) ORDER BY workspace_id LIMIT workspace_limit + 1) INTO workspace_ids;
  IF cardinality(workspace_ids) NOT BETWEEN 1 AND workspace_limit THEN
    RAISE EXCEPTION 'Account union workspace inventory is empty or exceeds its budget' USING ERRCODE = '54000';
  END IF;
  WITH owner_rows AS MATERIALIZED (
    SELECT 'org.user_settings' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM org.user_settings AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'auth.account_retirements' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM auth.account_retirements AS r WHERE r.canonical_user_id = ANY(account_ids)
    UNION ALL
    SELECT 'auth.user_identities' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM auth.user_identities AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'auth.agent_api_keys' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM auth.agent_api_keys AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'auth.oauth_connections' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM auth.oauth_connections AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'auth.guest_sessions' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM auth.guest_sessions AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'org.workspace_memberships' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM org.workspace_memberships AS r WHERE r.workspace_id = ANY(workspace_ids)
    UNION ALL
    SELECT 'sync.installations' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM sync.installations AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'sync.workspace_replicas' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM sync.workspace_replicas AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'ai.chat_sessions' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM ai.chat_sessions AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'ai.chat_files' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM ai.chat_files AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'support.feedback_prompt_events' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM support.feedback_prompt_events AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'support.feedback_submissions' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM support.feedback_submissions AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'ai.consent_identities' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM ai.consent_identities AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'billing.purchases' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM billing.purchases AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'billing.grants' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM billing.grants AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'billing.stripe_customer_identities' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM billing.stripe_customer_identities AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'billing.stripe_checkout_attempts' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM billing.stripe_checkout_attempts AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'billing.history_subjects' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM billing.history_subjects AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'billing.user_billing_state' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM billing.user_billing_state AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'billing.entitlement_snapshots' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM billing.entitlement_snapshots AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'ai.usage_events' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM ai.usage_events AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'community.public_profiles' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM community.public_profiles AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'community.public_profile_aliases' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM community.public_profile_aliases AS r WHERE r.canonical_public_profile_id IN (SELECT public_profile_id FROM community.public_profiles WHERE user_id = ANY(account_ids))
    UNION ALL
    SELECT 'community.friendships' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM community.friendships AS r WHERE r.viewer_user_id = ANY(account_ids) OR r.friend_user_id = ANY(account_ids)
    UNION ALL
    SELECT 'community.friend_invitations' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM community.friend_invitations AS r WHERE r.inviter_user_id = ANY(account_ids) OR r.accepted_by_user_id = ANY(account_ids)
    UNION ALL
    SELECT 'content.review_events' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM content.review_events AS r WHERE r.reviewed_by_user_id = ANY(account_ids)
    UNION ALL
    SELECT 'community.public_review_activity_facts' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM community.public_review_activity_facts AS r WHERE r.reviewed_by_user_id = ANY(account_ids) OR r.public_profile_id IN (SELECT public_profile_id FROM community.public_profiles WHERE user_id = ANY(account_ids))
    UNION ALL
    SELECT 'progress.user_active_review_days' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM progress.user_active_review_days AS r WHERE r.reviewed_by_user_id = ANY(account_ids)
    UNION ALL
    SELECT 'community.leaderboard_snapshot_entries' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM community.leaderboard_snapshot_entries AS r WHERE r.public_profile_id IN (SELECT public_profile_id FROM community.public_profiles WHERE user_id = ANY(account_ids))
    UNION ALL
    SELECT 'community.streak_leaderboard_snapshot_entries' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM community.streak_leaderboard_snapshot_entries AS r WHERE r.public_profile_id IN (SELECT public_profile_id FROM community.public_profiles WHERE user_id = ANY(account_ids))
    LIMIT row_limit + 1
  )
  SELECT count(*)::INTEGER, encode(sha256(convert_to(COALESCE(string_agg(category || ':' || digest, ',' ORDER BY category, digest), ''), 'UTF8')), 'hex')
    INTO owner_count, fingerprint FROM owner_rows;
  IF owner_count > row_limit THEN
    RAISE EXCEPTION 'Account union owner inventory exceeds its row budget' USING ERRCODE = '54000';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('workspace', to_jsonb(workspace),
    'unusedStarter', org.workspace_is_unused_starter(workspace.workspace_id,COALESCE(historical_baselines->workspace.workspace_id::TEXT,
      (SELECT baseline FROM org.workspace_starter_baselines WHERE workspace_id=workspace.workspace_id)))) ORDER BY workspace.workspace_id)
    INTO roots FROM org.workspaces AS workspace WHERE workspace.workspace_id = ANY(workspace_ids);
  SELECT workspace.workspace_id INTO preferred FROM org.workspaces AS workspace
  WHERE workspace.workspace_id = ANY(workspace_ids)
  ORDER BY org.workspace_is_unused_starter(workspace.workspace_id,COALESCE(historical_baselines->workspace.workspace_id::TEXT,
      (SELECT baseline FROM org.workspace_starter_baselines WHERE workspace_id=workspace.workspace_id))),
    workspace.workspace_id IS DISTINCT FROM (SELECT workspace_id FROM org.user_settings WHERE user_id = target_user_id),
    workspace.workspace_id IS DISTINCT FROM (SELECT workspace_id FROM org.user_settings WHERE user_id = source_user_id),
    workspace.created_at, workspace.workspace_id LIMIT 1;
  SELECT ARRAY(SELECT workspace_id FROM org.workspaces WHERE workspace_id = ANY(workspace_ids)
    AND workspace_id <> preferred AND org.workspace_is_unused_starter(workspace_id,COALESCE(historical_baselines->workspace_id::TEXT,
      (SELECT b.baseline FROM org.workspace_starter_baselines b WHERE b.workspace_id=org.workspaces.workspace_id))) ORDER BY workspace_id)
    INTO suppressed;
  RETURN jsonb_build_object('sourceUserId', source_user_id, 'targetUserId', target_user_id,
    'rowLimit', row_limit, 'workspaceLimit', workspace_limit, 'ownerRows', owner_count,
    'fingerprint', fingerprint, 'workspaces', roots, 'workspaceIds', workspace_ids,
    'selectedWorkspaceId', preferred, 'suppressedWorkspaceIds', suppressed,
    'settingsPolicy', 'target_with_restrictive_privacy', 'publicProfilePolicy', 'target_with_restrictive_visibility');
END;
$$;
REVOKE ALL ON FUNCTION auth.preview_account_union_with_baselines(TEXT, TEXT, INTEGER, INTEGER, JSONB)
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;


CREATE OR REPLACE FUNCTION auth.preview_account_union(source_user_id TEXT, target_user_id TEXT,
  row_limit INTEGER, workspace_limit INTEGER) RETURNS JSONB
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT auth.preview_account_union_with_baselines(source_user_id,target_user_id,row_limit,workspace_limit,'{}'::JSONB);
$$;
REVOKE ALL ON FUNCTION auth.preview_account_union(TEXT,TEXT,INTEGER,INTEGER)
FROM PUBLIC,auth_app,backend_app,reporting_readonly;

-- The future consent writer activates exactly these baselines under the actual union locks,
-- before both its final preview and combine. This private preparation never activates omission.
CREATE FUNCTION auth.prepare_account_connection_choices(operation TEXT, omitted_workspaces UUID[]) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE receipt auth.account_connection_proofs%ROWTYPE; baselines JSONB := '{}'::JSONB;
  workspace UUID; baseline JSONB; preview JSONB; normalized UUID[];
BEGIN
  SELECT * INTO receipt FROM auth.account_connection_proofs WHERE operation_sha256=operation;
  IF NOT FOUND OR receipt.state <> 'proved' OR receipt.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Fresh proved pair required for choices' USING ERRCODE = '23514';
  END IF;
  IF omitted_workspaces IS NULL OR cardinality(omitted_workspaces) > 256
    OR array_position(omitted_workspaces,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'At most 256 exact workspace choices required' USING ERRCODE = '54000';
  END IF;
  SELECT ARRAY(SELECT DISTINCT unnest(omitted_workspaces) ORDER BY 1) INTO normalized;
  FOREACH workspace IN ARRAY normalized LOOP
    IF NOT EXISTS (SELECT 1 FROM org.workspace_memberships m JOIN org.workspaces w USING(workspace_id)
      WHERE m.workspace_id=workspace AND m.user_id IN (receipt.source_account,receipt.target_account)
        AND w.creation_origin='unknown') THEN
      RAISE EXCEPTION 'Historical choice must belong to the established pair' USING ERRCODE = '23514';
    END IF;
    baseline := org.workspace_starter_baseline(workspace);
    IF baseline IS NULL OR NOT org.workspace_is_unused_starter(workspace,baseline) THEN
      RAISE EXCEPTION 'Workspace has meaningful roots and cannot be omitted' USING ERRCODE = '23514';
    END IF;
    baselines := baselines || jsonb_build_object(workspace::TEXT,baseline);
  END LOOP;
  preview := auth.preview_account_union_with_baselines(receipt.target_account,receipt.source_account,50000,256,baselines);
  RETURN jsonb_build_object('operationId',receipt.operation_id,'omittedWorkspaceIds',normalized,
    'historicalBaselines',baselines,'preview',preview,
    'digest',encode(sha256(convert_to(jsonb_build_object('baselines',baselines,'preview',preview)::TEXT,'UTF8')),'hex'));
END;
$$;
REVOKE ALL ON FUNCTION auth.prepare_account_connection_choices(TEXT,UUID[])
FROM PUBLIC,auth_app,backend_app,reporting_readonly;

-- Existing attempt creation is the opportunistic cleanup entrypoint. No worker is needed.
CREATE FUNCTION auth.cleanup_account_connection_preparation() RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  UPDATE auth.social_attempts SET secret_ciphertext='erased',result_ciphertext=NULL
  WHERE attempt_sha256 IN (SELECT a.attempt_sha256 FROM auth.social_attempts a
    WHERE EXISTS (SELECT 1 FROM auth.account_connection_proofs r
      WHERE r.expires_at <= clock_timestamp()
        AND a.attempt_sha256 IN (r.source_attempt_sha256,r.target_attempt_sha256))
    ORDER BY a.expires_at,a.attempt_sha256 LIMIT 100 FOR UPDATE SKIP LOCKED);
  UPDATE auth.account_connection_proofs SET challenge_ciphertext=NULL
  WHERE operation_sha256 IN (SELECT operation_sha256 FROM auth.account_connection_proofs
    WHERE expires_at <= clock_timestamp() AND challenge_ciphertext IS NOT NULL
    ORDER BY expires_at,operation_sha256 LIMIT 100 FOR UPDATE SKIP LOCKED);
  DELETE FROM auth.account_connection_suggestions WHERE suggestion_sha256 IN (
    SELECT suggestion_sha256 FROM auth.account_connection_suggestions WHERE expires_at <= clock_timestamp()
    ORDER BY expires_at,suggestion_sha256 LIMIT 100 FOR UPDATE SKIP LOCKED);
  -- A reservation survives every referenced proof's usable lifetime, even after cancellation.
  DELETE FROM auth.account_connection_proofs WHERE operation_sha256 IN (
    SELECT r.operation_sha256 FROM auth.account_connection_proofs r
    WHERE r.retain_until <= clock_timestamp() AND r.expires_at <= clock_timestamp()
      AND COALESCE((r.source_proof->>'expires_at')::TIMESTAMPTZ,r.expires_at) <= clock_timestamp()
      AND COALESCE((r.provider_snapshot->>'expires_at')::TIMESTAMPTZ,r.expires_at) <= clock_timestamp()
      AND NOT EXISTS (SELECT 1 FROM auth.social_attempts a
        WHERE a.attempt_sha256 IN (r.source_attempt_sha256,r.target_attempt_sha256) AND a.expires_at > clock_timestamp())
    ORDER BY r.retain_until,r.operation_sha256 LIMIT 100 FOR UPDATE SKIP LOCKED);
END;
$$;
REVOKE ALL ON FUNCTION auth.cleanup_account_connection_preparation() FROM PUBLIC,auth_app,backend_app,reporting_readonly;

ALTER FUNCTION auth.create_social_attempt(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT)
RENAME TO create_social_attempt_without_connection_cleanup;
REVOKE ALL ON FUNCTION auth.create_social_attempt_without_connection_cleanup(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT)
FROM PUBLIC,auth_app,backend_app,reporting_readonly;
CREATE FUNCTION auth.create_social_attempt(
  target_hash TEXT, target_provider TEXT, target_client TEXT, target_purpose TEXT, target_binding TEXT,
  target_origin TEXT, target_redirect TEXT, target_current TEXT, target_account TEXT, target_ciphertext TEXT,
  target_reauth_hash TEXT, target_reauth_binding TEXT, target_reauth_client TEXT, target_reauth_origin TEXT
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE expiry TIMESTAMPTZ;
BEGIN
  expiry := auth.create_social_attempt_without_connection_cleanup(target_hash,target_provider,target_client,target_purpose,
    target_binding,target_origin,target_redirect,target_current,target_account,target_ciphertext,
    target_reauth_hash,target_reauth_binding,target_reauth_client,target_reauth_origin);
  PERFORM auth.cleanup_account_connection_preparation();
  RETURN expiry;
END;
$$;
REVOKE ALL ON FUNCTION auth.create_social_attempt(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT)
FROM PUBLIC,backend_app,reporting_readonly;
GRANT EXECUTE ON FUNCTION auth.create_social_attempt(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO auth_app;

ALTER FUNCTION auth.delete_user_auth_artifacts(TEXT,TEXT) RENAME TO delete_user_auth_artifacts_without_connections;
REVOKE ALL ON FUNCTION auth.delete_user_auth_artifacts_without_connections(TEXT,TEXT) FROM PUBLIC,auth_app,backend_app,reporting_readonly;
CREATE FUNCTION auth.delete_user_auth_artifacts(account_to_delete TEXT,target_email TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  DELETE FROM auth.account_connection_suggestions
    WHERE account_to_delete IN (source_session->>'account',source_session->>'originalAccount',
      mailbox_session->>'account',mailbox_session->>'originalAccount');
  DELETE FROM auth.account_connection_proofs WHERE account_to_delete IN (source_account,target_account,
    source_session->>'originalAccount',target_session->>'originalAccount',provider_session->>'originalAccount');
  DELETE FROM auth.account_union_receipts WHERE account_to_delete IN (source_user_id,target_user_id);
  -- Shared roots retain their baseline; deletion of the workspace itself cascades it.
  DELETE FROM org.workspace_starter_baselines b WHERE EXISTS (
    SELECT 1 FROM org.workspace_memberships m WHERE m.workspace_id=b.workspace_id AND m.user_id=account_to_delete)
    AND NOT EXISTS (SELECT 1 FROM org.workspace_memberships m
      WHERE m.workspace_id=b.workspace_id AND m.user_id<>account_to_delete
        AND auth.canonical_account_id(m.user_id)<>auth.canonical_account_id(account_to_delete));
  PERFORM auth.delete_user_auth_artifacts_without_connections(account_to_delete,target_email);
END;
$$;
REVOKE ALL ON FUNCTION auth.delete_user_auth_artifacts(TEXT,TEXT) FROM PUBLIC,auth_app,reporting_readonly;
GRANT EXECUTE ON FUNCTION auth.delete_user_auth_artifacts(TEXT,TEXT) TO backend_app;

CREATE OR REPLACE FUNCTION auth.replay_account_connection(
  operation TEXT, subject TEXT, username TEXT, original_auth_time BIGINT, binding TEXT, client TEXT, origin TEXT, digest TEXT
) RETURNS TABLE(consent_digest TEXT,committed_result TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.account_connection_proofs r WHERE r.operation_sha256 = operation AND r.state = 'committed' AND r.retain_until > clock_timestamp()
    AND r.source_subject = subject AND r.source_username = username AND r.source_auth_time IS NOT DISTINCT FROM original_auth_time
    AND r.binding_sha256 = binding AND r.client_type = client AND r.origin IS NOT DISTINCT FROM origin) THEN
    RETURN QUERY SELECT r.consent_digest,r.committed_result FROM auth.account_connection_proofs r
    WHERE r.operation_sha256 = operation AND r.consent_digest = digest;
    IF NOT FOUND THEN RAISE EXCEPTION 'Connection confirmation changed' USING ERRCODE = '23514'; END IF;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION auth.replay_account_connection(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, auth_app, backend_app;

