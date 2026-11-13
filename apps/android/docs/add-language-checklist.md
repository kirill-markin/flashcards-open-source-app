# Add a New Android App Language

Use this checklist when adding a new Android UI language.

Android is one surface of a cross-client rollout; for the order and the locale tag
each other surface expects, see [docs/add-language.md](../../../docs/add-language.md).

Follow the [Android localization rule](../README.md#localization-rule). Choose
the owner for the exact app locale tag before adding resources.

## 1. Confirm the request is really for an Android app language

For listing text, screenshots, or other marketing assets, use the
[Play listing localization runbook](play-store-localization-runbook.md). Use this
checklist for UI copy and in-app language selection.

## 2. Register the locale and its resource qualifiers

- Keep `unqualifiedResLocale=en` in `app/src/main/res/resources.properties`. Put
  the exact supported tag under its owner in
  [the manifest-linked locale config](../app/src/main/res/xml/locales_config.xml).
  Keep the list explicit so Android can offer languages that Play adds after
  the build. Delete the `<locale>` line to remove a tag. The Gradle parser also
  reads tags inside XML comments.
- Use the qualifiers that `toAndroidLocaleFilters` emits in
  [the app Gradle file](../app/build.gradle.kts). Keep its library aliases.
  Wear OS uses the phone's resource filters and follows the watch's system
  language.
- Add bundled translations to the corresponding app-owned resource files.
  A sparse regional pack can use its parent locale for shared copy. Canadian
  French uses `values-fr-rCA` for overrides and can use generic Play-managed
  French for the remaining phone strings once Play processes the bundle.
  [Android resource resolution](https://developer.android.com/guide/topics/resources/multilingual-support)
- Keep language splitting disabled so packaged translations are available when
  switching languages offline. Leave locale selection to the system. Android
  13 and later offer per-app language settings, and Android 11, 12, and 12L
  follow the device language.

## 3. Make sure the base English strings are complete and translation-ready

Keep user-facing strings in the English base resources for both Play-managed and bundled translations.

Verify the current resource layout with:

```bash
rg --files apps/android | rg '/src/main/res/values/strings(_[^/]+)?\.xml$'
```

For a new language:

- Start from the English source files in each affected module.
- Ensure every user-facing English string that should be translated exists in base resources and is not hardcoded in Kotlin.
- Keep string names and plural names aligned across modules so Play sees a stable app-string surface.
- Keep Play-managed locales in Play Console and add `values-xx` files for bundled locales.

Likely failure modes:

- The locale is wired into Android, but some screens stay English because the copy was never moved into translatable base resources.
- Translations in Play look incomplete because some strings are still embedded in Kotlin instead of resource files.

## 4. Sweep non-obvious user-facing string sources

Not all UI text comes straight from composables with `stringResource(...)`.

Check these provider and resolver entry points:

- `apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/review/ReviewSupport.kt`
- `apps/android/feature/cards/src/main/java/com/flashcardsopensourceapp/feature/cards/CardsStrings.kt`
- `apps/android/feature/ai/src/main/java/com/flashcardsopensourceapp/feature/ai/AiStrings.kt`
- `apps/android/feature/review/src/main/java/com/flashcardsopensourceapp/feature/review/ReviewStrings.kt`
- `apps/android/feature/settings/src/main/java/com/flashcardsopensourceapp/feature/settings/SettingsStringResolver.kt`

These files feed user-visible copy into view models, alerts, metadata rows, tool status labels, review filter titles, due labels, and other presentation helpers outside the obvious composable surface.
Also sweep `apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/` for user-facing presentation labels such as `All cards`, `No tags`, and `new`.

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

Check locale-sensitive behavior for each new language.

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
- `apps/android/feature/review/src/main/java/com/flashcardsopensourceapp/feature/review/speech/ReviewSpeechSupport.kt`
- `apps/android/feature/review/src/main/java/com/flashcardsopensourceapp/feature/review/ReviewRoute.kt`

Likely failure modes:

- Plural forms or formatted durations read awkwardly because the English source strings were unclear or structurally wrong for translation.
- Scheduler or notification settings look half-localized because short duration labels or format assumptions stayed English-centric.
- The UI is translated, but spoken review text still uses the wrong locale or the fallback path was never rechecked.

## 6. Check locale ownership in the Play draft

- Follow the [Android release procedure](../../../docs/release/android.md) for
  the draft bundle and version code.
- In Play Console, open **Grow users → Translations → App strings** and select
  that draft bundle. Enable newly Play-managed tags so Gemini generates or
  updates their translations. Review the generated strings and use **Apply
  changes** for edits. On first setup, turn on automatic translations after
  reviewing the preview.
- Confirm that base English, the enabled Play App strings locales, and the
  bundled locales together match the manifest-linked list. Compare the actual
  app locale tags in the draft. Leave existing Play-managed languages enabled
  and keep bundled tags out of the Play App strings selection. Play overrides
  existing translations for any locale it manages.
  [Play App strings](https://support.google.com/googleplay/android-developer/answer/9844778#zippy=%2Capp-strings-translation-using-gemini)
- Verify that Play processing preserved the bundled resources.

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
- `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/routes/settings/SettingsAuthRouteTest.kt`
- `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/routes/settings/CloudPostAuthRouteTest.kt`
- `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/routes/AccountDeletionBlockingSurfaceTest.kt`
- `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/livesmoke/support/LiveSmokeScenarioAiHelpers.kt`
- `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/livesmoke/support/LiveSmokeScenarioCardHelpers.kt`
- `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/livesmoke/support/LiveSmokeScenarioAccountAssertions.kt`
- `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/livesmoke/flows/LiveSmokeWorkspaceLifecycleFlows.kt`
- `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/livesmoke/flows/LiveSmokeWorkspaceProgressFlows.kt`
- `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/marketing/screenshots/MarketingScreenshotTestSupport.kt`
- `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/routes/ReviewPreviewRouteTest.kt`

When updating tests:

- Change tests that intentionally verify app copy.
- Leave seeded card content or other user-generated text alone unless the test is specifically about localization.
- Prefer one or two focused instrumentation checks for RTL mirroring over broad churn across unrelated test files.
- Keep RTL instrumentation layout-oriented and predictable: assert start/end mirroring on existing routes instead of rewriting the suite around translated copy.
- The current focused RTL entry point is `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/routes/RtlLayoutTest.kt`. Extend that path first if a new screen needs explicit RTL coverage.

For RTL validation in tests:

- Force `LayoutDirection.Rtl` around an existing route or screen under test.
- Verify navigation and other directional affordances render on the trailing or leading edge through start/end behavior, not hardcoded left/right assumptions.
- Include at least one real UI surface that mixes RTL text with LTR user content such as email addresses, tags, URLs, or code snippets.
- Prefer routes that already use `Icons.AutoMirrored` or other directional Compose APIs so the test covers the actual app wiring.

## 8. Run Android-specific manual verification

On the same Play-processed draft version code, verify a bundled locale, a
Play-managed locale, and every new locale. Check Traditional and Simplified
Chinese separately, Malay on `ms-MY`, Odia on `or-IN`, and an actual override
for each regional tag. In Canadian French, check both a bundled override and a
string inherited from generic Play-managed French.

Minimum checklist:

- On Android 13 and later, open the app's language settings and select each
  target locale. Treat a missing option as a regression and record the affected
  tag and OS version.
- Verify device-language matching on API 30 and 32. For RTL work, use a real
  RTL language such as Arabic. Use an RTL pseudolocale for secondary stress
  checks.
- When the Wear OS build adds bundled translations, check the corresponding
  watch device language on the matching build from the
  [Android release procedure](../../../docs/release/android.md).
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

The local build checks resource packaging and locale wiring before the Play-delivered verification.

## 9. Finish the store-side follow-up separately

Shipping an Android app language may also require Play listing work. Follow the
[Play listing localization runbook](play-store-localization-runbook.md) for authored
copy, localized graphics, repository delivery, and Console review/publication.

Likely failure mode:

- The app language is ready in Play App strings, but the listing remains English for that market, which makes the Android release look unfinished.
