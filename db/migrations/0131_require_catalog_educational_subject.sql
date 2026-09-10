-- Migration status: Current / additive constraint plus the narrow fill it needs.
-- Introduces: NOT NULL on catalog.packages.educational_subject and
--   catalog.package_versions.educational_subject, plus the
--   packages_educational_subject_nonempty and package_versions_educational_subject_nonempty CHECK
--   constraints that 0083_catalog_kernel.sql pairs with every NOT NULL text column in these two
--   tables. No new column, table, index, function or trigger.
--
--   educational_framework and educational_level stay nullable and unconstrained permanently. Their
--   NULL is data, not missing data: it says the deck is aligned to no named exam, curriculum or
--   standard, which is the normal case for an evergreen topic deck. Only the subject is something
--   every deck has.
-- Schemas touched/read explicitly: catalog, pg_catalog.
--
--
-- WHY THE CHECK CONSTRAINTS ARE PART OF THIS FILE AND NOT OPTIONAL
--
-- 0128 added the three columns without a non-empty CHECK, which was correct while they were
-- nullable and matched the nullable sibling content_warning. NOT NULL alone would now accept '' and
-- '   ', and those reach the marketing website's visible deck row and its schema.org
-- educationalAlignment targetName. The admin write path normalizes and rejects an empty subject
-- already, but that guarantee covers neither a backfill nor any direct SQL write, which is exactly
-- how every value in these columns was written. btrim(...) <> '' is 0083's convention for this, and
-- these two constraints are that convention applied to the column that just became NOT NULL. The
-- function is written pg_catalog.btrim here rather than bare btrim, matching 0119 and 0130 and the
-- repository rule that a migration names its schemas explicitly; the constraint it builds is the
-- same one 0083 writes.
--
--
-- THE ROWS THAT WOULD OTHERWISE MAKE SET NOT NULL FAIL
--
-- 0130 filled the approved subject on every published package and on its published version rows.
-- Two kinds of row it deliberately did not reach would each abort a plain SET NOT NULL.
--
-- 1. The deterministic catalog test fixture. Package slug 'test', title 'тест', language_tags
--    ARRAY['und'], seeded by 0105_catalog_test_content.sql and delisted by
--    0111_delist_catalog_test_fixture.sql. It is not in 0130's approved alignment table and is not
--    published, so both its package row and its single version row still hold NULL. This file gives
--    it the plainly non-content subject 'Test'.
--
--    Inventing a value is forbidden for a real deck and is what keeps 0130 restricted to an
--    approved table. It is legitimate for this row and this row only, because the row is test data
--    that reaches no public surface: every public catalog projection filters on status 'published'
--    with delisted_at IS NULL, on both the package and the version, and this fixture is 'delisted'
--    on both. The UPDATE below therefore matches on that terminal state as well as on the fixture's
--    package_id, so if the fixture were ever public again the invented value would not be written
--    and the assertion further down would stop the release instead.
--
-- 2. Version rows that are not published. idx_package_versions_one_review_candidate permits one
--    in-flight version per package in draft, submitted, needs_changes or approved; version creation
--    freezes the alignment copy from catalog.packages at creation time, and publication only flips
--    the status. So a version row created before 0130 still carries NULL whatever its status, and
--    the constraint applies to every row, not only to the ones the public snapshot reads. This file
--    refreshes each such row from its own catalog.packages parent, which 0130 populated, rather
--    than from any table of its own: the package row is where that version's frozen copy came from
--    and is what the next version created from it would inherit anyway.
--
--    The fill runs for every status. It covers the fixture's own delisted version row too, once the
--    fixture's package row above holds 'Test'.
--
--    Only educational_subject is filled. framework and level are not copied down, because their
--    NULL is a legitimate value rather than an absence, and nothing requires them.
--
--
-- WHAT IS ASSERTED, AND WHY IT IS ASSERTED HERE RATHER THAN LEFT TO THE ALTER
--
-- After both fills, this file proves that no NULL and no blank educational_subject remains in
-- either table, and aborts naming the offending row if one does. SET NOT NULL and ADD CONSTRAINT
-- would fail on their own, but Postgres reports only that some row violates the constraint; it
-- names neither the row nor the table's slug, which is the one thing an operator reading a failed
-- release needs. A package row that is still NULL here is a real deck nobody classified, and this
-- file must not invent a subject for it: the failure is the correct outcome and the message says
-- which slug to fix.
--
--
-- WHY NO TRIGGER IS TOUCHED
--
-- catalog.prevent_published_package_version_update() enumerates by name the columns a published or
-- delisted version may not change, and 0128 deliberately left the three educational_* columns out
-- of that list. The version fill below can therefore write a published or delisted row directly and
-- this file contains no ALTER TABLE ... DISABLE TRIGGER. 0129 needed one because language_tags is
-- inside that guard; this is not that case, exactly as in 0130.
--
-- packages_set_updated_at and package_versions_set_updated_at stay enabled, so a row this file
-- actually writes takes a fresh updated_at. Every UPDATE is guarded on educational_subject IS NULL,
-- so a second application writes nothing at all. package_versions_status_transition is
-- BEFORE UPDATE OF status and never fires, because no statement here mentions that column.
--
--
-- LOCKING
--
-- Each ALTER takes an ACCESS EXCLUSIVE lock and SET NOT NULL scans the table. catalog.packages and
-- catalog.package_versions hold hundreds of rows, not millions, and no client writes them outside
-- an admin request, so the scan is immaterial and no NOT VALID / VALIDATE split is warranted.
--
--
-- RE-RUN AND ENVIRONMENT SAFETY
--
-- Both UPDATEs are guarded on IS NULL, SET NOT NULL is idempotent, and each CHECK is dropped by
-- name before it is added, so applying this file twice writes no row and leaves the same schema. A
-- database that holds no catalog package at all matches nothing and says so in its notice.
--
--
-- CI REHEARSAL
--
-- apps/backend/scripts/postgresIntegrations/boundaries.mjs declares a boundary at this file.
-- seedMigration0131InFlightCatalogAlignment in
-- apps/backend/scripts/postgresIntegrations/migrations.mjs adds a draft version row with a NULL
-- subject to the package 0129's seed hook creates, just before this file runs, so the in-flight
-- case above is exercised against a real PostgreSQL rather than first met in production. The
-- delisted 0105 fixture is already present at that boundary and needs no seed hook.
-- apps/backend/src/catalog/authoring/versions/requiredEducationalSubject.postgres.integration.ts
-- reads both results and proves the constraints are armed afterwards.

