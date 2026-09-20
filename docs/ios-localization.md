# iOS Localization Guide

Use this document every time you add a new in-app language to the iOS client.

This guide is about in-app localization for the iOS binary and bundle.
App Store metadata localization is separate and is not enough on its own.
If you also need localized App Store metadata, see [docs/app-store-connect-metadata.md](../docs/app-store-connect-metadata.md).
For the full cross-client rollout order and the locale tag each surface expects, see [docs/add-language.md](add-language.md).

## Goal

The iOS app must follow Apple-native localization behavior:

- iOS chooses the best language automatically from the user’s preferred languages
- the app advertises its supported bundle localizations to the system
- the user can override the app language in iOS Settings
- we do not build a custom in-app language picker unless there is an explicit product requirement

## Supported App Locales

The current bundle declares 50 locales across 49 languages, including English.
The exact app locale inventory is `CFBundleLocalizations` in
[Info.plist](../apps/ios/Flashcards/Config/Info.plist); the required translated set
is `REQUIRED_LOCALES` in the
[parity checker](../scripts/checks/pr/check-ios-localization-parity.mjs), excluding
English and Xcode's `Base` pseudo-region. Keep these aligned with `knownRegions`.
For release-note ordering, follow the bundle array in `Info.plist`.

Do not register or ship generic `es` for app localization.
Spanish support is split explicitly between `es-MX` and `es-ES`.
Norwegian Bokmål uses `nb` in the iOS bundle; Android and App Store use `no`.

## Current Localization Layout

The iOS client currently uses three localization buckets plus localized `InfoPlist.strings`:

- [apps/ios/Flashcards/Flashcards/Resources/Localization/Foundation.xcstrings](../apps/ios/Flashcards/Flashcards/Resources/Localization/Foundation.xcstrings)
  Shared app-level strings, root tabs, common states, access permission copy, cloud auth/support copy, transient banners, shared status labels.

- [apps/ios/Flashcards/Flashcards/ReviewCards.xcstrings](../apps/ios/Flashcards/Flashcards/ReviewCards.xcstrings)
  Review and Cards UI copy.

- [apps/ios/Flashcards/Flashcards/AISettingsLocalization.swift](../apps/ios/Flashcards/Flashcards/AISettingsLocalization.swift)
  Helper for AI, Settings, Account, Workspace, and related support/error strings.

- `apps/ios/Flashcards/Flashcards/<locale>.lproj/AISettings.strings`
  Language-specific translation file for keys resolved through `aiSettingsLocalized(...)`.
  Supported Spanish app locales must use `es-MX.lproj` and `es-ES.lproj`.

- [apps/ios/Flashcards/Flashcards/Resources/Localization/en.lproj/InfoPlist.strings](../apps/ios/Flashcards/Flashcards/Resources/Localization/en.lproj/InfoPlist.strings)
- `apps/ios/Flashcards/Flashcards/Resources/Localization/<locale>.lproj/InfoPlist.strings`
  Localized permission prompts, localized Spotlight keywords, and any future localized Info.plist-facing copy.

English remains the development language. Every supported non-English locale
needs real translations; do not fill missing copy with silent English defaults.
Preserved names and technical values follow the rules below.
For Spanish, supported app locales must use `es-MX.lproj` and `es-ES.lproj`; generic `es.lproj` is legacy migration material only and must not be treated as a supported app locale.

## Source Of Truth

When adding a new language, check all of these places:

1. Xcode project locale registration in [project.pbxproj](../apps/ios/Flashcards/Flashcards%20Open%20Source%20App.xcodeproj/project.pbxproj)
2. Bundle locale declaration in [Info.plist](../apps/ios/Flashcards/Config/Info.plist)
3. Development language in [Base.xcconfig](../apps/ios/Flashcards/Config/Base.xcconfig)
4. `Foundation.xcstrings`
5. `ReviewCards.xcstrings`
6. `<language>.lproj/AISettings.strings`
7. `<language>.lproj/InfoPlist.strings`
8. The supported-languages list in [LanguageSettingsView.swift](../apps/ios/Flashcards/Flashcards/Settings/LanguageSettingsView.swift)
9. `REQUIRED_LOCALES` in the [parity checker](../scripts/checks/pr/check-ios-localization-parity.mjs)
10. Any new user-facing strings introduced in Swift files during the same change

If one of these is skipped, the new language can look partially translated even if most screens appear correct.

## Add A New Language

Use this checklist in order.

### 1. Decide the locale code

Choose the exact Apple locale identifier you want to support.

Examples:

- `ar`
- `zh-Hans`
- `fr`
- `de`
- `pt-PT`
- `pt-BR`
- `es-MX`
- `es-ES`

