-- Schemas touched/read explicitly: auth, pg_catalog.
-- Only encrypted, short-lived successful sign-in hints; never provider proofs or session tokens.
ALTER TABLE auth.social_attempts ADD COLUMN result_ciphertext TEXT
  CHECK (result_ciphertext IS NULL OR (length(result_ciphertext) <= 2048
    AND result_ciphertext ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$'));

CREATE FUNCTION auth.complete_social_sign_in(
  target_hash TEXT, target_claim UUID, target_subject TEXT, target_username TEXT,
  target_completion TEXT, target_result TEXT
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE expiry TIMESTAMPTZ;
BEGIN
  IF target_result IS NULL THEN
    RAISE EXCEPTION 'Sign-in completion requires an encrypted result' USING ERRCODE = '23514';
  END IF;
  expiry := auth.complete_social_attempt(target_hash, target_claim, target_subject, target_username, target_completion);
  UPDATE auth.social_attempts SET result_ciphertext = target_result
  WHERE attempt_sha256 = target_hash AND purpose = 'login' AND phase = 'completed';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sign-in result requires a login completion' USING ERRCODE = '23514';
  END IF;
  RETURN expiry;
END;
$$;
REVOKE ALL ON FUNCTION auth.complete_social_sign_in(TEXT, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.complete_social_sign_in(TEXT, UUID, TEXT, TEXT, TEXT, TEXT) TO auth_app;

CREATE OR REPLACE FUNCTION auth.redeem_social_completion(
  target_completion TEXT, target_binding TEXT, target_purpose TEXT, target_client TEXT, target_origin TEXT
) RETURNS TABLE(cognito_subject TEXT, cognito_username TEXT, current_subject TEXT, current_account TEXT, purpose TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE attempt auth.social_attempts%ROWTYPE;
BEGIN
  SELECT * INTO attempt FROM auth.social_attempts WHERE completion_sha256 = target_completion;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM auth.assert_social_attempt_live(attempt);
  RETURN QUERY UPDATE auth.social_attempts SET phase = 'redeemed', result_ciphertext = NULL
  WHERE attempt_sha256 = attempt.attempt_sha256 AND binding_sha256 = target_binding
    AND auth.social_attempts.purpose = target_purpose AND auth.social_attempts.purpose <> 'link'
    AND client_type = target_client AND origin IS NOT DISTINCT FROM target_origin
    AND phase = 'completed' AND completion_expires_at > clock_timestamp() AND expires_at > clock_timestamp()
  RETURNING proved_subject, proved_username, auth.social_attempts.current_subject, auth.social_attempts.current_account, auth.social_attempts.purpose;
END;
$$;

CREATE FUNCTION auth.redeem_social_sign_in(
  target_completion TEXT, target_binding TEXT, target_client TEXT, target_origin TEXT
) RETURNS TABLE(cognito_subject TEXT, cognito_username TEXT, result_ciphertext TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE encrypted_result TEXT;
BEGIN
  SELECT attempts.result_ciphertext INTO encrypted_result FROM auth.social_attempts AS attempts
  WHERE attempts.completion_sha256 = target_completion AND attempts.purpose = 'login'
    AND attempts.phase = 'completed';
  IF encrypted_result IS NULL THEN RETURN; END IF;
  -- The existing redemption owns sorted lifecycle locks, binding/expiry checks, consumption and erasure.
  RETURN QUERY SELECT redeemed.cognito_subject, redeemed.cognito_username, encrypted_result
  FROM auth.redeem_social_completion(target_completion, target_binding, 'login', target_client, target_origin) AS redeemed;
END;
$$;
REVOKE ALL ON FUNCTION auth.redeem_social_sign_in(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.redeem_social_sign_in(TEXT, TEXT, TEXT, TEXT) TO auth_app;
