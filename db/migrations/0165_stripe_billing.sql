-- Migration status: Current / additive.
-- Schemas touched/read explicitly: billing.
-- No account foreign keys: billing history must survive merge and account erasure (0151).

CREATE TABLE billing.stripe_customer_identities (
  identity_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment TEXT NOT NULL CHECK (environment IN ('production', 'sandbox')),
  user_id TEXT NOT NULL,
  customer_id TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  account_deleted_at TIMESTAMPTZ,
  UNIQUE (identity_id, environment),
  UNIQUE (environment, customer_id),
  CHECK (customer_id IS NULL OR customer_id ~ '^cus_[A-Za-z0-9]+$'),
  CHECK (account_deleted_at IS NULL OR NOT is_primary)
);

CREATE UNIQUE INDEX idx_stripe_customer_primary
  ON billing.stripe_customer_identities (user_id, environment)
  WHERE is_primary AND account_deleted_at IS NULL;
CREATE INDEX idx_stripe_customer_owner
  ON billing.stripe_customer_identities (user_id, environment);

COMMENT ON TABLE billing.stripe_customer_identities IS
  'A committed reservation precedes customer creation. identity_id is the opaque provider metadata '
  'and idempotency identity, so retries survive a provider success followed by a database failure. '
  'One primary customer per user/environment; merged customers remain attributable as non-primary rows. '
  'Legacy billing.user_billing_state.stripe_customer_id is neither backfilled nor repurposed: it has '
  'no environment and must not be guessed into one.';

CREATE TABLE billing.stripe_trial_consumptions (
  identity_id UUID NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('production', 'sandbox')),
  subscription_id TEXT NOT NULL CHECK (subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  consumed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (identity_id, environment),
  FOREIGN KEY (identity_id, environment)
    REFERENCES billing.stripe_customer_identities (identity_id, environment)
);

COMMENT ON TABLE billing.stripe_trial_consumptions IS
  'Once per Stripe customer, independent of mobile trial history. Ownership and erasure follow '
  'the referenced durable identity; no duplicated personal fields. Refunds and cancellation never '
  'clear consumption. Only verified provider trial starts write this ledger.';

CREATE TABLE billing.stripe_checkout_attempts (
  attempt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id UUID NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('production', 'sandbox')),
  user_id TEXT NOT NULL,
  session_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'open', 'complete', 'expired', 'abandoned')),
  trial_days INTEGER NOT NULL CHECK (trial_days IN (0, 7)),
  locale TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  account_deleted_at TIMESTAMPTZ,
  FOREIGN KEY (identity_id, environment)
    REFERENCES billing.stripe_customer_identities (identity_id, environment),
  UNIQUE (environment, session_id),
  CHECK (session_id IS NULL OR session_id ~ '^cs_[A-Za-z0-9_]+$'),
  CHECK (status IN ('pending', 'abandoned') OR session_id IS NOT NULL),
  CHECK (status <> 'abandoned' OR session_id IS NULL),
  CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX idx_stripe_checkout_pending
  ON billing.stripe_checkout_attempts (identity_id, environment)
  WHERE status IN ('pending', 'open') AND account_deleted_at IS NULL;
CREATE INDEX idx_stripe_checkout_owner
  ON billing.stripe_checkout_attempts (user_id, environment);

COMMENT ON TABLE billing.stripe_checkout_attempts IS
  'Server-owned Checkout reservation, committed before Stripe. Frozen locale, trial and absolute expiry '
  'keep retry parameters stable. No emails, names, hosted URLs or raw provider payloads are stored. '
  'An expired creation window requires reconciliation, never another POST with a fresh key. '
  'abandoned means an expired reservation was reconciled without finding any provider session. '
  'Deletion stamps ownership without inventing provider completion or expiration.';

ALTER TABLE billing.stripe_customer_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.stripe_trial_consumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.stripe_checkout_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON billing.stripe_customer_identities, billing.stripe_trial_consumptions,
  billing.stripe_checkout_attempts FROM PUBLIC, auth_app, reporting_readonly;
GRANT SELECT, INSERT, UPDATE ON billing.stripe_customer_identities,
  billing.stripe_checkout_attempts TO backend_app;
GRANT SELECT, INSERT ON billing.stripe_trial_consumptions TO backend_app;

CREATE POLICY stripe_customer_backend ON billing.stripe_customer_identities
  FOR ALL TO backend_app USING (true) WITH CHECK (true);
CREATE POLICY stripe_trial_backend ON billing.stripe_trial_consumptions
  FOR ALL TO backend_app USING (true) WITH CHECK (true);
CREATE POLICY stripe_checkout_backend ON billing.stripe_checkout_attempts
  FOR ALL TO backend_app USING (true) WITH CHECK (true);
