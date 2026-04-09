# Add a New Android App Language

Use this checklist when adding a new Android UI language.

Work from the current tree, not memory. Other people may already be changing Android localization files in parallel, so do not revert unrelated work. Re-scan the current Android modules before you edit anything and adapt this checklist to the files that exist now.

## 1. Confirm the locale plumbing first

- Add the new language to `apps/android/app/build.gradle.kts` inside `android.androidResources.localeFilters`.
- Keep `generateLocaleConfig = true` enabled there. Do not hand-maintain a generated locale config file.
- Verify `apps/android/app/src/main/res/resources.properties` still points `unqualifiedResLocale` at the base language. Today that is `en`; adding a translation does not require changing the base locale.
- Update `apps/android/app/src/main/java/com/flashcardsopensourceapp/app/locale/AppLocaleInitializer.kt` so first-run locale initialization knows about the new language tag and can match it from the system locale list.

Likely failure modes:

- The language is translated but never appears in Android's per-app language picker because `localeFilters` was not updated.
- The language appears in resources but first launch still falls back to English because `AppLocaleInitializer` still matches only older tags.
- Someone tries to edit generated locale output instead of the Gradle/resource sources that actually control it.

## 2. Add `values-xx` resources in every Android module that owns UI strings

Verify the current list with:

```bash
rg --files apps/android | rg 'src/main/res/values(-[a-zA-Z-r]+)?/strings.xml$'
```

At the time of writing, user-facing strings live in these modules:

- `apps/android/app/src/main/res/values-xx/strings.xml`
- `apps/android/feature/review/src/main/res/values-xx/strings.xml`
- `apps/android/feature/cards/src/main/res/values-xx/strings.xml`
- `apps/android/feature/ai/src/main/res/values-xx/strings.xml`
- `apps/android/feature/settings/src/main/res/values-xx/strings.xml`

Do not skip `feature/settings` just because the task sounds unrelated to Settings. That module also owns legal, support, open-source, scheduler, notification, and app-metadata strings.

For a new language:

- Create the matching `values-xx` folder in each module above, or the correct Android qualifier variant if the locale needs region or script qualifiers.
- Start from the corresponding base `values/strings.xml` file in the same module.
- Keep string names and plural names aligned with the base file. Missing entries will silently fall back to English and create mixed-language screens.

Likely failure modes:

- Only `app/` gets translated, so feature screens stay English.
- Only the obvious screen module gets translated, while AI or Settings still resolve English copy from their own resource bundle.
- A partial file ships and Android falls back to English for the missing keys without making the omission obvious during development.

## 3. Sweep non-obvious user-facing string sources

Not all UI text comes straight from composables with `stringResource(...)`.

Check these provider and resolver entry points:

- `apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/CardPresentationSupport.kt`
- `apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/ReviewSupport.kt`
- `apps/android/feature/cards/src/main/java/com/flashcardsopensourceapp/feature/cards/CardsStrings.kt`
- `apps/android/feature/ai/src/main/java/com/flashcardsopensourceapp/feature/ai/AiStrings.kt`
- `apps/android/feature/review/src/main/java/com/flashcardsopensourceapp/feature/review/ReviewStrings.kt`
- `apps/android/feature/settings/src/main/java/com/flashcardsopensourceapp/feature/settings/SettingsStringResolver.kt`

These files feed user-visible copy into view models, alerts, metadata rows, tool status labels, review filter titles, due labels, and other presentation helpers outside the obvious composable surface.
Also sweep `apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/` for user-facing presentation labels such as effort labels, `All cards`, `No tags`, and `new`, not only `app/` and `feature/`.

Do one repo sweep before you call the work done:

```bash
rg -n 'R\\.string|R\\.plurals|getString\\(|getQuantityString\\(' \
  apps/android/app \
  apps/android/feature \
  apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model
```

Likely failure modes:

- Hidden presentation labels under `data/local/model` stay English because only `app/` and `feature/` were reviewed.
- Cards editor validation, metadata summaries, or filter summaries remain English because they come from `CardsStrings.kt` helpers.
- AI error messages, attachment permission prompts, or tool labels remain English because only screen composables were reviewed.
- Review filter titles or empty-state text remain English because they come from `ReviewTextProvider`.
- Settings metadata or sync state labels remain English because they are resolved through `SettingsStringResolver`, not inline in the screen.

## 4. Verify app-shell and notification surfaces

Translate and verify the app-level shell strings in `apps/android/app/src/main/res/values-xx/strings.xml`.

Important Android-specific surfaces there today:

- app name
- top-level tab labels
- startup failure copy
- account-deletion progress and retry copy
- review notification channel name and description

Also verify `apps/android/app/src/main/java/com/flashcardsopensourceapp/app/notifications/ReviewReminderNotificationContent.kt`, which uses app resources for the notification channel metadata.

Notes:

- Card front text shown inside a review reminder notification is user content, not an app translation string.
- Notification channel name and description are system-visible Android surfaces. If they stay English, the app will look partially untranslated even when the in-app screens are correct.

Likely failure modes:

- The main tabs localize, but the notification channel shown by Android system settings stays English.
- Startup or account-deletion flows are missed because they live in the app shell module, not a feature module.

## 5. Check metadata, status, and provider-resolved labels

Settings and review copy includes labels that are built from model values and resolvers, not from direct screen text.

Re-check at least:

