-- Schemas touched/read explicitly: auth, org, pg_catalog.
ALTER TABLE auth.account_connection_proofs ADD COLUMN terminal_outcome TEXT
  CHECK (terminal_outcome IS NULL OR terminal_outcome = 'already_connected' AND state = 'cancelled');

-- This discovery is read-only. The retirement helper must be the first lock in its caller.
CREATE FUNCTION auth.discover_connection_pair(operation TEXT, subject TEXT, username TEXT,
  original_auth_time BIGINT, binding TEXT, client TEXT, origin TEXT) RETURNS auth.account_connection_proofs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE receipt auth.account_connection_proofs%ROWTYPE; item TEXT;
BEGIN
  SELECT * INTO receipt FROM auth.account_connection_proofs WHERE operation_sha256 = operation;
  IF NOT FOUND OR receipt.source_subject IS DISTINCT FROM subject OR receipt.source_username IS DISTINCT FROM username
    OR receipt.source_auth_time IS DISTINCT FROM original_auth_time OR receipt.binding_sha256 IS DISTINCT FROM binding
    OR receipt.client_type IS DISTINCT FROM client OR receipt.origin IS DISTINCT FROM origin
    OR receipt.capability <> 'canonical-account-v1' THEN
    RAISE EXCEPTION 'Connection session or transport changed; start again' USING ERRCODE = 'P4201';
  END IF;
  IF receipt.state = 'committed' THEN RETURN receipt; END IF;
  IF receipt.state <> 'proved' OR receipt.target_account IS NULL THEN
    RAISE EXCEPTION 'Prove both existing accounts before previewing' USING ERRCODE = 'P4201';
  END IF;
  FOREACH item IN ARRAY ARRAY[receipt.source_subject,receipt.source_proof->>'proved_subject',
    receipt.target_subject,receipt.provider_session->>'subject'] LOOP
    IF item IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.user_identities
      WHERE provider_type = 'cognito' AND provider_subject = item
        AND auth.canonical_account_id(user_id) IN (receipt.source_account,receipt.target_account)) THEN
      RAISE EXCEPTION 'Connection proof no longer belongs to the exact pair' USING ERRCODE = 'P4201';
    END IF;
  END LOOP;
  RETURN receipt;
END;
$$;
REVOKE ALL ON FUNCTION auth.discover_connection_pair(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT)
FROM PUBLIC,auth_app,backend_app,reporting_readonly;

CREATE FUNCTION auth.preview_account_connection(operation TEXT, subject TEXT, username TEXT,
  original_auth_time BIGINT, binding TEXT, client TEXT, origin TEXT, omitted UUID[]) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE before_lock auth.account_connection_proofs%ROWTYPE; receipt auth.account_connection_proofs%ROWTYPE;
  choices JSONB; omission_candidates JSONB;
BEGIN
  before_lock := auth.discover_connection_pair(operation,subject,username,original_auth_time,binding,client,origin);
  PERFORM auth.lock_account_retirement(before_lock.target_account,before_lock.source_account);
  SELECT * INTO STRICT receipt FROM auth.claim_account_connection_proofs(operation,subject,username,original_auth_time,binding,client,origin);
  IF ROW(receipt.operation_id,receipt.source_account,receipt.target_account,receipt.source_proof,receipt.target_session,receipt.provider_session)
    IS DISTINCT FROM ROW(before_lock.operation_id,before_lock.source_account,before_lock.target_account,
      before_lock.source_proof,before_lock.target_session,before_lock.provider_session) THEN
    RAISE EXCEPTION 'Connection pair changed while waiting; start again' USING ERRCODE = 'P4201';
  END IF;
  PERFORM auth.load_account_connection(operation,subject,username,original_auth_time,binding,client,origin);
  choices := auth.prepare_account_connection_choices(operation,omitted);
  UPDATE auth.account_connection_proofs SET choices = preview_account_connection.choices,
    preview_digest = preview_account_connection.choices->>'digest' WHERE operation_sha256 = operation;
  -- Presentation eligibility never changes the saved choices or guarantees final suppression.
  SELECT COALESCE(jsonb_agg(root.value->'workspace'->>'workspace_id' ORDER BY root.value->'workspace'->>'workspace_id'),'[]'::JSONB)
    INTO omission_candidates
    FROM jsonb_array_elements(preview_account_connection.choices->'preview'->'workspaces') AS root(value)
    WHERE root.value->'workspace'->>'creation_origin' = 'unknown'
      AND org.workspace_is_unused_starter((root.value->'workspace'->>'workspace_id')::UUID,
        org.workspace_starter_baseline((root.value->'workspace'->>'workspace_id')::UUID));
  RETURN jsonb_build_object('choices',choices,'omissionCandidateWorkspaceIds',omission_candidates);
