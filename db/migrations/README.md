# Migrations

Schema migrations are intentionally not finalized yet.

Planned process:
1. Agree on v1 domain model and sync invariants.
2. Write initial migration from scratch (`0001_initial_schema.sql`).
3. Apply only additive migrations after `0001` is committed.

## Corrections to applied migrations

An applied migration is immutable. `scripts/deploy/migrate.sh` records every migration by filename
in `schema_migrations` and skips a filename already present, so editing one is a silent no-op in
production, and `scripts/checks/pr/check-migration-hygiene.mjs` rejects the diff. When later work
makes an applied migration's header state something that is no longer true, the correction is
recorded here instead of in the file.

### `0013_cards_query_indexes.sql` — the trigram index is gone

Its header says "the trigram/search indexing remains relevant". `0133_drop_cards_search_trgm_index.sql`
drops `content.idx_cards_active_search_trgm` and records why the planner could never choose it.

### `0128_catalog_educational_alignment.sql` — the guard list is out of date

Its header says that "Nothing in the admin API writes catalog.package_versions.educational_* after
version creation", that "Correcting a published version's alignment is therefore a migration-only
operation today; an admin correction path is separate, later work", and that "the read-time
assertions in the public catalog projections are the only guard on these three fields".

None of the three is true any more. `PUT /v1/admin/catalog/packages/{packageId}/educational-alignment`
(`apps/backend/src/routes/catalog/admin.ts`, backed by
`correctCatalogPackageEducationalAlignmentInExecutor` in
`apps/backend/src/catalog/authoring/versions/educationalAlignment.ts`) rewrites
`catalog.packages.educational_*` together with the same three columns on every
`catalog.package_versions` row of that package, whatever its status, in one transaction. Correcting
a published deck's classification is therefore a product operation and needs no migration. That
endpoint screens the submitted values with `getPublicCatalogEducationalAlignmentIssue`
(`apps/backend/src/catalog/publicSafety.ts`) before it writes anything, so it is a third guard on
these three fields beside the two read-time assertions in the public catalog projections.

The rest of that header still holds: the three columns stay outside
`catalog.prevent_published_package_version_update()`, which is exactly what lets the endpoint fix a
wrong subject without creating a version nobody asked for.

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

### `0140_analytics_excluded_actors.sql` — the DELETE caller exists now

Its header states as fact, twice, that nothing deletes from this table, in words that differ between
the copies. The comment above the grant: "That erasure call does not exist yet -
apps/backend/src/auth/accountDeletion.ts does not name this table today - so nothing deletes from
here at all, and the privilege is what that later step needs rather than a description of one that
already runs." `COMMENT ON TABLE analytics.excluded_actors`, the copy now living in the database:
"that call does not exist yet: that file does not name this table, nothing deletes from here today,
and the privilege is what the later erasure step needs rather than a description of one that already
runs. Until that step is written, a deleted account keeps whatever row here still names it."

That step is written. `eraseAnalyticsExclusionsInExecutor`
(`apps/backend/src/auth/accountDeletion.ts`) deletes every row whose `actor_id` matches one of the
person-wide ids, folded to the normalization the column stores under, and its own comment records
that migration's "does not exist yet" as superseded. It is exactly the caller the migration granted
`DELETE` for and wrote `excluded_actors_restore_survives_live_account` around.

The rest of that header still holds, and is what keeps the call safe: `DELETE` is granted for that
one caller and is still never a way to unexclude, and the erasure runs only once `org.user_settings`
is gone, which is what lets the restore guard pass for a restored row. The outcome its closing
sentence described also survives on one path, though the premise it rested on — "until that step is
written" — is gone: `eraseAnalyticsExclusionsInExecutor` is called from
`deleteRealAccountDataInExecutor` alone, so a demo-account reset — which keeps its Cognito identity
and signs in again under the same account id — still keeps whatever row here names it, restore
included.

