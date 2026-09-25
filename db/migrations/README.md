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

### `0066_reporting_readonly_operational_analytics.sql` — chat content is no longer hidden

Its header says that "Secret hashes, raw chat payloads, prompts, suggestions, and legacy
payload-heavy sync feeds remain hidden". Three of those five stopped being true with
`0153_reporting_readonly_ai_chat_content.sql`, which grants `reporting_readonly` the transcript
column list on `ai.chat_items` and a `SELECT` policy to go with it, `turn_input`,
`last_error_message` and `client_platform` on `ai.chat_runs`, `composer_suggestions` on
`ai.chat_sessions`, and `suggestions` on `ai.chat_composer_suggestion_generations`. Raw chat
payloads, prompts and suggestions are readable by that role from there on. It is a decision rather
than a repair: administrator access to hosted AI chat content was opened deliberately, so that
dashboards can analyze how people use the AI and make it better, and the privacy policy in
`kirill-markin/flashcards-open-source-app-website` discloses it.

The other two still hold, and nothing in `0153` touches either: secret hashes stay hidden, and so do
the legacy payload-heavy sync feeds, `sync.changes` and `sync.applied_operations`. Every table
`0066` granted, it granted as an explicit column list rather than whole rows, which is why
`ai.chat_runs.client_platform`, added by `0136_ai_chat_run_client_platform.sql` after `0066`
enumerated that table, had to be named again in `0153`.

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

### `0144_anonymous_client_daily_visitor_hash.sql` — the refusal list is longer than three names

Its header says the hash is computed only for a cookieless row "that is not one of the three consent
facts", it names those three again when it explains why a grant is excluded with them, and the
`COMMENT ON COLUMN analytics.product_events.daily_visitor_hash` it installed — the copy now living in
the database — says the same in its own words, "not a consent fact". The
`product_events_daily_visitor_hash_shape` constraint it added listed exactly `consent_prompt_shown`,
`consent_granted` and `consent_declined`. All of that describes the surfaces that existed when it ran.

`0156_site_consent_daily_visitor_hash_exclusion.sql` re-adds that constraint over eight names. The
marketing site has a consent banner of its own, reported as `site_consent_prompt_shown`,
`site_consent_granted` and `site_consent_declined`, and a collection switch answered after it,
reported as `site_collection_disabled` and `site_collection_enabled`. Read `0156` for the current
list.

The backend's rule is the broader of the two because it is not a list alone:
`isDailyVisitorHashAllowed` (`apps/backend/src/productAnalytics/dailyVisitorHash.ts`) refuses the
hash on every `identityFree` catalog entry, so an identity-free event added later is refused it
before any migration names it. The by-name half exists for the two grants alone, which are
identity-bearing on purpose and would otherwise pass that check.

The rest of that header still holds, and it is the part that carries the promise: the hash is not an
actor, it is never folded into `actor_id` and never linked to a visitor id, an identity link or an
account, a day's salt is deleted once that day has ended, and no raw IP is stored anywhere.

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
place. It deletes `analytics.installation_profiles` rows matched three ways: the person's own
`user_id`, every `(anonymous_id, platform)` pair their events carry, and every `anonymous_id` an
`authenticated_client` link names, so a device they shared loses its profile in full, because its
first country and sparse history may predate the latest owner. It then `UPDATE`s every
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

One analytics table is erased rather than rewritten, because its rows name the person by the real
actor id, which the `UPDATE` above never touches: `analytics.excluded_actors`. That delete matches every
person-wide id at once, so it takes whatever rows — none, one or several — still name that person.
It is `eraseAnalyticsExclusionsInExecutor`, and it runs from `deleteRealAccountDataInExecutor` only,
never from the demo-account reset path, which anonymizes and deliberately leaves any exclusion row
naming that id in place. The `analytics.installation_profiles` and `analytics.identity_links` rows
above go too, but as parts of the anonymization rather than beside it: they are what would otherwise
resolve the pseudonym back. `0140_analytics_excluded_actors.sql` granted `backend_app` the `DELETE`
for this one caller while stating that the call did not exist yet; that statement is false now and
has its own entry above. All of that is the analytics half: outside it the same deletion also drops
this person's `billing.entitlement_snapshots` row, which is a rebuildable cache rather than a history
and is no part of the erasure described here.

"Append-only" is the same slip, narrowed. `0114_product_analytics_storage.sql` grants `backend_app`
`UPDATE` on this table for this path alone and calls the table append-only "for every other writer".
The account-deletion path is the carve-out from that rule, not an example of it.

The rest of that header still holds, the switch's own behavior included: it writes no tombstone,
stops future collection only, and leaves everything already stored exactly where it is. What was
never true is the name the header gave to what happens to those rows afterwards.

