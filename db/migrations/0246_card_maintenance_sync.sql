-- Schemas touched/read explicitly: content.

ALTER TABLE content.cards
  ADD COLUMN maintenance_revision bigint NOT NULL DEFAULT 0
    CHECK (maintenance_revision BETWEEN 0 AND 9007199254740991),
  ADD COLUMN maintenance_reset_at timestamptz,
  ADD COLUMN maintenance_tag_removals jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN maintenance_snapshot_lww_at timestamptz,
  ADD COLUMN maintenance_snapshot_published_at timestamptz;
