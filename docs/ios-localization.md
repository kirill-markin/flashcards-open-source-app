# iOS Localization Guide

Use this document every time you add a new in-app language to the iOS client.

This guide is about in-app localization for the iOS binary and bundle.
App Store metadata localization is separate and is not enough on its own.
If you also need localized App Store metadata, see [docs/app-store-connect-metadata.md](/Users/kirill/_my_local/code-local/personal-workspace/flashcards-open-source-app/docs/app-store-connect-metadata.md).

## Goal

The iOS app must follow Apple-native localization behavior:

- iOS chooses the best language automatically from the user’s preferred languages
- the app advertises its supported bundle localizations to the system
- the user can override the app language in iOS Settings
- we do not build a custom in-app language picker unless there is an explicit product requirement

## Supported App Locales

The iOS app currently declares support for these Apple locale identifiers:

- `en` as the development and source language
- `ar`
- `zh-Hans`
- `de`
- `hi`
- `ja`
- `ru`
- `es-MX`
- `es-ES`

Do not register or ship generic `es` for app localization.
Spanish support is split explicitly between `es-MX` and `es-ES`.

## Current Localization Layout

The iOS client currently uses three localization buckets plus localized `InfoPlist.strings`:

- [apps/ios/Flashcards/Flashcards/Resources/Localization/Foundation.xcstrings](/Users/kirill/_my_local/code-local/personal-workspace/flashcards-open-source-app/apps/ios/Flashcards/Flashcards/Resources/Localization/Foundation.xcstrings)
  Shared app-level strings, root tabs, common states, access permission copy, cloud auth/support copy, transient banners, shared status labels.

- [apps/ios/Flashcards/Flashcards/ReviewCards.xcstrings](/Users/kirill/_my_local/code-local/personal-workspace/flashcards-open-source-app/apps/ios/Flashcards/Flashcards/ReviewCards.xcstrings)
  Review and Cards UI copy.

- [apps/ios/Flashcards/Flashcards/AISettingsLocalization.swift](/Users/kirill/_my_local/code-local/personal-workspace/flashcards-open-source-app/apps/ios/Flashcards/Flashcards/AISettingsLocalization.swift)
  Helper for AI, Settings, Account, Workspace, and related support/error strings.

- `apps/ios/Flashcards/Flashcards/<locale>.lproj/AISettings.strings`
  Language-specific translation file for keys resolved through `aiSettingsLocalized(...)`.
  Supported Spanish app locales must use `es-MX.lproj` and `es-ES.lproj`.

- [apps/ios/Flashcards/Flashcards/Resources/Localization/en.lproj/InfoPlist.strings](/Users/kirill/_my_local/code-local/personal-workspace/flashcards-open-source-app/apps/ios/Flashcards/Flashcards/Resources/Localization/en.lproj/InfoPlist.strings)
- `apps/ios/Flashcards/Flashcards/Resources/Localization/<locale>.lproj/InfoPlist.strings`
  Localized permission prompts and any future localized Info.plist-facing copy.

English remains the development language.
For Spanish, supported app locales must use `es-MX.lproj` and `es-ES.lproj`; generic `es.lproj` is legacy migration material only and must not be treated as a supported app locale.

## Source Of Truth

When adding a new language, check all of these places:

1. Xcode project locale registration in [project.pbxproj](/Users/kirill/_my_local/code-local/personal-workspace/flashcards-open-source-app/apps/ios/Flashcards/Flashcards%20Open%20Source%20App.xcodeproj/project.pbxproj)
2. Bundle locale declaration in [Info.plist](/Users/kirill/_my_local/code-local/personal-workspace/flashcards-open-source-app/apps/ios/Flashcards/Config/Info.plist)
3. Development language in [Base.xcconfig](/Users/kirill/_my_local/code-local/personal-workspace/flashcards-open-source-app/apps/ios/Flashcards/Config/Base.xcconfig)
4. `Foundation.xcstrings`
5. `ReviewCards.xcstrings`
6. `<language>.lproj/AISettings.strings`
7. `<language>.lproj/InfoPlist.strings`
8. Any new user-facing strings introduced in Swift files during the same change

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