Use a generic language code only when we want one shared copy for that language.
Use a region-specific code only when the product copy truly differs by region.
For Spanish in this app, region-specific codes are required: use `es-MX` and `es-ES`, never generic `es`.

### 2. Register the locale in the Xcode project

Update [project.pbxproj](../apps/ios/Flashcards/Flashcards%20Open%20Source%20App.xcodeproj/project.pbxproj):

- add the locale to `knownRegions`
- keep `developmentRegion = en`
- add the locale to `REQUIRED_LOCALES` in the parity checker in the same change;
  CI rejects drift from `knownRegions` after excluding `en` and `Base`

Do not change the development language unless there is an explicit product decision to move the app’s source language away from English.

### 3. Add the locale to bundle-declared supported localizations

Update [Info.plist](../apps/ios/Flashcards/Config/Info.plist):

- add the new locale to `CFBundleLocalizations`

This is part of what makes the language visible to iOS as a real app-supported language.

### 4. Keep the development language stable

Check [Base.xcconfig](../apps/ios/Flashcards/Config/Base.xcconfig):

- keep `DEVELOPMENT_LANGUAGE = en`
- keep `SWIFT_EMIT_LOC_STRINGS = YES`

We currently use English as the source language and rely on Apple fallback behavior from unsupported languages back to English.

### 5. Add localized Info.plist strings

Create a new file:

- `apps/ios/Flashcards/Flashcards/Resources/Localization/<locale>.lproj/InfoPlist.strings`

Translate every key already present in the existing English file and every key required by the current supported locale set.
The app target owns the `Flashcards` filesystem-synchronized group in
`project.pbxproj`; Xcode discovers the `.lproj` resources under that group. Keep
the new file under `Resources/Localization/<locale>.lproj/` rather than adding
manual resource-build-phase or variant-group entries.
Do not add new generic `es.lproj` app resources. Spanish resource files must use `es-MX.lproj` or `es-ES.lproj`.

At minimum, keep these aligned:

- `kMDItemKeywords`
- `NSCameraUsageDescription`
- `NSMicrophoneUsageDescription`
- `NSPhotoLibraryUsageDescription`

`kMDItemKeywords` is a comma-separated Spotlight keyword list.
The base value lives in [Info.plist](../apps/ios/Flashcards/Config/Info.plist), and every locale's `InfoPlist.strings`, `en.lproj` included, overrides it with terms for that language.
The app is named Nibomo, so without it on-device search cannot find the app by the user's own word for flashcards.
Keep `flashcards` as the first keyword in every locale and follow it with the natural terms in that language, including alternative spellings people actually type.
The key is undocumented by Apple but recommended by Apple DTS, so do not drop it as unknown.

If we later localize app display name or other Info.plist-facing copy, add those keys here too.

### 6. Add the new language to `Foundation.xcstrings`

Update [Foundation.xcstrings](../apps/ios/Flashcards/Flashcards/Resources/Localization/Foundation.xcstrings):

- add a translation for the new locale to every existing key

This table currently owns shared/root/system copy such as:

- root tab labels
- shared `OK` and similar common actions
- shared effort/rating titles used by foundation-owned code
- access permission titles, descriptions, statuses, and guidance
- cloud auth and cloud transport error messages
- transient banner messages

If a new string is shared across multiple feature areas, prefer putting it here instead of duplicating it elsewhere.

### 7. Add the new language to `ReviewCards.xcstrings`

Update [ReviewCards.xcstrings](../apps/ios/Flashcards/Flashcards/ReviewCards.xcstrings):

- add a translation for the new locale to every existing key

This table owns Review and Cards copy, including:

- navigation titles
- buttons
- alerts
- empty states
- filter labels
- review scheduling phrases shown in the UI
- review speech fallback copy owned by the Review area

### 8. Create a new AI/Settings translation file

Create:

- `apps/ios/Flashcards/Flashcards/<locale>.lproj/AISettings.strings`

Then translate every key currently used through `aiSettingsLocalized(...)` and `aiSettingsLocalizedFormat(...)`.

Use an existing completed locale file as the reference shape for keys and formatting.
If you find an older `es.lproj/AISettings.strings` file during migration work, treat it as source material only and move supported Spanish copy into `es-MX.lproj` and `es-ES.lproj`.

This file currently owns:

- AI screen copy
- AI support and error messages
- Settings, Account, Workspace screens
- Settings-related support and diagnostics labels

Important:

- There is currently no `en.lproj/AISettings.strings`
- English fallback comes from the default value passed in code to `aiSettingsLocalized(...)`
- every new non-English locale therefore needs a complete `<locale>.lproj/AISettings.strings` file

### 9. List the language on the Settings language screen

