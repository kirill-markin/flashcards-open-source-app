-- Schemas touched/read explicitly: billing.

ALTER TABLE billing.purchases
  ADD COLUMN google_last_paid_order_id TEXT;

COMMENT ON COLUMN billing.purchases.google_last_paid_order_id IS
  'The latest production Google order this purchase was observed paid with: a positive base-price '
  'charge while access was active. Kept when a later observation is not paid; a later paid order counts as a '
  'renewal only when this is already set.';
