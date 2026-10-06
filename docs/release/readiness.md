# Recorded Mobile Readiness

Before a new mobile submission/publication, use this read-only, offline command
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
contract, native checks and store procedure remain mandatory. New Android
records use schema 2's cloud-first gates; iOS retains its local and cloud gates.
Already-published artifacts follow the [historical reuse rule](evidence.md#reuse-existing-artifacts),
without reconstructing evidence merely to turn this report green.

## Collect and correlate evidence

1. Record the target source SHA, marketing version, distribution build/version
   code, and uploaded build ID or signed AAB checksum. Pin the original archive
   source separately from a corrected test source. Collect each required local
   preflight, cloud run/action/attempt, archive/upload, and Device Run session
   identity from its actual source. Use the [iOS](ios.md) and [Android](android.md) procedures and the
   [Xcode Cloud evidence guide](../xcode-cloud-data-access.md). Do not dispatch
   or publish just to fill in this file.
2. Establish the complete configured test inventory independently of passing
   results, at the source SHA used by that gate. Save the scheme/test plan or
   Gradle/instrumentation selection, source test declarations, selected devices,
   configurations and any exclusions in the release record. Include all selected
   cases and destinations, including failing and manually excluded cases. For
   local iOS smoke, include the guest-navigation selection or all three
   compatibility smokes when that local selection satisfies the actual 18.x
   requirement; cloud iOS includes the entire selected UI suite. Android
   Device Run includes its entire configured selection. Retained schema-1
   Android records also include their selected local CI and smoke cases.
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
   `skipped`. For Device Run use all four exact sessions' full reports and GCS JUnit case
   exports, including every configured device and execution; use native reports for local tests. Map
   unfinished cases to `pending`; do not map unknown/inconclusive/cancelled
   states to passed. Preserve exact skip reasons. Reconcile case exports with
   native counts and all pages. A green workflow summary cannot override a
   failed case or a failed action: record the actual gate/action status.
5. Normalize each retry as an explicitly selected complete attempt. Preserve
   earlier failures and their resolution in the record; never collapse a
   failed destination into a passing one or mix unrelated runs. Record evidence
   references that resolve to retained native exports, action status, full
   logs, artifact metadata, configuration and source comparisons. Inspect logs
   and adjudicate every notice under the [warning policy](README.md#release-warning-policy).
6. Run the command, resolve each error, and rerun after evidence changes.
   Keep the manifest and report together with the [ledger](evidence.md#release-ledger).
   Verify the manual gates separately before the authorized action.

## Input contract

The runtime-validated contract and checks live in
[`mobile-readiness.ts`](../../scripts/release/mobile-readiness.ts). Supply one
JSON object per platform. Use schema 1 for iOS and schema 2 for new Android
records. Schema 1 remains supported with its original gates for retained
historical records; do not relabel retained evidence to change its contract.
Schema 2 is Android-only and changes only the mandatory gate set. Field shapes,
native inventory, identity correlation, diagnostics and warning checks remain
the same. Keep supplementary Android local diagnostic results in the ledger,
outside schema 2's mandatory gate arrays.

| Field | Required value |
| --- | --- |
| `schemaVersion` | Integer `1` (iOS or retained historical Android) or `2` (new Android) |
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
| iOS / 1 | `local-archive`, `local-smoke`, `cloud-archive`, `cloud-tests` | `local-smoke`, `cloud-tests` |
| Android / 2 | `cloud-release`, `firebase-tests` | `firebase-tests` |
| Historical Android / 1 | `local-ci`, `local-release`, `local-smoke`, `cloud-release`, `firebase-tests` | `local-ci`, `local-smoke`, `firebase-tests` |

Build-only gate inventories are empty. Each gate object has:

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

For Android, the checker retains the stable gate ID `firebase-tests`; it records
all four Device Run sessions under the [Android procedure](android.md). It and `cloud-release` must share source SHA, version, release
version code (`build`), and GitHub run/attempt (`runId`). The test gate's
`artifactId` identifies the tested debug APK; `cloud-release.artifactId` identifies
the signed production AAB. Put all four exact session IDs, job/execution identities,
labels, full reports and GCS named-case evidence in the record referenced by
`evidenceRef`, and retain proof that its debug APK and test APK came from that
GitHub run. Include the latest full inventory and all four smoke methods on
API 30, 31 and 33 in this one gate, keeping device/session identities distinct
in case IDs. The build field is the assigned release version code used for
correlation; retain actual APK metadata separately. Sessions from a different
run cannot be approved with source equivalence. Submission acceptance is not a
passing gate; normalize terminal reports and actual executed, non-skipped cases.

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
including manual exclusions, must appear. A skipped case requires a nonempty
`reason` exactly matching its declared manual exclusion; investigation notes do
not authorize skipping a required smoke. Failed/pending cases always fail, even
if manually excluded. An excluded case that executes and passes is acceptable.

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

## Bounded source equivalence

A result identity must exactly match its expected gate identity; there is no
exception for wrong run, build, artifact, version, or recorded SHA. If a gate's
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
exclusion evidence references, bounded equivalences, limits, and the input
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
of the historical release's complete gates.

For an operator's complete real manifest, perform these focused manual checks
on copies in the private release record:

1. Run the command on complete passing evidence. Expect exit `0`, all gates
   ready, exact intended identities, and expected manual skips counted separately.
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
   `firebase-tests`; expect no missing local-gate errors. Keep all four exact
   Device Run sessions and full named inventories. On a copy, change only the
   schema to 1: expect `2` for missing gate definitions. A retained complete
   schema-1 Android record still requires all five original gate definitions
   and results; removing a local result returns `1`. Schema 2 with `platform`
   set to `ios` returns `2`.
6. Mark inspection pending or a warning blocking/unreviewed: expect `1`.
   Remove a warning's policy/owner/version/reason/evidence: expect `2`. Remove
   a gate definition or empty a test inventory: expect `2`; remove a gate
   result: expect `1`.
7. After any passing report, still follow the platform's manual/native/store
   verification and authorized submission/publication sequence. Never use a
   report to claim a submitted artifact is publicly live.
