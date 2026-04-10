# Android CI/CD

This repository uses one reusable Android validation workflow plus one dedicated Android release entry workflow:

- GitHub Actions is the primary Android CI/CD entrypoint on `main`
- Firebase Test Lab runs instrumentation tests on Google-managed devices
- `.github/workflows/android-ci-reusable.yml` contains the actual Android CI implementation
- `.github/workflows/android-release.yml` is the canonical Android workflow for `push main` and manual runs
- Android release is fully independent from the AWS/Web release workflow on `main`
- the Android release workflow uploads a production-track draft release to Google Play; final publication still happens later in Play Console
- `cloudbuild.android.yaml` is the Google-native entrypoint for Cloud Build triggers in the Google Cloud console

This setup keeps repository-native checks in GitHub while still using Google-managed device testing and avoiding long-lived Google service account keys.
We treat the managed-device app instrumentation suite as the closest CI signal to production behavior, while GitHub-hosted jobs keep the fast unit/build/lint checks and the smaller `data:local` instrumentation gate.

## Required GitHub repository variables

The Android GitHub Actions workflow depends on these repository variables:

- `GCP_PROJECT_ID`
- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_SERVICE_ACCOUNT_EMAIL`
- `ANDROID_FTL_DEVICE_MODEL`
- `ANDROID_FTL_DEVICE_VERSION`
- `ANDROID_FTL_RESULTS_BUCKET`
- `ANDROID_FTL_RESULTS_DIR`

The Android Google Play release workflow also depends on these repository variables:

- `GCP_PLAY_SERVICE_ACCOUNT_EMAIL`
- `ANDROID_PLAY_PACKAGE_NAME`

And these repository secrets:

- `ANDROID_UPLOAD_KEYSTORE_BASE64`
- `ANDROID_UPLOAD_KEYSTORE_PASSWORD`
- `ANDROID_UPLOAD_KEY_ALIAS`
- `ANDROID_UPLOAD_KEY_PASSWORD`

Push them to the repository with:

```bash
bash scripts/setup-github-android.sh
```

This Android-specific sync is separate from the AWS deploy bootstrap script `bash scripts/setup-github.sh`.

## What runs

GitHub Actions reusable workflow: `.github/workflows/android-ci-reusable.yml`

- Runs `test` for the whole Android Gradle project
- Builds `:app:assembleDebug`
- Builds `:app:assembleDebugAndroidTest`
- Builds `:data:local:assembleDebugAndroidTest`
- Runs `:app:lintDebug`
- Delegates the GitHub-hosted Android Gradle entrypoints to repo-root shell scripts in `scripts/`
- Uploads the debug APK, Android test APK, unit test reports, and lint report as workflow artifacts
- Boots a headless Android 16 / API 36 emulator in GitHub Actions
- Runs `:data:local:connectedDebugAndroidTest` on that emulator
- Uploads `data:local` instrumentation reports from the emulator run when the Gradle task produced them
- Validates the Firebase Test Lab configuration whenever the reusable workflow is called with app instrumentation enabled
- Runs Firebase Test Lab against the full app instrumentation package `com.flashcardsopensourceapp.app`, excluding `com.flashcardsopensourceapp.app.ManualOnlyAndroidTest`
- Tracks Firebase Test Lab results in the configured Cloud Storage results path, namespaced per GitHub run as `${ANDROID_FTL_RESULTS_DIR}/${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}`
- Fails the workflow instead of silently skipping the Firebase Test Lab app instrumentation gate when the required repository variables are missing

The Android release flow is:

1. Android unit tests, debug builds, and lint in GitHub Actions
2. `data:local` Android instrumentation on a GitHub-hosted Android 16 emulator
3. `android-release.yml` uploads a Google Play production-track draft release after the GitHub-hosted gate succeeds
4. Firebase Test Lab continues tracking the full app UI instrumentation suite for the same SHA and run outside the Play draft upload critical path

After pushing to `main`, watch `Android Release` separately when Android-impacting files changed.

`Android Release` runs independently on `push main` for Android-impacting changes and on manual `workflow_dispatch` with an explicit target SHA. Push runs upload a Play draft automatically after the GitHub-hosted Android gate succeeds. Manual runs execute the same GitHub-hosted gate, still start Firebase Test Lab app instrumentation for the target SHA, and upload a Play draft only when `upload_to_play_draft` is explicitly enabled.

For Android, a green `Android Release` run always means the GitHub-hosted Android gate passed for that SHA. On `push main` runs and manual runs with `upload_to_play_draft=true`, it also means CI uploaded the Play draft successfully. On manual runs with `upload_to_play_draft=false`, the workflow can still finish green with the Play draft upload intentionally skipped. A non-green `Android Release` run means the GitHub-hosted gate failed, or the Play draft upload failed in a run that was supposed to upload it. It does not mean Firebase Test Lab has already finished, and it does not mean the release is already live.

To match a Play draft to the exact SHA, GitHub run, and Firebase results:

- use the `Android release preflight` summary to get the target SHA
- use the `Android Play draft upload` summary to get the Play draft release name `main-draft-<versionCode>-r<runId>a<attempt>-s<shortSha>` and version code
- use the `Run details` link in the release summary to open the exact GitHub Actions run
- use the same run's Firebase results path `${ANDROID_FTL_RESULTS_DIR}/${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}` in the configured results bucket to inspect the device-lab outcome

## Android translation model

Android app-internal translations are Play-first:

- Keep the repository authoritative for the base English Android strings and locale plumbing.
- Do not add or maintain repository-owned Android `values-xx` translation trees by default, including Spanish.
- After CI uploads the signed AAB as a draft production release, use Google Play App strings translation and Gemini in Play Console to create or update translated Android UI copy.
- Review and publish that draft later in Play Console after the Play-managed translations are ready.
- Treat Google Play listing localization separately from in-app Android strings.

Cross-client live smoke references:

- Android: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/LiveSmokeTest.kt`
- Android notification tap gate: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/NotificationTapSmokeTest.kt`
- iOS: `apps/ios/Flashcards/FlashcardsUITests/LiveSmoke*Tests.swift`
- Web: `apps/web/e2e/live-smoke.spec.ts`

Cloud Build config: `cloudbuild.android.yaml`

- Builds a dedicated Android CI container from `apps/android/ci/Dockerfile`
- Reuses the same fast CI shell script as GitHub Actions and the same Firebase Test Lab package-level targeting
- Can be attached to a Cloud Build trigger connected to the GitHub repository

## Recommended architecture

This is the current recommended shape for this repository:

- Use GitHub Actions as the default CI orchestrator because the repo already uses GitHub Actions for other services
- Use Workload Identity Federation for GitHub to Google Cloud authentication
- Do not store Google service account JSON keys in GitHub secrets
- Use Firebase Test Lab for instrumentation tests instead of self-hosted emulators
- Use a separate Google Cloud service account for Google Play uploads, scoped in Play Console to this app only
- Use Google Play production-track draft uploads so translation review and final release approval stay in Play Console
- Use a dedicated Cloud Storage bucket for Test Lab results so you do not need broad `roles/editor`

Google's current documentation supports this direction:

- Android CI guidance explicitly lists Firebase Test Lab as a reliable device farm option for instrumented tests: [Android CI automation](https://developer.android.com/training/testing/continuous-integration/automation)
- Firebase Test Lab IAM guidance says `gcloud firebase test android run` defaults to requiring `roles/editor`, and recommends using your own results bucket plus narrower roles instead: [Firebase Test Lab IAM permissions](https://firebase.google.com/docs/test-lab/android/iam-permissions-reference)
- The Google GitHub auth action warns that Workload Identity Federation is preferred over long-lived service account JSON keys: [google-github-actions/auth](https://github.com/google-github-actions/auth)

## One-time Google Cloud setup

You need a Google Cloud project with Firebase enabled for Test Lab.

### 1. Create or choose the project

- Pick the Google Cloud project that should own Android CI
- Add Firebase to that project if it is not already a Firebase project

### 2. Create a dedicated Test Lab results bucket

Example:

```bash
gcloud storage buckets create "gs://flashcards-open-source-app-test-lab-results" \
  --project "YOUR_GCP_PROJECT_ID" \
  --location "europe-west1" \
  --uniform-bucket-level-access
