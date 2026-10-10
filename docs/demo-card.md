# Demo Onboarding Card

Single cross-client contract for the demo onboarding card. The web, iOS, and Android
implementations must all match this document.

## What it is

One flashcard, tagged `demo`, seeded as onboarding into an empty workspace: for new users, and on
mobile also for whoever uses the device next after a logout or other local reset.

After it is seeded it is an ordinary card: editable, deletable, synced, and counted by FSRS
scheduling, progress, and streaks like any other card. The one special case is the mobile
guest-upgrade cleanup in [Guest upgrade](#guest-upgrade); there is no other special-case behavior
for it anywhere in the product, and no client may add any.

## Who gets it

New users, plus the empty workspace a mobile reset leaves behind. The seed is client-side on every
client.

The backend never seeds it, and the terminal / AI-agent API, MCP, and other machine entrypoints
never get it.

Per-client rule:

- iOS and Android: when the local workspace row is first created on a fresh install, and again
  whenever a cloud-identity reset or erase recreates it. The local bootstrap entrypoints are
  `apps/ios/Flashcards/Flashcards/Database/LocalDatabase/Initialization/LocalDatabaseBootstrapper.swift`
  and
  `apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/bootstrap/LocalWorkspaceBootstrap.kt`,
  but reaching those entrypoints is not by itself the seeding condition — see the next section.
- Web: at the end of a workspace's first successful hot bootstrap
  (`apps/web/src/appData/sync/remote/bootstrapHotState.ts`), under four conditions that are checked
  together — see [Web: the four seed conditions](#web-the-four-seed-conditions).

### Mobile: seed at first creation and after every cloud-identity reset

Both mobile seeds write through the ordinary card-create path, skip a workspace that holds any card
row (tombstones included), and report a failure instead of failing startup or the reset.

First creation. The bootstrap is an idempotent `ensure…` entrypoint that also runs when a workspace
row already exists, so it reports whether this run created the row, and only the app-start call site
acts on that signal:

- Android: `ensureLocalWorkspaceShell` returns `LocalWorkspaceShell.didCreateWorkspace`, and
  `AppGraph.ensureLocalWorkspaceShell`
  (`apps/android/app/src/main/java/com/flashcardsopensourceapp/app/di/AppGraph.kt`) seeds under it.
- iOS: `DatabaseCore.init(databaseURL:)`
  (`apps/ios/Flashcards/Flashcards/Database/Core/DatabaseCore.swift`) stores the result of
  `LocalDatabaseBootstrapper.ensureDefaultState()` in `createdDefaultWorkspaceId`, and
  `FlashcardsStore.init()` calls `seedOnboardingDemoCardReportingFailure()`
  (`apps/ios/Flashcards/Flashcards/Database/LocalDatabase/LocalDatabase+OnboardingDemoCard.swift`),
  which seeds only when that property is set.

Reset and erase. Logout, account deletion, a detected linked-account change, the credential-recovery
erase, and every other caller of the shared reset wipe the local database and recreate an empty
workspace; the reset then seeds into it, so the card is on screen right after logout, before any
sign-in:

- Android: `CloudIdentityResetCoordinator`
  (`apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/repository/cloudsync/account/CloudIdentityResetCoordinator.kt`)
  invokes its `onLocalWorkspaceRecreated` callback last in `resetLocalStateForCloudIdentityChange`
  and `eraseLocalDataForCredentialRecovery`, and `AppGraph` wires that callback to the seed.
- iOS: `resetLocalStateForCloudIdentityChange` in
  `apps/ios/Flashcards/Flashcards/Cloud/Store/Account/Identity/FlashcardsStore+CloudIdentity.swift`
  calls `seedOnboardingDemoCardAfterCloudIdentityResetReportingFailure()` after the database reset
  and before the reload. `DatabaseCore.resetForAccountDeletion()` itself does not seed and clears
  `createdDefaultWorkspaceId`, so that property keeps meaning first creation only.

Test harnesses that need an empty workspace opt out: iOS UI-test launches reset through
`resetLocalStateForUITestLaunch()`, which skips the seed, and the Android instrumentation
`AppStateResetRule` removes the card its logout seeded.

The reset-seeded card exists only on the device until the next cloud link, and its fate depends on
the workspace selected at sign-in, not on whether the account is new. Linking into a non-empty remote
workspace takes `replace_local_shell` and discards it (see the next sections); a deleted demo card
keeps that workspace non-empty through its tombstone. Linking into an empty remote workspace keeps
it, and that includes an existing account when the user picks "Create new workspace" or an existing
empty workspace at sign-in, so a returning user can get the card back that way; this is accepted. If
the device became a guest first, sign-in is a guest upgrade instead, covered in
[Guest upgrade](#guest-upgrade).

### Web: the four seed conditions

The web seed is the last step of a workspace's first successful hot bootstrap in
`apps/web/src/appData/sync/remote/bootstrapHotState.ts`. It never runs on the already-hydrated path,
which returns before the bootstrap body. Four conditions must all hold:

- `isLocalDbRecovery === false`. This one is a property of the bootstrap run rather than of the
  workspace, so it is checked at the call site and gates whether the seed is invoked at all. A
  local-db recovery is a re-hydration of an evicted IndexedDB cache, which is by definition a
  workspace this browser already bootstrapped once.
- `isOnlyWorkspaceForUser === true`, computed by the caller with `isOnlyWorkspaceOfAccount(...)` in
  `apps/web/src/appData/sync/engine/useSyncEngine.ts` over the account's known workspaces.
- `remoteIsEmpty === true`, as the backend reported it for this bootstrap.
- `localCardCount === 0`, read after the hot pages were applied.

The last three are the guard inside `seedDemoCardForNewWorkspace`
(`apps/web/src/appData/sync/local/demoCard.ts`). That function is a pure guard over its input: every
value is decided by the caller and passed in, and it never re-reads workspace state.

`isOnlyWorkspaceForUser` is what makes this a new-*user* rule instead of a new-*workspace* rule, and
it is the condition that was easiest to miss. An empty workspace is not by itself a new account: an
existing user who deliberately creates a second workspace is handed an empty one too, on a backend
workspace that is empty as well. Without the user-scoped condition every such workspace would be
seeded, which would contradict the new-user rule above and diverge from mobile, where the seed only
ever fires into a local workspace row the device has just created.

## Why nothing may seed into a new user's remote workspace on the server

The constraint is about what the remote workspace *contains* at the first mobile cloud link, not
about which component put it there. This is the non-obvious rule that makes the whole design
client-side, so it is recorded explicitly:

- `loadRemoteEmptyState` in `apps/backend/src/sync/replication/bootstrap.ts` treats a workspace as
  empty only when it has no cards, no decks, and no review events (and, when the bootstrap push
  includes media assets, no media assets either). It inspects only those tables, so it cannot tell a
  demo card apart from any other card, or one seeder apart from another.
- Bootstrap push rejects a non-empty remote workspace with `409 SYNC_BOOTSTRAP_NOT_EMPTY`
  (same file).
- Mobile link then takes the `replace_local_shell` branch instead of the empty-remote branch, and
  `replace_local_shell` discards local content. Only that label is shared by both clients: Android
  calls the empty-remote branch `fork_local_data` (`migrateLocalShellToLinkedWorkspace` in
  `apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/cloud/identity/WorkspaceIdentityLocalStore.kt`)
  and iOS calls it `preserve_local_data`
  (`apps/ios/Flashcards/Flashcards/Cloud/Store/Account/Identity/FlashcardsStore+CloudLink.swift`).
- Net effect: any card sitting in a brand-new user's remote workspace makes their first cloud link
  destroy the offline work they had already done on device.

Server-side seeding of this card is therefore forbidden. A backend seed would reach every
mobile-first user, and the offline work it would destroy is exactly the work this card exists to
get them started on.

The web seed does reach the same remote state, and that is recorded here rather than left implicit.
Web is an authenticated, cloud-backed client, so the card it seeds syncs into the remote workspace
and flips `loadRemoteEmptyState` to `false` for that account; a later first mobile link for the same
account therefore takes `replace_local_shell`. This is accepted because it is bounded to users who
opened the web app first and then built offline content on mobile before linking, where a backend
seed would hit every mobile-first user. No client may treat it as impossible.

## Deduplication

No deterministic ids, and no cross-client id math. Mobile link forks entity ids (see
[docs/sync-identity-model.md](sync-identity-model.md)), so no id survives linking and an id-based
dedupe could not work.

Instead:

- each client seeds only at its own seed moment: web once, for a new user; mobile into a local
  workspace it has just created, at first launch or by a reset;
- each client additionally skips seeding when the workspace already has any card.

The invariant those guards buy is about survival, not about seed-time exclusion. Both seeds can fire
for the same account, and no guard prevents that: the mobile seed happens offline, at first launch or
right after a reset, before that device is linked to any account, so no account-scoped guard on
mobile can observe a web seed, and the web guard is evaluated against a remote workspace the mobile
device has not linked to yet. What the design guarantees is that at most one copy survives, because
on each of the two first-link paths only one side's content ends up in the linked workspace:

- remote empty — Android takes `fork_local_data` and iOS takes `preserve_local_data`, keeping the
  local content. The remote workspace holds no card at all on this path, so there is no web-seeded
  copy to meet, and the mobile-seeded card is the only one.
- remote non-empty — both clients take `replace_local_shell`, which discards the local shell. If
  the web app seeded, its card is what made the workspace non-empty, so the mobile-seeded copy is
  dropped and the web copy is the only one.

Both link paths end with exactly one local workspace and at most one demo card, in either arrival
order.

### Guest upgrade

Guest upgrade merges the already-synced guest workspace into the destination workspace instead of
choosing a side (see [docs/sync-identity-model.md](sync-identity-model.md)), so neither path above
applies, and the guest device seeded its card before it knew about any account. Mobile resolves this
in the client by upgrade mode:

- `bound` (new account): the card stays; the guest user is the account, so no other copy of the
  card can exist.
- `merge_required` (existing account): after the merge, the client deletes the guest's untouched demo
  card when the selected destination workspace holds any card, tombstones included, whose id is not
  one of the guest's card ids. Guest upgrade keeps card ids, so such a card belongs to the account
  that existed before. A destination with no card of its own keeps the card, including a workspace
  created by "Create new workspace" or an existing empty one, even though the account is not new;
  this is accepted. Untouched means active, tagged exactly
  `demo`, with front and back equal to the current app language's seed text; review history does not
  count as touching it. The deletion is the ordinary card delete, so it syncs as an ordinary
  tombstone, and a failure is reported and leaves an ordinary card. This also removes the second
  copy when the selected destination is the web-seeded workspace.

The cleanup lives in
`apps/ios/Flashcards/Flashcards/Cloud/Guest/FlashcardsStore+GuestUpgradeDemoCardCleanup.swift`
(matcher `isUntouchedOnboardingDemoCard` in `LocalDatabase+OnboardingDemoCard.swift`), wired in
`completeGuestCloudLink`, and in
`apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/repository/cloudsync/guest/GuestUpgradeDemoCardCleanup.kt`,
wired in `CloudWorkspaceLinkCoordinator.completeGuestUpgrade`. Both capture the guest cards from the
local database before the local switch to the linked workspace discards the guest rows (Android
before the server completion call, iOS after it), and hold that capture only in memory on the fresh
upgrade path.

Accepted limits:

- any upgrade finished through the pending-upgrade resume path skips the cleanup, so the card stays.
  That covers a relaunch or process death, and also an in-process retry, sign-in, or sync that
  resumes after the fresh path failed and left the pending-upgrade record behind, on both platforms;
- an app-language change between seed and upgrade means the text no longer matches, so the card
  stays;
- a card written to the guest workspace server-side between the pre-upgrade drain and the server
  completion call is
  not among the captured guest ids and counts as an account card, so the card can be deleted from an
  account that had none of its own.

This is the only cleanup; there is no other tag-based cleanup and no unlinking logic anywhere.

## Deletion

Deleting the card, by the user or by the guest-upgrade cleanup, is an ordinary card deletion
producing an ordinary tombstone. It must never be re-seeded into the workspace it was deleted from:
the tombstone keeps every seed guard closed, and a card a later mobile reset seeds is discarded or
cleaned up on the way back into that workspace, within the guest-upgrade limits above. Linking into a
different, empty workspace of the same account keeps it, as described above.

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

### Review presentation

The demo follows the shared
[review Markdown rendering contract](review-markdown-rendering.md): the product name renders in
bold, and the rating label renders as inline code.

## Localization rules

Adding a language is a cross-client rollout, and the demo card is one step in it:
see [docs/add-language.md](add-language.md).

Binding for all three clients:

- one paragraph per string resource: four resources per client, one front string plus three back
  strings. A given string carries the same placeholder set in all three clients, and the sets differ
  per string:
  - front: no placeholder;
  - back 1: the product name;
  - back 2: no placeholder;
  - back 3: the `Again` label;
- no Markdown syntax inside translated strings; each client assembles the Markdown in code and joins
  the paragraphs with a blank line;
- the product name `Nibomo` is never translated and is injected as a placeholder, already
  wrapped in `**` by the client;
- the rating label in paragraph 3 is injected as a placeholder taken from each client's existing
  translated `Again` review label, so the card always matches the button text in that language. The
  client wraps the resolved label in backticks in code, exactly the way it wraps the product name in
  `**`. The translated string therefore carries a bare placeholder with no quotation marks and no
  backticks — the same rule as everywhere else here: translators never see Markdown;
- each string carries translator context explaining that it is the front or back side of an
  onboarding flashcard, wherever the platform's localization format has a comment channel: an XML
  comment in the Android `strings.xml`, and the `comment` field of the `.xcstrings` entry on iOS.
  The web TypeScript catalogs have no comment channel, so nothing is required there;
- Android translations come from Google Play App translations and are not committed to the
  repository (see [apps/android/README.md](../apps/android/README.md)); iOS and web translations are
  repository-owned. Wording will therefore differ slightly per platform, and that is accepted;
- on iOS the four strings must land already translated into every required locale in the same change.
  `scripts/checks/pr/check-ios-localization-parity.mjs` runs in `Repository static validation`, whose
  result is enforced by the required `Repository static checks` aggregate in
  [.github/workflows/pr-checks.yml](../.github/workflows/pr-checks.yml), and it fails
  any translatable `.xcstrings` entry with a missing, empty, or non-`translated` unit in
  a required locale. The [iOS localization guide](ios-localization.md#supported-app-locales)
  owns required-locale coverage; English-only demo-card entries turn that check red;
- on web the four strings must land in every catalog in `apps/web/src/i18n/catalogs/` in the same
  change. `enCatalog` defines the catalog shape and every other catalog is annotated
  `TranslationCatalog` (see [docs/web-localization.md](web-localization.md)), so an English-only
  addition fails the `Build web app` step of the required `Type checks and builds` job in
  [.github/workflows/pr-checks.yml](../.github/workflows/pr-checks.yml).

### Resource keys and where the strings live

The four strings are named `demo_card_front` and `demo_card_back_1` … `demo_card_back_3`. These
canonical names are binding: use them verbatim wherever the platform's localization format takes a
free-form key, so the same paragraph is findable under the same name in every client.

- Android: `apps/android/app/src/main/res/values/strings.xml`, the app module's resources, canonical
  names verbatim in the existing snake_case style of that file. The `review_again` label the card
  interpolates is in a different file in a different module,
  `apps/android/feature/review/src/main/res/values/strings.xml`, and `DemoCardSeed.kt` reads it
  through the review module's `R` (imported as `ReviewR`) while reading the four demo-card strings
  through the app module's `R`. Keep the two files apart: `android.nonTransitiveRClass=true` in
  `apps/android/gradle.properties` means the app module's `R` carries only the resources declared in
  `apps/android/app`, so moving the four demo-card strings to the review module would leave every
  `R.string.demo_card_*` reference in `DemoCardSeed.kt` unresolved and break the Android build — a
  loud compile failure, not a silent no-op.
- iOS: `apps/ios/Flashcards/Flashcards/ReviewCards.xcstrings`, the Review/Cards string table (the
  iOS localization buckets are listed in [docs/ios-localization.md](ios-localization.md)), with the
  canonical names verbatim as `.xcstrings` keys. Most entries in that table are keyed by their
  English source string; the demo card deliberately is not, because its paragraphs are long body
  text. Identifier-style keys are an established pattern already, both in that table
  (`review.leaderboard_shortcut.accessibility_label`) and throughout
  `apps/ios/Flashcards/Flashcards/Resources/Localization/Foundation.xcstrings`, where every entry is
  keyed that way (`access_permission.camera.title`).
- Web: `apps/web/src/i18n/catalogs/`. These catalogs are nested camelCase objects, so the canonical
  names are spelled there as `demoCard.front` and `demoCard.back1` … `demoCard.back3`. This is the
  only place where the spelling differs from the canonical names, and it is a deliberate adaptation
  to the catalog format, not a different set of strings.

## Front/back contract

The front is only the question. The answer lives entirely in the back text. This follows the
mandatory flashcard side contract in the root [AGENTS.md](../AGENTS.md): `frontText` is only a
question/review prompt and never the answer, and `backText` contains the answer.

## Factual note for paragraph 3

The claim "about a minute" is true because:

- the default first learning step is 1 minute in all three places that define it:
  `defaultWorkspaceSchedulerConfig` in `apps/backend/src/scheduling/workspaceConfig.ts`,
  `defaultSchedulerSettingsConfig` in
  `apps/ios/Flashcards/Flashcards/Review/Scheduling/SchedulerSettingsSupport.swift`, and
  `makeDefaultWorkspaceSchedulerSettings` in
  `apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/scheduling/WorkspaceSchedulerSettingsSupport.kt`.
  On mobile the card is seeded offline into a fresh or just-reset local workspace before it is
  linked to any account, so the interval the user actually observes comes from the client default,
  not from the backend one. The web seed happens after the hot bootstrap, so it uses the scheduler
  settings the backend returned;
- cards that become due after `Again` rise ahead of a large old-overdue tail on the next queue
  refresh (see [docs/fsrs-scheduling-logic.md](fsrs-scheduling-logic.md));
- fuzz applies only to long-term intervals, so it does not perturb the first learning step.

If the first learning step ever changes in any of those three places, this paragraph must be
revisited.
