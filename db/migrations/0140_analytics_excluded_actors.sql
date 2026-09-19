-- Migration status: Current / additive.
-- Introduces: analytics.excluded_actors and the two triggers that make a restore final, the one list
--   of actors that are not real people, so every analytics surface excludes the same set instead of
--   restating its own inline exclusions.
-- Schemas touched/read explicitly: analytics, org, pg_catalog.

-- actor_id is TEXT rather than UUID because the two id spaces that have to be excluded are compared
-- as text today: analytics reports match `analytics.product_events_resolved.actor_id::text`, while
-- the global snapshot counts `sync.workspace_replicas.user_id`, which is TEXT and is not guaranteed
-- to hold a UUID - db/migrations/0001_initial_schema.sql seeds org.user_settings with the id 'local'.
-- A UUID column would force a cast on that side that raises invalid_text_representation on such a
-- row. The normalization CHECK follows auth.admin_users.admin_users_email_normalized, so the stored
-- key is always lower case and trimmed, and every reader has to fold its own side to match it. The
-- admin SQL already folds the org user-id side with pg_catalog.lower(...), but
-- apps/backend/src/globalMetrics/reporting.ts joins and counts sync.workspace_replicas.user_id raw,
-- and that column is unconstrained TEXT: the snapshot side must compare
-- pg_catalog.lower(pg_catalog.btrim(workspace_replicas.user_id)) against actor_id, the same fold the
-- delete guard applies to org.user_settings.user_id. Comparing the raw column instead fails silently
-- as a non-exclusion rather than as an error.
CREATE TABLE analytics.excluded_actors (
  actor_id TEXT PRIMARY KEY,
  excluded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  excluded_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('automatic', 'manual')),
  restored_at TIMESTAMPTZ,
  restored_by TEXT,
  CONSTRAINT excluded_actors_actor_id_normalized CHECK (
    actor_id = pg_catalog.lower(pg_catalog.btrim(actor_id))
  ),
  CONSTRAINT excluded_actors_actor_id_short CHECK (
    pg_catalog.length(actor_id) BETWEEN 1 AND 200
  ),
  CONSTRAINT excluded_actors_excluded_by_short CHECK (
    pg_catalog.length(pg_catalog.btrim(excluded_by)) BETWEEN 1 AND 200
  ),
  CONSTRAINT excluded_actors_reason_short CHECK (
    pg_catalog.length(pg_catalog.btrim(reason)) BETWEEN 1 AND 200
  ),
  CONSTRAINT excluded_actors_restored_by_short CHECK (
    restored_by IS NULL OR pg_catalog.length(pg_catalog.btrim(restored_by)) BETWEEN 1 AND 200
  ),
  CONSTRAINT excluded_actors_restore_shape CHECK ((restored_at IS NULL) = (restored_by IS NULL)),
  CONSTRAINT excluded_actors_restored_after_excluded CHECK (
    restored_at IS NULL OR restored_at >= excluded_at
  )
);

COMMENT ON TABLE analytics.excluded_actors IS
  'Actors that no human produced, excluded from every analytics surface. An exclusion is active while '
  'restored_at IS NULL, and a human restore is recorded on the row instead of deleting it. The restore '
  'is final, and two triggers are what enforce that. excluded_actors_restore_is_final raises 23514 '
  'when an UPDATE clears restored_at on an already restored row, edits excluded_at, excluded_by or '
  'source there, or rewrites the restored_at or restored_by already recorded there, so a detector '
  'reaching for INSERT ... ON CONFLICT (actor_id) DO UPDATE cannot re-exclude that actor, and the '
  'restoring job cannot rewrite who restored an actor or when. The trigger '
  'excluded_actors_restore_survives_live_account raises 23514 when a restored row is deleted while '
  'org.user_settings still holds the account its actor_id names, which closes the one remaining '
  'reversal route, a DELETE followed by a fresh INSERT. The grant below narrows backend_app to '
  'UPDATE (restored_at, restored_by) so a restore is the only edit a writer can attempt at all. Both '
  'triggers fire for every role, so the one sanctioned '
  'correction for a genuinely synthetic actor that a human restored by mistake is the table owner '
  'disabling the relevant trigger around the correcting statement, which is the same privileged '
  'deploy-time path scripts/deploy/migrate.sh already uses for one-off row corrections. Rows are never '
  'deleted to unexclude; unexcluding is a recorded restore. DELETE is granted for one intended caller '
  'only, the account-deletion erasure path in apps/backend/src/auth/accountDeletion.ts, and that call '
  'does not exist yet: that file does not name this table, nothing deletes from here today, and the '
  'privilege is what the later erasure step needs rather than a description of one that already runs. '
  'Until that step is written, a deleted account keeps whatever row here still names it. The history '
  'of what was excluded and when stays readable.';

