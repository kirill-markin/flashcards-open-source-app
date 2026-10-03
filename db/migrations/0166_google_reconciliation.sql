-- Schemas touched/read explicitly: billing.

ALTER TABLE billing.purchases
  ADD COLUMN google_verified_at TIMESTAMPTZ,
  ADD COLUMN google_last_attempt_at TIMESTAMPTZ,
  ADD COLUMN google_reconcile_stopped_at TIMESTAMPTZ,
  ADD COLUMN google_acknowledgement_state TEXT
    CHECK (google_acknowledgement_state IN ('pending', 'acknowledged')),
  ADD COLUMN google_latest_order_id TEXT;

CREATE INDEX idx_google_purchase_reconciliation
  ON billing.purchases (google_last_attempt_at NULLS FIRST, purchase_id)
  WHERE provider = 'google' AND google_reconcile_stopped_at IS NULL
    AND invalidated_at IS NULL AND status <> 'revoked';
