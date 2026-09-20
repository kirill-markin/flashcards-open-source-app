# Release Gates and Monitoring

Pushes to `main` use independent release and check streams:

- `.github/workflows/aws-web-release.yml` handles AWS/backend/web release work
- when AWS/backend/web changed, it deploys production, runs the native Playwright smoke in `apps/web/e2e/live-smoke.spec.ts`, runs the external agent API smoke in `scripts/checks/check-agent-api-smoke.sh`, runs the MCP endpoint smoke in `scripts/checks/check-mcp-smoke.sh`, and only finishes healthy when all three post-deploy checks pass
- rollback is automatic only when the failed AWS release did not include new DB migrations
- migration-bearing AWS failures are explicit fix-forward cases; the next push must still be allowed to run
- when Android-impacting files changed, `.github/workflows/android-ci.yml` runs the post-merge `data:local` emulator backstop without repeating the PR build, unit tests, or lint and without uploading to Google Play or submitting Firebase Test Lab
- Android production draft upload is manual-only through `.github/workflows/android-release.yml`; that workflow also requires Firebase Test Lab submission before the Play draft upload starts
- for an iOS release, a human or authorized AI explicitly starts and monitors both Xcode Cloud workflows for the selected SHA under the [iOS release procedure](manual-production-release.md#ios)

The `Web post-deploy smoke` job never loads the deployed web assets: it serves a
`dist` built from the merge commit on `app.flashcards-open-source-app.com`
through `/etc/hosts`, so only `auth.` and `api.` reach deployed infrastructure.
Read it as a check of the merge commit's web client against the deployed
backend, not of the hosted web deployment. A failed run uploads
`web-live-smoke-failure-diagnostics` with the Playwright failure diagnostics and
the static server log, which records one line per request with the resolved
content type and whether the SPA `index.html` fallback was served. Those
artifacts are public, and the two halves stay credential-free for different
reasons. `apps/web/e2e/live-smoke.diagnostics.ts` redacts the Playwright
diagnostics before it writes them: header values outside its request and
response allowlists are dropped fail-closed, URL user info and fragments are
dropped, and a URL query value is masked when its parameter name looks
sensitive. The same treatment covers URLs embedded in console text, error
messages and stack traces. Query parameter names and non-sensitive values stay
readable on purpose, because the diagnostics are read through them. The static
server log carries no credential because
`apps/web/scripts/serve-dist-https.mjs` records only the sanitized pathname and
never the query string; nothing redacts that log afterwards, so anything added
to it must be safe to publish as written.

The MCP endpoint smoke in `AWS/Web Release` verifies the deployed MCP HTTP
contract. MCP Registry validation is a separate automatic check for
`server.json` changes, and registry publication is a separate manual workflow.
Trigger `MCP Registry Publish` only when the release should publish a new,
previously unpublished `server.json.version`.

Release order and authorization belong to the [full release runbook](release-current-version.md).
Platform gates and console actions are in [Platform Release Procedures](manual-production-release.md).

When a change lands on `main`, monitor `AWS/Web Release` for backend/web outcome when AWS-impacting files changed, including the Web, Agent API, and MCP post-deploy smoke jobs, and monitor `Android CI` when Android-impacting files changed. Reading and monitoring Xcode Cloud runs, results, and artifacts is always allowed; dispatching Xcode Cloud workflows requires a full-release request or an explicit request for those actions, as defined in the release runbook.
For Android, a green automatic `Android CI` run means the post-merge `data:local` emulator backstop passed for that SHA. It does not repeat the build, unit tests, or lint already enforced by the required PR gate, and it does not mean Firebase Test Lab was submitted, a Google Play draft was uploaded, or a release is already live. Run the manual `Android Release` workflow when the Android SHA is ready for release. A green manual `Android Release` run means the full GitHub-hosted Android gate passed, Firebase Test Lab submission succeeded, and CI uploaded a production-track Play draft; Firebase Test Lab is submitted asynchronously, so review its matrix result before publishing from Play Console. A non-green `Android Release` run means one of the required release stages failed or was skipped by a failed dependency. Translation review and final publication still happen later in Play Console.
To trace the exact Android release, open the GitHub Actions run summary for the manual `Android Release` run, note the shared `ANDROID_VERSION_CODE`, the shared release identifier `vc<versionCode>-r<runId>a<attempt>-s<shortSha>`, the Play draft release name `main-draft-<releaseIdentifier>`, and the Firebase results path for that same release identifier. Correlate the run by release name, results path, GitHub run id and attempt, and SHA; Firebase matrix IDs are Google-assigned lookup values, not the shared release identifier.
For Xcode Cloud inspection, use `docs/xcode-cloud-data-access.md`. It documents the local `.env` secrets, App Store Connect API flow, example commands, returned data formats, artifact types, and how to extract timing/debugging insights from cloud test runs.

Cross-client live smoke references:

- iOS: `apps/ios/Flashcards/FlashcardsUITests/LiveSmoke*Tests.swift`
- Android: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/livesmoke/LiveSmokeTest.kt`
- Android notification tap gate: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/notifications/NotificationTapSmokeTest.kt`
- Web: `apps/web/e2e/live-smoke.spec.ts`
- Manual managed image sync: [docs/managed-media-cross-client-smoke.md](./managed-media-cross-client-smoke.md)

These live smoke flows are the highest-confidence checks in the repository because they exercise the real app closest to production conditions.
On Android, these live smoke flows run as part of the broader Firebase Test Lab app instrumentation suite in the manual `Android Release` workflow.
When a code change affects a primary user flow, main screen, or cross-client navigation path, check the relevant live smoke or targeted integration tests in the same change and update them when the expected behavior changed. We do not try to guard every internal detail with tests. For small internal or low-risk changes that do not affect the main user journey, updating those tests is optional.
