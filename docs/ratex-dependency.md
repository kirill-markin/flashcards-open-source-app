# RaTeX dependency

Android, web and the shared Apple target consume reviewed packages from
[Kirill's RaTeX fork](https://github.com/kirill-markin/RaTeX). Keep exact immutable
pins until a deliberate update; never follow moving `main` or overwrite published
tags or assets. GitHub release assets are public and require no consumer credentials.

| Client | Consumption |
| --- | --- |
| Android | [Exclusive Ivy repository](../apps/android/settings.gradle.kts) and [exact coordinate](../apps/android/gradle/libs.versions.toml). The release's Ivy descriptor carries transitive dependencies; do not bypass it with an artifact-only `@aar` dependency. |
| Web | [Scoped package and release tarball URL](../apps/web/package.json), with npm-generated integrity in [the lockfile](../apps/web/package-lock.json). |
| iOS/iPadOS/macOS | Shared exact SwiftPM package and resolved revision; [current Apple pins and binary provenance](macos-ci-cd.md#dependencies). |

## Release preflight and updates

Before each affected platform's testing, builds, deployment or publication:

1. Select a reviewed fork source commit. Compare the **full diff** from each
   consumed artifact's provenance `source_sha` to that commit, including all
   retained fork patches. Record the source/artifact identities and comparison.
2. Reuse an artifact only when its platform inputs are equivalent: native engine
   or WASM source, platform wrappers, fonts/resources, dependencies, toolchain and
   build configuration. Documentation or URL/checksum-only packaging differences
   can permit reuse when those inputs are unchanged. Otherwise merge the required
   fork changes through review and CI, then build the affected packages below.
3. For Android/web, use the existing manual
   [Fork Android/web packages workflow](https://github.com/kirill-markin/RaTeX/actions/workflows/fork-packages.yml)
   at that reviewed source, following the [producer procedure](https://github.com/kirill-markin/RaTeX/blob/main/docs/FORK_PACKAGES.md).
   Require its CI checks and inspect exact artifact metadata, provenance and hashes,
   package identities/versions, MIT/font notices, Android descriptor transitives
   and native ELF alignment, and extracted web tarball/WASM/font tests. Publish
   the **exact verified CI bytes**, checksum and provenance under a **new immutable
   package version and release tag**.
4. For Apple, use the existing [Catalyst XCFramework workflow](https://github.com/kirill-markin/RaTeX/actions/workflows/catalyst-build.yml)
   and [Apple packaging procedure](https://github.com/kirill-markin/RaTeX/blob/main/platforms/ios/README.md).
   Verify native artifacts, then publish exact CI bytes, checksum and provenance
   under a **new immutable binary tag**. Update the fork's
   [manifest URL/checksum](https://github.com/kirill-markin/RaTeX/blob/main/Package.swift)
   through a PR and CI when needed; publish a **new immutable Swift package tag**
   at the merged manifest commit. Reuse the existing package when unchanged.
5. Repin affected consumers through normal PR/CI: Android's repository release
   URL and exact coordinate/version; web's scoped dependency tarball URL and
   npm-generated lockfile, preserving unrelated pins; Apple's shared project
   exact requirement and Xcode/SwiftPM-generated `Package.resolved`, preserving
   other pins and generated `originHash`. Never hand-author lock integrity.
   Run the affected existing [platform gates](release/README.md#required-reading)
   before publication; web follows its normal automatic `main` deployment.

Upstream synchronization is a **separate manual process**: review and merge the
original repository into the fork, reconciling retained patches against patches
already accepted upstream, before selecting fork source. A normal Flashcards
release neither automatically syncs upstream nor requires fresh packages when
the consumed inputs are unchanged.
