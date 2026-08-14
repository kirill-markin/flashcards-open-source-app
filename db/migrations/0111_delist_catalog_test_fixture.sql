-- Migration status: Current / additive.
-- Introduces: forward-only delisting of deterministic public catalog test fixtures.
-- Schemas touched/read explicitly: catalog, pg_catalog.

DO $migration$
DECLARE
  fixture_author_id CONSTANT UUID := '00000000-0000-4000-a105-000000000001';
  fixture_package_id CONSTANT UUID := '00000000-0000-4000-a105-000000000002';
  fixture_version_id CONSTANT UUID := '00000000-0000-4000-a105-000000000003';
  fixture_card_one_id CONSTANT UUID := '00000000-0000-4000-a105-000000000004';
  fixture_card_two_id CONSTANT UUID := '00000000-0000-4000-a105-000000000005';
  fixture_approval_event_id CONSTANT UUID := '00000000-0000-4000-a105-000000000006';
  fixture_publication_event_id CONSTANT UUID := '00000000-0000-4000-a105-000000000007';
  fixture_draft_event_id CONSTANT UUID := '00000000-0000-4000-a105-000000000008';
  fixture_submission_event_id CONSTANT UUID := '00000000-0000-4000-a105-000000000009';
  fixture_collection_id CONSTANT UUID := '00000000-0000-4000-a107-000000000001';
  fixture_delist_event_id CONSTANT UUID := '00000000-0000-4000-a111-000000000001';
  fixture_admin_email CONSTANT TEXT := 'catalog-system@flashcards-open-source-app.com';
  fixture_created_at CONSTANT TIMESTAMPTZ := '2026-08-02 00:00:00+00';
  fixture_submitted_at CONSTANT TIMESTAMPTZ := '2026-08-02 00:01:00+00';
  fixture_reviewed_at CONSTANT TIMESTAMPTZ := '2026-08-02 00:02:00+00';
  fixture_published_at CONSTANT TIMESTAMPTZ := '2026-08-02 00:03:00+00';
  fixture_collection_created_at CONSTANT TIMESTAMPTZ := '2026-08-03 00:00:00+00';
  fixture_collection_published_at CONSTANT TIMESTAMPTZ := '2026-08-03 00:01:00+00';
  fixture_transaction_at CONSTANT TIMESTAMPTZ := now();
  fixture_delisted_at CONSTANT TIMESTAMPTZ := fixture_transaction_at;
  fixture_author catalog.authors%ROWTYPE;
  fixture_package catalog.packages%ROWTYPE;
  fixture_version catalog.package_versions%ROWTYPE;
  fixture_collection catalog.collections%ROWTYPE;
  fixture_author_package_count BIGINT;
  fixture_version_count BIGINT;
  fixture_card_count BIGINT;
  fixture_media_asset_count BIGINT;
  fixture_review_event_count BIGINT;
  fixture_version_review_event_count BIGINT;
  fixture_membership_count BIGINT;
  fixture_package_membership_count BIGINT;
  fixture_cover_reference_count BIGINT;
  original_state_matches BOOLEAN;
  terminal_state_matches BOOLEAN;
  updated_count INTEGER;
