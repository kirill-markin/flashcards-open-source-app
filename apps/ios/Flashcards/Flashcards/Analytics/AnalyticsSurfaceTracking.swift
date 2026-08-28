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

    /// Starts a review session if one is not already open. `deck_scope` describes what the queue was
    /// built from.
    static func startReviewSession(deckScope: AnalyticsReviewDeckScope) {
        guard self.reviewSessionTracker.start(deckScope: deckScope, now: Date()) else {
            return
        }

        self.track(.reviewSessionStarted(deckScope: deckScope), screen: .review)
    }

    /// One successfully recorded answer in the open review session.
    static func recordReviewAnswer() {
        self.reviewSessionTracker.recordAnswer()
    }

    /**
     * Ends the open session as completed, but only once the user has actually answered something in
     * it. The empty state also appears for a queue that was already empty when the user arrived, and
     * briefly while a rebuilt queue settles, and neither of those is a completed session.
     */
    static func completeReviewSessionIfAnswered() {
        guard self.reviewSessionTracker.hasRecordedAnswer() else {
            return
        }

        self.endReviewSession(reason: .completed)
    }

    /// Ends the open review session, if any. Calling it when none is open does nothing, so the
    /// leave/exhausted/backgrounded hooks can all fire without coordinating with each other.
    static func endReviewSession(reason: AnalyticsReviewSessionEndReason) {
        guard let event = self.makeReviewSessionEndedEvent(reason: reason, isResumable: false) else {
            return
        }

        self.track(event, screen: .review)
    }

    /**
     * Ends the open session as `interrupted` because the app is leaving the foreground, and awaits the
     * queue write.
     *
     * Awaited because the backgrounded app starts its flush beside this call, and two independently
     * scheduled jobs have no ordering between them, so the session-ended event would otherwise miss
     * the very batch placed to carry it.
     *
     * The scope of the session being closed is kept so the return to the foreground can reopen an
     * equivalent one. Contract §6 requires the restart, and nothing else can supply it: SwiftUI does
     * not re-run `.onAppear` on a foreground return, because the review view was never removed from
     * the hierarchy, so without this the session would only reopen at the user's next answer — and not
     * at all for a return visit that reads, listens or finds an empty queue and leaves.
     */
    static func interruptReviewSessionAndWait() async {
        guard let event = self.makeReviewSessionEndedEvent(reason: .interrupted, isResumable: true) else {
            return
        }

        await self.trackAndWait(event, screen: .review)
    }

    /**
     * Reopens the session that leaving the foreground interrupted, on the return to it.
     *
     * The marker is the structural statement of "the person is still on the review screen": it exists
     * only because a session was genuinely open when the app left, and the review view cannot be
     * unmounted while the app is in the background, so it cannot be reopened for somebody who is
     * somewhere else. It is consumed here, so a foreground return that follows an ordinary end
     * reopens nothing.
     */
    static func resumeInterruptedReviewSession() {
        guard let deckScope = self.reviewSessionTracker.takeResumableDeckScope() else {
            return
        }

        self.startReviewSession(deckScope: deckScope)
    }

    private static func makeReviewSessionEndedEvent(
        reason: AnalyticsReviewSessionEndReason,
        isResumable: Bool
    ) -> AnalyticsEvent? {
        guard let completion = self.reviewSessionTracker.end(now: Date(), isResumable: isResumable) else {
            return nil
        }

        return .reviewSessionEnded(
            endReason: reason,
            answeredCount: completion.answeredCount,
            durationMilliseconds: completion.durationMilliseconds
        )
    }
}

struct AnalyticsReviewSessionCompletion: Sendable, Equatable {
    let answeredCount: Int
    let durationMilliseconds: Int
}

/// Touched from SwiftUI lifecycle hooks and from the review submission path, so it is lock-protected
/// rather than actor state: none of its callers may await.
final class AnalyticsReviewSessionTracker: @unchecked Sendable {
    private let lock: NSLock
    private var startedAt: Date?
    private var deckScope: AnalyticsReviewDeckScope?
    private var answeredCount: Int
    /// Set only by an interrupted end, consumed only by the matching foreground return. While it is
    /// non-nil the app is in the background with the review screen still mounted underneath.
    private var resumableDeckScope: AnalyticsReviewDeckScope?

    init() {
        self.lock = NSLock()
        self.startedAt = nil
        self.deckScope = nil
        self.answeredCount = 0
        self.resumableDeckScope = nil
    }

    func start(deckScope: AnalyticsReviewDeckScope, now: Date) -> Bool {
        self.lock.lock()
        defer {
            self.lock.unlock()
        }
        guard self.startedAt == nil else {
            return false
        }

        self.startedAt = now
        self.deckScope = deckScope
        self.answeredCount = 0
        // An open session leaves nothing to resume: whoever opened this one got there first.
        self.resumableDeckScope = nil
        return true
    }

    func recordAnswer() {
        self.lock.lock()
        defer {
            self.lock.unlock()
        }
        guard self.startedAt != nil else {
            return
        }

        self.answeredCount += 1
    }

    func hasRecordedAnswer() -> Bool {
        self.lock.lock()
        defer {
            self.lock.unlock()
        }
        return self.startedAt != nil && self.answeredCount > 0
    }

    /// `isResumable` marks the end as an interruption the app can come back from; every other end is
    /// final and clears any marker a previous interruption left behind.
    func end(now: Date, isResumable: Bool) -> AnalyticsReviewSessionCompletion? {
        self.lock.lock()
        defer {
            self.lock.unlock()
        }
        // Cleared before the open-session check rather than after it, so that a genuine end always
        // clears a marker and never only when a session happens to be open. Nothing is expected to
        // reach here with a marker set and no session, but that expectation rests on an interrupt
        // always completing before the next foreground return, and a marker that outlives its session
        // would open one for somebody who has left the review screen and accrue `duration_ms` until
        // they next enter and leave it.
        self.resumableDeckScope = nil
        guard let startedAt = self.startedAt else {
            return nil
        }

        if isResumable {
            self.resumableDeckScope = self.deckScope
        }
        self.startedAt = nil
        self.deckScope = nil
        let answeredCount = self.answeredCount
        self.answeredCount = 0
        return AnalyticsReviewSessionCompletion(
            answeredCount: answeredCount,
            durationMilliseconds: Int(max(0, now.timeIntervalSince(startedAt) * 1_000))
        )
    }

    func takeResumableDeckScope() -> AnalyticsReviewDeckScope? {
        self.lock.lock()
        defer {
            self.lock.unlock()
        }
        let resumableDeckScope = self.resumableDeckScope
        self.resumableDeckScope = nil
        return resumableDeckScope
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

/// Maps the active review filter onto the shared `deck_scope` values.
func analyticsReviewDeckScope(reviewFilter: ReviewFilter) -> AnalyticsReviewDeckScope {
    switch reviewFilter {
    case .allCards:
        return .all
    case .deck:
        return .deck
    case .tags:
        return .filter
    }
}
