-- Migration status: Current / additive.
-- Introduces: an atomic server analytics fact for the first save of each card.
-- Schemas touched/read explicitly: analytics, content, pg_catalog, security, sync.

-- A workspace replica outlives changes to the global installation's owner.
CREATE FUNCTION analytics.card_addition_replica_excluded(target_replica_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM sync.workspace_replicas AS replica
    JOIN sync.installations AS installation USING (installation_id)
    WHERE replica.replica_id = target_replica_id
      AND replica.user_id = security.current_user_id()
      AND security.current_workspace_access_allowed(replica.workspace_id)
      AND (installation.is_automation OR installation.is_test_distribution)
  );
$$;

REVOKE ALL ON FUNCTION analytics.card_addition_replica_excluded(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION analytics.card_addition_replica_excluded(UUID) TO backend_app;

CREATE FUNCTION analytics.record_card_addition_committed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  scoped_user_id TEXT := security.current_user_id();
  writer TEXT := pg_catalog.current_setting('app.card_addition_writer', true);
  replica_kind TEXT;
  replica_platform TEXT;
  is_server_addition BOOLEAN;
  observed_at TIMESTAMPTZ := pg_catalog.clock_timestamp();
  demo_status TEXT;
BEGIN
  -- The migration runs first. Older code cannot distinguish imports or guest transfers from first saves.
  IF writer IS NULL OR writer NOT IN ('save', 'import')
    OR pg_catalog.pg_input_is_valid(scoped_user_id, 'uuid') IS NOT TRUE
    OR security.current_workspace_id() IS DISTINCT FROM NEW.workspace_id
  THEN
    RETURN NEW;
  END IF;

  -- Keep the actor-kind mapping aligned with productAnalytics/serverFacts/replicaPlatforms.ts.
  SELECT replica.actor_kind, CASE
    WHEN replica.actor_kind = 'agent_connection' THEN 'agent'
    WHEN replica.actor_kind = 'ai_chat'
      THEN NULLIF(pg_catalog.current_setting('app.card_addition_chat_platform', true), '')
    WHEN replica.actor_kind = 'client_installation' AND replica.platform IN ('ios', 'android', 'web')
      THEN replica.platform
  END
  INTO replica_kind, replica_platform
  FROM sync.workspace_replicas AS replica
  WHERE replica.replica_id = NEW.last_modified_by_replica_id
    AND replica.workspace_id = NEW.workspace_id;

  IF replica_kind = 'client_installation'
    AND analytics.card_addition_replica_excluded(NEW.last_modified_by_replica_id)
  THEN
    RETURN NEW;
  END IF;

  is_server_addition := writer = 'import' OR replica_kind IN ('ai_chat', 'agent_connection');
  -- The snapshot writer has normalized the creation metadata before inserting. A baseline still
  -- marks a demo after local edits, or when the first snapshot reaching the server is a tombstone.
  demo_status := CASE
    WHEN NEW.metadata->'onboardingDemo'->'version' = '1'::jsonb THEN 'demo'
    WHEN is_server_addition OR NEW.metadata->>'creationKind' = 'user_added' THEN 'non_demo'
    ELSE 'unknown'
  END;

  INSERT INTO analytics.product_events (
    event_id, schema_version, event_name, origin, trust_level, user_id, subject_user_id,
    workspace_id, platform, server_received_at, occurred_at, event_properties
  ) VALUES (
    analytics.derive_server_event_id('card_addition_committed', ARRAY[NEW.card_id::text]),
    1, 'card_addition_committed', 'server', 'server_derived', scoped_user_id::uuid, scoped_user_id::uuid,
    NEW.workspace_id, replica_platform, observed_at,
    CASE WHEN replica_kind = 'client_installation' AND is_server_addition IS NOT TRUE
      THEN LEAST(NEW.created_at, observed_at) ELSE observed_at END,
    pg_catalog.jsonb_build_object('demo_status', demo_status)
  )
  ON CONFLICT (event_id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER card_addition_committed
AFTER INSERT ON content.cards
FOR EACH ROW
EXECUTE FUNCTION analytics.record_card_addition_committed();

REVOKE ALL ON FUNCTION analytics.record_card_addition_committed() FROM PUBLIC;
