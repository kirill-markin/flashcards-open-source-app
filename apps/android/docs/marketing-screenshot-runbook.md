# Android Marketing Screenshot Runbook

This document explains how to run the manual Android marketing screenshot flows reliably on a local machine.

Use this runbook when you want to regenerate one or more Play Store screenshots from the Android app and then review them before committing the resulting PNGs.

## Goal

These screenshot flows are manual-only Android instrumentation entrypoints.

They are not part of Android CI, release gates, or default `androidTest` runs.
Each flow prepares a specific in-app state, captures a PNG on the emulator, and pulls that file into `apps/android/docs/media/play-store-screenshots/`.
The wrappers run the dedicated `marketingScreenshot` app variant, which can include screenshot-only resource overlays from `apps/android/app/src/marketingScreenshot/res` without changing normal `debug` or `release` builds.
The wrapper now runs a dedicated guest cleanup entrypoint before the screenshot flow and again from an exit trap after the wrapper finishes, including failure exits.
The screenshot reset rule also deletes any stored guest cloud screenshot session through `POST /guest-auth/session/delete` before the local reset clears the guest token, both before and after the manual screenshot test body.

## Current wrapper scripts

Run this command from the repository root:

```bash
bash scripts/capture-android-marketing-screenshots.sh
```

To target a configured locale prefix other than the default `en`, set `FLASHCARDS_MARKETING_LOCALE_PREFIX` for the wrapper run:

```bash
FLASHCARDS_MARKETING_LOCALE_PREFIX=en bash scripts/capture-android-marketing-screenshots.sh
```

The wrapper passes that prefix into the manual AndroidTest entrypoint, which resolves the matching screenshot locale configuration before preparing the app state and file names.

The currently configured screenshot locale prefixes are:

- `en`
- `en-US`
- `ar`
- `zh-CN`
- `de-DE`
- `hi-IN`
- `ja-JP`
- `ru-RU`
- `es-419`
- `es-ES`
- `es-US`

Today the default remains `en`.

After the wrapper scripts run, the expected generated output files are:

- `apps/android/docs/media/play-store-screenshots/en-1_review-card-front-google-play-opportunity-cost.png`
- `apps/android/docs/media/play-store-screenshots/en-2_review-card-result-google-play-opportunity-cost.png`
- `apps/android/docs/media/play-store-screenshots/en-3_progress-google-play-study-history.png`
- `apps/android/docs/media/play-store-screenshots/en-4_review-card-ai-draft-google-play-opportunity-cost.png`
- `apps/android/docs/media/play-store-screenshots/en-5_cards-list-google-play-vocabulary.png`

Existing repository media can still contain the previous split-run assets until these generators are run and the new output PNGs are reviewed.
Existing repository media can also still contain older cards-list numbering such as `*-3_cards-list-...` until the unified wrapper is run and the regenerated PNGs are reviewed.

## Reliable local process

Use this sequence for every screenshot run:

Run the Android emulator headlessly, without a visible emulator window.
For marketing screenshot generation, the visible emulator UI is unnecessary and wastes local machine resources; only the final PNG output matters.

1. Stop all Android emulators.
2. Stop all booted iOS simulators.
3. Verify `adb devices` is empty before starting a new Android run.
4. Start exactly one Android API 36 emulator in headless mode, currently `Medium_Phone_API_36.1`.
   Recommended local command:

   ```bash
   emulator @Medium_Phone_API_36.1 -no-window -no-audio -gpu auto
   ```

   If the emulator still needs startup diagnosis on a weak machine, keep the same headless shape and add only temporary debug flags:

   ```bash
   emulator @Medium_Phone_API_36.1 -no-window -no-audio -gpu auto -verbose -debug init,metrics -logcat '*:s ActivityManager:i AndroidTestOrchestrator:i TestRunner:i'
   ```

   Avoid forcing the deprecated `-gpu swiftshader_indirect` mode for this local screenshot flow.
5. Wait for full device readiness, not just `adb` visibility.
6. Dismiss any blocking Android system dialog before the run.
7. Run one screenshot wrapper script at a time.
8. Open the generated PNG and verify the actual image, not just the green test result.
9. Stop the emulator after the run so the next screenshot starts from a clean machine state.

