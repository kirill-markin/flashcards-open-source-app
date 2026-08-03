-- Migration status: Current / additive.
-- Introduces: deterministic public catalog collection content for end-to-end testing.
-- Schemas touched/read explicitly: catalog, pg_catalog.

DO $migration$
DECLARE
  fixture_collection_id CONSTANT UUID := '00000000-0000-4000-a107-000000000001';
  fixture_package_id CONSTANT UUID := '00000000-0000-4000-a105-000000000002';
  fixture_created_at CONSTANT TIMESTAMPTZ := '2026-08-03 00:00:00+00';
  fixture_published_at CONSTANT TIMESTAMPTZ := '2026-08-03 00:01:00+00';
BEGIN
  INSERT INTO catalog.collections (
    collection_id,
    slug,
    title,
    summary,
    description,
    language_tags,
    topic_tags,
    cover_package_id,
    status,
    created_at,
    updated_at,
    published_at,
    delisted_at
  )
  VALUES (
    fixture_collection_id,
    'test',
    'тест',
    'Minimal collection for catalog testing.',
    'Test-only public catalog collection for verifying ordered package membership.',
    ARRAY['und']::TEXT[],
    ARRAY['test']::TEXT[],
    fixture_package_id,
    'published',
    fixture_created_at,
    fixture_published_at,
    fixture_published_at,
    NULL
  )
  ON CONFLICT DO NOTHING;

  IF NOT EXISTS (
    SELECT 1
    FROM catalog.collections AS collections
    WHERE collections.collection_id = fixture_collection_id
      AND collections.slug = 'test'
      AND collections.title = 'тест'
      AND collections.summary = 'Minimal collection for catalog testing.'
      AND collections.description = 'Test-only public catalog collection for verifying ordered package membership.'
      AND collections.language_tags = ARRAY['und']::TEXT[]
      AND collections.topic_tags = ARRAY['test']::TEXT[]
      AND collections.cover_package_id = fixture_package_id
      AND collections.status = 'published'
      AND collections.created_at = fixture_created_at
      AND collections.updated_at = fixture_published_at
      AND collections.published_at = fixture_published_at
      AND collections.delisted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Catalog test collection identity conflicts with incompatible pre-existing content'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO catalog.collection_packages (
    collection_id,
    package_id,
    ordinal,
    created_at
  )
  VALUES (
    fixture_collection_id,
    fixture_package_id,
    1,
    fixture_created_at
  )
  ON CONFLICT DO NOTHING;

  IF (
    SELECT pg_catalog.count(*)
    FROM catalog.collection_packages AS collection_packages
    WHERE collection_packages.collection_id = fixture_collection_id
  ) <> 1 OR NOT EXISTS (
    SELECT 1
    FROM catalog.collection_packages AS collection_packages
    WHERE collection_packages.collection_id = fixture_collection_id
      AND collection_packages.package_id = fixture_package_id
      AND collection_packages.ordinal = 1
      AND collection_packages.created_at = fixture_created_at
  ) THEN
    RAISE EXCEPTION 'Catalog test collection packages conflict with incompatible pre-existing content'
      USING ERRCODE = '23505';
  END IF;
END;
$migration$;
