# Demo Onboarding Card

Single cross-client contract for the demo onboarding card. The web, iOS, and Android
implementations must all match this document.

## What it is

One flashcard, tagged `demo`, seeded once for genuinely new users only, as onboarding.

After it is seeded it is an ordinary card: editable, deletable, synced, and counted by FSRS
scheduling, progress, and streaks like any other card. There is no special-case behavior for it
anywhere in the product, and no client may add any.

## Who gets it

Only new users. The seed is client-side on every client.

The backend never seeds it, and the terminal / AI-agent API, MCP, and other machine entrypoints
never get it.

Per-client new-user rule:

- iOS and Android: at the moment the local workspace row is first created on a fresh install. The
  local bootstrap entrypoints are
  `apps/ios/Flashcards/Flashcards/Database/LocalDatabase/Initialization/LocalDatabaseBootstrapper.swift`
  and
  `apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/bootstrap/LocalWorkspaceBootstrap.kt`,
  but reaching those entrypoints is not by itself the seeding condition — see the next section.
- Web: at the end of a workspace's first successful hot bootstrap
  (`apps/web/src/appData/sync/remote/bootstrapHotState.ts`), under four conditions that are checked
  together — see [Web: the four seed conditions](#web-the-four-seed-conditions).

### Mobile: never seed on a cloud-identity reset

The mobile bootstrap is an idempotent `ensure…` entrypoint that does not run only on a fresh
install. Logout, a detected linked-account change, account deletion, and the credential-recovery
erase all wipe the local database and then re-create an empty workspace row through the same
bootstrap:

- Android: `resetLocalStateForCloudIdentityChange` and `eraseLocalDataForCredentialRecovery` in
  `apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/repository/cloudsync/account/CloudIdentityResetCoordinator.kt`
  call `database.clearAllTables()` and then `ensureLocalWorkspaceShell(...)`.
- iOS: `resetLocalStateForCloudIdentityChange` in
  `apps/ios/Flashcards/Flashcards/Cloud/Store/Account/Identity/FlashcardsStore+CloudIdentity.swift`
  calls `database.resetForAccountDeletion()`, which resets the schema and then runs
  `LocalDatabaseBootstrapper.ensureDefaultState()`.

Clients must never seed on those paths: it would hand the demo card back to a returning user who
already deleted it. The "workspace already has any card" guard below does not help here, because
the tables were just cleared.

The binding rule is therefore an outcome, not a mechanism: a client seeds only at the genuinely
first creation of its local workspace row, and never from a reset or erase path, however many times
that row is re-created afterwards.

How each client reaches that outcome is up to it, and neither client persists extra state for it:
the bootstrap reports whether it just created the workspace row, and only the app-start call site
acts on that signal. The reset paths call the same bootstrap and ignore it.

Both bootstraps report that signal:

- Android: `ensureLocalWorkspaceShell` returns a `LocalWorkspaceShell` value type carrying
  `workspaceId` and `didCreateWorkspace`, and the two branches differ:
  `didCreateWorkspace` is `true` only on the branch that inserted the workspace row and `false` on
  the branch that found one. The only reader is `AppGraph.ensureLocalWorkspaceShell`
  (`apps/android/app/src/main/java/com/flashcardsopensourceapp/app/di/AppGraph.kt`), which calls
  `seedDemoCardForNewWorkspace` under that flag. `CloudIdentityResetCoordinator` reads only
  `workspaceId` from the same result and never looks at the flag, so its resets cannot seed.
- iOS: `LocalDatabaseBootstrapper.ensureDefaultState()` returns `String?` — the workspace id when
  that run inserted the very first workspace row, and `nil` when a workspace row was already there.
  It runs inside `DatabaseCore.init(databaseURL:)`
  (`apps/ios/Flashcards/Flashcards/Database/Core/DatabaseCore.swift`), which stores the result in
  the `createdDefaultWorkspaceId` property. That property is how the signal leaves the initializer
  and reaches the app-start call site: `FlashcardsStore.init()` calls
  `seedOnboardingDemoCardReportingFailure()` immediately after `LocalDatabase()` succeeds, and
  `seedOnboardingDemoCardIfNeeded()` in
  `apps/ios/Flashcards/Flashcards/Database/LocalDatabase/LocalDatabase+OnboardingDemoCard.swift`
  returns early unless `createdDefaultWorkspaceId` is set.

On iOS the suppression is an explicit property assignment rather than anything the bootstrapper
reports back. `DatabaseCore.resetForAccountDeletion()` re-runs the bootstrapper and discards its
result (`_ = try LocalDatabaseBootstrapper(core: self).ensureDefaultState()`), so the creation that
run reports never reaches `createdDefaultWorkspaceId`; a separate line then assigns that property
`nil`. What the assignment clears is therefore whatever `init(databaseURL:)` left in it, which is
already `nil` on any device whose local workspace row existed at launch, and holds an id only in a
session that created that row itself and then resets in the same app run — a fresh install that
signs in and then logs out, hits a linked-account change, deletes the account, or erases
credentials. `DatabaseCore` outlives the reset, so without that line it would keep reporting a
creation for a workspace the reset has just wiped and recreated, and that no-longer-new device would
read as brand-new, which, as above, the card-count guard could not catch. The single reader today,
`FlashcardsStore.init()`, runs before any reset can happen, so the line is what keeps the property's
stated meaning true for the object's whole lifetime; the binding rule is that no reset path may
leave the signal armed.

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
seeded, which would contradict the "only new users" rule above and diverge from mobile, where the
seed can only ever fire at the first creation of the device's local workspace row.

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

- each client seeds at most once, at its own new-user moment;
- each client additionally skips seeding when the workspace already has any card.

The invariant those guards buy is about survival, not about seed-time exclusion. Both seeds can fire
for the same account, and no guard prevents that: the mobile seed happens offline at first launch,
before any account exists on that device, so no account-scoped guard on mobile can observe a web
seed, and the web guard is evaluated against a remote workspace the mobile device has not linked to
yet. What the design guarantees is that at most one copy survives, because on each of the two
first-link paths only one side's content ends up in the linked workspace:

- remote empty — Android takes `fork_local_data` and iOS takes `preserve_local_data`, keeping the
  local content. The remote workspace holds no card at all on this path, so there is no web-seeded
  copy to meet, and the mobile-seeded card is the only one.
- remote non-empty — both clients take `replace_local_shell`, which discards the local shell. If
  the web app seeded, its card is what made the workspace non-empty, so the mobile-seeded copy is
  dropped and the web copy is the only one.

Both link paths end with exactly one local workspace and at most one demo card, in either arrival
order.

Guest upgrade is where that outcome does not hold, and it follows from the same reasoning rather
than contradicting it. Guest upgrade merges the already-synced guest workspace into the destination
workspace instead of choosing a side (see
[docs/sync-identity-model.md](sync-identity-model.md)), so neither copy is discarded and a mobile
guest that already seeded its card and then upgrades into a web-seeded account keeps both. No guard
could have prevented it: each client evaluated its own guard correctly at its own new-user moment,
before the two workspaces ever met.

That same path is also how the card can land in an account that already existed: the guest device
seeded it before it knew about any account. Both outcomes — the extra copy and the arrival into an
existing account — are accepted, and both leave ordinary cards behind. There is no cleanup-by-tag
and no unlinking logic anywhere.

## Deletion

Deleting the card is an ordinary card deletion producing an ordinary tombstone. It must never be
re-seeded.

## Canonical English source text

This is the source of truth. All three clients must match it.

Front:

```text
What is the best application for studying?
```

Back, five paragraphs joined with a blank line:

```text
**Flashcards Open Source App** — the app you are looking at right now.

Everything here is a flashcard: a question on the front, the answer on the back. You can write cards yourself, or just give the built-in AI chat a topic and it will create a set of cards for you.

When you review, you try to recall the answer, then rate how it went. Every card schedules itself from there: what you know well comes back in weeks or months, what you keep forgetting comes back today or tomorrow.

Rate honestly, this is what makes it work. If you did not know the answer, choose `Again` — including when you had to peek. `Hard` is only for answers you knew but struggled to recall.

Try it right now: rate this card `Again`, and it will come back in about a minute — so this answer sticks.
```

### The backticks are load-bearing, not decoration

`classifyReviewContentPresentation` returns the Markdown mode as soon as the text contains a
backtick, on all three clients
(`apps/ios/Flashcards/Flashcards/Review/View/ReviewContentPresentation.swift`,
`apps/web/src/screens/review/components/card/reviewContentPresentation.ts`,
`apps/android/feature/review/src/main/java/com/flashcardsopensourceapp/feature/review/presentation/ReviewContentParser.kt`).

Inline emphasis alone never switches the mode:
[docs/review-markdown-rendering.md](review-markdown-rendering.md) states this and uses
`A **short** answer` as its example. The assembled back text carries no backtick-free Markdown cue
and does contain newlines, so without a backtick it would classify as paragraph plain text and every
new user, in every locale, would see literal `**` around the product name on their very first card.

Anyone removing the backticks must also remove the bold.

## Localization rules

Binding for all three clients:

- one paragraph per string resource: six resources per client, one front string plus five back
  strings. A given string carries the same placeholder set in all three clients, and the sets differ
  per string:
  - front: no placeholder;
  - back 1: the product name;
  - back 2 and back 3: no placeholder;
  - back 4: the `Again` label and the `Hard` label;
  - back 5: the `Again` label;
- no Markdown syntax inside translated strings; each client assembles the Markdown in code and joins
  the paragraphs with a blank line;
- the product name `Flashcards Open Source App` is never translated and is injected as a
  placeholder, already wrapped in `**` by the client;
- the rating labels in paragraphs 4 and 5 are injected as placeholders taken from each client's
  existing translated `Again` / `Hard` review labels, so the card always matches the button text in
  that language. The client wraps each resolved label in backticks in code, exactly the way it wraps
  the product name in `**`. The translated strings therefore carry a bare placeholder with no
  quotation marks and no backticks — the same rule as everywhere else here: translators never see
  Markdown;
- each string carries translator context explaining that it is the front or back side of an
  onboarding flashcard, wherever the platform's localization format has a comment channel: an XML
  comment in the Android `strings.xml`, and the `comment` field of the `.xcstrings` entry on iOS.
  The web TypeScript catalogs have no comment channel, so nothing is required there;
- Android translations come from Google Play App translations and are not committed to the
  repository (see [apps/android/README.md](../apps/android/README.md)); iOS and web translations are
  repository-owned. Wording will therefore differ slightly per platform, and that is accepted;
- on iOS the six strings must land already translated into every required locale in the same change.
  `scripts/checks/pr/check-ios-localization-parity.mjs` runs in the required `Repository static
  checks` job of [.github/workflows/pr-checks.yml](../.github/workflows/pr-checks.yml), and it fails
  any `.xcstrings` entry whose `ar`, `de`, `es-ES`, `es-MX`, `hi`, `ja`, `ru`, or `zh-Hans`
  localization is missing, empty, or not in `state: "translated"`. English-only demo-card entries
  turn that check red;
- on web the six strings must land in all nine catalogs in `apps/web/src/i18n/catalogs/` in the same
  change. `enCatalog` defines the catalog shape and every other catalog is annotated
  `TranslationCatalog` (see [docs/web-localization.md](web-localization.md)), so an English-only
  addition fails the `Build web app` step of the required `Type checks and builds` job in
  [.github/workflows/pr-checks.yml](../.github/workflows/pr-checks.yml).

### Resource keys and where the strings live

The six strings are named `demo_card_front` and `demo_card_back_1` … `demo_card_back_5`. These
canonical names are binding: use them verbatim wherever the platform's localization format takes a
free-form key, so the same paragraph is findable under the same name in every client.

- Android: `apps/android/app/src/main/res/values/strings.xml`, the app module's resources, canonical
  names verbatim in the existing snake_case style of that file. The `review_again` and `review_hard`
  labels the card interpolates are a different file in a different module,
  `apps/android/feature/review/src/main/res/values/strings.xml`, and `DemoCardSeed.kt` reads them
  through the review module's `R` (imported as `ReviewR`) while reading the six demo-card strings
  through the app module's `R`. Keep the two files apart: `android.nonTransitiveRClass=true` in
  `apps/android/gradle.properties` means the app module's `R` carries only the resources declared in
  `apps/android/app`, so moving the six demo-card strings to the review module would leave every
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
  names are spelled there as `demoCard.front` and `demoCard.back1` … `demoCard.back5`. This is the
  only place where the spelling differs from the canonical names, and it is a deliberate adaptation
  to the catalog format, not a different set of strings.

## Front/back contract

The front is only the question. The answer lives entirely in the back text. This follows the
mandatory flashcard side contract in the root [AGENTS.md](../AGENTS.md): `frontText` is only a
question/review prompt and never the answer, and `backText` contains the answer.

## Factual note for paragraph 5

The claim "about a minute" is true because:

- the default first learning step is 1 minute in all three places that define it:
  `defaultWorkspaceSchedulerConfig` in `apps/backend/src/scheduling/workspaceConfig.ts`,
  `defaultSchedulerSettingsConfig` in
  `apps/ios/Flashcards/Flashcards/Review/Scheduling/SchedulerSettingsSupport.swift`, and
  `makeDefaultWorkspaceSchedulerSettings` in
  `apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/scheduling/WorkspaceSchedulerSettingsSupport.kt`.
  On mobile the card is seeded offline before any account or sync exists, so the interval the new
  user actually observes comes from the client default, not from the backend one. The web seed
  happens after the hot bootstrap, so it uses the scheduler settings the backend returned;
- cards that become due after `Again` rise ahead of a large old-overdue tail on the next queue
  refresh (see [docs/fsrs-scheduling-logic.md](fsrs-scheduling-logic.md));
- fuzz applies only to long-term intervals, so it does not perturb the first learning step.

If the first learning step ever changes in any of those three places, this paragraph must be
revisited.
