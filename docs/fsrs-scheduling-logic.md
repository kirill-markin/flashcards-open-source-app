# FSRS Scheduling Logic

The backend, the iOS app, and the Android app schedule cards with full FSRS-6, mirroring the official [`ts-fsrs` 5.2.3](https://github.com/open-spaced-repetition/ts-fsrs) scheduler flow with the official default weights ([algorithm notes](https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm)). This document holds the cross-client contract and the product boundaries around that algorithm; the transitions, math, and fuzz are the code.

## Mirror contract

- There are exactly three independent copies of the scheduler, and they must stay behaviorally identical: [backend](../apps/backend/src/scheduling/index.ts), [iOS](../apps/ios/Flashcards/Flashcards/Review/Scheduling/FsrsScheduler.swift), and [Android](../apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/scheduling/FsrsScheduler.kt). Shared symbols carry `Keep in sync with` comments naming their counterparts.
- Scheduler-settings validation and defaults are a second three-way mirror: backend [`workspaceSettings.ts`](../apps/backend/src/scheduling/workspaceSettings.ts) and [`workspaceConfig.ts`](../apps/backend/src/scheduling/workspaceConfig.ts), iOS [`WorkspaceSettingsStore.swift`](../apps/ios/Flashcards/Flashcards/Database/Workspace/WorkspaceSettingsStore.swift) and [`SchedulerSettingsSupport.swift`](../apps/ios/Flashcards/Flashcards/Review/Scheduling/SchedulerSettingsSupport.swift), and Android [`WorkspaceSchedulerSettingsSupport.kt`](../apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/scheduling/WorkspaceSchedulerSettingsSupport.kt). A settings change updates all three in the same PR; the Android file carries no `Keep in sync with` comments, so this list is its only pointer.
- The web app has no scheduler of its own: its local review submission and review-button previews import the backend module, and [`types/study.ts`](../apps/web/src/types/study.ts) mirrors the data contract.
- Fuzz is deterministic, seeded from the review itself, so every platform produces the same interval for the same review.
- Parity is enforced by the shared golden vectors in [`tests/fsrs-full-vectors.json`](../tests/fsrs-full-vectors.json), consumed by the [backend](../apps/backend/src/scheduling/index.test.ts), [iOS](../apps/ios/Flashcards/FlashcardsTests/Review/FSRS/FsrsSchedulerParityTests.swift), and [Android](../apps/android/data/local/src/test/java/com/flashcardsopensourceapp/data/local/model/FsrsSchedulerParityTest.kt) parity tests. The suite is intentionally targeted at the core cross-platform contract rather than every scheduler-adjacent detail.
- A scheduler change updates all three copies, the vectors, and all three test suites in the same PR.

## Product boundaries

- FSRS weights are pinned in code and are not user-configurable.
- Scheduler settings live on the workspace row, not per card ([backend](../apps/backend/src/scheduling/workspaceSettings.ts), [defaults](../apps/backend/src/scheduling/workspaceConfig.ts)). They are forward-only: a change affects future reviews only, and existing card rows remain authoritative.
- Each transition uses the review timestamp the client supplied (`reviewedAtClient`), not server processing time.
- The card row's scheduler state and the workspace row's settings are the runtime source of truth. Append-only `review_events` are history, not a guaranteed rebuild source across settings edits; replaying them is allowed only in tests, explicit development utilities, and controlled migrations.
- Normal reads are pure reads: they never repair missing or invalid scheduler state and never fall back to replayed history. Review submission fails on impossible persisted state, writes must preserve the card invariants the scheduler validates, and existing invalid state is repaired only by a migration or explicit maintenance that never rewrites or deletes `review_events`.
- Labels such as `new`, `due`, `scheduled`, and `reviewed` are derived product views, not a replacement for persisted scheduler state.

## Review queue presentation

Review queue ordering is a cross-client presentation policy, implemented by the [backend](../apps/backend/src/agent/reviews.ts), [web](../apps/web/src/localDb/reviews/reviews.ts), [iOS](../apps/ios/Flashcards/Flashcards/Database/CardStore/CardStore+ReadSQL.swift), and [Android](../apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/database/review/ReviewCardSelectionDao.kt).
It chooses the next active card shown to the user; it does not change FSRS transitions, interval calculations, due counts, sync payloads, API contracts, database schema, remote config, workspace scheduler settings, or persisted scheduler state.

At queue evaluation time `now`, active queue entries are presented in this order:

1. recently reviewed due cards, where `dueAt <= now` and `fsrsLastReviewedAt` is in the inclusive range `[now - 1 hour, now]`
2. other due cards, where `dueAt <= now`
3. new cards, where `dueAt` is `null`

Cards with `dueAt > now` and cards with malformed `dueAt` values are not active queue entries, though preview or timeline surfaces may show them where supported; that includes recently reviewed cards that are still future-due.

Inside the two due buckets the order is `dueAt ASC`, then `createdAt ASC`, then `cardId ASC`; new cards follow `createdAt ASC`, then `cardId ASC`.

The card currently displayed to the user remains pinned until it is answered, even if the canonical queue order changes in the background.
Cards that become due after `Again` or another short-step review can therefore rise ahead of a large old-overdue tail on the next normal queue refresh or review action.
There is no requirement to refresh an idle review screen solely because a card crosses into the due window.

## Dedicated agent review adapter

The [conversational review contract](conversational-reviews.md) exposes the existing
scheduler through the MCP and in-app chat `submit_review` tools and HTTP
`POST /v1/agent/reviews/submit`, and selects its next card with the queue order above.
It maps exact `Again`/`Hard`/`Good`/`Easy` strings to 0–3, stamps the review instant
on the server because the surface is online only, and returns the due time, interval,
state, reps, and lapses. It does not change the scheduler algorithm or released
first-party sync contracts.
