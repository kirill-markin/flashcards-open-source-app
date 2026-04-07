# Xcode Cloud Data Access

This guide explains how to connect to Xcode Cloud data for this repository, which data formats Apple returns, which artifacts are useful, and how to extract actionable timing insights from cloud test runs.

Use this guide when you need to inspect cloud-native iOS test runs directly instead of relying only on the Xcode Cloud web UI.

## When to use this

Use this workflow when you need one of these:

- the latest Xcode Cloud run number, status, commit, or timestamps
- the test action inside a run and its per-test durations
- the artifact list for a test action
- the raw `xcodebuild` log from cloud
- the `.xcresult` bundle from cloud
- exact timestamps for a test case or for our custom smoke breadcrumbs inside the cloud log

## Required local secrets

The local root `.env` can contain the App Store Connect credentials needed for direct Xcode Cloud access.

Expected variables:

- `APP_STORE_CONNECT_KEY_KIND`
- `APP_STORE_CONNECT_KEY_ID`
- `APP_STORE_CONNECT_PRIVATE_KEY_PATH`
- `APP_STORE_CONNECT_APP_ID`
- `APP_STORE_CONNECT_DEFAULT_WORKFLOW_ID`

Conditional variable:

- `APP_STORE_CONNECT_ISSUER_ID`

Rules:

- for `APP_STORE_CONNECT_KEY_KIND=individual`, use JWT payload `sub=user`
- for team keys, use JWT payload `iss=<issuer-id>` and keep `APP_STORE_CONNECT_ISSUER_ID` populated
- never print the private key contents or the full bearer token
- never commit the `.p8` key or local `.env`

If these values are missing locally, stop and ask the user to create or provide them. Do not guess secret values and do not invent placeholder paths as if they were real.

## Data model overview

Apple exposes Xcode Cloud data through App Store Connect API resources plus downloadable artifacts.

Main resource chain:

1. `app`
2. `ciProduct`
3. `ciBuildRun`
4. `ciBuildAction`
5. `ciTestResults`
6. `ciArtifacts`

Useful relationships:

- `GET /v1/apps/{appId}/ciProduct`
- `GET /v1/ciProducts/{ciProductId}/buildRuns`
- `GET /v1/ciBuildRuns/{runId}`
- `GET /v1/ciBuildRuns/{runId}/actions`
- `GET /v1/ciBuildActions/{actionId}`
- `GET /v1/ciBuildActions/{actionId}/testResults`
- `GET /v1/ciBuildActions/{actionId}/artifacts`

Important detail:

- Apple does not allow collection `GET` on `/v1/ciBuildRuns`
- list build runs through the relationship endpoint on `ciProduct`

Dates are returned as ISO-8601 UTC timestamps.

## Artifact types

The most useful artifact types for cloud test investigations are:

- `LOG_BUNDLE`: zipped plain-text `xcodebuild` logs
- `RESULT_BUNDLE`: zipped `.xcresult` bundle or related result/crash bundle
- `TEST_PRODUCTS`: zipped built test products

Practical meaning:

- `testResults` API is good for quick status and duration
- `LOG_BUNDLE` is good for precise wall-clock timestamps and stderr/stdout breadcrumbs
- `.xcresult` is the deepest source for screenshots, attachments, summaries, and richer XCTest result structure

Download URLs in `ciArtifacts.attributes.downloadUrl` are temporary pre-signed Apple URLs. Use them directly, but do not store them in docs, code, or git.

## Repository-specific insight source

This repository already emits structured smoke breadcrumbs from the iOS UI test suite:

- grouped smoke entrypoints: [`apps/ios/Flashcards/FlashcardsUITests/LiveSmokeAiTests.swift`](/Users/kirill/_my_local/code-local/personal-workspace/flashcards-open-source-app/apps/ios/Flashcards/FlashcardsUITests/LiveSmokeAiTests.swift), [`apps/ios/Flashcards/FlashcardsUITests/LiveSmokeCardsTests.swift`](/Users/kirill/_my_local/code-local/personal-workspace/flashcards-open-source-app/apps/ios/Flashcards/FlashcardsUITests/LiveSmokeCardsTests.swift), [`apps/ios/Flashcards/FlashcardsUITests/LiveSmokeReviewTests.swift`](/Users/kirill/_my_local/code-local/personal-workspace/flashcards-open-source-app/apps/ios/Flashcards/FlashcardsUITests/LiveSmokeReviewTests.swift), and [`apps/ios/Flashcards/FlashcardsUITests/LiveSmokeSettingsTests.swift`](/Users/kirill/_my_local/code-local/personal-workspace/flashcards-open-source-app/apps/ios/Flashcards/FlashcardsUITests/LiveSmokeSettingsTests.swift)
- shared smoke base: [`apps/ios/Flashcards/FlashcardsUITests/LiveSmokeSupport/LiveSmokeTestCase.swift`](/Users/kirill/_my_local/code-local/personal-workspace/flashcards-open-source-app/apps/ios/Flashcards/FlashcardsUITests/LiveSmokeSupport/LiveSmokeTestCase.swift)
- breadcrumb logger and screen diagnostics: [`apps/ios/Flashcards/FlashcardsUITests/LiveSmokeSupport/LiveSmokeDiagnostics.swift`](/Users/kirill/_my_local/code-local/personal-workspace/flashcards-open-source-app/apps/ios/Flashcards/FlashcardsUITests/LiveSmokeSupport/LiveSmokeDiagnostics.swift)

