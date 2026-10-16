-- Schemas touched/read explicitly: auth, org, pg_catalog.
-- Receipt operations stay owner-only until the authenticated consent coordinator is installed.
CREATE TABLE auth.account_connection_proofs (
  operation_sha256 TEXT PRIMARY KEY CHECK (operation_sha256 ~ '^[0-9a-f]{64}$'),
  source_subject TEXT NOT NULL,
  source_username TEXT NOT NULL,
  source_auth_time BIGINT CHECK (source_auth_time >= 0),
  source_session JSONB NOT NULL,
  source_account TEXT NOT NULL,
  source_attempt_sha256 TEXT NOT NULL UNIQUE,
  source_proof JSONB NOT NULL,
  binding_sha256 TEXT NOT NULL CHECK (binding_sha256 ~ '^[0-9a-f]{64}$'),
  client_type TEXT NOT NULL CHECK (client_type IN ('web','android','ios','ios-development','macos','macos-development')),
  origin TEXT,
  capability TEXT NOT NULL CHECK (capability = 'canonical-account-v1'),
  state TEXT NOT NULL CHECK (state IN ('collecting','proved','cancelled','committed')),
  target_account TEXT,
  target_attempt_sha256 TEXT UNIQUE,
  target_subject TEXT,
  target_username TEXT,
  target_email TEXT,
  target_session JSONB,
  provider_session JSONB,
  provider_snapshot JSONB,
  target_verified_at TIMESTAMPTZ,
  target_expires_at TIMESTAMPTZ,
  target_auth_time BIGINT CHECK (target_auth_time >= 0),
  email_claim UUID,
  email_phase TEXT CHECK (email_phase IN ('sending','ready','verifying','proved')),
  email_started_at TIMESTAMPTZ,
  challenge_ciphertext TEXT CHECK (length(challenge_ciphertext) BETWEEN 1 AND 65536),
  choices JSONB,
  preview_digest TEXT,
  consent_digest TEXT,
  committed_result TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  CHECK ((client_type = 'web') = (origin IS NOT NULL)),
  CHECK (target_account IS NULL OR target_account <> source_account),
  CHECK (target_attempt_sha256 IS NULL OR email_claim IS NULL),
  CHECK ((state = 'committed') = (committed_result IS NOT NULL AND consent_digest IS NOT NULL))
);
REVOKE ALL ON auth.account_connection_proofs FROM PUBLIC, auth_app, backend_app;

CREATE FUNCTION auth.connection_principal_snapshot(subject TEXT, email TEXT) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT jsonb_build_object('subject', p.cognito_subject, 'username', p.cognito_username, 'createdAt', p.created_at,
    'originalAccount', i.user_id, 'account', auth.canonical_account_id(i.user_id),
    'minimumAuthTime', COALESCE((SELECT minimum_auth_time FROM auth.principal_session_fences
      WHERE subject_sha256 = encode(sha256(convert_to(subject, 'UTF8')), 'hex')),0),
    'email', connection_principal_snapshot.email, 'enrolledAt', (SELECT verified_at FROM auth.verified_login_emails
      WHERE cognito_subject = subject AND verified_login_emails.email = connection_principal_snapshot.email))
  FROM auth.cognito_principals p JOIN auth.user_identities i
    ON i.provider_type = 'cognito' AND i.provider_subject = p.cognito_subject
  JOIN org.user_settings settings ON settings.user_id = auth.canonical_account_id(i.user_id)
  WHERE p.cognito_subject = subject;
$$;
REVOKE ALL ON FUNCTION auth.connection_principal_snapshot(TEXT,TEXT) FROM PUBLIC, auth_app, backend_app;

