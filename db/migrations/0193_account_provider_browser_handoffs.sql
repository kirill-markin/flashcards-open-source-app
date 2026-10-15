-- Schemas touched/read explicitly: auth, pg_catalog.
CREATE FUNCTION auth.load_account_provider_browser_launch(target_hash TEXT, target_auth_origin TEXT)
RETURNS TABLE(binding_sha256 TEXT, purpose TEXT, redirect_uri TEXT, secret_ciphertext TEXT,
  expires_at TIMESTAMPTZ, explicit_reenable BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE attempt auth.social_attempts%ROWTYPE;
BEGIN
  IF target_auth_origin IS NULL OR target_auth_origin NOT IN
    ('https://auth.nibomo.com', 'https://auth.flashcards-open-source-app.com') THEN RETURN; END IF;
  SELECT * INTO attempt FROM auth.social_attempts WHERE attempt_sha256 = target_hash
    AND provider_type = 'apple' AND client_type = 'android' AND origin IS NULL
    AND auth.social_attempts.purpose IN ('link', 'reauth') AND current_subject IS NOT NULL AND current_account IS NOT NULL
    AND auth.social_attempts.redirect_uri = target_auth_origin || '/api/social/apple/callback'
    AND phase = 'provider_ready' AND claim_id IS NULL AND auth.social_attempts.expires_at > clock_timestamp();
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM auth.assert_social_attempt_live(attempt);
  RETURN QUERY SELECT stored.binding_sha256, stored.purpose, stored.redirect_uri, stored.secret_ciphertext,
    stored.expires_at, stored.reenable_disabled_at IS NOT NULL
  FROM auth.social_attempts AS stored WHERE stored.attempt_sha256 = target_hash
    AND stored.phase = 'provider_ready' AND stored.claim_id IS NULL AND stored.expires_at > clock_timestamp();
END;
$$;
REVOKE ALL ON FUNCTION auth.load_account_provider_browser_launch(TEXT, TEXT) FROM PUBLIC, backend_app;
GRANT EXECUTE ON FUNCTION auth.load_account_provider_browser_launch(TEXT, TEXT) TO auth_app;

-- Loading preserves the original claim; only the existing atomic finalizer may consume the proof.
CREATE FUNCTION auth.load_proved_account_provider_reenable(
  target_hash TEXT, target_binding TEXT, target_client TEXT, target_origin TEXT,
  target_subject TEXT, target_username TEXT, original_auth_time BIGINT
) RETURNS TABLE(claim_id UUID, provider_type TEXT, client_type TEXT, purpose TEXT, redirect_uri TEXT,
  secret_ciphertext TEXT, phase TEXT, provider_subject TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE attempt auth.social_attempts%ROWTYPE; receipt auth.social_attempts%ROWTYPE;
BEGIN
  SELECT * INTO attempt FROM auth.social_attempts AS stored WHERE stored.attempt_sha256 = target_hash
    AND stored.binding_sha256 = target_binding AND stored.client_type = target_client
    AND stored.origin IS NOT DISTINCT FROM target_origin AND stored.current_subject = target_subject
    AND stored.provider_type = 'apple' AND stored.client_type = 'android' AND stored.origin IS NULL
    AND stored.redirect_uri IN ('https://auth.nibomo.com/api/social/apple/callback',
      'https://auth.flashcards-open-source-app.com/api/social/apple/callback')
    AND stored.purpose = 'link' AND stored.reenable_disabled_at IS NOT NULL
    AND stored.phase = 'provider_proved' AND stored.claim_id IS NOT NULL
    AND stored.expires_at > clock_timestamp() AND stored.verified_at >= clock_timestamp() - INTERVAL '120 seconds';
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO receipt FROM auth.social_attempts WHERE attempt_sha256 = attempt.reauth_attempt_sha256;
  PERFORM auth.lock_social_attempt_lifecycle(target_subject, attempt.snapshot_subject, receipt.proved_subject);
  IF auth.account_provider_context(target_subject, target_username, original_auth_time) IS DISTINCT FROM attempt.current_account
    OR auth.principal_session_status(receipt.proved_subject, floor(EXTRACT(EPOCH FROM receipt.verified_at))::BIGINT) <> 'valid' THEN
    RAISE EXCEPTION 'Re-enable session or account proof changed; start again' USING ERRCODE = '23514';
  END IF;
  PERFORM auth.assert_social_attempt_live(attempt);
  RETURN QUERY SELECT stored.claim_id, stored.provider_type, stored.client_type, stored.purpose, stored.redirect_uri,
    stored.secret_ciphertext, stored.phase, stored.provider_subject
  FROM auth.social_attempts AS stored WHERE stored.attempt_sha256 = target_hash
    AND stored.phase = 'provider_proved' AND stored.claim_id = attempt.claim_id
    AND stored.expires_at > clock_timestamp() AND stored.verified_at >= clock_timestamp() - INTERVAL '120 seconds';
END;
$$;
REVOKE ALL ON FUNCTION auth.load_proved_account_provider_reenable(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT)
FROM PUBLIC, backend_app;
GRANT EXECUTE ON FUNCTION auth.load_proved_account_provider_reenable(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT) TO auth_app;
