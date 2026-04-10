# Add a New Android App Language

Use this checklist when adding a new Android UI language.

The Android localization model is Play-first:

- The repository owns the base English Android strings plus locale plumbing.
- Google Play App strings translation is the default source for Android app-internal translated copy.
- Do not add or maintain repository-owned Android `values-xx` translation trees by default, including Spanish.
- Treat Google Play listing localization and Android in-app string localization as separate concerns.

Work from the current tree, not memory. Other people may already be changing Android files in parallel, so do not revert unrelated work. Re-scan the current Android modules before you edit anything and adapt this checklist to the files that exist now.

## 1. Confirm the request is really for an Android app language

Clarify which surface needs localization:

- Android app-internal UI strings belong to the Play-first flow below.
- Google Play listing text, screenshots, and marketing assets are store-localization work, not Android app-string source changes.
- If the request is only for Play listing localization, do not touch the Android app locale plumbing.

Likely failure modes:

- Store listing work gets mixed into app-resource work and the scope expands unnecessarily.
- Someone reintroduces committed Android translation files because they are really trying to localize Play listing copy.

## 2. Keep the Android locale plumbing Play-first

The default Play-first path keeps locale advertising explicit without reintroducing repository-managed translations.

- Verify `apps/android/app/src/main/res/resources.properties` still points `unqualifiedResLocale` at the base language. Today that is `en`; adding a translated app language does not require changing the base locale.
- Maintain the checked-in explicit supported-language locale config that the app uses to advertise languages to Android system settings. Update that config whenever an app language is added or removed.
- The Android app build reads `apps/android/app/src/main/res/xml/locales_config.xml` and mirrors that list into `androidResources.localeFilters`, so keep the XML list authoritative and complete.
- The Android app bundle ships the full supported locale set instead of relying on Play language splits. This keeps Play translation preview, RTL checks, and offline app-language switching deterministic.
- Do not rely on AGP locale generation from checked-in resources as the only way Android discovers supported languages. That path cannot advertise Play-managed translations by itself once repository-owned `values-xx` folders are gone.
- Keep the explicit Android supported-language list aligned with the languages that will actually be translated in Play App strings for the release.
- Do not reintroduce app-startup locale forcing such as `AppLocaleInitializer.kt` unless the user explicitly asks for a custom locale-selection policy.
- Do not add `values-es`, `values-fr`, or other repository-owned translation folders unless the user explicitly asks for an exception.

Likely failure modes:

- The language is translated in Play, but it never appears in Android's per-app language settings because the explicit supported-language config was not updated.
- The language appears in Android settings, but the Play draft does not actually ship translated strings for it yet, so users select it and still get English.
- Someone reintroduces old repo-managed locale wiring and creates a second source of truth beside Play.
- A contributor adds `values-xx` trees because they are thinking in the old translation model, and the repository drifts from the actual Play-managed release state.

## 3. Make sure the base English strings are complete and translation-ready

Play-first translation only works well if the repository still exposes every user-facing string cleanly from the English base resources.

Verify the current resource layout with:

```bash
rg --files apps/android | rg 'src/main/res/values(-[a-zA-Z-r]+)?/strings.xml$'
```

At the time of writing, user-facing English base strings live in these modules:

- `apps/android/app/src/main/res/values/strings.xml`
- `apps/android/feature/review/src/main/res/values/strings.xml`
- `apps/android/feature/cards/src/main/res/values/strings.xml`
- `apps/android/feature/ai/src/main/res/values/strings.xml`
- `apps/android/feature/settings/src/main/res/values/strings.xml`

For a new language:

- Start from the base `values/strings.xml` file in each module above.
- Ensure every user-facing English string that should be translated exists in base resources and is not hardcoded in Kotlin.
- Keep string names and plural names aligned across modules so Play sees a stable app-string surface.
- Do not create matching `values-xx` folders as part of the default flow.

Likely failure modes:

- The locale is wired into Android, but some screens stay English because the copy was never moved into translatable base resources.
- Translations in Play look incomplete because some strings are still embedded in Kotlin instead of resource files.

## 4. Sweep non-obvious user-facing string sources

