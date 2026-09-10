-- Migration status: Current / one-time data correction.
-- Introduces: the normalization of the last catalog language tag that is not a supported audience
--   locale. Package slug 'us-citizenship-test' still carries language_tags = ARRAY['en-us'] on its
--   published versions 1, 2 and 3; this sets those three rows to ARRAY['en']. No new database
--   object of any kind, and no schema change.
-- Schemas touched/read explicitly: catalog, pg_catalog.
--
--
-- WHY
--
-- apps/backend/src/catalog/types.ts fixes the audience locales a package may declare to ar, de, en,
-- es, hi, ja, ru and zh, and apps/backend/src/routes/catalog/admin.ts rejects anything else on the
-- admin write path. These three rows predate that rule. Measured across every published package
-- version in the live public snapshot the tag histogram is en 97, ru 9, es 8, ja 8, zh 8, hi 5,
-- ar 4, de 4 and en-us 3, so en-us is the only value outside the eight, and that artifact holds no
-- collections, so nothing else needs repair. The marketing website is about to apply the same rule
-- to every languageTags value it reads out of the snapshot; left as they are, these rows would make
-- it reject real production data.
--
-- en-us and en name the same audience, so this is a normalization and not a change of meaning. The
-- package's latest version, 4, and the mutable catalog.packages draft row already carry
-- ARRAY['en'], so nothing changes for the version anyone installs today.
--
--
-- HOW THE IMMUTABILITY GUARD IS SATISFIED
--
-- language_tags is one of the columns catalog.prevent_published_package_version_update() enumerates
-- by name, so a plain UPDATE of a published row raises 23514. This migration disables exactly one
-- trigger, package_versions_published_immutable, for the length of its own UPDATE and re-enables it
-- in the same transaction:
--
--   * The guard function is never redefined, so the set of columns it protects afterwards is the
--     same set it protects now, by construction. That is why this file does not follow 0113's
--     CREATE OR REPLACE: restating the definition here would silently drop from the guard any
--     column a migration merged in the meantime had added to it.
--   * ALTER TABLE ... DISABLE TRIGGER takes SHARE ROW EXCLUSIVE on catalog.package_versions, which
--     conflicts with the ROW EXCLUSIVE every INSERT, UPDATE and DELETE needs. The lock is held
--     until this migration commits, so no other session can write the table while the guard is off,
--     and the catalog change is itself transactional, so no other session ever observes the trigger
--     disabled.
--   * Every failure path below raises, and all three runners apply one file as one transaction -
--     scripts/deploy/migrate.sh with psql --single-transaction, the migration Lambda with the
--     BEGIN/COMMIT in apps/backend/src/database/migrationRunner.ts, and the postgres-integration
--     runner with the BEGIN/COMMIT in apps/backend/scripts/postgresIntegrations/migrations.mjs - so
--     an abort rolls the ALTER TABLE back with everything else. There is no path that leaves the
--     guard disabled.
--   * The trigger's enabled state is asserted to be the plain enabled one ('O') before it is
--     disabled, which is what makes the restore exact: a replica-only or always-fire configuration
--     aborts here instead of being silently rewritten into a plain one. The same assertion after
--     ENABLE TRIGGER cannot fail by construction and is kept only as a self-documenting check that
--     the statement above restores the state the pre-flight demanded.
--   * The other two triggers on the table stay enabled throughout. package_versions_set_updated_at
--     therefore stamps updated_at on the three rows, and their updatedAt in the public snapshot
--     moves to this migration's timestamp: the repair is recorded rather than hidden.
--     package_versions_status_transition is BEFORE UPDATE OF status and does not fire, because the
--     statement below never mentions that column.
--
--
-- WHAT IS DELIBERATELY NOT TOUCHED
--
-- language_tags is audience metadata and is not part of the install contract, so no installed card,
-- media asset or workspace changes here. The durable install payloads in
-- sync.catalog_package_install_idempotency keep their own frozen copy of languageTags, and keep
-- en-us on purpose: they record what a completed install actually delivered, their schema in
-- apps/backend/src/catalog/distribution/install/replay.ts accepts any string there and never
-- compares that field against catalog.package_versions, so rewriting them would rewrite the history
-- of finished installs for no gain. 0113 had to strip topicTags from those same payloads only
-- because its strict schema no longer had a field to hold the value.
--
-- The correction is scoped to this one package rather than to every row that holds en-us anywhere,
-- because a draft or delisted row elsewhere reaches no public surface and must not be able to abort
-- a release. The delisted 'und' fixture from 0105/0107 is left alone for the same reason: every
-- public projection excludes it with delisted_at IS NULL.
--
--
-- RE-RUN AND ENVIRONMENT SAFETY
--
-- The file is a no-op wherever there is nothing to correct - a database without the package, which
-- is every fresh and non-production one except the postgres-integration database described below,
-- and a database whose rows already read ARRAY['en'] - and in both cases it leaves the trigger
-- untouched and says so with a notice the migration runner logs. That second no-op is proved
-- rather than assumed: because the UPDATE matches the whole array, a row holding en-us beside a
-- companion tag would satisfy neither branch's premise and would leave the artifact carrying the
-- value this migration exists to remove, so the branch first asserts that no version of the package
-- carries en-us at all and aborts the release when one does. Where there is something to correct it
-- must be exactly three rows, matched on the exact current value and never on the slug alone; any
-- other count aborts the release rather than guessing.
--
-- Because this is the repository's first migration-level DISABLE TRIGGER, the correcting path is
-- not left to run for the first time in production. seedMigration0129LegacyCatalogLanguageTag in
-- apps/backend/scripts/postgresIntegrations/migrations.mjs inserts the package immediately before
-- this file runs there, in production's shape: the three published ARRAY['en-us'] versions plus the
-- already-correct version 4, so the rehearsal exercises the exact-array WHERE rather than a
-- package-wide one. apps/backend/scripts/postgresIntegrations/boundaries.mjs declares that boundary
-- and names the test that reads the result,
-- apps/backend/src/catalog/authoring/versions/legacyLanguageTagCorrection.postgres.integration.ts.

