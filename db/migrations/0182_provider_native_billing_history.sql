-- Migration status: Current / additive.
-- Schemas touched/read explicitly: billing.
-- Only allowlisted provider fields enter native_fields; subject hashes and checkpoints are private.
SET LOCAL lock_timeout = '30s';

CREATE TABLE billing.history_subjects (
  subject_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider IN ('apple', 'google', 'stripe')),
  environment TEXT NOT NULL CHECK (environment IN ('production', 'sandbox')),
  subject_hash TEXT NOT NULL CHECK (subject_hash ~ '^[a-f0-9]{64}$'),
  user_id TEXT,
  account_deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, environment, subject_hash),
  UNIQUE (subject_id, environment)
);
CREATE INDEX history_subjects_user ON billing.history_subjects (user_id);

-- Copy existing ownership into history atomically with account merge/erasure.
-- History erasure remains irreversible when a purchase is later explicitly restored.
CREATE FUNCTION billing.sync_native_history_subject() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  source_id TEXT;
  source_provider TEXT;
BEGIN
  IF TG_TABLE_NAME = 'purchases' THEN
    IF NEW.provider = 'stripe' THEN RETURN NEW; END IF;
    source_id := NEW.provider_purchase_id;
    source_provider := NEW.provider;
  ELSE
    IF NEW.customer_id IS NULL THEN RETURN NEW; END IF;
    source_id := NEW.customer_id;
    source_provider := 'stripe';
  END IF;
  INSERT INTO billing.history_subjects AS stored
    (provider, environment, subject_hash, user_id, account_deleted_at)
  VALUES (source_provider, NEW.environment, encode(sha256(convert_to(source_id, 'UTF8')), 'hex'),
    NEW.user_id, NEW.account_deleted_at)
  ON CONFLICT (provider, environment, subject_hash) DO UPDATE SET
    user_id = EXCLUDED.user_id, account_deleted_at = EXCLUDED.account_deleted_at, updated_at = now()
  WHERE stored.account_deleted_at IS NULL;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION billing.sync_native_history_subject() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION billing.sync_native_history_subject() TO backend_app;
CREATE TRIGGER purchases_native_history_subject
  AFTER INSERT OR UPDATE OF user_id, account_deleted_at ON billing.purchases
  FOR EACH ROW EXECUTE FUNCTION billing.sync_native_history_subject();
CREATE TRIGGER stripe_native_history_subject
  AFTER INSERT OR UPDATE OF user_id, account_deleted_at, customer_id ON billing.stripe_customer_identities
  FOR EACH ROW EXECUTE FUNCTION billing.sync_native_history_subject();

INSERT INTO billing.history_subjects (provider, environment, subject_hash, user_id, account_deleted_at)
SELECT provider, environment, encode(sha256(convert_to(provider_purchase_id, 'UTF8')), 'hex'),
  user_id, account_deleted_at FROM billing.purchases WHERE provider IN ('apple', 'google');
INSERT INTO billing.history_subjects (provider, environment, subject_hash, user_id, account_deleted_at)
SELECT 'stripe', environment, encode(sha256(convert_to(customer_id, 'UTF8')), 'hex'),
  user_id, account_deleted_at FROM billing.stripe_customer_identities WHERE customer_id IS NOT NULL;

