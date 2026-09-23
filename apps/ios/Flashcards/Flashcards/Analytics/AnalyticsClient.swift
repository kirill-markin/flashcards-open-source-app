import Foundation

/// Everything the module needs to post a batch, read without touching the network.
struct AnalyticsCredentials: Sendable, Equatable {
    let apiBaseUrl: String
    let authorizationHeaderValue: String
}

/// Resolved on the main actor because the cloud session lives there. This runs on every flush and must
/// stay off the network: it never refreshes a token and never creates a session. Creation is the
/// separate, once-per-launch minter below.
///
/// It is not free of local side effects, and must not be described as one. Reading the stored guest
/// credential can persist the active cloud session into the credential record, sweep an analytics-only
/// marker that no longer describes it, and drop a record left behind by a different service
/// configuration. All of that is Keychain bookkeeping the provider contains; none of it is a user
/// action, a network call or a new identity.
typealias AnalyticsCredentialsProvider = @MainActor @Sendable () -> AnalyticsCredentials?

/// What one guest credential creation attempt produced.
enum AnalyticsGuestCredentialMintOutcome: Sendable {
    case minted(AnalyticsCredentials)
    /// Nothing was requested — the app may not create a guest credential in its current state, or the
    /// check itself could not be read. No server-side identity exists because of this attempt, so it
    /// costs nothing and a later flush may ask again.
    case skipped
    /// A creation was attempted and did not leave a usable credential behind. It may still have
    /// created a server-side identity, so this spends the launch's one attempt.
    case failed
}

/// Creates the guest credential an install with no cloud identity of its own authenticates with. It is
/// separate from the read above because it is the single piece of cloud work analytics may drive, and
/// it is bounded to one attempt per launch.
typealias AnalyticsGuestCredentialMinter = @MainActor @Sendable () async -> AnalyticsGuestCredentialMintOutcome

/**
 * The product analytics client.
 *
 * A user action must never be blocked, delayed or failed by anything in here. `track` is synchronous,
 * returns `Void`, is not `async` and never throws: it stamps the event and hands it to a background
 * actor, and every network path runs off the interaction path.
 */
enum Analytics {
    static let enabledState: AnalyticsEnabledState = AnalyticsEnabledState(isEnabled: true)
    static let foregroundState: AnalyticsForegroundState = AnalyticsForegroundState()
    static let networkMonitor: AnalyticsNetworkMonitor = AnalyticsNetworkMonitor()
    /// Shared with the runtime rather than owned by it, because the identity boundary has to be marked
    /// synchronously on the caller's thread while the queue work it guards runs on the actor.
    static let identity: AnalyticsIdentity = AnalyticsIdentity(userDefaults: .standard)
    static let runtime: AnalyticsRuntime = AnalyticsRuntime(
        queue: AnalyticsQueue(),
        identity: Analytics.identity
    )
    static let surfaceTracker: AnalyticsSurfaceTracker = AnalyticsSurfaceTracker()
    /// One reporter for the whole process, so a failure episode costs one event per reason no matter
    /// which sync surface noticed it.
    static let syncFailureReporter: AnalyticsSyncFailureReporter = AnalyticsSyncFailureReporter()

    /// Wires in credential resolution and starts the connectivity-restored flush trigger. Safe to call
    /// once at app start; it opens no store and performs no I/O of its own.
    static func configure(
        credentialsProvider: @escaping AnalyticsCredentialsProvider,
        guestCredentialMinter: @escaping AnalyticsGuestCredentialMinter
    ) {
        self.networkMonitor.start {
            Analytics.flush()
        }
        Task.detached(priority: .utility) {
            await self.runtime.setCredentialsProvider(credentialsProvider)
            await self.runtime.setGuestCredentialMinter(guestCredentialMinter)
            await self.runtime.flush()
        }
        Task.detached(priority: .utility) {
            // Periodic flush trigger. The other three — queue threshold, app backgrounded and
            // connectivity restored — are event driven; this one is what drains a queue that is below
            // the batch threshold and stays there.
            while Task.isCancelled == false {
                do {
                    try await Task.sleep(nanoseconds: UInt64(analyticsPeriodicFlushIntervalSeconds * 1_000_000_000))
                } catch {
                    return
                }
                await self.runtime.flush()
            }
        }
    }

    /**
     * Records one event. `screen` is the surface the user was on; it is a top-level wire field and is
     * ignored for `screen_viewed`, which carries its own.
     */
    static func track(_ event: AnalyticsEvent, screen: AnalyticsSurface? = nil) {
        guard let pendingEvent = self.makePendingEvent(event: event, screen: screen) else {
            return
        }

        Task.detached(priority: .utility) {
            await self.runtime.enqueue(pendingEvent)
        }
    }

    /// The process has been in the background. Recorded rather than acted on, because it is the
    /// precondition for the next foreground transition being a genuine return.
    static func recordAppBackgrounded() {
        self.foregroundState.recordBackgrounded()
    }

    /**
     * The warm `app_opened`, emitted on a real background → foreground transition and nothing else.
     *
     * `ScenePhase` is not usable as the signal: it drops to `.inactive` for the app switcher, Control
     * Center, the notification shade and system permission alerts — this app triggers one of those
     * itself with the notification pre-prompt — and returning from any of them would count as an app
     * open, permanently inflating an append-only table and making iOS incomparable with the web and
     * Android clients.
     *
     * A foreground transition is only a *return* if the process was in the background first, which is
     * what the recorded flag establishes. That is also what keeps a launch that begins in the
     * background — where `FlashcardsApp.init` emits the cold open — from having its first foreground
     * transition counted a second time. Whether iOS prewarming produces exactly that shape, and
     * whether it posts a background notification of its own along the way, is not established from
     * this repository and belongs in a device-level check.
     */
    static func trackAppForegrounded() {
        guard self.foregroundState.consumeBackgroundedReturn() else {
            return
        }

        self.track(.appOpened(launchType: .warm))
    }

