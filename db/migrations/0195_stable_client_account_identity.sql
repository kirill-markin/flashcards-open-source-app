-- Schemas touched/read explicitly: auth, security, pg_catalog.
ALTER TABLE auth.user_identities ADD COLUMN original_client_user_id TEXT;
ALTER TABLE auth.agent_api_keys ADD COLUMN original_client_user_id TEXT;
ALTER TABLE auth.oauth_connections ADD COLUMN original_client_user_id TEXT;

UPDATE auth.user_identities SET original_client_user_id = user_id;
UPDATE auth.agent_api_keys SET original_client_user_id = user_id;
UPDATE auth.oauth_connections SET original_client_user_id = user_id;

ALTER TABLE auth.user_identities ALTER COLUMN original_client_user_id SET NOT NULL;
ALTER TABLE auth.agent_api_keys ALTER COLUMN original_client_user_id SET NOT NULL;
ALTER TABLE auth.oauth_connections ALTER COLUMN original_client_user_id SET NOT NULL;

-- This value must survive retirement of the original profile; it deliberately has no FK.
-- Legacy Lambdas omit the column, so population belongs at the database insert boundary.
CREATE FUNCTION auth.preserve_original_client_user_id() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.original_client_user_id IS NOT NULL AND NEW.original_client_user_id IS DISTINCT FROM NEW.user_id THEN
      RAISE EXCEPTION 'Original client user ID must equal the initial credential owner' USING ERRCODE = '23514';
    END IF;
    NEW.original_client_user_id := NEW.user_id;
  ELSIF NEW.original_client_user_id IS DISTINCT FROM OLD.original_client_user_id THEN
    RAISE EXCEPTION 'Original client user ID is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION auth.preserve_original_client_user_id() FROM PUBLIC;

CREATE TRIGGER preserve_original_client_user_id
BEFORE INSERT OR UPDATE ON auth.user_identities
FOR EACH ROW EXECUTE FUNCTION auth.preserve_original_client_user_id();
CREATE TRIGGER preserve_original_client_user_id
BEFORE INSERT OR UPDATE ON auth.agent_api_keys
FOR EACH ROW EXECUTE FUNCTION auth.preserve_original_client_user_id();
CREATE TRIGGER preserve_original_client_user_id
BEFORE INSERT OR UPDATE ON auth.oauth_connections
FOR EACH ROW EXECUTE FUNCTION auth.preserve_original_client_user_id();

-- Only stored credential ownership proves aliases. Email and caller-supplied IDs cannot add one.
CREATE FUNCTION auth.linked_client_account_ids() RETURNS TEXT[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT ARRAY(
    SELECT identity.user_id FROM (
      SELECT security.current_user_id() AS user_id
      UNION SELECT original_client_user_id FROM auth.user_identities WHERE user_id = security.current_user_id()
      UNION SELECT original_client_user_id FROM auth.agent_api_keys WHERE user_id = security.current_user_id()
      UNION SELECT original_client_user_id FROM auth.oauth_connections WHERE user_id = security.current_user_id()
    ) AS identity WHERE identity.user_id IS NOT NULL ORDER BY identity.user_id
  );
$$;
REVOKE ALL ON FUNCTION auth.linked_client_account_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.linked_client_account_ids() TO backend_app, auth_app;