CREATE TABLE billing.history_import_runs (
  run_id UUID PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('apple', 'google', 'stripe')),
  environment TEXT NOT NULL CHECK (environment IN ('production', 'sandbox')),
  source TEXT NOT NULL CHECK (source IN ('apple_transactions', 'google_orders', 'google_subscriptions',
    'stripe_subscriptions', 'stripe_invoices', 'stripe_payments', 'stripe_refunds')),
  scope_hash TEXT NOT NULL CHECK (scope_hash ~ '^[a-f0-9]{64}$'),
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('provider', 'subject')),
  subject_id UUID,
  requested_from TIMESTAMPTZ NOT NULL,
  requested_to TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
  covered_from TIMESTAMPTZ,
  covered_to TIMESTAMPTZ,
  record_count BIGINT NOT NULL DEFAULT 0 CHECK (record_count >= 0),
  checkpoint TEXT,
  failure_code TEXT CHECK (failure_code ~ '^[A-Z0-9_]{1,100}$'),
  FOREIGN KEY (subject_id, environment) REFERENCES billing.history_subjects (subject_id, environment),
  CHECK ((scope_kind = 'subject') = (subject_id IS NOT NULL)),
  CHECK (status <> 'succeeded' OR (covered_from = requested_from AND covered_to = requested_to)),
  CHECK (requested_from < requested_to),
  CHECK (covered_from >= requested_from AND covered_to <= requested_to AND covered_from < covered_to),
  CHECK ((status = 'running' AND finished_at IS NULL AND covered_from IS NULL
      AND covered_to IS NULL AND failure_code IS NULL)
    OR (status IN ('succeeded', 'partial') AND finished_at IS NOT NULL
      AND covered_from IS NOT NULL AND covered_to IS NOT NULL AND failure_code IS NULL)
    OR (status = 'failed' AND finished_at IS NOT NULL AND failure_code IS NOT NULL
      AND covered_from IS NULL AND covered_to IS NULL)),
  CHECK (split_part(source, '_', 1) = provider)
);
CREATE INDEX history_import_runs_scope ON billing.history_import_runs
  (provider, environment, source, scope_hash, started_at DESC);
COMMENT ON TABLE billing.history_import_runs IS
  'Missing, running or failed coverage is unavailable. A succeeded zero-row scan differs from all '
  'three; partial covers only its explicit window. record_count counts objects, not payments.';
COMMENT ON COLUMN billing.history_import_runs.checkpoint IS
  'Opaque provider pagination state; private and never logged or exposed to reporting.';

CREATE TABLE billing.apple_transactions (
  environment TEXT NOT NULL CHECK (environment IN ('production', 'sandbox')),
  transaction_id TEXT NOT NULL CHECK (transaction_id <> ''),
  subject_id UUID NOT NULL,
  original_transaction_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  purchased_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  source_signed_at TIMESTAMPTZ NOT NULL,
  native_fields JSONB NOT NULL CHECK (jsonb_typeof(native_fields) = 'object'),
  observed_at TIMESTAMPTZ NOT NULL,
  first_recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (environment, transaction_id),
  FOREIGN KEY (subject_id, environment) REFERENCES billing.history_subjects (subject_id, environment)
);
CREATE INDEX apple_transactions_subject ON billing.apple_transactions (subject_id);

CREATE TABLE billing.google_orders (
  environment TEXT NOT NULL CHECK (environment IN ('production', 'sandbox')),
  order_id TEXT NOT NULL CHECK (order_id <> ''),
  subject_id UUID NOT NULL,
  created_at_provider TIMESTAMPTZ NOT NULL,
  last_event_at TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL,
  native_fields JSONB NOT NULL CHECK (jsonb_typeof(native_fields) = 'object'),
  observed_at TIMESTAMPTZ NOT NULL,
  first_recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (environment, order_id),
  FOREIGN KEY (subject_id, environment) REFERENCES billing.history_subjects (subject_id, environment)
);
CREATE INDEX google_orders_subject ON billing.google_orders (subject_id);

CREATE TABLE billing.google_subscription_observations (
  environment TEXT NOT NULL CHECK (environment IN ('production', 'sandbox')),
  observation_id TEXT NOT NULL CHECK (observation_id <> ''),
  subject_id UUID NOT NULL,
  observed_at_provider TIMESTAMPTZ NOT NULL,
  subscription_state TEXT NOT NULL,
  native_fields JSONB NOT NULL CHECK (jsonb_typeof(native_fields) = 'object'),
  observed_at TIMESTAMPTZ NOT NULL,
  first_recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (environment, observation_id),
  FOREIGN KEY (subject_id, environment) REFERENCES billing.history_subjects (subject_id, environment)
);
CREATE INDEX google_subscription_observations_subject ON billing.google_subscription_observations (subject_id);