```

### 3. Create a GitHub Actions service account

Example:

```bash
gcloud iam service-accounts create "github-android-ci" \
  --project "YOUR_GCP_PROJECT_ID" \
  --display-name "GitHub Android CI"
```

Grant the minimum project roles recommended by Firebase Test Lab when you use your own results bucket:

```bash
gcloud projects add-iam-policy-binding "YOUR_GCP_PROJECT_ID" \
  --member "serviceAccount:github-android-ci@YOUR_GCP_PROJECT_ID.iam.gserviceaccount.com" \
  --role "roles/cloudtestservice.testAdmin"

gcloud projects add-iam-policy-binding "YOUR_GCP_PROJECT_ID" \
  --member "serviceAccount:github-android-ci@YOUR_GCP_PROJECT_ID.iam.gserviceaccount.com" \
  --role "roles/firebase.analyticsViewer"
```

Grant bucket access scoped to the dedicated results bucket:

```bash
gcloud storage buckets add-iam-policy-binding "gs://flashcards-open-source-app-test-lab-results" \
  --member "serviceAccount:github-android-ci@YOUR_GCP_PROJECT_ID.iam.gserviceaccount.com" \
  --role "roles/storage.admin"
```

### 4. Create Workload Identity Federation for GitHub Actions

Create the pool:

```bash
gcloud iam workload-identity-pools create "github" \
  --project "YOUR_GCP_PROJECT_ID" \
  --location "global" \
  --display-name "GitHub Actions"