END;
$$;
REVOKE ALL ON FUNCTION auth.preview_account_connection(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,UUID[])
FROM PUBLIC,backend_app,reporting_readonly;
GRANT EXECUTE ON FUNCTION auth.preview_account_connection(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,UUID[]) TO auth_app;

CREATE FUNCTION auth.confirm_account_connection(operation TEXT, subject TEXT, username TEXT,
  original_auth_time BIGINT, binding TEXT, client TEXT, origin TEXT, omitted UUID[], digest TEXT, accepted BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE discovered auth.account_connection_proofs%ROWTYPE; receipt auth.account_connection_proofs%ROWTYPE;
  saved_result TEXT; actual JSONB; workspace_ids UUID[]; workspace UUID; item TEXT; entry RECORD; result JSONB; normalized UUID[];
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed'
    OR current_setting('statement_timeout')::INTERVAL NOT BETWEEN INTERVAL '1 millisecond' AND INTERVAL '15 seconds' THEN
    RAISE EXCEPTION 'Confirmation requires bounded READ COMMITTED transaction' USING ERRCODE = 'P4201';
  END IF;
  IF accepted IS DISTINCT FROM true OR digest IS NULL OR digest !~ '^[0-9a-f]{64}$'
    OR omitted IS NULL OR cardinality(omitted) > 256 OR array_position(omitted,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Explicit unchanged preview consent required' USING ERRCODE = 'P4202';
  END IF;
  SELECT ARRAY(SELECT DISTINCT unnest(omitted) ORDER BY 1) INTO normalized;
  discovered := auth.discover_connection_pair(operation,subject,username,original_auth_time,binding,client,origin);
  -- Replay authenticates the original immutable session/transport before any live proof or retirement check.
  SELECT committed_result INTO saved_result FROM auth.replay_account_connection(operation,subject,username,original_auth_time,binding,client,origin,digest);
  IF saved_result IS NOT NULL THEN
    IF discovered.choices->'omittedWorkspaceIds' IS DISTINCT FROM to_jsonb(normalized) THEN
      RAISE EXCEPTION 'Connection confirmation changed' USING ERRCODE = 'P4202';
    END IF;
    RETURN saved_result::JSONB;
  END IF;
  IF discovered.state = 'committed' THEN RAISE EXCEPTION 'Connection replay expired' USING ERRCODE = 'P4201'; END IF;
  BEGIN
    PERFORM auth.lock_account_retirement(discovered.target_account,discovered.source_account);
  EXCEPTION WHEN SQLSTATE 'P0A01' THEN
    SELECT committed_result INTO saved_result FROM auth.replay_account_connection(operation,subject,username,original_auth_time,binding,client,origin,digest);
    SELECT * INTO receipt FROM auth.account_connection_proofs WHERE operation_sha256 = operation;
    IF saved_result IS NULL OR receipt.choices->'omittedWorkspaceIds' IS DISTINCT FROM to_jsonb(normalized) THEN RAISE; END IF;
    RETURN saved_result::JSONB;
  END;
  SELECT * INTO STRICT receipt FROM auth.claim_account_connection_proofs(operation,subject,username,original_auth_time,binding,client,origin);
  IF ROW(receipt.operation_id,receipt.source_account,receipt.target_account,receipt.source_proof,receipt.target_session,receipt.provider_session)
      IS DISTINCT FROM ROW(discovered.operation_id,discovered.source_account,discovered.target_account,
        discovered.source_proof,discovered.target_session,discovered.provider_session)
    OR receipt.preview_digest IS DISTINCT FROM digest OR receipt.choices IS NULL
    OR receipt.choices->'omittedWorkspaceIds' IS DISTINCT FROM to_jsonb(normalized) THEN
    RAISE EXCEPTION 'Preview or choices changed; obtain fresh explicit consent' USING ERRCODE = 'P4202';
  END IF;
  -- Match actual11 settings -> membership advisory -> access advisory -> membership -> workspace order.
  PERFORM 1 FROM org.user_settings WHERE user_id IN (receipt.source_account,receipt.target_account) ORDER BY user_id FOR UPDATE;
  PERFORM auth.load_account_connection(operation,subject,username,original_auth_time,binding,client,origin);
  actual := auth.prepare_account_connection_choices(operation,normalized);
  IF actual IS DISTINCT FROM receipt.choices THEN
    RAISE EXCEPTION 'Preview changed; reload and confirm again' USING ERRCODE = 'P4202';
  END IF;
  SELECT ARRAY(SELECT value::UUID FROM jsonb_array_elements_text(actual->'preview'->'workspaceIds')) INTO workspace_ids;
  FOREACH workspace IN ARRAY workspace_ids LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(workspace::TEXT,1::BIGINT));
  END LOOP;
  FOR item IN SELECT unnest(ARRAY[receipt.target_account,receipt.source_account]) ORDER BY 1 LOOP
    FOREACH workspace IN ARRAY workspace_ids LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended(item||':'||workspace::TEXT,0::BIGINT));
    END LOOP;
  END LOOP;
  PERFORM 1 FROM org.workspace_memberships WHERE workspace_id = ANY(workspace_ids) ORDER BY workspace_id,user_id FOR UPDATE;
  PERFORM 1 FROM org.workspaces WHERE workspace_id = ANY(workspace_ids) ORDER BY workspace_id FOR UPDATE;
  PERFORM auth.load_account_connection(operation,subject,username,original_auth_time,binding,client,origin);
  actual := auth.prepare_account_connection_choices(operation,normalized);
  IF actual IS DISTINCT FROM receipt.choices THEN
    RAISE EXCEPTION 'Workspace changed; reload and confirm again' USING ERRCODE = 'P4202';
  END IF;
  FOR entry IN SELECT key,value FROM jsonb_each(actual->'historicalBaselines') ORDER BY key LOOP
    INSERT INTO org.workspace_starter_baselines(workspace_id,operation_id,baseline)
      VALUES(entry.key::UUID,receipt.operation_id,entry.value)
      ON CONFLICT (workspace_id) DO UPDATE SET operation_id = EXCLUDED.operation_id,baseline = EXCLUDED.baseline;
  END LOOP;
  IF auth.preview_account_union(receipt.target_account,receipt.source_account,50000,256) IS DISTINCT FROM actual->'preview' THEN
    RAISE EXCEPTION 'Final preview changed; reload and confirm again' USING ERRCODE = 'P4202';
  END IF;
  result := auth.combine_proved_accounts(receipt.operation_id,receipt.target_account,receipt.source_account,actual->'preview');
  IF receipt.target_email IS NOT NULL AND receipt.target_email !~ '@(privaterelay\.appleid\.com|private\.icloud\.com)$'
    AND EXISTS (SELECT 1 FROM auth.verified_login_emails e JOIN auth.user_identities i
      ON i.provider_type = 'cognito' AND i.provider_subject = e.cognito_subject
      WHERE e.cognito_subject = receipt.target_subject AND e.email = receipt.target_email AND i.user_id = receipt.source_account)
    AND auth.principal_session_status(receipt.target_subject,
      COALESCE(receipt.target_auth_time,(receipt.target_session->>'minimumAuthTime')::BIGINT)) = 'valid' THEN
    UPDATE org.user_settings SET email = receipt.target_email WHERE user_id = receipt.source_account
      AND (email IS NULL OR email ~ '@(privaterelay\.appleid\.com|private\.icloud\.com)$');
  END IF;
  result := jsonb_build_object('status','connected','operationId',receipt.operation_id,'result',result);
  -- Deletion consumes only this operation's already-locked reserved rows. Generic phase guards stay strict.
  DELETE FROM auth.social_attempts WHERE attempt_sha256 IN (receipt.source_attempt_sha256,receipt.target_attempt_sha256);
  UPDATE auth.account_connection_proofs SET state = 'committed',consent_digest = digest,
    committed_result = result::TEXT,challenge_ciphertext = NULL WHERE operation_sha256 = operation;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION auth.confirm_account_connection(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,UUID[],TEXT,BOOLEAN)