Do not batch all screenshot scripts together when the machine is under load.
Running one wrapper at a time is slower, but it is more reliable and makes failures easier to diagnose.

## Required emulator readiness checks

Treat the device as ready only when all of the following are true:

- `adb devices` shows exactly one connected emulator
- `adb shell getprop sys.boot_completed` returns `1`
- `adb shell getprop dev.bootcomplete` returns `1`
- `adb shell service check package` reports `Service package: found`
- `adb shell service check activity` reports `Service activity: found`

If the emulator is visible in `adb` but the `package` or `activity` services are still missing, do not start the screenshot run yet.
That state is a common cause of install and instrumentation flakiness.
On a weak machine, `-gpu auto` plus a warmed emulator is usually more reliable than repeatedly cold-booting a headless emulator with an explicit software-renderer override.

## System dialog handling

Before each wrapper run, dismiss blocking Android system dialogs with:

```bash
bash scripts/android-dismiss-system-dialogs.sh
```

The screenshot helpers also defend against recurring system ANR dialogs during the run.
For the current marketing flows, the intended behavior is to press `Wait`, let Android settle, and continue.

One more failure mode is common on a freshly booted Play Store emulator, especially on a weak local machine:

- the first wrapper run after boot can fail before the test body really starts
- Gradle may report `Tests found: 1, Tests run: 0`
- the underlying cause is often a temporary Android system ANR such as `Application Not Responding: system` or `Application Not Responding: com.android.systemui`

This is usually not a locale-specific product failure.
It is most often emulator startup churn plus package install, locale reconfiguration, Google Play services work, keyboard startup, and other system work all overlapping at once.

If that happens:

1. Check for ANR windows with `adb shell dumpsys window windows | grep -E 'Application Not Responding|aerr_wait|isn.t responding'`.
2. Dismiss system dialogs again with `bash scripts/android-dismiss-system-dialogs.sh`.
3. Re-run the same screenshot wrapper once on the same already-booted emulator.

Do not immediately switch locale or assume the screenshot content is wrong.
If the rerun starts as `Starting 1 tests` instead of the broken `0/0` path, the emulator has usually stabilized enough for the wrapper to complete.

## Run one screenshot

Example:

```bash
bash scripts/capture-android-marketing-screenshots.sh
```

Each wrapper script does the following:

1. Verifies that an Android API 36 device is connected.
2. Dismisses blocking system dialogs.
3. Runs one manual-only instrumentation class through `:app:connectedMarketingScreenshotAndroidTest`.
4. Pulls the generated PNG file or files from `/sdcard/Download/flashcards-marketing-screenshots/` into the committed media directory.

The screenshot capture step now explicitly collapses the Android status bar before running `screencap`.
That prevents an already-open notification shade from being captured on top of an otherwise-correct app screen.

The unified wrapper runs one shared entrypoint, seeds the guest workspace once, and pulls screenshots 1, 2, 3, 4, and 5 from the same instrumentation run.
The seed uses one deterministic 30-day-ish study-history pattern with gaps, a final streak of 8 days, `hasReviewedToday = true`, and `activeReviewDays = 16`.

The locale-specific card texts, AI draft texts, file-name prefixes, and UI labels used by these screenshot flows are defined in `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/MarketingScreenshotCatalog.kt`.

The screenshot-only variant exists to package repository-owned screenshot translations without leaking them into shipping builds.
Keep normal Android UI localization Play-first, and limit repository-managed screenshot overlays to screenshot capture only.

## Verify the result

After a wrapper finishes:

1. Check that the expected PNG exists in `apps/android/docs/media/play-store-screenshots/`.
2. Open the actual PNG file.
3. Verify that there is no system dialog overlay, loading spinner, missing handoff state, or stale content.

A green instrumentation result is not enough on its own.
The final check is always the screenshot image itself.

## Clean shutdown

After verification:

1. Stop the Android emulator.
2. Shut down any booted iOS simulators.
3. Confirm `adb devices` is empty again.

This keeps the next run deterministic and avoids hidden resource contention between screenshot sessions.
