-- Migration status: Current / additive.
-- Introduces: deterministic public catalog content for end-to-end installation testing.
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
  fixture_admin_email CONSTANT TEXT := 'catalog-system@flashcards-open-source-app.com';
  fixture_created_at CONSTANT TIMESTAMPTZ := '2026-08-02 00:00:00+00';
  fixture_submitted_at CONSTANT TIMESTAMPTZ := '2026-08-02 00:01:00+00';
  fixture_reviewed_at CONSTANT TIMESTAMPTZ := '2026-08-02 00:02:00+00';
  fixture_published_at CONSTANT TIMESTAMPTZ := '2026-08-02 00:03:00+00';
  inserted_version_count INTEGER;
BEGIN
  INSERT INTO catalog.authors (
    author_id,
    slug,
    display_name,
    bio,
    website_url,
    created_at,
    updated_at
  )
  VALUES (
    fixture_author_id,
    'flashcards-test-catalog',
    'Flashcards Test Catalog',
    'System author for public catalog test data.',
    NULL,
    fixture_created_at,
    fixture_created_at
  )
  ON CONFLICT DO NOTHING;

  IF NOT EXISTS (
    SELECT 1
    FROM catalog.authors AS authors
    WHERE authors.author_id = fixture_author_id
      AND authors.slug = 'flashcards-test-catalog'
      AND authors.display_name = 'Flashcards Test Catalog'
      AND authors.bio = 'System author for public catalog test data.'
      AND authors.website_url IS NULL
      AND authors.created_at = fixture_created_at
      AND authors.updated_at = fixture_created_at
  ) THEN
    RAISE EXCEPTION 'Catalog test author identity conflicts with incompatible pre-existing content'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO catalog.packages (
    package_id,
    author_id,
    slug,
    title,
    summary,
    description,
    language_tags,
    topic_tags,
    license,
    content_warning,
    cover_package_media_key,
    status,
    created_at,
    updated_at,
    published_at,
    delisted_at
  )
  VALUES (
    fixture_package_id,
    fixture_author_id,
    'test',
    'тест',
    'Minimal package for catalog installation testing.',
    'Test-only public catalog content for verifying package installation.',
    ARRAY['und']::TEXT[],
    ARRAY['test']::TEXT[],
    'CC0-1.0',
    NULL,
    NULL,
    'published',
    fixture_created_at,
    fixture_published_at,
    fixture_published_at,
    NULL
  )
  ON CONFLICT DO NOTHING;

  IF NOT EXISTS (
    SELECT 1
    FROM catalog.packages AS packages
    WHERE packages.package_id = fixture_package_id
      AND packages.author_id = fixture_author_id
      AND packages.slug = 'test'
      AND packages.title = 'тест'
      AND packages.summary = 'Minimal package for catalog installation testing.'
      AND packages.description = 'Test-only public catalog content for verifying package installation.'
      AND packages.language_tags = ARRAY['und']::TEXT[]
      AND packages.topic_tags = ARRAY['test']::TEXT[]
      AND packages.license = 'CC0-1.0'
      AND packages.content_warning IS NULL
      AND packages.cover_package_media_key IS NULL
      AND packages.status = 'published'
      AND packages.created_at = fixture_created_at
      AND packages.updated_at = fixture_published_at
      AND packages.published_at = fixture_published_at
      AND packages.delisted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Catalog test package identity conflicts with incompatible pre-existing content'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO catalog.package_versions (
    package_version_id,
    package_id,
    version_number,
    status,
    slug,
    title,
    summary,
    description,
    language_tags,
    topic_tags,
    license,
    content_warning,
    cover_package_media_key,
    source_workspace_id,
    card_count,
    created_by_admin_email,
    reviewed_by_admin_email,
    created_at,
    updated_at,
    submitted_at,
    reviewed_at,
    published_at,
    delisted_at
  )
  VALUES (
    fixture_version_id,
    fixture_package_id,
    1,
    'draft',
    'test',
    'тест',
    'Minimal package for catalog installation testing.',
    'Test-only public catalog content for verifying package installation.',
    ARRAY['und']::TEXT[],
    ARRAY['test']::TEXT[],
    'CC0-1.0',
    NULL,
    NULL,
    NULL,
    2,
    fixture_admin_email,
    NULL,
    fixture_created_at,
    fixture_created_at,
    NULL,
    NULL,
    NULL,
    NULL
  )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS inserted_version_count = ROW_COUNT;

  IF inserted_version_count = 1 THEN
    INSERT INTO catalog.package_cards (
      package_card_id,
      package_version_id,
      stable_card_key,
      ordinal,
      front_text,
      back_text,
      card_type,
      metadata,
      tags,
      media_asset_keys,
      created_at,
      updated_at
    )
    VALUES
      (
        fixture_card_one_id,
        fixture_version_id,
        'test-1',
        1,
        'test 1',
        'test 2',
        'basic',
        '{"version": 1, "source": null}'::JSONB,
        ARRAY['test']::TEXT[],
        ARRAY[]::TEXT[],
        fixture_created_at,
        fixture_created_at
      ),
      (
        fixture_card_two_id,
        fixture_version_id,
        'test-2',
        2,
        'test 3',
        'test 4',
        'basic',
        '{"version": 1, "source": null}'::JSONB,
        ARRAY['test']::TEXT[],
        ARRAY[]::TEXT[],
        fixture_created_at,
        fixture_created_at
      )
    ON CONFLICT DO NOTHING;

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
      fixture_draft_event_id,
      fixture_package_id,
      fixture_version_id,
      NULL,
      'draft',
      fixture_admin_email,
      NULL,
      fixture_created_at
    )
    ON CONFLICT DO NOTHING;

    UPDATE catalog.package_versions AS package_versions
    SET status = 'submitted',
        submitted_at = fixture_submitted_at
    WHERE package_versions.package_version_id = fixture_version_id
      AND package_versions.status = 'draft';

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
      fixture_submission_event_id,
      fixture_package_id,
      fixture_version_id,
      'draft',
      'submitted',
      fixture_admin_email,
      NULL,
      fixture_submitted_at
    )
    ON CONFLICT DO NOTHING;

    UPDATE catalog.package_versions AS package_versions
    SET status = 'approved',
        reviewed_by_admin_email = fixture_admin_email,
        reviewed_at = fixture_reviewed_at
    WHERE package_versions.package_version_id = fixture_version_id
      AND package_versions.status = 'submitted';

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
      fixture_approval_event_id,
      fixture_package_id,
      fixture_version_id,
      'submitted',
      'approved',
      fixture_admin_email,
      'Approved deterministic catalog installation test content.',
      fixture_reviewed_at
    )
    ON CONFLICT DO NOTHING;

    UPDATE catalog.package_versions AS package_versions
    SET status = 'published',
        published_at = fixture_published_at
    WHERE package_versions.package_version_id = fixture_version_id
      AND package_versions.status = 'approved';

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
      fixture_publication_event_id,
      fixture_package_id,
      fixture_version_id,
      'approved',
      'published',
      fixture_admin_email,
      'Published deterministic catalog installation test content.',
      fixture_published_at
    )
    ON CONFLICT DO NOTHING;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM catalog.package_versions AS package_versions
    WHERE package_versions.package_version_id = fixture_version_id
      AND package_versions.package_id = fixture_package_id
      AND package_versions.version_number = 1
      AND package_versions.status = 'published'
      AND package_versions.slug = 'test'
      AND package_versions.title = 'тест'
      AND package_versions.summary = 'Minimal package for catalog installation testing.'
      AND package_versions.description = 'Test-only public catalog content for verifying package installation.'
      AND package_versions.language_tags = ARRAY['und']::TEXT[]
      AND package_versions.topic_tags = ARRAY['test']::TEXT[]
      AND package_versions.license = 'CC0-1.0'
      AND package_versions.content_warning IS NULL
      AND package_versions.cover_package_media_key IS NULL
      AND package_versions.source_workspace_id IS NULL
      AND package_versions.card_count = 2
      AND package_versions.created_by_admin_email = fixture_admin_email
      AND package_versions.reviewed_by_admin_email = fixture_admin_email
      AND package_versions.created_at = fixture_created_at
      AND package_versions.updated_at >= fixture_published_at
      AND package_versions.submitted_at = fixture_submitted_at
      AND package_versions.reviewed_at = fixture_reviewed_at
      AND package_versions.published_at = fixture_published_at
      AND package_versions.delisted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Catalog test package version identity conflicts with incompatible pre-existing content'
      USING ERRCODE = '23505';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM catalog.package_versions AS package_versions
    WHERE package_versions.package_id = fixture_package_id
  ) <> 1 THEN
    RAISE EXCEPTION 'Catalog test package must contain exactly one package version'
      USING ERRCODE = '23514';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM catalog.package_cards AS package_cards
    WHERE package_cards.package_version_id = fixture_version_id
  ) <> 2 OR NOT EXISTS (
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
    RAISE EXCEPTION 'Catalog test package cards conflict with incompatible pre-existing content'
      USING ERRCODE = '23505';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM catalog.package_review_events AS review_events
    WHERE review_events.package_version_id = fixture_version_id
  ) <> 4 OR NOT EXISTS (
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
    RAISE EXCEPTION 'Catalog test package review events conflict with incompatible pre-existing content'
      USING ERRCODE = '23505';
  END IF;
END;
$migration$;
