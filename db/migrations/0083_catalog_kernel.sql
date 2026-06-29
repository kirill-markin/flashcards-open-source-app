-- Migration status: Current / additive.
-- Introduces: admin-authored public catalog kernel with immutable package versions.
-- Schemas touched/read explicitly: catalog, content.

CREATE SCHEMA IF NOT EXISTS catalog;

DO $$
BEGIN
  CREATE TYPE catalog.package_status AS ENUM (
    'draft',
    'submitted',
    'needs_changes',
    'approved',
    'rejected',
    'published',
    'delisted'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

CREATE TABLE IF NOT EXISTS catalog.authors (
  author_id    UUID        PRIMARY KEY,
  slug         TEXT        NOT NULL,
  display_name TEXT        NOT NULL,
  bio          TEXT,
  website_url  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT authors_slug_unique UNIQUE (slug),
  CONSTRAINT authors_slug_format CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$'),
  CONSTRAINT authors_display_name_nonempty CHECK (btrim(display_name) <> '')
);

CREATE TABLE IF NOT EXISTS catalog.packages (
  package_id               UUID                   PRIMARY KEY,
  author_id                UUID                   NOT NULL REFERENCES catalog.authors(author_id) ON DELETE RESTRICT,
  slug                     TEXT                   NOT NULL,
  title                    TEXT                   NOT NULL,
  summary                  TEXT                   NOT NULL,
  description              TEXT                   NOT NULL,
  language_tags            TEXT[]                 NOT NULL,
  topic_tags               TEXT[]                 NOT NULL,
  license                  TEXT                   NOT NULL,
  content_warning          TEXT,
  cover_package_media_key  TEXT,
  status                   catalog.package_status NOT NULL DEFAULT 'draft',
  created_at               TIMESTAMPTZ            NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ            NOT NULL DEFAULT now(),
  published_at             TIMESTAMPTZ,
  delisted_at              TIMESTAMPTZ,
  CONSTRAINT packages_slug_unique UNIQUE (slug),
  CONSTRAINT packages_slug_format CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$'),
  CONSTRAINT packages_title_nonempty CHECK (btrim(title) <> ''),
  CONSTRAINT packages_summary_nonempty CHECK (btrim(summary) <> ''),
  CONSTRAINT packages_description_nonempty CHECK (btrim(description) <> ''),
  CONSTRAINT packages_license_nonempty CHECK (btrim(license) <> ''),
  CONSTRAINT packages_language_tags_nonempty CHECK (cardinality(language_tags) > 0)
);

CREATE TABLE IF NOT EXISTS catalog.package_versions (
  package_version_id       UUID                   PRIMARY KEY,
  package_id               UUID                   NOT NULL REFERENCES catalog.packages(package_id) ON DELETE CASCADE,
  version_number           INTEGER                NOT NULL CHECK (version_number > 0),
  status                   catalog.package_status NOT NULL DEFAULT 'draft',
  slug                     TEXT                   NOT NULL,
  title                    TEXT                   NOT NULL,
  summary                  TEXT                   NOT NULL,
  description              TEXT                   NOT NULL,
  language_tags            TEXT[]                 NOT NULL,
  topic_tags               TEXT[]                 NOT NULL,
  license                  TEXT                   NOT NULL,
  content_warning          TEXT,
  cover_package_media_key  TEXT,
  source_workspace_id      UUID,
  card_count               INTEGER                NOT NULL DEFAULT 0 CHECK (card_count >= 0),
  created_by_admin_email   TEXT                   NOT NULL,
  reviewed_by_admin_email  TEXT,
  created_at               TIMESTAMPTZ            NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ            NOT NULL DEFAULT now(),
  submitted_at             TIMESTAMPTZ,
  reviewed_at              TIMESTAMPTZ,
  published_at             TIMESTAMPTZ,
  delisted_at              TIMESTAMPTZ,
  CONSTRAINT package_versions_package_number_unique UNIQUE (package_id, version_number),
  CONSTRAINT package_versions_package_version_unique UNIQUE (package_id, package_version_id),
  CONSTRAINT package_versions_slug_format CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$'),
  CONSTRAINT package_versions_title_nonempty CHECK (btrim(title) <> ''),
  CONSTRAINT package_versions_summary_nonempty CHECK (btrim(summary) <> ''),
  CONSTRAINT package_versions_description_nonempty CHECK (btrim(description) <> ''),
  CONSTRAINT package_versions_license_nonempty CHECK (btrim(license) <> ''),
  CONSTRAINT package_versions_language_tags_nonempty CHECK (cardinality(language_tags) > 0),
  CONSTRAINT package_versions_created_by_admin_email_nonempty CHECK (btrim(created_by_admin_email) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_package_versions_one_review_candidate
  ON catalog.package_versions(package_id)
  WHERE status IN ('draft', 'submitted', 'needs_changes', 'approved');

CREATE TABLE IF NOT EXISTS catalog.package_cards (
  package_card_id    UUID        PRIMARY KEY,
  package_version_id UUID        NOT NULL REFERENCES catalog.package_versions(package_version_id) ON DELETE CASCADE,
  stable_card_key    TEXT        NOT NULL,
  ordinal            INTEGER     NOT NULL CHECK (ordinal > 0),
  front_text         TEXT        NOT NULL,
  back_text          TEXT        NOT NULL,
  card_type          TEXT        NOT NULL,
  metadata           JSONB       NOT NULL,
  tags               TEXT[]      NOT NULL,
  media_asset_keys   TEXT[]      NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT package_cards_version_stable_key_unique UNIQUE (package_version_id, stable_card_key),
  CONSTRAINT package_cards_version_ordinal_unique UNIQUE (package_version_id, ordinal),
  CONSTRAINT package_cards_stable_key_nonempty CHECK (btrim(stable_card_key) <> ''),
  CONSTRAINT package_cards_front_text_nonempty CHECK (btrim(front_text) <> ''),
  CONSTRAINT package_cards_back_text_nonempty CHECK (btrim(back_text) <> ''),
  CONSTRAINT package_cards_card_type_nonempty CHECK (btrim(card_type) <> '')
);

CREATE TABLE IF NOT EXISTS catalog.package_media_assets (
  package_media_asset_id UUID        PRIMARY KEY,
  package_id             UUID        NOT NULL REFERENCES catalog.packages(package_id) ON DELETE CASCADE,
  package_version_id     UUID,
  package_media_key      TEXT        NOT NULL,
  media_blob_id          UUID        NOT NULL REFERENCES content.media_blobs(media_blob_id) ON DELETE RESTRICT,
  alt_text               TEXT,
  credit                 TEXT,
  license                TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT package_media_assets_version_package_fk
    FOREIGN KEY (package_id, package_version_id)
    REFERENCES catalog.package_versions(package_id, package_version_id)
    ON DELETE CASCADE,
  CONSTRAINT package_media_assets_key_format CHECK (package_media_key ~ '^[a-z0-9][a-z0-9._-]{0,127}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_package_media_assets_draft_key_unique
  ON catalog.package_media_assets(package_id, package_media_key)
  WHERE package_version_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_package_media_assets_version_key_unique
  ON catalog.package_media_assets(package_version_id, package_media_key)
  WHERE package_version_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_package_media_assets_media_blob
  ON catalog.package_media_assets(media_blob_id);

CREATE TABLE IF NOT EXISTS catalog.collections (
  collection_id            UUID                   PRIMARY KEY,
  slug                     TEXT                   NOT NULL,
  title                    TEXT                   NOT NULL,
  summary                  TEXT                   NOT NULL,
  description              TEXT                   NOT NULL,
  language_tags            TEXT[]                 NOT NULL,
  topic_tags               TEXT[]                 NOT NULL,
  cover_package_id         UUID REFERENCES catalog.packages(package_id) ON DELETE SET NULL,
  status                   catalog.package_status NOT NULL DEFAULT 'draft',
  created_at               TIMESTAMPTZ            NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ            NOT NULL DEFAULT now(),
  published_at             TIMESTAMPTZ,
  delisted_at              TIMESTAMPTZ,
  CONSTRAINT collections_slug_unique UNIQUE (slug),
  CONSTRAINT collections_slug_format CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$'),
  CONSTRAINT collections_title_nonempty CHECK (btrim(title) <> ''),
  CONSTRAINT collections_summary_nonempty CHECK (btrim(summary) <> ''),
  CONSTRAINT collections_description_nonempty CHECK (btrim(description) <> ''),
  CONSTRAINT collections_language_tags_nonempty CHECK (cardinality(language_tags) > 0)
);

CREATE TABLE IF NOT EXISTS catalog.collection_packages (
  collection_id UUID        NOT NULL REFERENCES catalog.collections(collection_id) ON DELETE CASCADE,
  package_id    UUID        NOT NULL REFERENCES catalog.packages(package_id) ON DELETE CASCADE,
  ordinal       INTEGER     NOT NULL CHECK (ordinal > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_id, package_id),
  CONSTRAINT collection_packages_collection_ordinal_unique UNIQUE (collection_id, ordinal)
);

CREATE TABLE IF NOT EXISTS catalog.package_review_events (
  package_review_event_id UUID                   PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id              UUID                   NOT NULL REFERENCES catalog.packages(package_id) ON DELETE CASCADE,
  package_version_id      UUID REFERENCES catalog.package_versions(package_version_id) ON DELETE SET NULL,
  from_status             catalog.package_status,
  to_status               catalog.package_status NOT NULL,
  actor_admin_email       TEXT                   NOT NULL,
  note                    TEXT,
  created_at              TIMESTAMPTZ            NOT NULL DEFAULT now(),
  CONSTRAINT package_review_events_actor_admin_email_nonempty CHECK (btrim(actor_admin_email) <> '')
);

CREATE INDEX IF NOT EXISTS idx_package_review_events_package_created
  ON catalog.package_review_events(package_id, created_at DESC);

COMMENT ON SCHEMA catalog IS 'Admin-authored public package catalog data. Writes are exposed only through backend admin routes.';
COMMENT ON TABLE catalog.authors IS 'Catalog authors and publisher identities controlled by backend admin operators.';
COMMENT ON TABLE catalog.packages IS 'Mutable package draft metadata and current package lifecycle state.';
COMMENT ON TABLE catalog.package_versions IS 'Immutable package metadata snapshots after publication.';
COMMENT ON TABLE catalog.package_cards IS 'Package-version card snapshots. Public card text may reference package-local media keys, never storage keys.';
COMMENT ON TABLE catalog.package_media_assets IS 'Package-local media references backed by content.media_blobs.';
COMMENT ON TABLE catalog.collections IS 'Admin-authored package collections for future marketplace grouping.';
COMMENT ON TABLE catalog.collection_packages IS 'Ordered package membership for catalog collections.';
COMMENT ON TABLE catalog.package_review_events IS 'Append-only package and package-version review/status history.';
COMMENT ON COLUMN catalog.package_media_assets.package_media_key IS 'Stable package-local media key referenced from package cards and cover metadata.';
COMMENT ON COLUMN catalog.package_media_assets.media_blob_id IS 'Deduplicated blob metadata row. Physical bytes remain in private object storage.';
COMMENT ON COLUMN catalog.package_versions.source_workspace_id IS 'Optional source workspace used to build this immutable catalog version snapshot.';

CREATE OR REPLACE FUNCTION catalog.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION catalog.package_status_transition_allowed(
  from_status catalog.package_status,
  to_status catalog.package_status
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT from_status = to_status
    OR (from_status = 'draft' AND to_status IN ('submitted', 'rejected'))
    OR (from_status = 'submitted' AND to_status IN ('needs_changes', 'approved', 'rejected'))
    OR (from_status = 'needs_changes' AND to_status IN ('submitted', 'rejected'))
    OR (from_status = 'approved' AND to_status IN ('published', 'rejected'))
    OR (from_status = 'published' AND to_status = 'delisted');
$$;

CREATE OR REPLACE FUNCTION catalog.assert_package_version_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
    AND catalog.package_status_transition_allowed(OLD.status, NEW.status) = false THEN
    RAISE EXCEPTION 'Invalid catalog package version status transition from % to %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

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
      OR NEW.topic_tags IS DISTINCT FROM OLD.topic_tags
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

CREATE OR REPLACE FUNCTION catalog.prevent_published_package_version_child_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  old_status catalog.package_status;
  new_status catalog.package_status;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.package_version_id IS NOT NULL THEN
      SELECT package_versions.status
      INTO new_status
      FROM catalog.package_versions AS package_versions
      WHERE package_versions.package_version_id = NEW.package_version_id;

      IF new_status IN ('published', 'delisted') THEN
        RAISE EXCEPTION 'Published catalog package version child rows are immutable'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.package_version_id IS NOT NULL THEN
      SELECT package_versions.status
      INTO old_status
      FROM catalog.package_versions AS package_versions
      WHERE package_versions.package_version_id = OLD.package_version_id;

      IF old_status IN ('published', 'delisted') THEN
        RAISE EXCEPTION 'Published catalog package version child rows are immutable'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    IF NEW.package_version_id IS NOT NULL THEN
      SELECT package_versions.status
      INTO new_status
      FROM catalog.package_versions AS package_versions
      WHERE package_versions.package_version_id = NEW.package_version_id;

      IF new_status IN ('published', 'delisted') THEN
        RAISE EXCEPTION 'Published catalog package version child rows are immutable'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.package_version_id IS NOT NULL THEN
      SELECT package_versions.status
      INTO old_status
      FROM catalog.package_versions AS package_versions
      WHERE package_versions.package_version_id = OLD.package_version_id;

      IF old_status IN ('published', 'delisted') THEN
        RAISE EXCEPTION 'Published catalog package version child rows are immutable'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'Unsupported catalog package version child trigger operation: %', TG_OP
    USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS authors_set_updated_at ON catalog.authors;
CREATE TRIGGER authors_set_updated_at
  BEFORE UPDATE ON catalog.authors
  FOR EACH ROW
  EXECUTE FUNCTION catalog.set_updated_at();

DROP TRIGGER IF EXISTS packages_set_updated_at ON catalog.packages;
CREATE TRIGGER packages_set_updated_at
  BEFORE UPDATE ON catalog.packages
  FOR EACH ROW
  EXECUTE FUNCTION catalog.set_updated_at();

DROP TRIGGER IF EXISTS package_versions_set_updated_at ON catalog.package_versions;
CREATE TRIGGER package_versions_set_updated_at
  BEFORE UPDATE ON catalog.package_versions
  FOR EACH ROW
  EXECUTE FUNCTION catalog.set_updated_at();

DROP TRIGGER IF EXISTS package_versions_status_transition ON catalog.package_versions;
CREATE TRIGGER package_versions_status_transition
  BEFORE UPDATE OF status ON catalog.package_versions
  FOR EACH ROW
  EXECUTE FUNCTION catalog.assert_package_version_status_transition();

DROP TRIGGER IF EXISTS package_versions_published_immutable ON catalog.package_versions;
CREATE TRIGGER package_versions_published_immutable
  BEFORE UPDATE ON catalog.package_versions
  FOR EACH ROW
  EXECUTE FUNCTION catalog.prevent_published_package_version_update();

DROP TRIGGER IF EXISTS package_cards_set_updated_at ON catalog.package_cards;
CREATE TRIGGER package_cards_set_updated_at
  BEFORE UPDATE ON catalog.package_cards
  FOR EACH ROW
  EXECUTE FUNCTION catalog.set_updated_at();

DROP TRIGGER IF EXISTS package_cards_published_immutable ON catalog.package_cards;
CREATE TRIGGER package_cards_published_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON catalog.package_cards
  FOR EACH ROW
  EXECUTE FUNCTION catalog.prevent_published_package_version_child_mutation();

DROP TRIGGER IF EXISTS package_media_assets_set_updated_at ON catalog.package_media_assets;
CREATE TRIGGER package_media_assets_set_updated_at
  BEFORE UPDATE ON catalog.package_media_assets
  FOR EACH ROW
  EXECUTE FUNCTION catalog.set_updated_at();

DROP TRIGGER IF EXISTS package_media_assets_published_immutable ON catalog.package_media_assets;
CREATE TRIGGER package_media_assets_published_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON catalog.package_media_assets
  FOR EACH ROW
  EXECUTE FUNCTION catalog.prevent_published_package_version_child_mutation();

DROP TRIGGER IF EXISTS collections_set_updated_at ON catalog.collections;
CREATE TRIGGER collections_set_updated_at
  BEFORE UPDATE ON catalog.collections
  FOR EACH ROW
  EXECUTE FUNCTION catalog.set_updated_at();

GRANT USAGE ON SCHEMA catalog TO backend_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  catalog.authors,
  catalog.packages,
  catalog.package_versions,
  catalog.package_cards,
  catalog.package_media_assets,
  catalog.collections,
  catalog.collection_packages,
  catalog.package_review_events
TO backend_app;
