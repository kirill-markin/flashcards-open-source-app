# iOS review reaction smoke

Native validation is pending. The GitHub PR static gate does not compile iOS.
Xcode Cloud builds require explicit authorized dispatch; automatic push builds
are disabled. See [iOS CI/CD](../../../docs/ios-ci-cd.md).
Run these checks on the supported iOS target after obtaining a development build.

1. Enable review reactions and open Settings → Test → Animations. Wait for all
   38 bundled assets to become ready. Tap every row once, grouped by Again,
   Hard, Good and Easy. Confirm native playback, centered sizing, the existing
   fade envelope and variant duration, then disappearance. Confirm buttons
   remain usable and only one reaction is visible.
2. Enable airplane mode before launching the app. Repeat the 38 previews and
   rate local cards. All assets should load offline; ratings must advance and
   persist after relaunch.
3. Tap preview rows rapidly, then rate several cards rapidly in Review. Each
   new reaction replaces the previous one. No animation overlaps, frozen
   overlay or delayed rating submission should remain. Wait five seconds and
   confirm the last overlay disappears.
4. During playback, navigate back or switch tabs, lock/unlock the phone, and
   background/foreground the app. No reaction should replay on return. Repeat
   while assets are still loading; ready buttons should resume loading on the
   next appearance or active scene.
5. Disable review reactions during an active Review session. Turn Low Power
   Mode on during playback and during initial asset loading on both screens.
   Confirm reactions stop and preview buttons are disabled. Turn it off and
   confirm pending assets resume loading and previews work.
6. Enable Reduce Motion. Preview every asset: it should show one static pose
   and a short fade, then disappear within half a second. Toggle Reduce Motion
   during a long reaction; the reaction must expire without an issue report.
7. In a development build, send a memory warning during playback/loading
   (Xcode's memory-warning action). Confirm the overlay and prewarm work stop.
   Leave and reopen the screen to resume pending loading.
8. In a disposable development checkout, corrupt one bundled animation JSON,
   then separately rename one data asset or remove its configuration entry.
   Restore each fault before the next case. The affected preview must remain
   disabled as Unavailable; healthy assets and Review submissions must work.
   No crown fallback, technical-error sheet or process trap should appear.
9. With development Sentry enabled, inspect each fault's
   ios.review_reaction_failure issue: one event per affected asset per screen
   lifetime, with variant, asset name, source, failure reason and bounded
   decoder/configuration summary. Confirm available memory, footprint,
   thermal state and uptime context. Reopenings that preserve screen state
   must not repeat the failure; a newly constructed screen may report again.
   Healthy playback, pending loading, replacement, navigation, Low Power,
   Reduce Motion and memory-warning cancellation must create breadcrumbs only.
   Confirm ios.review_reactions contains a start and at most one terminal
   breadcrumb per played reaction, with no frame-level entries or card text/email.

Lottie's automatic rendering engine remains enabled. Completion interruption
and bounded cleanup timeout are cancellation breadcrumbs, not proof of a
renderer fault. These checks cannot establish protection against native
process crashes or OS memory termination; those cannot be safely caught by
an optional SwiftUI presentation layer.
