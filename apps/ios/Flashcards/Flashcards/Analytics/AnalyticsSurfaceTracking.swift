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
     */
    static func trackScreenViewedOnDismiss(
        of dismissedSurface: AnalyticsSurface,
        restoring restoredSurface: AnalyticsSurface
    ) {
        guard self.surfaceTracker.restoreViewing(
            from: dismissedSurface,
            to: restoredSurface
        ) else {
            return
        }

        self.track(.screenViewed(screen: restoredSurface))
    }
}

final class AnalyticsSurfaceTracker: @unchecked Sendable {
    private let lock: NSLock
    private var currentSurface: AnalyticsSurface?

    init() {
        self.lock = NSLock()
        self.currentSurface = nil
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

    /// Moves the current surface back to `restoredSurface`, but only while `dismissedSurface` is still
    /// the one being viewed. A screen that something else has already superseded restores nothing.
    func restoreViewing(
        from dismissedSurface: AnalyticsSurface,
        to restoredSurface: AnalyticsSurface
    ) -> Bool {
        self.lock.lock()
        defer {
            self.lock.unlock()
        }
        guard self.currentSurface == dismissedSurface, restoredSurface != dismissedSurface else {
            return false
        }

        self.currentSurface = restoredSurface
        return true
    }
}
