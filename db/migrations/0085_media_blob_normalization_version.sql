-- Migration status: Current / additive.
-- Introduces: media blob normalization pipeline version metadata.
-- Schemas touched/read explicitly: content.

ALTER TABLE content.media_blobs
  ADD COLUMN IF NOT EXISTS normalization_version TEXT NOT NULL DEFAULT 'passthrough-v1';

ALTER TABLE content.media_blobs
  DROP CONSTRAINT IF EXISTS media_blobs_normalization_version_supported,
  ADD CONSTRAINT media_blobs_normalization_version_supported
    CHECK (normalization_version IN ('passthrough-v1', 'image-jpeg-card-v1'));

COMMENT ON COLUMN content.media_blobs.normalization_version IS
  'Normalization pipeline version applied before blob storage. Existing unnormalized blobs default to passthrough-v1.';
