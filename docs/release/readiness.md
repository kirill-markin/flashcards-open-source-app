# Recorded Mobile Readiness

Before a new iOS/Android submission/publication, use this read-only, offline command
alongside the [platform procedures](README.md#required-reading). It compares
recorded identities and named results; it does not collect evidence or contact
Apple, Device Run, Google Play, GitHub, or a device.

```bash
node scripts/release/check-mobile-readiness.mjs /absolute/release-record/mobile-manifest.json \
  > /absolute/release-record/mobile-readiness.json
```

Use Node 24. Exit `0` means all supplied platform build/test gate records satisfy
the contract; `1` means missing or failing evidence, with a JSON report; `2`
means unreadable, malformed, or invalid input, with a field-path error on stderr.
Do not interpret an empty output after exit `2` as readiness. Additional fields
are ignored. The command never writes to stores, the source checkout, or the
input file, and reads only the named manifest.

`ready: true` is limited to `recorded-mobile-build-and-test-gates`. It does not
establish release authorization, truthful/comprehensive exports, source-diff
correctness, security, artifact authenticity, operator completion, or public
availability. Inspect native diagnostics, signing, store processing, uploaded
binary localizations, metadata, release settings, submission and publication
under the existing procedures. All gates required by the platform's recorded
contract remain mandatory for a CLI pass. Use the [input contract](#input-contract)
for new and retained manifests. Already-published artifacts follow the
[historical reuse rule](evidence.md#reuse-existing-artifacts).

## Standing-policy publication boundary

The [standing best-effort policy](README.md#standing-best-effort-release-policy)
does not change this CLI, its schemas, required inventories or exit codes.
Preserve failed/skipped/missing native evidence and the resulting blocked report;
never manufacture a passing gate or relabel historical records. Publication
with unavailable testing requires the separately retained operator readiness decision and remaining platform gates under that policy.
Publication with an Apple local gate passed under [targeted recovery](evidence.md#targeted-recovery)
requires its recovery record, operator readiness decision and remaining platform gates.

## macOS Readiness Boundary

This CLI accepts only `ios` and `android`; no supported schema accepts macOS. Do not relabel Mac as iOS, add Mac gates to a mobile schema, or manufacture
a passing report. Keep a separate Mac readiness manifest and dated operator
inspection decision under the [Mac evidence contract](evidence.md#macos-evidence)
and [Mac procedure](macos.md). This is manually inspected readiness evidence,
not CLI-validated readiness; refresh the decision when source, artifact,
selected attempt or evidence changes.

## Generate the Android manifest

For a green `Android Release`, use the routine offline generator from the
repository root. Retain the exact attempt's signed AAB
(`android-release-bundle-r<runId>a<attempt>`, legacy `android-release-bundle`),
[Device Run summary and private evidence](../android-ci-cd.md#device-run-results-and-release-correlation),
`play-publisher-provenance.json` and, for runs with the Wear OS upload job,
`play-wear-publisher-provenance.json` (artifact `android-wear-play-publisher-provenance`).
Verify artifact IDs/attempt and pin the SHA, version, phone and Wear OS codes and
both bundle checksums from the release/build records. Retain
the signed-binary, warning and native diagnostics inspections required by the
[Android procedure](android.md). Use a fresh output path for each attempt
or review revision. Save the attempt-specific job record:

```bash
gh run view "$run_id" --attempt "$attempt" --json databaseId,attempt,status,conclusion,headSha,url,jobs \
  > "$record/github-run.json" &&
node scripts/release/assemble-android-readiness.mjs "$record/review.json" "$record/github-run.json" \
  "$record/summary.json" "$record/play-publisher-provenance.json" "$record/app-release.aab" \
  "$record/play-wear-publisher-provenance.json" \
  > "$record/mobile-manifest.json" &&
node scripts/release/check-mobile-readiness.mjs "$record/mobile-manifest.json" > "$record/mobile-readiness.json"
```

In `review.json`, supply string fields `sourceSha`, `version`, `versionCode`,
`runId`, `attempt`, `aabSha256`, and `reviewedBy`, plus `wearVersionCode` and
`wearAabSha256` for runs with the Wear OS upload job (omit the last argument
otherwise). Set `devices` to the
verified configured catalog IDs keyed by API: `37` and `30` for the current
selection, and `37`, `30`, `31`, `33` for the pinned historical selection.
Under `reviews`, give `cloud-release` and `firebase-tests` their own `inventoryRef`,
`evidenceRef`, `warningReview`, `warningReviewRef` and `warnings`. Use the
[warning fields](#results-and-warning-review) below. Set review complete
only after inspecting the logs and adjudicating notices. An empty warnings
array records a completed inspection only with that explicit decision.
References resolve within the private release record.

The generator reads the release version and test selection from the pinned Git
source. Current Device Run selection/evidence version 2 requires API 37
(`latest`, five cases), then API 30 (`compat-api30`, one case). In
`summary.json`, `configured_device` must match the API's pin in
`review.json.devices`. The effective `device` may differ only with valid
retry evidence. Retain `initial_failure` with the original report and hash,
classification reason, APK hashes and alternate catalog reference and hash
when applicable. Follow the [Device Run evidence procedure](../android-ci-cd.md#device-run-results-and-release-correlation).
The pinned historical selection still requires the full latest inventory
and all four selected methods on each of API 30, 31 and 33. Both selections
generate readiness schema 2 with the same gate IDs.

Keep source and artifact provenance, the retained native attempts and review
records alongside the output. For a failed/missing gate or
[exact-bundle upload recovery](android.md#exact-bundle-upload-recovery), build
the schema-2 record manually using the contract below. iOS and historical
records use their original native evidence paths and schemas.

## Collect and correlate evidence

1. Record the target source SHA, marketing version, distribution build/version
   code, and uploaded build ID or signed AAB checksum. Pin the original archive
   source separately from a corrected test source. Collect each required local
   preflight, cloud run/action/attempt, archive/upload, and Device Run session
   identity from its actual source; record local runs' SHAs under
   [source snapshots](evidence.md#source-snapshots). Use the [iOS](ios.md) and [Android](android.md) procedures and the
   [Xcode Cloud evidence guide](../xcode-cloud-data-access.md). Do not dispatch
   or publish just to fill in this file.
2. Establish the complete configured test inventory independently of passing
   results, at the source used by that gate (for local runs, its recorded
   [source snapshot](evidence.md#source-snapshots)). Save the scheme/test plan or
   Gradle/instrumentation selection, source test declarations, selected devices,
   configurations and any exclusions in the release record. Include all selected
   cases and destinations, including failing, manually excluded and
   platform-guarded cases when the schema permits them. Follow the recorded
   [iOS plan contract](#ios-critical-release-schema-5) or
   [Android selection](#generate-the-android-manifest). Retained schema-1 iOS
   records include the original local smoke and full selected Cloud UI suite.
   Retained schema-1 Android records also include the selected local CI and
   smoke cases.
   Account for inherited/parameterized tests and filters. A source grep
   alone is insufficient when configuration changes discovery.
3. Review that inventory and set `inventoryComplete: true` only when complete.
   The checker requires a nonempty required inventory on every test gate,
   source/configuration provenance and a named reviewer. It rejects duplicate,
   missing and unexpected case identities. It cannot independently detect an
   operator who cherry-picks both inventory and results; full inventory review
   is a manual gate. Never build the expected inventory by filtering green
   results or omitting skips.
4. Normalize the complete actual named results to the contract below. Keep
   every destination/configuration distinct in `id`. For Apple, use actual
   `ciTestResults` per-destination statuses and/or named native `.xcresult`
   results; map `SUCCESS` to `passed`, `FAILURE` to `failed`, `SKIPPED` to
   `skipped`. For Device Run use the full reports and GCS JUnit case exports
   for all sessions required by the pinned selection. Use native reports for
   local tests. Map unfinished cases to `pending` and preserve exact skip
   reasons. Unknown, inconclusive and cancelled states cannot pass. Reconcile case exports with
   native counts and all pages. A green workflow summary cannot override a
   failed case or a failed action: record the actual gate/action status.
5. Record each attempt as its own native attempt with its actual results.
   Preserve earlier failures and their resolution in the record; never collapse a
   failed destination into a passing one or mix unrelated runs. An iOS local
   gate recovered from several attempts follows the [recovery record and blocked
   report rules](evidence.md#targeted-recovery). Record evidence
   references that resolve to retained native exports, action status, full
   logs, artifact metadata, configuration and source comparisons. Inspect logs
   and adjudicate every notice under the [warning policy](README.md#release-warning-policy).
6. Run the command, resolve invalid input and actionable errors, and rerun after evidence changes. Preserve a blocked report for unavailable testing under the standing policy.
   Keep the manifest and report together with the [ledger](evidence.md#release-ledger).
   Verify the manual gates separately before the authorized action.

## Input contract

The runtime-validated contract and checks live in
[`mobile-readiness.ts`](../../scripts/release/mobile-readiness.ts). Supply one
JSON object per platform. Use schema 5 for new iOS and schema 2 for new Android
records. Retained records keep the schema, gates and source selection under
which they ran, including all original failures. Keep Android local diagnostic
results in the ledger outside schema 2's gate arrays.

| Field | Required value |
| --- | --- |
| `schemaVersion` | Integer `5` (iOS), `2` (Android), `3` or `4` (historical iOS), or `1` (historical iOS/Android) |
| `platform` | `ios` or `android` |
| `target` | `{sourceSha, version, build, artifactId}` for the intended release |
| `gates` | Exactly the platform's mandatory gate definitions below |
| `results` | Recorded gate results; an absent result fails readiness |
| `equivalences` | Explicit bounded source comparisons, or `[]` |

All SHAs are full lowercase 40-character Git commit IDs. Identifiers and
references are nonempty strings (numbers such as builds must be strings), up
to 2000 characters, using letters, numbers, spaces, `. _ / ( ) @ + -` and
starting with a letter or number. Reference values are opaque keys into the
operator's release record, not URLs: e.g. `ios/cloud/606/test-results.json`.
Do not include signed download URLs, query strings, credentials, environment
dumps, screenshots, or full logs in the input. Free text fields contain only
the requested notice/reason, never log dumps. Keep the native evidence private
and retain a reference to it. The checker does not fetch or resolve references.

| Platform / schema | Mandatory gate IDs | Gate inventories that must contain required cases |
| --- | --- | --- |
| iOS / 5 | `local-archive`, `local-iphone-critical`, `local-ipad-critical`, `local-ios18-critical`, `cloud-archive` | `local-iphone-critical`, `local-ipad-critical`, `local-ios18-critical` |
| Historical iOS / 4 | `local-archive`, `local-full`, `local-ipad`, `local-ios18`, `cloud-archive` | `local-full`, `local-ipad`, `local-ios18` |
| Historical iOS / 3 | `local-archive`, `local-full`, `local-ipad`, `local-ios18`, `cloud-archive`, `cloud-smoke` | `local-full`, `local-ipad`, `local-ios18`, `cloud-smoke` |
| Historical iOS / 1 | `local-archive`, `local-smoke`, `cloud-archive`, `cloud-tests` | `local-smoke`, `cloud-tests` |
| Android / 2 | `cloud-release`, `firebase-tests` | `firebase-tests` |
| Historical Android / 1 | `local-ci`, `local-release`, `local-smoke`, `cloud-release`, `firebase-tests` | `local-ci`, `local-smoke`, `firebase-tests` |

## iOS Critical Release Schema 5

Use the exact [critical plan selections](../ios-local-setup.md#local-native-acceptance).
`LocalIPhoneCritical` requires its four UI and two non-UI methods.
`LocalIPadCritical` and `IOS18Critical` each require their one UI method.
The two latest destinations must share an iOS major above 18, with a latest
iPhone and a latest iPad respectively. The compatibility gate requires an
actual iPhone or iPad on 18.x. Establish latest-OS eligibility from the native
destination inventory. The CLI checks the recorded major and kind.

For schemas 3 through 5, record the `Flashcards Native Acceptance` scheme,
the exact `testPlan`, `Acceptance` test configuration and one actual
destination in each test gate's `selection`. Record the Debug build
configuration in native evidence. Build gates omit `selection` and have empty
`cases`. Substitute the recorded destination in this `local-iphone-critical`
example:

```json
{
  "scheme": "Flashcards Native Acceptance",
  "testPlan": "LocalIPhoneCritical",
  "configuration": "Acceptance",
  "destination": {
    "id": "actual-simulator-uuid",
    "model": "iPhone 17",
    "osVersion": "27.0",
    "kind": "iphone"
  }
}
```

Use the actual simulator, device or Cloud destination ID as the suffix of
every `Class/method()@destination-id` case ID in its gate. Every selected
case is `required` and carries its exact `target`
(`Flashcards Open Source App Tests` for non-UI or
`Flashcards Open Source App UI Tests` for UI). Keep any
plan exclusions in inventory provenance. A schema-5 case has this shape:

```json
{
  "target": "Flashcards Open Source App UI Tests",
  "id": "LiveSmokeCardsTests/testLiveSmokeCreateAndReviewCardAcrossRelaunch()@actual-simulator-uuid",
  "disposition": "required"
}
```

A CLI pass requires a result for every selected case, with all cases executed
and passed. Preserve original attempts and failure artifacts in the ledger.

<a id="ios-local-acceptance-schema-3"></a>
<a id="ios-local-acceptance-schema-4"></a>

### Historical iOS local acceptance (schemas 3 and 4)

Retain the pinned full `LocalFull` inventory (eligible UI and the existing
non-UI bundle) on one latest iPhone, the three `LocalIPad` methods on one
latest iPad, and the three `IOS18Compatibility` methods on one iOS 18.x
iPhone or iPad. Only `local-full` accepts non-UI cases. The iPhone and iPad
latest major must match and exceed 18. Schema 3 also requires the exact three
`CloudSmoke` cases on one actual Cloud iPhone on that major, with the recorded
Cloud catalog. Schema 4 has no Cloud test gate.

The CLI enforces the three base `LocalFull` UI methods and a nonempty non-UI
inventory. Establish its complete historical selection independently at the
pinned source and configuration before reading passing results. Reconcile
every case and native count before attesting `inventoryComplete`.

### Common gate fields and historical schema-1 example

Every gate retains the fields below. This schema-1 `cloud-tests` excerpt
shows a historical manual exclusion. Schemas 3 through 5 require the selection
and per-case target fields above and contain only required cases.

```json
{
  "id": "cloud-tests",
  "identity": {
    "sourceSha": "b61760e5434308fbb6f58721050190db32467055",
    "version": "1.30.0",
    "build": "606",
    "artifactId": "b448e500-9e29-417b-a266-ccb9a33ef3ea",
    "runId": "8642988b-031d-432d-be36-e0ea20dc9fbe"
  },
  "inventorySourceSha": "b61760e5434308fbb6f58721050190db32467055",
  "inventoryRef": "ios/cloud/606/scheme-and-source-inventory",
  "inventoryReviewedBy": "release-operator",
  "inventoryComplete": true,
  "cases": [
    {
      "id": "LiveSmokeSettingsTests/testLiveSmokeGuestNavigationFlow()@iPhone 17/iOS 27.0",
      "disposition": "required"
    },
    {
      "id": "MarketingScreenshotsTests/testGenerateMarketingScreenshots()@iPhone 17/iOS 27.0",
      "disposition": "manual-exclusion",
      "reason": "Test skipped - Manual iOS marketing screenshot tests run only from explicit wrapper scripts.",
      "evidenceRef": "apps/ios/docs/marketing-screenshots.md"
    }
  ]
}
```

This excerpt illustrates two entries; it is **not** a complete cloud inventory.
The gate's expected identity must be collected independently from the pinned
run/artifact, not copied from an unrelated result to silence a mismatch.
`inventorySourceSha` must match the gate source. Every gate's version must match
the target. `cloud-archive` on iOS or `cloud-release` on Android must match the
target distribution `build` and `artifactId`. Local artifacts and iOS test builds
have their own build/artifact/run identities; they need not equal the archive.

Android's `firebase-tests` and `cloud-release` share source SHA, version,
release version code (`build`) and GitHub run/attempt (`runId`). Use the debug
APK identity for `firebase-tests.artifactId` and the signed AAB identity for
`cloud-release.artifactId`. Record all sessions and executed named results
from the pinned selection in `firebase-tests`. Distinguish effective devices
in case IDs and reference the [complete native evidence](../android-ci-cd.md#device-run-results-and-release-correlation)
with proof that both APKs came from that run. Retain actual APK metadata
separately from the release version code. Sessions from a different run cannot
be approved with source equivalence. For [exact-bundle upload recovery](android.md#exact-bundle-upload-recovery),
retain the original gate identities and failed workflow, original passing
build/R8 and native evidence, and the separate successful publisher bound to
the same AAB hash and code.

Each result has `gateId`, the same five-field `identity`, `status`,
`evidenceRef`, `warningReview`, `warningReviewRef`, `warnings`, and `cases`:

```json
{
  "gateId": "cloud-tests",
  "identity": {
    "sourceSha": "b61760e5434308fbb6f58721050190db32467055",
    "version": "1.30.0",
    "build": "606",
    "artifactId": "b448e500-9e29-417b-a266-ccb9a33ef3ea",
    "runId": "8642988b-031d-432d-be36-e0ea20dc9fbe"
  },
  "status": "passed",
  "evidenceRef": "ios/cloud/606/native-results",
  "warningReview": "complete",
  "warningReviewRef": "ios/cloud/606/diagnostic-inspection",
  "warnings": [],
  "cases": [
    {
      "id": "LiveSmokeSettingsTests/testLiveSmokeGuestNavigationFlow()@iPhone 17/iOS 27.0",
      "status": "passed"
    }
  ]
}
```

Again, include the entire recorded case array, not just this example.
Gate and case status is `passed`, `failed`, `skipped`, or `pending`; only a
passed gate can be ready. Every required case must pass. Every declared case,
including manual and destination exclusions, must appear. A skipped case requires a nonempty
`reason` exactly matching its declared exclusion; investigation notes do
not authorize skipping a required smoke. Failed/pending cases always fail, even
if excluded. An excluded case that executes and passes is acceptable, subject
to the destination counterpart requirement below.

<a id="results-and-warning-review"></a>

`warningReview` is `complete` or `pending`; pending inspection blocks readiness.
Use an empty warnings array only after inspecting retained evidence and finding
no notices that require records under policy. Each warning record requires:

| Field | Meaning |
| --- | --- |
| `id` | Unique identifier within the gate |
| `decision` | `accepted`, `blocking`, or `unreviewed`; only accepted can pass |
| `notice` | Exact notice, without unrelated raw logs or secrets |
| `owner` | Identified dependency/toolchain/provider owner |
| `version` | Exact affected package/toolchain version |
| `reason` | Operator's explanation of the decision |
| `policyRef` | Reference to the applicable warning-policy evidence |
| `evidenceRef` | Retained inspection, affected-flow, provenance and assessment evidence |

Required fields do not prove that an exception qualifies. `accepted` records
operator adjudication under the canonical policy; it is not a waiver, security
assessment, vulnerability scan, or proof that a vendor-supported fix is absent.
The report carries reference/identity/decision fields; exact notice and reason
remain in the manifest bound by the report's `manifestSha256`.

### iOS cloud destination exclusions

For retained schema-1 iOS `cloud-tests`, the complete latest-OS suite can select both phone and iPad destinations while
individual methods explicitly guard their eligible device idiom. Preserve
these native skips as `skipped`; do not remove them, mark them passed or call
them manual marketing exclusions. Only iOS `cloud-tests` supports the additive
`destination-exclusion` disposition. Independently review the source guard,
configured destinations and native skip reason, then declare:

```json
{
  "id": "LiveSmokeIPadTests/testIPadReviewHardwareKeysRespectFilterAndRateCards()@iPhone 17/iOS 27.0",
  "disposition": "destination-exclusion",
  "reason": "Test skipped - This smoke requires an iPad hardware-key surface.",
  "evidenceRef": "ios/cloud/platform-guard-and-destination-review",
  "requiredCaseId": "LiveSmokeIPadTests/testIPadReviewHardwareKeysRespectFilterAndRateCards()@iPad Pro 13-inch M5/iOS 27.0"
}
```

Both IDs must use `Class/method()@destination`, naming the same logical test
on different destinations. The referenced case must be a `required` case in
this same gate, with an actual `passed` result from the same recorded run/action
identity. Missing, skipped, failed or pending counterparts block readiness;
manual exclusions and other destination exclusions cannot serve as counterparts.
The counterpart must pass even if the excluded destination unexpectedly executes
and passes. The checker validates this relationship and exact native skip reason;
the operator must establish that the source guard actually makes that destination
ineligible. It does not independently inspect source or destination eligibility.

For the historical 21-method phone/iPad selection, retain all 42 case/destination records:
two iPad-only methods have phone destination exclusions, one phone-only method
has an iPad destination exclusion, and each remains required on its eligible
destination. The two manual marketing methods remain separate manual exclusions
on each destination. Keep every native status and count, including any failures.
This historical disposition is exclusive to the schema-1 iOS `cloud-tests`
gate. Every eligible counterpart must execute and pass.

## Bounded source equivalence

A result identity must exactly match its expected gate identity; there is no
exception for wrong run, build, artifact, version, or recorded SHA. Local runs record their SHA under
[source snapshots](evidence.md#source-snapshots). If a gate's
expected source differs from the target source, require exactly one matching
`equivalences` entry for that gate:

```json
{
  "fromSha": "f8e786dc9db7e895a3188b2cd506c131bb52dff1",
  "toSha": "b61760e5434308fbb6f58721050190db32467055",
  "gateIds": ["cloud-archive"],
  "comparedInputs": ["apps/ios", "shared-dependencies", "lockfiles", "build-configuration", "cloud-workflow"],
  "reviewedBy": "release-operator",
  "reason": "Illustrative shape only. Record the actual comparison and why this gate remains applicable.",
  "evidenceRef": "source-comparisons/archive-to-corrected-tests"
}
```

This example is not equivalence evidence. Retain original archive source/run
and corrected test source/run. Under the [reuse rules](evidence.md#resume-and-artifact-reuse),
compare all relevant client, dependency, lockfile and build/workflow inputs,
record the exact diff and scope, and explain why every named gate remains valid.
Test-only changes may preserve the original archive while requiring corrected
tests. An equivalence never turns the old failed test into a pass. Code does
not inspect Git or validate that the stated comparison was sufficient; the
operator owns that review. No wildcard gate names or transitive SHA chains are
accepted; redundant/unrelated records fail.

## Report retention and manual CLI checks

Keep input and output outside tracked release history in the operator release
record, with the ledger pointing to both. Reports contain expected/recorded
identities, named pass/fail/skip/pending results, missing counts, warning and
exclusion evidence references and required counterpart IDs, bounded equivalences, limits, and the input
SHA-256 and the manifest's `schemaVersion`. Keep them with the referenced durable
native evidence; a temporary signed URL is not a durable reference. Reason/notice text and unrelated extra
input fields are not echoed. A report is only current for that exact manifest;
rerun when evidence, source, artifact, selected attempt, or adjudication changes.

Cloud PR CI discovers `check-release-readiness.mjs` automatically. It invokes
the real CLI over minimal secret-free captured 1.30.0 Xcode Cloud evidence:
run 606 has 16 passing cases and two manual marketing skips; run 603 has a green
overall run and 15 passes, one actual reset-workspace failure, and two manual
skips. Expected inventories were independently enumerated from the shared
scheme's UI sources at each recorded SHA, including both marketing methods.
The fixture keeps per-destination IDs/statuses, run/action/source identities and
raw-export hashes. It excludes raw diagnostic logs, credentials and URLs.
Other gates are deliberately missing: CI requires the successful cloud gate
to pass while the platform report stays blocked, and requires the historical
failed case to block despite the green overall summary. This checks the CLI
boundary against real captured cases; it is not a new live device run or proof
of the historical release's complete gates. The 1.33.0 fixture retains the complete
42-record run 614 matrix and independently reviewed platform guards. CI also
replays missing, skipped, failed and pending counterparts, wrong guard reasons,
missing native cases and invalid destination relationships; each must block
readiness or reject malformed input. Native evidence remains unchanged; boundary
mutations are made only to copies.

When changing the checker or diagnosing a manifest issue, use these focused
checks on copies in the private release record:

1. Run the command on complete passing evidence. Expect exit `0`, all gates
   ready and exact intended identities; retained schema-1 exclusions must report manual/destination skips distinctly.
   For a schema-1 destination exclusion, remove or skip/fail its eligible counterpart:
   expect exit `1`. Point it at another method, the same destination or a
   non-required case: expect exit `2`.
2. Use the actual failed run/action and all its named results with a matching
   expected identity/inventory. A green summary with the historical reset-case
   failure must return `1` and name that failure. Keep the earlier source
   separate or supply a valid bounded comparison; never rewrite its SHA.
3. Remove a required result case, then independently change one required pass
   to skipped with a reason. Expect exit `1` with a missing or unapproved-skip
   error. Remove a manual exclusion or change its reason: expect exit `1`.
4. Change only a recorded run, SHA, version, build, or artifact. Expect `1` and
   a precise identity-field mismatch. Change a gate source and inventory source
   together away from target: expect `1` without valid bounded equivalence.
5. For new Android evidence, use schema 2 with exactly `cloud-release` and
   `firebase-tests`; expect no missing local-gate errors. Keep the exact
   sessions and named inventories from the pinned source selection. Changing
   only the schema to 1 returns `2` for missing gate definitions. Removing a
   local result from a complete schema-1 Android record returns `1`.
   Schema 2 with `platform` set to `ios` returns `2`.
6. Mark inspection pending or a warning blocking/unreviewed: expect `1`.
   Remove a warning's policy/owner/version/reason/evidence: expect `2`. Remove
   a gate definition or empty a test inventory: expect `2`; remove a gate
   result: expect `1`.
7. For schema 5, change a plan, configuration or inventory case, switch a
   latest gate to the other device family, or use a major other than 18 on the
   compatibility gate. Each returns `2`, as does adding a Cloud test gate or
   setting `platform` to `android`. A required skip, identity mismatch or
   disagreement between otherwise valid latest OS majors returns `1`.
   Retained schema 4 also rejects a Cloud test gate or the Android platform.
   Schema 3 requires its Cloud plan and destination:
   removing that gate or changing only the schema on a five-gate record to 3
   returns `2`.
8. After any passing report, still follow the platform's manual/native/store
   verification and authorized submission/publication sequence. Never use a
   report to claim a submitted artifact is publicly live.