COMMENT ON COLUMN analytics.excluded_actors.actor_id IS
  'The value analytics.product_events_resolved.actor_id reports for this person, stored lower-cased '
  'and trimmed. A writer reads that value off the view for the person it wants excluded instead of '
  'inferring it from an account id, a guest id or an upgrade: the resolution is defined in '
  'db/migrations/0115_product_analytics_resolved_view.sql, it is not a property of any one id the '
  'writer already holds, and it can change for a person over time. An id the view does not report '
  'matches no row there, which fails silently as a non-exclusion rather than as an error. Because '
  'the stored key is folded, every reader folds its own side before comparing: the global snapshot '
  'counts sync.workspace_replicas.user_id, an unconstrained TEXT column, so it compares that column '
  'folded rather than raw.';

COMMENT ON COLUMN analytics.excluded_actors.excluded_at IS
  'Server timestamp when this actor started being excluded from reporting.';

COMMENT ON COLUMN analytics.excluded_actors.excluded_by IS
  'Actor label that explains who excluded the actor, including job labels for an automatic decision.';

COMMENT ON COLUMN analytics.excluded_actors.reason IS
  'Short reason the writer recorded, such as the signals that identified the actor as synthetic.';

COMMENT ON COLUMN analytics.excluded_actors.source IS
  'Exclusion provenance. automatic is written by the scheduled detector; manual is operator-written.';

COMMENT ON COLUMN analytics.excluded_actors.restored_at IS
  'Server timestamp when a human put the actor back into reporting. NULL means the exclusion is '
  'active. Once set, neither it nor restored_by can be changed again; see the table comment for the '
  'one correcting path. That makes a plain restore retry fail with 23514 after a client timeout '
  'whose first attempt had committed, so the restore caller filters with AND restored_at IS NULL and '
  'does not treat zero affected rows as an error. Zero affected rows means either an already '
  'recorded restore or no row for that actor_id at all, because nothing restricts a restore request '
  'to an id that was ever excluded and this table is the only record of which ids were. A caller '
  'that has to tell the two apart re-reads the row by actor_id.';

COMMENT ON COLUMN analytics.excluded_actors.restored_by IS
  'Actor label of the human who restored the actor. Set exactly when restored_at is set.';

-- No index beside the primary key: a reader looks the actor up by actor_id and reads restored_at off
-- the row it found, and the detector inserts by the same key.

CREATE FUNCTION analytics.prevent_excluded_actor_restore_reversal()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF OLD.restored_at IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.restored_at IS NULL THEN
    RAISE EXCEPTION 'A restored analytics.excluded_actors row cannot be excluded again'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.restored_at IS DISTINCT FROM OLD.restored_at
    OR NEW.restored_by IS DISTINCT FROM OLD.restored_by
  THEN
    RAISE EXCEPTION 'The restore recorded on an analytics.excluded_actors row is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.excluded_at IS DISTINCT FROM OLD.excluded_at
    OR NEW.excluded_by IS DISTINCT FROM OLD.excluded_by
    OR NEW.source IS DISTINCT FROM OLD.source
  THEN
    RAISE EXCEPTION 'The exclusion recorded on a restored analytics.excluded_actors row is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER excluded_actors_restore_is_final
  BEFORE UPDATE ON analytics.excluded_actors
  FOR EACH ROW
  EXECUTE FUNCTION analytics.prevent_excluded_actor_restore_reversal();