Those breadcrumbs appear in the cloud `xcodebuild` log as JSON lines under the `ios_ui_smoke` domain. That is the fastest way to recover exact per-step timestamps without opening the Xcode Cloud UI manually.

## Token generation

Example: generate an App Store Connect bearer token from local `.env`.

```bash
TOKEN="$(
python3 - <<'PY'
import os
import time
from pathlib import Path

import jwt

for line in Path('.env').read_text().splitlines():
    line = line.strip()
    if not line or line.startswith('#') or '=' not in line:
        continue
    key, value = line.split('=', 1)
    os.environ.setdefault(key, value)

now = int(time.time())
payload = {
    "sub": "user",
    "aud": "appstoreconnect-v1",
    "iat": now,
    "exp": now + 600,
}

if os.environ.get("APP_STORE_CONNECT_KEY_KIND") == "team":
    payload.pop("sub")
    payload["iss"] = os.environ["APP_STORE_CONNECT_ISSUER_ID"]

print(
    jwt.encode(
        payload,
        Path(os.environ["APP_STORE_CONNECT_PRIVATE_KEY_PATH"]).read_text(),
        algorithm="ES256",
        headers={
            "kid": os.environ["APP_STORE_CONNECT_KEY_ID"],
            "typ": "JWT",
        },
    )
)
PY
)"
```

## Connection workflow

### 1. Resolve the CI product

```bash
curl -sS \
  -H "Authorization: Bearer $TOKEN" \
  "https://api.appstoreconnect.apple.com/v1/apps/$APP_STORE_CONNECT_APP_ID/ciProduct" \
  | jq
```

Look for:

- `data.id`: the `ciProductId`

### 2. List recent build runs

```bash
CI_PRODUCT_ID="<from previous step>"

curl -sS \
  -H "Authorization: Bearer $TOKEN" \
  "https://api.appstoreconnect.apple.com/v1/ciProducts/$CI_PRODUCT_ID/buildRuns?limit=10&sort=-number" \
  | jq
```

Look for:

- `data[].id`
- `data[].attributes.number`
- `data[].attributes.createdDate`
- `data[].attributes.startedDate`
- `data[].attributes.finishedDate`
- `data[].attributes.completionStatus`
- `data[].attributes.sourceCommit.commitSha`

### 3. Inspect actions inside a run

```bash
RUN_ID="<build run id>"

curl -sS \
  -H "Authorization: Bearer $TOKEN" \
  "https://api.appstoreconnect.apple.com/v1/ciBuildRuns/$RUN_ID/actions" \
  | jq
```

Look for:

- `actionType`
- `name`
- `startedDate`
- `finishedDate`
- `completionStatus`

Common action types:

- `TEST`
- `ARCHIVE`

### 4. Fetch per-test results for a test action

```bash
TEST_ACTION_ID="<ciBuildAction id for the TEST action>"

curl -sS \
  -H "Authorization: Bearer $TOKEN" \
  "https://api.appstoreconnect.apple.com/v1/ciBuildActions/$TEST_ACTION_ID/testResults?limit=200" \
  | jq
```

Useful fields:

- `data[].attributes.name`
- `data[].attributes.className`
- `data[].attributes.status`
- `data[].attributes.destinationTestResults[].deviceName`
- `data[].attributes.destinationTestResults[].osVersion`
- `data[].attributes.destinationTestResults[].duration`

Typical shape:

```json
{
  "id": "28754783-de2c-3e84-b705-349b5d149c3c",
  "type": "ciTestResults",
  "attributes": {
    "name": "testLiveSmokeManualCardCreationFlow()",
    "className": "LiveSmokeCardsTests",
    "status": "SUCCESS",
    "destinationTestResults": [
      {
        "deviceName": "iPhone 17 Pro",
        "osVersion": "26.4",
        "status": "SUCCESS",
        "duration": 592.1815130710602
      }
    ]
  }
}
```

### 5. Fetch artifacts for a test action

```bash
curl -sS \
  -H "Authorization: Bearer $TOKEN" \
  "https://api.appstoreconnect.apple.com/v1/ciBuildActions/$TEST_ACTION_ID/artifacts" \
  | jq
```

Useful fields:

- `data[].attributes.fileType`
- `data[].attributes.fileName`
- `data[].attributes.fileSize`
- `data[].attributes.downloadUrl`

Typical shape:

