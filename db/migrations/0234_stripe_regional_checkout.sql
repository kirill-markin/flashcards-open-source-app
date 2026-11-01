-- Schemas touched/read explicitly: billing, pg_catalog.
ALTER TABLE billing.stripe_checkout_attempts
  ADD COLUMN selected_country TEXT CHECK (selected_country ~ '^[A-Z]{2}$'),
  ADD COLUMN pricing_band TEXT NOT NULL DEFAULT 'full' CHECK (pricing_band IN ('full', 'discounted')),
  ADD COLUMN price_id TEXT,
  ADD COLUMN checkout_mode TEXT NOT NULL DEFAULT 'legacy' CHECK (checkout_mode IN ('legacy', 'managed'));

UPDATE billing.stripe_checkout_attempts SET price_id = CASE environment
  WHEN 'production' THEN 'price_1UMQUtE3K3xV54NrvU8rT8ef'
  WHEN 'sandbox' THEN 'price_1UMQUDCVkVWAch1VJzr1hELW' END;

-- Old binaries can still reserve their historical offer during a rolling deployment.
CREATE FUNCTION billing.freeze_stripe_checkout_offer() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.price_id IS NULL AND NEW.checkout_mode = 'legacy' THEN
    NEW.price_id := CASE NEW.environment
      WHEN 'production' THEN 'price_1UMQUtE3K3xV54NrvU8rT8ef'
      WHEN 'sandbox' THEN 'price_1UMQUDCVkVWAch1VJzr1hELW' END;
  ELSIF TG_OP = 'UPDATE' AND ROW(NEW.selected_country, NEW.pricing_band, NEW.price_id, NEW.checkout_mode)
    IS DISTINCT FROM ROW(OLD.selected_country, OLD.pricing_band, OLD.price_id, OLD.checkout_mode) THEN
    RAISE EXCEPTION 'Checkout offer is frozen; expire and reserve another attempt' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION billing.freeze_stripe_checkout_offer() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION billing.freeze_stripe_checkout_offer() TO backend_app;
CREATE TRIGGER stripe_checkout_frozen_offer BEFORE INSERT OR UPDATE
  ON billing.stripe_checkout_attempts FOR EACH ROW EXECUTE FUNCTION billing.freeze_stripe_checkout_offer();

ALTER TABLE billing.stripe_checkout_attempts
  ALTER COLUMN price_id SET NOT NULL,
  ADD CONSTRAINT stripe_checkout_price_valid CHECK (
    (environment = 'production' AND (
      (pricing_band = 'full' AND price_id = 'price_1UMQUtE3K3xV54NrvU8rT8ef') OR
      (pricing_band = 'discounted' AND price_id = 'price_1UWZpNE3K3xV54NrDlTNJoIl'))) OR
    (environment = 'sandbox' AND (
      (pricing_band = 'full' AND price_id = 'price_1UMQUDCVkVWAch1VJzr1hELW') OR
      (pricing_band = 'discounted' AND price_id = 'price_1UWZpMCVkVWAch1VvqKgvUc1')))),
  ADD CONSTRAINT stripe_checkout_legacy_offer CHECK (
    checkout_mode <> 'legacy' OR (selected_country IS NULL AND pricing_band = 'full'));
