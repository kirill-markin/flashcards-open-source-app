# Release Gates and Monitoring

Pushes to `main` use three independent release streams:

- `.github/workflows/aws-web-release.yml` handles AWS/backend/web release work
- when AWS/backend/web changed, it deploys production, runs the native Playwright smoke in `apps/web/e2e/live-smoke.spec.ts`, runs the external agent API smoke in `scripts/check-agent-api-smoke.sh`, and only finishes healthy when both post-deploy checks pass
- rollback is automatic only when the failed AWS release did not include new DB migrations
- migration-bearing AWS failures are explicit fix-forward cases; the next push must still be allowed to run
- when Android-impacting files changed, `.github/workflows/android-release.yml` runs independently and handles Android CI, Firebase Test Lab, and Google Play publication
- when iOS changed, Xcode Cloud runs independently for the same `main` SHA

When a change lands on `main`, monitor `AWS/Web Release` for backend/web outcome when AWS-impacting files changed, including both post-deploy smoke jobs, monitor `Android Release` when Android-impacting files changed, and monitor Xcode Cloud separately when iOS changed.
If you need to inspect Xcode Cloud directly instead of relying only on the web UI, use `docs/xcode-cloud-data-access.md`. It documents the local `.env` secrets, App Store Connect API flow, example commands, returned data formats, artifact types, and how to extract timing/debugging insights from cloud test runs.

Cross-client live smoke references:

- iOS: `apps/ios/Flashcards/FlashcardsUITests/LiveSmokeUITests.swift`
- Android: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/LiveSmokeTest.kt`
- Web: `apps/web/e2e/live-smoke.spec.ts`

These live smoke flows are the highest-confidence checks in the repository because they exercise the real app closest to production conditions.
When a code change affects a primary user flow, main screen, or cross-client navigation path, check the relevant live smoke or targeted integration tests in the same change and update them when the expected behavior changed. We do not try to guard every internal detail with tests. For small internal or low-risk changes that do not affect the main user journey, updating those tests is optional.