`supportedLanguageSettingsItems()` in
[LanguageSettingsView.swift](../apps/ios/Flashcards/Flashcards/Settings/LanguageSettingsView.swift)
renders the read-only Supported Languages list in Settings.
Add the new locale there, and add its `settings.language.supported.<language>` key to every
`<locale>.lproj/AISettings.strings`, because the parity check requires an identical key set
across those files.

### 10. Audit support and error layers, not just screens

Do not stop after visible screens.
We already had misses in support/error code paths after the first localization pass.

When adding a new language, review these support-heavy areas explicitly:

- [apps/ios/Flashcards/Flashcards/TransientBannerSupport.swift](../apps/ios/Flashcards/Flashcards/TransientBannerSupport.swift)
- [apps/ios/Flashcards/Flashcards/ErrorMessageSupport.swift](../apps/ios/Flashcards/Flashcards/ErrorMessageSupport.swift)
- [apps/ios/Flashcards/Flashcards/Cloud/Auth/CloudAuthService.swift](../apps/ios/Flashcards/Flashcards/Cloud/Auth/CloudAuthService.swift)
- [apps/ios/Flashcards/Flashcards/AI/Store/Surface/AIChatStore+AlertPresentation.swift](../apps/ios/Flashcards/Flashcards/AI/Store/Surface/AIChatStore+AlertPresentation.swift)
- [apps/ios/Flashcards/Flashcards/AI/Store/Observability/AIChatStore+ObservabilityCapture.swift](../apps/ios/Flashcards/Flashcards/AI/Store/Observability/AIChatStore+ObservabilityCapture.swift)
- [apps/ios/Flashcards/Flashcards/AI/Store/Run/AIChatStore+RunLifecycle.swift](../apps/ios/Flashcards/Flashcards/AI/Store/Run/AIChatStore+RunLifecycle.swift)
- [apps/ios/Flashcards/Flashcards/AI/Support/AIChatServerErrorSupport.swift](../apps/ios/Flashcards/Flashcards/AI/Support/AIChatServerErrorSupport.swift)
- [apps/ios/Flashcards/Flashcards/AI/Runtime/AIChatVoiceDictation.swift](../apps/ios/Flashcards/Flashcards/AI/Runtime/AIChatVoiceDictation.swift)
- [apps/ios/Flashcards/Flashcards/AI/Support/AIChatAttachmentSupport.swift](../apps/ios/Flashcards/Flashcards/AI/Support/AIChatAttachmentSupport.swift)

Also inspect labels assembled by Swift helpers, such as the AI attached-card
chip in [AIChatCardContext.swift](../apps/ios/Flashcards/Flashcards/AI/Support/AIChatCardContext.swift).
Catalog parity cannot find a user-facing literal that never entered a catalog.
Check these labels in the new locale while preserving the attached card's user
content.

### 11. Keep new user-facing strings in the right bucket

When you add new copy in code during the same change, place it consistently:

- use `String(localized: ..., table: "Foundation")` for shared/foundation strings
- use `String(localized: ..., table: reviewCardsStringsTableName)` for Review/Cards strings
- use `aiSettingsLocalized(...)` and `aiSettingsLocalizedFormat(...)` for AI/Settings/Account/Workspace strings

Do not add new hardcoded English UI text in Swift and plan to “translate it later”.

### 12. Do not localize technical identifiers or user data blindly

These should usually remain as-is:

- workspace names created by users
- server domains and URLs
- API payload snippets
- request IDs
- status codes
- enum raw values that are part of app logic or protocols

Localize the user-facing labels around them, not the technical values themselves.
Preserve the bootstrap workspace name `Personal` when copy refers to that exact
workspace. Preserve executable ASCII confirmation phrases such as
`delete my account` and `delete workspace`, and any `preview.confirmationText`
received from the backend; the confirmation views compare those values exactly.
Keep the scheduler input example `0.90` compatible with its parser.

Preserve format specifiers and unnumbered printf argument order. Inspect each
count caller before choosing wording: flat `.strings` helpers may select only
`one`/`other`, or use one format for every count. Use natural count-neutral copy
when that contract cannot express a language's plural rules; do not assume
`.xcstrings` plural support applies to those helpers.

Review translations by key and UI context. Navigation Back and a card's back,
review and preview, and reset and recovery can require different words despite
shared English fragments. Preserve negation in empty states. For RTL layouts,
check physical directions against actual placement such as `topBarLeading`, or
use direction-neutral descriptions.

### 13. Keep smoke tests deterministic

Current iOS smoke launches intentionally force English in:

- [apps/ios/Flashcards/FlashcardsUITests/LiveSmokeSupport/Configuration/LiveSmokeLaunching.swift](../apps/ios/Flashcards/FlashcardsUITests/LiveSmokeSupport/Configuration/LiveSmokeLaunching.swift)

That means:

