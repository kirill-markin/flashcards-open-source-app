import Foundation

extension Analytics {
    /**
     * The one way this app emits `sync_failed`. Every surface that can notice a cloud sync failing
     * reports it here, so one outage costs one event no matter which surface saw it first.
     *
     * Never call `track(.syncFailed(...))` directly. The sync paths are retried on a timer — every
     * 15 s on the Review and Cards tabs — so a direct emit turns one outage into hundreds of rows per
     * device per hour on an append-only table.
     */
    static func reportSyncFailure(reason: AnalyticsSyncFailureReason) {
        guard self.syncFailureReporter.shouldReport(reason: reason) else {
            return
        }

        self.track(.syncFailed(reason: reason))
    }

    /// A sync that completed ends the failure episode: the next failure is reported again, whatever
    /// its reason.
    static func recordSyncSucceeded() {
        self.syncFailureReporter.rearm()
    }
}

/**
 * Holds `sync_failed` to the transition **into** failure rather than one event per attempt.
 *
 * Two harms come from the per-attempt version, and the second is the worse one. The event stops
 * measuring failure incidence and starts measuring poll cadence; and because an offline device cannot
 * flush either, the repeats fill the 5000-event queue and drop-oldest evicts the genuine events
 * behind them. `product_events` is append-only, so neither is repairable after the fact.
 *
 * Reported reasons are held as a set rather than as a single last-reason slot. The two behave
 * identically while one reason persists, which is the case the shared rule is written for, but a
 * flapping connection maps alternately onto `offline` and `timeout`, and a slot would emit on every
 * alternation — the per-attempt behaviour again, arriving by a different route. A set bounds a
 * failure episode at one event per distinct reason.
 *
 * The bound is a cross-client contract, not a local choice: a client that emits more often than one
 * event per distinct key per episode makes the series incomparable with the others, and
 * `product_events` is append-only, so an over-count cannot be repaired afterwards. Each client's
 * gate holds its own key, and this one keys on the reason alone: every emission comes from the one
 * cloud sync failure path, and these rows go out carrying no screen at all. The key cannot be read
 * off the rows — a column a row carries need not be part of what bounded it — so another client's
 * ceiling follows from its own gate rather than from this one.
 *
 * Touched from the sync paths and from `Analytics.reset()`, none of which may await, so it is
 * lock-protected rather than actor state.
 */
final class AnalyticsSyncFailureReporter: @unchecked Sendable {
    private let lock: NSLock
    /// The reasons already reported in the current failure episode.
    private var reportedReasons: Set<AnalyticsSyncFailureReason>

    init() {
        self.lock = NSLock()
        self.reportedReasons = []
    }

    /// True the first time a reason is seen in the current failure episode, and false while it
    /// persists.
    func shouldReport(reason: AnalyticsSyncFailureReason) -> Bool {
        self.lock.lock()
        defer {
            self.lock.unlock()
        }
        return self.reportedReasons.insert(reason).inserted
    }

    /// Ends the current episode, re-arming the next failure of every reason.
    func rearm() {
        self.lock.lock()
        defer {
            self.lock.unlock()
        }
        self.reportedReasons.removeAll()
    }
}