-- The restore is final against UPDATE above, but backend_app also holds DELETE alongside INSERT, so
-- without this guard a DELETE followed by a fresh INSERT would re-exclude a person a human restored,
-- in two statements and with no error, leaving the settled rule to convention inside a future job
-- rather than to the database. This raises instead whenever a restored row is deleted while
-- org.user_settings still holds the account its actor_id names. The account-deletion erasure path
-- passes by construction: deleteAccountDataInExecutor deletes org.user_settings before it reaches
-- analytics, so the account is already gone by the time an erasure delete arrives here, and that
-- ordering has to stay that way. SECURITY DEFINER is required rather than stylistic:
-- org.user_settings is under row level security scoped by security.current_user_id(), so an
-- invoker-rights guard would find no row for another person's actor id and would wave exactly the
-- misuse case through. The shape follows
-- content.terminalize_media_blob_writers_before_workspace_delete() in
-- db/migrations/0102_media_blob_cleanup_reconciler.sql. The guard is deliberately narrow: an actor id
-- with no org.user_settings row, a deleted account or an anonymous id, stays deletable, because there
-- is no live person left for a re-INSERT to misrepresent.
CREATE FUNCTION analytics.prevent_restored_excluded_actor_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF OLD.restored_at IS NULL THEN
    RETURN OLD;
  END IF;
  PERFORM 1
  FROM org.user_settings AS user_settings
  WHERE pg_catalog.lower(pg_catalog.btrim(user_settings.user_id)) = OLD.actor_id;
  IF FOUND THEN
    RAISE EXCEPTION
      'A restored analytics.excluded_actors row cannot be deleted while its account still exists'
      USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER excluded_actors_restore_survives_live_account
  BEFORE DELETE ON analytics.excluded_actors
  FOR EACH ROW
  EXECUTE FUNCTION analytics.prevent_restored_excluded_actor_delete();

REVOKE ALL ON FUNCTION analytics.prevent_excluded_actor_restore_reversal()
FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION analytics.prevent_restored_excluded_actor_delete()
FROM PUBLIC, backend_app, auth_app, reporting_readonly;

ALTER TABLE analytics.excluded_actors ENABLE ROW LEVEL SECURITY;

-- backend_app records exclusions and restores. UPDATE is column-scoped to the restore, so the rest
-- of an existing row is unwritable even before the trigger runs. DELETE is for the account-deletion
-- erasure path alone, never to unexclude: unexcluding is a recorded restore. That erasure call does
-- not exist yet - apps/backend/src/auth/accountDeletion.ts does not name this table today - so
-- nothing deletes from here at all, and the privilege is what that later step needs rather than a
-- description of one that already runs.
GRANT SELECT, INSERT, DELETE ON TABLE analytics.excluded_actors TO backend_app;
GRANT UPDATE (restored_at, restored_by) ON TABLE analytics.excluded_actors TO backend_app;

CREATE POLICY excluded_actors_backend ON analytics.excluded_actors
  FOR ALL TO backend_app USING (true) WITH CHECK (true);

-- The admin dashboard runs its SQL through reporting_readonly, and
-- db/migrations/0114_product_analytics_storage.sql revoked default SELECT on tables in this schema
-- from that role, so the columns are granted explicitly.
GRANT SELECT (
  actor_id, excluded_at, excluded_by, reason, source, restored_at, restored_by
) ON TABLE analytics.excluded_actors TO reporting_readonly;

CREATE POLICY excluded_actors_reporting_readonly ON analytics.excluded_actors
  FOR SELECT TO reporting_readonly USING (true);