### `0143_anonymous_client_identity_free_rows.sql` — cookieless rows are no longer bare

Its header says a cookieless row's identifier "is left empty rather than filled", and that a
per-request id is not substituted. That still holds for `anonymous_id`. But since
`0144_anonymous_client_daily_visitor_hash.sql`, a cookieless credential-free row that is not a
consent fact carries a separate server-derived `daily_visitor_hash`, which links one browser's events
within one UTC day. The consent facts still carry neither.

### `0149_product_analytics_off_switch.sql` — account deletion anonymizes, it does not erase

Its header makes the same claim twice, in words that differ between the copies. The `Current
guidance` block: "Turning it off stops future collection only: analytics.product_events is
append-only, this writes no tombstone and deletes nothing, and account deletion remains the erasure
path." `COMMENT ON COLUMN org.user_settings.product_analytics_enabled`, the copy now living in the
database: "FALSE stops future collection only. It deletes nothing: analytics.product_events is
append-only and account deletion stays the erasure path." Each splits the same way. What they say
about the switch is true. What they say about account deletion is not: nothing erases those events,
and account deletion least of all.

`anonymizeProductAnalyticsInExecutor` (`apps/backend/src/auth/accountDeletion.ts`) rewrites them in
place. It deletes `analytics.installation_profiles` rows matched three ways — the person's own
`user_id`, every `(anonymous_id, platform)` pair their events carry, and every `anonymous_id` an
`authenticated_client` link names, so a device they shared loses its profile in full, because its
first country and sparse history may predate the latest owner — `UPDATE`s every
`analytics.product_events` row belonging to any user id that person ever reported under — guest
phase included, walked through `auth.guest_upgrade_history` and the `server_derived`
`analytics.identity_links` — onto a single `randomUUID()` pseudonym, generated per deletion and kept
in no mapping table, nulls every remaining joinable column (`anonymous_id`, `session_id`,
`guest_session_id`, `workspace_id`, `request_id`, `device_model`, `os_version`, `timezone`,
`device_locale`, `ui_locale` and `country`), sets `identity_state = 'anonymized'`, and only then
deletes `analytics.identity_links` so nothing can resolve the pseudonym back. The pseudonym itself
is written into `user_id` and `subject_user_id` on every row it touches and stays visible: the rows
survive and keep being counted, and `docs/admin-app.md` describes a deleted person surfacing as a
`(no email)` actor whose raw UUID the user filter and tooltips show. The person behind them is what
is gone.

One table is erased rather than rewritten, because its rows name the person by the real actor id,
which the `UPDATE` above never touches: `analytics.excluded_actors`. That delete matches every
person-wide id at once, so it takes whatever rows — none, one or several — still name that person.
It is `eraseAnalyticsExclusionsInExecutor`, and it runs from `deleteRealAccountDataInExecutor` only,
never from the demo-account reset path, which anonymizes and deliberately leaves any exclusion row
naming that id in place. The `analytics.installation_profiles` and `analytics.identity_links` rows
above go too, but as parts of the anonymization rather than beside it: they are what would otherwise
resolve the pseudonym back. `0140_analytics_excluded_actors.sql` granted `backend_app` the `DELETE`
for this one caller while stating that the call did not exist yet; that statement is false now and
has its own entry above.

"Append-only" is the same slip, narrowed. `0114_product_analytics_storage.sql` grants `backend_app`
`UPDATE` on this table for this path alone and calls the table append-only "for every other writer".
The account-deletion path is the carve-out from that rule, not an example of it.

The rest of that header still holds, the switch's own behavior included: it writes no tombstone,
stops future collection only, and leaves everything already stored exactly where it is. What was
never true is the name the header gave to what happens to those rows afterwards.

`docs/analytics-visitor-identity.md` had carried the same claim in wording of its own, close to the
database copy and identical to neither, and is corrected in place; that file is editable, so it
carries no entry here.
