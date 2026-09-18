-- Migration status: Current / one-time data correction.
-- Introduces: the rewrite of the bare marketing origin https://flashcards-open-source-app.com to
--   https://nibomo.com in catalog.authors.website_url, path, query and fragment preserved. No new
--   database object of any kind, and no schema change.
-- Schemas touched/read explicitly: catalog, pg_catalog.
--
--
-- WHY
--
-- The marketing site now lives on nibomo.com and the old domain answers every path with a
-- permanent redirect, so both URL forms resolve and this migration corrects data rather than
-- repairing a break. Two things make the old form worth removing from the catalog's own data. It
-- is rendered into indexable author copy on public deck and author pages, which links the catalog
-- to a host the product no longer uses, and the site localizes only links whose origin equals the
-- current site origin, so an author website on the old host silently loses locale rewriting.
--
-- The value reaches the public surface through catalog.authors.website_url, read as
-- author_website_url by apps/backend/src/catalog/distribution/public/snapshot.ts and published in
-- the snapshot the website builds from.
--
--
-- WHAT THE PREDICATE CAN AND CANNOT MATCH
--
-- Only the bare marketing origin changes. The app., api., auth. and mcp. hosts keep their own
-- domain and must never be rewritten, and they cannot be: the WHERE clause is a prefix match on
-- 'https://flashcards-open-source-app.com', and a subdomain URL on any of those four hosts does
-- not start with it. The pattern is built from the legacy_origin constant, which
-- holds no LIKE metacharacter - no underscore and no percent sign - so the only wildcard in it is
-- the trailing % this file appends.
--
-- A prefix match alone would also accept a look-alike host that merely begins with the old domain,
-- such as https://flashcards-open-source-app.com.example/..., and rewriting one would send a real
-- third-party author link to nibomo.com. The second condition therefore requires the character
-- after the origin to be a URL boundary: nothing at all, '/', '?' or '#'. A port-qualified form
-- like https://flashcards-open-source-app.com:443/... is deliberately excluded by that same
-- condition, because rewriting it would carry a port nibomo.com never asked for; no such value is
-- expected, and one would still resolve through the permanent redirect.
--
-- The rewrite is a string replacement of the origin rather than a set of literal new values, so it
-- stays correct whatever path, query or fragment each row actually carries.
--
--
-- WHAT IS DELIBERATELY NOT TOUCHED
--
-- Deck descriptions carry the same old-domain URLs and are not repaired here. A published deck's
-- description lives on catalog.package_versions, whose description column is one of the columns
-- catalog.prevent_published_package_version_update() from 0113 enumerates by name, so a published
-- version is immutable by contract and an UPDATE of it raises 23514. Rewriting those rows would
-- mean suspending that guard to edit copy that is meant to be frozen per version. They are
-- corrected the next time those decks are republished, which is product work rather than a
-- migration. catalog.authors has no such guard: website_url is mutable and is edited in production
-- today through PUT /v1/admin/catalog/authors/{authorId}
-- (apps/backend/src/routes/catalog/admin.ts, backed by updateCatalogAuthorInExecutor in
-- apps/backend/src/catalog/authoring/authors.ts), which is why this column is a migration's business
-- and the version rows are not.
--
-- Nothing outside this one column changes: no card content, no deck title, no other table, and no
-- row whose website_url is NULL or points at any other host.
--
--
-- RE-RUN AND ENVIRONMENT SAFETY
--
-- The statement is idempotent and matches nothing once it has run, because a rewritten row no
-- longer carries the old origin. It is a plain no-op on every database that holds no such author,
-- which is every fresh and non-production one, and it asserts no row count: the authoring endpoint
-- above can change how many authors carry the old origin between this file being written and being
-- applied, and a release must not fail over that. The row count it did rewrite is logged instead.
--
-- catalog.authors carries the authors_set_updated_at trigger from 0083, so every rewritten row
-- takes a new updated_at and the correction is recorded rather than hidden.

DO $migration$
DECLARE
  legacy_origin CONSTANT TEXT := 'https://flashcards-open-source-app.com';
  current_origin CONSTANT TEXT := 'https://nibomo.com';
  origin_boundary_characters CONSTANT TEXT[] := ARRAY['', '/', '?', '#']::TEXT[];
  rewritten_count INTEGER;
BEGIN
  UPDATE catalog.authors AS authors
  SET website_url = current_origin
    || pg_catalog.substr(authors.website_url, pg_catalog.length(legacy_origin) + 1)
  WHERE authors.website_url LIKE legacy_origin || '%'
    AND pg_catalog.substr(authors.website_url, pg_catalog.length(legacy_origin) + 1, 1)
      = ANY(origin_boundary_characters);

  GET DIAGNOSTICS rewritten_count = ROW_COUNT;

  RAISE NOTICE 'Catalog author website origin rewritten from % to % on % rows',
    legacy_origin,
    current_origin,
    rewritten_count;
END;
$migration$;
