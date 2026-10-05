# Review reaction manual smoke

Use Android 17 / API 37 and a development build with Android Sentry enabled when
checking issue delivery. Record the build release identifier and device model.
These checks are manual; normal PR checks remain in cloud CI.

1. Open Settings → Test Animations with Battery Saver off. Wait for loading to
   finish, then tap each of the 38 entries across Again, Hard, Good, and Easy.
   Each ready entry plays and clears. Rapidly tap several entries: only the most
   recent reaction remains, and an older completion must not clear its replacement.
2. Rate real cards quickly across all four ratings. Confirm ratings save and
   advance immediately, including when no reaction is ready. Check offline ratings
   and Test Animations in airplane mode: bundled assets need no download.
3. During playback, navigate to another screen, go Home, lock/unlock, and return.
   Confirm the interrupted reaction does not resume or remain on screen and the
   next rating/preview works. Repeat interruptions: Sentry lifecycle breadcrumbs
   stay bounded per stage/store, with no cancellation issues.
4. Enable Battery Saver during playback: reactions clear and Test Animations rows
   are paused. Disable it and play again. Turn system animations off: reactions
   use a static short presentation. Disable review reactions in settings: ratings
   still advance without animation. None of these actions creates Sentry issues.
5. In a disposable development checkout, temporarily replace one bundled reaction
   JSON with malformed JSON and build through the authorized development workflow.
   Its Test Animations row becomes unavailable; tap other ready entries and rate
   cards in its rating group. Review submission must continue, with no crown
   replacement. Revisit/recompose repeatedly: at most one load issue per asset
   and store lifetime. Restore the resource before shipping.
6. To exercise the presentation boundary in a disposable development checkout,
   temporarily throw an IllegalStateException immediately inside LottieAnimation's
   drawWithContent try block in ReviewReactionOverlay.kt. Play one ready asset.
   It clears immediately, its row becomes unavailable, and the original exception
   is reported once. A later rating/ready asset still works. Restore the injection
   before shipping; do not inject OOM or native process crashes.
7. Inspect each genuine failure in Sentry: original exception/stack, release and
   device context, review_reaction source/stage, variant/asset, readiness and
   ready/pending/failed counts, Battery Saver and animator settings. Confirm no
   card text or email appears in reaction context. Ordinary loading, disablement,
   replacement and cancellation produce breadcrumbs only. Review preload uses
   the app composition's store lifetime; Test Animations uses its screen lifetime.
