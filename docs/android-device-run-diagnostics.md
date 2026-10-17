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
