-- Schemas touched/read explicitly: auth, org, sync, ai, support, billing, community, content, progress, security, pg_catalog.
-- Owner-only until the separate proof/consent wrapper is available.
CREATE TABLE auth.account_union_receipts (
  operation_id UUID PRIMARY KEY,
  source_user_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  authorized_preview JSONB NOT NULL,
  result JSONB NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (source_user_id <> target_user_id)
);
REVOKE ALL ON auth.account_union_receipts FROM PUBLIC, backend_app, auth_app, reporting_readonly;

-- A preview contains only hashes of owner rows; credential secrets never leave the function.
-- Limits are execution budgets, not account/product limits. An oversized request must be re-scoped.
CREATE FUNCTION auth.preview_account_union(source_user_id TEXT, target_user_id TEXT,
  row_limit INTEGER, workspace_limit INTEGER) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE account_ids TEXT[] := ARRAY[source_user_id, target_user_id]; workspace_ids UUID[];
  owner_count INTEGER; fingerprint TEXT; roots JSONB; preferred UUID; suppressed UUID[];
BEGIN
  IF row_limit IS NULL OR row_limit NOT BETWEEN 1 AND 50000
    OR workspace_limit IS NULL OR workspace_limit NOT BETWEEN 1 AND 256 THEN
    RAISE EXCEPTION 'Account union requires row budget 1..50000 and workspace budget 1..256'
      USING ERRCODE = '54000';
  END IF;
  IF source_user_id IS NULL OR target_user_id IS NULL OR source_user_id = target_user_id
    OR btrim(source_user_id) = '' OR btrim(target_user_id) = '' THEN
    RAISE EXCEPTION 'Account union requires two distinct accounts' USING ERRCODE = '23514';
  END IF;
  PERFORM auth.assert_account_live(source_user_id);
  PERFORM auth.assert_account_live(target_user_id);
  IF (SELECT count(*) FROM org.user_settings WHERE user_id = ANY(account_ids)) <> 2
    OR (SELECT count(DISTINCT user_id) FROM auth.user_identities
      WHERE user_id = ANY(account_ids) AND provider_type = 'cognito') <> 2 THEN
    RAISE EXCEPTION 'Account union requires two existing established account profiles' USING ERRCODE = '23514';
  END IF;
  SELECT ARRAY(SELECT DISTINCT workspace_id FROM org.workspace_memberships
    WHERE user_id = ANY(account_ids) ORDER BY workspace_id LIMIT workspace_limit + 1) INTO workspace_ids;
  IF cardinality(workspace_ids) NOT BETWEEN 1 AND workspace_limit THEN
    RAISE EXCEPTION 'Account union workspace inventory is empty or exceeds its budget' USING ERRCODE = '54000';
  END IF;
  WITH owner_rows AS MATERIALIZED (
    SELECT 'org.user_settings' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM org.user_settings AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'auth.account_retirements' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM auth.account_retirements AS r WHERE r.canonical_user_id = ANY(account_ids)
    UNION ALL
    SELECT 'auth.user_identities' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM auth.user_identities AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'auth.agent_api_keys' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM auth.agent_api_keys AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'auth.oauth_connections' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM auth.oauth_connections AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'auth.guest_sessions' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM auth.guest_sessions AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'org.workspace_memberships' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM org.workspace_memberships AS r WHERE r.workspace_id = ANY(workspace_ids)
    UNION ALL
    SELECT 'sync.installations' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM sync.installations AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'sync.workspace_replicas' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM sync.workspace_replicas AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'ai.chat_sessions' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM ai.chat_sessions AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'ai.chat_files' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM ai.chat_files AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'support.feedback_prompt_events' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM support.feedback_prompt_events AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'support.feedback_submissions' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM support.feedback_submissions AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'ai.consent_identities' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM ai.consent_identities AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'billing.purchases' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM billing.purchases AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'billing.grants' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM billing.grants AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'billing.stripe_customer_identities' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM billing.stripe_customer_identities AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'billing.stripe_checkout_attempts' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM billing.stripe_checkout_attempts AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'billing.history_subjects' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM billing.history_subjects AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'billing.user_billing_state' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM billing.user_billing_state AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'billing.entitlement_snapshots' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM billing.entitlement_snapshots AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'ai.usage_events' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM ai.usage_events AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'community.public_profiles' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM community.public_profiles AS r WHERE r.user_id = ANY(account_ids)
    UNION ALL
    SELECT 'community.public_profile_aliases' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM community.public_profile_aliases AS r WHERE r.canonical_public_profile_id IN (SELECT public_profile_id FROM community.public_profiles WHERE user_id = ANY(account_ids))
    UNION ALL
    SELECT 'community.friendships' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM community.friendships AS r WHERE r.viewer_user_id = ANY(account_ids) OR r.friend_user_id = ANY(account_ids)
    UNION ALL
    SELECT 'community.friend_invitations' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM community.friend_invitations AS r WHERE r.inviter_user_id = ANY(account_ids) OR r.accepted_by_user_id = ANY(account_ids)
    UNION ALL
    SELECT 'content.review_events' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM content.review_events AS r WHERE r.reviewed_by_user_id = ANY(account_ids)
    UNION ALL
    SELECT 'community.public_review_activity_facts' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM community.public_review_activity_facts AS r WHERE r.reviewed_by_user_id = ANY(account_ids) OR r.public_profile_id IN (SELECT public_profile_id FROM community.public_profiles WHERE user_id = ANY(account_ids))
    UNION ALL
    SELECT 'progress.user_active_review_days' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM progress.user_active_review_days AS r WHERE r.reviewed_by_user_id = ANY(account_ids)
    UNION ALL
    SELECT 'community.leaderboard_snapshot_entries' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM community.leaderboard_snapshot_entries AS r WHERE r.public_profile_id IN (SELECT public_profile_id FROM community.public_profiles WHERE user_id = ANY(account_ids))
    UNION ALL
    SELECT 'community.streak_leaderboard_snapshot_entries' AS category, encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex') AS digest FROM community.streak_leaderboard_snapshot_entries AS r WHERE r.public_profile_id IN (SELECT public_profile_id FROM community.public_profiles WHERE user_id = ANY(account_ids))
    LIMIT row_limit + 1
  )
  SELECT count(*)::INTEGER, encode(sha256(convert_to(COALESCE(string_agg(category || ':' || digest, ',' ORDER BY category, digest), ''), 'UTF8')), 'hex')
    INTO owner_count, fingerprint FROM owner_rows;
  IF owner_count > row_limit THEN
    RAISE EXCEPTION 'Account union owner inventory exceeds its row budget' USING ERRCODE = '54000';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('workspace', to_jsonb(workspace),
    'unusedStarter', org.workspace_is_unused_starter(workspace.workspace_id)) ORDER BY workspace.workspace_id)
    INTO roots FROM org.workspaces AS workspace WHERE workspace.workspace_id = ANY(workspace_ids);
  SELECT workspace.workspace_id INTO preferred FROM org.workspaces AS workspace
  WHERE workspace.workspace_id = ANY(workspace_ids)
  ORDER BY org.workspace_is_unused_starter(workspace.workspace_id),
    workspace.workspace_id IS DISTINCT FROM (SELECT workspace_id FROM org.user_settings WHERE user_id = target_user_id),
    workspace.workspace_id IS DISTINCT FROM (SELECT workspace_id FROM org.user_settings WHERE user_id = source_user_id),
    workspace.created_at, workspace.workspace_id LIMIT 1;
  SELECT ARRAY(SELECT workspace_id FROM org.workspaces WHERE workspace_id = ANY(workspace_ids)
    AND workspace_id <> preferred AND org.workspace_is_unused_starter(workspace_id) ORDER BY workspace_id)
    INTO suppressed;
  RETURN jsonb_build_object('sourceUserId', source_user_id, 'targetUserId', target_user_id,
    'rowLimit', row_limit, 'workspaceLimit', workspace_limit, 'ownerRows', owner_count,
    'fingerprint', fingerprint, 'workspaces', roots, 'workspaceIds', workspace_ids,
    'selectedWorkspaceId', preferred, 'suppressedWorkspaceIds', suppressed,
    'settingsPolicy', 'target_with_restrictive_privacy', 'publicProfilePolicy', 'target_with_restrictive_visibility');