BEGIN
  SELECT package_versions.*
  INTO fixture_version
  FROM catalog.package_versions AS package_versions
  WHERE package_versions.package_version_id = fixture_version_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Catalog test fixture package version is missing: package_version_id=%', fixture_version_id
      USING ERRCODE = '23514';
  END IF;

  SELECT packages.*
  INTO fixture_package
  FROM catalog.packages AS packages
  WHERE packages.package_id = fixture_package_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Catalog test fixture package is missing: package_id=%', fixture_package_id
      USING ERRCODE = '23514';
  END IF;

  SELECT authors.*
  INTO fixture_author
  FROM catalog.authors AS authors
  WHERE authors.author_id = fixture_author_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Catalog test fixture author is missing: author_id=%', fixture_author_id
      USING ERRCODE = '23514';
  END IF;

  SELECT collections.*
  INTO fixture_collection
  FROM catalog.collections AS collections
  WHERE collections.collection_id = fixture_collection_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Catalog test fixture collection is missing: collection_id=%', fixture_collection_id
      USING ERRCODE = '23514';
  END IF;

  PERFORM 1
  FROM catalog.collections AS collections
  WHERE collections.cover_package_id = fixture_package_id
  ORDER BY collections.collection_id
  FOR UPDATE;

  PERFORM 1
  FROM catalog.package_cards AS package_cards
  WHERE package_cards.package_version_id = fixture_version_id
  ORDER BY package_cards.package_card_id
  FOR UPDATE;

  PERFORM 1
  FROM catalog.package_media_assets AS media_assets
  WHERE media_assets.package_id = fixture_package_id
  ORDER BY media_assets.package_media_asset_id
  FOR UPDATE;

  PERFORM 1
  FROM catalog.collection_packages AS collection_packages
  WHERE collection_packages.collection_id = fixture_collection_id
    OR collection_packages.package_id = fixture_package_id
  ORDER BY collection_packages.collection_id, collection_packages.package_id
  FOR UPDATE;

  PERFORM 1
  FROM catalog.package_review_events AS review_events
  WHERE review_events.package_id = fixture_package_id
    OR review_events.package_version_id = fixture_version_id
    OR review_events.package_review_event_id = fixture_delist_event_id
  ORDER BY review_events.package_review_event_id
  FOR UPDATE;

  IF fixture_author.slug <> 'flashcards-test-catalog'
    OR fixture_author.display_name <> 'Flashcards Test Catalog'
    OR fixture_author.bio IS DISTINCT FROM 'System author for public catalog test data.'
    OR fixture_author.website_url IS NOT NULL
    OR fixture_author.created_at <> fixture_created_at
    OR fixture_author.updated_at <> fixture_created_at
  THEN
    RAISE EXCEPTION 'Catalog test fixture author conflicts with migration 0105: author_id=%', fixture_author_id
      USING ERRCODE = '23514';
  END IF;

  SELECT pg_catalog.count(*)
  INTO fixture_author_package_count
  FROM catalog.packages AS packages
  WHERE packages.author_id = fixture_author_id;

  IF fixture_author_package_count <> 1 THEN
    RAISE EXCEPTION 'Catalog test fixture author package graph conflicts: author_id=% expected_package_count=1 actual_package_count=%',
      fixture_author_id,
      fixture_author_package_count
      USING ERRCODE = '23514';
  END IF;

  IF fixture_package.author_id <> fixture_author_id
    OR fixture_package.slug <> 'test'
    OR fixture_package.title <> 'тест'
    OR fixture_package.summary <> 'Minimal package for catalog installation testing.'
    OR fixture_package.description <> 'Test-only public catalog content for verifying package installation.'
    OR fixture_package.language_tags <> ARRAY['und']::TEXT[]
    OR fixture_package.topic_tags <> ARRAY['test']::TEXT[]
    OR fixture_package.license <> 'CC0-1.0'
    OR fixture_package.content_warning IS NOT NULL
    OR fixture_package.cover_package_media_key IS NOT NULL
    OR fixture_package.created_at <> fixture_created_at
    OR fixture_package.published_at IS DISTINCT FROM fixture_published_at
  THEN
    RAISE EXCEPTION 'Catalog test fixture package conflicts with migration 0105: package_id=%', fixture_package_id
      USING ERRCODE = '23514';
  END IF;

  IF fixture_version.package_id <> fixture_package_id
    OR fixture_version.version_number <> 1
    OR fixture_version.slug <> 'test'
    OR fixture_version.title <> 'тест'
    OR fixture_version.summary <> 'Minimal package for catalog installation testing.'
    OR fixture_version.description <> 'Test-only public catalog content for verifying package installation.'
    OR fixture_version.language_tags <> ARRAY['und']::TEXT[]
    OR fixture_version.topic_tags <> ARRAY['test']::TEXT[]
    OR fixture_version.license <> 'CC0-1.0'
    OR fixture_version.content_warning IS NOT NULL
    OR fixture_version.cover_package_media_key IS NOT NULL
    OR fixture_version.source_workspace_id IS NOT NULL
    OR fixture_version.card_count <> 2
    OR fixture_version.created_by_admin_email <> fixture_admin_email
    OR fixture_version.reviewed_by_admin_email IS DISTINCT FROM fixture_admin_email
    OR fixture_version.created_at <> fixture_created_at
    OR fixture_version.submitted_at IS DISTINCT FROM fixture_submitted_at
    OR fixture_version.reviewed_at IS DISTINCT FROM fixture_reviewed_at
    OR fixture_version.published_at IS DISTINCT FROM fixture_published_at
  THEN
    RAISE EXCEPTION 'Catalog test fixture package version conflicts with migration 0105: package_version_id=%', fixture_version_id
      USING ERRCODE = '23514';
  END IF;

  IF fixture_collection.slug <> 'test'
    OR fixture_collection.title <> 'тест'
    OR fixture_collection.summary <> 'Minimal collection for catalog testing.'
    OR fixture_collection.description <> 'Test-only public catalog collection for verifying ordered package membership.'
    OR fixture_collection.language_tags <> ARRAY['und']::TEXT[]
    OR fixture_collection.topic_tags <> ARRAY['test']::TEXT[]
    OR fixture_collection.cover_package_id IS DISTINCT FROM fixture_package_id
    OR fixture_collection.cover_media_blob_id IS NOT NULL
    OR fixture_collection.created_at <> fixture_collection_created_at
    OR fixture_collection.published_at IS DISTINCT FROM fixture_collection_published_at
  THEN
    RAISE EXCEPTION 'Catalog test fixture collection conflicts with migrations 0107 and 0110: collection_id=%', fixture_collection_id
      USING ERRCODE = '23514';
  END IF;

  SELECT pg_catalog.count(*)
  INTO fixture_cover_reference_count
  FROM catalog.collections AS collections
  WHERE collections.cover_package_id = fixture_package_id;

  IF fixture_cover_reference_count <> 1 THEN
    RAISE EXCEPTION 'Catalog test fixture collection cover graph conflicts: package_id=% expected_cover_reference_count=1 actual_cover_reference_count=%',
      fixture_package_id,
      fixture_cover_reference_count
      USING ERRCODE = '23514';
  END IF;

  SELECT pg_catalog.count(*)
  INTO fixture_version_count
  FROM catalog.package_versions AS package_versions
  WHERE package_versions.package_id = fixture_package_id;

  IF fixture_version_count <> 1 THEN
    RAISE EXCEPTION 'Catalog test fixture package version membership conflicts: package_id=% expected_version_count=1 actual_version_count=%',
      fixture_package_id,
      fixture_version_count
      USING ERRCODE = '23514';
  END IF;

  SELECT pg_catalog.count(*)
  INTO fixture_card_count
  FROM catalog.package_cards AS package_cards
  WHERE package_cards.package_version_id = fixture_version_id;

  IF fixture_card_count <> 2 OR NOT EXISTS (
    SELECT 1
    FROM catalog.package_cards AS package_cards
    WHERE package_cards.package_card_id = fixture_card_one_id
      AND package_cards.package_version_id = fixture_version_id
      AND package_cards.stable_card_key = 'test-1'
      AND package_cards.ordinal = 1
      AND package_cards.front_text = 'test 1'
      AND package_cards.back_text = 'test 2'
      AND package_cards.card_type = 'basic'
      AND package_cards.metadata = '{"version": 1, "source": null}'::JSONB
      AND package_cards.tags = ARRAY['test']::TEXT[]
      AND package_cards.media_asset_keys = ARRAY[]::TEXT[]
      AND package_cards.created_at = fixture_created_at
      AND package_cards.updated_at = fixture_created_at
  ) OR NOT EXISTS (
    SELECT 1
    FROM catalog.package_cards AS package_cards
    WHERE package_cards.package_card_id = fixture_card_two_id
      AND package_cards.package_version_id = fixture_version_id
      AND package_cards.stable_card_key = 'test-2'
      AND package_cards.ordinal = 2
      AND package_cards.front_text = 'test 3'
      AND package_cards.back_text = 'test 4'
      AND package_cards.card_type = 'basic'
      AND package_cards.metadata = '{"version": 1, "source": null}'::JSONB
      AND package_cards.tags = ARRAY['test']::TEXT[]
      AND package_cards.media_asset_keys = ARRAY[]::TEXT[]
      AND package_cards.created_at = fixture_created_at
      AND package_cards.updated_at = fixture_created_at
  ) THEN
    RAISE EXCEPTION 'Catalog test fixture cards conflict with migration 0105: package_version_id=%', fixture_version_id
      USING ERRCODE = '23514';
  END IF;

  SELECT pg_catalog.count(*)
  INTO fixture_media_asset_count
  FROM catalog.package_media_assets AS media_assets
  WHERE media_assets.package_id = fixture_package_id;

  IF fixture_media_asset_count <> 0 THEN
    RAISE EXCEPTION 'Catalog test fixture media conflicts with migration 0105: package_id=% expected_media_asset_count=0 actual_media_asset_count=%',
      fixture_package_id,
      fixture_media_asset_count
      USING ERRCODE = '23514';
  END IF;

  SELECT pg_catalog.count(*)
  INTO fixture_membership_count
  FROM catalog.collection_packages AS collection_packages
  WHERE collection_packages.collection_id = fixture_collection_id;

  SELECT pg_catalog.count(*)
  INTO fixture_package_membership_count
  FROM catalog.collection_packages AS collection_packages
  WHERE collection_packages.package_id = fixture_package_id;

  IF fixture_membership_count <> 1
    OR fixture_package_membership_count <> 1
    OR NOT EXISTS (
    SELECT 1
    FROM catalog.collection_packages AS collection_packages
    WHERE collection_packages.collection_id = fixture_collection_id
      AND collection_packages.package_id = fixture_package_id
      AND collection_packages.ordinal = 1
      AND collection_packages.created_at = fixture_collection_created_at
  ) THEN
    RAISE EXCEPTION 'Catalog test fixture collection membership conflicts with migration 0107: collection_id=%', fixture_collection_id
      USING ERRCODE = '23514';
  END IF;

  SELECT pg_catalog.count(*)
  INTO fixture_review_event_count
  FROM catalog.package_review_events AS review_events
  WHERE review_events.package_id = fixture_package_id;

  SELECT pg_catalog.count(*)
  INTO fixture_version_review_event_count
  FROM catalog.package_review_events AS review_events
  WHERE review_events.package_version_id = fixture_version_id;

  IF NOT EXISTS (
    SELECT 1
    FROM catalog.package_review_events AS review_events
    WHERE review_events.package_review_event_id = fixture_draft_event_id
      AND review_events.package_id = fixture_package_id
      AND review_events.package_version_id = fixture_version_id
      AND review_events.from_status IS NULL
      AND review_events.to_status = 'draft'
      AND review_events.actor_admin_email = fixture_admin_email
      AND review_events.note IS NULL
      AND review_events.created_at = fixture_created_at
  ) OR NOT EXISTS (
    SELECT 1
    FROM catalog.package_review_events AS review_events
    WHERE review_events.package_review_event_id = fixture_submission_event_id
      AND review_events.package_id = fixture_package_id
      AND review_events.package_version_id = fixture_version_id
      AND review_events.from_status = 'draft'
      AND review_events.to_status = 'submitted'
      AND review_events.actor_admin_email = fixture_admin_email
      AND review_events.note IS NULL
      AND review_events.created_at = fixture_submitted_at
  ) OR NOT EXISTS (
    SELECT 1
    FROM catalog.package_review_events AS review_events
    WHERE review_events.package_review_event_id = fixture_approval_event_id
      AND review_events.package_id = fixture_package_id
      AND review_events.package_version_id = fixture_version_id
      AND review_events.from_status = 'submitted'
      AND review_events.to_status = 'approved'
      AND review_events.actor_admin_email = fixture_admin_email
      AND review_events.note = 'Approved deterministic catalog installation test content.'
      AND review_events.created_at = fixture_reviewed_at
  ) OR NOT EXISTS (
    SELECT 1
    FROM catalog.package_review_events AS review_events
    WHERE review_events.package_review_event_id = fixture_publication_event_id
      AND review_events.package_id = fixture_package_id
      AND review_events.package_version_id = fixture_version_id
      AND review_events.from_status = 'approved'
      AND review_events.to_status = 'published'
      AND review_events.actor_admin_email = fixture_admin_email
      AND review_events.note = 'Published deterministic catalog installation test content.'
      AND review_events.created_at = fixture_published_at
  ) THEN
    RAISE EXCEPTION 'Catalog test fixture review history conflicts with migration 0105: package_id=%', fixture_package_id
      USING ERRCODE = '23514';
  END IF;

  SELECT (
    fixture_package.status = 'published'
    AND fixture_package.updated_at = fixture_published_at
    AND fixture_package.delisted_at IS NULL
    AND fixture_version.status = 'published'
    -- Migration 0105's status trigger stamped this field at apply time.
    AND pg_catalog.isfinite(fixture_version.updated_at)
    AND fixture_version.updated_at >= fixture_published_at
    AND fixture_version.updated_at <= fixture_transaction_at
    AND fixture_version.delisted_at IS NULL
    AND fixture_collection.status = 'published'
    AND fixture_collection.updated_at = fixture_collection_published_at
    AND fixture_collection.delisted_at IS NULL
    AND fixture_review_event_count = 4
    AND fixture_version_review_event_count = 4
    AND NOT EXISTS (
      SELECT 1
      FROM catalog.package_review_events AS review_events
      WHERE review_events.package_review_event_id = fixture_delist_event_id
    )
  )
  INTO original_state_matches;

  SELECT (
    fixture_package.status = 'delisted'
    AND fixture_version.status = 'delisted'
    AND fixture_collection.status = 'delisted'
    AND fixture_package.delisted_at IS NOT NULL
    AND pg_catalog.isfinite(fixture_package.delisted_at)
    AND fixture_package.delisted_at >= fixture_collection_published_at
    AND fixture_package.delisted_at <= fixture_transaction_at
    AND fixture_package.delisted_at = fixture_version.delisted_at
    AND fixture_package.delisted_at = fixture_collection.delisted_at
    AND fixture_package.updated_at = fixture_package.delisted_at
    AND fixture_version.updated_at = fixture_package.delisted_at
    AND fixture_collection.updated_at = fixture_package.delisted_at
    AND fixture_review_event_count = 5
    AND fixture_version_review_event_count = 5
    AND EXISTS (
      SELECT 1
      FROM catalog.package_review_events AS review_events
      WHERE review_events.package_review_event_id = fixture_delist_event_id
        AND review_events.package_id = fixture_package_id
        AND review_events.package_version_id = fixture_version_id
        AND review_events.from_status = 'published'
        AND review_events.to_status = 'delisted'
        AND review_events.actor_admin_email = fixture_admin_email
        AND review_events.note = 'Delisted deterministic public catalog test fixture.'
        AND review_events.created_at = fixture_package.delisted_at
    )
  )
  INTO terminal_state_matches;

  IF terminal_state_matches THEN
    RETURN;
  END IF;

  IF NOT original_state_matches THEN
    RAISE EXCEPTION 'Catalog test fixture lifecycle is neither the exact migration 0105/0107 state nor the exact migration 0111 terminal state: package_id=% package_status=% package_updated_at=% package_delisted_at=% package_version_id=% version_status=% version_updated_at=% version_delisted_at=% collection_id=% collection_status=% collection_updated_at=% collection_delisted_at=% package_review_event_count=% version_review_event_count=%',
      fixture_package_id,
      fixture_package.status,
      fixture_package.updated_at,
      fixture_package.delisted_at,
      fixture_version_id,
      fixture_version.status,
      fixture_version.updated_at,
      fixture_version.delisted_at,
      fixture_collection_id,
      fixture_collection.status,
      fixture_collection.updated_at,
      fixture_collection.delisted_at,
      fixture_review_event_count,
      fixture_version_review_event_count
      USING ERRCODE = '23514';
  END IF;

  UPDATE catalog.collections AS collections
  SET status = 'delisted',
      updated_at = fixture_delisted_at,
      delisted_at = fixture_delisted_at
  WHERE collections.collection_id = fixture_collection_id
    AND collections.status = 'published';

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 1 THEN
    RAISE EXCEPTION 'Catalog test fixture collection changed before delisting: collection_id=%', fixture_collection_id
      USING ERRCODE = '40001';
  END IF;

  UPDATE catalog.package_versions AS package_versions
  SET status = 'delisted',
      updated_at = fixture_delisted_at,
      delisted_at = fixture_delisted_at
  WHERE package_versions.package_version_id = fixture_version_id
    AND package_versions.status = 'published';

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 1 THEN
    RAISE EXCEPTION 'Catalog test fixture package version changed before delisting: package_version_id=%', fixture_version_id
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO catalog.package_review_events (
    package_review_event_id,
    package_id,
    package_version_id,
    from_status,
    to_status,
    actor_admin_email,
    note,
    created_at
  )
  VALUES (
    fixture_delist_event_id,
    fixture_package_id,
    fixture_version_id,
    'published',
    'delisted',
    fixture_admin_email,
    'Delisted deterministic public catalog test fixture.',
    fixture_delisted_at
  );

  UPDATE catalog.packages AS packages
  SET status = 'delisted',
      updated_at = fixture_delisted_at,
      delisted_at = fixture_delisted_at
  WHERE packages.package_id = fixture_package_id
    AND packages.status = 'published';

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 1 THEN
    RAISE EXCEPTION 'Catalog test fixture package changed before delisting: package_id=%', fixture_package_id
      USING ERRCODE = '40001';
  END IF;
END;
$migration$;
