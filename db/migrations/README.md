# Migrations

Schema migrations are intentionally not finalized yet.

Planned process:
1. Agree on v1 domain model and sync invariants.
2. Write initial migration from scratch (`0001_initial_schema.sql`).
3. Apply only additive migrations after `0001` is committed.

## Corrections to applied migrations

An applied migration is immutable, so a factual error in one is corrected here
rather than edited in place.

### `0130_backfill_catalog_educational_alignment.sql` — the count 115 is wrong

The header calls the backfill a table of "115 catalog package slugs" and claims
that those slugs and the live catalog's published slugs "are an exact
one-for-one match ... No slug is unmatched in either direction". Both statements
are false, and so is every other use of 115 in that file's comments.

The approved table was assembled from `catalog.package_versions.slug`, which is
frozen per version, instead of `catalog.packages.slug`, which is the package's
current slug. Three packages had been renamed, so each contributed two rows:

| Retired version slug | Current package slug |
| --- | --- |
| `advanced-high-school-chemistry-flashcards` | `ap-chemistry-flashcards` |
| `algebra-based-physics-1-flashcards` | `ap-physics-1-flashcards` |
| `five-unit-psychology-course-review` | `ap-psychology-flashcards` |

The true figures: the catalog held **112** published packages, all 112 received
a subject, and **58** of them also carry a framework and level. Three of the 115
literal rows name a slug no package carries and matched nothing.

The data the migration wrote is correct. Both UPDATEs reach a row through
`catalog.packages.slug`, and the version UPDATE then fans out by
`package_versions.package_id`, so the retired slugs never matched and the three
renamed packages took their values from their current-slug row.

That is narrower than it looks. The retired rows carry a weaker triple than
their current-slug counterparts — `('advanced-high-school-chemistry-flashcards',
'Chemistry', NULL, NULL)` against `('ap-chemistry-flashcards', 'Chemistry',
'College Board Advanced Placement', 'AP Chemistry')` — so a version UPDATE
joined on the frozen `package_versions.slug` would have stripped the framework
and level from those packages' older published versions. The join key is what
kept the outcome correct, not the table.

The file's `approved_row_count := 115` assertion is consistent with its own
literal list and still passes; it never checked the table against the catalog.