Not all UI text comes straight from composables with `stringResource(...)`.

Check these provider and resolver entry points:

- `apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/CardPresentationSupport.kt`
- `apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/ReviewSupport.kt`
- `apps/android/feature/cards/src/main/java/com/flashcardsopensourceapp/feature/cards/CardsStrings.kt`
- `apps/android/feature/ai/src/main/java/com/flashcardsopensourceapp/feature/ai/AiStrings.kt`
- `apps/android/feature/review/src/main/java/com/flashcardsopensourceapp/feature/review/ReviewStrings.kt`
- `apps/android/feature/settings/src/main/java/com/flashcardsopensourceapp/feature/settings/SettingsStringResolver.kt`

These files feed user-visible copy into view models, alerts, metadata rows, tool status labels, review filter titles, due labels, and other presentation helpers outside the obvious composable surface.
Also sweep `apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/` for user-facing presentation labels such as effort labels, `All cards`, `No tags`, and `new`.

Do one repo sweep before you call the work done:

```bash
rg -n 'R\\.string|R\\.plurals|getString\\(|getQuantityString\\(' \
  apps/android/app \
  apps/android/feature \
  apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model
```

Likely failure modes:

- Hidden presentation labels under `data/local/model` stay English because only screen composables were reviewed.
- Cards editor validation, metadata summaries, or filter summaries remain untranslated because they come from helper providers.
- AI error messages, attachment permission prompts, or tool labels remain untranslated because only the screen surfaces were reviewed.

## 5. Re-check plurals, formatting, and speech paths

Adding a Play-managed language still requires the app to behave correctly when Android resolves that locale at runtime.

Review these plural-heavy areas:

- `apps/android/feature/review/src/main/res/values/strings.xml`
- `apps/android/feature/cards/src/main/res/values/strings.xml`
- `apps/android/feature/settings/src/main/res/values/strings.xml`

Review these locale-sensitive formatting and speech entry points:

- `apps/android/feature/review/src/main/java/com/flashcardsopensourceapp/feature/review/ReviewStrings.kt`
- `apps/android/feature/cards/src/main/java/com/flashcardsopensourceapp/feature/cards/CardsStrings.kt`
- `apps/android/feature/settings/src/main/java/com/flashcardsopensourceapp/feature/settings/SettingsSupport.kt`
- `apps/android/feature/settings/src/main/java/com/flashcardsopensourceapp/feature/settings/WorkspaceSchedulerPresentationSupport.kt`
- `apps/android/feature/settings/src/main/java/com/flashcardsopensourceapp/feature/settings/ReviewNotificationsRoute.kt`
- `apps/android/feature/review/src/main/java/com/flashcardsopensourceapp/feature/review/ReviewSpeechSupport.kt`
- `apps/android/feature/review/src/main/java/com/flashcardsopensourceapp/feature/review/ReviewRoute.kt`

Likely failure modes:

- Plural forms or formatted durations read awkwardly because the English source strings were unclear or structurally wrong for translation.
- Scheduler or notification settings look half-localized because short duration labels or format assumptions stayed English-centric.
- The UI is translated, but spoken review text still uses the wrong locale or the fallback path was never rechecked.

## 6. Upload a Play draft release, then translate in Play Console

After the locale plumbing and base English string review are done:

- Let `Android Release` upload the signed AAB to Google Play as a production-track draft release.
- Use the Play Console App strings workflow and Gemini translation tools there to create or update the translated Android copy.
- Confirm the languages enabled in Play App strings for that draft still match the explicit supported-language list advertised by the Android app.
- Review the translated strings in Play Console before publishing.
- Keep the translated Android UI copy in Play Console. Do not sync Play-managed translations back into repository-owned `values-xx` trees.

Important policy note:

- The repository should stop owning Spanish Android translations. If Spanish is added or updated, do that through Play App strings, not through committed `values-es` files.

Likely failure modes:

- CI uploads the bundle, but nobody finishes the Play App strings review, so the release sits as a draft and never reaches users.
- A contributor edits Play-managed translations in the repository and the repo drifts away from the actual Play release state.

## 7. Re-check tests before shipping the language

