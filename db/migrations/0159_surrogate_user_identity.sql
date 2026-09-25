-- Migration status: Current / documentation plus one privilege.
-- Introduces: a comment on auth.user_identities.user_id, and INSERT on auth.user_identities for
--   auth_app.
-- Schemas touched/read explicitly: auth.
-- See also: db/migrations/0031_guest_ai_identity_and_quota.sql,
--   db/migrations/0051_auth_user_identity_lookup_for_agent_keys.sql, docs/auth-service.md.

COMMENT ON COLUMN auth.user_identities.user_id IS
  'The application account id the provider subject signs in as. A surrogate identifier the product '
  'owns: it is not required to equal provider_subject and is not derived from it. Where a row '
  'exists, the account id is this column.';

-- The auth service writes this binding itself when it creates an account.
GRANT INSERT ON TABLE auth.user_identities TO auth_app;