```json
{
  "id": "8dbaedb1-6c96-45b0-a65c-941b5174f114",
  "type": "ciArtifacts",
  "attributes": {
    "fileType": "RESULT_BUNDLE",
    "fileName": "Flashcards Open Source App Build 129 XCResult for Flashcards Open Source App test-without-building on iPhone 17 Pro (default runtime).xcresult.zip",
    "fileSize": 337030640,
    "downloadUrl": "https://..."
  }
}
```

## Pulling useful artifacts locally

### Download the log bundle

```bash
LOG_URL="<downloadUrl for the test-without-building LOG_BUNDLE>"
mkdir -p /tmp/xcode-cloud
curl -L --fail --silent --show-error "$LOG_URL" -o /tmp/xcode-cloud/logs.zip
unzip -l /tmp/xcode-cloud/logs.zip
```

### Read the cloud `xcodebuild` log

```bash
unzip -p /tmp/xcode-cloud/logs.zip \
  'Flashcards Open Source App Build 128 Logs for Flashcards Open Source App test-without-building on iPhone 17 Pro (default runtime)/xcodebuild-test-without-building.log' \
  | rg -n 'Test Case|ios_ui_smoke|testLiveSmokeManualCardCreationFlow'
```

Use this when you need:

- exact test case start and finish timestamps
- raw stderr/stdout from XCTest
- repository-specific JSON breadcrumbs emitted by our smoke tests

### Download the `.xcresult` bundle

```bash
XCRESULT_URL="<downloadUrl for the test-without-building RESULT_BUNDLE>"
mkdir -p /tmp/xcode-cloud/xcresult
curl -L --fail --silent --show-error "$XCRESULT_URL" -o /tmp/xcode-cloud/xcresult/xcresult.zip
unzip -q /tmp/xcode-cloud/xcresult/xcresult.zip -d /tmp/xcode-cloud/xcresult
find /tmp/xcode-cloud/xcresult -name '*.xcresult'
```

### Inspect the `.xcresult` summary

```bash
XCRESULT_PATH="$(find /tmp/xcode-cloud/xcresult -name '*.xcresult' | head -n 1)"

xcrun xcresulttool get test-results summary \
  --path "$XCRESULT_PATH" \
  --compact \
  | jq
```

Use `.xcresult` when you need:

- test result summary in structured JSON
- screenshots and attachments for failures
- deeper XCTest result objects than the plain log exposes

## Finding a specific slow test

If the latest build run does not contain the test you care about, scan recent build runs in descending run number order and inspect only `TEST` actions.

Example shell pattern:

```bash
BASE='https://api.appstoreconnect.apple.com/v1'
CI_PRODUCT_ID="<ciProductId>"

curl -sS \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE/ciProducts/$CI_PRODUCT_ID/buildRuns?limit=10&sort=-number" \
  | jq -r '.data[] | [.id, .attributes.number] | @tsv'
```

Then for each `RUN_ID`:

```bash
curl -sS \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE/ciBuildRuns/$RUN_ID/actions" \
  | jq -r '.data[] | select(.attributes.actionType=="TEST") | [.id, .attributes.name, .attributes.completionStatus] | @tsv'
```

Then for each `TEST_ACTION_ID`:

```bash
curl -sS \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE/ciBuildActions/$TEST_ACTION_ID/testResults?limit=200" \
  | jq -r '.data[] | [.attributes.name, .attributes.status, (.attributes.destinationTestResults[0].duration // 0)] | @tsv'
```

## How to extract insights

Quick heuristics:

- if `testResults` shows a long duration but the explicit waits in the log are short, suspect XCUITest overhead or expensive diagnostics
- if the `LOG_BUNDLE` contains repeated `Checking existence of ...` lines around custom logging, suspect instrumentation overhead
- if cloud action duration is much larger than the sum of per-test durations, inspect build setup, app launch, and simulator idle time
- if the API-level test result is not enough, move immediately to `LOG_BUNDLE` or `.xcresult`

For this repository specifically:

- our smoke logs include exact breadcrumb timestamps
- those breadcrumbs let you reconstruct per-step timing without opening Xcode UI
- `currentScreenSummary()` checks multiple screen root identifiers, so frequent breadcrumb logging can itself add measurable UI-test overhead

## Recommended investigation order

1. Confirm credentials exist in local `.env`
2. Generate a bearer token
3. Resolve `ciProduct`
4. Find the relevant recent `ciBuildRun`
5. Open its `TEST` action
6. Read `testResults` for quick status and durations
7. Download `LOG_BUNDLE` for exact timestamps and smoke breadcrumbs
8. Download `.xcresult` only when you need attachments, screenshots, or deeper XCTest structure

## Sources

- [App Store Connect API](https://developer.apple.com/documentation/appstoreconnectapi)
- [Generating Tokens for API Requests](https://developer.apple.com/documentation/appstoreconnectapi/generating_tokens_for_api_requests)
