# iOS Localization Guide

Use this document every time you add a new in-app language to the iOS binary
and bundle. App Store metadata localization is separate and is not enough on
its own: see [docs/app-store-connect-metadata.md](app-store-connect-metadata.md).
For the full cross-client rollout order and the locale tag each surface expects,
see [docs/add-language.md](add-language.md).

The app follows Apple-native localization: iOS chooses the language from the
user's preferred languages and the bundle's advertised localizations, and the
user can override it in iOS Settings. Do not build a custom in-app language
picker unless there is an explicit product requirement.

## Supported App Locales

The app locale inventory is `CFBundleLocalizations` in
[Info.plist](../apps/ios/Flashcards/Config/Info.plist); the required translated set
is `REQUIRED_LOCALES` in the
[parity checker](../scripts/checks/pr/check-ios-localization-parity.mjs).
For release-note ordering, follow the bundle array in `Info.plist`.

English is the development language
([Base.xcconfig](../apps/ios/Flashcards/Config/Base.xcconfig)); do not change it
without an explicit product decision. Spanish is split explicitly between `es-MX`
and `es-ES`: never register or ship generic `es`, and treat any `es.lproj` as
migration source material only. Norwegian Bokmål is `nb` in the iOS bundle.

## Add A New Language

Every supported non-English locale needs real translations in every resource;
do not fill missing copy with silent English defaults.

1. Choose the exact Apple locale identifier: a generic language code for one
   shared copy, a region-specific code only when the product copy truly differs
   by region.
2. Add it to `knownRegions` in
   [project.pbxproj](../apps/ios/Flashcards/Flashcards%20Open%20Source%20App.xcodeproj/project.pbxproj)
   and to `REQUIRED_LOCALES` in the parity checker in the same change.
3. Add it to `CFBundleLocalizations` in [Info.plist](../apps/ios/Flashcards/Config/Info.plist).
4. Create `apps/ios/Flashcards/Flashcards/Resources/Localization/<locale>.lproj/InfoPlist.strings`
   translating every key of the
   [English file](../apps/ios/Flashcards/Flashcards/Resources/Localization/en.lproj/InfoPlist.strings),
   with the Spotlight keywords below. The app target's filesystem-synchronized
   `Flashcards` group discovers it; add no manual resource-build-phase or
   variant-group entries.
5. Add the locale to every key of
   [Foundation.xcstrings](../apps/ios/Flashcards/Flashcards/Resources/Localization/Foundation.xcstrings)
   (shared and system copy) and
   [ReviewCards.xcstrings](../apps/ios/Flashcards/Flashcards/ReviewCards.xcstrings)
   (Review and Cards copy).
6. Create `apps/ios/Flashcards/Flashcards/<locale>.lproj/AISettings.strings` with
   every key resolved through
   [`aiSettingsLocalized`](../apps/ios/Flashcards/Flashcards/AISettingsLocalization.swift),
   using an existing complete locale as the reference shape.
7. Add the language to `supportedLanguageSettingsItems()` in
   [LanguageSettingsView.swift](../apps/ios/Flashcards/Flashcards/Settings/LanguageSettingsView.swift),
   and its `settings.language.supported.<language>` key to every
   `<locale>.lproj/AISettings.strings`.
8. Audit support and error layers, not just screens:
   - [TransientBannerSupport.swift](../apps/ios/Flashcards/Flashcards/TransientBannerSupport.swift)
   - [ErrorMessageSupport.swift](../apps/ios/Flashcards/Flashcards/ErrorMessageSupport.swift)
   - [CloudAuthService.swift](../apps/ios/Flashcards/Flashcards/Cloud/Auth/CloudAuthService.swift)
   - [AIChatStore+AlertPresentation.swift](../apps/ios/Flashcards/Flashcards/AI/Store/Surface/AIChatStore+AlertPresentation.swift)
   - [AIChatStore+ObservabilityCapture.swift](../apps/ios/Flashcards/Flashcards/AI/Store/Observability/AIChatStore+ObservabilityCapture.swift)
   - [AIChatStore+RunLifecycle.swift](../apps/ios/Flashcards/Flashcards/AI/Store/Run/AIChatStore+RunLifecycle.swift)
   - [AIChatServerErrorSupport.swift](../apps/ios/Flashcards/Flashcards/AI/Support/AIChatServerErrorSupport.swift)
   - [AIChatVoiceDictation.swift](../apps/ios/Flashcards/Flashcards/AI/Runtime/AIChatVoiceDictation.swift)
   - [AIChatAttachmentSupport.swift](../apps/ios/Flashcards/Flashcards/AI/Support/AIChatAttachmentSupport.swift)
   - labels assembled by Swift helpers, such as the AI attached-card chip in
     [AIChatCardContext.swift](../apps/ios/Flashcards/Flashcards/AI/Support/AIChatCardContext.swift):
     catalog parity cannot find a user-facing literal that never entered a catalog.
