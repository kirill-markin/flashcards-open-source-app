# Read Device Run diagnostics through GitHub

Use [Android Device Run Diagnostics](../.github/workflows/android-device-run-diagnostics.yml) to read the current catalog, and optionally one session, with the existing Android CI Workload Identity Federation authentication. Configuration, device ordering and access are owned by [Android CI/CD](android-ci-cd.md#google-cloud-access-and-device-preflight).

1. Open **Actions → Android Device Run Diagnostics → Run workflow**, select `main`, and leave `session_id` empty to read only the catalog.
2. To inspect one session, supply its exact `session-…` resource basename from the release summary. It is distinct from `.sessionReport.id`.
3. Inspect the run summary or download the `android-device-run-diagnostics` artifact. Its only file is public-safe `summary.json`. A missing or unsuitable configured destination fails the workflow while retaining diagnostics.
4. For a supplied session, inspect native session/job/execution statuses and the JUnit reference counts. A successful diagnostics run means the reads and private archival succeeded; a session can still be running or failed.

Native `PASSED` status and JUnit references do not prove that every expected named test executed and passed: this workflow does not reconcile named cases, retries or expected inventory. Use the [release evidence collector and result procedure](android-ci-cd.md#device-run-results-and-release-correlation) for that verification.

## Retrieve private reports

The raw catalog, full session report and failed-read diagnostics stay in a private archive in the existing results bucket. Require `.private_archive_uploaded` to be `true`, then download it and check `.private_archive_sha256` with the download and hash-check commands of the [result procedure](android-ci-cd.md#device-run-results-and-release-correlation), using an already-authorized identity. Its `.sessions[].report.member` matching does not apply here; match the reports as below.

Match `catalog.json` and optional `session-full.json` against `.catalog_report.sha256` and `.session_report.sha256`. The full session report retains the private native JUnit/log references for direct retrieval through the linked results procedure. Raw provider error details are in `diagnostics.log`; GitHub displays only a safe failure message. Configuration or authentication failures before collection may produce no artifact.

Keep extracted reports and logs private. Do not attach them to public GitHub artifacts, issues or job logs. Reuse existing access; no new identity, key or IAM grant is required. This workflow submits or cancels no tests and performs no Play operation; its only cloud write is the private diagnostics archive.

## Build debug APKs or run selected native diagnostics

[Android Targeted Diagnostics](../.github/workflows/android-targeted-diagnostics.yml) is a separate manual builder. Select the workflow on `main` and supply an explicit `target_ref` (SHA or branch/tag). It resolves that source to an immutable commit and builds only the debug app and instrumentation APKs. Leave `run_selected_tests` false and the other inputs empty for build-only acquisition; no Google authentication is needed.

Download `android-targeted-debug-apks` even when an optional physical run fails. It contains both APKs, `SHA256SUMS`, Android output metadata and `provenance.json`: exact source/workflow SHAs, GitHub run/attempt, packaged version code/name, APK hashes and requested selections. Run `sha256sum --check SHA256SUMS` inside the extracted artifact before installing or reusing it.

For a bounded physical run, enable `run_selected_tests`, supply one exact current catalog `device` ID and newline-separated `test_selections`. Each line is an existing fully qualified class or `class#method`, without a `class ` prefix, for example:

```text
com.flashcardsopensourceapp.app.diagnostics.HttpProtocolProbeTest#http11OnlyPublicEndpointsComplete
com.flashcardsopensourceapp.app.diagnostics.HttpStackControlTest#platformHttpsAuthMethodsComplete
```

The source declarations must match every selection; package-wide selections and empty/inconsistent inputs fail before building. At most 10 selections expanding to 20 methods are accepted. This opt-in includes `ManualOnlyAndroidTest` classes; it uses Orchestrator, cleared package data and the automation marker. One session uses the existing CI WIF identity/private results bucket and shares the release account concurrency lock. Instrumentation is bounded to 15 minutes and the session wait to 20 minutes; the helper retains cancellation cleanup.

Inspect `android-targeted-device-run-diagnostics/summary.json` and its exact session ID, helper exit code and private archive identity. The private archive includes submission output, the submitted session snapshot, APK provenance, catalog and refreshed full session report. Use the private retrieval procedure above; raw output and native log references must stay private. Preflight/authentication failures can leave no artifact or only the catalog summary. Native `PASSED` remains distinct from independent named-case verification.

This path performs no release signing, AAB build, Play upload or publication. Selected diagnostics do not replace release acceptance; the existing read-only workflow above still only reads and archives diagnostics.