Android tests may still assert English UI copy or assume English-only locale behavior.

Sweep the whole Android instrumentation tree for string-sensitive assertions:

```bash
rg -n 'onNodeWithText\\(|assertTextEquals\\(|assertTextContains\\(' \
  apps/android/app/src/androidTest \
  apps/android/feature \
  apps/android/data/local/src/androidTest
```

Current examples worth checking:

- `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/MainActivityTest.kt`
- `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/SettingsAuthRouteTest.kt`
- `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/CloudPostAuthRouteTest.kt`
- `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/AccountDeletionBlockingSurfaceTest.kt`
- `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/LiveSmokeScenarioHelpers.kt`
- `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/LiveSmokeWorkspaceFlows.kt`
- `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/MarketingScreenshotTestSupport.kt`
- `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/ReviewPreviewRouteTest.kt`

When updating tests:

- Change tests that intentionally verify app copy.
- Leave seeded card content or other user-generated text alone unless the test is specifically about localization.
- Prefer one or two focused instrumentation checks for RTL mirroring over broad churn across unrelated test files.
- Keep RTL instrumentation layout-oriented and predictable: assert start/end mirroring on existing routes instead of rewriting the suite around translated copy.
- The current focused RTL entry point is `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/RtlLayoutTest.kt`. Extend that path first if a new screen needs explicit RTL coverage.

For RTL validation in tests:

- Force `LayoutDirection.Rtl` around an existing route or screen under test.
- Verify navigation and other directional affordances render on the trailing or leading edge through start/end behavior, not hardcoded left/right assumptions.
- Include at least one real UI surface that mixes RTL text with LTR user content such as email addresses, tags, URLs, or code snippets.
- Prefer routes that already use `Icons.AutoMirrored` or other directional Compose APIs so the test covers the actual app wiring.

## 8. Run Android-specific manual verification

Before publishing the Play draft release, verify the new locale in a real Android app session after the Play-managed strings are available.

Minimum checklist:

- Install the Play-delivered draft build that already includes the Play-managed strings for the target language. Do not treat a local debug build as the source of truth for translated copy or app-language availability.
- Switch the device language to the target language and relaunch the app. For RTL work, use a real RTL language such as Arabic first, and use an RTL pseudolocale only as a secondary stress check if needed.
- If Android's per-app language settings show the target language for this build, verify that path too. Do not assume it is available until the Play-delivered build is in hand.
- If the Play-delivered build does not show the target language in Android's per-app language settings, treat that as a locale-advertising regression even if the Play translation exists.
- Check top-level navigation labels.
- Check that app bars, back arrows, and other directional icons mirror correctly and that the touch targets stay on the expected start or end edge for RTL.
- Check rows, cards, search fields, and metadata chips for start/end spacing issues. Do not validate RTL by assuming left/right placement from the LTR build.
- Check mixed-direction content in actual flows: Arabic or Hebrew UI copy alongside email addresses, deck names, tags, numbers, URLs, and code snippets typed by the user.
- Check Review empty states, queue errors, interval labels, and due/date formatting.
- Check review speech playback and unsupported-locale fallback behavior.
- Check Cards editor and list/filter surfaces.
- Check AI consent, alerts, attachment/tool labels, and status text.
- Check Settings metadata rows, sync status text, legal/support/open-source surfaces, scheduler summaries, and notification settings text.
- Trigger a review reminder and verify the notification channel name and description plus the notification content around the user card text.

If you are implementing the locale plumbing for real, a local sanity build is reasonable:

```bash
cd apps/android
./gradlew :app:assembleDebug
```

That local sanity build only validates repository-owned English resources and build wiring. It does not validate Play-managed translated strings or the final language list that users will see from the Play-delivered release build.

## 9. Finish the store-side follow-up separately

Shipping an Android app language may also require Play listing work:

- Add or update the matching Google Play listing language in Play Console.
- Decide whether the Play screenshots should also be localized for that listing.
- If localized Android marketing assets are needed, keep them under `apps/android/docs/media/`.

Likely failure mode:

- The app language is ready in Play App strings, but the listing remains English for that market, which makes the Android release look unfinished.