-- Discover every proof subject before any account/method/receipt lock. No late subject acquisition.
CREATE FUNCTION auth.lock_connection_principals(subjects TEXT[]) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE item TEXT;
BEGIN
  IF cardinality(subjects) > 4 THEN RAISE EXCEPTION 'Connection proof subject limit exceeded' USING ERRCODE = '23514'; END IF;
  FOR item IN SELECT DISTINCT unnest(subjects) ORDER BY 1 LOOP
    IF item IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('auth.cognito_identity:' || item,2::BIGINT));
    END IF;
  END LOOP;
  FOR item IN
    WITH originals AS (SELECT user_id FROM auth.user_identities
      WHERE provider_type = 'cognito' AND provider_subject = ANY(subjects))
    SELECT user_id FROM originals UNION SELECT auth.canonical_account_id(user_id) FROM originals ORDER BY 1
  LOOP
    PERFORM auth.lock_account_lifecycle(item);
    PERFORM auth.assert_account_live(item);
    PERFORM auth.assert_account_write_scope(item);
  END LOOP;
  FOR item IN SELECT DISTINCT unnest(subjects) ORDER BY 1 LOOP
    IF item IS NOT NULL THEN
      PERFORM auth.assert_real_principal_login_policy(item);
      IF NOT EXISTS (SELECT 1 FROM auth.cognito_principals WHERE cognito_subject = item)
        OR EXISTS (SELECT 1 FROM auth.deleted_subjects WHERE subject_sha256 = encode(sha256(convert_to(item,'UTF8')),'hex')) THEN
        RAISE EXCEPTION 'Connection principal deleted or missing; start again' USING ERRCODE = '23514';
      END IF;
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION auth.lock_connection_principals(TEXT[]) FROM PUBLIC, auth_app, backend_app;

CREATE FUNCTION auth.assert_unreserved_auth_attempt(target_hash TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.account_connection_proofs
    WHERE source_attempt_sha256 = target_hash OR target_attempt_sha256 = target_hash) THEN
    RAISE EXCEPTION 'Proof belongs exclusively to an account connection; use fresh proof' USING ERRCODE = '23514';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION auth.assert_unreserved_auth_attempt(TEXT) FROM PUBLIC, backend_app;
GRANT EXECUTE ON FUNCTION auth.assert_unreserved_auth_attempt(TEXT) TO auth_app;

-- Reject generic consumption under the row lock too, closing races with source reservation.
CREATE FUNCTION auth.guard_connection_reserved_attempt() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.phase IS DISTINCT FROM OLD.phase AND NEW.phase IN ('provider_enrolling','mailbox_sending','completed','redeemed') THEN
    PERFORM auth.assert_unreserved_auth_attempt(OLD.attempt_sha256);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION auth.guard_connection_reserved_attempt() FROM PUBLIC, auth_app, backend_app;
CREATE TRIGGER connection_reserved_attempt BEFORE UPDATE ON auth.social_attempts
FOR EACH ROW EXECUTE FUNCTION auth.guard_connection_reserved_attempt();

CREATE FUNCTION auth.begin_account_connection(
  operation TEXT, subject TEXT, username TEXT, original_auth_time BIGINT, binding TEXT, client TEXT, origin TEXT,
  completion TEXT, capability TEXT
) RETURNS SETOF auth.account_connection_proofs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE proof auth.social_attempts%ROWTYPE; receipt auth.account_connection_proofs%ROWTYPE;
BEGIN
  SELECT * INTO proof FROM auth.social_attempts WHERE completion_sha256 = completion;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fresh current-account proof required' USING ERRCODE = '23514'; END IF;
  PERFORM auth.lock_connection_principals(ARRAY[subject,proof.proved_subject]);
  PERFORM auth.assert_social_attempt_live(proof);
  SELECT * INTO proof FROM auth.social_attempts WHERE attempt_sha256 = proof.attempt_sha256 FOR UPDATE;
  PERFORM auth.assert_unreserved_auth_attempt(proof.attempt_sha256);
  receipt.source_session := auth.connection_principal_snapshot(subject,NULL);
  IF capability IS DISTINCT FROM 'canonical-account-v1' OR receipt.source_session IS NULL
    OR receipt.source_session->>'username' IS DISTINCT FROM username
    OR auth.principal_session_status(subject,original_auth_time) <> 'valid'
    OR proof.purpose <> 'reauth' OR proof.phase <> 'completed' OR proof.current_subject IS DISTINCT FROM subject
    OR proof.current_account IS DISTINCT FROM receipt.source_session->>'account'
    OR proof.proved_account IS DISTINCT FROM proof.current_account
    OR proof.binding_sha256 IS DISTINCT FROM binding OR proof.client_type IS DISTINCT FROM client
    OR proof.origin IS DISTINCT FROM origin OR proof.verified_at IS NULL
    OR proof.verified_at <= clock_timestamp() - INTERVAL '120 seconds'
    OR auth.principal_session_status(proof.proved_subject,
      floor(EXTRACT(EPOCH FROM proof.verified_at))::BIGINT) <> 'valid'
    OR proof.completion_expires_at <= clock_timestamp() OR proof.expires_at <= clock_timestamp()
    OR (proof.provider_type IS NULL AND (proof.email_current_username IS DISTINCT FROM username
      OR proof.current_auth_time IS DISTINCT FROM original_auth_time)) THEN
    RAISE EXCEPTION 'Fresh bound current-account proof required; start again' USING ERRCODE = '23514';
  END IF;
  INSERT INTO auth.account_connection_proofs(operation_sha256,source_subject,source_username,source_auth_time,source_session,
    source_account,source_attempt_sha256,source_proof,binding_sha256,client_type,origin,capability,state,expires_at)
  VALUES(operation,subject,username,original_auth_time,receipt.source_session,proof.current_account,proof.attempt_sha256,
    to_jsonb(proof) - 'secret_ciphertext' - 'result_ciphertext',binding,client,origin,capability,'collecting',
    LEAST(clock_timestamp()+INTERVAL '120 seconds',proof.verified_at+INTERVAL '120 seconds',proof.completion_expires_at,proof.expires_at))
  RETURNING * INTO receipt;
  RETURN NEXT receipt;
