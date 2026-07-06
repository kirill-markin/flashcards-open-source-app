# Release Gates and Monitoring

Pushes to `main` use independent release and check streams:

- `.github/workflows/aws-web-release.yml` handles AWS/backend/web release work
- when AWS/backend/web changed, it deploys production, runs the native Playwright smoke in `apps/web/e2e/live-smoke.spec.ts`, runs the external agent API smoke in `scripts/checks/check-agent-api-smoke.sh`, runs the MCP endpoint smoke in `scripts/checks/check-mcp-smoke.sh`, and only finishes healthy when all three post-deploy checks pass
- rollback is automatic only when the failed AWS release did not include new DB migrations
- migration-bearing AWS failures are explicit fix-forward cases; the next push must still be allowed to run
- when Android-impacting files changed, `.github/workflows/android-ci.yml` runs independently and enforces the fast GitHub-hosted Android gate without uploading to Google Play or submitting Firebase Test Lab
- Android production draft upload is manual-only through `.github/workflows/android-release.yml`; that workflow also requires Firebase Test Lab submission before the Play draft upload starts
- when iOS changed, Xcode Cloud runs independently for the same `main` SHA

The MCP endpoint smoke in `AWS/Web Release` verifies the deployed MCP HTTP
contract. MCP Registry validation is a separate automatic check for
`server.json` changes, and registry publication is a separate manual workflow.
Trigger `MCP Registry Publish` only when the release should publish a new,
previously unpublished `server.json.version`.

Human-operated production release actions for iOS, Android, web, and MCP are
tracked in [docs/manual-production-release.md](./manual-production-release.md).

When a change lands on `main`, monitor `AWS/Web Release` for backend/web outcome when AWS-impacting files changed, including the Web, Agent API, and MCP post-deploy smoke jobs, monitor `Android CI` when Android-impacting files changed, and monitor Xcode Cloud separately when iOS changed.
For Android, a green `Android CI` run always means the GitHub-hosted Android gate passed for that SHA. It does not mean Firebase Test Lab was submitted, a Google Play draft was uploaded, or a release is already live. Run the manual `Android Release` workflow when the Android SHA is ready for release. A green manual `Android Release` run means the GitHub-hosted Android gate passed, Firebase Test Lab submission succeeded, and CI uploaded a production-track Play draft; Firebase Test Lab is submitted asynchronously, so review its matrix result before publishing from Play Console. A non-green `Android Release` run means one of the required release stages failed or was skipped by a failed dependency. Translation review and final publication still happen later in Play Console.
To trace the exact Android release, open the GitHub Actions run summary for the manual `Android Release` run, note the shared `ANDROID_VERSION_CODE`, the shared release identifier `vc<versionCode>-r<runId>a<attempt>-s<shortSha>`, the Play draft release name `main-draft-<releaseIdentifier>`, and the Firebase results path for that same release identifier. Correlate the run by release name, results path, GitHub run id and attempt, and SHA; Firebase matrix IDs are Google-assigned lookup values, not the shared release identifier.
If you need to inspect Xcode Cloud directly instead of relying only on the web UI, use `docs/xcode-cloud-data-access.md`. It documents the local `.env` secrets, App Store Connect API flow, example commands, returned data formats, artifact types, and how to extract timing/debugging insights from cloud test runs.

Cross-client live smoke references:

- iOS: `apps/ios/Flashcards/FlashcardsUITests/LiveSmoke*Tests.swift`
- Android: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/livesmoke/LiveSmokeTest.kt`
- Android notification tap gate: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/notifications/NotificationTapSmokeTest.kt`
- Web: `apps/web/e2e/live-smoke.spec.ts`
- Manual managed image sync: [docs/managed-media-cross-client-smoke.md](./managed-media-cross-client-smoke.md)

These live smoke flows are the highest-confidence checks in the repository because they exercise the real app closest to production conditions.
On Android, these live smoke flows run as part of the broader Firebase Test Lab app instrumentation suite in the manual `Android Release` workflow.
When a code change affects a primary user flow, main screen, or cross-client navigation path, check the relevant live smoke or targeted integration tests in the same change and update them when the expected behavior changed. We do not try to guard every internal detail with tests. For small internal or low-risk changes that do not affect the main user journey, updating those tests is optional.
