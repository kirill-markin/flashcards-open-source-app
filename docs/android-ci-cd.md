# Android CI/CD

This repository uses one reusable Android validation workflow with automatic pull-request checks, automatic `push main`, manual release, and a publisher-only recovery entrypoint:

- GitHub Actions is the primary Android CI/CD entrypoint on `main`
- `.github/workflows/android-ci-reusable.yml` contains the actual Android CI implementation
- `.github/workflows/pr-checks.yml` contains the required aggregate pull-request gate and conditionally calls the Android validation jobs
- `.github/workflows/android-ci.yml` is the automatic `push main` Android validation workflow
- `.github/workflows/android-release.yml` is the manual Android release workflow
- `.github/workflows/android-release-upload-recovery.yml` recovers only a failed publisher for a pinned, already-tested signed bundle
- GitHub submits Device Run only from the manual release workflow on Google-managed devices
- automatic Android CI and manual Android release are fully independent from the AWS/Web release workflow
- the manual Android release workflow uploads a production-track draft release to Google Play; final publication still happens later in Play Console
- `cloudbuild.android.yaml` is the Google-native entrypoint for Cloud Build triggers in the Google Cloud console

This setup keeps repository-native checks in GitHub while still allowing Google-managed device testing and avoiding long-lived Google service account keys.
We treat the managed-device app instrumentation suite as the closest CI signal to production behavior, while GitHub-hosted jobs keep the fast unit/build/lint checks and the smaller `data:local` instrumentation gate.
For release runs, the workflow resolves one shared `ANDROID_VERSION_CODE` and one manager-readable Android release identifier once, then reuses them across Android build artifacts, the Play draft release name, and Device Run result correlation for that same SHA. The current release identifier format is `vc<versionCode>-r<runId>a<attempt>-s<shortSha>`.

## Required GitHub repository variables

The manual Android release workflow Device Run job depends on these repository variables:

- `GCP_PROJECT_ID`
- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_SERVICE_ACCOUNT_EMAIL`
- `ANDROID_DEVICE_RUN_DEVICE` (catalog ID for API 37)
- `ANDROID_DEVICE_RUN_COMPAT_DEVICES` (three catalog IDs ordered by API 30, 31, 33; see [device configuration](#choose-the-device-run-devices))
- `ANDROID_DEVICE_RUN_RESULTS_BUCKET` (bucket name without `gs://` or a path)

The Android Google Play release workflow depends on these repository variables:

- `GCP_PROJECT_ID`
- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_PLAY_SERVICE_ACCOUNT_EMAIL`
- `ANDROID_PLAY_PACKAGE_NAME`
- `ANDROID_SENTRY_DSN`
- `ANDROID_SENTRY_TRACES_SAMPLE_RATE` (optional, defaults to `0` for release builds)
- `SENTRY_ORG`
- `SENTRY_ANDROID_PROJECT`

And these repository secrets:

- `ANDROID_UPLOAD_KEYSTORE_BASE64`
- `ANDROID_UPLOAD_KEYSTORE_PASSWORD`
- `ANDROID_UPLOAD_KEY_ALIAS`
- `ANDROID_UPLOAD_KEY_PASSWORD`
- `SENTRY_AUTH_TOKEN`

Push them to the repository with:

```bash
bash scripts/android/setup-github-android.sh
```

This Android-specific sync is separate from the AWS deploy bootstrap script `bash scripts/setup/setup-github.sh`.

## What runs

Pull-request GitHub Actions workflow: `.github/workflows/pr-checks.yml`

- Starts on every `pull_request`, so the required `Repository static checks` context is always reported
- Detects Android-impacting files while excluding `apps/android/README.md` and `apps/android/docs/**`
- Calls `.github/workflows/android-ci-reusable.yml` for the pull-request merge commit with `run_data_local_instrumentation: false` when Android-impacting files changed, so unit tests, debug builds, and lint run before merge
- Calls the reusable workflow separately with `run_build: false` and `run_data_local_instrumentation: true` only when files that can change the `:data:local` suite result change: `apps/android/data/**`, `apps/android/core/observability/**`, or shared Android Gradle configuration
- The narrow filter exists because `:data:local` depends only on `:core:observability`, so `:app`, `:core:ui`, and `:feature:*` changes cannot change that suite result
- Aggregates every conditional and unconditional PR job into `Repository static checks`; branch protection requires that context with strict up-to-date checks before merge
- Does not upload a Google Play draft
- Does not submit Device Run

Automatic GitHub Actions workflow: `.github/workflows/android-ci.yml`

- Starts on `push main` when Android-impacting files change
- Calls `.github/workflows/android-ci-reusable.yml` with `run_build: false`, so only the `data:local` emulator instrumentation job runs
- Is the post-merge emulator backstop and does not repeat the build, unit tests, or lint already enforced before merge
- Does not upload a Google Play draft
- Does not submit Device Run

GitHub Actions reusable workflow: `.github/workflows/android-ci-reusable.yml`

- Exposes two boolean inputs that both default to `true`: `run_build` gates the build, unit test, and lint job, and `run_data_local_instrumentation` gates the emulator `data:local` instrumentation job; the two conditional callers in `pr-checks.yml` each turn one off, `android-ci.yml` turns off the build job, and `android-release.yml` leaves both on
- Runs `test` for the whole Android Gradle project
- Builds `:app:assembleDebug`
- Builds `:app:assembleDebugAndroidTest`
- Builds `:data:local:assembleDebugAndroidTest`
- Runs `:app:lintDebug`
- Delegates the GitHub-hosted Android Gradle entrypoints to repo-root shell scripts in `scripts/android/`
- Uploads the debug APK, Android test APK, unit test reports, and lint report as workflow artifacts
- Boots a headless Android 17 / API 37 emulator in GitHub Actions with `-gpu swiftshader`
- Runs `:data:local:connectedDebugAndroidTest` on that emulator
- Uploads `data:local` instrumentation reports from the emulator run when the Gradle task produced them
- Intentionally does not make the emulator job depend on the build job, because the emulator job does its own checkout and Gradle build, so a failing build no longer prevents or cancels the emulator run
- Reuses the caller-provided `ANDROID_VERSION_CODE` across Android CI/build artifacts
- Uses the Sentry release name `com.flashcardsopensourceapp.app@<versionName>+<versionCode>` for Android release artifact correlation; the workflow summary also prints the manager-readable Play release identifier, but runtime Sentry event tags/contexts are controlled by app runtime code

Top-level release workflow Device Run job: `.github/workflows/android-release.yml` job `device_run_submission` (display name `Device Run app instrumentation`)

- Starts on every manual `Android Release` run after `android_ci` succeeds
- Uses Google Cloud CLI `588.0.0` with the `beta` component and location `global`; validates all four configured catalog IDs, authenticates once through WIF, and downloads `android-debug-apks` once
- Runs four sessions sequentially through the bounded synchronous helper: the full app instrumentation package on API 37, excluding `ManualOnlyAndroidTest`, then one four-method smoke session each on API 30, 31, and 33; see [device configuration](#choose-the-device-run-devices). Sessions share a linked test account, so concurrent workspace mutations are unsafe
- Uses Orchestrator `auto`, `clearPackageData=true,isAutomation=true`, portrait and `en-US`; inspect `event=automation_environment_resolved` in logcat for `isAutomation=true`, `isEmulator=false`, `hasArgumentSignal=true`, `isFirebaseTestLabDevice=false`. Device Run has no Firebase device marker, so the instrumentation argument must reach the app
- Labels all four sessions with the same release ID, target SHA and GitHub run/attempt; see [the workflow](../.github/workflows/android-release.yml) for exact labels, outputs and artifact details
- Retains raw reports and native evidence privately and uploads a safe named-result summary; see [result retrieval](#device-run-results-and-release-correlation). Every required session, job and execution must reach terminal success before the next session; complete reconciled native evidence also gates `publish_android`
- Follow [the Android release procedure](release/android.md) and inspect the full reports and named test results before publication

Top-level release workflow Play job: `.github/workflows/android-release.yml` job `publish_android`

- Builds and uploads the signed Android App Bundle artifact, then gates R8 optimization coverage before anything reaches Google Play
- Reads the R8 run summary AGP embeds at `BUNDLE-METADATA/com.android.tools/r8.json` inside that exact bundle, so the reported numbers describe the artifact being uploaded rather than a separate analysis run
- Converts `noShrinkingPercentage`, `noOptimizationPercentage`, and `noObfuscationPercentage` into coverage percentages, prints them to the run summary, and fails the run when any category is below Google Play's 25% minimum
- Fails loudly when the R8 metadata is missing or unreadable, so a silently unoptimized bundle cannot be published
- Runs after the bundle artifact upload, so a failed gate still leaves the exact bundle attached to the run for debugging

The pull-request Android flow is:

1. `pr-checks.yml` starts on every pull request and detects the affected areas
2. Android-impacting changes validate the pull-request merge commit with unit tests, debug builds, and lint
3. Android data-layer, `:core:observability`, and shared Gradle configuration changes also run `data:local` emulator instrumentation in parallel
4. The always-present `Repository static checks` aggregate succeeds only when every in-scope PR job succeeds and every out-of-scope conditional job is skipped
5. Branch protection requires that aggregate against the latest `main`, so an outdated or failing pull request cannot merge
6. The workflow stops there: no Device Run submission and no Google Play draft upload

The automatic Android CI flow is:

1. `android-ci.yml` starts on `push main` for Android-impacting changes
2. `data:local` Android instrumentation runs on a GitHub-hosted Android 17 emulator
3. The already-required build, unit tests, and lint do not repeat
4. The workflow stops there: no Device Run submission and no Google Play draft upload

The manual Android release flow is:

1. `android-release.yml` starts only through manual `workflow_dispatch`; optional `target_sha` pins a specific release commit, otherwise the selected workflow ref SHA is used
2. The workflow resolves one shared `ANDROID_VERSION_CODE` and one shared Android release identifier for the run, validates optional [localized notes JSON](release/release-notes.md#android-draft-upload-input), and retains its exact input/source/version/run/attempt manifest before costly gates
3. The reusable Android CI gate runs for the target SHA
4. Four Device Run sessions execute sequentially for the same CI debug/test APKs: API 37 full suite, then API 30, 31 and 33 smoke, one destination per session
5. After all four sessions, jobs and executions reach terminal success, the signed Android App Bundle is built and uploaded as a workflow artifact
6. The R8 optimization coverage gate reads `BUNDLE-METADATA/com.android.tools/r8.json` from that bundle and fails the run when shrinking, optimization, or obfuscation coverage is below Google's 25% minimum
7. Only then is the bundle uploaded as a Google Play production-track draft through the guarded [publisher](../scripts/android/publish-play-draft.py); review submission follows the app's actual Play policy
8. Inspect all four sessions and their named cases under [the Android release procedure](release/android.md), then review the Play Console draft before publishing manually

The upload commits an app-wide Play edit. Follow the [release procedure](release/android.md)
to inspect pending changes and active reviews before dispatch and after upload;
draft track status alone does not protect other pending changes from review submission.
The publisher commits with `ERROR_IF_IN_REVIEW` and omits the conditional
`changesNotSentForReview` parameter. Workflow tooling is checked out separately
from the pinned product source. For a failed publisher with passing retained
build/native gates, follow [exact-bundle recovery](release/android.md#exact-bundle-upload-recovery).
The separate notes artifact leaves signed-bundle and native-summary inventories
unchanged; recovery restores the exact original notes with digest and attempt
checks, while supporting legacy releases without notes evidence.

After pushing to `main`, watch `Android CI` separately when Android-impacting files changed.

For Android, a green automatic `Android CI` run means the post-merge `data:local` emulator backstop passed for that SHA. The required PR aggregate already enforced the applicable build, unit tests, lint, and pull-request emulator gate. A green automatic run does not mean Device Run was submitted, a Google Play draft was uploaded, or a release is ready to publish.

A green manual `Android Release` run means the GitHub-hosted Android gate and all four Device Run sessions, jobs and executions passed, and CI uploaded a Play draft. Inspect named cases through the CLI/GCS procedure below. Translation review, Play-delivered build verification, and final publication still happen later in Play Console. A non-green `Android Release` run means one of the required release stages failed or was skipped by a failed dependency.

## Device Run results and release correlation

Download the `android-device-run-submissions` GitHub artifact for the exact release run/attempt. It contains only public-safe `summary.json`: SHA, release ID, four configured selections/devices/session IDs, independent expected inventory, per-execution named statuses/counts, artifact SHA-256 hashes and private object references. Require all four `.sessions[].passed == true` and `.private_archive_uploaded == true`. Missing/zero/duplicate selected cases, failed/error/unexpected-skipped results, differing job-level XML or submitted APK hashes fail the workflow before signed bundle build and Play draft upload.

The collector derives API 37 inventory from the checked-out JUnit4 declarations, excluding `ManualOnlyAndroidTest`; it does not learn inventory from passing results. The current suite uses nonparameterized `AndroidJUnit4` methods and an untested timeout base class. Unsupported runners, inherited tests, nested test classes or declaration forms fail explicitly and require inventory support before releasing. Compatibility requires the four methods in [the configured selection](../scripts/android/device-run-test-selection.json), which also drives workflow submission. Manual exclusions are recorded separately and never count as executed passes. Execution XML is counted once; duplicate job-level XML must reconcile exactly.

Full terminal reports, submission records, catalog, every execution's JUnit/logcat/instrument logs are retained in a private `raw.tar.gz` in the existing results bucket. The collector follows the report's native `outputFiles[].gcsOutputFile.path`, verifies downloaded input APK hashes against this run's CI artifacts, retains their private source references, and keeps raw diagnostics out of public GitHub artifacts/logs. Failed sessions are collected where evidence is available; later unexecuted destinations remain failed evidence gates. See Google's [native result layout](https://docs.cloud.google.com/developer-device-platform/device-run/find-logs) and [full-report schema](https://docs.cloud.google.com/developer-device-platform/reference/device-run/rest/v1alpha/projects.locations.sessions).

For private warning/diagnostic review, use an already-authorized Google identity with CLI `588.0.0` and `beta`, or existing authorized service-account impersonation. Do not create keys, principals or grants. Retrieve the archive programmatically from `.private_archive` in the safe summary:

```bash
archive="$(jq -r '.private_archive' summary.json)"
gcloud storage cp "${archive}" raw.tar.gz
expected_hash="$(jq -r '.private_archive_sha256' summary.json)"
printf '%s  raw.tar.gz\n' "${expected_hash}" | shasum -a 256 --check
mkdir private-evidence
tar -xzf raw.tar.gz -C private-evidence
```

Keep the extracted files private. Each `.sessions[].report.member` identifies its full report inside the archive; match its hash, run/attempt/SHA labels and device against the safe summary. Native GCS object references and hashes are recorded under `.sessions[].artifacts` and `.sessions[].executions[].artifacts`. To fetch one referenced file directly, use `gcloud storage cp "gs://REFERENCE-FROM-SUMMARY" /private/path`. Do not publish raw XML output, logcat, full reports or signed URLs.

The CLI session ID is the basename of `.name` (`session-…`), distinct from `.sessionReport.id`. For a fresh provider lookup:

```bash
gcloud beta device-run sessions describe "session-ID-FROM-SUMMARY" --full --format=json \
  --project "flashcards-open-source-app" --location global > /private/path/session.json
```

Named result automation verifies native execution and correlation only. Raw warnings, automation-environment log signals, product diagnostics, security, Play-delivered translations and store readiness remain operator-reviewed under [the publication gate](release/android.md).

## Android translation model

Android app-internal translations are Play-first:

- Keep the repository authoritative for the base English Android strings and locale plumbing.
- Do not add or maintain repository-owned Android `values-xx` translation trees by default, including Spanish.
- After CI uploads the signed AAB as a draft production release, use Google Play App strings translation and Gemini in Play Console to create or update translated Android UI copy.
- Review and publish that draft later in Play Console after the Play-managed translations are ready.
- Treat Google Play listing localization separately from in-app Android strings.

Cross-client live smoke references:

- Android: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/livesmoke/LiveSmokeTest.kt`
- Android notification tap gate: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/notifications/NotificationTapSmokeTest.kt`
- iOS: `apps/ios/Flashcards/FlashcardsUITests/LiveSmoke*Tests.swift`
- Web: `apps/web/e2e/live-smoke.spec.ts`

Cloud Build config: `cloudbuild.android.yaml`

- Builds a dedicated Android CI container from `apps/android/ci/Dockerfile`
- Reuses the same fast CI shell script as GitHub Actions and the same Device Run package-level targeting
- Can be attached to a Cloud Build trigger connected to the GitHub repository

## Google Cloud access and device preflight

Use the existing project `flashcards-open-source-app`, WIF provider, `github-android-ci@flashcards-open-source-app.iam.gserviceaccount.com`, and dedicated results bucket `flashcards-open-source-app-test-lab-results`. GitHub authentication uses Workload Identity Federation, with no service-account JSON key. Keep the separate Play upload service account and its app-scoped Play Console permissions.

The verified Device Run setup has these APIs enabled: `devicerun.googleapis.com`, `devicestreaming.googleapis.com`, and `testing.googleapis.com`. The existing Android CI service account has project roles `roles/devicerun.admin` and `roles/serviceusage.serviceUsageConsumer`, with its existing bucket-scoped `roles/storage.admin`. Retain the existing WIF `roles/iam.workloadIdentityUser` binding. Do not add project Viewer/Editor/Owner or reader grants. Play uploads use the existing `androidpublisher.googleapis.com` API and separate `GCP_PLAY_SERVICE_ACCOUNT_EMAIL`.

### Choose the Device Run devices

Read the current catalog before a release and preserve it with the release record:

```bash
gcloud beta device-run devices list --project "flashcards-open-source-app" \
  --location global --format=json > device-run-catalog.json
```

Configure exact catalog IDs, not model/version descriptors. `ANDROID_DEVICE_RUN_DEVICE` selects one API 37 destination; `ANDROID_DEVICE_RUN_COMPAT_DEVICES` is a JSON array of three distinct IDs ordered by API 30, 31 and 33. The configured selections are:

| Variable / position | Catalog ID | Device | API | Catalog availability at verification |
| --- | --- | --- | --- | --- |
| `ANDROID_DEVICE_RUN_DEVICE` | `cubs-37` | Pixel 11 | 37 | High |
| Compatibility `[0]` | `redfin-30` | Pixel 5 | 30 | High |
| Compatibility `[1]` | `a21-31` | Galaxy A21 | 31 | Low |
| Compatibility `[2]` | `oriole-33` | Pixel 6 | 33 | Medium |

Catalog availability can change. For each ID, require `.name` basename to match, `.osVersion` to be its intended API string, `.platform == "ANDROID"`, `.lifecycle.state == "ACTIVE"`, no `accessDeniedReasons`, and an automation entry in `supportedProducts`. Check availability before submission; fail explicitly on an unavailable or inaccessible destination. Record the four actual IDs/APIs and selected targets. No API is silently omitted and no device/version cross-product is generated. API 32 remains supported without a separate release destination.

Set `ANDROID_DEVICE_RUN_COMPAT_DEVICES` to `["redfin-30","a21-31","oriole-33"]` in the local root `.env` or environment with the latest ID and bucket name, then use `bash scripts/android/setup-github-android.sh` when configuration sync is authorized. The script requires all three Device Run variables; no results-directory variable exists.

The latest session uses repeated targets `package com.flashcardsopensourceapp.app` and `notAnnotation com.flashcardsopensourceapp.app.ManualOnlyAndroidTest`. Each of the three separate compatibility sessions selects exactly these existing methods on its older destination (each passed as a separate `--test-targets "class <method>"`):

- `com.flashcardsopensourceapp.app.livesmoke.LiveSmokeTest#manualCardCanBeCreatedInDefaultWorkspace`
- `com.flashcardsopensourceapp.app.livesmoke.LiveSmokeTest#repositorySeededCardCanBeReviewedInDefaultWorkspace`
- `com.flashcardsopensourceapp.app.livesmoke.LiveSmokeTest#linkedWorkspaceAccountStatusAndWorkspaceStateAreVisible`
- `com.flashcardsopensourceapp.app.notifications.NotificationTapSmokeTest#reviewReminderNotificationTapOpensReviewFromSystemShade`

## GitHub repository variables

Set the required repository variables listed above before running the manual `Android Release` workflow.

Set the Google Play release variables and secrets before expecting `.github/workflows/android-release.yml` to upload a draft release successfully.

`ANDROID_PLAY_PACKAGE_NAME` should match the Android `applicationId`. In this repository that value is `com.flashcardsopensourceapp.app`.

`scripts/android/setup-github-android.sh` requires the Sentry repository variables in the local environment when updating GitHub configuration. `SENTRY_AUTH_TOKEN` is only written when present locally, so operators can update variables without replacing an existing GitHub secret.

## One-time Play Console setup

Before the release workflow can upload draft releases to Google Play, complete this one-time setup in Play Console:

1. Create the app with package name `com.flashcardsopensourceapp.app`.
2. Complete the required Play Console setup sections for the app shell, including app access, ads declaration, content rating, target audience, privacy policy, and Data safety if Play requires them for release submission.
3. Enable Play App Signing for the app.
4. Configure production availability in Play Console, including countries and regions for the production track.
5. Invite `GCP_PLAY_SERVICE_ACCOUNT_EMAIL` in Play Console under Users and permissions, then grant the app-specific permissions needed to upload production-track draft releases.
6. Make the first signed upload manually in Play Console using the same upload keystore that CI will use later.

That first manual upload is the safest bootstrap step because it establishes the app entry, Play App Signing state, and first track release before CI takes over subsequent draft uploads.

After CI uploads a draft release:

1. Open Play Console and review the new production-track draft release.
2. Review or generate Android App strings translations there with the Play Console workflow and Gemini.
3. Complete the required Device Run result gates in [the Android release procedure](release/android.md), then publish manually from Play Console when translation review is complete.

## Cloud Build trigger setup

Cloud Build is optional here, but useful if you want a Google-native trigger in the Google Cloud console in addition to GitHub Actions.

### 1. Connect the GitHub repository to Cloud Build

- In Google Cloud console, open Cloud Build
- Connect the GitHub repository
- Create a trigger that uses `cloudbuild.android.yaml`

### 2. Use a configured Cloud Build service account

Use Device Run project roles and dedicated bucket access described in [Google Cloud access](#google-cloud-access-and-device-preflight), plus the existing Cloud Build build/logging permissions. Do not grant broad project roles.

### 3. Configure trigger substitutions

Set `_ANDROID_DEVICE_RUN_DEVICE` and `_ANDROID_DEVICE_RUN_RESULTS_BUCKET`. This optional entrypoint uses the synchronous helper for the latest full selection only; it does not supply the release's three compatibility sessions or Play publication gates.

## Local Testing Rules

For Android, follow [apps/android/README.md](../apps/android/README.md) for platform targets and testing focus. Keep full-suite local runs on API 37. The release adds three small API 30/31/33 Device Run smoke sessions and the first-release API 30 manual walkthrough in [the release procedure](release/android.md); broad older-device matrices remain out of scope.
Before running Android tests, also check which Android emulators are available locally. If a local emulator is available, start it in the background without a visible emulator window by default and preserve the usual test artifacts, logs, screenshots, and reports. Open a visible Android emulator only when the user explicitly asks for it at that time.
For local instrumentation runs, prefer one clean emulator only:

- stop all running Android emulators before the run
- verify `adb devices` shows only one target emulator before starting Gradle
- when launching a local headless emulator manually, prefer `emulator @Medium_Phone_API_37.0 -no-window -no-audio -gpu auto`
- for temporary local startup diagnosis only, keep the same command and add `-verbose -debug init,metrics -logcat '*:s ActivityManager:i AndroidTestOrchestrator:i TestRunner:i'`
- prefer a clean rebuild and one clean test run when validating a local fix
- do not reuse a second emulator or a half-failed prior emulator session for the same verification pass

## Local parity commands

Build the same artifacts CI expects:

```bash
bash scripts/android/run-android-ci.sh
```

Run the retained Android FSRS parity test against the shared vectors:

```bash
cd apps/android && ./gradlew --no-daemon :data:local:testDebugUnitTest --tests com.flashcardsopensourceapp.data.local.model.scheduling.FsrsSchedulerParityTest
```

Build the signed release bundle with the same inputs that the release workflow uses:

For local release and upload paths, export or source the Sentry variables before invoking Gradle or the helper script: `ANDROID_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_ANDROID_PROJECT`.

```bash
bash scripts/android/run-android-release.sh \
  --version-code "12345" \
  --keystore-path "/absolute/path/to/upload-key.jks" \
  --keystore-password "YOUR_KEYSTORE_PASSWORD" \
  --key-alias "YOUR_KEY_ALIAS" \
  --key-password "YOUR_KEY_PASSWORD"
```

Run one app instrumentation class on a local emulator for ad hoc debugging (requires a running emulator via `adb devices`):

```bash
adb devices
cd apps/android && ./gradlew clean :app:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.flashcardsopensourceapp.app.livesmoke.LiveSmokeTest
```

Note: `connectedDebugAndroidTest` does not support the `--tests` flag. Use `-Pandroid.testInstrumentationRunnerArguments.class=` to filter by test class.

Run another app instrumentation class on a local emulator:

```bash
adb devices
cd apps/android && ./gradlew clean :app:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.flashcardsopensourceapp.app.notifications.NotificationTapSmokeTest
```

Run the latest full app instrumentation selection in Device Run after authenticating with an authorized Google identity and validating the catalog:

```bash
bash scripts/android/run-android-device-run.sh \
  --project-id "flashcards-open-source-app" \
  --device "cubs-37" \
  --app-path "apps/android/app/build/outputs/apk/debug/app-debug.apk" \
  --test-path "apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk" \
  --timeout "30m" \
  --max-session-duration "35m" \
  --test-targets "package com.flashcardsopensourceapp.app" \
  --test-targets "notAnnotation com.flashcardsopensourceapp.app.ManualOnlyAndroidTest" \
  --results-bucket "flashcards-open-source-app-test-lab-results" \
  --session-output "/absolute/release-record/device-run-session.json"
```

The helper requires `gcloud`, `jq`, explicit APKs, at least one `--device` catalog ID, bucket name, timeout and session-output path. Synchronous mode also requires GNU `timeout` and `--max-session-duration`; keep it above the instrumentation timeout for startup and reporting overhead. `--async` submits and saves the initial full report without waiting. Optional `--labels` is comma-separated key/value pairs. For the release, use one `--device` per synchronous invocation, a separate session-output path per session, and repeat `--test-targets` for the four compatibility methods; follow the [workflow](../.github/workflows/android-release.yml) for sequence and labels. Inspect terminal reports and named cases under [results inspection](#device-run-results-and-release-correlation), even after synchronous success.
