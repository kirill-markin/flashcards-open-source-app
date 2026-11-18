-- Migration status: Current / additive.
-- Schemas touched/read explicitly: analytics, auth, content, org, pg_catalog, security, sync.

CREATE OR REPLACE FUNCTION analytics.card_addition_recovery_candidates(target_workspace_id UUID)
RETURNS TABLE (
  event_id UUID, source_event_id UUID, user_id UUID, subject_user_id UUID, actor_id UUID,
  workspace_id UUID, platform TEXT, occurred_at TIMESTAMPTZ, server_received_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  caller_role TEXT := COALESCE(NULLIF(current_setting('role', true), 'none'), session_user::text);
BEGIN
  IF caller_role <> 'reporting_readonly' AND (
    caller_role <> 'backend_app' OR target_workspace_id IS NULL
    OR security.current_workspace_access_allowed(target_workspace_id) IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'Card addition recovery requires reporting access or an explicit authorized workspace scope'
      USING ERRCODE = '42501';
  END IF;

RETURN QUERY
WITH seed_workspaces AS MATERIALIZED (
  SELECT card.workspace_id
  FROM content.cards AS card
  WHERE (target_workspace_id IS NULL OR card.workspace_id = target_workspace_id)
    AND card.metadata->'onboardingDemo'->'version' = '1'::jsonb
  UNION
  SELECT event.workspace_id FROM analytics.product_events AS event
  WHERE (target_workspace_id IS NULL OR event.workspace_id = target_workspace_id)
    AND event.event_name = 'card_addition_committed' AND event.origin = 'server'
    AND event.identity_state = 'active' AND event.event_properties->>'demo_status' = 'demo'
), workspace_card_keys AS MATERIALIZED (
  SELECT card.card_id, card.workspace_id, card.created_at,
    card.metadata ? 'onboardingDemo' AS has_demo_marker,
    card.metadata->'onboardingDemo'->'version' = '1'::jsonb AS marked_demo,
    key.event_name, analytics.derive_server_event_id(key.event_name, ARRAY[card.card_id::text]) AS event_id
  FROM seed_workspaces AS workspace
  JOIN content.cards AS card ON card.workspace_id = workspace.workspace_id
  CROSS JOIN (VALUES ('card_created'::text), ('card_addition_committed'::text)) AS key(event_name)
), matched_card_events AS MATERIALIZED (
  SELECT card.card_id, card.workspace_id, card.created_at, card.has_demo_marker, card.marked_demo,
    creation.event_id AS source_event_id, creation.user_id, creation.subject_user_id, creation.platform,
    creation.occurred_at, creation.server_received_at, creation.event_properties->>'demo_status' AS demo_status
  FROM workspace_card_keys AS card
  JOIN analytics.product_events AS creation
    ON creation.event_id = card.event_id AND creation.event_name = card.event_name
  WHERE creation.workspace_id = card.workspace_id
    AND creation.identity_state = 'active'
    AND creation.user_id = creation.subject_user_id
    AND creation.user_id IS NOT NULL
    AND (caller_role = 'reporting_readonly' OR creation.user_id::text = security.current_user_id())
    AND creation.trust_level IN ('server_derived', 'backfill_derived')
    AND (
      (creation.event_name = 'card_addition_committed' AND creation.origin = 'server'
        AND creation.event_properties->>'demo_status' IN ('unknown', 'demo'))
      OR (creation.event_name = 'card_created' AND creation.origin IN ('server', 'backfill')
        AND COALESCE(creation.event_properties->>'source', 'app') = 'app'
        AND NOT EXISTS (
          SELECT 1 FROM analytics.product_events AS committed
          WHERE committed.event_id = analytics.derive_server_event_id('card_addition_committed', ARRAY[card.card_id::text])
        ))
    )
    AND creation.occurred_at <= creation.server_received_at
), original_writes AS MATERIALIZED (
  SELECT creation.*, original.replica_id AS original_replica_id
  FROM matched_card_events AS creation
  JOIN LATERAL (
    SELECT change.replica_id, change.recorded_at
    FROM sync.hot_changes AS change
    WHERE change.workspace_id = creation.workspace_id
      AND change.entity_type = 'card' AND change.entity_id = creation.card_id::text
    ORDER BY change.change_id LIMIT 1
  ) AS original ON original.recorded_at <= creation.server_received_at
  WHERE NOT EXISTS (
    SELECT 1 FROM auth.guest_upgrade_history AS upgrade
    WHERE upgrade.target_workspace_id = creation.workspace_id AND upgrade.merged_at = original.recorded_at
  )
), identity_edges AS MATERIALIZED (
  -- Keep the erasing-owner inventory aligned with auth/accountDeletion.ts.
  SELECT upgrade.source_guest_user_id AS source_user_id, upgrade.target_user_id FROM auth.guest_upgrade_history AS upgrade
  UNION
  SELECT link.anonymous_id::text, link.user_id::text FROM analytics.identity_links AS link WHERE link.source = 'server_derived'
  UNION
  SELECT retired.retired_user_id, retired.canonical_user_id FROM auth.account_retirements AS retired
), identity_owners AS MATERIALIZED (
  SELECT source_user_id, MIN(target_user_id) AS target_user_id, COUNT(*) AS owner_count
  FROM identity_edges GROUP BY source_user_id
), resolved_creations AS MATERIALIZED (
  SELECT creation.*, CASE
    WHEN pg_input_is_valid(COALESCE(owner.target_user_id, creation.user_id::text), 'uuid')
    THEN COALESCE(owner.target_user_id, creation.user_id::text)::uuid
  END AS actor_id
  FROM original_writes AS creation
  JOIN sync.workspace_replicas AS replica
    ON replica.replica_id = creation.original_replica_id AND replica.workspace_id = creation.workspace_id
    AND replica.user_id = creation.user_id::text AND replica.actor_kind = 'client_installation'
  JOIN sync.installations AS installation ON installation.installation_id = replica.installation_id
    AND NOT installation.is_automation AND NOT installation.is_test_distribution
  LEFT JOIN identity_owners AS owner ON owner.source_user_id = creation.user_id::text
  LEFT JOIN identity_owners AS indirect_owner ON indirect_owner.source_user_id = owner.target_user_id
  -- The writer and one direct owner are the entire lock inventory used by recovery.
  WHERE owner.owner_count IS NULL OR (owner.owner_count = 1 AND indirect_owner.source_user_id IS NULL)
), matched_creations AS MATERIALIZED (
  SELECT creation.*
  FROM resolved_creations AS creation
  JOIN org.user_settings AS writer_profile ON writer_profile.user_id = creation.user_id::text
  JOIN org.user_settings AS actor_profile ON actor_profile.user_id = creation.actor_id::text
  JOIN org.workspace_memberships AS membership
    ON membership.user_id = writer_profile.user_id AND membership.workspace_id = creation.workspace_id
  JOIN org.workspaces AS workspace ON workspace.workspace_id = membership.workspace_id
  WHERE NOT EXISTS (SELECT 1 FROM auth.account_retirements AS retired
    WHERE retired.retired_user_id IN (creation.user_id::text, creation.actor_id::text))
), demo_seeds AS MATERIALIZED (
  SELECT creation.workspace_id, creation.user_id, creation.subject_user_id, creation.original_replica_id,
    MIN(creation.created_at) AS seed_created_at
  FROM matched_creations AS creation
  WHERE creation.marked_demo OR creation.demo_status = 'demo'
  GROUP BY creation.workspace_id, creation.user_id, creation.subject_user_id, creation.original_replica_id
)
SELECT analytics.derive_server_event_id('card_addition_recovered', ARRAY[creation.card_id::text]) AS event_id,
  creation.source_event_id, creation.user_id, creation.subject_user_id, creation.actor_id,
  creation.workspace_id, creation.platform,
  LEAST(GREATEST(creation.created_at, creation.occurred_at), creation.server_received_at) AS occurred_at,
  creation.server_received_at
FROM matched_creations AS creation
JOIN demo_seeds AS seed
  ON seed.workspace_id = creation.workspace_id AND seed.user_id = creation.user_id
  AND seed.subject_user_id = creation.subject_user_id
  AND seed.original_replica_id = creation.original_replica_id AND seed.seed_created_at < creation.created_at
WHERE NOT creation.has_demo_marker AND creation.demo_status IS DISTINCT FROM 'demo'
  AND NOT EXISTS (SELECT 1 FROM analytics.product_events AS recovered
    WHERE recovered.event_id = analytics.derive_server_event_id('card_addition_recovered', ARRAY[creation.card_id::text]));
END;
$$;
