-- Migration status: Current / canonical.
-- Introduces: immutable review authorship on raw review events and the reusable
--   public review activity fact layer (metric qualified_reviews_v1).
-- Current guidance: facts are derived backend-internal projections of review
--   events. Display names are never stored here; they stay derived at read time
--   from community.public_profiles.public_profile_id and request locale.
-- See also: db/migrations/0057_community_public_profiles.sql, docs/architecture.md.

-- 1. Immutable review authorship on raw review events.
ALTER TABLE content.review_events
  ADD COLUMN IF NOT EXISTS reviewed_by_user_id TEXT
    REFERENCES org.user_settings(user_id) ON DELETE SET NULL;

COMMENT ON COLUMN content.review_events.reviewed_by_user_id IS
  'Immutable authenticated user who recorded the review event. New writes always set it from the authenticated request scope; nullable only because historical rows can be unresolvable.';

-- Backfill historical authorship from the current replica owner. workspace_replicas.user_id
-- is the only available historical signal and is used only for this backfill; new writes never
-- infer authorship from mutable replica labels.
UPDATE content.review_events AS review_events
SET reviewed_by_user_id = workspace_replicas.user_id
FROM sync.workspace_replicas AS workspace_replicas
WHERE workspace_replicas.replica_id = review_events.replica_id
  AND review_events.reviewed_by_user_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM org.user_settings AS user_settings
    WHERE user_settings.user_id = workspace_replicas.user_id
  );

-- 2. Reusable public review activity fact table.
CREATE TABLE IF NOT EXISTS community.public_review_activity_facts (
  review_event_id     UUID        NOT NULL REFERENCES content.review_events(review_event_id) ON DELETE CASCADE,
  metric_version      TEXT        NOT NULL,
  public_profile_id   UUID        NOT NULL REFERENCES community.public_profiles(public_profile_id) ON DELETE CASCADE,
  reviewed_by_user_id TEXT        REFERENCES org.user_settings(user_id) ON DELETE SET NULL,
  rating              INTEGER     NOT NULL,
  reviewed_at_client  TIMESTAMPTZ NOT NULL,
  reviewed_at_server  TIMESTAMPTZ NOT NULL,
  is_countable        BOOLEAN     NOT NULL,
  exclusion_reason    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (review_event_id, metric_version)
);

COMMENT ON TABLE community.public_review_activity_facts IS
  'One immutable activity fact per (review event, metric version). Reusable projection for community activity reads. Never stores display names; those derive at read time from public_profile_id and locale.';
COMMENT ON COLUMN community.public_review_activity_facts.metric_version IS
  'Metric classification version. qualified_reviews_v1 counts every rating except again. New exclusion rules (for example a <1s answer guard) arrive as new exclusion reasons and/or metric versions.';
COMMENT ON COLUMN community.public_review_activity_facts.public_profile_id IS
  'Opaque community identity that owns this activity fact. Joins to community.public_profiles for read-time display-name derivation.';
COMMENT ON COLUMN community.public_review_activity_facts.reviewed_by_user_id IS
  'Authenticated author copied from content.review_events.reviewed_by_user_id at write time. Nullable only for unresolvable historical rows.';
COMMENT ON COLUMN community.public_review_activity_facts.is_countable IS
  'Whether this fact counts toward the metric. For qualified_reviews_v1 this is (rating <> 0).';
COMMENT ON COLUMN community.public_review_activity_facts.exclusion_reason IS
  'Why a fact is not countable. For qualified_reviews_v1: again for rating 0, NULL for ratings 1, 2, 3.';

CREATE INDEX IF NOT EXISTS idx_public_review_activity_facts_metric_countable_client_time
  ON community.public_review_activity_facts(metric_version, is_countable, reviewed_at_client);
CREATE INDEX IF NOT EXISTS idx_public_review_activity_facts_profile_metric_countable_client_time
  ON community.public_review_activity_facts(public_profile_id, metric_version, is_countable, reviewed_at_client);
CREATE INDEX IF NOT EXISTS idx_public_review_activity_facts_user_metric_client_time
  ON community.public_review_activity_facts(reviewed_by_user_id, metric_version, reviewed_at_client);

ALTER TABLE community.public_review_activity_facts ENABLE ROW LEVEL SECURITY;

GRANT SELECT (
  review_event_id,
  metric_version,
  public_profile_id,
  reviewed_by_user_id,
  rating,
  reviewed_at_client,
  reviewed_at_server,
  is_countable,
  exclusion_reason,
  created_at
) ON TABLE community.public_review_activity_facts TO backend_app;
GRANT INSERT (
  review_event_id,
  metric_version,
  public_profile_id,
  reviewed_by_user_id,
  rating,
  reviewed_at_client,
  reviewed_at_server,
  is_countable,
  exclusion_reason
) ON TABLE community.public_review_activity_facts TO backend_app;

DROP POLICY IF EXISTS public_review_activity_facts_self_select_runtime ON community.public_review_activity_facts;
CREATE POLICY public_review_activity_facts_self_select_runtime
  ON community.public_review_activity_facts
  FOR SELECT
  TO backend_app
  USING (reviewed_by_user_id = security.current_user_id());

DROP POLICY IF EXISTS public_review_activity_facts_self_insert_runtime ON community.public_review_activity_facts;
CREATE POLICY public_review_activity_facts_self_insert_runtime
  ON community.public_review_activity_facts
  FOR INSERT
  TO backend_app
  WITH CHECK (reviewed_by_user_id = security.current_user_id());

-- 3. Backfill facts for resolvable historical review events.
-- First ensure every historical reviewer has a stable opaque public profile so the
-- fact join below always resolves a public_profile_id.
INSERT INTO community.public_profiles (user_id, public_profile_id)
SELECT reviewer_user_ids.reviewed_by_user_id, gen_random_uuid()
FROM (
  SELECT DISTINCT review_events.reviewed_by_user_id
  FROM content.review_events AS review_events
  WHERE review_events.reviewed_by_user_id IS NOT NULL
) AS reviewer_user_ids
WHERE EXISTS (
    SELECT 1
    FROM org.user_settings AS user_settings
    WHERE user_settings.user_id = reviewer_user_ids.reviewed_by_user_id
  )
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO community.public_review_activity_facts (
  review_event_id,
  metric_version,
  public_profile_id,
  reviewed_by_user_id,
  rating,
  reviewed_at_client,
  reviewed_at_server,
  is_countable,
  exclusion_reason
)
SELECT
  review_events.review_event_id,
  'qualified_reviews_v1',
  public_profiles.public_profile_id,
  review_events.reviewed_by_user_id,
  review_events.rating,
  review_events.reviewed_at_client,
  review_events.reviewed_at_server,
  (review_events.rating <> 0),
  CASE WHEN review_events.rating = 0 THEN 'again' ELSE NULL END
FROM content.review_events AS review_events
JOIN community.public_profiles AS public_profiles
  ON public_profiles.user_id = review_events.reviewed_by_user_id
WHERE review_events.reviewed_by_user_id IS NOT NULL
ON CONFLICT (review_event_id, metric_version) DO NOTHING;
