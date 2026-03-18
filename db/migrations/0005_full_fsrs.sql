-- Migration status: Current / canonical.
-- Introduces: persisted FSRS card state and workspace scheduler settings.
-- Current guidance: this migration remains part of the canonical scheduling model, together with docs/fsrs-scheduling-logic.md and docs/architecture.md.
-- Replaced or refined by: db/migrations/0018_auto_provision_workspaces_and_scheduler_seed.sql.
-- See also: docs/fsrs-scheduling-logic.md, docs/architecture.md.
-- Full FSRS card state and workspace-row scheduler settings.
-- Source-of-truth docs: docs/fsrs-scheduling-logic.md

ALTER TABLE content.cards
  ADD COLUMN IF NOT EXISTS fsrs_card_state TEXT NOT NULL DEFAULT 'new'
    CHECK (fsrs_card_state IN ('new', 'learning', 'review', 'relearning')),
  ADD COLUMN IF NOT EXISTS fsrs_step_index INTEGER
    CHECK (fsrs_step_index IS NULL OR fsrs_step_index >= 0),
  ADD COLUMN IF NOT EXISTS fsrs_stability DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS fsrs_difficulty DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS fsrs_last_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fsrs_scheduled_days INTEGER
    CHECK (fsrs_scheduled_days IS NULL OR fsrs_scheduled_days >= 0);

ALTER TABLE org.workspaces
  ADD COLUMN IF NOT EXISTS fsrs_algorithm TEXT NOT NULL DEFAULT 'fsrs-6'
    CHECK (fsrs_algorithm = 'fsrs-6'),
  ADD COLUMN IF NOT EXISTS fsrs_desired_retention DOUBLE PRECISION NOT NULL DEFAULT 0.90
    CHECK (fsrs_desired_retention > 0 AND fsrs_desired_retention < 1),
  ADD COLUMN IF NOT EXISTS fsrs_learning_steps_minutes JSONB NOT NULL DEFAULT '[1,10]'::jsonb
    CHECK (
      jsonb_typeof(fsrs_learning_steps_minutes) = 'array'
      AND jsonb_array_length(fsrs_learning_steps_minutes) > 0
    ),
  ADD COLUMN IF NOT EXISTS fsrs_relearning_steps_minutes JSONB NOT NULL DEFAULT '[10]'::jsonb
    CHECK (
      jsonb_typeof(fsrs_relearning_steps_minutes) = 'array'
      AND jsonb_array_length(fsrs_relearning_steps_minutes) > 0
    ),
  ADD COLUMN IF NOT EXISTS fsrs_maximum_interval_days INTEGER NOT NULL DEFAULT 36500
    CHECK (fsrs_maximum_interval_days >= 1),
  ADD COLUMN IF NOT EXISTS fsrs_enable_fuzz BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS fsrs_updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_cards_workspace_fsrs_last_reviewed_at
  ON content.cards(workspace_id, fsrs_last_reviewed_at DESC)
  WHERE deleted_at IS NULL;
