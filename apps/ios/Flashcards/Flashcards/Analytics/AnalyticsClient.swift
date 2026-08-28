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
     * Explicit logout or account switch.
     *
     * Queued events belong to the person who is leaving, so they are discarded here rather than
     * carried across the boundary: delivered later they would go out under whatever credential
     * exists then, and the server derives `user_id` from that credential onto an append-only table
     * with no repair path. There is deliberately no flush-before-logout trigger to rescue them —
     * an asynchronous flush started from this synchronous path is ordered after the credential is
     * cleared and delivers nothing. `anonymous_id` rotates here and nowhere else.
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
 * One event with everything captured at creation time: the surface, the network state a flush-time
 * reading could never report as `offline`, and the `anonymous_id` that was in effect.
 *
 * The id is the identity boundary stamp. It is a persisted value rather than an in-memory counter, so
 * an event that reaches the queue after a logout — or after a relaunch that followed one — is still
 * recognisable as belonging to the person who left, and is discarded instead of stamped with the
 * identity of whoever comes next.
 */
struct AnalyticsPendingEvent: Sendable, Equatable {
    let event: AnalyticsEvent
    let screen: AnalyticsSurface?
    let networkState: AnalyticsNetworkState
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
    private let session: URLSession
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private var credentialsProvider: AnalyticsCredentialsProvider?
    private var guestCredentialMinter: AnalyticsGuestCredentialMinter?
    private var hasSpentGuestCredentialMintAttempt: Bool
    private var flushTask: Task<Void, Never>?
    private var pendingDropCounts: [AnalyticsDroppedReason: Int]
    private var consecutiveDeferralCount: Int
    private var nextAttemptAt: Date?
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
        if let session {
            self.session = session
        } else {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForRequest = 20
            configuration.waitsForConnectivity = false
            self.session = URLSession(configuration: configuration)
        }
        self.encoder = JSONEncoder()
        self.decoder = JSONDecoder()
        self.credentialsProvider = nil
        self.guestCredentialMinter = nil
        self.hasSpentGuestCredentialMintAttempt = false
        self.flushTask = nil
        self.pendingDropCounts = [:]
        self.consecutiveDeferralCount = 0
        self.nextAttemptAt = nil
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
        if let nextAttemptAt = self.nextAttemptAt, Date() < nextAttemptAt {
            return
        }
        self.nextAttemptAt = nil
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

        let outcome = await self.send(
            anonymousId: anonymousId,
            sessionId: sessionId,
            payloads: payloads,
            credentials: credentials
        )

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

    private func send(
        anonymousId: String,
        sessionId: String,
        payloads: [AnalyticsEventPayload],
        credentials: AnalyticsCredentials
    ) async -> AnalyticsSendOutcome {
        // clientSentAt is stamped here, at the moment of the request, because the server derives
        // occurred_at from the interval between it and clientOccurredAt.
        let batch = AnalyticsBatchPayload(
            clientSentAt: analyticsTimestampString(date: Date()),
            anonymousId: anonymousId,
            sessionId: sessionId,
            context: analyticsClientContextPayload(),
            events: payloads
        )

        let request: URLRequest
        let body: Data
        do {
            body = try self.encoder.encode(batch)
            request = try makeAnalyticsIngestRequest(
                credentials: credentials,
                body: body
            )
        } catch {
            self.reportStoreFailure(error: error, stage: "encode")
            return .retryLater(retryAfterSeconds: nil, isServerError: false)
        }

        logAnalyticsOutgoingRequestIfEnabled(request: request, body: body)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await self.session.data(for: request)
        } catch {
            // Ordinary offline and transient transport failures are deliberately not reported: this
            // repository already silences them in every background capture path.
            return .retryLater(retryAfterSeconds: nil, isServerError: false)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            return .retryLater(retryAfterSeconds: nil, isServerError: false)
        }

        let retryAfterSeconds = analyticsRetryAfterSeconds(
            value: httpResponse.value(forHTTPHeaderField: "Retry-After")
        )
        logAnalyticsResponseIfEnabled(httpResponse: httpResponse, data: data)

        switch httpResponse.statusCode {
        case 200:
            guard let ingestResponse = try? self.decoder.decode(AnalyticsIngestResponse.self, from: data) else {
                // The batch was accepted even if the envelope could not be read, and redelivery is
                // safe but pointless, so the events are still finished.
                return .completed(rejectedCount: 0)
            }
            return .completed(rejectedCount: ingestResponse.rejected.count)
        case 400, 413:
            return .wholeBatchRefused
        case 401, 403, 410:
            return .credentialUnusable
        default:
            return .retryLater(
                retryAfterSeconds: retryAfterSeconds,
                isServerError: httpResponse.statusCode >= 500
            )
        }
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
        self.nextAttemptAt = now.addingTimeInterval(delaySeconds)
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

enum AnalyticsRequestError: LocalizedError, Equatable {
    case invalidIngestUrl(String)