END;
$$;
REVOKE ALL ON FUNCTION auth.preview_account_union(TEXT, TEXT, INTEGER, INTEGER)
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;

-- Fresh READ COMMITTED, finite statement_timeout <=15s, no preceding ordinary scopes/row locks.
-- A proof wrapper first takes lock_account_retirement, then validates/consumes proofs in this
-- transaction. Its receipt-replay branch must bind operation, pair and authorized preview exactly.
CREATE FUNCTION auth.combine_proved_accounts(target_operation_id UUID, source_user_id TEXT,
  target_user_id TEXT, expected_preview JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET lock_timeout = '2s' AS $$
DECLARE receipt auth.account_union_receipts%ROWTYPE; actual_preview JSONB; workspace_ids UUID[];
  selected_id UUID; suppressed_ids UUID[]; item TEXT; workspace UUID; result JSONB;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed'
    OR current_setting('statement_timeout')::INTERVAL NOT BETWEEN interval '1 millisecond' AND interval '15 seconds' THEN
    RAISE EXCEPTION 'Account union requires fresh READ COMMITTED and a statement timeout of at most 15 seconds'
      USING ERRCODE = 'P0A01';
  END IF;
  IF target_operation_id IS NULL OR expected_preview IS NULL OR jsonb_typeof(expected_preview) <> 'object' THEN
    RAISE EXCEPTION 'Account union requires an operation id and exact authorized preview' USING ERRCODE = '23514';
  END IF;
  -- An immutable receipt is safe to read before locks, including after a later union/deletion.
  SELECT * INTO receipt FROM auth.account_union_receipts WHERE operation_id = target_operation_id;
  IF FOUND THEN
    IF receipt.source_user_id IS DISTINCT FROM source_user_id OR receipt.target_user_id IS DISTINCT FROM target_user_id
      OR receipt.authorized_preview IS DISTINCT FROM expected_preview THEN
      RAISE EXCEPTION 'Account union operation is bound to different inputs' USING ERRCODE = '23514';
    END IF;
    RETURN receipt.result;
  END IF;
  BEGIN
    PERFORM auth.lock_account_retirement(source_user_id, target_user_id);
  EXCEPTION WHEN SQLSTATE 'P0A01' THEN
    -- A concurrent identical operation may have committed while this call waited for subjects.
    SELECT * INTO receipt FROM auth.account_union_receipts WHERE operation_id = target_operation_id;
    IF NOT FOUND THEN RAISE; END IF;
    IF receipt.source_user_id IS DISTINCT FROM source_user_id OR receipt.target_user_id IS DISTINCT FROM target_user_id
      OR receipt.authorized_preview IS DISTINCT FROM expected_preview THEN
      RAISE EXCEPTION 'Account union operation is bound to different inputs' USING ERRCODE = '23514';
    END IF;
    RETURN receipt.result;
  END;
  PERFORM 1 FROM org.user_settings WHERE user_id IN (source_user_id, target_user_id) ORDER BY user_id FOR UPDATE;
  actual_preview := auth.preview_account_union(source_user_id, target_user_id,
    (expected_preview->>'rowLimit')::INTEGER, (expected_preview->>'workspaceLimit')::INTEGER);
  IF actual_preview IS DISTINCT FROM expected_preview THEN
    RAISE EXCEPTION 'Account union preview changed; obtain fresh proof and consent' USING ERRCODE = 'P0A01';
  END IF;
  SELECT ARRAY(SELECT value::UUID FROM jsonb_array_elements_text(actual_preview->'workspaceIds')) INTO workspace_ids;
  FOREACH workspace IN ARRAY workspace_ids LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(workspace::TEXT, 1::BIGINT));
  END LOOP;
  FOR item IN SELECT unnest(ARRAY[source_user_id, target_user_id]) ORDER BY 1 LOOP
    FOREACH workspace IN ARRAY workspace_ids LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended(item || ':' || workspace::TEXT, 0::BIGINT));
    END LOOP;
  END LOOP;
  PERFORM 1 FROM org.workspace_memberships WHERE workspace_id = ANY(workspace_ids)
    ORDER BY workspace_id, user_id FOR UPDATE;
  PERFORM 1 FROM org.workspaces WHERE workspace_id = ANY(workspace_ids) ORDER BY workspace_id FOR UPDATE;
  actual_preview := auth.preview_account_union(source_user_id, target_user_id,
    (expected_preview->>'rowLimit')::INTEGER, (expected_preview->>'workspaceLimit')::INTEGER);
  IF actual_preview IS DISTINCT FROM expected_preview THEN
    RAISE EXCEPTION 'Account union workspace inventory changed; obtain fresh proof and consent' USING ERRCODE = 'P0A01';
  END IF;
  selected_id := (actual_preview->>'selectedWorkspaceId')::UUID;
  SELECT ARRAY(SELECT value::UUID FROM jsonb_array_elements_text(actual_preview->'suppressedWorkspaceIds')) INTO suppressed_ids;
  INSERT INTO org.workspace_memberships(workspace_id, user_id, role)
    SELECT workspace_id, target_user_id, role FROM org.workspace_memberships WHERE user_id = source_user_id
    ON CONFLICT (workspace_id, user_id) DO UPDATE SET role =
      CASE WHEN org.workspace_memberships.role = 'owner' OR EXCLUDED.role = 'owner' THEN 'owner' ELSE EXCLUDED.role END;
  DELETE FROM org.workspace_memberships WHERE user_id = source_user_id;
  UPDATE sync.installations SET user_id = target_user_id WHERE user_id = source_user_id;
  UPDATE sync.workspace_replicas SET user_id = target_user_id WHERE user_id = source_user_id;
  UPDATE ai.chat_sessions SET user_id = target_user_id WHERE user_id = source_user_id;
  UPDATE ai.chat_files SET user_id = target_user_id WHERE user_id = source_user_id;
  UPDATE support.feedback_prompt_events SET user_id = target_user_id WHERE user_id = source_user_id;
  UPDATE support.feedback_submissions SET user_id = target_user_id WHERE user_id = source_user_id;
  UPDATE ai.consent_identities SET user_id = target_user_id WHERE user_id = source_user_id;
  UPDATE org.user_settings AS target SET workspace_id = selected_id,
    analytics_consent = CASE WHEN source.analytics_consent = 'declined' OR target.analytics_consent = 'declined'
      THEN 'declined' ELSE target.analytics_consent END,
    product_analytics_enabled = CASE WHEN source.product_analytics_enabled = false OR target.product_analytics_enabled = false
      THEN false ELSE target.product_analytics_enabled END
    FROM org.user_settings AS source WHERE target.user_id = target_user_id AND source.user_id = source_user_id;
  PERFORM billing.transfer_account_billing(source_user_id, target_user_id);
  PERFORM ai.transfer_account_usage(source_user_id, target_user_id);
  PERFORM community.transfer_account_community(source_user_id, target_user_id);
  UPDATE auth.user_identities SET user_id = target_user_id WHERE user_id = source_user_id;
  UPDATE auth.agent_api_keys SET user_id = target_user_id WHERE user_id = source_user_id;
  UPDATE auth.oauth_connections SET user_id = target_user_id WHERE user_id = source_user_id;
  -- The same live classifier revalidates suppression; no backing row is removed.
  UPDATE org.workspaces SET starter_suppressed_at = COALESCE(starter_suppressed_at, clock_timestamp())
    WHERE workspace_id = ANY(suppressed_ids) AND org.workspace_is_unused_starter(workspace_id);
  PERFORM auth.record_account_retirement(source_user_id, target_user_id, target_operation_id);
  result := jsonb_build_object('operationId', target_operation_id, 'sourceUserId', source_user_id,
    'canonicalAccountId', target_user_id, 'selectedWorkspaceId', selected_id,
    'workspaceIds', workspace_ids, 'suppressedWorkspaceIds', suppressed_ids);
  INSERT INTO auth.account_union_receipts(operation_id, source_user_id, target_user_id, authorized_preview, result)
    VALUES (target_operation_id, source_user_id, target_user_id, expected_preview, result);
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION auth.combine_proved_accounts(UUID, TEXT, TEXT, JSONB)
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;