    /// Everything an event carries is captured here, synchronously, on the caller's thread.
    private static func makePendingEvent(
        event: AnalyticsEvent,
        screen: AnalyticsSurface?
    ) -> AnalyticsPendingEvent? {
        guard self.enabledState.isEnabled() else {
            return nil
        }
        // A value the type system cannot pin down and the server would certainly reject. Spending a
        // queue slot and a batch on it would only turn a caller bug into lost neighbouring events.
        guard event.satisfiesCatalogValueConstraints else {
            return nil
        }

        return AnalyticsPendingEvent(
            event: event,
            screen: event.declaredScreen ?? screen,
            networkState: self.networkMonitor.currentState(),
            uiLocale: currentAppUILocaleIdentifier(),
            occurredAt: Date(),
            // Read now rather than at the queue write, so an event created before a logout cannot be
            // stamped with the next person's identity merely because its write is scheduled after
            // the reset.
            anonymousId: self.identity.currentAnonymousId()
        )
    }

    static func flush() {
        guard self.enabledState.isEnabled() else {
            return
        }

        Task.detached(priority: .utility) {
            await self.runtime.flush()
        }
    }

    /// Awaitable flush, for the one caller that has to keep the process alive until the batch is
    /// actually sent: the app going to the background.
    static func flushAndWait() async {
        guard self.enabledState.isEnabled() else {
            return
        }

        await self.runtime.flush()
    }

    /**
     * Records one event and waits, up to `analyticsPressedControlDrainBoundSeconds`, for the queue
     * to leave the device.
     *
     * The one exception to the rule above this type, and it is the whole point of the call: a person
     * pressed a control that is about to destroy the credential everything queued would go out on,
     * and `reset()` below then discards that queue. So this is the last moment those events can be
     * delivered, and the control shows ordinary loading feedback while it happens.
     *
     * Only a pressed control may call it, and only the two a person presses to leave an account.
     * The teardowns nobody pressed — an expired credential, an account context that came back
     * naming somebody else, a silent restore that did not resolve — have no control to show a wait
     * on and lose their queue, which the `signed_out` catalog entry states so the under-count is
     * visible to whoever reads the data. The credential-recovery erase is pressed and still does not
     * call it, for its own reason given in that entry: the credential it would drain with is the one
     * being erased, and where the recovery was entered because that credential is gone there is
     * nothing to drain with at all. `mintGuestCredentials` cannot stand in for it, here or on
     * Android: `isAnalyticsGuestCredentialMintEligible` refuses while a credential-recovery state is
     * stored, and `eraseLocalDataForCredentialRecovery` runs only while one is. Nothing may put this
     * call, or any other suspension, between a teardown's precondition and its clears.
     *
     * Recording and draining are one call on the runtime rather than two awaited ones: see
     * `AnalyticsRuntime.runPressedControlDrain` for why the event has to be stored before anything
     * already in flight is settled, and for the follow-up passes that make the returned wait mean
     * this event was actually attempted.
     */
    static func trackAndDrainForPressedControl(
        _ event: AnalyticsEvent,
        screen: AnalyticsSurface? = nil
    ) async {
        guard let pendingEvent = self.makePendingEvent(event: event, screen: screen) else {
            return
        }

        await self.waitWithinPressedControlBound { runtime in
            await runtime.runPressedControlDrain(pendingEvent: pendingEvent)
        }
    }

    /// The same bounded drain with nothing to record. Two callers: the account deletion, which
    /// reports no fact of its own here — the ingest refuses this credential with
    /// `410 ACCOUNT_DELETED` the moment the request below it returns — and a retried sign-out, whose
    /// row was already written and delivered by the attempt that threw. Both still owe the session's
    /// already-queued events one last chance to leave while the credential is alive.
    static func drainForPressedControl() async {
        guard self.enabledState.isEnabled() else {
            return
        }

        await self.waitWithinPressedControlBound { runtime in
            await runtime.runPressedControlDrain(pendingEvent: nil)
        }
    }

    /**
     * Runs `work` on the runtime and returns when it finishes or when the bound expires, whichever
     * comes first. The work is never cancelled: it keeps running afterwards, and this only stops
     * waiting for it, because a request already on the wire is better finished than abandoned.
     *
     * A task group cannot express that. Structured concurrency awaits every child before the group
     * returns, and the child holding this work cannot be made to return early: `AnalyticsRuntime.flush`
     * coalesces onto an unstructured `Task` and awaits its `value`, which responds to no
     * cancellation. One continuation, resumed by whichever of the two arrives first, is what
     * actually abandons the loser.
     */
    private static func waitWithinPressedControlBound(
        _ work: @escaping @Sendable (AnalyticsRuntime) async -> Void
    ) async {
        let gate = AnalyticsBoundedWaitGate()
        Task.detached(priority: .userInitiated) {
            await work(self.runtime)
            gate.open()
        }
        let boundTask = Task.detached(priority: .userInitiated) {
            do {
                try await Task.sleep(
                    nanoseconds: UInt64(analyticsPressedControlDrainBoundSeconds * 1_000_000_000)
                )
            } catch {
                // Cancelled below because the drain already won. Returning rather than swallowing
                // the error keeps the cancel meaningful: `try?` would open an already-open gate,
                // which is harmless but makes the line below describe something it does not do.
                return
            }
            gate.open()
        }
        await gate.wait()
        // The drain won, so the timer has nothing left to release.
        boundTask.cancel()
    }

    /**
     * Explicit logout or account switch.
     *
     * Queued events belong to the person who is leaving, so they are discarded here rather than
     * carried across the boundary: delivered later they would go out under whatever credential
     * exists then, and the server derives `user_id` from that credential onto an append-only table
     * with no repair path. Nothing rescues them from here, and nothing may try: an asynchronous
     * flush started from this synchronous path is ordered after the credential is cleared and
     * delivers nothing, and an awaited one would put a suspension inside the teardown, between its
     * precondition and its clears. The rescue lives at the pressed controls instead —
     * `trackAndDrainForPressedControl` and `drainForPressedControl` above, called before the
     * teardown starts. `anonymous_id` rotates here and nowhere else.
     *
     * The rotation, not the queue wipe, is what makes the boundary hold. It is persisted in
     * `UserDefaults` synchronously on the caller's thread before the wipe is even scheduled, and every
     * queued row carries the id it was written under, so a row from before this line is recognisable
     * as pre-boundary by comparing two persisted facts. A wipe refused by a full or failing disk, and
     * a process killed between the rotation and the wipe, both leave rows that the send path deletes
     * instead of posting.
     */
    static func reset() {
        self.identity.reset()
        // Suppression state belongs to the person who is leaving as much as the queue does: a reason
        // reported under the outgoing identity must not silence the first `sync_failed` of the next
        // one.
        self.syncFailureReporter.rearm()
        Task.detached(priority: .utility) {
            await self.runtime.resetIdentity()
        }
    }