    var errorDescription: String? {
        switch self {
        case .invalidIngestUrl(let apiBaseUrl):
            return "Analytics ingest URL could not be built from \(apiBaseUrl)"
        }
    }
}

private enum AnalyticsSendOutcome: Sendable {
    case completed(rejectedCount: Int)
    case wholeBatchRefused
    case retryLater(retryAfterSeconds: TimeInterval?, isServerError: Bool)
    case credentialUnusable
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

func analyticsRetryAfterSeconds(value: String?) -> TimeInterval? {
    guard let nanoseconds = cloudRetryAfterDelayNanoseconds(value: value) else {
        return nil
    }

    return min(analyticsRetryMaximumDelaySeconds, Double(nanoseconds) / 1_000_000_000)
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

/**
 * Builds the ingest request. The path is asserted rather than joined loosely: `POST
 * /v1/analytics/events/` answers 404 on purpose and also misses the endpoint's tighter throttle and
 * all three of its alarms, so a base URL that normalises to a trailing slash would lose every event
 * silently. `X-Client-Platform` and `X-Client-Version` are set per endpoint in this repository, and
 * `product_events` is append-only, so a batch shipped without them is unattributable forever.
 */
func makeAnalyticsIngestRequest(credentials: AnalyticsCredentials, body: Data) throws -> URLRequest {
    let trimmedBaseUrl = credentials.apiBaseUrl.hasSuffix("/")
        ? String(credentials.apiBaseUrl.dropLast())
        : credentials.apiBaseUrl
    guard let url = URL(string: "\(trimmedBaseUrl)\(analyticsEventsPath)"),
          url.path.hasSuffix("/") == false,
          url.path.hasSuffix(analyticsEventsPath) else {
        throw AnalyticsRequestError.invalidIngestUrl(credentials.apiBaseUrl)
    }

    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue(credentials.authorizationHeaderValue, forHTTPHeaderField: "Authorization")
    request.setValue(analyticsClientPlatformHeaderValue, forHTTPHeaderField: "X-Client-Platform")
    request.setValue(appMarketingVersion(), forHTTPHeaderField: "X-Client-Version")
    request.httpBody = body
    return request
}

/// Device context, describing the device at flush time.
func analyticsClientContextPayload() -> AnalyticsContextPayload {
    let operatingSystemVersion = ProcessInfo.processInfo.operatingSystemVersion
    return AnalyticsContextPayload(
        osVersion: "\(operatingSystemVersion.majorVersion).\(operatingSystemVersion.minorVersion).\(operatingSystemVersion.patchVersion)",
        deviceModel: analyticsDeviceModelIdentifier(),
        deviceLocale: Locale.current.identifier(.bcp47),
        timezone: TimeZone.current.identifier
    )
}

func analyticsDeviceModelIdentifier() -> String? {
    if let simulatorModel = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] {
        return simulatorModel
    }

    var systemInfo = utsname()
    guard uname(&systemInfo) == 0 else {
        return nil
    }

    let machine = systemInfo.machine
    let identifier = withUnsafePointer(to: machine) { pointer in
        pointer.withMemoryRebound(to: CChar.self, capacity: MemoryLayout.size(ofValue: machine)) { characters in
            String(cString: characters)
        }
    }
    return identifier.isEmpty ? nil : identifier
}

let analyticsRequestDebugLogEnvironmentKey: String = "FLASHCARDS_ANALYTICS_LOG_REQUEST"

/**
 * Prints the exact outgoing batch when the launch environment asks for it. This is how the wire format
 * is checked against a live endpoint — the path, both `X-Client-*` headers, the `Z` timestamps and the
 * version nibble of every `eventId` — rather than by reading the code that produced them. Off unless
 * the variable is set, and the catalog admits no free-text property, so the body carries no user data.
 */
func logAnalyticsOutgoingRequestIfEnabled(request: URLRequest, body: Data) {
    guard ProcessInfo.processInfo.environment[analyticsRequestDebugLogEnvironmentKey] != nil else {
        return
    }

    let headers = request.allHTTPHeaderFields ?? [:]
    let redactedHeaders = headers.map { key, value in
        "\(key)=\(key.lowercased() == "authorization" ? "<redacted>" : value)"
    }.sorted().joined(separator: " ")
    fputs("analytics_request url=\(request.url?.absoluteString ?? "-") \(redactedHeaders)\n", stderr)
    fputs("analytics_request_body \(String(decoding: body, as: UTF8.self))\n", stderr)
}

func logAnalyticsResponseIfEnabled(httpResponse: HTTPURLResponse, data: Data) {
    guard ProcessInfo.processInfo.environment[analyticsRequestDebugLogEnvironmentKey] != nil else {
        return
    }

    let requestId = httpResponse.value(forHTTPHeaderField: "X-Request-Id") ?? "-"
    fputs(
        "analytics_response status=\(httpResponse.statusCode) requestId=\(requestId) body=\(String(decoding: data, as: UTF8.self))\n",
        stderr
    )
}