```

Create the provider:

```bash
gcloud iam workload-identity-pools providers create-oidc "flashcards-open-source-app" \
  --project "YOUR_GCP_PROJECT_ID" \
  --location "global" \
  --workload-identity-pool "github" \
  --display-name "flashcards-open-source-app GitHub" \
  --issuer-uri "https://token.actions.githubusercontent.com" \
  --attribute-mapping "google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
  --attribute-condition "assertion.repository == 'kirill-markin/flashcards-open-source-app'"
```

Allow the repository to impersonate the service account:

```bash
gcloud iam service-accounts add-iam-policy-binding \
  "github-android-ci@YOUR_GCP_PROJECT_ID.iam.gserviceaccount.com" \
  --project "YOUR_GCP_PROJECT_ID" \
  --role "roles/iam.workloadIdentityUser" \
  --member "principalSet://iam.googleapis.com/projects/YOUR_PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/kirill-markin/flashcards-open-source-app"
```

The GitHub variable `GCP_WORKLOAD_IDENTITY_PROVIDER` must use this format:

```text
projects/YOUR_PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/flashcards-open-source-app
```

### 5. Create a dedicated Google Play release service account

Create a second service account for Google Play uploads:

```bash
gcloud iam service-accounts create "github-android-play" \
  --project "YOUR_GCP_PROJECT_ID" \
  --display-name "GitHub Android Play Release"
```

You do not need broad Google Cloud project roles for the Play upload itself. The release workflow authenticates as this service account through Workload Identity Federation, and the actual app release permissions are granted in Play Console.

Allow the repository to impersonate the service account:

```bash
gcloud iam service-accounts add-iam-policy-binding \
  "github-android-play@YOUR_GCP_PROJECT_ID.iam.gserviceaccount.com" \
  --project "YOUR_GCP_PROJECT_ID" \
  --role "roles/iam.workloadIdentityUser" \
  --member "principalSet://iam.googleapis.com/projects/YOUR_PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/kirill-markin/flashcards-open-source-app"
```

### 6. Enable the Google Play Developer API

Enable the Android Publisher API in the same Google Cloud project:

```bash
gcloud services enable androidpublisher.googleapis.com \
  --project "YOUR_GCP_PROJECT_ID"