-- Scoped discovery exposes only the current owner's flat retired aliases.
CREATE FUNCTION auth.account_retirement_aliases() RETURNS TEXT[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT ARRAY(SELECT retired_user_id FROM auth.account_retirements
    WHERE canonical_user_id = security.current_user_id() ORDER BY retired_user_id);
$$;
REVOKE ALL ON FUNCTION auth.account_retirement_aliases() FROM PUBLIC, auth_app, reporting_readonly;
GRANT EXECUTE ON FUNCTION auth.account_retirement_aliases() TO backend_app;

-- Real deletion alone may erase retained snapshots; retirement never invokes this capability.
CREATE FUNCTION auth.erase_retired_account_shells() RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE current_id TEXT := security.current_user_id(); alias_id TEXT; alias_email TEXT;
BEGIN
  IF current_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.deleted_accounts
    WHERE user_id_sha256 = encode(sha256(convert_to(current_id, 'UTF8')), 'hex')) THEN
    RAISE EXCEPTION 'Retired shells may be erased only during permanent account deletion' USING ERRCODE = '42501';
  END IF;
  FOR alias_id IN SELECT unnest(auth.account_retirement_aliases()) ORDER BY 1 LOOP
    INSERT INTO auth.deleted_accounts(user_id_sha256)
      VALUES (encode(sha256(convert_to(alias_id, 'UTF8')), 'hex')) ON CONFLICT DO NOTHING;
    SELECT email INTO alias_email FROM org.user_settings WHERE user_id = alias_id FOR UPDATE;
    PERFORM auth.delete_user_auth_artifacts(alias_id, alias_email);
    DELETE FROM org.user_settings WHERE user_id = alias_id;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION auth.erase_retired_account_shells() FROM PUBLIC, auth_app, reporting_readonly;
GRANT EXECUTE ON FUNCTION auth.erase_retired_account_shells() TO backend_app;