    /// Kill switch, honoured immediately: a disabled client records nothing and sends nothing.
    static func setEnabled(_ enabled: Bool) {
        self.enabledState.setEnabled(enabled)
        guard enabled == false else {
            return
        }

        Task.detached(priority: .utility) {
            await self.runtime.discardQueue()
        }
    }
}

/**
 * A one-shot gate: whichever of two racing tasks opens it first releases the single waiter, and the
 * other one's later `open()` does nothing.
 *
 * A lock rather than an actor because `open()` is called from a detached task that must not have to
 * suspend to release somebody, and because the whole point is to resume exactly once — a check and a
 * resume that are not atomic would either resume twice, which traps, or never.
 */
final class AnalyticsBoundedWaitGate: @unchecked Sendable {
    private let lock: NSLock
    private var continuation: CheckedContinuation<Void, Never>?
    private var isOpen: Bool

    init() {
        self.lock = NSLock()
        self.continuation = nil
        self.isOpen = false
    }

    func open() {
        self.lock.lock()
        guard self.isOpen == false else {
            self.lock.unlock()
            return
        }

        self.isOpen = true
        let waiter = self.continuation
        self.continuation = nil
        self.lock.unlock()
        waiter?.resume()
    }

    func wait() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            self.lock.lock()
            guard self.isOpen == false else {
                self.lock.unlock()
                continuation.resume()
                return
            }

            self.continuation = continuation
            self.lock.unlock()
        }
    }
}

/// Read on the interaction path by `track`, so it is a lock rather than actor state.
final class AnalyticsEnabledState: @unchecked Sendable {
    private let lock: NSLock
    private var enabled: Bool

    init(isEnabled: Bool) {
        self.lock = NSLock()
        self.enabled = isEnabled
    }

    func isEnabled() -> Bool {
        self.lock.lock()
        defer {
            self.lock.unlock()
        }
        return self.enabled
    }

    func setEnabled(_ isEnabled: Bool) {
        self.lock.lock()
        defer {
            self.lock.unlock()
        }
        self.enabled = isEnabled
    }
}

/**
 * Whether the process has been in the background since the last warm open was recorded.
 *
 * One instance per process, read and written from the app lifecycle notifications, which is why it is
 * a lock rather than actor state: the notification arrives synchronously and must not schedule work to
 * decide whether an event happened. Consuming the flag also makes a repeated foreground notification
 * idempotent.
 */
final class AnalyticsForegroundState: @unchecked Sendable {
    private let lock: NSLock
    private var hasEnteredBackground: Bool

    init() {
        self.lock = NSLock()
        self.hasEnteredBackground = false
    }

    func recordBackgrounded() {
        self.lock.lock()
        defer {
            self.lock.unlock()
        }
        self.hasEnteredBackground = true
    }

    func consumeBackgroundedReturn() -> Bool {
        self.lock.lock()
        defer {
            self.lock.unlock()
        }
        guard self.hasEnteredBackground else {
            return false
        }

        self.hasEnteredBackground = false
        return true
    }
}

/**
 * The id is the identity boundary stamp. It is a persisted value rather than an in-memory counter, so
 * an event that reaches the queue after a logout — or after a relaunch that followed one — is still
 * recognisable as belonging to the person who left, and is discarded instead of stamped with the
 * identity of whoever comes next.
 */
struct AnalyticsPendingEvent: Sendable, Equatable {
    let event: AnalyticsEvent
    let screen: AnalyticsSurface?
    let networkState: AnalyticsNetworkState
    let uiLocale: String?
    let occurredAt: Date
    let anonymousId: String
}

private enum AnalyticsFlushDeferral: Sendable, Equatable {
    /// 429 and 5xx: keep everything and retry later.
    case retryAfter(TimeInterval?)
    /// 401, 403 and 410: keep the events queued against a future valid credential and do not spin.
    case credentialUnusable
}

/// The one store-failure stage that is never rate limited: it is the difference between the outgoing
/// person's queue being discarded and it being posted under the next person's credential.
private let analyticsIdentityResetFailureStage: String = "identity_reset"

private struct AnalyticsDeliveryResult: Sendable {
    var settledEventIds: [String] = []
    var rejectedCount: Int = 0
    var invalidBatchCount: Int = 0
    var serverErrorCount: Int = 0
    var deferral: AnalyticsFlushDeferral?
}

