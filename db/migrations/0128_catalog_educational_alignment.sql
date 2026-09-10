-- Migration status: Current / additive.
-- Introduces: educational_subject, educational_framework and educational_level on catalog.packages
--   and catalog.package_versions, the free-text classification of what a deck teaches. The marketing
--   website reads them from the public catalog snapshot and emits schema.org educationalAlignment
--   for every deck. They mirror language_tags: the package row is the mutable authoring draft, and
--   version creation freezes a copy onto the version row.
--
--   The three columns are deliberately left out of
--   catalog.prevent_published_package_version_update(), which enumerates by name the columns a
--   published or delisted version may not change. They are classification metadata about a deck, not
--   the content installed from it: they never enter the install contract, the install idempotency
--   payload, or any app client, so correcting a wrong subject must not force a new version whose
--   cards nobody asked to change.
--
--   That exclusion only keeps such a correction possible at the database level; it does not make one
--   reachable from the product. Nothing in the admin API writes
--   catalog.package_versions.educational_* after version creation: PUT
--   /v1/admin/catalog/packages/{packageId}/draft edits the catalog.packages draft row alone, and the
--   version row keeps the copy frozen when the version was created. Correcting a published version's
--   alignment is therefore a migration-only operation today; an admin correction path is separate,
--   later work. Because the publication-time public-safety gate can never re-run over a value
--   corrected that way, the read-time assertions in the public catalog projections are the only
--   guard on these three fields.
--
--   Every column is nullable here, and the public snapshot schemaVersion stays 2. Filling values for
--   existing decks, requiring educational_subject, and the snapshot schema bump are later work.
-- Schemas touched/read explicitly: catalog.

ALTER TABLE catalog.packages
  ADD COLUMN IF NOT EXISTS educational_subject TEXT,
  ADD COLUMN IF NOT EXISTS educational_framework TEXT,
  ADD COLUMN IF NOT EXISTS educational_level TEXT;

ALTER TABLE catalog.package_versions
  ADD COLUMN IF NOT EXISTS educational_subject TEXT,
  ADD COLUMN IF NOT EXISTS educational_framework TEXT,
  ADD COLUMN IF NOT EXISTS educational_level TEXT;

COMMENT ON COLUMN catalog.packages.educational_subject IS
  'Free-text subject the deck teaches, written in the language its audience studies in, for example '
  'Statistics or Biologia. There is no controlled vocabulary and no enumeration to keep in sync. '
  'NULL means the deck has not been classified yet.';

COMMENT ON COLUMN catalog.packages.educational_framework IS
  'Free-text curriculum or examination the deck is aligned to, written in the audience language, for '
  'example AP Statistics or Selectividad. NULL means the deck belongs to no named framework, which '
  'is the normal case for general-interest decks.';

COMMENT ON COLUMN catalog.packages.educational_level IS
  'Free-text educational level the deck targets, written in the audience language, for example High '
  'school or Grado universitario. NULL means the deck names no particular level.';

COMMENT ON COLUMN catalog.package_versions.educational_subject IS
  'Copy of catalog.packages.educational_subject frozen when this version was created. Unlike the '
  'content columns beside it, it stays updatable after publication: it classifies the deck rather '
  'than describing what an install of this version delivered.';

COMMENT ON COLUMN catalog.package_versions.educational_framework IS
  'Copy of catalog.packages.educational_framework frozen when this version was created, updatable '
  'after publication for the same reason as educational_subject.';

COMMENT ON COLUMN catalog.package_versions.educational_level IS
  'Copy of catalog.packages.educational_level frozen when this version was created, updatable after '
  'publication for the same reason as educational_subject.';