DO $migration$
DECLARE
  target_package_slug CONSTANT TEXT := 'us-citizenship-test';
  legacy_language_tags CONSTANT TEXT[] := ARRAY['en-us']::TEXT[];
  corrected_language_tags CONSTANT TEXT[] := ARRAY['en']::TEXT[];
  expected_version_count CONSTANT BIGINT := 3;
  target_package_id UUID;
  legacy_version_count BIGINT;
  guard_trigger_enabled "char";
  updated_count INTEGER;
BEGIN
  SELECT packages.package_id
  INTO target_package_id
  FROM catalog.packages AS packages
  WHERE packages.slug = target_package_slug;

  IF NOT FOUND THEN
    RAISE NOTICE 'Legacy catalog language tag correction skipped: no package with slug %', target_package_slug;
    RETURN;
  END IF;

  SELECT pg_catalog.count(*)
  INTO legacy_version_count
  FROM catalog.package_versions AS package_versions
  WHERE package_versions.package_id = target_package_id
    AND package_versions.language_tags = legacy_language_tags;

  IF legacy_version_count = 0 THEN
    -- A whole-array match cannot tell "already corrected" from "en-us survives beside another tag",
    -- so the absence of the tag itself is what makes this branch a no-op rather than a silent skip.
    IF EXISTS (
      SELECT 1
      FROM catalog.package_versions AS package_versions
      WHERE package_versions.package_id = target_package_id
        AND legacy_language_tags[1] = ANY(package_versions.language_tags)
    ) THEN
      RAISE EXCEPTION 'Legacy catalog language tag % survives on package slug % in a shape this migration cannot repair: it corrects only versions whose language_tags equal %, package_id=%',
        legacy_language_tags[1],
        target_package_slug,
        legacy_language_tags,
        target_package_id
        USING ERRCODE = '23514';
    END IF;

    RAISE NOTICE 'Legacy catalog language tag correction skipped: package slug % holds no version with language_tags %',
      target_package_slug,
      legacy_language_tags;
    RETURN;
  END IF;

  IF legacy_version_count <> expected_version_count THEN
    RAISE EXCEPTION 'Legacy catalog language tag correction expected % versions with language_tags %, found %: package_slug=% package_id=%',
      expected_version_count,
      legacy_language_tags,
      legacy_version_count,
      target_package_slug,
      target_package_id
      USING ERRCODE = '23514';
  END IF;

  -- The trigger name cannot be a parameter of ALTER TABLE, so it is spelled out here and in the two
  -- statements below; all three must name the same trigger created by 0083.
  SELECT triggers.tgenabled
  INTO guard_trigger_enabled
  FROM pg_catalog.pg_trigger AS triggers
  WHERE triggers.tgrelid = 'catalog.package_versions'::pg_catalog.regclass
    AND triggers.tgname = 'package_versions_published_immutable'
    AND triggers.tgfoid = 'catalog.prevent_published_package_version_update()'::pg_catalog.regprocedure;

  IF NOT FOUND OR guard_trigger_enabled <> 'O' THEN
    RAISE EXCEPTION 'Published catalog package version guard is not in the enabled state this migration can restore: trigger=package_versions_published_immutable found=% tgenabled=%',
      FOUND,
      guard_trigger_enabled
      USING ERRCODE = '23514';
  END IF;

  ALTER TABLE catalog.package_versions
    DISABLE TRIGGER package_versions_published_immutable;

  UPDATE catalog.package_versions AS package_versions
  SET language_tags = corrected_language_tags
  WHERE package_versions.package_id = target_package_id
    AND package_versions.language_tags = legacy_language_tags;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> expected_version_count THEN
    RAISE EXCEPTION 'Legacy catalog language tag correction updated % versions instead of %: package_slug=% package_id=%',
      updated_count,
      expected_version_count,
      target_package_slug,
      target_package_id
      USING ERRCODE = '40001';
  END IF;

  ALTER TABLE catalog.package_versions
    ENABLE TRIGGER package_versions_published_immutable;

  SELECT triggers.tgenabled
  INTO guard_trigger_enabled
  FROM pg_catalog.pg_trigger AS triggers
  WHERE triggers.tgrelid = 'catalog.package_versions'::pg_catalog.regclass
    AND triggers.tgname = 'package_versions_published_immutable'
    AND triggers.tgfoid = 'catalog.prevent_published_package_version_update()'::pg_catalog.regprocedure;

  IF NOT FOUND OR guard_trigger_enabled <> 'O' THEN
    RAISE EXCEPTION 'Published catalog package version guard was not restored: trigger=package_versions_published_immutable found=% tgenabled=%',
      FOUND,
      guard_trigger_enabled
      USING ERRCODE = '23514';
  END IF;

  RAISE NOTICE 'Legacy catalog language tag corrected from % to % on % versions: package_slug=% package_id=%',
    legacy_language_tags,
    corrected_language_tags,
    updated_count,
    target_package_slug,
    target_package_id;
END;
$migration$;