- `CardsTextProvider(...)` plus `formatCardsMetadataSummary(...)` and `formatCardsFilterSummary(...)`
- `CardPresentationSupport.kt` and `ReviewSupport.kt` for labels such as effort, all-cards, no-tags, and new-state text
- `SettingsStringResolver.resolveAppMetadataStorageLabel(...)`
- `SettingsStringResolver.resolveAppMetadataSyncStatusText(...)`
- `ReviewTextProvider.effortLabel(...)`
- `ReviewTextProvider.filterTitle(...)`
- AI tool/status mapping in `apps/android/feature/ai/src/main/java/com/flashcardsopensourceapp/feature/ai/AiStrings.kt`

Recent Android localization work also touched metadata and status labels. Do not assume the screen-level translation pass covers them automatically.

Likely failure modes:

- Storage, sync, guest-session, or other status rows still show English labels in Settings.
- Review effort labels or filter chips mix translated and untranslated values.
- AI tool-call summaries localize the surrounding sentence but keep English tool names or statuses.

## 6. Review plurals and locale-aware formatting

Do not stop at plain `<string>` entries.

Review these plural-heavy areas:

- `apps/android/feature/review/src/main/res/values-xx/strings.xml`
- `apps/android/feature/cards/src/main/res/values-xx/strings.xml`
- `apps/android/feature/settings/src/main/res/values-xx/strings.xml`

Important current examples:

- `review_interval_minutes`
- `review_interval_hours`
- `review_interval_days`
- `cards_filter_content_description_active`

`apps/android/feature/review/src/main/java/com/flashcardsopensourceapp/feature/review/ReviewStrings.kt` formats review intervals through `getQuantityString(...)` and formats due dates with the active locale from `resources.configuration.locales`.
`apps/android/feature/cards/src/main/java/com/flashcardsopensourceapp/feature/cards/CardsStrings.kt` also formats card metadata and due labels with locale-aware helpers.
Settings has additional formatting traps in:

- `apps/android/feature/settings/src/main/java/com/flashcardsopensourceapp/feature/settings/SettingsSupport.kt`
- `apps/android/feature/settings/src/main/java/com/flashcardsopensourceapp/feature/settings/WorkspaceSchedulerPresentationSupport.kt`
- `apps/android/feature/settings/src/main/java/com/flashcardsopensourceapp/feature/settings/ReviewNotificationsRoute.kt`

Re-check locale-sensitive formatting there during QA, especially scheduler summaries, fixed `HH:mm` output, and hardcoded duration labels such as `1h` or `60m`.

Likely failure modes:

- The language is translated, but review intervals read incorrectly because plural forms were copied from English.
- Date or time output looks wrong during manual testing because the app language changed but the formatter path was not rechecked.
- Cards or Settings counts stay English because only `review` plurals were translated.
- Scheduler or notification settings look half-localized because formatted times or short duration labels stayed in the old locale.

## 7. Verify review speech and TTS locale behavior

Adding a UI locale does not automatically guarantee the speech path uses the same locale or the right fallback behavior.

Check:

- `apps/android/feature/review/src/main/java/com/flashcardsopensourceapp/feature/review/ReviewSpeechSupport.kt`
- `apps/android/feature/review/src/main/java/com/flashcardsopensourceapp/feature/review/ReviewRoute.kt`

Verify that speech uses the intended locale when the new app language is active, and verify the fallback path when Android TTS does not support that locale well.

Likely failure modes:

- The UI is translated, but spoken review text still uses a previous locale.
- The new locale is selected in the app, but TTS falls back unexpectedly and produces the wrong voice or pronunciation.
- Error handling around unsupported speech locales is only tested in English.

## 8. Re-check tests before shipping the language

Android tests may still assert English UI copy.

Sweep the whole Android instrumentation tree for English assertions, not just one hotspot.

Search for string-sensitive assertions in:

- `apps/android/app/src/androidTest`
- `apps/android/feature/*/src/test`
- `apps/android/data/local/src/androidTest` when UI-facing messages are involved

Useful sweep:

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

Likely failure modes:

- The language change is correct in the app, but instrumentation tests fail because they still look for English labels.
- A test fixture with user data is incorrectly translated even though user-authored content should remain unchanged.

## 9. Run Android-specific manual verification

Before release, verify the new locale in a real Android app session.

Minimum checklist:

- Set the app language from Android's per-app language settings and relaunch the app.
- On a fresh install or cleared app data, verify first-run locale initialization picks the new language when the device language matches it.
- Check top-level navigation labels.
- Check Review empty states, queue errors, interval labels, and due/date formatting.
- Check review speech playback and unsupported-locale fallback behavior.
- Check Cards editor and list/filter surfaces.
- Check AI consent, alerts, attachment/tool labels, and status text.
- Check Settings metadata rows, sync status text, legal/support/open-source surfaces, scheduler summaries, and notification settings text.
- Trigger a review reminder and verify the notification channel name/description plus the notification content around the user card text.

If you are implementing the locale for real, a local sanity build is reasonable:

```bash
cd apps/android
./gradlew :app:assembleDebug
```

## 10. Treat Google Play as a follow-up, not an afterthought

Shipping an Android locale may also require store work:

- Add or update the matching Google Play listing language in Play Console.
- Decide whether the Play screenshots should also be localized for that listing.
- If localized Android marketing assets are needed, keep them under `apps/android/docs/media/`.

Likely failure mode:

- The app is translated, but the Play listing remains English for that market, which makes the Android release look unfinished.