9. Put new user-facing strings from the same change in the right bucket:
   `String(localized: ..., table: "Foundation")` for shared strings,
   `String(localized: ..., table: reviewCardsStringsTableName)` for Review/Cards,
   and `aiSettingsLocalized(...)` / `aiSettingsLocalizedFormat(...)` for
   AI/Settings/Account/Workspace. Do not add hardcoded English UI text to
   translate later.

Smoke launches pin English in
[LiveSmokeLaunching.swift](../apps/ios/Flashcards/FlashcardsUITests/LiveSmokeSupport/Configuration/LiveSmokeLaunching.swift),
so a new language needs no smoke change; add a dedicated locale test only
explicitly and separately. For locale-specific captures, select controls through
stable accessibility IDs and assert the intended content without assuming English
label prefixes; follow [the screenshot runbook](../apps/ios/docs/marketing-screenshots.md).

## Translation Rules

Spotlight reads `kMDItemKeywords` on iOS and `MDItemKeywords` on macOS, as
[Apple DTS recommends](https://developer.apple.com/forums/thread/761535). Both
are `String` values with the same comma-separated keyword list in the base
`Info.plist` and in each locale's `InfoPlist.strings`, including `en.lproj`.
Keep each locale's two values identical, with `flashcards,flash cards` first
followed by its natural localized terms and alternative spellings. Include
localized equivalents of study cards and revision cards where distinct; preserve
existing aliases and deduplicate. Nibomo is searchable by its app name; these
keywords add study terms without changing that name.

Localize the labels around technical values and user data, not the values
themselves: user-created workspace names, server domains and URLs, API payload
snippets, request IDs, status codes, and enum raw values used by app logic or
protocols. Preserve the bootstrap workspace name `Personal` when copy refers to
that exact workspace. Preserve executable ASCII confirmation phrases such as
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

## Verification Checklist

Use this checklist every time you add a new language. Follow the repository
workflow for where checks run; PR cloud CI owns static validation, and local
capture/build execution follows the task's authorization.

### Resource validation

The [parity checker](../scripts/checks/pr/check-ios-localization-parity.mjs) runs
in PR `Repository static validation`, enforced by the required `Repository
static checks` aggregate. A green parity check does not prove translation quality,
placeholder correctness, or that flat `.strings` values contain real translations.
Review those in context and confirm resource bundling in the built app.

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
remain `en`, with every `CFBundleLocalizations` entry and a matching `.lproj`
directory. Each locale must contain `Foundation.strings`, `ReviewCards.strings`,
and `InfoPlist.strings`; every non-English locale must also contain
`AISettings.strings`. Catalog plural variants can additionally emit
`ReviewCards.stringsdict`.

After the release archive finishes processing, open App Store Connect →
TestFlight → iOS → the matching version/build → Build Metadata. Confirm its
version/build and `Binary State: Validated`, then compare Store Information →
Localizations with the intended app bundle inventory above. Use Apple's display
names, including Norwegian Bokmål and separate Spanish (Mexico) and Spanish
(Spain) entries; require every app locale before submission. The Store listing
locales are a separate inventory.

### Manual runtime validation

On the installed release candidate, keep the app display name `Nibomo` and
search iPhone/iPad Spotlight separately for `Nibomo`, `flashcards`, `flash cards`,
`study cards`, and `revision cards` with English selected. Launch the app from
each result. Repeat with another supported system language using that locale's
study/revision terms from `InfoPlist.strings`; record the artifact, OS, language,
exact queries and results. Changing only the in-app language does not establish
which keywords Spotlight indexed. Use the [Mac manual checklist](macos-ci-cd.md#manual-checklist-on-the-verified-mac-artifact)
for Catalyst.

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
