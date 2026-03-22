# Android CI/CD

This repository uses a split Android pipeline:

- GitHub Actions is the primary CI entrypoint for pull requests and `main`
- Firebase Test Lab runs instrumentation tests on Google-managed devices
- `cloudbuild.android.yaml` is the Google-native entrypoint for Cloud Build triggers in the Google Cloud console

This setup keeps fast repository-native checks in GitHub while still using Google-managed device testing and avoiding long-lived Google service account keys.

## Required GitHub repository variables

The Android GitHub Actions workflow depends on these repository variables:

- `GCP_PROJECT_ID`
- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_SERVICE_ACCOUNT_EMAIL`
- `ANDROID_FTL_DEVICE_MODEL`
- `ANDROID_FTL_DEVICE_VERSION`
- `ANDROID_FTL_RESULTS_BUCKET`
- `ANDROID_FTL_RESULTS_DIR`

Push them to the repository with:

```bash
bash scripts/setup-github-android.sh
```

This Android-specific sync is separate from the AWS deploy sync script `bash scripts/setup-github.sh`.

## What runs

GitHub Actions workflow: `.github/workflows/android.yml`

- Builds `:app:assembleDebug`
- Builds `:app:assembleDebugAndroidTest`
- Runs `:app:lintDebug`
- Uploads the debug APK, Android test APK, and lint report as workflow artifacts
- Runs Firebase Test Lab instrumentation tests on `main` and on manual dispatch after Google Cloud auth is configured
- Skips the Firebase Test Lab job entirely until the required GitHub repository variables are present

Cloud Build config: `cloudbuild.android.yaml`

- Builds a dedicated Android CI container from `apps/android/ci/Dockerfile`
- Reuses the same shell scripts as GitHub Actions
- Can be attached to a Cloud Build trigger connected to the GitHub repository

## Recommended architecture

This is the current recommended shape for this repository:

- Use GitHub Actions as the default CI orchestrator because the repo already uses GitHub Actions for other services
- Use Workload Identity Federation for GitHub to Google Cloud authentication
- Do not store Google service account JSON keys in GitHub secrets
- Use Firebase Test Lab for instrumentation tests instead of self-hosted emulators
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

### 5. Choose the Firebase Test Lab device

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

## Local parity commands

Build the same artifacts CI expects:

```bash
bash scripts/run-android-ci.sh
```

Run Firebase Test Lab directly after authenticating with `gcloud`:

```bash
bash scripts/run-android-firebase-test-lab.sh \
  --project-id "YOUR_GCP_PROJECT_ID" \
  --device-model "YOUR_DEVICE_MODEL" \
  --device-version "36" \
  --app-path "apps/android/app/build/outputs/apk/debug/app-debug.apk" \
  --test-path "apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk" \
  --results-bucket "gs://flashcards-open-source-app-test-lab-results" \
  --results-dir "manual/local"
```
