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
- Web: after the first hot bootstrap, only when the backend reported `remoteIsEmpty === true` and
  the local card count is `0` (`apps/web/src/appData/sync/remote/bootstrapHotState.ts`).

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

How each client reaches that outcome is up to it, and neither client needs to persist extra state
for it: the bootstrap must report whether it just created the workspace row, and only the app-start
call site may act on that signal. The reset paths call the same bootstrap and must ignore it.

Neither bootstrap reports that signal today, so both clients have to add it. On Android
`ensureLocalWorkspaceShell` returns only the workspace id and is identical on the created and the
reused branch. On iOS `LocalDatabaseBootstrapper.ensureDefaultState()` returns `Void` and is not
reachable from an app-start call site at all: it runs inside `DatabaseCore.init(databaseURL:)`
(`apps/ios/Flashcards/Flashcards/Database/Core/DatabaseCore.swift`), and
`DatabaseCore.resetForAccountDeletion()` in the same file drives the same initializer chain. On iOS
the signal therefore has to be surfaced out of `DatabaseCore` and explicitly suppressed on the reset
path, rather than assumed absent there.

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
- Mobile link then takes the `replace_local_shell` branch instead of `fork_local_data`
  (`migrateLocalShellToLinkedWorkspace` in
  `apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/cloud/identity/WorkspaceIdentityLocalStore.kt`,
  and the same branch in
  `apps/ios/Flashcards/Flashcards/Cloud/Store/Account/Identity/FlashcardsStore+CloudLink.swift`),
  which discards local content.
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

The `remoteIsEmpty` guard on web and the fresh-install-only seed moment on mobile keep the web and
mobile seeds from both firing for the same account on the two link paths, `fork_local_data` and
`replace_local_shell`, in either arrival order.

Guest upgrade is the exception. It merges the already-synced guest workspace into the destination
workspace instead of choosing a side (see
[docs/sync-identity-model.md](sync-identity-model.md)), so a mobile guest that already seeded its
card and then upgrades into a web-seeded account keeps both copies. No guard can fire there: each
client evaluated its own guard correctly at its own new-user moment, before the two workspaces ever
met.

So the card may occasionally land in an account that already existed, and may occasionally appear
twice after a guest upgrade. Both are accepted, and both leave ordinary cards behind. There is no
cleanup-by-tag and no unlinking logic anywhere.

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

- Android: `apps/android/feature/review/src/main/res/values/strings.xml`, canonical names verbatim,
  matching the existing snake_case resource ids such as `review_again` and `review_hard`.
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
