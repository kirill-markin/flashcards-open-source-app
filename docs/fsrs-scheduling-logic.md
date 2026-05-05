# FSRS Scheduling Logic

## Scope

This document describes the current full FSRS implementation used by the backend, the iOS app, and the Android app.
It is the source of truth for hidden scheduler state, workspace-level scheduler settings, and the product-specific boundaries around official FSRS behavior.

Reference implementation:

- official open-spaced-repetition [`ts-fsrs` 5.2.3](https://github.com/open-spaced-repetition/ts-fsrs) scheduler flow mirrored by this repository
- official FSRS algorithm notes: [`fsrs4anki` wiki, "The Algorithm"](https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm)
- official FSRS-6 default weights

Repository implementations:

- backend scheduler: `apps/backend/src/schedule.ts`
- backend card persistence: `apps/backend/src/cards.ts`
- backend workspace scheduler settings: `apps/backend/src/workspaceSchedulerSettings.ts`
- iOS scheduler: `apps/ios/Flashcards/Flashcards/FsrsScheduler.swift`
- iOS local persistence: `apps/ios/Flashcards/Flashcards/LocalDatabase.swift`
- Android scheduler: `apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/FsrsScheduler.kt`
- Android local persistence: `apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/repository/LocalRepositories.kt`
- web FSRS type mirror: `apps/web/src/types.ts`
- web local review submit flow: `apps/web/src/appData/useSyncEngine.ts`
- iOS settings UI: `apps/ios/Flashcards/Flashcards/SettingsView.swift`
- Android settings UI: `apps/android/feature/settings/src/main/java/com/flashcardsopensourceapp/feature/settings/SchedulerSettingsRoute.kt`

## Mirror contract

The repository has exactly three independent implementations of the FSRS scheduler algorithm:

- backend: `apps/backend/src/schedule.ts`
- iOS: `apps/ios/Flashcards/Flashcards/FsrsScheduler.swift`
- Android: `apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/FsrsScheduler.kt`

They are full platform-specific copies of the same algorithm and must stay behaviorally identical.
The web app does not contain a fourth standalone scheduler implementation in this repository.
Instead, the web review flow reuses the backend scheduler module from `apps/backend/src/schedule.ts` for local review submission and button-interval previews, while `apps/web/src/types.ts` mirrors the FSRS data contract.

Supporting mirrors around the scheduler contract:

- backend review persistence: `apps/backend/src/cards.ts`
- iOS review persistence: `apps/ios/Flashcards/Flashcards/LocalDatabase.swift`
- Android review persistence: `apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/repository/LocalRepositories.kt`
- web local review submit flow reusing backend scheduler: `apps/web/src/appData/useSyncEngine.ts`
- backend scheduler settings: `apps/backend/src/workspaceSchedulerSettings.ts`
- iOS scheduler settings: `apps/ios/Flashcards/Flashcards/LocalDatabase.swift`
- Android scheduler settings: `apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/WorkspaceSchedulerSettingsSupport.kt`
- shared parity vectors: `tests/fsrs-full-vectors.json`
- backend parity tests: `apps/backend/src/schedule.test.ts`
- iOS parity tests: `apps/ios/Flashcards/FlashcardsTests/Review/FsrsSchedulerParityTests.swift`
- Android parity tests: `apps/android/data/local/src/test/java/com/flashcardsopensourceapp/data/local/model/FsrsSchedulerParityTest.kt`

Any scheduler change must update the backend copy, the iOS copy, the Android copy, this document, and the parity vectors plus all three test suites in the same PR.

Core scheduler symbol parity:

| Backend (`apps/backend/src/schedule.ts`) | iOS (`apps/ios/Flashcards/Flashcards/FsrsScheduler.swift`) |
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

Android keeps the same scheduler symbol set in `apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/FsrsScheduler.kt`.
Because Android persistence uses epoch milliseconds instead of `Date`, the Android mirror uses `*Millis` timestamp fields while keeping the same transition logic, helper structure, seed rules, and validation semantics as backend and iOS.

Scheduler-entrypoint parity:

| Backend | iOS |
| --- | --- |
| `apps/backend/src/cards.ts::toReviewableCardScheduleState` | `apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::makeReviewableCardScheduleState(card:)` |
| `apps/backend/src/cards.ts::submitReview` | `apps/ios/Flashcards/Flashcards/LocalDatabase.swift::submitReview(workspaceId:reviewSubmission:)` |
| `apps/backend/src/workspaceSchedulerSettings.ts::parseSteps` | `apps/ios/Flashcards/Flashcards/LocalDatabase.swift::validateSchedulerStepList(values:fieldName:)` |
| `apps/backend/src/workspaceSchedulerSettings.ts::validateWorkspaceSchedulerSettingsInput` | `apps/ios/Flashcards/Flashcards/LocalDatabase.swift::validateWorkspaceSchedulerSettingsInput(desiredRetention:learningStepsMinutes:relearningStepsMinutes:maximumIntervalDays:enableFuzz:)` |
| `apps/backend/src/workspaceSchedulerSettings.ts::getWorkspaceSchedulerSettings` / `getWorkspaceSchedulerConfig` | `apps/ios/Flashcards/Flashcards/LocalDatabase.swift::loadWorkspaceSchedulerSettings(workspaceId:)` |
| `apps/backend/src/workspaceSchedulerSettings.ts::updateWorkspaceSchedulerSettings` | `apps/ios/Flashcards/Flashcards/LocalDatabase.swift::updateWorkspaceSchedulerSettings(workspaceId:desiredRetention:learningStepsMinutes:relearningStepsMinutes:maximumIntervalDays:enableFuzz:)` |

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

Runtime code must validate persisted scheduler state during normal reads and review submission.
If a card is invalid, runtime code must log the error and reset that card to the canonical `new` scheduler state.
The repair path must not rewrite or delete `review_events`.
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

1. recent due cards, where `dueAt` is in the inclusive range `[now - 1 hour, now]`
2. old due cards, where `dueAt < now - 1 hour`
3. new cards, where `dueAt` is `null`

The recent-due boundary is inclusive at both ends: `dueAt == now` and `dueAt == now - 1 hour` are recent due.
Cards with `dueAt > now` and cards with malformed `dueAt` values are not active queue entries, though preview or timeline surfaces may show them where supported.

Tie-breakers inside the recent due and old due buckets must remain stable:

1. `dueAt ASC`
2. `createdAt DESC`
3. `cardId ASC`

The card currently displayed to the user remains pinned until it is answered, even if the canonical queue order changes in the background.
Cards that become due after `Again` or another short-step review can rise ahead of a large old-overdue tail on the next normal queue refresh or review action.
There is no requirement to refresh an idle review screen solely because a card crosses into the recent-due window.

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