CREATE TABLE billing.stripe_subscriptions (
  environment TEXT NOT NULL CHECK (environment IN ('production', 'sandbox')),
  subscription_id TEXT NOT NULL CHECK (subscription_id <> ''),
  subject_id UUID NOT NULL,
  created_at_provider TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,
  native_fields JSONB NOT NULL CHECK (jsonb_typeof(native_fields) = 'object'),
  observed_at TIMESTAMPTZ NOT NULL,
  first_recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (environment, subscription_id),
  FOREIGN KEY (subject_id, environment) REFERENCES billing.history_subjects (subject_id, environment)
);
CREATE INDEX stripe_subscriptions_subject ON billing.stripe_subscriptions (subject_id);

CREATE TABLE billing.stripe_invoices (
  environment TEXT NOT NULL CHECK (environment IN ('production', 'sandbox')),
  invoice_id TEXT NOT NULL CHECK (invoice_id <> ''),
  subject_id UUID NOT NULL,
  subscription_id TEXT,
  created_at_provider TIMESTAMPTZ NOT NULL,
  status TEXT,
  native_fields JSONB NOT NULL CHECK (jsonb_typeof(native_fields) = 'object'),
  observed_at TIMESTAMPTZ NOT NULL,
  first_recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (environment, invoice_id),
  FOREIGN KEY (subject_id, environment) REFERENCES billing.history_subjects (subject_id, environment)
);
CREATE INDEX stripe_invoices_subject ON billing.stripe_invoices (subject_id);

CREATE TABLE billing.stripe_payments (
  environment TEXT NOT NULL CHECK (environment IN ('production', 'sandbox')),
  payment_id TEXT NOT NULL CHECK (payment_id <> ''),
  subject_id UUID NOT NULL,
  invoice_id TEXT NOT NULL,
  created_at_provider TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,
  native_fields JSONB NOT NULL CHECK (jsonb_typeof(native_fields) = 'object'),
  observed_at TIMESTAMPTZ NOT NULL,
  first_recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (environment, payment_id),
  FOREIGN KEY (subject_id, environment) REFERENCES billing.history_subjects (subject_id, environment)
);
CREATE INDEX stripe_payments_subject ON billing.stripe_payments (subject_id);

CREATE TABLE billing.stripe_refunds (
  environment TEXT NOT NULL CHECK (environment IN ('production', 'sandbox')),
  refund_id TEXT NOT NULL CHECK (refund_id <> ''),
  subject_id UUID NOT NULL,
  charge_id TEXT,
  payment_intent_id TEXT,
  created_at_provider TIMESTAMPTZ NOT NULL,
  status TEXT,
  native_fields JSONB NOT NULL CHECK (jsonb_typeof(native_fields) = 'object'),
  observed_at TIMESTAMPTZ NOT NULL,
  first_recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (environment, refund_id),
  FOREIGN KEY (subject_id, environment) REFERENCES billing.history_subjects (subject_id, environment)
);
CREATE INDEX stripe_refunds_subject ON billing.stripe_refunds (subject_id);

-- Explicit grants prevent future private columns becoming reportable.
ALTER TABLE billing.history_subjects ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON billing.history_subjects TO backend_app;
CREATE POLICY history_subjects_backend ON billing.history_subjects
  FOR ALL TO backend_app USING (true) WITH CHECK (true);
GRANT SELECT (subject_id, provider, environment, user_id, account_deleted_at, created_at, updated_at)
  ON billing.history_subjects TO reporting_readonly;
CREATE POLICY history_subjects_reporting ON billing.history_subjects
  FOR SELECT TO reporting_readonly USING (true);
ALTER TABLE billing.history_import_runs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON billing.history_import_runs TO backend_app;
CREATE POLICY history_import_runs_backend ON billing.history_import_runs
  FOR ALL TO backend_app USING (true) WITH CHECK (true);
GRANT SELECT (run_id, provider, environment, source, scope_kind, subject_id, requested_from, requested_to, started_at,
  finished_at, status, covered_from, covered_to, record_count, failure_code)
  ON billing.history_import_runs TO reporting_readonly;
CREATE POLICY history_import_runs_reporting ON billing.history_import_runs
  FOR SELECT TO reporting_readonly USING (true);
