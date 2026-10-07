# Read Device Run diagnostics through GitHub

Use [Android Device Run Diagnostics](../.github/workflows/android-device-run-diagnostics.yml) to read the current catalog with the existing Android CI Workload Identity Federation authentication. It uses CLI `588.0.0`, `beta`, the configured project and `global` location. Configuration, device ordering and access are owned by [Android CI/CD](android-ci-cd.md#google-cloud-access-and-device-preflight).

1. Open **Actions → Android Device Run Diagnostics → Run workflow**, select `main`, and leave `session_id` empty to read only the catalog.
2. To inspect one session, supply its exact `session-…` resource basename from the release summary. It is distinct from `.sessionReport.id`. The workflow reads that session with `sessions describe --full` and requires its returned identity to match.
3. Inspect the run summary or download the `android-device-run-diagnostics` artifact. Its only file is public-safe `summary.json`. The catalog lists the exact configured API 37, 30, 31 and 33 IDs, matching API, lifecycle, automation support, access-denial count and current capacity/availability. A missing or unsuitable configured destination fails the workflow while retaining diagnostics.
4. For a supplied session, inspect native session/job/execution statuses and the JUnit reference counts. A successful diagnostics run means the reads and private archival succeeded; a session can still be running or failed.

Native `PASSED` status and JUnit references do not prove that every expected named test executed and passed. This workflow does not download XML or reconcile named cases, retries or expected inventory. Use the existing [release evidence collector and result procedure](android-ci-cd.md#device-run-results-and-release-correlation) for that verification. The [native report schema](https://docs.cloud.google.com/developer-device-platform/reference/device-run/rest/v1alpha/projects.locations.sessions) describes the provider statuses and output references.

## Retrieve private reports

Raw catalog, full session report and failed-read diagnostics stay in the existing results bucket under `diagnostics/device-run/<workflowSha>/r<runId>a<attempt>/raw.tar.gz`. The safe summary records the exact private object, archive SHA-256, report member hashes, and `private_archive_uploaded`. Require that field to be `true` before retrieval. An archive-upload failure leaves it `false` and fails the job.

Using an already-authorized identity, download the private archive from the safe summary and verify its hash:

```bash
archive="$(jq -r '.private_archive' summary.json)"
gcloud storage cp "${archive}" raw.tar.gz
expected_hash="$(jq -r '.private_archive_sha256' summary.json)"
printf '%s  raw.tar.gz\n' "${expected_hash}" | shasum -a 256 --check
mkdir private-diagnostics
tar -xzf raw.tar.gz -C private-diagnostics
```

Match `catalog.json` and optional `session-full.json` against `.catalog_report.sha256` and `.session_report.sha256`. The full session report retains the private native JUnit/log references for direct retrieval through the linked results procedure. Raw provider error details are in `diagnostics.log`; GitHub displays only a safe failure message. Configuration or authentication failures before collection may produce no artifact.

Keep extracted reports and logs private. Do not attach them to public GitHub artifacts, issues or job logs. Reuse existing access; no new identity, key or IAM grant is required. This workflow submits or cancels no tests and performs no Play operation; its only cloud write is the private diagnostics archive.
