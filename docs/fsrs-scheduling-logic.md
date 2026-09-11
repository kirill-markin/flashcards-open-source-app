# FSRS Scheduling Logic

## Scope

This document describes the current full FSRS implementation used by the backend, the iOS app, and the Android app.
It is the source of truth for hidden scheduler state, workspace-level scheduler settings, and the product-specific boundaries around official FSRS behavior.

Reference implementation:

- official open-spaced-repetition [`ts-fsrs` 5.2.3](https://github.com/open-spaced-repetition/ts-fsrs) scheduler flow mirrored by this repository
- official FSRS algorithm notes: [`fsrs4anki` wiki, "The Algorithm"](https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm)
- official FSRS-6 default weights

Repository implementations:

- backend scheduler: `apps/backend/src/scheduling/index.ts`
- backend card persistence: `apps/backend/src/cards/review/reviews.ts` and `apps/backend/src/cards/review/fsrs.ts`
- backend workspace scheduler settings: `apps/backend/src/scheduling/workspaceSettings.ts`
- iOS scheduler: `apps/ios/Flashcards/Flashcards/Review/Scheduling/FsrsScheduler.swift`
- iOS local persistence: `apps/ios/Flashcards/Flashcards/LocalDatabase.swift`
- Android scheduler: `apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/scheduling/FsrsScheduler.kt`
- Android local persistence: `apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/repository/LocalRepositories.kt`
- web FSRS type mirror: `apps/web/src/types.ts`
- web local review submit flow: `apps/web/src/appData/sync/local/syncLocalMutations.ts`
- iOS settings UI: `apps/ios/Flashcards/Flashcards/SettingsView.swift`
- Android settings UI: `apps/android/feature/settings/src/main/java/com/flashcardsopensourceapp/feature/settings/SchedulerSettingsRoute.kt`

## Mirror contract

The repository has exactly three independent implementations of the FSRS scheduler algorithm:

- backend: `apps/backend/src/scheduling/index.ts`
- iOS: `apps/ios/Flashcards/Flashcards/Review/Scheduling/FsrsScheduler.swift`
- Android: `apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/scheduling/FsrsScheduler.kt`

They are full platform-specific copies of the same algorithm and must stay behaviorally identical.
The web app does not contain a fourth standalone scheduler implementation in this repository.
Instead, the web review flow reuses the backend scheduler module from `apps/backend/src/scheduling/index.ts` for local review submission and button-interval previews, while `apps/web/src/types.ts` mirrors the FSRS data contract.

Supporting mirrors around the scheduler contract:

- backend review persistence: `apps/backend/src/cards/review/reviews.ts`
- iOS review persistence: `apps/ios/Flashcards/Flashcards/LocalDatabase.swift`
- Android review persistence: `apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/repository/LocalRepositories.kt`
- web local review submit flow reusing backend scheduler: `apps/web/src/appData/sync/local/syncLocalMutations.ts`
- backend scheduler settings: `apps/backend/src/scheduling/workspaceSettings.ts`
- iOS scheduler settings: `apps/ios/Flashcards/Flashcards/LocalDatabase.swift`
- Android scheduler settings: `apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/scheduling/WorkspaceSchedulerSettingsSupport.kt`
- shared parity vectors: `tests/fsrs-full-vectors.json`
- backend parity tests: `apps/backend/src/scheduling/index.test.ts`
- iOS parity tests: `apps/ios/Flashcards/FlashcardsTests/Review/FSRS/FsrsSchedulerParityTests.swift`
- Android parity tests: `apps/android/data/local/src/test/java/com/flashcardsopensourceapp/data/local/model/FsrsSchedulerParityTest.kt`

Any scheduler change must update the backend copy, the iOS copy, the Android copy, this document, and the parity vectors plus all three test suites in the same PR.

Core scheduler symbol parity:

| Backend (`apps/backend/src/scheduling/index.ts`) | iOS (`apps/ios/Flashcards/Flashcards/Review/Scheduling/FsrsScheduler.swift`) |
| --- | --- |
| `ReviewableCardScheduleState` | `ReviewableCardScheduleState` |
| `ReviewHistoryEvent` | `FsrsReviewHistoryEvent` |
| `RebuiltCardScheduleState` | `RebuiltCardScheduleState` |
| `FsrsMemoryState` | `FsrsMemoryState` |
| `FuzzRange` | `FuzzRange` |
| `LearningStepResult` | `LearningStepResult` |
| `DEFAULT_W` / `S_MIN` / `FUZZ_RANGES` / `DECAY` / `FACTOR` | `defaultWeights` / `fsrsMinimumStability` / `fuzzRanges` / `fsrsDecay` / `fsrsFactor` |
| `createMash` | `MashGenerator.next(data:)` with `MashGenerator` state |
| `Alea` | `AleaGenerator` |
| `addMinutes` / `addDays` | `FlashcardsLogic.swift` `addMinutes(date:minutes:)` / `addDays(date:days:)` |
| `clamp`, `roundTo8`, `dateDiffInDays`, `stateRequiresMemory`, `getIntervalModifier`, `formatSeedNumber`, `mapRatingToFsrsGrade`, `getStepsForState`, `getCurrentStepIndex`, `getLearningStrategyStepIndex`, `getHardStepMinutes`, `getLearningStepResult`, `initStability`, `initDifficulty`, `meanReversion`, `linearDamping`, `nextDifficulty`, `forgettingCurve`, `nextRecallStability`, `nextForgetStability`, `nextShortTermStability`, `createInitialMemoryState`, `computeNextShortTermMemoryState`, `computeNextReviewMemoryState`, `getFuzzRange`, `getIntervalSeed`, `nextInterval`, `getMemoryState`, `buildShortTermSchedule`, `buildGraduatedReviewSchedule`, `buildReviewSuccessSchedule`, `createEmptyReviewableCardScheduleState`, `computeReviewSchedule`, `rebuildCardScheduleState` | same symbol names in Swift style |

Android keeps the same scheduler symbol set in `apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/scheduling/FsrsScheduler.kt`.
Because Android persistence uses epoch milliseconds instead of `Date`, the Android mirror uses `*Millis` timestamp fields while keeping the same transition logic, helper structure, seed rules, and validation semantics as backend and iOS.

Scheduler-entrypoint parity:

| Backend | iOS |
| --- | --- |
| `apps/backend/src/cards/review/reviews.ts::toReviewableCardScheduleState` | `apps/ios/Flashcards/Flashcards/Review/Scheduling/FsrsScheduler.swift::makeReviewableCardScheduleState(card:)` |
| `apps/backend/src/cards/review/reviews.ts::submitReview` | `apps/ios/Flashcards/Flashcards/LocalDatabase.swift::submitReview(workspaceId:reviewSubmission:)` |
| `apps/backend/src/scheduling/workspaceSettings.ts::parseSteps` | `apps/ios/Flashcards/Flashcards/LocalDatabase.swift::validateSchedulerStepList(values:fieldName:)` |
| `apps/backend/src/scheduling/workspaceSettings.ts::validateWorkspaceSchedulerSettingsInput` | `apps/ios/Flashcards/Flashcards/LocalDatabase.swift::validateWorkspaceSchedulerSettingsInput(desiredRetention:learningStepsMinutes:relearningStepsMinutes:maximumIntervalDays:enableFuzz:)` |
| `apps/backend/src/scheduling/workspaceSettings.ts::getWorkspaceSchedulerSettings` / `getWorkspaceSchedulerConfig` | `apps/ios/Flashcards/Flashcards/LocalDatabase.swift::loadWorkspaceSchedulerSettings(workspaceId:)` |
| `apps/backend/src/scheduling/workspaceSettings.ts::updateWorkspaceSchedulerSettings` | `apps/ios/Flashcards/Flashcards/LocalDatabase.swift::updateWorkspaceSchedulerSettings(workspaceId:desiredRetention:learningStepsMinutes:relearningStepsMinutes:maximumIntervalDays:enableFuzz:)` |

## Rating model

User-facing ratings remain the standard four-button FSRS answers:

- `0`: `Again`
- `1`: `Hard`
- `2`: `Good`
- `3`: `Easy`

The API and local app use those `0...3` values directly.
Internally, the scheduler maps them to the reference FSRS grades `1...4`.

## Persisted card scheduler state

Each card stores both product-facing review fields and hidden FSRS state.

Visible scheduling fields:

- `due_at`
- `reps`
- `lapses`

Cached counter semantics:

- `reps` increments on every review, including `Again`
- `lapses` increments only on `Again` from persisted `review` state

Hidden FSRS memory fields:

- `fsrs_stability`
- `fsrs_difficulty`
- `fsrs_last_reviewed_at`
- `fsrs_scheduled_days`

Hidden FSRS workflow fields:

- `fsrs_card_state`
- `fsrs_step_index`

The allowed `fsrs_card_state` values are:

- `new`
- `learning`
- `review`
- `relearning`

`fsrs_step_index` is the zero-based index of the currently scheduled short-term step.
It is only persisted for cards in `learning` or `relearning`.
It must be `NULL` for `new` and `review`.

Card invariants:

- untouched `new` cards have `due_at = NULL`
- untouched `new` cards must not have persisted FSRS memory fields
- `review` cards must have full FSRS memory state and `fsrs_step_index = NULL`
- `learning` and `relearning` cards must have full FSRS memory state and a non-null `fsrs_step_index`

Existing invalid persisted scheduler state is repaired by migration or explicit maintenance outside normal read paths.
Writes must preserve the card invariants above, and normal reads must remain pure reads without hidden repair.
Review submission must fail when persisted card state is impossible.
Any repair path must not rewrite or delete `review_events`.
Elapsed days are computed from UTC calendar-day boundaries only.
If `fsrs_last_reviewed_at` is later than the current review timestamp, even within the same UTC day, the scheduler must throw.

## Workspace scheduler settings

FSRS configuration is stored per workspace row, not per card.
Backend persistence uses `org.workspaces.fsrs_*` columns.
Local iOS persistence uses the SQLite `workspaces` row with matching `fsrs_*` columns, storing step arrays as JSON text.

Current typed settings:

- `algorithm`
- `desired_retention`
- `learning_steps_minutes`
- `relearning_steps_minutes`
- `maximum_interval_days`
- `enable_fuzz`

Current defaults:

- `algorithm = fsrs-6`
- `desired_retention = 0.90`
- `learning_steps_minutes = [1, 10]`
- `relearning_steps_minutes = [10]`
- `maximum_interval_days = 36500`
- `enable_fuzz = true`

Product boundary:

- FSRS weights are pinned in code and are not user-configurable in v1
- workspace settings are forward-only
- changing workspace settings affects future reviews only
- existing card rows remain authoritative after a config change
- append-only `review_events` remain history, not a guaranteed rebuild source across config edits
- each FSRS transition uses the actual review timestamp supplied by the client (`reviewedAtClient`) rather than server processing time

## Scheduler flow

### New

A `new` card has no FSRS memory state yet.
Its first review initializes `stability` and `difficulty` with the official first-review formulas.

First-review behavior:

- `Again`: enter `learning`, schedule the first learning step
- `Hard`: enter `learning`, stay on the first short-term step with a hard interval
- `Good`: enter `learning`, schedule the next learning step if one exists, otherwise graduate
- `Easy`: skip remaining short-term steps and graduate to `review`

### Learning

`learning` is the short-term workflow for new cards before graduation.

Behavior:

- `Again`: reset to the first learning step
- `Hard`: stay in short-term flow without advancing the step index
- `Good`: follow the official `ts-fsrs 5.2.3` learning-step resolution; after the first scheduled step, `Good` can graduate directly to `review`
- `Easy`: graduate immediately

Memory updates for `learning` remain short-term FSRS updates even if the card is answered on a later UTC day than the scheduled step.

### Review

`review` is the long-term FSRS state.

Behavior:

- `Again`: update memory as a failure and enter `relearning`
- `Hard`: stay in `review` with the shortest successful long-term interval
- `Good`: stay in `review` with the baseline successful long-term interval
- `Easy`: stay in `review` with the longest successful long-term interval

Long-term intervals use the official FSRS memory update formulas plus the workspace target retention and fuzz configuration.
Same-day `review` answers still use the review-state FSRS memory formulas with `elapsedDays = 0`; they do not switch to short-term memory updates.

### Relearning

`relearning` is the short-term workflow after a failed `review` card.

Behavior:

- `Again`: reset to the first relearning step
- `Hard`: stay in short-term flow without advancing the step index
- `Good`: advance to the next relearning step, or graduate back to `review` if there is no next step
- `Easy`: graduate immediately back to `review`

Memory updates for `relearning` remain short-term FSRS updates even if the card is answered on a later UTC day than the scheduled step.

## Review queue presentation

Review queue ordering is a cross-client presentation policy.
It chooses the next active card shown to the user; it does not change FSRS transitions, interval calculations, due counts, sync payloads, API contracts, database schema, remote config, workspace scheduler settings, or persisted scheduler state.

At queue evaluation time `now`, `recentDuePriorityWindow` is exactly `1 hour`.
Active queue entries are presented in this order:

1. recently reviewed due cards, where `dueAt <= now` and `fsrsLastReviewedAt` is in the inclusive range `[now - 1 hour, now]`
2. other due cards, where `dueAt <= now`
3. new cards, where `dueAt` is `null`

The recent-review boundary is inclusive at both ends: `fsrsLastReviewedAt == now` and `fsrsLastReviewedAt == now - 1 hour` are recent reviewed.
Cards with `dueAt > now` and cards with malformed `dueAt` values are not active queue entries, though preview or timeline surfaces may show them where supported.
Cards that were reviewed recently but are still future-due are not active queue entries.

Tie-breakers inside the recently reviewed due and other due buckets must remain stable:

1. `dueAt ASC`
2. `createdAt ASC`
3. `cardId ASC`

The card currently displayed to the user remains pinned until it is answered, even if the canonical queue order changes in the background.
Cards that become due after `Again` or another short-step review can rise ahead of a large old-overdue tail on the next normal queue refresh or review action because their `fsrsLastReviewedAt` is recent.
There is no requirement to refresh an idle review screen solely because a card crosses into the due window.

### Backend new-card bucket storage

`buildNextReviewCardQuery` in `apps/backend/src/agent/reviews.ts` reads bucket 3 as `workspace_id = $1 AND deleted_at IS NULL AND due_at IS NULL ORDER BY created_at ASC, card_id ASC LIMIT 1` (a deck or tags filter adds `AND tags && $2::text[]`; an explicitly empty tags request sends `'{}'`, a shape not observed below and expected to take the bitmap plan), and `UNION ALL` evaluates it on every call.
It has no dedicated partial index on purpose.
`EXPLAIN (ANALYZE, BUFFERS)` on production (PostgreSQL 18.6, September 2026, observed as `reporting_readonly`) shows two plans, chosen by how many cards the planner expects the filter to accept:

- Unfiltered, or filtered by a tag the statistics consider common: a backward scan of `idx_cards_workspace_created_at_active` plus an Incremental Sort. The sort emits nothing until it has closed the first accepted `created_at` group, and the rows `due_at IS NULL` and the tag filter reject never reach it, so the scan runs to the first accepted new card in a later `created_at` group, or through every live card of the workspace when no such card exists. A workspace whose accepted new cards are sparse (a single old new card, or a deck or tag filter matching few cards) can therefore walk most or all of its live cards.
- Filtered by a rare tag (a planner estimate of a few accepted cards): a bitmap scan of `idx_cards_workspace_due_active` over every new card of the workspace, the tag filter on the heap, and a top-N sort.

| Workspace shape | Filter | live / new cards | Plan | Index entries visited | Bucket 3 | Whole statement |
| --- | --- | --- | --- | --- | --- | --- |
| largest | none | 8,613 / 5,603 | `created_at` scan | 6 | 0.06 ms | 0.13 ms |
| largest | old sparse deck (181 cards, 178 new) | 8,613 / 5,603 | `created_at` scan | 6 | 0.14 ms | 0.82 ms |
| largest | common tag whose new cards are late (1,404 cards) | 8,613 / 5,603 | `created_at` scan | 5,899 | 5.4 ms | 5.7 ms |
| largest | rare tag (1 card, none new) | 8,613 / 5,603 | `due_at` bitmap | 5,761 + 408 heap pages | 3.1 ms | 3.8 ms |
| mostly new | none | 2,929 / 2,884 | `created_at` scan | 69 | 0.14 ms | 0.19 ms |
| mostly due | none | 2,217 / 688 | `created_at` scan | 81 | 0.17 ms | 0.27 ms |
| oldest card new, next new card 173 entries later | none | 545 / 331 | `created_at` scan | 174 | 0.33 ms | 0.54 ms |
| 483 new cards in one group, then only reviewed cards | none | 539 / 483 | `created_at` scan | 539 | 0.74 ms | 0.97 ms |
| almost all due | none | 348 / 8 | `created_at` scan | 348 | 0.36 ms | 0.40 ms |
| no new cards | none | 256 / 0 | `created_at` scan | 256 | 0.27 ms | 0.33 ms |

As `reporting_readonly`, whose cards policy is `USING (true)`, either plan's worst case walks every live card, or every new card, of the workspace at about 1 µs per entry from shared buffers, under 10 ms for the largest workspace.
The backend runs as `backend_app` with `app.user_id` and `app.workspace_id` set (`apps/backend/src/database/core.ts`), where `cards_scoped_select_runtime` adds `security.current_workspace_access_allowed(workspace_id)` as a per-row filter qual on the same cards scan; it calls `security.user_has_workspace_access`, a `SECURITY DEFINER` function the planner cannot inline.
Where the planner places that qual among the scan's quals was not measured, so in either plan the function runs at least once per visited row the other quals accept and at most once per visited row.
Its per-call cost was not measured, and the policy quals also enter the row estimates that pick the plan, so neither the plan choice nor the bound above is established for the backend.
Measuring that as `backend_app` is the open question and comes before treating these numbers as a production bound.
Re-measure before adding `(workspace_id, created_at, card_id) WHERE deleted_at IS NULL AND due_at IS NULL` only once a workspace has sparse accepted new cards: all of its oldest cards reviewed, a single old new card, or a deck or tag filter matching few of them; a `backend_app` measurement comes before choosing any size threshold.

## FSRS math

The implementation uses the official FSRS-6 default weights for:

- initial difficulty
- initial stability
- next difficulty
- recall stability update
- forget stability update
- short-term stability update
- forgetting curve

The weights remain pinned in code, but short-term weights `w17` and `w18` are clipped with the same `ts-fsrs 5.2.3` rule when `relearning_steps.length > 1`.
That keeps multi-step relearning aligned with the official scheduler behavior even though weights are not user-editable.

The implementation does not use fixed review intervals or an ease-factor model.
Long-term intervals are derived from:

- current `stability`
- elapsed calendar days since `fsrs_last_reviewed_at`
- target retention
- maximum interval
- deterministic fuzz with the official review-seed inputs

## Fuzz

Fuzz is enabled per workspace.

The repository uses a deterministic fuzz rule so backend and iOS produce the same interval for the same:

- review timestamp
- post-increment `reps`
- current FSRS memory state
- scheduler settings

Within a single review event, all rating branches use the same seed, matching `ts-fsrs 5.2.3`.
This avoids cross-platform drift while preserving the official fuzz behavior.

## Source of truth rules

Runtime source of truth:

- card row scheduler state
- workspace row FSRS settings

Historical source of truth:

- `review_events`

Allowed replay usage:

- tests
- explicit development utilities
- controlled migrations if required in the future

Disallowed runtime behavior:

- automatic repair of missing FSRS state during normal reads
- silent fallback from invalid hidden state to replayed history

## Local SQLite migration policy

The local iOS database uses explicit `PRAGMA user_version`.

Because the temporary pre-full-FSRS schema was never committed, the app is allowed to reset local dev data when it detects an older incompatible schema.
That reset path exists only to replace temporary development schemas with the final full-FSRS shape.

## API and UI boundaries

The review submission API remains unchanged:

- clients still submit only `Again`, `Hard`, `Good`, or `Easy`
- the submitted `reviewedAtClient` timestamp is the source of truth for FSRS transition timing

The UI may still present derived labels such as:

- `new`
- `due`
- `scheduled`
- `reviewed`

Those labels are derived product views.
They are not a replacement for persisted scheduler state.

## Testing strategy

Parity is enforced through shared golden vectors in `tests/fsrs-full-vectors.json`.
Those vectors must be consumed by targeted parity tests in:

- backend scheduler tests
- iOS scheduler tests
- Android scheduler tests

This parity suite is intentionally targeted. It does not try to cover every scheduler-adjacent detail in the product, but it must keep the core cross-platform scheduling contract aligned.

Targeted parity coverage:

- first review for each rating
- learning progression
- short-term `Hard`
- graduation with `Easy`
- `Again` from `review` entering `relearning`
- relearning progression with multiple steps
- long-term interval growth with fuzz enabled
- forward-only workspace config changes

Any scheduler change must update:

- this document
- backend and iOS scheduler module comments
- parity vectors


## Dedicated agent review adapter

The [conversational review contract](conversational-reviews.md) exposes the existing
scheduler through MCP `submit_review` and HTTP `POST /v1/agent/reviews/submit`, and
selects its next card with the queue order above. It maps exact
`Again`/`Hard`/`Good`/`Easy` strings to 0–3, stamps the review instant on the server
because the surface is online only, and returns the due time, interval, state, reps,
and lapses. It does not change the scheduler algorithm or released first-party sync
contracts.
