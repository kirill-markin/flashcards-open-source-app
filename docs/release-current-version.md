# Release All Platforms and Start the Next Development Version

A human or an AI with API/CLI and browser access can execute this runbook.
A request to run the full release authorizes the platform workflow dispatches,
monitoring, store metadata edits, Android publication, iOS App Review submission,
GitHub tag and Release, and the final version bump, including committing,
pushing, and merging release fixes and the bump through the normal PR/CI gates.
Do not ask for separate approval at every step. A request only to explain or
edit this guide, draft notes, or bump versions does not authorize a full release.

Prefer APIs/CLIs where supported; use the browser for store consoles and actions
without adequate API access. Ask the user for login, MFA, missing permissions,
or help with unexpected state or a decision the available evidence cannot
resolve. Pause the affected action until resolved; continue independent work.
Do not guess store declarations or bypass failed gates. Skip a platform only
when the user explicitly asks to skip it.

## Release Sequence

1. Identify the current shared version, the previous released tag, and the
   release commit on `main`. Verify the checked-in version surfaces agree and
   required CI is green. Keep this version throughout release fixes; do not
   bump it before publishing it.
2. Generate the user-visible release notes below and put them in the chat as
   reusable release content. Continue the release using those texts yourself.
3. Complete the mandatory local Android and iOS preflights in
   [Platform Release Procedures](manual-production-release.md#local-mobile-release-gate)
   before dispatching the corresponding platform's cloud workflows. Fix local
   errors and warnings and repeat the affected preflight first. Then start
   Android Release, MCP Registry Publish, and both iOS Xcode Cloud workflows
   using that procedure.
   Builds, tests, and store processing take time: run the independent platform
   flows in parallel, preparing store metadata while their jobs run.
4. Complete each platform's gate in that procedure. Track version, source SHA,
   workflow/run links, Firebase matrix, Android version code/draft, iOS build,
   and store status in the chat so a resumed run can continue without duplicate
   publication. For failures, inspect evidence, fix the cause, merge through
   normal CI, and rerun the affected release flow. Update the target SHA and
   notes if needed; verify unaffected artifacts remain valid for that target.
   If a fix affects an already published artifact, ask the user how to handle
   that platform before proceeding.
5. Once the platform completion gates pass (or the user explicitly skips a
   platform), publish the current version's GitHub tag and Release as below.
   iOS submission to App Review is the gate; waiting for Apple's approval is
   outside this run. Report pending store review separately from availability.
6. Bump the shared minor version for the next development cycle:
   `X.Y.Z` → `X.(Y+1).0`, unless the user explicitly specifies another version.
   Update the version surfaces below, merge through normal PR/CI gates, and
   monitor the automatic release/check workflows. Development then continues
   under this new version. Do not dispatch mobile or MCP releases for the bump.
7. Report each platform's actual publication/submission state and links, the
   GitHub Release, and the merged next development version. Do not mark an
   unfinished or blocked step complete.

## Release Notes

Compare the release target with the previous version actually released to users.
Start with the commit range between that tag and the target; inspect code only
where the user-visible effect is unclear.

- Describe visible changes in short, plain bullets, most important first.
- Omit internal refactors, tests, CI/CD, and infrastructure details unless users
  notice the result; group small changes as bug fixes or performance improvements.
- Put one fenced `text` block per locale in the chat, with the locale label
  outside and only flat `-` release-note bullets inside. These are reusable
  inputs for the operator, including an AI continuing the same task; do not
  stop to ask the user to copy or approve them.
- Use every locale in the order in
  [Supported App Locales](ios-localization.md#supported-app-locales).
  Keep `es-MX` and `es-ES` separate. Map store locale identifiers using
  [Locale tags per surface](add-language.md#locale-tags-per-surface) and the
  [App Store](app-store-connect-metadata.md) /
  [Google Play](google-play-store-metadata.md) metadata guides. If the current
  store draft requires additional locales, prepare and retain those texts too.
- Reuse these texts in each store's What's New/release notes fields; use the
  English text for GitHub Release. Never publish the raw generated commit, PR,
  or contributor list as release notes.

## GitHub Tag and Release

After the platform gates pass, create or verify the current version's tag at the
final release commit, whose checked-in versions still report that version.
Prefer an annotated tag and follow the existing tag naming convention. Publish
a GitHub Release with the English release notes from the chat.

Before retrying, check whether the tag and Release already exist. Reuse a
matching result; do not move a published tag or overwrite conflicting release
state without the user's explicit direction. If the next-version bump already
landed, locate and verify the actual release commit before that bump rather
than tagging the new development version.

## Next Development Version

Update backend, web, Android, and iOS to the same next minor version in one
change after publishing the current release. Only split versions for a concrete
release reason, and make that exception explicit in the change.

A version bump is not complete until the repo-owned version surfaces that participate in that release stay aligned with each other and with each platform's runtime-reported version source.

Do not change `/v1` API paths or API Gateway stage names as part of an app release bump. Those values describe the public API contract version, not the app release version.

## Source Of Truth By Platform

Even though we usually ship one shared project version, each platform still has its own checked-in source of truth and runtime wiring. Keep those sources aligned instead of introducing copied fallback literals.

### Backend, admin, and backend-adjacent packages

Update these package manifests together:

- `apps/backend/package.json`
- `apps/admin/package.json`
- `apps/auth/package.json`
- `infra/aws/package.json`

For each of those packages, also update the matching top-level package version fields in the adjacent `package-lock.json`.

Also update the MCP registry manifest at the repo root:

- `server.json`

`server.json` carries the published MCP registry manifest `version`, and it must move with the shared release version so the registry entry matches releases. There is no adjacent `package-lock.json` to update for it.

Publish the current `server.json.version` during the platform release stage, before the GitHub Release and next-version bump. The registry accepts each manifest version only once.

If backend comments or compatibility notes explicitly describe the currently
released first-party client version, update those references in the same
change so the documented minimum-compatible client behavior stays accurate.

### Web

The checked-in web package version lives in:

- `apps/web/package.json`
- `apps/web/package-lock.json`

The runtime-reported web client version is read through:

- `apps/web/src/clientIdentity.ts`

Read the web runtime version directly from `apps/web/package.json` through that helper. Do not introduce runtime overrides or fallbacks for the app version; a missing or blank checked-in package version is a configuration error that should fail explicitly.

Web request headers and device reporting reuse that same runtime value, including `X-Client-Version`.

### Android

The Android app semantic version lives in:

- `apps/android/app/build.gradle.kts`

Android runtime-reported app version must be derived from installed package metadata (`PackageInfo.versionName`) and reused in request payloads, AI runtime diagnostics, and device diagnostics. Do not hardcode aligned literals for these surfaces; a missing or blank runtime package version is a configuration error that should fail explicitly.

The main Android consumers of that runtime value are:

- `apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/repository/CloudRepositories.kt`
- `apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/repository/CloudGuestSessionCoordinator.kt`
- `apps/android/feature/ai/src/main/java/com/flashcardsopensourceapp/feature/ai/AiChatRuntime.kt`

Test fixtures do not track the release version. Android and web unit tests
that need an app-version string use a frozen dummy (`"1.0.0"`) as a
self-referential input/output value, so they are intentionally not bumped on
release. Each such fixture carries a "do not bump" comment in code. If you add
a new fixture that embeds an app version, reuse the same frozen dummy instead
of the real release version.

Android `versionCode` is not bumped manually in the repo. Release builds receive `ANDROID_VERSION_CODE` from CI, and the workflow computes that value at release time.

### iOS

The iOS marketing version lives in:

- `apps/ios/Flashcards/Config/Base.xcconfig`

`Info.plist` reads that marketing version indirectly, so do not replace the variable wiring there unless the build system changes.

The runtime-reported iOS app version must be read from bundle metadata (`CFBundleShortVersionString`) through:

- `apps/ios/Flashcards/Flashcards/Cloud/Support/CloudSupport.swift`

Do not introduce aligned literals, overrides, or fallbacks for the iOS app version; a missing or blank bundle version is a configuration error that should fail explicitly.

Under the current release process, the repo-tracked iOS build number is intentionally left alone during normal version bumps. Xcode Cloud handles signed archive and distribution separately, and the repository documentation does not define an in-repo build-number bump workflow.

If backend or client-side compatibility comments name the current iOS or
first-party app version explicitly, update those references too so the release
notes in code still describe the current shipped floor.

## Release Metadata

If store or release metadata for the touched platform explicitly includes the
current app version, update it in the same change. Do not edit store metadata
files that do not actually mention a version just because they are release
adjacent.

Today, there is no always-versioned store metadata file that must change on
every app release. Check the touched platform metadata files case by case.

Versioned metadata examples, when present, include:

- `docs/google-play-store-metadata.md`

## Verify the Next-Version Bump

Search for the old version across the repository before editing and again after
the bump. Confirm manifests, lockfile top-level versions, runtime readers,
compatibility comments, and any versioned metadata agree. Leave frozen test
fixtures and platform build-number handling as documented above.

Use the normal cloud CI gates; do not run local builds or broad test suites for
a version-only change. Inspect iOS version wiring directly. Monitor automatic
AWS/web and Android workflows according to [Release Gates](release-gates.md).