`docs/analytics-visitor-identity.md` had carried the same claim in wording of its own, close to the
database copy and identical to neither, and is corrected in place; that file is editable, so it
carries no entry here.

### `0152_ai_usage_facts.sql` — `cache_write_tokens` is written, not left NULL

`COMMENT ON COLUMN ai.usage_events.cache_write_tokens` says the column "stays NULL for the OpenAI calls
this repository makes today: their automatic prompt caching discounts reads and bills nothing to write."
The first half is false. The pinned provider SDK, `openai@7.22.0`, reports the counter on the Responses
API — `ResponseUsage.InputTokensDetails.cache_write_tokens`, a required field of a required object — and
`appendAiUsageEvent` (`apps/backend/src/aiUsage/record.ts`) records whatever arrives there. Chat and
composer-suggestion rows therefore carry the provider's number. The dictation and card-image calls report
no such counter, and their rows do carry NULL.

The pricing half still holds and is why the first half was written: the default in-memory prompt cache
bills nothing for a cache write, so every price this counter is multiplied by is zero today. That makes
it a zero-priced fact rather than a fact not worth storing. What a row in this table stores is what the
provider reported; what it costs is a dated row in `ai.model_prices`, which is the whole reason the two
are separate tables. Extended prompt-cache retention is what would start charging for it, and nothing
here asks for it: `prompt_cache_retention` is never set on the model call
(`apps/backend/src/chat/openai/loop/modelCall.ts`).

The closing sentence still holds too, and is now doing less work than it was written to do: a provider
that charges for cache writes needs no migration, because the column is already there and already
populated.

### `0152_ai_usage_facts.sql` — the identity columns are rewritable now

Its header and its table comment both say that nothing may change a stored row, in words that differ
between the copies. The `Current guidance` block: "None of them loosens append-only: `ai.usage_events`
has no UPDATE or DELETE policy and no UPDATE or DELETE privilege."
`COMMENT ON TABLE ai.usage_events`, the copy now living in the database, says it twice: "No row is ever
updated or deleted", and, closing the comment, "Row level security is enabled, and the only policies are
permissive reads plus the one insert `backend_app` is granted: nothing may rewrite or remove a row
here."

`0154_ai_usage_identity_rewrites.sql` grants `backend_app` `UPDATE (user_id, workspace_id, request_id)`
on that table and adds the `usage_events_backend_update` policy the grant needs in order to match a row
at all. Those three columns are the ones that name somebody; every counter stays ungranted.
Two statements use it, and no third may without being named in that migration:
`anonymizeAiUsageForDeletedPersonInExecutor` rewrites a deleted person's rows onto the same one-way
pseudonym their analytics history is collapsed to and nulls `workspace_id` and `request_id`, and
`transferAiUsageToUpgradedAccountInExecutor` moves a guest's rows to the account they upgraded into,
both in `apps/backend/src/aiUsage/identity.ts`.

Everything else those two sentences were written to protect still holds, and the grant is column-scoped
so that the database enforces it rather than review: the counters are immutable, because `UPDATE` on
them was never granted back, and no row can be removed, because `DELETE` is still revoked. The part that
was never true is the reach of the word "nothing": the same header also says, as its own `Current
guidance`, that "the account-deletion anonymisation that lets a usage row outlive the person it names"
is "later work" and that `anonymizeProductAnalyticsInExecutor` "does not cover `ai.usage_events` yet".
That work is what the grant exists for, so the two claims could never both stay true — the table comment
promises that "account deletion anonymises them rather than cascading them away", and an anonymisation
is a rewrite.

### `0152_ai_usage_facts.sql` — the module it points at is gone, and so is the table it compares itself to

Its `See also` block names `apps/backend/src/guestAiQuota/index.ts`, and its header says of
`auth.guest_ai_monthly_usage` that it "keeps working untouched by this migration; retiring it is separate
later work". That work has happened. The metering cutover deleted the `guestAiQuota` module, so the
pointer names a file that no longer exists, and `0157_drop_guest_ai_monthly_usage.sql` dropped the table
itself along with the `reporting_readonly` column grant `0066` had on it.

What took the module's place is `apps/backend/src/aiUsage/`: `cap.ts` resolves the UTC monthly window and
the allowance, which is where the `usage_month` key's rule now lives, and `record.ts` appends the facts
that sum is taken over. Read the pointer as `apps/backend/src/aiUsage/` instead.

The comparison the header draws between the two tables is still the reason this one exists, and reads the
same with the older table in the past tense: a weights-applied total per user-month could not be
re-priced, split by surface or attributed to a model. Its rows were not carried over when it was dropped,
so guest AI consumption from before the cutover is gone rather than restated here.