Update [project.pbxproj](/Users/kirill/_my_local/code-local/personal-workspace/flashcards-open-source-app/apps/ios/Flashcards/Flashcards%20Open%20Source%20App.xcodeproj/project.pbxproj):

- add the locale to `knownRegions`
- keep `developmentRegion = en`

Do not change the development language unless there is an explicit product decision to move the app’s source language away from English.

### 3. Add the locale to bundle-declared supported localizations

Update [Info.plist](/Users/kirill/_my_local/code-local/personal-workspace/flashcards-open-source-app/apps/ios/Flashcards/Config/Info.plist):

- add the new locale to `CFBundleLocalizations`

This is part of what makes the language visible to iOS as a real app-supported language.

### 4. Keep the development language stable

Check [Base.xcconfig](/Users/kirill/_my_local/code-local/personal-workspace/flashcards-open-source-app/apps/ios/Flashcards/Config/Base.xcconfig):

- keep `DEVELOPMENT_LANGUAGE = en`
- keep `SWIFT_EMIT_LOC_STRINGS = YES`

We currently use English as the source language and rely on Apple fallback behavior from unsupported languages back to English.

### 5. Add localized Info.plist strings

Create a new file:

- `apps/ios/Flashcards/Flashcards/Resources/Localization/<locale>.lproj/InfoPlist.strings`

Translate every key already present in the existing English file and every key required by the current supported locale set.
Do not add new generic `es.lproj` app resources. Spanish resource files must use `es-MX.lproj` or `es-ES.lproj`.

At minimum, keep these aligned:

- `NSCameraUsageDescription`
- `NSMicrophoneUsageDescription`
- `NSPhotoLibraryUsageDescription`

If we later localize app display name or other Info.plist-facing copy, add those keys here too.

### 6. Add the new language to `Foundation.xcstrings`

Update [Foundation.xcstrings](/Users/kirill/_my_local/code-local/personal-workspace/flashcards-open-source-app/apps/ios/Flashcards/Flashcards/Resources/Localization/Foundation.xcstrings):

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

Update [ReviewCards.xcstrings](/Users/kirill/_my_local/code-local/personal-workspace/flashcards-open-source-app/apps/ios/Flashcards/Flashcards/ReviewCards.xcstrings):

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

### 9. Audit support and error layers, not just screens

Do not stop after visible screens.
We already had misses in support/error code paths after the first localization pass.

When adding a new language, review these support-heavy areas explicitly:

- [apps/ios/Flashcards/Flashcards/TransientBannerSupport.swift](/Users/kirill/_my_local/code-local/personal-workspace/flashcards-open-source-app/apps/ios/Flashcards/Flashcards/TransientBannerSupport.swift)
- [apps/ios/Flashcards/Flashcards/ErrorMessageSupport.swift](/Users/kirill/_my_local/code-local/personal-workspace/flashcards-open-source-app/apps/ios/Flashcards/Flashcards/ErrorMessageSupport.swift)
- [apps/ios/Flashcards/Flashcards/Cloud/CloudAuthService.swift](/Users/kirill/_my_local/code-local/personal-workspace/flashcards-open-source-app/apps/ios/Flashcards/Flashcards/Cloud/CloudAuthService.swift)
- [apps/ios/Flashcards/Flashcards/AI/AIChatStore+UIState.swift](/Users/kirill/_my_local/code-local/personal-workspace/flashcards-open-source-app/apps/ios/Flashcards/Flashcards/AI/AIChatStore+UIState.swift)
- [apps/ios/Flashcards/Flashcards/AI/AIChatStore+RunOrchestration.swift](/Users/kirill/_my_local/code-local/personal-workspace/flashcards-open-source-app/apps/ios/Flashcards/Flashcards/AI/AIChatStore+RunOrchestration.swift)
- [apps/ios/Flashcards/Flashcards/AI/AIChatServerErrorSupport.swift](/Users/kirill/_my_local/code-local/personal-workspace/flashcards-open-source-app/apps/ios/Flashcards/Flashcards/AI/AIChatServerErrorSupport.swift)
- [apps/ios/Flashcards/Flashcards/AI/AIChatVoiceDictation.swift](/Users/kirill/_my_local/code-local/personal-workspace/flashcards-open-source-app/apps/ios/Flashcards/Flashcards/AI/AIChatVoiceDictation.swift)
- [apps/ios/Flashcards/Flashcards/AI/AIChatAttachmentSupport.swift](/Users/kirill/_my_local/code-local/personal-workspace/flashcards-open-source-app/apps/ios/Flashcards/Flashcards/AI/AIChatAttachmentSupport.swift)

