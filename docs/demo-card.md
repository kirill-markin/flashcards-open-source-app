# Demo Onboarding Card

Single cross-client contract for the demo onboarding card. The web, iOS, and Android
implementations must all match this document.

## What it is

One flashcard, tagged `demo`, seeded as onboarding into an empty workspace: for new users, and on
mobile also for whoever uses the device next after a logout or other local reset.

After it is seeded it is an ordinary card: editable, deletable, synced, and counted by FSRS
scheduling, progress, and streaks like any other card. Disposal is limited to the provenance-backed
catalog onboarding import below and the [guest-upgrade cleanup](#guest-upgrade).

## Server provenance

New client seeds may carry optional `metadata.onboardingDemo`
([`OnboardingDemoMetadata`](../apps/backend/src/cards/types.ts),
[`onboardingDemo.ts`](../apps/backend/src/cards/onboardingDemo.ts)): the original seeded content
plus a sticky `wasEdited`.

Only the first server insertion establishes the baseline. Later winning writes keep that baseline,
including when released clients omit it, and latch `wasEdited` for content, type or source changes.
Local editors must also latch it to retain an edit reverted before the server observes it.
Sync, first-link forks and actual guest transfers retain provenance; arbitrary package copies strip
it and keep ordinary source attribution. Missing, invalid or unknown provenance means ordinary
preserved content. Never infer it from text, tags, IDs or current locale, or retrofit existing cards.

## Who gets it

New users, plus the empty workspace a mobile reset leaves behind. The seed is client-side on every
client. The backend never seeds it, and the terminal / AI-agent API, MCP, and other machine
entrypoints never get it.

### Mobile: seed at first creation and after every cloud-identity reset

Both mobile seeds write through the ordinary card-create path, skip a workspace that holds any card
row (tombstones included), and report a failure instead of failing startup or the reset.

- First creation: only when this app start created the local workspace row, not on every run of the
  idempotent bootstrap ([Android `AppGraph.kt`](../apps/android/app/src/main/java/com/flashcardsopensourceapp/app/di/AppGraph.kt),
  [iOS `DatabaseCore.swift`](../apps/ios/Flashcards/Flashcards/Database/Core/DatabaseCore.swift) and
  [`LocalDatabase+OnboardingDemoCard.swift`](../apps/ios/Flashcards/Flashcards/Database/LocalDatabase/LocalDatabase+OnboardingDemoCard.swift)).
- Reset and erase: logout, account deletion, a detected linked-account change, the
  credential-recovery erase, and every other caller of the shared reset recreate an empty workspace
  and seed into it, so the card is on screen right after logout, before any sign-in
  ([Android `CloudIdentityResetCoordinator.kt`](../apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/repository/cloudsync/account/CloudIdentityResetCoordinator.kt),
  [iOS `FlashcardsStore+CloudIdentity.swift`](../apps/ios/Flashcards/Flashcards/Cloud/Store/Account/Identity/FlashcardsStore+CloudIdentity.swift)).
  Test harnesses that need an empty workspace opt out: iOS `resetLocalStateForUITestLaunch()` skips
  the seed, and the Android instrumentation `AppStateResetRule` removes the card its logout seeded.

The reset-seeded card exists only on the device until the next cloud link, and its fate depends on
the workspace selected at sign-in, not on whether the account is new. Linking into a non-empty remote
workspace takes `replace_local_shell` and discards it; a deleted demo card keeps that workspace
non-empty through its tombstone. Linking into an empty remote workspace keeps it, and that includes
an existing account when the user picks "Create new workspace" or an existing empty workspace at
sign-in, so a returning user can get the card back that way; this is accepted. If the device became
a guest first, sign-in is a guest upgrade instead, covered in [Guest upgrade](#guest-upgrade).

### Web: the four seed conditions

The web seed is the last step of a workspace's first successful hot bootstrap
([`bootstrapHotState.ts`](../apps/web/src/appData/sync/remote/bootstrapHotState.ts), guard in
[`demoCard.ts`](../apps/web/src/appData/sync/local/demoCard.ts)). All four must hold: the run is not
a local-db recovery, this is the account's only workspace, the backend reported the remote workspace
empty, and no local card exists after the hot pages were applied.

The only-workspace condition makes this a new-*user* rule instead of a new-*workspace* rule: an
existing user who creates a second workspace is handed an empty one too, and must not be onboarded
again. That keeps web aligned with mobile, where the seed only ever fires into a local workspace row
the device has just created.

## Why nothing may seed into a new user's remote workspace on the server

The constraint is about what the remote workspace *contains* at the first mobile cloud link, not
about which component put it there. A remote workspace holding any card is not empty to
[`loadRemoteEmptyState`](../apps/backend/src/sync/replication/bootstrap.ts), so bootstrap push
rejects it with `409 SYNC_BOOTSTRAP_NOT_EMPTY`, and the mobile link takes `replace_local_shell`,
which discards local content, instead of the empty-remote branch (`fork_local_data` on
[Android](../apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/cloud/identity/WorkspaceIdentityLocalStore.kt),
`preserve_local_data` on
[iOS](../apps/ios/Flashcards/Flashcards/Cloud/Store/Account/Identity/FlashcardsStore+CloudLink.swift)).
Any card in a brand-new user's remote workspace therefore makes their first cloud link destroy the
offline work they had already done on device.

Server-side seeding of this card is therefore forbidden. A backend seed would reach every
mobile-first user, and the offline work it would destroy is exactly the work this card exists to
get them started on.

The web seed does reach the same remote state: the card it seeds syncs into the remote workspace, so
a later first mobile link for the same account takes `replace_local_shell`. This is accepted because
it is bounded to users who opened the web app first and then built offline content on mobile before
linking, where a backend seed would hit every mobile-first user. No client may treat it as
impossible.

## Deduplication

No deterministic ids, and no cross-client id math. Mobile link forks entity ids (see
[docs/sync-identity-model.md](sync-identity-model.md)), so no id survives linking and an id-based
dedupe could not work.

Instead, each client seeds only at its own seed moment (web once, for a new user; mobile into a local
workspace it has just created, at first launch or by a reset) and skips seeding when the workspace
already has any card.

Both seeds can still fire for the same account: the mobile seed happens offline, before that device
is linked to any account, and the web guard is evaluated against a remote workspace the mobile device
has not linked to yet. What the design guarantees is that at most one copy survives, because on each
first-link path only one side's content ends up in the linked workspace:

- remote empty: the mobile client keeps its local content, and the remote workspace holds no card,
  so there is no web-seeded copy to meet;
- remote non-empty: the mobile client takes `replace_local_shell` and drops its local copy; if the
  web app seeded, its card is what made the workspace non-empty and is the only one.

### Guest upgrade

The native and browser guest-upgrade endpoints share an additive demo-only protocol. Existing
clients retain the explicit transfer and post-merge cleanup described below.

For a guest whose entire stored content is one active, unchanged provenance-backed onboarding demo,
preparation returns `mode: "merge_required"` and optional `demoOnlyDestinationWorkspaceId`. Reviews
and scheduler state do not count as edits. Tombstones, other cards, decks, media, chat/history or
other material workspace content prevent qualification; missing, invalid or edited provenance never
authorizes disposal. The destination is the account's selected accessible visible workspace, or
its earliest visible existing workspace. This shortcut never creates a workspace.

A client supporting this path must finish guest sync and drain its outbox, persist
`selection: { type: "existing", workspaceId: demoOnlyDestinationWorkspaceId, discardDemoOnly: true }`
before completion, and send `guestWorkspaceSyncedAndOutboxDrained: true` and
`supportsDroppedEntities: true`. It skips transfer selection. Completion fences guest writes,
revalidates eligibility, and atomically deletes the demo and its reviews, records their IDs in
durable `droppedEntities`, and completes the ordinary identity, billing, consent and preference
transfers. It preserves the destination scheduler even when the guest's settings are newer.
The destination may be empty. A `bound` new-account upgrade retains its demo and reviews.

`GUEST_UPGRADE_DEMO_ONLY_NOT_ELIGIBLE` (409) means content changed: preserve guest data, prepare
again and obtain an explicit transfer choice. Never turn this refusal into an automatic ordinary
merge. `GUEST_UPGRADE_GUEST_BUSY` (409) means another guest writer is active: finish guest sync and
retry the saved selection. Missing drain or reconciliation support is refused with the existing
`GUEST_UPGRADE_GUEST_SYNC_NOT_DRAINED` or `GUEST_UPGRADE_DROPPED_ENTITIES_UNSUPPORTED` errors.

After a lost completion response, process death or an in-process retry, complete with the saved
selection and reconcile the replayed `droppedEntities` before resuming normal account sync.
Preparation after an already-committed existing-workspace upgrade also returns the history's
original destination as `demoOnlyDestinationWorkspaceId`; this is recovery information, not a
new content qualification. It must never follow a later account workspace selection. Replays
require a proved identity of the same canonical account, and browser or opt-in native completion
refuses a changed destination with `GUEST_UPGRADE_SELECTION_MISMATCH`. If the saved destination
is unavailable, surface recovery failure and preserve local data instead of choosing another one.

#### Legacy explicit transfer

Guest upgrade merges the already-synced guest workspace into the destination workspace instead of
choosing a side (see [docs/sync-identity-model.md](sync-identity-model.md)), so neither path above
applies, and the guest device seeded its card before it knew about any account. The web and mobile clients resolve this
by upgrade mode:

- `bound` (new account): the card stays; the guest user is the account, so no other copy of the
  card can exist.
- `merge_required` (existing account): after the merge, the client deletes the guest's untouched demo
  card when the selected destination workspace holds any card, tombstones included, whose id is not
  one of the guest's card ids. Guest upgrade keeps card ids, so such a card belongs to the account
  that existed before. A destination with no card of its own keeps the card, including a workspace
  created by "Create new workspace" or an existing empty one, even though the account is not new;
  this is accepted. Untouched means active, tagged exactly `demo`, with front and back equal to the
  current app language's seed text; review history does not count as touching it. The deletion is
  the ordinary card delete, so it syncs as an ordinary tombstone, and a failure is reported and
  leaves an ordinary card. This also removes the second copy when the selected destination is the
  web-seeded workspace.

Implementations:
[iOS](../apps/ios/Flashcards/Flashcards/Cloud/Guest/FlashcardsStore+GuestUpgradeDemoCardCleanup.swift),
[Android](../apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/repository/cloudsync/guest/GuestUpgradeDemoCardCleanup.kt),
[web](../apps/web/src/appData/session/guest/demoCardCleanup.ts).

Accepted limits:

- any upgrade finished through the pending-upgrade resume path skips the cleanup, so the card stays.
  That covers a relaunch or process death, and also an in-process retry, sign-in, or sync that
  resumes after the fresh path failed and left the pending-upgrade record behind, on all three clients;
- an app-language change between seed and upgrade means the text no longer matches, so the card
  stays;
- a card written to the guest workspace server-side between the pre-upgrade drain and the server
  completion call is not among the captured guest ids and counts as an account card, so the card can
  be deleted from an account that had none of its own.

Outside the opt-in demo-only protocol, this remains the only cleanup; there is no other
tag-based cleanup or unlinking logic.

## Catalog onboarding import

The catalog install context reports empty workspaces and those containing only one active,
unchanged provenance-backed demo as eligible for an explicit `immediateOnboarding` import.
Reviews and scheduling state do not count as edits. Tombstones, authored or edited cards, missing
or invalid provenance, and other material workspace content require the ordinary import flow.

The server revalidates eligibility under the workspace sync lock after checking durable replay.
It imports the catalog cards and tombstones only the confirmed unchanged demo atomically through
ordinary hot sync publication. A failed import preserves all prior content; retrying a committed
request replays its original result even though the imported cards now make the workspace ineligible.
Normal explicit catalog imports preserve the demo.

## Deletion

User deletion and legacy post-merge cleanup are ordinary card deletions producing tombstones.
The tombstone prevents re-seeding into that workspace, and a card a later mobile reset seeds is discarded or
cleaned up on the way back into that workspace, within the guest-upgrade limits above. Linking into a
different, empty workspace of the same account keeps it, as described above.

Demo-only completion removes the source workspace and uses durable dropped-entity IDs for local
reconciliation; it creates no card or review rows in the existing destination.

## Canonical English source text

This is the source of truth. All three clients must match it.

Front:

```text
What is the best application for studying?
```

Back, three paragraphs joined with a blank line:

```text
**Nibomo** — the app you are looking at right now. Everything here is a flashcard: a question on the front, the answer on the back.

Give the built-in AI chat a topic and it will create a set of cards for you.

Try it right now: rate this card `Again`, and it will come back in about a minute — so this answer sticks.
```

The demo follows the shared [review Markdown rendering contract](review-markdown-rendering.md): the
product name renders in bold, and the rating label renders as inline code.

## Localization rules

Adding a language is a cross-client rollout, and the demo card is one step in it:
see [docs/add-language.md](add-language.md).

Binding for all three clients:

- one paragraph per string resource: four resources per client, one front string plus three back
  strings. A given string carries the same placeholder set in all three clients: the front and back
  2 have none, back 1 takes the product name, and back 3 takes the `Again` label;
- translators never see Markdown: each client assembles the Markdown in code and joins the
  paragraphs with a blank line;
- the product name `Nibomo` is never translated and is injected already wrapped in `**`;
- the rating label is the client's existing translated `Again` review label, so the card always
  matches the button text in that language, injected already wrapped in backticks;
- each string carries translator context explaining that it is the front or back side of an
  onboarding flashcard, wherever the platform's localization format has a comment channel (Android
  `strings.xml`, iOS `.xcstrings`);
- Android translations come from Google Play App translations and are not committed to the
  repository (see [apps/android/README.md](../apps/android/README.md)); iOS and web translations are
  repository-owned and land in every required locale in the same change
  ([iOS](ios-localization.md#supported-app-locales), [web](web-localization.md)). Wording therefore
  differs slightly per platform, and that is accepted.

The four strings are named `demo_card_front` and `demo_card_back_1` … `demo_card_back_3`, verbatim
wherever the platform's localization format takes a free-form key, so the same paragraph is findable
under the same name in every client; the web's nested camelCase catalogs spell them `demoCard.front`
and `demoCard.back1` … `demoCard.back3`. They live in
[Android `strings.xml`](../apps/android/app/src/main/res/values/strings.xml) (read by
[`DemoCardSeed.kt`](../apps/android/app/src/main/java/com/flashcardsopensourceapp/app/onboarding/DemoCardSeed.kt)),
[iOS `ReviewCards.xcstrings`](../apps/ios/Flashcards/Flashcards/ReviewCards.xcstrings), and the
[web catalogs](../apps/web/src/i18n/catalogs/).

## Factual note for paragraph 3

The claim "about a minute" is true because:

- the default first learning step is 1 minute in all three places that define it:
  [backend](../apps/backend/src/scheduling/workspaceConfig.ts),
  [iOS](../apps/ios/Flashcards/Flashcards/Review/Scheduling/SchedulerSettingsSupport.swift), and
  [Android](../apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/scheduling/WorkspaceSchedulerSettingsSupport.kt).
  A mobile seed is reviewed under the client default, because it lands offline before any link; the
  web seed uses the scheduler settings the backend returned;
- cards that become due after `Again` rise ahead of a large old-overdue tail on the next queue
  refresh (see [Review queue presentation](fsrs-scheduling-logic.md#review-queue-presentation));
- fuzz applies only to long-term intervals, so it does not perturb the first learning step.

If the first learning step ever changes in any of those three places, this paragraph must be
revisited.