ALTER TABLE billing.apple_transactions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON billing.apple_transactions TO backend_app;
CREATE POLICY apple_transactions_backend ON billing.apple_transactions
  FOR ALL TO backend_app USING (true) WITH CHECK (true);
GRANT SELECT (environment, transaction_id, subject_id, original_transaction_id, product_id, purchased_at, expires_at, revoked_at, source_signed_at, native_fields, observed_at, first_recorded_at, updated_at) ON billing.apple_transactions TO reporting_readonly;
CREATE POLICY apple_transactions_reporting ON billing.apple_transactions
  FOR SELECT TO reporting_readonly USING (true);
ALTER TABLE billing.google_orders ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON billing.google_orders TO backend_app;
CREATE POLICY google_orders_backend ON billing.google_orders
  FOR ALL TO backend_app USING (true) WITH CHECK (true);
GRANT SELECT (environment, order_id, subject_id, created_at_provider, last_event_at, state, native_fields, observed_at, first_recorded_at, updated_at) ON billing.google_orders TO reporting_readonly;
CREATE POLICY google_orders_reporting ON billing.google_orders
  FOR SELECT TO reporting_readonly USING (true);
ALTER TABLE billing.google_subscription_observations ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON billing.google_subscription_observations TO backend_app;
CREATE POLICY google_subscription_observations_backend ON billing.google_subscription_observations
  FOR ALL TO backend_app USING (true) WITH CHECK (true);
GRANT SELECT (environment, observation_id, subject_id, observed_at_provider, subscription_state, native_fields, observed_at, first_recorded_at, updated_at) ON billing.google_subscription_observations TO reporting_readonly;
CREATE POLICY google_subscription_observations_reporting ON billing.google_subscription_observations
  FOR SELECT TO reporting_readonly USING (true);
ALTER TABLE billing.stripe_subscriptions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON billing.stripe_subscriptions TO backend_app;
CREATE POLICY stripe_subscriptions_backend ON billing.stripe_subscriptions
  FOR ALL TO backend_app USING (true) WITH CHECK (true);
GRANT SELECT (environment, subscription_id, subject_id, created_at_provider, status, native_fields, observed_at, first_recorded_at, updated_at) ON billing.stripe_subscriptions TO reporting_readonly;
CREATE POLICY stripe_subscriptions_reporting ON billing.stripe_subscriptions
  FOR SELECT TO reporting_readonly USING (true);
ALTER TABLE billing.stripe_invoices ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON billing.stripe_invoices TO backend_app;
CREATE POLICY stripe_invoices_backend ON billing.stripe_invoices
  FOR ALL TO backend_app USING (true) WITH CHECK (true);
GRANT SELECT (environment, invoice_id, subject_id, subscription_id, created_at_provider, status, native_fields, observed_at, first_recorded_at, updated_at) ON billing.stripe_invoices TO reporting_readonly;
CREATE POLICY stripe_invoices_reporting ON billing.stripe_invoices
  FOR SELECT TO reporting_readonly USING (true);
ALTER TABLE billing.stripe_payments ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON billing.stripe_payments TO backend_app;
CREATE POLICY stripe_payments_backend ON billing.stripe_payments
  FOR ALL TO backend_app USING (true) WITH CHECK (true);
GRANT SELECT (environment, payment_id, subject_id, invoice_id, created_at_provider, status, native_fields, observed_at, first_recorded_at, updated_at) ON billing.stripe_payments TO reporting_readonly;
CREATE POLICY stripe_payments_reporting ON billing.stripe_payments
  FOR SELECT TO reporting_readonly USING (true);
ALTER TABLE billing.stripe_refunds ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON billing.stripe_refunds TO backend_app;
CREATE POLICY stripe_refunds_backend ON billing.stripe_refunds
  FOR ALL TO backend_app USING (true) WITH CHECK (true);
GRANT SELECT (environment, refund_id, subject_id, charge_id, payment_intent_id, created_at_provider, status, native_fields, observed_at, first_recorded_at, updated_at) ON billing.stripe_refunds TO reporting_readonly;
CREATE POLICY stripe_refunds_reporting ON billing.stripe_refunds
  FOR SELECT TO reporting_readonly USING (true);
