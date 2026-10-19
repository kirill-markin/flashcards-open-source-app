# Android CI/CD

This repository uses one reusable Android validation workflow, called only by the manual release, and a publisher-only recovery entrypoint:

- GitHub Actions is the primary Android CI/CD entrypoint
- [android-ci-reusable.yml](../.github/workflows/android-ci-reusable.yml) is the Android validation itself: unit tests, debug builds and lint, plus `data:local` instrumentation on a GitHub-hosted emulator. It intentionally does not make the emulator job depend on the build job, because the emulator job does its own checkout and Gradle build, so a failing build does not prevent or cancel the emulator run
- pull requests and pushes to `main` run no Android CI: `main` reaches users only through an Android release, which runs every check, so `main` can fail to compile for Android unnoticed until the next release; fix forward
- [android-release.yml](../.github/workflows/android-release.yml) is the manual release: the validation gate, four sequential Device Run sessions on Google-managed devices, the signed bundle with its R8 coverage gate, and a Google Play production-track draft; follow [the Android release procedure](release/android.md)
- [android-release-upload-recovery.yml](../.github/workflows/android-release-upload-recovery.yml) recovers only a failed publisher for a pinned, already-tested signed bundle ([exact-bundle recovery](release/android.md#exact-bundle-upload-recovery))
- the manual Android release is fully independent from the AWS/Web release workflow
- read-only operations: [Device Run diagnostics](android-device-run-diagnostics.md) and [Play release status](android-play-status.md)
- [cloudbuild.android.yaml](../cloudbuild.android.yaml) is an optional Google-native entrypoint ([setup](#cloud-build-trigger-setup))

The R8 coverage gate enforces Google Play's 25% minimum in each R8 category on the metadata AGP embeds in the signed release bundle itself, and runs after the bundle artifact upload so a failing bundle stays attached to the run for inspection.

We treat the managed-device app instrumentation suite as the closest CI signal to production behavior, while GitHub-hosted jobs keep the fast unit/build/lint checks and the smaller `data:local` instrumentation gate. Google access uses Workload Identity Federation, never a long-lived service account key.

A green normal-mode `Android Release` run means the GitHub-hosted Android gate and all four Device Run sessions, jobs and executions passed, and CI uploaded a Play draft. Inspect named cases through [the results procedure](#device-run-results-and-release-correlation). Translation review, Play-delivered build verification, and final publication still happen later in Play Console. A non-green `Android Release` run means one of the required release stages failed or was skipped by a failed dependency.

The explicit default-off `known_device_run_network_exception` input applies only
under the [standing known-issue procedure](android-device-run-network-issue.md) and [best-effort release policy](release/README.md#standing-best-effort-release-policy).
Its green workflow means physical sessions were waived/not executed and the
remaining CI/signing/R8/guarded publisher succeeded, not that four sessions passed.
Retain the policy artifact and separate operator readiness; normal configuration,
session inspection and exact-bundle recovery contracts remain unchanged. Choose this route during preflight while the issue remains unresolved and unchanged; no repeated waiver or physical probe is required.

## GitHub configuration

[setup-github-android.sh](../scripts/android/setup-github-android.sh) syncs the Android repository variables and secrets from the root `.env`, separately from the AWS deploy bootstrap `scripts/setup/setup-github.sh`, and names every value it requires. The Play upload also requires values the script treats as optional; the `Validate Google Play configuration`, `Validate Android Sentry configuration` and `Validate Android signing secrets` steps of [the release workflow](../.github/workflows/android-release.yml) are the authoritative list, and they run only in `publish_android`, after all four Device Run sessions. CI signs the release bundle with the upload keystore held in the `ANDROID_UPLOAD_*` repository secrets. Run the script with the complete root `.env` only when configuration sync is authorized: it writes secrets only when they are present locally and deletes optional variables that are empty there. `ANDROID_PLAY_PACKAGE_NAME` matches the Android `applicationId`, `com.flashcardsopensourceapp.app`. A missing local upload key does not block CI signing and is not grounds for key reset or recovery.

## Device Run results and release correlation

Download the `android-device-run-submissions` GitHub artifact for the exact release run/attempt. Its only file is the public-safe `summary.json`, which correlates the SHA, release ID, all four sessions, their named results and the private evidence references. Require all four `.sessions[].passed == true` and `.private_archive_uploaded == true`. The [collector](../scripts/android/collect-device-run-evidence.py) fails the workflow before the signed bundle build and Play draft upload on any missing, duplicate, failed or unexpectedly skipped selected case and on any report or APK hash mismatch; an unsupported test declaration form fails explicitly and needs collector inventory support before releasing.

Full terminal reports, submission records, the catalog, and every execution's JUnit/logcat/instrument logs are retained in a private `raw.tar.gz` in the results bucket, out of public GitHub artifacts and logs. See Google's [native result layout](https://docs.cloud.google.com/developer-device-platform/device-run/find-logs) and [full-report schema](https://docs.cloud.google.com/developer-device-platform/reference/device-run/rest/v1alpha/projects.locations.sessions).

For private warning/diagnostic review, use an already-authorized Google identity with the workflow's Google Cloud CLI version and its `beta` component, or existing authorized service-account impersonation. Do not create keys, principals or grants. Retrieve the archive programmatically from `.private_archive` in the safe summary:

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

In each session's logcat, `event=automation_environment_resolved` must show `isAutomation=true`, `isEmulator=false`, `hasArgumentSignal=true`, and `isFirebaseTestLabDevice=false`: Device Run has no Firebase device marker, so the `isAutomation=true` instrumentation argument that [the helper](../scripts/android/run-android-device-run.sh) passes must reach the app.

Named result automation verifies native execution and correlation only. Raw warnings, automation-environment log signals, product diagnostics, security, Play-delivered translations and store readiness remain operator-reviewed under [the publication gate](release/android.md).

## Play-managed translations

Android app-internal translations are Play-first, as the [add-language checklist](../apps/android/docs/add-language-checklist.md) defines: after CI uploads the draft, create or update translated Android UI copy with Google Play App strings translation and Gemini in Play Console, and publish the draft only after those translations are reviewed. Google Play listing localization is separate.

## Google Cloud access and device preflight

Use the existing project `flashcards-open-source-app`, WIF provider, `github-android-ci@flashcards-open-source-app.iam.gserviceaccount.com`, and dedicated results bucket `flashcards-open-source-app-test-lab-results`. Keep the separate Play upload service account and its app-scoped Play Console permissions.

The verified Device Run setup has these APIs enabled: `devicerun.googleapis.com`, `devicestreaming.googleapis.com`, and `testing.googleapis.com`. The existing Android CI service account has project roles `roles/devicerun.admin` and `roles/serviceusage.serviceUsageConsumer`, with its existing bucket-scoped `roles/storage.admin`. Retain the existing WIF `roles/iam.workloadIdentityUser` binding. Do not add project Viewer/Editor/Owner or reader grants. Play uploads use the existing `androidpublisher.googleapis.com` API and separate `GCP_PLAY_SERVICE_ACCOUNT_EMAIL`.

### Choose the Device Run devices

Read the current catalog before a release and preserve it with the release record:

```bash
gcloud beta device-run devices list --project "flashcards-open-source-app" \
  --location global --format=json > device-run-catalog.json
```

Configure exact catalog IDs, not model/version descriptors. `ANDROID_DEVICE_RUN_DEVICE` selects one API 37 destination; `ANDROID_DEVICE_RUN_COMPAT_DEVICES` is a JSON array of three distinct IDs ordered by API 30, 31 and 33. The configured selections are:

| Variable / position | Catalog ID | Device | API |
| --- | --- | --- | --- |
| `ANDROID_DEVICE_RUN_DEVICE` | `cubs-37` | Pixel 11 | 37 |
| Compatibility `[0]` | `redfin-30` | Pixel 5 | 30 |
| Compatibility `[1]` | `a21-31` | Galaxy A21 | 31 |
| Compatibility `[2]` | `oriole-33` | Pixel 6 | 33 |

Catalog availability can change. The `Require configured Device Run destinations in the current catalog` step of [the release workflow](../.github/workflows/android-release.yml) defines a suitable destination and fails explicitly on an unavailable or inaccessible one; check the catalog against it before submission, and record the four actual IDs/APIs and selected targets. No API is silently omitted and no device/version cross-product is generated. API 32 remains supported without a separate release destination.

Set the IDs and bucket name in the local root `.env` or environment (`ANDROID_DEVICE_RUN_COMPAT_DEVICES='["redfin-30","a21-31","oriole-33"]'`), then sync them with [setup-github-android.sh](../scripts/android/setup-github-android.sh) when configuration sync is authorized.

The latest session runs the full app package excluding `ManualOnlyAndroidTest`; each compatibility session runs the four methods in [the configured selection](../scripts/android/device-run-test-selection.json), which also drives workflow submission.

## One-time Play Console setup

Before the release workflow can upload draft releases to Google Play, complete this one-time setup in Play Console:

1. Create the app with package name `com.flashcardsopensourceapp.app`.
2. Complete the required Play Console setup sections for the app shell, including app access, ads declaration, content rating, target audience, privacy policy, and Data safety if Play requires them for release submission.
3. Enable Play App Signing for the app.
4. Configure production availability in Play Console, including countries and regions for the production track.
5. Invite `GCP_PLAY_SERVICE_ACCOUNT_EMAIL` in Play Console under Users and permissions, then grant the app-specific permissions needed to upload production-track draft releases.
6. Make the first signed upload manually in Play Console using the same upload keystore that CI will use later.

That first manual upload is the safest bootstrap step because it establishes the app entry, Play App Signing state, and first track release before CI takes over subsequent draft uploads.

## Cloud Build trigger setup

Cloud Build is optional here, but useful if you want a Google-native trigger in the Google Cloud console in addition to GitHub Actions.

### 1. Connect the GitHub repository to Cloud Build

- In Google Cloud console, open Cloud Build
- Connect the GitHub repository
- Create a trigger that uses `cloudbuild.android.yaml`

### 2. Use a configured Cloud Build service account

Use Device Run project roles and dedicated bucket access described in [Google Cloud access](#google-cloud-access-and-device-preflight), plus the existing Cloud Build build/logging permissions. Do not grant broad project roles.

### 3. Configure trigger substitutions

Set `_ANDROID_DEVICE_RUN_DEVICE` and `_ANDROID_DEVICE_RUN_RESULTS_BUCKET`. This optional entrypoint runs the latest full selection only; it does not supply the release's three compatibility sessions or Play publication gates.

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

Build the signed release bundle with the same inputs that the release workflow uses. For local release and upload paths, export or source the Sentry variables before invoking Gradle or the helper script: `ANDROID_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_ANDROID_PROJECT`.

```bash
bash scripts/android/run-android-release.sh \
  --version-code "12345" \
  --keystore-path "/absolute/path/to/upload-key.jks" \
  --keystore-password "YOUR_KEYSTORE_PASSWORD" \
  --key-alias "YOUR_KEY_ALIAS" \
  --key-password "YOUR_KEY_PASSWORD"
```

Run one app instrumentation class on a local emulator for ad hoc debugging (requires a running emulator via `adb devices`). `connectedDebugAndroidTest` does not support the `--tests` flag, so filter by class:

```bash
adb devices
cd apps/android && ./gradlew clean :app:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.flashcardsopensourceapp.app.livesmoke.LiveSmokeTest
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

[The helper](../scripts/android/run-android-device-run.sh) fails with an explicit error for any missing input or tool. Keep `--max-session-duration` above the instrumentation timeout for startup and reporting overhead. For the release, use one `--device` per synchronous invocation and a separate session-output path per session; follow the [workflow](../.github/workflows/android-release.yml) for the sequence, targets and labels. Inspect terminal reports and named cases under [results inspection](#device-run-results-and-release-correlation), even after synchronous success.