FROM PUBLIC,backend_app,reporting_readonly;
GRANT EXECUTE ON FUNCTION auth.confirm_account_connection(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,UUID[],TEXT,BOOLEAN) TO auth_app;

-- A verified signed callback is confined to this operation, binding, provider and exact callback host.
CREATE FUNCTION auth.connection_callback_authority(operation TEXT, attempt_hash TEXT, binding TEXT, client TEXT,
  origin TEXT, provider TEXT, redirect TEXT) RETURNS auth.account_connection_proofs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE receipt auth.account_connection_proofs%ROWTYPE;
BEGIN
  SELECT * INTO receipt FROM auth.account_connection_proofs WHERE operation_sha256 = operation;
  IF NOT FOUND OR receipt.target_attempt_sha256 IS DISTINCT FROM attempt_hash OR receipt.binding_sha256 IS DISTINCT FROM binding
    OR receipt.client_type IS DISTINCT FROM client OR receipt.origin IS DISTINCT FROM origin
    OR client NOT IN ('web','android') OR receipt.state <> 'collecting' OR receipt.expires_at <= clock_timestamp()
    OR NOT EXISTS (SELECT 1 FROM auth.social_attempts a WHERE a.attempt_sha256 = attempt_hash
      AND a.provider_type = provider AND a.redirect_uri = redirect AND a.purpose = 'login'
      AND a.client_type = client AND a.binding_sha256 = binding
      AND a.origin IS NOT DISTINCT FROM connection_callback_authority.origin) THEN
    RAISE EXCEPTION 'Reserved callback authority changed; start again' USING ERRCODE = 'P4201';
  END IF;
  RETURN receipt;
