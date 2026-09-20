# Android Marketing Screenshot Runbook

This document explains how to run the manual Android marketing screenshot flows reliably on a local machine.

Use this runbook when you want to regenerate one or more Play Store screenshots from the Android app and then review them before committing the resulting PNGs.

## Goal

These screenshot flows are manual-only Android instrumentation entrypoints.

They are not part of Android CI, release gates, or default `androidTest` runs.
Each flow prepares a specific in-app state, captures a PNG on the emulator, and pulls that file into `apps/android/docs/media/play-store-screenshots/`.
The wrappers run the dedicated `marketingScreenshot` app variant, which can include screenshot-only resource overlays from `apps/android/app/src/marketingScreenshot/res` without changing normal `debug` or `release` builds.
The wrapper verifies a dedicated guest cleanup entrypoint before capture and after pulling the images, before publishing them. An exit trap attempts cleanup on failure.
The screenshot reset rule also deletes any stored guest cloud screenshot session through `POST /guest-auth/session/delete` before the local reset clears the guest token, both before and after the manual screenshot test body.

## Current wrapper scripts

Run this command from the repository root:

```bash
bash scripts/android/capture-android-marketing-screenshots.sh
```

To target a configured locale prefix other than the default `en`, set `FLASHCARDS_MARKETING_LOCALE_PREFIX` for the wrapper run:

```bash
FLASHCARDS_MARKETING_LOCALE_PREFIX=en bash scripts/android/capture-android-marketing-screenshots.sh
```

The wrapper passes that prefix into the manual AndroidTest entrypoint, which resolves the matching screenshot locale configuration before preparing the app state and file names.