These are easy to forget because they are not all top-level screens.

### 10. Keep new user-facing strings in the right bucket

When you add new copy in code during the same change, place it consistently:

- use `String(localized: ..., table: "Foundation")` for shared/foundation strings
- use `String(localized: ..., table: reviewCardsStringsTableName)` for Review/Cards strings
- use `aiSettingsLocalized(...)` and `aiSettingsLocalizedFormat(...)` for AI/Settings/Account/Workspace strings

Do not add new hardcoded English UI text in Swift and plan to “translate it later”.

### 11. Do not localize technical identifiers or user data blindly

These should usually remain as-is:

- workspace names created by users
- server domains and URLs
- API payload snippets
- request IDs
- status codes
- enum raw values that are part of app logic or protocols

Localize the user-facing labels around them, not the technical values themselves.

### 12. Keep smoke tests deterministic

Current iOS smoke launches intentionally force English in:

- [apps/ios/Flashcards/FlashcardsUITests/LiveSmokeSupport/LiveSmokeLaunching.swift](/Users/kirill/_my_local/code-local/personal-workspace/flashcards-open-source-app/apps/ios/Flashcards/FlashcardsUITests/LiveSmokeSupport/LiveSmokeLaunching.swift)

That means:

- adding a new language should not require changing the smoke test language setup
- visible-text assertions stay deterministic in English
- if you add a dedicated test for the new locale, do it explicitly and separately

Do not remove the forced-English smoke launch behavior unless there is a deliberate decision to migrate smoke tests away from visible English labels.

## Verification Checklist

Run this checklist every time you add a new language.

### Resource validation

- `jq empty apps/ios/Flashcards/Flashcards/Resources/Localization/Foundation.xcstrings`
- `jq empty apps/ios/Flashcards/Flashcards/ReviewCards.xcstrings`
- `plutil -lint apps/ios/Flashcards/Flashcards/Resources/Localization/<locale>.lproj/InfoPlist.strings`
- `plutil -lint apps/ios/Flashcards/Flashcards/<locale>.lproj/AISettings.strings`
- `plutil -lint apps/ios/Flashcards/Config/Info.plist`
- `rg -n 'knownRegions|developmentRegion' "apps/ios/Flashcards/Flashcards Open Source App.xcodeproj/project.pbxproj"`

If you want to validate the string catalog more directly:

- `xcrun xcstringstool compile --dry-run --output-directory /tmp/ios-localization-check apps/ios/Flashcards/Flashcards/Resources/Localization/Foundation.xcstrings`

### Bundle/build validation

Preferred build check:

```bash
xcodebuild -project "apps/ios/Flashcards/Flashcards Open Source App.xcodeproj" \
  -scheme "Flashcards Open Source App" \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO \
  build
```

Then confirm the built app bundle contains the new language resources:

- `<locale>.lproj/Foundation.strings`
- `<locale>.lproj/ReviewCards.strings` if emitted
- `<locale>.lproj/InfoPlist.strings`
- `<locale>.lproj/AISettings.strings` if copied as a plain `.strings` table

### Manual runtime validation

Check all of these on a simulator or device:

1. Launch with the new app language selected in iOS Settings
2. Review tab
3. Cards tab
4. AI tab
5. Settings tab
6. Account and Workspace nested screens
7. At least one error path in Cloud sign-in
8. At least one AI error path if practical
9. Permission prompt copy for camera, photos, and microphone

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

- the locale is registered in the Xcode project
- the locale is declared in `CFBundleLocalizations`
- `InfoPlist.strings` exists for that locale
- `Foundation.xcstrings` contains that locale
- `ReviewCards.xcstrings` contains that locale
- `<locale>.lproj/AISettings.strings` exists and is complete
- support/error paths were audited
- build/resource validation passed
- basic manual runtime validation passed
