-- Schemas touched/read explicitly: auth, billing, ai, org, pg_catalog.
-- Private prerequisites only; the proved-account union transaction owns activation.
CREATE FUNCTION billing.canonical_owner_id(original_user_id TEXT) RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT auth.canonical_account_id(COALESCE((
    SELECT target_user_id FROM auth.guest_upgrade_history
    WHERE source_guest_user_id = original_user_id ORDER BY merged_at DESC LIMIT 1
  ), original_user_id));
$$;
REVOKE ALL ON FUNCTION billing.canonical_owner_id(TEXT) FROM PUBLIC, auth_app, reporting_readonly;
GRANT EXECUTE ON FUNCTION billing.canonical_owner_id(TEXT) TO backend_app;

CREATE FUNCTION billing.transfer_account_billing(source_user_id TEXT, target_user_id TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE source_state billing.user_billing_state%ROWTYPE;
BEGIN
  PERFORM auth.lock_account_retirement(source_user_id, target_user_id);
  PERFORM 1 FROM org.user_settings WHERE user_id IN (source_user_id, target_user_id)
    ORDER BY user_id FOR UPDATE;
  PERFORM 1 FROM billing.stripe_customer_identities WHERE user_id IN (source_user_id, target_user_id)
    ORDER BY identity_id FOR UPDATE;
  PERFORM 1 FROM billing.stripe_checkout_attempts WHERE user_id IN (source_user_id, target_user_id)
    ORDER BY attempt_id FOR UPDATE;
  PERFORM 1 FROM billing.purchases WHERE user_id IN (source_user_id, target_user_id)
    ORDER BY purchase_id FOR UPDATE;
  PERFORM 1 FROM billing.grants WHERE user_id IN (source_user_id, target_user_id)
    ORDER BY grant_id FOR UPDATE;
  PERFORM 1 FROM billing.user_billing_state WHERE user_id IN (source_user_id, target_user_id)
    ORDER BY user_id FOR UPDATE;

  -- Customers, trial ledgers and frozen Checkout reservations retain their provider identities.
  UPDATE billing.stripe_customer_identities AS source SET is_primary = false, updated_at = now()
  WHERE source.user_id = source_user_id AND source.is_primary
    AND EXISTS (SELECT 1 FROM billing.stripe_customer_identities AS target
      WHERE target.user_id = target_user_id AND target.environment = source.environment
        AND target.is_primary AND target.account_deleted_at IS NULL);
  UPDATE billing.stripe_customer_identities SET user_id = target_user_id, updated_at = now()
    WHERE user_id = source_user_id;
  UPDATE billing.stripe_checkout_attempts SET user_id = target_user_id, updated_at = now()
    WHERE user_id = source_user_id;
  -- Combining owners is not a provider purchase transfer: retain the previous-holder fact.
  UPDATE billing.purchases SET user_id = target_user_id WHERE user_id = source_user_id;
  UPDATE billing.grants SET user_id = target_user_id WHERE user_id = source_user_id;
  UPDATE billing.history_subjects SET user_id = target_user_id, updated_at = now()
    WHERE user_id = source_user_id AND account_deleted_at IS NULL;

  SELECT * INTO source_state FROM billing.user_billing_state WHERE user_id = source_user_id;
  IF FOUND THEN
    INSERT INTO billing.user_billing_state(user_id) VALUES (target_user_id)
      ON CONFLICT (user_id) DO NOTHING;
    -- Partial unique handle indexes are immediate. Clear moving handles before assigning them.
    -- Conflicts stay on the durable source row, reachable through canonical_owner_id after retirement.
    UPDATE billing.user_billing_state AS source SET
      stripe_customer_id = CASE WHEN target.stripe_customer_id IS NULL THEN NULL ELSE source.stripe_customer_id END,
      apple_app_account_token = CASE WHEN target.apple_app_account_token IS NULL THEN NULL ELSE source.apple_app_account_token END,
      google_obfuscated_account_id = CASE WHEN target.google_obfuscated_account_id IS NULL THEN NULL ELSE source.google_obfuscated_account_id END,
      updated_at = now()
    FROM billing.user_billing_state AS target
    WHERE source.user_id = source_user_id AND target.user_id = target_user_id;
    UPDATE billing.user_billing_state SET
      trial_provider = CASE WHEN trial_consumed_at IS NULL
        OR source_state.trial_consumed_at < trial_consumed_at THEN source_state.trial_provider ELSE trial_provider END,
      trial_consumed_at = LEAST(trial_consumed_at, source_state.trial_consumed_at),
      ever_purchased_at = LEAST(ever_purchased_at, source_state.ever_purchased_at),
      stripe_customer_id = COALESCE(stripe_customer_id, source_state.stripe_customer_id),
      apple_app_account_token = COALESCE(apple_app_account_token, source_state.apple_app_account_token),
      google_obfuscated_account_id = COALESCE(google_obfuscated_account_id, source_state.google_obfuscated_account_id),
      updated_at = now()
    WHERE user_id = target_user_id;
  END IF;
  -- Provider events and native transaction facts keep their original attribution and IDs.
  DELETE FROM billing.entitlement_snapshots WHERE user_id IN (source_user_id, target_user_id);
END;
$$;
REVOKE ALL ON FUNCTION billing.transfer_account_billing(TEXT, TEXT)
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;

CREATE FUNCTION ai.transfer_account_usage(source_user_id TEXT, target_user_id TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM auth.lock_account_retirement(source_user_id, target_user_id);
  -- Every month and key type moves; workspace, request, event IDs and all consumption facts stay.
  UPDATE ai.usage_events SET user_id = target_user_id WHERE user_id = source_user_id;
END;
$$;
REVOKE ALL ON FUNCTION ai.transfer_account_usage(TEXT, TEXT)
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;