```

### 7. Choose the Firebase Test Lab device

This repository intentionally tests Android 16 / API 36 only.

Before setting the GitHub variables, list supported Test Lab devices for your project and choose a device that supports API 36:

```bash
gcloud firebase test android models list --project "YOUR_GCP_PROJECT_ID"
```

Then set:

- `ANDROID_FTL_DEVICE_MODEL`
- `ANDROID_FTL_DEVICE_VERSION`

## GitHub repository variables

Set the required repository variables listed above before expecting the Firebase Test Lab job to run in GitHub Actions.

Set the Google Play release variables and secrets before expecting `.github/workflows/android-release.yml` to upload a draft release successfully.

`ANDROID_PLAY_PACKAGE_NAME` should match the Android `applicationId`. In this repository that value is `com.flashcardsopensourceapp.app`.

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
3. Publish the release manually from Play Console when translation review is complete.

## Cloud Build trigger setup

Cloud Build is optional here, but useful if you want a Google-native trigger in the Google Cloud console in addition to GitHub Actions.

### 1. Connect the GitHub repository to Cloud Build

- In Google Cloud console, open Cloud Build
- Connect the GitHub repository
- Create a trigger that uses `cloudbuild.android.yaml`

### 2. Use a dedicated Cloud Build service account

For Cloud Build triggers, use a dedicated service account instead of the legacy default account and grant it the same permissions as the GitHub Actions service account:

- `roles/cloudtestservice.testAdmin`
- `roles/firebase.analyticsViewer`
- `roles/storage.admin` on the dedicated results bucket

### 3. Configure trigger substitutions

Set these substitutions on the trigger:

- `_ANDROID_FTL_DEVICE_MODEL`
- `_ANDROID_FTL_DEVICE_VERSION`
- `_ANDROID_FTL_RESULTS_BUCKET`
- `_ANDROID_FTL_RESULTS_DIR`

## Local Testing Rules

For Android, follow [apps/android/README.md](../apps/android/README.md) for platform targets and testing focus. Tests should be run only against the final supported Android target, not against older API levels.
Run Android local tests only sequentially on the local machine. Do not run Android local tests in parallel.
Before running Android tests, also check which Android emulators are available locally. If a local emulator is available, start it in the background without a visible emulator window by default and preserve the usual test artifacts, logs, screenshots, and reports. Open a visible Android emulator only when the user explicitly asks for it at that time.
For local instrumentation runs, prefer one clean emulator only:

- stop all running Android emulators before the run
- verify `adb devices` shows only one target emulator before starting Gradle
- prefer a clean rebuild and one clean test run when validating a local fix
- do not reuse a second emulator or a half-failed prior emulator session for the same verification pass

## Local parity commands

Build the same artifacts CI expects:

```bash
bash scripts/run-android-ci.sh
```

Run the retained Android FSRS parity test against the shared vectors:

```bash
cd apps/android && ./gradlew --no-daemon :data:local:testDebugUnitTest --tests com.flashcardsopensourceapp.data.local.model.FsrsSchedulerParityTest
```

Build the signed release bundle with the same inputs that the release workflow uses:

```bash
bash scripts/run-android-release.sh \
  --version-code "12345" \
  --keystore-path "/absolute/path/to/upload-key.jks" \
  --keystore-password "YOUR_KEYSTORE_PASSWORD" \
  --key-alias "YOUR_KEY_ALIAS" \
  --key-password "YOUR_KEY_PASSWORD"
```

Run one app instrumentation class on a local emulator for ad hoc debugging (requires a running emulator via `adb devices`):

```bash
adb devices
cd apps/android && ./gradlew clean :app:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.flashcardsopensourceapp.app.LiveSmokeTest
```

Note: `connectedDebugAndroidTest` does not support the `--tests` flag. Use `-Pandroid.testInstrumentationRunnerArguments.class=` to filter by test class.

Run another app instrumentation class on a local emulator:

```bash
adb devices
cd apps/android && ./gradlew clean :app:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.flashcardsopensourceapp.app.NotificationTapSmokeTest
```

Run the full app instrumentation package in Firebase Test Lab directly after authenticating with `gcloud`:

```bash
bash scripts/run-android-firebase-test-lab.sh \
  --project-id "YOUR_GCP_PROJECT_ID" \
  --device-model "YOUR_DEVICE_MODEL" \
  --device-version "36" \
  --app-path "apps/android/app/build/outputs/apk/debug/app-debug.apk" \
  --test-path "apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk" \
  --timeout "30m" \
  --max-matrix-duration "35m" \
  --test-targets "package com.flashcardsopensourceapp.app notAnnotation com.flashcardsopensourceapp.app.ManualOnlyAndroidTest" \
  --results-bucket "gs://flashcards-open-source-app-test-lab-results" \
  --results-dir "manual/local"
```

Keep `--max-matrix-duration` slightly above `--timeout` so Test Lab still has room to finish device startup and final matrix reporting cleanly. This matters more when Orchestrator is enabled because it adds per-test process startup overhead.
