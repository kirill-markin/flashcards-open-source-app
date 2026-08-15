-- Migration status: Current / contract cleanup.
-- Introduces: removal of the retired catalog topic columns after durable replay cleanup.
-- Schemas touched/read explicitly: sync, catalog, pg_catalog.

UPDATE sync.catalog_package_install_idempotency
SET install_result = pg_catalog.jsonb_set(
  install_result,
  '{packageVersion}',
  (install_result -> 'packageVersion') - 'topicTags',
  false
)
WHERE pg_catalog.jsonb_typeof(install_result) = 'object'
  AND pg_catalog.jsonb_typeof(install_result -> 'packageVersion') = 'object'
  AND (install_result -> 'packageVersion') ? 'topicTags';

CREATE OR REPLACE FUNCTION catalog.prevent_published_package_version_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF (
      OLD.status IN ('published', 'delisted')
      OR NEW.status IN ('published', 'delisted')
    )
    AND (
      NEW.package_id IS DISTINCT FROM OLD.package_id
      OR NEW.version_number IS DISTINCT FROM OLD.version_number
      OR NEW.slug IS DISTINCT FROM OLD.slug
      OR NEW.title IS DISTINCT FROM OLD.title
      OR NEW.summary IS DISTINCT FROM OLD.summary
      OR NEW.description IS DISTINCT FROM OLD.description
      OR NEW.language_tags IS DISTINCT FROM OLD.language_tags
      OR NEW.license IS DISTINCT FROM OLD.license
      OR NEW.content_warning IS DISTINCT FROM OLD.content_warning
      OR NEW.cover_package_media_key IS DISTINCT FROM OLD.cover_package_media_key
      OR NEW.source_workspace_id IS DISTINCT FROM OLD.source_workspace_id
      OR NEW.card_count IS DISTINCT FROM OLD.card_count
      OR NEW.created_by_admin_email IS DISTINCT FROM OLD.created_by_admin_email
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
      OR (
        OLD.status IN ('published', 'delisted')
        AND NEW.published_at IS DISTINCT FROM OLD.published_at
      )
    ) THEN
    RAISE EXCEPTION 'Published catalog package versions are immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

ALTER TABLE catalog.packages
  DROP COLUMN topic_tags;

ALTER TABLE catalog.package_versions
  DROP COLUMN topic_tags;

ALTER TABLE catalog.collections
  DROP COLUMN topic_tags;