END;
$$;
REVOKE ALL ON FUNCTION auth.connection_callback_authority(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT)
FROM PUBLIC,auth_app,backend_app,reporting_readonly;

CREATE FUNCTION auth.claim_connection_callback(operation TEXT, attempt_hash TEXT, binding TEXT, client TEXT,
  origin TEXT, provider TEXT, redirect TEXT) RETURNS SETOF auth.social_attempts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE r auth.account_connection_proofs%ROWTYPE;
BEGIN
  r := auth.connection_callback_authority(operation,attempt_hash,binding,client,origin,provider,redirect);
  RETURN QUERY SELECT * FROM auth.claim_connection_provider_attempt(operation,r.source_subject,r.source_username,
    r.source_auth_time,binding,client,origin,attempt_hash);
END;
$$;
REVOKE ALL ON FUNCTION auth.claim_connection_callback(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,backend_app,reporting_readonly;
GRANT EXECUTE ON FUNCTION auth.claim_connection_callback(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO auth_app;

CREATE FUNCTION auth.finish_connection_noop(operation TEXT, subject TEXT, username TEXT,
  original_auth_time BIGINT, binding TEXT, client TEXT, origin TEXT) RETURNS SETOF auth.account_connection_proofs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE r auth.account_connection_proofs%ROWTYPE;
BEGIN
  SELECT * INTO STRICT r FROM auth.load_account_connection(operation,subject,username,original_auth_time,binding,client,origin);
  PERFORM 1 FROM auth.social_attempts WHERE attempt_sha256 IN (r.source_attempt_sha256,r.target_attempt_sha256)
    ORDER BY attempt_sha256 FOR UPDATE;
  PERFORM 1 FROM auth.account_connection_proofs WHERE operation_sha256 = operation FOR UPDATE;
  SELECT * INTO STRICT r FROM auth.load_account_connection(operation,subject,username,original_auth_time,binding,client,origin);
  UPDATE auth.account_connection_proofs SET state = 'cancelled',terminal_outcome = 'already_connected',challenge_ciphertext = NULL
    WHERE operation_sha256 = operation;
  UPDATE auth.social_attempts SET secret_ciphertext = 'erased' WHERE attempt_sha256 = r.target_attempt_sha256;
  RETURN QUERY SELECT * FROM auth.account_connection_proofs WHERE operation_sha256 = operation;
END;
$$;
REVOKE ALL ON FUNCTION auth.finish_connection_noop(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT)
FROM PUBLIC,auth_app,backend_app,reporting_readonly;

-- Same-canonical success is terminal and never manufactures a distinct-account union.
CREATE FUNCTION auth.record_connection_target(operation TEXT, subject TEXT, username TEXT,
  original_auth_time BIGINT, binding TEXT, client TEXT, origin TEXT, attempt_hash TEXT, claim UUID,
  mailbox_subject TEXT, mailbox_username TEXT, mailbox_email TEXT) RETURNS SETOF auth.account_connection_proofs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE r auth.account_connection_proofs%ROWTYPE; a auth.social_attempts%ROWTYPE; p JSONB; q JSONB;
BEGIN
  SELECT * INTO r FROM auth.account_connection_proofs WHERE operation_sha256 = operation;
  IF NOT FOUND OR r.source_subject IS DISTINCT FROM subject OR r.source_username IS DISTINCT FROM username
    OR r.source_auth_time IS DISTINCT FROM original_auth_time OR r.binding_sha256 IS DISTINCT FROM binding
    OR r.client_type IS DISTINCT FROM client OR r.origin IS DISTINCT FROM origin THEN
    RAISE EXCEPTION 'Connection session or transport changed; start again' USING ERRCODE = 'P4201';
  END IF;
  SELECT * INTO a FROM auth.social_attempts WHERE attempt_sha256 = attempt_hash;
  PERFORM auth.lock_connection_principals(ARRAY[subject,r.source_proof->>'proved_subject',a.snapshot_subject,mailbox_subject]);
  PERFORM 1 FROM auth.provider_login_methods WHERE (provider_type,provider_subject) IN (
    SELECT r.source_proof->>'provider_type',r.source_proof->>'provider_subject' UNION
    SELECT a.provider_type,a.provider_subject) ORDER BY provider_type,provider_subject FOR UPDATE;
  PERFORM 1 FROM auth.social_attempts WHERE attempt_sha256 IN (r.source_attempt_sha256,r.target_attempt_sha256)
    ORDER BY attempt_sha256 FOR UPDATE;
  PERFORM 1 FROM auth.account_connection_proofs WHERE operation_sha256 = operation FOR UPDATE;
  SELECT * INTO STRICT r FROM auth.load_account_connection(operation,subject,username,original_auth_time,binding,client,origin);
  SELECT * INTO a FROM auth.social_attempts WHERE attempt_sha256 = attempt_hash;
  IF r.target_attempt_sha256 IS DISTINCT FROM attempt_hash OR a.purpose IS DISTINCT FROM 'login'
    OR a.phase IS DISTINCT FROM 'provider_proved' OR a.claim_id IS DISTINCT FROM claim OR claim IS NULL
    OR a.snapshot_subject IS NULL OR a.snapshot_method_activated_at IS NULL OR a.verified_at IS NULL
    OR a.verified_at <= clock_timestamp()-INTERVAL '120 seconds' OR a.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Fresh operation-owned established provider proof required' USING ERRCODE = 'P4201';
  END IF;
  PERFORM auth.assert_social_attempt_live(a);
  p := auth.connection_principal_snapshot(a.snapshot_subject,NULL);
  q := auth.connection_principal_snapshot(mailbox_subject,mailbox_email);
  IF mailbox_subject IS NOT NULL AND (q IS NULL OR q->>'username' IS DISTINCT FROM mailbox_username
    OR q->>'enrolledAt' IS NULL OR mailbox_email IS NULL OR mailbox_email ~ '@(privaterelay\.appleid\.com|private\.icloud\.com)$') THEN
    RAISE EXCEPTION 'Exact authoritative mailbox proof required' USING ERRCODE = 'P4201';
  ELSIF mailbox_subject IS NULL AND (mailbox_username IS NOT NULL OR mailbox_email IS NOT NULL) THEN
    RAISE EXCEPTION 'Incomplete authoritative mailbox proof' USING ERRCODE = 'P4201';
  END IF;
  IF p->>'account' = r.source_account AND (mailbox_subject IS NULL OR q->>'account' = r.source_account) THEN
    RETURN QUERY SELECT * FROM auth.finish_connection_noop(operation,subject,username,original_auth_time,binding,client,origin);
    RETURN;
  END IF;
  RETURN QUERY SELECT * FROM auth.record_connection_provider_proof(operation,subject,username,original_auth_time,
    binding,client,origin,attempt_hash,claim,mailbox_subject,mailbox_username,mailbox_email);
END;
$$;
REVOKE ALL ON FUNCTION auth.record_connection_target(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,UUID,TEXT,TEXT,TEXT)
FROM PUBLIC,backend_app,reporting_readonly;
GRANT EXECUTE ON FUNCTION auth.record_connection_target(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,UUID,TEXT,TEXT,TEXT) TO auth_app;

CREATE FUNCTION auth.record_connection_callback(operation TEXT, attempt_hash TEXT, binding TEXT, client TEXT,
  origin TEXT, provider TEXT, redirect TEXT, claim UUID, mailbox_subject TEXT, mailbox_username TEXT, mailbox_email TEXT)
RETURNS SETOF auth.account_connection_proofs LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE r auth.account_connection_proofs%ROWTYPE;
BEGIN
  r := auth.connection_callback_authority(operation,attempt_hash,binding,client,origin,provider,redirect);
  RETURN QUERY SELECT * FROM auth.record_connection_target(operation,r.source_subject,r.source_username,
    r.source_auth_time,binding,client,origin,attempt_hash,claim,mailbox_subject,mailbox_username,mailbox_email);
END;
$$;
REVOKE ALL ON FUNCTION auth.record_connection_callback(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,TEXT,TEXT,TEXT)
FROM PUBLIC,backend_app,reporting_readonly;
GRANT EXECUTE ON FUNCTION auth.record_connection_callback(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,TEXT,TEXT,TEXT) TO auth_app;

GRANT EXECUTE ON FUNCTION auth.begin_account_connection(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT),
  auth.adopt_account_connection_suggestion(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT),
  auth.load_account_connection(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT),
  auth.cancel_account_connection(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT),
  auth.create_connection_provider_attempt(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT),
  auth.claim_connection_provider_attempt(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT),
  auth.begin_connection_email_proof(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT),
  auth.ready_connection_email_proof(TEXT,UUID,TEXT),
  auth.claim_connection_email_proof(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT),
  auth.record_connection_email_proof(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,UUID,TEXT,TEXT,TEXT,BIGINT)
TO auth_app;

CREATE FUNCTION auth.load_connection_provider_launch(operation TEXT, attempt_hash TEXT, auth_origin TEXT)
RETURNS SETOF auth.social_attempts LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE r auth.account_connection_proofs%ROWTYPE;
BEGIN
  SELECT * INTO r FROM auth.account_connection_proofs WHERE operation_sha256 = operation;
  IF NOT FOUND OR r.client_type <> 'android' OR r.state <> 'collecting' OR r.expires_at <= clock_timestamp()
    OR r.target_attempt_sha256 IS DISTINCT FROM attempt_hash THEN
    RAISE EXCEPTION 'Android connection launch expired; start again' USING ERRCODE = 'P4201';
  END IF;
  RETURN QUERY SELECT * FROM auth.social_attempts a WHERE a.attempt_sha256 = attempt_hash
    AND a.client_type = 'android' AND a.provider_type = 'apple' AND a.purpose = 'login'
    AND a.phase = 'provider_ready' AND a.binding_sha256 = r.binding_sha256
    AND a.redirect_uri = auth_origin || '/api/social/apple/callback' AND a.expires_at > clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION 'Android connection callback host changed' USING ERRCODE = 'P4201'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION auth.load_connection_provider_launch(TEXT,TEXT,TEXT) FROM PUBLIC,backend_app,reporting_readonly;
GRANT EXECUTE ON FUNCTION auth.load_connection_provider_launch(TEXT,TEXT,TEXT) TO auth_app;

CREATE FUNCTION auth.read_account_connection(operation TEXT, subject TEXT, username TEXT,
  original_auth_time BIGINT, binding TEXT, client TEXT, origin TEXT) RETURNS SETOF auth.account_connection_proofs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE r auth.account_connection_proofs%ROWTYPE;
BEGIN
  SELECT * INTO r FROM auth.account_connection_proofs WHERE operation_sha256 = operation;
  IF NOT FOUND OR r.source_subject IS DISTINCT FROM subject OR r.source_username IS DISTINCT FROM username
    OR r.source_auth_time IS DISTINCT FROM original_auth_time OR r.binding_sha256 IS DISTINCT FROM binding
    OR r.client_type IS DISTINCT FROM client OR r.origin IS DISTINCT FROM origin OR r.retain_until <= clock_timestamp() THEN
    RAISE EXCEPTION 'Connection session or transport changed; start again' USING ERRCODE = 'P4201';
  END IF;
  IF r.state = 'cancelled' THEN RETURN NEXT r; RETURN; END IF;
  RETURN QUERY SELECT * FROM auth.load_account_connection(operation,subject,username,original_auth_time,binding,client,origin);
END;
$$;
REVOKE ALL ON FUNCTION auth.read_account_connection(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT) FROM PUBLIC,backend_app,reporting_readonly;
GRANT EXECUTE ON FUNCTION auth.read_account_connection(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT) TO auth_app;

CREATE FUNCTION auth.begin_connection_email_target(operation TEXT, subject TEXT, username TEXT,
  original_auth_time BIGINT, binding TEXT, client TEXT, origin TEXT,
  mailbox_subject TEXT, mailbox_username TEXT, mailbox_email TEXT) RETURNS SETOF auth.account_connection_proofs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE r auth.account_connection_proofs%ROWTYPE; target JSONB;
BEGIN
  SELECT * INTO r FROM auth.account_connection_proofs WHERE operation_sha256 = operation;
  IF NOT FOUND OR r.source_subject IS DISTINCT FROM subject OR r.source_username IS DISTINCT FROM username
    OR r.source_auth_time IS DISTINCT FROM original_auth_time OR r.binding_sha256 IS DISTINCT FROM binding
    OR r.client_type IS DISTINCT FROM client OR r.origin IS DISTINCT FROM origin THEN
    RAISE EXCEPTION 'Connection session or transport changed; start again' USING ERRCODE = 'P4201';
  END IF;
  PERFORM auth.lock_connection_principals(ARRAY[subject,r.source_proof->>'proved_subject',mailbox_subject]);
  SELECT * INTO STRICT r FROM auth.load_account_connection(operation,subject,username,original_auth_time,binding,client,origin);
  target := auth.connection_principal_snapshot(mailbox_subject,mailbox_email);
  IF target IS NULL OR target->>'username' IS DISTINCT FROM mailbox_username OR target->>'enrolledAt' IS NULL
    OR auth.principal_session_status(mailbox_subject,(target->>'minimumAuthTime')::BIGINT) <> 'valid' THEN
    RAISE EXCEPTION 'Exact usable enrolled mailbox required' USING ERRCODE = 'P4201';
  END IF;
  IF target->>'account' = r.source_account THEN
    RETURN QUERY SELECT * FROM auth.finish_connection_noop(operation,subject,username,original_auth_time,binding,client,origin);
    RETURN;
  END IF;
  RETURN QUERY SELECT * FROM auth.begin_connection_email_proof(operation,subject,username,original_auth_time,
    binding,client,origin,mailbox_subject,mailbox_username,mailbox_email);
END;
$$;
REVOKE ALL ON FUNCTION auth.begin_connection_email_target(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT)
FROM PUBLIC,backend_app,reporting_readonly;
GRANT EXECUTE ON FUNCTION auth.begin_connection_email_target(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO auth_app;