Built-in locale prefixes and the required JSON pack format are listed in
[the screenshot inventory](marketing-screenshots.md#json-locale-packs).
For a new locale, add its fixture and screenshot-only resource overlay before
running the wrapper with the exact Play code, for example
`FLASHCARDS_MARKETING_LOCALE_PREFIX=bn-BD`. Missing or malformed fixtures fail
explicitly. The default remains `en`.

The [device locale helper](../../../scripts/android/android-set-device-locale.sh)
maps Play codes to Android device tags where needed, such as `bg` to `bg-BG`
and `iw-IL` to `he-IL`. These device-only mappings do not change fixture or output
prefixes, or the pack's `appLocaleTag`.

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

1. Stop only Android emulators owned by this screenshot task. If another task's device is present, stop here and report contention; do not shut it down.
2. Verify no iOS simulators are booted. If one is present, stop here and report contention; do not shut it down.
3. Verify `adb devices` is empty before starting a new Android run.
4. Start exactly one Android API 37 emulator in headless mode, currently `Medium_Phone_API_37.0`. Keep its owning terminal or execution session alive through the complete wrapper run, including final cleanup.
   Recommended local command:

   ```bash
   export ANDROID_EMULATOR_WAIT_TIME_BEFORE_KILL=60
   emulator @Medium_Phone_API_37.0 -no-window -no-audio -gpu auto
   ```

   Keep the 60-second shutdown grace for snapshot saving; the default 20 seconds can terminate the emulator before saving finishes.

   If the emulator still needs startup diagnosis on a weak machine, keep the same headless shape and add only temporary debug flags:

   ```bash
   emulator @Medium_Phone_API_37.0 -no-window -no-audio -gpu auto -verbose -debug init,metrics -logcat '*:s ActivityManager:i AndroidTestOrchestrator:i TestRunner:i'
   ```

   Avoid forcing the deprecated `-gpu swiftshader_indirect` mode for this local screenshot flow.
5. Wait for full device readiness, not just `adb` visibility.
6. Set the target Play locale before rebooting the owned emulator. For example, for Finnish (replace `<serial>` with that emulator's serial):

   ```bash
   export FLASHCARDS_MARKETING_LOCALE_PREFIX=fi-FI
   bash scripts/android/android-set-device-locale.sh "$FLASHCARDS_MARKETING_LOCALE_PREFIX"
   adb -s <serial> reboot
   adb -s <serial> wait-for-device
   ```

   Repeat every readiness check below after the reboot. A warm API 37 snapshot can retain the previous locale's SystemUI clock digits or separator even when `cmd locale` reports the target tag. Rebooting after setting the locale refreshes that native formatting. The wrapper reapplies the same locale harmlessly.
7. Dismiss any blocking Android system dialog before the run; use the Bluetooth workaround below only if that failure is observed.
8. Run one screenshot wrapper script at a time, with the same exported locale prefix.
9. Open all five generated PNGs and verify the actual images, not just the green test result.
10. After the wrapper exits, stop only that emulator with `adb -s <serial> emu kill`. Wait for its owning process/session to exit and for `adb devices` to become empty before starting another locale. `adb emu kill` acknowledges the request before snapshot saving and process shutdown finish. If another task's device appears, report contention instead of stopping it.

A shell that owns a background emulator must remain alive until capture, cleanup, emulator shutdown, and `wait "$emulator_pid"` have all finished. Do not leave a previous session shutting down while starting its replacement on the same AVD or serial. Preserve the emulator log and owning process exit status; an offline device alone does not establish whether the emulator crashed, was terminated, or lost its connection.

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
bash scripts/android/android-dismiss-system-dialogs.sh
```

The screenshot helpers also defend against recurring system ANR dialogs during the run.
For the current marketing flows, the intended behavior is to press `Wait`, let Android settle, and continue.

On the Google APIs API 37 image, a Bluetooth service crash with `HCI Hardware Error 0x42` can repeatedly overlay screenshots even when instrumentation passes. When this specific failure is observed, run the following only on the owned emulator:

```bash
adb -s <serial> shell svc bluetooth disable
adb -s <serial> shell am force-stop com.google.android.bluetooth
adb -s <serial> exec-out uiautomator dump /dev/tty
```

Inspect the native UI dump and close any remaining Bluetooth crash dialog using its `android:id/aerr_close` control, then run the standard dismiss helper above. This is an emulator-image workaround, not routine device setup; the package name applies to the observed Google APIs image. If the dialog recurs, stop and inspect the emulator logs before capturing again.

One more failure mode is common on a freshly booted Play Store emulator, especially on a weak local machine:

- the first wrapper run after boot can fail before the test body really starts
- Gradle may report `Tests found: 1, Tests run: 0`
- the underlying cause is often a temporary Android system ANR such as `Application Not Responding: system` or `Application Not Responding: com.android.systemui`

This is usually not a locale-specific product failure.
It is most often emulator startup churn plus package install, locale reconfiguration, Google Play services work, keyboard startup, and other system work all overlapping at once.

If that happens:

1. Check for ANR windows with `adb shell dumpsys window windows | grep -E 'Application Not Responding|aerr_wait|isn.t responding'`.
2. Dismiss system dialogs again with `bash scripts/android/android-dismiss-system-dialogs.sh`.
3. Re-run the same screenshot wrapper once on the same already-booted emulator.

Do not immediately switch locale or assume the screenshot content is wrong.
If the rerun starts as `Starting 1 tests` instead of the broken `0/0` path, the emulator has usually stabilized enough for the wrapper to complete.

## Run one screenshot

Example:

```bash
bash scripts/android/capture-android-marketing-screenshots.sh
```

Each wrapper script does the following:

1. Verifies that an Android API 37 device is connected.
2. Sets the device locale and dark mode, then dismisses blocking system dialogs.
3. Verifies initial guest cleanup, then runs the manual capture class through `:app:connectedMarketingScreenshotAndroidTest`.
4. Pulls all five PNGs from `/sdcard/Download/flashcards-marketing-screenshots/` into staging.
5. Verifies final guest cleanup, then replaces the committed locale files.

The screenshot capture step explicitly collapses the Android status bar before running `screencap`.
That prevents an already-open notification shade from being captured on top of an otherwise-correct app screen.

The unified wrapper runs one shared entrypoint, seeds the guest workspace once, and pulls screenshots 1, 2, 3, 4, and 5 from the same instrumentation run.
The seed uses one deterministic 30-day-ish study-history pattern with gaps, a final streak of 8 days, `hasReviewedToday = true`, and `activeReviewDays = 16`.

Locale content comes from the Kotlin catalog or a JSON pack; see the [pack contract](marketing-screenshots.md#json-locale-packs).

The screenshot-only variant exists to package repository-owned screenshot translations without leaking them into shipping builds.
Keep normal Android UI localization Play-first, and limit repository-managed screenshot overlays to screenshot capture only.

## Verify the result

After a wrapper finishes:

1. Check that all five expected PNGs exist in `apps/android/docs/media/play-store-screenshots/`.
2. Open each actual PNG file.
3. Verify that there is no system dialog overlay, loading spinner, missing handoff state, or stale content.
4. Verify the native status-bar clock uses the target locale's digits and separator, not the previous locale's formatting; Finnish should use Latin digits and a dot, for example `13.45`. A successful locale query alone is insufficient.

The screenshot variant suppresses the guest sign-in prompt. The robot rejects any
Compose dialog before each capture. The wrapper removes the expected device files
before the run, checks their nonzero size and modification time against the device's
run-start clock, and verifies each pulled file's size, timestamp, and PNG signature.
It stages all five files before replacing the committed outputs; a failed capture,
pull, or final cleanup leaves the previous set in place.

Each stage removes previous instrumentation results and requires fresh aggregate
and single-device `test-result.pb` reports. The verifier uses the generated protobuf
API from AGP’s resolved worker dependencies. Both reports must contain exactly one
passing test with the expected class and method, a passing suite, and no platform
error or severe issue. Zero tests, skipped tests, and Gradle exit code 0 without this
proof are failures. Stage reports and `verified-test.txt` evidence are retained under
`apps/android/app/build/marketing-screenshot-runs/`; the wrapper prints the run path.
If cleanup fails, restore the device and rerun the wrapper on the same device so its
initial cleanup can delete the stored guest session before another capture.

A green instrumentation result is not enough on its own.
The final check is always the screenshot image itself.

## Clean shutdown

After verification:

1. Stop the owned Android emulator and wait for its process/session to finish, including snapshot saving.
2. Leave other tasks' devices and iOS simulators untouched; report any new contention.
3. Confirm `adb devices` is empty again.

This keeps the next run deterministic and avoids hidden resource contention between screenshot sessions.