- adding a new language should not require changing the smoke test language setup
- visible-text assertions stay deterministic in English
- if you add a dedicated test for the new locale, do it explicitly and separately

Do not remove the forced-English smoke launch behavior unless there is a deliberate decision to migrate smoke tests away from visible English labels.
For locale-specific captures, select controls through stable accessibility IDs
and assert the intended content without assuming English label prefixes. Follow
[the screenshot runbook](../apps/ios/docs/marketing-screenshots.md) for capture
assertions and visual review.

## Verification Checklist

Use this checklist every time you add a new language. Follow the repository
workflow for where checks run; PR cloud CI owns static validation, and local
capture/build execution follows the task's authorization.

### Resource validation

The [parity checker](../scripts/checks/pr/check-ios-localization-parity.mjs) runs
in PR `Repository static validation`, enforced by the required `Repository
static checks` aggregate. It checks `knownRegions` parity, required `.strings`
files and matching key sets, and nonempty `translated` units for every required
locale in translatable `.xcstrings` entries, including nested variants. English
is the source language and is optional in this check.

A green parity check does not prove translation quality, placeholder correctness,
or that flat `.strings` values contain real translations. Review those in context
and confirm resource bundling in the built app.

### Bundle/build validation

For an authorized local build check:

```bash
xcodebuild -project "apps/ios/Flashcards/Flashcards Open Source App.xcodeproj" \
  -scheme "Flashcards Open Source App" \
  -derivedDataPath "tmp/ios-derived-data" \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO \
  build
```

Inspect the built app, not only source registration. Its development region must
remain `en`, with all 50 `CFBundleLocalizations` and matching `.lproj` directories.
Each locale must contain `Foundation.strings`, `ReviewCards.strings`, and
`InfoPlist.strings`; all 49 non-English locales must also contain
`AISettings.strings`. Catalog plural variants can additionally emit
`ReviewCards.stringsdict`. Apply the same checks to every newly added locale.

### Manual runtime validation

Check all of these on a simulator or device:

1. Launch with the new app language selected in iOS Settings
2. Review tab: read long question and answer paragraphs through their final
   words, scrolling as needed, on iPhone and iPad at normal and enlarged Dynamic
   Type sizes. Check LTR and RTL text for unintended ellipses; full accessibility
   labels and green catalog checks do not prove the full text is drawn.
3. Cards tab
4. AI tab, including a card attached from Review and its localized chip label.
   Use long translated labels and long user content on iPhone and iPad, including
   RTL: keep the chip and Remove control inside the viewport and removal usable.
   Constrain visual presentation without shortening stored or accessible content.
5. Settings tab
6. Account and Workspace nested screens
7. At least one error path in Cloud sign-in
8. At least one AI error path if practical
9. Permission prompt copy for camera, photos, and microphone
10. Localized names in the Supported Languages list and RTL placement where applicable
11. [Auth sign-in and OAuth consent](add-language.md#auth-and-backend-dependencies)

After the localized binary is released, verify the public App Store Languages
list against that released bundle. Adding Store metadata alone does not prove
that its binary advertises those languages.

### Search-based audit

Before finishing, run searches for newly added or remaining hardcoded English in user-facing code paths.

Examples:

```bash
rg -n 'Text\\(\"|Button\\(\"|Label\\(\"|Section\\(\"|Toggle\\(\"|TextField\\(\"|navigationTitle\\(\"|alert\\(\"|confirmationDialog\\(\"' apps/ios/Flashcards/Flashcards
rg -n 'return \"[A-Z][^\"]*|return \".* .*\"' apps/ios/Flashcards/Flashcards
rg -n 'aiSettingsLocalized\\(|String\\(localized:' apps/ios/Flashcards/Flashcards
```

This is not perfect, but it catches many misses quickly.

## Common Failure Modes

These are the mistakes most likely to cause a partial localization:

- adding the new locale to `CFBundleLocalizations` but forgetting one of the translation resources
- updating the screen copy but forgetting support/error strings
- translating `Foundation.xcstrings` and `ReviewCards.xcstrings` but forgetting `<locale>.lproj/AISettings.strings`
- adding a new string in Swift without placing it in the correct localization bucket
- assuming App Store Connect localization means the binary is localized
- changing smoke tests unnecessarily when the existing forced-English launch already isolates them from locale changes

## Current Rule

For the iOS client, adding a new language is not complete until all of the following are true:

- the locale is registered in the Xcode project and parity checker
- the locale is declared in `CFBundleLocalizations`
- `InfoPlist.strings` exists for that locale
- `Foundation.xcstrings` contains that locale
- `ReviewCards.xcstrings` contains that locale
- `<locale>.lproj/AISettings.strings` exists and is complete
- the locale appears in the Settings Supported Languages list
- support/error paths were audited
- build/resource validation passed
- basic manual runtime validation passed