DO $migration$
DECLARE
  -- catalog.packages.package_id of the fixture 0105 seeds and 0111 delists.
  fixture_package_id CONSTANT UUID := '00000000-0000-4000-a105-000000000002';
  fixture_subject CONSTANT TEXT := 'Test';
  fixture_rows_written INTEGER;
  version_rows_written INTEGER;
  offending_row_count BIGINT;
  offending_row TEXT;
BEGIN
  UPDATE catalog.packages AS packages
  SET educational_subject = fixture_subject
  WHERE packages.package_id = fixture_package_id
    AND packages.slug = 'test'
    AND packages.status = 'delisted'
    AND packages.delisted_at IS NOT NULL
    AND packages.educational_subject IS NULL;

  GET DIAGNOSTICS fixture_rows_written = ROW_COUNT;

  UPDATE catalog.package_versions AS package_versions
  SET educational_subject = packages.educational_subject
  FROM catalog.packages AS packages
  WHERE packages.package_id = package_versions.package_id
    AND package_versions.educational_subject IS NULL
    AND packages.educational_subject IS NOT NULL;

  GET DIAGNOSTICS version_rows_written = ROW_COUNT;

  SELECT
    pg_catalog.count(*),
    pg_catalog.min(
      'slug=' || packages.slug
      || ' package_id=' || packages.package_id
      || ' status=' || packages.status
      || ' educational_subject='
      || COALESCE(pg_catalog.quote_literal(packages.educational_subject), 'NULL')
    )
  INTO offending_row_count, offending_row
  FROM catalog.packages AS packages
  WHERE packages.educational_subject IS NULL
    OR pg_catalog.btrim(packages.educational_subject) = '';

  IF offending_row_count <> 0 THEN
    RAISE EXCEPTION 'catalog.packages holds % row(s) with a missing or blank educational_subject, first: %',
      offending_row_count,
      offending_row
      USING ERRCODE = '23514';
  END IF;

  SELECT
    pg_catalog.count(*),
    pg_catalog.min(
      'slug=' || packages.slug
      || ' package_version_id=' || package_versions.package_version_id
      || ' version_number=' || package_versions.version_number
      || ' status=' || package_versions.status
      || ' educational_subject='
      || COALESCE(pg_catalog.quote_literal(package_versions.educational_subject), 'NULL')
    )
  INTO offending_row_count, offending_row
  FROM catalog.package_versions AS package_versions
  JOIN catalog.packages AS packages
    ON packages.package_id = package_versions.package_id
  WHERE package_versions.educational_subject IS NULL
    OR pg_catalog.btrim(package_versions.educational_subject) = '';

  IF offending_row_count <> 0 THEN
    RAISE EXCEPTION 'catalog.package_versions holds % row(s) with a missing or blank educational_subject, first: %',
      offending_row_count,
      offending_row
      USING ERRCODE = '23514';
  END IF;

  RAISE NOTICE 'Catalog educational subject prepared for NOT NULL: test_fixture_package_rows_written=% version_rows_filled_from_package=%',
    fixture_rows_written,
    version_rows_written;
END;
$migration$;

ALTER TABLE catalog.packages
  ALTER COLUMN educational_subject SET NOT NULL;

ALTER TABLE catalog.packages
  DROP CONSTRAINT IF EXISTS packages_educational_subject_nonempty,
  ADD CONSTRAINT packages_educational_subject_nonempty
    CHECK (pg_catalog.btrim(educational_subject) <> '');

ALTER TABLE catalog.package_versions
  ALTER COLUMN educational_subject SET NOT NULL;

ALTER TABLE catalog.package_versions
  DROP CONSTRAINT IF EXISTS package_versions_educational_subject_nonempty,
  ADD CONSTRAINT package_versions_educational_subject_nonempty
    CHECK (pg_catalog.btrim(educational_subject) <> '');

COMMENT ON COLUMN catalog.packages.educational_subject IS
  'Free-text subject the deck teaches, written in the language its audience studies in, for example '
  'Statistics or Biologia. There is no controlled vocabulary and no enumeration to keep in sync. '
  'Required and non-blank: every deck teaches something, and the marketing website prints this '
  'value into the visible deck page row and into the schema.org educationalAlignment targetName.';

COMMENT ON COLUMN catalog.package_versions.educational_subject IS
  'Copy of catalog.packages.educational_subject frozen when this version was created, required and '
  'non-blank like its source. Unlike the content columns beside it, it stays updatable after '
  'publication: it classifies the deck rather than describing what an install of this version '
  'delivered.';