END;
$$;
REVOKE ALL ON FUNCTION auth.begin_account_connection(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, auth_app, backend_app;

CREATE FUNCTION auth.load_account_connection(
  operation TEXT, subject TEXT, username TEXT, original_auth_time BIGINT, binding TEXT, client TEXT, origin TEXT
) RETURNS SETOF auth.account_connection_proofs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE receipt auth.account_connection_proofs%ROWTYPE; proof auth.social_attempts%ROWTYPE;
BEGIN
  SELECT * INTO receipt FROM auth.account_connection_proofs WHERE operation_sha256 = operation;
  IF NOT FOUND THEN RAISE EXCEPTION 'Connection proof expired or missing; start again' USING ERRCODE = '23514'; END IF;
  proof := jsonb_populate_record(NULL::auth.social_attempts,receipt.source_proof);
  PERFORM auth.lock_connection_principals(ARRAY[receipt.source_subject,proof.proved_subject,
    receipt.target_subject,receipt.provider_session->>'subject']);
  IF receipt.source_subject IS DISTINCT FROM subject OR receipt.source_username IS DISTINCT FROM username
    OR receipt.source_auth_time IS DISTINCT FROM original_auth_time OR receipt.binding_sha256 IS DISTINCT FROM binding
    OR receipt.client_type IS DISTINCT FROM client OR receipt.origin IS DISTINCT FROM origin
    OR receipt.state NOT IN ('collecting','proved') OR receipt.expires_at <= clock_timestamp()
    OR receipt.source_session IS DISTINCT FROM auth.connection_principal_snapshot(subject,NULL)
    OR auth.principal_session_status(subject,original_auth_time) <> 'valid' THEN
    RAISE EXCEPTION 'Connection session, transport or lifetime changed; start again' USING ERRCODE = '23514';
  END IF;
  PERFORM 1 FROM auth.provider_login_methods WHERE (provider_type,provider_subject) IN (
    SELECT proof.provider_type,proof.provider_subject UNION
    SELECT receipt.provider_snapshot->>'provider_type',receipt.provider_snapshot->>'provider_subject')
    ORDER BY provider_type,provider_subject FOR UPDATE;
  PERFORM auth.assert_social_attempt_live(proof);
  IF auth.principal_session_status(proof.proved_subject,
    floor(EXTRACT(EPOCH FROM proof.verified_at))::BIGINT) <> 'valid' THEN
    RAISE EXCEPTION 'Connection source proof session changed; start again' USING ERRCODE = '23514';
  END IF;
  IF receipt.target_session IS NOT NULL AND (receipt.target_session IS DISTINCT FROM
      auth.connection_principal_snapshot(receipt.target_subject,receipt.target_email)
    OR auth.principal_session_status(receipt.target_subject,(receipt.target_session->>'minimumAuthTime')::BIGINT) <> 'valid') THEN
    RAISE EXCEPTION 'Connection target principal, enrollment or session changed; start again' USING ERRCODE = '23514';
  END IF;
  IF receipt.email_phase = 'proved' AND (receipt.target_auth_time IS NULL
    OR auth.principal_session_status(receipt.target_subject,receipt.target_auth_time) <> 'valid') THEN
    RAISE EXCEPTION 'Connection email proof session changed; start again' USING ERRCODE = '23514';
  END IF;
  IF receipt.provider_session IS NOT NULL AND (receipt.provider_session IS DISTINCT FROM
    auth.connection_principal_snapshot(receipt.provider_session->>'subject',NULL)
    OR auth.principal_session_status(receipt.provider_session->>'subject',
      (receipt.provider_session->>'minimumAuthTime')::BIGINT) <> 'valid') THEN
    RAISE EXCEPTION 'Connection provider principal changed; start again' USING ERRCODE = '23514';
  END IF;
  IF receipt.provider_snapshot IS NOT NULL THEN
    PERFORM auth.assert_social_attempt_live(jsonb_populate_record(NULL::auth.social_attempts,receipt.provider_snapshot));
  END IF;
  IF receipt.target_verified_at IS NOT NULL AND receipt.target_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Connection target proof expired; start again' USING ERRCODE = '23514';
  END IF;
  RETURN NEXT receipt;
END;
$$;
REVOKE ALL ON FUNCTION auth.load_account_connection(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT) FROM PUBLIC, auth_app, backend_app;

CREATE FUNCTION auth.create_connection_provider_attempt(
  operation TEXT, subject TEXT, username TEXT, original_auth_time BIGINT, binding TEXT, client TEXT, origin TEXT,
  attempt_hash TEXT, provider TEXT, attempt_binding TEXT, redirect TEXT, ciphertext TEXT
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE receipt auth.account_connection_proofs%ROWTYPE;
BEGIN
  SELECT * INTO STRICT receipt FROM auth.load_account_connection(operation,subject,username,original_auth_time,binding,client,origin);
  SELECT * INTO receipt FROM auth.account_connection_proofs WHERE operation_sha256 = operation FOR UPDATE;
  IF receipt.target_attempt_sha256 IS NOT NULL OR receipt.email_claim IS NOT NULL OR receipt.state <> 'collecting' THEN
    RAISE EXCEPTION 'Connection already owns a target proof; start again' USING ERRCODE = '23514';
  END IF;
  IF attempt_binding IS DISTINCT FROM binding THEN
    RAISE EXCEPTION 'Connection provider transport differs from initiating transport' USING ERRCODE = '23514';
  END IF;
  INSERT INTO auth.social_attempts(attempt_sha256,provider_type,client_type,purpose,binding_sha256,origin,redirect_uri,secret_ciphertext,expires_at)
  VALUES(attempt_hash,provider,client,'login',binding,origin,redirect,ciphertext,receipt.expires_at);
  UPDATE auth.account_connection_proofs SET target_attempt_sha256 = attempt_hash WHERE operation_sha256 = operation;
  RETURN receipt.expires_at;
END;
$$;
REVOKE ALL ON FUNCTION auth.create_connection_provider_attempt(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT)
FROM PUBLIC, auth_app, backend_app;

CREATE FUNCTION auth.claim_connection_provider_attempt(
  operation TEXT, subject TEXT, username TEXT, original_auth_time BIGINT, binding TEXT, client TEXT, origin TEXT, attempt_hash TEXT
) RETURNS SETOF auth.social_attempts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE receipt auth.account_connection_proofs%ROWTYPE; attempt auth.social_attempts%ROWTYPE;
BEGIN
  SELECT * INTO STRICT receipt FROM auth.load_account_connection(operation,subject,username,original_auth_time,binding,client,origin);
  IF receipt.target_attempt_sha256 IS DISTINCT FROM attempt_hash OR receipt.state <> 'collecting' THEN
    RAISE EXCEPTION 'Provider attempt does not belong to connection' USING ERRCODE = '23514';
  END IF;
  UPDATE auth.social_attempts SET phase = 'provider_claimed',claim_id = gen_random_uuid()
  WHERE attempt_sha256 = attempt_hash AND phase = 'provider_ready' AND expires_at > clock_timestamp() RETURNING * INTO attempt;
  IF NOT FOUND THEN RAISE EXCEPTION 'Target proof already claimed; use fresh proof' USING ERRCODE = '23514'; END IF;
  RETURN NEXT attempt;
END;
$$;
REVOKE ALL ON FUNCTION auth.claim_connection_provider_attempt(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, auth_app, backend_app;

CREATE FUNCTION auth.record_connection_provider_proof(
  operation TEXT, subject TEXT, username TEXT, original_auth_time BIGINT, binding TEXT, client TEXT, origin TEXT,
  attempt_hash TEXT, claim UUID, mailbox_subject TEXT, mailbox_username TEXT, mailbox_email TEXT
) RETURNS SETOF auth.account_connection_proofs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE receipt auth.account_connection_proofs%ROWTYPE; attempt auth.social_attempts%ROWTYPE;
  provider_state JSONB; mailbox_state JSONB; account_id TEXT; proof_subject TEXT;
BEGIN
  SELECT * INTO receipt FROM auth.account_connection_proofs WHERE operation_sha256 = operation;
  SELECT * INTO attempt FROM auth.social_attempts WHERE attempt_sha256 = attempt_hash;
  IF receipt.operation_sha256 IS NULL OR receipt.target_attempt_sha256 IS DISTINCT FROM attempt_hash
    OR attempt.purpose IS DISTINCT FROM 'login' OR attempt.phase IS DISTINCT FROM 'provider_proved'
    OR attempt.claim_id IS DISTINCT FROM claim OR claim IS NULL OR attempt.snapshot_subject IS NULL
    OR attempt.snapshot_method_activated_at IS NULL OR attempt.verified_at IS NULL
    OR attempt.verified_at <= clock_timestamp()-INTERVAL '120 seconds' THEN
    RAISE EXCEPTION 'Established, fresh operation-owned provider proof required' USING ERRCODE = '23514';
  END IF;
  proof_subject := receipt.source_proof->>'proved_subject';
  PERFORM auth.lock_connection_principals(ARRAY[subject,proof_subject,attempt.snapshot_subject,mailbox_subject]);
  PERFORM 1 FROM auth.provider_login_methods WHERE (provider_type,provider_subject) IN (
    SELECT receipt.source_proof->>'provider_type',receipt.source_proof->>'provider_subject' UNION
    SELECT attempt.provider_type,attempt.provider_subject) ORDER BY provider_type,provider_subject FOR UPDATE;
  PERFORM auth.assert_social_attempt_live(attempt);
  provider_state := auth.connection_principal_snapshot(attempt.snapshot_subject,NULL);
  IF provider_state IS NULL THEN RAISE EXCEPTION 'Target provider has no established account' USING ERRCODE = '23514'; END IF;
  IF mailbox_subject IS NOT NULL THEN
    mailbox_state := auth.connection_principal_snapshot(mailbox_subject,mailbox_email);
    IF mailbox_email IS NULL OR mailbox_email ~ '@(privaterelay\.appleid\.com|private\.icloud\.com)$'
      OR mailbox_state IS NULL OR mailbox_state->>'username' IS DISTINCT FROM mailbox_username
      OR mailbox_state->>'enrolledAt' IS NULL THEN
      RAISE EXCEPTION 'Authoritative real email must resolve to its exact enrolled principal' USING ERRCODE = '23514';
    END IF;
  ELSIF mailbox_username IS NOT NULL OR mailbox_email IS NOT NULL THEN
    RAISE EXCEPTION 'Incomplete provider mailbox proof' USING ERRCODE = '23514';
  END IF;
  account_id := CASE WHEN provider_state->>'account' <> receipt.source_account THEN provider_state->>'account'
    ELSE mailbox_state->>'account' END;
  IF account_id IS NULL OR account_id = receipt.source_account THEN
    RAISE EXCEPTION 'Accounts are already connected; no transfer is needed' USING ERRCODE = '23514';
  END IF;
  IF mailbox_state IS NOT NULL AND mailbox_state->>'account' NOT IN (receipt.source_account,account_id) THEN
    RAISE EXCEPTION 'Provider and mailbox proofs name more than the established pair' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO STRICT receipt FROM auth.load_account_connection(operation,subject,username,original_auth_time,binding,client,origin);
  SELECT * INTO attempt FROM auth.social_attempts WHERE attempt_sha256 = attempt_hash FOR UPDATE;
  SELECT * INTO receipt FROM auth.account_connection_proofs WHERE operation_sha256 = operation FOR UPDATE;
  IF attempt.phase <> 'provider_proved' OR attempt.claim_id IS DISTINCT FROM claim OR attempt.expires_at <= clock_timestamp()
    OR receipt.state <> 'collecting' OR receipt.target_verified_at IS NOT NULL THEN
    RAISE EXCEPTION 'Target proof was consumed or expired; start again' USING ERRCODE = '23514';
  END IF;
  UPDATE auth.account_connection_proofs SET target_account = account_id,
    target_subject = COALESCE(mailbox_subject,attempt.snapshot_subject),
    target_username = COALESCE(mailbox_username,attempt.snapshot_username), target_email = mailbox_email,
    target_session = COALESCE(mailbox_state,provider_state),provider_session = provider_state,
    provider_snapshot = to_jsonb(attempt)-'secret_ciphertext'-'result_ciphertext',
    target_verified_at = attempt.verified_at,target_expires_at = LEAST(receipt.expires_at,attempt.verified_at+INTERVAL '120 seconds'),state = 'proved'
  WHERE operation_sha256 = operation RETURNING * INTO receipt;
  UPDATE auth.social_attempts SET secret_ciphertext = 'erased' WHERE attempt_sha256 = attempt_hash;
  RETURN NEXT receipt;
END;
$$;
REVOKE ALL ON FUNCTION auth.record_connection_provider_proof(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,UUID,TEXT,TEXT,TEXT)
FROM PUBLIC, auth_app, backend_app;

CREATE FUNCTION auth.begin_connection_email_proof(
  operation TEXT, subject TEXT, username TEXT, original_auth_time BIGINT, binding TEXT, client TEXT, origin TEXT,
  mailbox_subject TEXT, mailbox_username TEXT, mailbox_email TEXT
) RETURNS SETOF auth.account_connection_proofs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE receipt auth.account_connection_proofs%ROWTYPE; target JSONB;
BEGIN
  SELECT * INTO receipt FROM auth.account_connection_proofs WHERE operation_sha256 = operation;
  PERFORM auth.lock_connection_principals(ARRAY[subject,receipt.source_proof->>'proved_subject',mailbox_subject]);
  target := auth.connection_principal_snapshot(mailbox_subject,mailbox_email);
  IF target IS NULL OR target->>'username' IS DISTINCT FROM mailbox_username OR target->>'enrolledAt' IS NULL
    OR mailbox_email IS NULL OR mailbox_email LIKE '%@example.com'
    OR mailbox_email <> lower(btrim(mailbox_email))
    OR auth.principal_session_status(mailbox_subject,(target->>'minimumAuthTime')::BIGINT) <> 'valid' THEN
    RAISE EXCEPTION 'Exact enabled enrolled mailbox principal required' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO STRICT receipt FROM auth.load_account_connection(operation,subject,username,original_auth_time,binding,client,origin);
  SELECT * INTO receipt FROM auth.account_connection_proofs WHERE operation_sha256 = operation FOR UPDATE;
  IF target->>'account' = receipt.source_account THEN
    RAISE EXCEPTION 'Accounts are already connected; no transfer is needed' USING ERRCODE = '23514';
  END IF;
  IF receipt.target_attempt_sha256 IS NOT NULL OR receipt.email_claim IS NOT NULL OR receipt.state <> 'collecting' THEN
    RAISE EXCEPTION 'Connection already owns a target challenge; start again' USING ERRCODE = '23514';
  END IF;
  UPDATE auth.account_connection_proofs SET target_account = target->>'account',target_subject = mailbox_subject,
    target_username = mailbox_username,target_email = mailbox_email,target_session = target,
    email_claim = gen_random_uuid(),email_phase = 'sending',email_started_at = clock_timestamp()
  WHERE operation_sha256 = operation RETURNING * INTO receipt;
  RETURN NEXT receipt;
END;
$$;
REVOKE ALL ON FUNCTION auth.begin_connection_email_proof(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT)
FROM PUBLIC, auth_app, backend_app;

CREATE FUNCTION auth.ready_connection_email_proof(operation TEXT, claim UUID, ciphertext TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  UPDATE auth.account_connection_proofs SET email_phase = 'ready',challenge_ciphertext = ciphertext
  WHERE operation_sha256 = operation AND email_claim = claim AND email_phase = 'sending' AND state = 'collecting'
    AND expires_at > clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION 'Email challenge cannot be resumed; start again' USING ERRCODE = '23514'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION auth.ready_connection_email_proof(TEXT,UUID,TEXT) FROM PUBLIC, auth_app, backend_app;

CREATE FUNCTION auth.claim_connection_email_proof(
  operation TEXT, subject TEXT, username TEXT, original_auth_time BIGINT, binding TEXT, client TEXT, origin TEXT
) RETURNS SETOF auth.account_connection_proofs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE receipt auth.account_connection_proofs%ROWTYPE;
BEGIN
  SELECT * INTO STRICT receipt FROM auth.load_account_connection(operation,subject,username,original_auth_time,binding,client,origin);
  UPDATE auth.account_connection_proofs SET email_phase = 'verifying',email_claim = gen_random_uuid()
  WHERE operation_sha256 = operation AND email_phase = 'ready' AND challenge_ciphertext IS NOT NULL
    AND state = 'collecting' AND expires_at > clock_timestamp() RETURNING * INTO receipt;
  IF NOT FOUND THEN RAISE EXCEPTION 'Email challenge already claimed; use fresh proof' USING ERRCODE = '23514'; END IF;
  RETURN NEXT receipt;
END;
$$;
REVOKE ALL ON FUNCTION auth.claim_connection_email_proof(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT) FROM PUBLIC, auth_app, backend_app;

CREATE FUNCTION auth.record_connection_email_proof(
  operation TEXT, subject TEXT, username TEXT, original_auth_time BIGINT, binding TEXT, client TEXT, origin TEXT,
  claim UUID, mailbox_subject TEXT, mailbox_username TEXT, mailbox_email TEXT, proof_auth_time BIGINT
) RETURNS SETOF auth.account_connection_proofs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE receipt auth.account_connection_proofs%ROWTYPE;
BEGIN
  SELECT * INTO STRICT receipt FROM auth.load_account_connection(operation,subject,username,original_auth_time,binding,client,origin);
  IF receipt.email_phase IS DISTINCT FROM 'verifying' OR receipt.email_claim IS DISTINCT FROM claim OR claim IS NULL
    OR receipt.target_subject IS DISTINCT FROM mailbox_subject OR receipt.target_username IS DISTINCT FROM mailbox_username
    OR receipt.target_email IS DISTINCT FROM mailbox_email OR proof_auth_time IS NULL
    OR proof_auth_time < floor(extract(epoch FROM receipt.email_started_at))
    OR proof_auth_time < floor(extract(epoch FROM clock_timestamp()))-60
    OR proof_auth_time > floor(extract(epoch FROM clock_timestamp()))+30
    OR auth.principal_session_status(mailbox_subject,proof_auth_time) <> 'valid' THEN
    RAISE EXCEPTION 'Email proof principal, challenge time or session changed; obtain fresh proof' USING ERRCODE = '23514';
  END IF;
  UPDATE auth.account_connection_proofs SET email_phase = 'proved',state = 'proved',challenge_ciphertext = NULL,
    target_auth_time = proof_auth_time,
    target_verified_at = clock_timestamp(),target_expires_at = LEAST(expires_at,clock_timestamp()+INTERVAL '120 seconds')
  WHERE operation_sha256 = operation AND email_phase = 'verifying' AND email_claim = claim AND state = 'collecting'
    AND expires_at > clock_timestamp() RETURNING * INTO receipt;
  IF NOT FOUND THEN RAISE EXCEPTION 'Email proof consumed or expired; start again' USING ERRCODE = '23514'; END IF;
  RETURN NEXT receipt;
END;
$$;
REVOKE ALL ON FUNCTION auth.record_connection_email_proof(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,UUID,TEXT,TEXT,TEXT,BIGINT)
FROM PUBLIC, auth_app, backend_app;

CREATE FUNCTION auth.cancel_account_connection(
  operation TEXT, subject TEXT, username TEXT, original_auth_time BIGINT, binding TEXT, client TEXT, origin TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE discovered auth.account_connection_proofs%ROWTYPE; receipt auth.account_connection_proofs%ROWTYPE;
BEGIN
  SELECT * INTO discovered FROM auth.account_connection_proofs WHERE operation_sha256 = operation;
  PERFORM 1 FROM auth.social_attempts WHERE attempt_sha256 IN (discovered.source_attempt_sha256,discovered.target_attempt_sha256)
    ORDER BY attempt_sha256 FOR UPDATE;
  SELECT * INTO receipt FROM auth.account_connection_proofs WHERE operation_sha256 = operation FOR UPDATE;
  IF NOT FOUND OR receipt.source_attempt_sha256 IS DISTINCT FROM discovered.source_attempt_sha256
    OR receipt.target_attempt_sha256 IS DISTINCT FROM discovered.target_attempt_sha256
    OR receipt.source_subject IS DISTINCT FROM subject OR receipt.source_username IS DISTINCT FROM username
    OR receipt.source_auth_time IS DISTINCT FROM original_auth_time OR receipt.binding_sha256 IS DISTINCT FROM binding
    OR receipt.client_type IS DISTINCT FROM client OR receipt.origin IS DISTINCT FROM origin
    OR receipt.state NOT IN ('collecting','proved','cancelled') THEN
    RAISE EXCEPTION 'Connection cannot be cancelled with this session/transport; reload after a proof change' USING ERRCODE = '23514';
  END IF;
  UPDATE auth.account_connection_proofs SET state = 'cancelled',challenge_ciphertext = NULL WHERE operation_sha256 = operation;
  UPDATE auth.social_attempts SET secret_ciphertext = 'erased' WHERE attempt_sha256 = receipt.target_attempt_sha256;
END;
$$;
REVOKE ALL ON FUNCTION auth.cancel_account_connection(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT) FROM PUBLIC, auth_app, backend_app;

-- No writer/union grant: 14b must revalidate proofs after retirement locks, consume, and save result atomically.
CREATE FUNCTION auth.replay_account_connection(
  operation TEXT, subject TEXT, username TEXT, original_auth_time BIGINT, binding TEXT, client TEXT, origin TEXT, digest TEXT
) RETURNS TABLE(consent_digest TEXT,committed_result TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.account_connection_proofs r WHERE r.operation_sha256 = operation AND r.state = 'committed'
    AND r.source_subject = subject AND r.source_username = username AND r.source_auth_time IS NOT DISTINCT FROM original_auth_time
    AND r.binding_sha256 = binding AND r.client_type = client AND r.origin IS NOT DISTINCT FROM origin) THEN
    RETURN QUERY SELECT r.consent_digest,r.committed_result FROM auth.account_connection_proofs r
    WHERE r.operation_sha256 = operation AND r.consent_digest = digest;
    IF NOT FOUND THEN RAISE EXCEPTION 'Connection confirmation changed' USING ERRCODE = '23514'; END IF;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION auth.replay_account_connection(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, auth_app, backend_app;

ALTER FUNCTION auth.claim_social_attempt(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) RENAME TO claim_unreserved_social_attempt;
REVOKE ALL ON FUNCTION auth.claim_unreserved_social_attempt(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,auth_app,backend_app;
CREATE FUNCTION auth.claim_social_attempt(
  target_hash TEXT,target_binding TEXT,target_purpose TEXT,target_client TEXT,target_origin TEXT,target_phase TEXT
) RETURNS SETOF auth.social_attempts LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM auth.assert_unreserved_auth_attempt(target_hash);
  RETURN QUERY SELECT * FROM auth.claim_unreserved_social_attempt(target_hash,target_binding,target_purpose,target_client,target_origin,target_phase);
  -- Recheck after the existing claim locks: a newly visible reservation must roll back this claim.
  PERFORM auth.assert_unreserved_auth_attempt(target_hash);
END;
$$;
REVOKE ALL ON FUNCTION auth.claim_social_attempt(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,backend_app;
GRANT EXECUTE ON FUNCTION auth.claim_social_attempt(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO auth_app;

CREATE FUNCTION auth.guard_connection_receipt_binding() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF ROW(NEW.operation_sha256,NEW.source_subject,NEW.source_username,NEW.source_auth_time,NEW.source_session,
      NEW.source_account,NEW.source_attempt_sha256,NEW.source_proof,NEW.binding_sha256,NEW.client_type,NEW.origin,NEW.capability,NEW.created_at,NEW.expires_at)
    IS DISTINCT FROM ROW(OLD.operation_sha256,OLD.source_subject,OLD.source_username,OLD.source_auth_time,OLD.source_session,
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
CREATE TRIGGER immutable_connection_receipt BEFORE UPDATE ON auth.account_connection_proofs
FOR EACH ROW EXECUTE FUNCTION auth.guard_connection_receipt_binding();

-- Caller takes retirement locks first; all live assertions precede any ownership changes.
CREATE FUNCTION auth.claim_account_connection_proofs(
  operation TEXT, subject TEXT, username TEXT, original_auth_time BIGINT, binding TEXT, client TEXT, origin TEXT
) RETURNS SETOF auth.account_connection_proofs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE receipt auth.account_connection_proofs%ROWTYPE;
BEGIN
  SELECT * INTO STRICT receipt FROM auth.load_account_connection(operation,subject,username,original_auth_time,binding,client,origin);
  PERFORM 1 FROM auth.social_attempts WHERE attempt_sha256 IN (receipt.source_attempt_sha256,receipt.target_attempt_sha256)
    ORDER BY attempt_sha256 FOR UPDATE;
  SELECT * INTO receipt FROM auth.account_connection_proofs WHERE operation_sha256 = operation FOR UPDATE;
  IF receipt.state <> 'proved' OR receipt.target_account IS NULL OR receipt.target_verified_at IS NULL
    OR receipt.expires_at <= clock_timestamp() OR receipt.target_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Two fresh exclusive account proofs required' USING ERRCODE = '23514';
  END IF;
  RETURN NEXT receipt;
END;
$$;
REVOKE ALL ON FUNCTION auth.claim_account_connection_proofs(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT) FROM PUBLIC,auth_app,backend_app;
