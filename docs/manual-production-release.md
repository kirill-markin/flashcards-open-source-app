# Manual Production Release

Use this runbook for the human-operated production release steps after the
current version is ready to ship and before bumping the repository to the next
version.

The version, tag, GitHub Release, and next-version bump flow is documented in
[docs/version-bump.md](./version-bump.md). This document only describes the
platform actions that a person must start, inspect, or finish.

## iOS

1. Run the Xcode Cloud test workflow manually for the release SHA.
2. Fix every red result, and investigate yellow or warning states until they are
   understood before continuing.
3. Build the release build through Xcode Cloud.
4. Install the build from TestFlight and run a manual smoke test against the
   production service configuration.
5. Submit the tested build for App Review.

Xcode Cloud is the canonical release path. If Xcode Cloud is unavailable or an
urgent local upload is required, use the local App Store archive flow in
[docs/ios-local-setup.md](./ios-local-setup.md).

## Android

1. Run the manual `Android Release` GitHub Actions workflow for the latest
   release SHA, including the Android tests needed for the release decision.
2. Fix anything that is not green before continuing.
3. Confirm the production-track draft release is present in Google Play Console.
4. Publish the new version manually in Google Play Console after the draft is
   reviewed and ready.

The Android CI/CD details, Firebase Test Lab inputs, Play draft upload behavior,
and Play Console publishing notes are documented in
[docs/android-ci-cd.md](./android-ci-cd.md).

## Web

No manual production release action is required for web. Web deploys through the
`AWS/Web Release` workflow on `main`; monitor that workflow and its deployed
smoke checks when web or AWS-impacting files changed.

The AWS/web release stream is documented in
[docs/backend-web-deployment.md](./backend-web-deployment.md) and
[docs/release-gates.md](./release-gates.md).

## MCP

1. Run the manual `MCP Registry Publish` GitHub Actions workflow when the
   release should publish the hosted MCP server manifest.
2. Verify the workflow published the intended `server.json.version`.

The registry accepts each manifest version only once, so do not rerun the
publish workflow for a version that already exists in the registry.