actor AnalyticsRuntime {
    private let queue: AnalyticsQueue
    private let identity: AnalyticsIdentity
    private let transport: AnalyticsTransport
    private var credentialsProvider: AnalyticsCredentialsProvider?
    private var guestCredentialMinter: AnalyticsGuestCredentialMinter?
    private var hasSpentGuestCredentialMintAttempt: Bool
    private var flushTask: Task<Void, Never>?
    private var pendingDropCounts: [AnalyticsDroppedReason: Int]
    private var consecutiveDeferralCount: Int
    private var nextAttemptAt: Date?
    /// The part of `nextAttemptAt` the server asked for with `Retry-After`. Only the pressed-control
    /// drain reads it, and only to leave that part alone while it clears the rest.
    private var serverDirectedNextAttemptAt: Date?
    /// Whether the last `runFlush` stopped with work still queued *after* delivering something. Only
    /// the pressed-control drain reads it, to decide whether another pass is worth running.
    private var lastFlushLeftQueuedRemainder: Bool
    private var consecutiveInvalidBatchCount: Int
    private var firstServerErrorAt: Date?
    private var reportedOverflowThisSession: Bool
    private var reportedExpiryThisSession: Bool
    private var reportedStoreFailureStages: Set<String>
    private var reportedInvalidBatchThisSession: Bool
    private var reportedSustainedServerErrorThisSession: Bool
    private var identityBoundaryDiscardedCount: Int

    init(queue: AnalyticsQueue, identity: AnalyticsIdentity, session: URLSession? = nil) {
        self.queue = queue
        self.identity = identity
        self.transport = AnalyticsTransport(session: session)
        self.credentialsProvider = nil
        self.guestCredentialMinter = nil
        self.hasSpentGuestCredentialMintAttempt = false
        self.flushTask = nil
        self.pendingDropCounts = [:]
        self.consecutiveDeferralCount = 0
        self.nextAttemptAt = nil
        self.serverDirectedNextAttemptAt = nil
        self.lastFlushLeftQueuedRemainder = false
        self.consecutiveInvalidBatchCount = 0
        self.firstServerErrorAt = nil
        self.reportedOverflowThisSession = false
        self.reportedExpiryThisSession = false
        self.reportedStoreFailureStages = []
        self.reportedInvalidBatchThisSession = false
        self.reportedSustainedServerErrorThisSession = false
        self.identityBoundaryDiscardedCount = 0
    }

    func setCredentialsProvider(_ provider: @escaping AnalyticsCredentialsProvider) {
        self.credentialsProvider = provider
    }

    func setGuestCredentialMinter(_ minter: @escaping AnalyticsGuestCredentialMinter) {
        self.guestCredentialMinter = minter
    }

    func enqueue(_ pendingEvent: AnalyticsPendingEvent) async {
        let queuedEventCount = self.store(pendingEvent: pendingEvent)
        guard let queuedEventCount, queuedEventCount >= analyticsFlushBatchThreshold else {
            return
        }

        await self.flush()
    }

    func flush() async {
        if let flushTask = self.flushTask {
            await flushTask.value
            return
        }

        let flushTask: Task<Void, Never> = Task { [weak self] in
            guard let self else {
                return
            }

            await self.runFlush()
            // Cleared from inside the task, so the handle is already gone once its value becomes
            // available. Clearing it in the first waiter instead leaves a window in which a second
            // caller awaits an already finished task and returns having flushed nothing — which the
            // backgrounded app's `flushAndWait` would silently spend its background window on.
            await self.clearFlushTask()
        }
        self.flushTask = flushTask
        await flushTask.value
    }

    private func clearFlushTask() {
        self.flushTask = nil
    }

    /**
     * The identity boundary's cleanup. Contract §6: queued events must never be carried across it, and
     * the discard is reported through the app's own observability rather than as an
     * `analytics_events_dropped` reason — `rejected` has to keep meaning a real server refusal.
     *
     * `Analytics.reset()` has already rotated `anonymous_id`, so this is a best-effort sweep of rows
     * the new id no longer owns rather than the boundary itself. If it throws, or never runs because
     * the process died, the same sweep runs again before the next batch is selected and those rows are
     * deleted there instead of sent.
     *
     * The delivery state is deliberately not reset with the identity: `consecutiveDeferralCount`,
     * `nextAttemptAt` and `serverDirectedNextAttemptAt` all carry over, so the next identity on this
     * install can inherit a backoff curve several attempts deep and an armed deadline. That is the
     * right way round — the backoff describes this device's transport and this server's pressure,
     * neither of which changed because the person did, and a `Retry-After` in particular is not
     * something a new identity may ignore. The cost is that the next identity's first events can
     * wait behind a delay they did not earn. The pressed-control drain clears the self-chosen half
     * of it and nothing else does: unlike Android's, this client's connectivity trigger only asks
     * for a flush, which still returns at the guard until the delay elapses.
     */
    func resetIdentity() {
        // The next identity gets its own creation attempt: the credential this install had belongs to
        // the person who left and is cleared with the rest of their state.
        self.hasSpentGuestCredentialMintAttempt = false
        let anonymousId = self.identity.currentAnonymousId()
        do {
            let discardedEventCount = try self.queueRemoveEvents(notOwnedByAnonymousId: anonymousId)
            self.identityBoundaryDiscardedCount += discardedEventCount
        } catch {
            self.reportStoreFailure(error: error, stage: analyticsIdentityResetFailureStage)
        }
        // Losses counted for the outgoing identity would otherwise be emitted as the next identity's
        // `analytics_events_dropped`. Clearing all of them can undercount a drop that happened in the
        // gap between the rotation and this sweep, which is the direction this system prefers.
        self.pendingDropCounts = [:]
        self.reportIdentityBoundaryDiscardIfNeeded()
    }

    private func reportIdentityBoundaryDiscardIfNeeded() {
        let discardedCount = self.identityBoundaryDiscardedCount
        guard discardedCount > 0 else {
            return
        }

        self.identityBoundaryDiscardedCount = 0
        self.reportWarning(action: "analytics_identity_boundary_discarded", count: discardedCount)
    }

    func discardQueue() {
        do {
            try self.queueRemoveAll()
        } catch {
            self.reportStoreFailure(error: error, stage: "discard")
        }
        self.pendingDropCounts = [:]
    }

    // MARK: - Queue writes

    @discardableResult
    private func store(pendingEvent: AnalyticsPendingEvent) -> Int? {
        let occurredAt = pendingEvent.occurredAt
        // The identity boundary, checked against the id the event was created under. A mismatch means
        // the event was created before a logout and is only reaching the queue after it, so it belongs
        // to the person who left and is discarded with the rest of their queue.
        guard let identitySnapshot = self.identity.identityForEmittedEvent(
            now: occurredAt,
            requiredAnonymousId: pendingEvent.anonymousId
        ) else {
            self.identityBoundaryDiscardedCount += 1
            return nil
        }

        let payload = AnalyticsEventPayload(
            eventId: makeAnalyticsEventId(now: occurredAt),
            eventName: pendingEvent.event.eventName,
            clientOccurredAt: analyticsTimestampString(date: occurredAt),
            networkState: pendingEvent.networkState.rawValue,
            uiLocale: pendingEvent.uiLocale,
            screen: pendingEvent.screen?.rawValue,
            properties: pendingEvent.event.properties,
            // The product has no experiment system yet, and the field is a flat string map when it
            // does. Sending null is the whole contract for it today.
            experimentAssignments: nil
        )

        do {
            let outcome = try self.queueAppend(
                event: AnalyticsQueuedEvent(
                    anonymousId: identitySnapshot.anonymousId,
                    sessionId: identitySnapshot.sessionId,
                    payload: payload
                ),
                now: occurredAt
            )
            self.recordDrops(
                reason: .queueOverflow,
                count: outcome.overflowDroppedCount,
                owningAnonymousId: identitySnapshot.anonymousId
            )
            self.recordDrops(
                reason: .ttlExpired,
                count: outcome.expiredDroppedCount,
                owningAnonymousId: identitySnapshot.anonymousId
            )
            return outcome.queuedEventCount
        } catch {
            self.reportStoreFailure(error: error, stage: "append")
            return nil
        }
    }

    private func recordDrops(reason: AnalyticsDroppedReason, count: Int, owningAnonymousId: String) {
        guard count > 0 else {
            return
        }
        // A loss belongs to the identity that suffered it. `deliver` suspends, so an identity boundary
        // can land while a batch is in flight; the rejection count that comes back then describes the
        // previous person's loss, and re-accumulating it here would drain it into an
        // `analytics_events_dropped` stamped with the next person's identity.
        guard owningAnonymousId == self.identity.currentAnonymousId() else {
            return
        }

        self.pendingDropCounts[reason, default: 0] += count
        switch reason {
        case .queueOverflow:
            guard self.reportedOverflowThisSession == false else {
                return
            }
            self.reportedOverflowThisSession = true
            self.reportWarning(action: "analytics_queue_overflow", count: count)
        case .ttlExpired:
            guard self.reportedExpiryThisSession == false else {
                return
            }
            self.reportedExpiryThisSession = true
            self.reportWarning(action: "analytics_queue_ttl_expired", count: count)
        case .rejected:
            // Per-event rejections are not reported from the client: the server already captures
            // contract violations with cross-client grouping, and the counted loss travels in the
            // data itself as analytics_events_dropped.
            return
        }
    }

    /// Turns accumulated losses into real events so the loss is visible in the data rather than only
    /// in server-side telemetry. `occurred_at_out_of_window` rejections are deliberately excluded from
    /// server-side Sentry reporting, so this is the only place they are ever counted.
    private func drainPendingDropEvents(now: Date, anonymousId: String) {
        let pendingDropCounts = self.pendingDropCounts
        guard pendingDropCounts.isEmpty == false else {
            return
        }

        self.pendingDropCounts = [:]
        for (reason, count) in pendingDropCounts where count > 0 {
            self.store(
                pendingEvent: AnalyticsPendingEvent(
                    event: .analyticsEventsDropped(reason: reason, count: count),
                    screen: nil,
                    networkState: Analytics.networkMonitor.currentState(),
                    uiLocale: currentAppUILocaleIdentifier(),
                    occurredAt: now,
                    anonymousId: anonymousId
                )
            )
        }
    }

    // MARK: - Flush

    private func runFlush() async {
        guard Analytics.enabledState.isEnabled() else {
            return
        }
        // Set before the first exit, so every early return below leaves it false: a pass that
        // delivered nothing is a pass another pass would repeat.
        self.lastFlushLeftQueuedRemainder = false
        if let nextAttemptAt = self.nextAttemptAt, Date() < nextAttemptAt {
            return
        }
        self.nextAttemptAt = nil
        self.serverDirectedNextAttemptAt = nil
        self.reportIdentityBoundaryDiscardIfNeeded()

        do {
            // The boundary sweep runs before the TTL sweep so a row that outlived a failed or
            // never-run identity wipe is counted as a boundary discard rather than as this identity's
            // TTL loss. The TTL count is kept, not thrown away: this is the sweep a real expiry lands
            // on, because the launch flush runs before any `track` and would otherwise clear a queue
            // that aged out during a long offline or unauthenticated stretch in complete silence.
            let boundaryAnonymousId = self.identity.currentAnonymousId()
            self.identityBoundaryDiscardedCount += try self.queueRemoveEvents(
                notOwnedByAnonymousId: boundaryAnonymousId
            )
            let expiredEventCount = try self.queueRemoveExpired(now: Date())
            self.recordDrops(
                reason: .ttlExpired,
                count: expiredEventCount,
                owningAnonymousId: boundaryAnonymousId
            )
        } catch {
            self.reportStoreFailure(error: error, stage: "expire")
        }

        // The drain is bounded. A batch refused at the envelope level is dropped and reported as
        // `analytics_events_dropped`, and that report can be refused in turn, so an unbounded loop
        // is one POST per iteration forever on a single device — enough to consume the endpoint's
        // whole 20 rps method throttle for every other client. Whatever the cap leaves behind is
        // picked up by the next trigger.
        var drainIterationCount = 0
        while Task.isCancelled == false, drainIterationCount < analyticsMaximumDrainIterationsPerFlush {
            // Re-read, not read once at the top: the loop suspends at the credential read and at the
            // delivery, and `setEnabled(false)` only flips this flag and schedules a discard, which
            // cannot recall a batch this flush has already loaded. Whatever is left behind stays
            // queued for the discard to remove.
            guard Analytics.enabledState.isEnabled() else {
                return
            }
            drainIterationCount += 1
            let anonymousIdBeforeCredentials = self.identity.currentAnonymousId()
            self.drainPendingDropEvents(now: Date(), anonymousId: anonymousIdBeforeCredentials)

            guard let credentials = await self.resolveCredentials(anonymousId: anonymousIdBeforeCredentials) else {
                // Never send unauthenticated. The events wait under the queue TTL and the server's
                // 30-day window, so an ordinary sign-up delay costs nothing.
                return
            }

            // The credential read suspends, so an identity boundary can land between it and the batch
            // load. Only a matched pair may be sent: otherwise the outgoing credential carries the next
            // person's events, or the next credential carries the outgoing person's. Both halves are
            // persisted values, so this holds across a relaunch as well as across a suspension.
            let anonymousId = self.identity.currentAnonymousId()
            guard anonymousId == anonymousIdBeforeCredentials else {
                continue
            }

            let batchLoad: AnalyticsQueueBatchLoad
            do {
                // Selecting a batch also deletes every row the current `anonymous_id` does not own, so
                // a batch can only ever be composed of rows that are still on this side of the
                // boundary.
                batchLoad = try self.queueLoadNextBatch(
                    limit: analyticsMaximumEventsPerBatch,
                    anonymousId: anonymousId
                )
            } catch {
                self.reportStoreFailure(error: error, stage: "read")
                return
            }
            self.identityBoundaryDiscardedCount += batchLoad.boundaryDiscardedCount
            guard let batch = batchLoad.batch else {
                return
            }

            // The last check before anything leaves the device: an opt-out that landed while the batch
            // was being loaded must stop this post, not the next one.
            guard Analytics.enabledState.isEnabled() else {
                return
            }

            let result = await self.deliver(
                anonymousId: batch.anonymousId,
                sessionId: batch.sessionId,
                payloads: batch.payloads,
                credentials: credentials
            )

            do {
                // On a 200 every event in the batch is finished, accepted or rejected alike: rejected
                // events are permanently refused and resending them changes nothing. Purge by what was
                // sent, because a rejection may carry a null event id.
                try self.queueDelete(eventIds: result.settledEventIds)
            } catch {
                self.reportStoreFailure(error: error, stage: "delete")
                return
            }

            self.recordDrops(
                reason: .rejected,
                count: result.rejectedCount,
                owningAnonymousId: batch.anonymousId
            )
            self.updateInvalidBatchReporting(invalidBatchCount: result.invalidBatchCount)
            self.updateServerErrorReporting(serverErrorCount: result.serverErrorCount, now: Date())

            if let deferral = result.deferral {
                self.applyDeferral(deferral, now: Date())
                return
            }

            self.consecutiveDeferralCount = 0
            guard result.settledEventIds.isEmpty == false else {
                return
            }
        }

        // Reached only by exhausting the iteration cap or by cancellation, which ordinarily means
        // every iteration settled a batch and stopped short of emptying the queue: the one exit
        // where running the flush again would make further progress. One iteration does not settle
        // anything and still counts — the identity-mismatch `continue` above — so a run that only
        // ever took that branch exhausts the cap and sets this having delivered nothing. That stays
        // bounded by the drain's own pass limit and by the caller's wait, and the flag still means
        // what the pressed-control drain reads it as: another pass is worth running.
        self.lastFlushLeftQueuedRemainder = true
    }

    /**
     * The whole pressed-control drain, as one call on this actor.
     *
     * Recording the event and flushing are one unit here rather than two awaited calls from the
     * caller, so nothing can interleave between the queue write and the first pass.
     *
     * Three things the plain `flush()` does not do, and each of them is why this exists:
     *
     * 1. Whatever was already in flight is settled first. `flush()` coalesces onto an in-flight
     *    task and returns its value, and that task may have selected its batch before this event
     *    was stored — so on its own it can return having never seen the event the caller is waiting
     *    for. Settling it first means every pass below starts after the write.
     * 2. A backoff this client chose itself is dropped, after that settling, so a failure inside
     *    the in-flight flush cannot re-park the passes. See `clearSelfChosenDeliveryBackoff`.
     * 3. It runs a pass of its own unconditionally, and keeps running passes while one keeps
     *    making progress, up to `analyticsPressedControlDrainPassLimit`. Unconditionally because
     *    the flush settled in 1 may have touched the queue not at all — it can return at the
     *    backoff guard 2 has just lifted, on a deferral, or on a store error — so its remainder
     *    flag is no answer to whether this event was attempted. One flush is also capped at
     *    `analyticsMaximumDrainIterationsPerFlush` batches, and a backlog larger than that would
     *    otherwise be left behind at the one moment it can never be retried.
     *
     * Every pass is still subject to the caller's wait bound, which abandons the waiting rather
     * than the work.
     */
    func runPressedControlDrain(pendingEvent: AnalyticsPendingEvent?) async {
        if let pendingEvent {
            _ = self.store(pendingEvent: pendingEvent)
        }

        await self.flush()
        self.clearSelfChosenDeliveryBackoff()

        // The first pass is unconditional, and that is the whole reason the loop is shaped this way
        // rather than as a `while`. `lastFlushLeftQueuedRemainder` describes the flush settled just
        // above, and every way that flush can end without emptying the queue leaves it false with
        // the pressed event still waiting: the backoff guard in `runFlush`, which is exactly what
        // the clear above has just lifted; a deferral; a store error; or coalescing onto an
        // in-flight flush that ended in any of those. Testing the flag before running anything would
        // then clear the backoff and run no pass at all, at the one moment nothing can be retried.
        // This is the web's shape in `runDrainPasses`.
        for _ in 0..<analyticsPressedControlDrainPassLimit {
            await self.flush()
            if self.lastFlushLeftQueuedRemainder == false {
                return
            }
        }
    }

    /// The credential this batch goes out under: the one the app already holds, or the guest credential
    /// created for an install that has none.
    private func resolveCredentials(anonymousId: String) async -> AnalyticsCredentials? {
        if let credentials = await self.currentCredentials() {
            return credentials
        }

        return await self.mintGuestCredentials(anonymousId: anonymousId)
    }

    private func currentCredentials() async -> AnalyticsCredentials? {
        guard let credentialsProvider = self.credentialsProvider else {
            return nil
        }

        return await credentialsProvider()
    }

    /**
     * One creation attempt per launch, and only against events that are actually waiting.
     *
     * Every mint is a permanent server-side user, workspace and membership, so a failure waits for the
     * next launch rather than spinning, and a launch that recorded nothing creates nothing. The
     * persisted idempotency key makes that later attempt reuse the identity rather than duplicate it,
     * and the events stay queued either way.
     *
     * `queueHasPendingEvents` counts TTL-expired rows, so this must stay behind the expiry sweep at
     * the top of `runFlush`. Ahead of it, a queue of nothing but rows about to be deleted would buy a
     * permanent guest identity for events that are never sent.
     */
    private func mintGuestCredentials(anonymousId: String) async -> AnalyticsCredentials? {
        // A mint is a permanent server-side user, workspace and membership, so an opt-out that landed
        // mid-flush must not buy one for a person who has just asked to be left alone.
        guard Analytics.enabledState.isEnabled() else {
            return nil
        }
        guard self.hasSpentGuestCredentialMintAttempt == false,
              let guestCredentialMinter = self.guestCredentialMinter else {
            return nil
        }

        do {
            guard try self.queueHasPendingEvents(anonymousId: anonymousId) else {
                return nil
            }
        } catch {
            self.reportStoreFailure(error: error, stage: "pending_read")
            return nil
        }

        switch await guestCredentialMinter() {
        case .minted(let credentials):
            self.hasSpentGuestCredentialMintAttempt = true
            return credentials
        case .failed:
            self.hasSpentGuestCredentialMintAttempt = true
            return nil
        case .skipped:
            return nil
        }
    }

    /**
     * Posts one request and, on a whole-batch refusal, halves and retries. `400` and `413` carry no
     * per-event report and retrying the same bytes fails identically forever, so the same convergent
     * rule serves both: split a multi-event batch, drop a single-event batch and count it. That
     * terminates and cannot wedge the queue behind a poison event.
     */
    private func deliver(
        anonymousId: String,
        sessionId: String,
        payloads: [AnalyticsEventPayload],
        credentials: AnalyticsCredentials
    ) async -> AnalyticsDeliveryResult {
        guard payloads.isEmpty == false else {
            return AnalyticsDeliveryResult()
        }

        let outcome: AnalyticsSendOutcome
        do {
            outcome = try await self.transport.send(
                anonymousId: anonymousId,
                sessionId: sessionId,
                payloads: payloads,
                credentials: credentials
            )
        } catch {
            self.reportStoreFailure(error: error, stage: "encode")
            outcome = .retryLater(retryAfterSeconds: nil, isServerError: false)
        }

        // A refused `analytics_events_dropped` must never produce a replacement: the replacement is
        // refused for the same reason, which counts as another drop, and the net queue change is
        // zero while the device keeps posting. Capping the reported rejections at the number of
        // ordinary events in the batch makes every drop event terminal, and can only ever undercount
        // — the trade this system prefers over misattribution.
        let reportableRejectionLimit = payloads.filter { payload in
            payload.eventName != analyticsEventsDroppedEventName
        }.count

        switch outcome {
        case .completed(let rejectedCount):
            var result = AnalyticsDeliveryResult()
            result.settledEventIds = payloads.map { payload in
                payload.eventId
            }
            result.rejectedCount = min(rejectedCount, reportableRejectionLimit)
            return result
        case .wholeBatchRefused:
            var result = AnalyticsDeliveryResult()
            result.invalidBatchCount = 1
            guard payloads.count > 1 else {
                result.settledEventIds = payloads.map { payload in
                    payload.eventId
                }
                result.rejectedCount = min(1, reportableRejectionLimit)
                return result
            }

            let midpoint = payloads.count / 2
            let firstResult = await self.deliver(
                anonymousId: anonymousId,
                sessionId: sessionId,
                payloads: Array(payloads[0..<midpoint]),
                credentials: credentials
            )
            result = self.combine(result, firstResult)
            guard result.deferral == nil else {
                return result
            }

            let secondResult = await self.deliver(
                anonymousId: anonymousId,
                sessionId: sessionId,
                payloads: Array(payloads[midpoint...]),
                credentials: credentials
            )
            return self.combine(result, secondResult)
        case .retryLater(let retryAfterSeconds, let isServerError):
            var result = AnalyticsDeliveryResult()
            result.deferral = .retryAfter(retryAfterSeconds)
            result.serverErrorCount = isServerError ? 1 : 0
            return result
        case .credentialUnusable:
            var result = AnalyticsDeliveryResult()
            result.deferral = .credentialUnusable
            return result
        }
    }

    private func combine(
        _ lhs: AnalyticsDeliveryResult,
        _ rhs: AnalyticsDeliveryResult
    ) -> AnalyticsDeliveryResult {
        var combined = AnalyticsDeliveryResult()
        combined.settledEventIds = lhs.settledEventIds + rhs.settledEventIds
        combined.rejectedCount = lhs.rejectedCount + rhs.rejectedCount
        combined.invalidBatchCount = lhs.invalidBatchCount + rhs.invalidBatchCount
        combined.serverErrorCount = lhs.serverErrorCount + rhs.serverErrorCount
        combined.deferral = lhs.deferral ?? rhs.deferral
        return combined
    }

    // MARK: - Backoff and reporting

    private func applyDeferral(_ deferral: AnalyticsFlushDeferral, now: Date) {
        let retryAfterSeconds: TimeInterval?
        switch deferral {
        case .credentialUnusable:
            // 401, 403 and 410 are paced like every other refusal, because the contract says do not
            // spin: unpaced, a queue sitting at the batch threshold issues one refused POST per
            // tracked event, which is what a deleted account answering 410 does on every single user
            // interaction, indefinitely. The events stay queued against a future valid credential.
            retryAfterSeconds = nil
        case .retryAfter(let seconds):
            // Retry-After is an optimisation, never a precondition: only the analytics writer's own
            // saturation refusal carries it, and the API Gateway throttle never does.
            retryAfterSeconds = seconds
        }

        self.consecutiveDeferralCount += 1
        let delaySeconds = retryAfterSeconds ?? analyticsBackoffDelaySeconds(
            attempt: self.consecutiveDeferralCount
        )
        let nextAttemptAt = now.addingTimeInterval(delaySeconds)
        self.nextAttemptAt = nextAttemptAt
        // Split out so `clearSelfChosenDeliveryBackoff` can tell the two apart. Every deferral with
        // no `Retry-After` is a delay this client picked for itself.
        self.serverDirectedNextAttemptAt = retryAfterSeconds == nil ? nil : nextAttemptAt
    }

    /**
     * Drops a delay this client chose for itself, and only that.
     *
     * After a transient `5xx` or an offline stretch the local backoff walks out to
     * `analyticsRetryMaximumDelaySeconds`, and the pressed-control drain would then return at the
     * guard in `runFlush` with perfect connectivity — at the one moment these events can never be
     * retried, because the credential they would go out under is about to be destroyed. A
     * `Retry-After` the server sent is kept: that one is not ours to ignore, and these events are
     * not worth pushing through a throttle for. Android clears the same way at the top of
     * `handleDrain`, and the web in `runDrainPasses`. On all three the clear is only half of it:
     * the pass after it has to run whether or not the flush before it delivered anything, or a
     * cleared backoff buys nothing. Android's `handleDrain` calls `handleFlush` straight after the
     * clear, the web's first loop iteration is unconditional, and so is the first iteration in
     * `runPressedControlDrain`.
     *
     * `consecutiveDeferralCount` is deliberately not reset, so the next real deferral resumes the
     * backoff curve where it left off rather than restarting it.
     */
    private func clearSelfChosenDeliveryBackoff() {
        let now = Date()
        guard let nextAttemptAt = self.nextAttemptAt, now < nextAttemptAt else {
            return
        }
        if let serverDirectedNextAttemptAt = self.serverDirectedNextAttemptAt, now < serverDirectedNextAttemptAt {
            return
        }

        self.nextAttemptAt = nil
        self.serverDirectedNextAttemptAt = nil
    }

    private func updateInvalidBatchReporting(invalidBatchCount: Int) {
        guard invalidBatchCount > 0 else {
            self.consecutiveInvalidBatchCount = 0
            return
        }

        self.consecutiveInvalidBatchCount += invalidBatchCount
        guard self.consecutiveInvalidBatchCount >= 3, self.reportedInvalidBatchThisSession == false else {
            return
        }

        // A repeated whole-batch 400 means this client is off contract in a way that costs every event
        // it sends, which is worth exactly one report.
        self.reportedInvalidBatchThisSession = true
        self.reportWarning(action: "analytics_invalid_batch_repeated", count: self.consecutiveInvalidBatchCount)
    }

    private func updateServerErrorReporting(serverErrorCount: Int, now: Date) {
        guard serverErrorCount > 0 else {
            self.firstServerErrorAt = nil
            return
        }

        let firstServerErrorAt = self.firstServerErrorAt ?? now
        self.firstServerErrorAt = firstServerErrorAt
        guard now.timeIntervalSince(firstServerErrorAt) > 3_600,
              self.reportedSustainedServerErrorThisSession == false else {
            return
        }

        self.reportedSustainedServerErrorThisSession = true
        self.reportWarning(action: "analytics_sustained_server_error", count: serverErrorCount)
    }

    /**
     * The local store failing to open, write or read is the one failure nothing else can see, so it is
     * the one this module reports itself.
     *
     * Reported once per stage rather than once per session. A single session-wide flag let one earlier
     * benign append failure swallow the report for a failed identity-boundary sweep, which is the
     * failure that decides whether the previous person's events can still be posted; the boundary
     * stage is not rate limited at all, because it can only happen once per logout.
     */
    private func reportStoreFailure(error: Error, stage: String) {
        if stage != analyticsIdentityResetFailureStage {
            guard self.reportedStoreFailureStages.contains(stage) == false else {
                return
            }
        }

        self.reportedStoreFailureStages.insert(stage)
        FlashcardsObservability.captureSilentFailure(
            error: error,
            scope: analyticsObservationScope(),
            action: "analytics_queue_store_failed",
            stage: stage,
            statusCode: nil,
            backendCode: nil,
            requestId: nil
        )
    }

    private func reportWarning(action: String, count: Int) {
        FlashcardsObservability.captureSilentFailure(
            error: AnalyticsConditionReport(action: action, count: count),
            scope: analyticsObservationScope(),
            action: action,
            stage: String(count),
            statusCode: nil,
            backendCode: nil,
            requestId: nil
        )
    }

    // MARK: - Queue bridge

    private func queueAppend(event: AnalyticsQueuedEvent, now: Date) throws -> AnalyticsQueueAppendOutcome {
        try self.queue.append(event: event, now: now)
    }

    private func queueRemoveExpired(now: Date) throws -> Int {
        try self.queue.removeExpired(now: now)
    }

    private func queueLoadNextBatch(limit: Int, anonymousId: String) throws -> AnalyticsQueueBatchLoad {
        try self.queue.loadNextBatch(limit: limit, anonymousId: anonymousId)
    }

    private func queueHasPendingEvents(anonymousId: String) throws -> Bool {
        try self.queue.hasPendingEvents(anonymousId: anonymousId)
    }

    private func queueRemoveEvents(notOwnedByAnonymousId anonymousId: String) throws -> Int {
        try self.queue.removeEvents(notOwnedByAnonymousId: anonymousId)
    }

    private func queueDelete(eventIds: [String]) throws {
        try self.queue.delete(eventIds: eventIds)
    }

    @discardableResult
    private func queueRemoveAll() throws -> Int {
        try self.queue.removeAll()
    }
}

/// A condition worth exactly one report through the existing observability layer, carried as an error
/// because that is the shape `captureSilentFailure` takes.
struct AnalyticsConditionReport: LocalizedError, Equatable {
    let action: String
    let count: Int

    var errorDescription: String? {
        "\(self.action) count=\(self.count)"
    }
}

/// Exponential backoff with full jitter, capped at one hour.
func analyticsBackoffDelaySeconds(attempt: Int) -> TimeInterval {
    let exponent = min(max(0, attempt - 1), 16)
    let ceiling = min(
        analyticsRetryMaximumDelaySeconds,
        analyticsRetryBaseDelaySeconds * pow(2, Double(exponent))
    )
    return Double.random(in: 0...ceiling)
}

func analyticsObservationScope() -> IOSObservationScope {
    IOSObservationScope(
        feature: .analytics,
        userId: nil,
        workspaceId: nil,
        requestId: nil,
        clientRequestId: nil,
        sessionId: nil,
        runId: nil,
        cloudState: nil,
        configurationMode: nil
    )
}
