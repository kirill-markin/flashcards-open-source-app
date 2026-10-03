-- Schemas touched/read explicitly: billing.
CREATE TABLE billing.stripe_email_deliveries (
  environment TEXT NOT NULL CHECK (environment IN ('production', 'sandbox')),
  kind TEXT NOT NULL CHECK (kind IN ('trial', 'payment', 'refund')),
  entity_id TEXT NOT NULL,
  identity_id UUID NOT NULL,
  subscription_id TEXT NOT NULL,
  request_body JSONB,
  notice JSONB,
  first_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  provider_message_id TEXT,
  last_error TEXT,
  stopped_at TIMESTAMPTZ,
  PRIMARY KEY (environment, kind, entity_id),
  FOREIGN KEY (identity_id, environment)
    REFERENCES billing.stripe_customer_identities (identity_id, environment),
  CHECK (provider_message_id IS NULL OR sent_at IS NOT NULL),
  CHECK (sent_at IS NULL OR (request_body IS NULL AND notice IS NULL)),
  CHECK (stopped_at IS NULL OR (request_body IS NULL AND notice IS NULL))
);
CREATE INDEX idx_stripe_email_identity ON billing.stripe_email_deliveries (identity_id, environment);
COMMENT ON TABLE billing.stripe_email_deliveries IS
  'Entity-level deduplication across Stripe event types. A frozen private Resend request and first-attempt '
  'time commit before sending; unresolved attempts must not resend beyond the provider idempotency window. '
  'Successful or stopped deliveries clear the request and notice. Erasure clears both and the provider '
  'message identifier; ownership follows the retained, anonymized customer identity. No reporting access.';
ALTER TABLE billing.stripe_email_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON billing.stripe_email_deliveries FROM PUBLIC, auth_app, reporting_readonly;
GRANT SELECT, INSERT, UPDATE ON billing.stripe_email_deliveries TO backend_app;
CREATE POLICY stripe_email_backend ON billing.stripe_email_deliveries
  FOR ALL TO backend_app USING (true) WITH CHECK (true);
