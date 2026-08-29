import Foundation

extension Analytics {
    /**
     * Emits `screen_viewed` for a surface, skipping an immediate repeat of the surface the user is
     * already on. SwiftUI re-presents the same screen on state changes, and a funnel built on a
     * duplicated step reads as engagement that never happened.
     */
    static func trackScreenViewed(_ surface: AnalyticsSurface) {
        guard self.surfaceTracker.beginViewing(surface: surface) else {
            return
        }

        self.track(.screenViewed(screen: surface))
    }

    /**
     * Emits `screen_viewed` only while nothing has been reported yet in this process.
     *
     * For the one report that names the tab the app opened on. That report arrives through the same
     * call as a tab re-selection, which must stay silent because the user is not necessarily on the
     * tab's own root, and an empty tracker is what tells the two apart: at launch nothing has been
     * viewed, while a re-selection can only happen after something has.
     */
    static func trackInitialScreenViewed(_ surface: AnalyticsSurface) {
        guard self.surfaceTracker.beginInitialViewing(surface: surface) else {
            return
        }

        self.track(.screenViewed(screen: surface))
    }

    /**
     * Emits `screen_viewed` for the surface a screen returns the user to as it goes away — but only
     * while the tracker still holds the surface that screen itself set.
     *
     * `.onDisappear` fires both for the dismissal this restore is written for and for a switch away
     * to somewhere else entirely, and SwiftUI gives no ordering guarantee between it and the
     * destination reporting itself. An unconditional restore therefore risks naming a screen the user
     * is not on, and the dedupe would then swallow the genuine next view of it — a false view and a
     * hidden true one from the same line. Restoring only what this screen still owns makes the
     * emission depend on observed state rather than on disappear ordering.
     *
     * In this app the destination always reports first for the case that motivated the guard, and by
     * construction rather than by ordering: both the tab selection `Binding.set` in `RootTabView` and
     * `AppNavigationModel.selectTab` emit the destination's `screen_viewed` synchronously before the
     * selection moves, so it is already recorded when the view update that removes the outgoing
     * hierarchy runs `.onDisappear`.
     *
     * Two kinds of caller cannot lean on that, and neither is left to ordering. A sheet restores from
     * the presentation's `onDismiss` and never from the content's `.onDisappear`, because SwiftUI
     * destroys and rebuilds sheet content while the presentation stays on screen — a programmatic tab
     * switch under the presenter is enough — so `.onDisappear` would hand the surface back under a
     * sheet the person is still using, and the rebuilt content's `.onAppear` would then report a
     * second view of a screen they never left. A push whose destination reports itself from its own
     * `.onAppear` — the decks list opening a deck detail — decides from settled navigation state
     * instead, so its restore is a no-op on a push whichever way SwiftUI orders the two callbacks.
     *
     * The entry half of a sheet's pair stays on the content's `.onAppear`, which is the only callback
     * that proves the screen was actually shown, and there a rebuild is absorbed by the dedupe: it
     * reports nothing while the tracker still holds the sheet's own surface. Only something that
     * moves the tracker out from under a live sheet reopens that, and the one reachable mover is a
     * notification tap — `handleAppNotificationTap` selects Review without closing anything. The
     * in-app switches that run from inside these sheets, the AI hand-off in `ReviewView` and
     * `CardsScreen`, clear the presentation in the same action, so their content is being removed
     * rather than rebuilt. What that leaves is one extra `screen_viewed` for a sheet the person is
     * genuinely still looking at, with the tracker ending up where it belongs, so the restore that
     * follows is still right.
     */
    static func trackScreenViewedOnDismiss(
        of dismissedSurface: AnalyticsSurface,
        restoring restoredSurface: AnalyticsSurface
    ) {
        self.trackScreenViewedOnDismiss(ofAnyOf: [dismissedSurface], restoring: restoredSurface)
    }

    /**
     * The same restore for a screen that can be taken away while something it presented still owns
     * the tracker: `restoredSurface` is emitted when any of `dismissedSurfaces` is the one being
     * viewed, under the same guard.
     *
     * Only the credential-recovery gate needs it. The gate is torn down by its own success, which
     * happens while the sign-in sheet it presented is still on screen and holding `signin`, and
     * removing the gate destroys that sheet's presenter without an `onDismiss`, so the gate's own
     * dismissal is the only thing left to name the screen the person lands on.
     */
    static func trackScreenViewedOnDismiss(
        ofAnyOf dismissedSurfaces: Set<AnalyticsSurface>,
        restoring restoredSurface: AnalyticsSurface
    ) {
        guard self.surfaceTracker.restoreViewing(
            fromAnyOf: dismissedSurfaces,
            to: restoredSurface
        ) else {
            return
        }

        self.track(.screenViewed(screen: restoredSurface))
    }

    /**
     * Emits `permission_prompt_answered` on the surface the person is on when the OS answers, which
     * is what `screen` means on this event and is not necessarily the surface that asked.
     *
     * The system dialog suspends the app, and the person can background it, come back somewhere else
     * and answer there, so the asking surface is not reliably where they are by the time the result
     * arrives. Reading the tracker gives the surface last reported for real instead; when nothing has
     * been reported yet the event carries no `screen`, which the catalog allows, rather than a guess.
     */
    static func trackPermissionPromptAnswered(
        permission: AnalyticsPermission,
        outcome: AnalyticsPermissionOutcome
    ) {
        self.track(
            .permissionPromptAnswered(permission: permission, outcome: outcome),
            screen: self.surfaceTracker.currentViewingSurface()
        )
    }
}

final class AnalyticsSurfaceTracker: @unchecked Sendable {
    private let lock: NSLock
    private var currentSurface: AnalyticsSurface?

    init() {
        self.lock = NSLock()
        self.currentSurface = nil
    }

    /// The surface last reported as viewed, for the events that have to name where the person is now
    /// rather than where the caller happens to sit in the view hierarchy.
    func currentViewingSurface() -> AnalyticsSurface? {
        self.lock.lock()
        defer {
            self.lock.unlock()
        }

        return self.currentSurface
    }

    func beginViewing(surface: AnalyticsSurface) -> Bool {
        self.lock.lock()
        defer {
            self.lock.unlock()
        }
        guard self.currentSurface != surface else {
            return false
        }

        self.currentSurface = surface
        return true
    }

    /// Claims the first surface of the process and nothing after it.
    func beginInitialViewing(surface: AnalyticsSurface) -> Bool {
        self.lock.lock()
        defer {
            self.lock.unlock()
        }
        guard self.currentSurface == nil else {
            return false
        }

        self.currentSurface = surface
        return true
    }

    /// Moves the current surface back to `restoredSurface`, but only while one of `dismissedSurfaces`
    /// is still the one being viewed. A screen that something else has already superseded restores
    /// nothing.
    func restoreViewing(
        fromAnyOf dismissedSurfaces: Set<AnalyticsSurface>,
        to restoredSurface: AnalyticsSurface
    ) -> Bool {
        self.lock.lock()
        defer {
            self.lock.unlock()
        }
        guard let currentSurface = self.currentSurface,
              dismissedSurfaces.contains(currentSurface),
              restoredSurface != currentSurface else {
            return false
        }

        self.currentSurface = restoredSurface
        return true
    }
}
