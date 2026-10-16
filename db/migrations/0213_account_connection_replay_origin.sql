-- Schemas touched/read explicitly: auth, pg_catalog.
CREATE OR REPLACE FUNCTION auth.replay_account_connection(
  operation TEXT, subject TEXT, username TEXT, original_auth_time BIGINT, binding TEXT, client TEXT, origin TEXT, digest TEXT
) RETURNS TABLE(consent_digest TEXT,committed_result TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.account_connection_proofs r WHERE r.operation_sha256 = operation AND r.state = 'committed' AND r.retain_until > clock_timestamp()
    AND r.source_subject = subject AND r.source_username = username AND r.source_auth_time IS NOT DISTINCT FROM original_auth_time
    AND r.binding_sha256 = binding AND r.client_type = client AND r.origin IS NOT DISTINCT FROM replay_account_connection.origin) THEN
    RETURN QUERY SELECT r.consent_digest,r.committed_result FROM auth.account_connection_proofs r
    WHERE r.operation_sha256 = operation AND r.consent_digest = digest;
    IF NOT FOUND THEN RAISE EXCEPTION 'Connection confirmation changed' USING ERRCODE = '23514'; END IF;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION auth.replay_account_connection(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, auth_app, backend_app;
