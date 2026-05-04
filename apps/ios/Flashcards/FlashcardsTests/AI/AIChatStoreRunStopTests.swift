import XCTest
@testable import Flashcards

@MainActor
final class AIChatStoreRunStopTests: XCTestCase {
    func testNoopStopClearsStoppingAndReloadsBootstrap() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        let activeRun = AIChatStoreTestSupport.makeActiveRun()
        let replacementRun = AIChatActiveRun(
            runId: "run-2",
            status: activeRun.status,
            live: activeRun.live,
            lastHeartbeatAt: nil
        )
        store.chatSessionId = "session-1"
        store.conversationScopeId = "session-1"
        store.transitionToStreaming(
            activeRun: AIChatActiveRunSession(
                sessionId: "session-1",
                conversationScopeId: "session-1",
                runId: activeRun.runId,
                liveStream: activeRun.live.stream,
                liveCursor: activeRun.live.cursor,
                streamEpoch: nil
            )
        )
        store.persistStateSynchronously(state: store.currentPersistedState())
        context.chatService.stopRunHandler = { sessionId, runId in
            XCTAssertEqual(sessionId, "session-1")
            XCTAssertEqual(runId, "run-1")
            return AIChatStopRunResponse(
                sessionId: sessionId,
                stopped: false,
                stillRunning: true
            )
        }
        context.chatService.loadBootstrapHandler = { sessionId in
            XCTAssertEqual(sessionId, "session-1")
            return AIChatStoreTestSupport.makeConversationEnvelope(
                sessionId: "session-1",
                messages: [],
                activeRun: replacementRun
            )
        }

        store.cancelStreaming()

        let didSettle = await AIChatStoreTestSupport.waitForCondition(
            description: "noop stop bootstrap reconciliation",
            timeout: .seconds(3),
            pollInterval: .milliseconds(10),
            condition: {
                context.chatService.stopRunRequests.count == 1
                    && context.chatService.loadBootstrapSessionIds == ["session-1"]
                    && store.composerPhase == .running
                    && store.activeRunId == "run-2"
            }
        )

        XCTAssertTrue(didSettle)
        XCTAssertEqual(context.chatService.stopRunRequests.map { $0.runId }, ["run-1"])
        XCTAssertEqual(store.composerPhase, .running)
        XCTAssertEqual(store.activeRunId, "run-2")
    }

    /// Locks in the invariant that a stale stopRun response cannot clobber a
    /// run that started after the cancel was issued. The cancel-cleanup
    /// branches in `cancelStreaming` mutate `transitionToIdle` and active
    /// streaming markers; without the `composerPhase == .stopping` guard, an
    /// in-flight stop for run-A would wipe run-B's state when its response
    /// arrives.
    ///
    /// The race is forced deterministically by suspending the cancel Task at
    /// `stopRun` via a gate, transitioning to run-B from the test, then
    /// releasing the gate. After release, the cancel Task's body and its
    /// `defer`-scheduled persist are awaited explicitly so assertions run
    /// against the steady state — not a transient pre-clobber moment.
    func testStopRunResponseIsIgnoredWhenNewRunStartedDuringCancel() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        // Drain the constructor's defensive cancelStreaming pipeline before
        // the test sets up its own race, otherwise its incidental stopRun
        // call counts toward stopRunRequests and confuses the gate timing.
        await store.waitForPendingStatePersistence()

        let runA = AIChatStoreTestSupport.makeActiveRun()
        let runBSession = AIChatActiveRunSession(
            sessionId: "session-1",
            conversationScopeId: "session-1",
            runId: "run-2",
            liveStream: runA.live.stream,
            liveCursor: "cursor-2",
            streamEpoch: nil
        )
        store.chatSessionId = "session-1"
        store.conversationScopeId = "session-1"
        store.transitionToStreaming(
            activeRun: AIChatActiveRunSession(
                sessionId: "session-1",
                conversationScopeId: "session-1",
                runId: runA.runId,
                liveStream: runA.live.stream,
                liveCursor: runA.live.cursor,
                streamEpoch: nil
            )
        )
        store.persistStateSynchronously(state: store.currentPersistedState())

        let initialStopRunCount = context.chatService.stopRunRequests.count
        let stopRunGate = AIChatStoreTestSupport.AsyncGate()
        context.chatService.stopRunGate = stopRunGate
        // Default fake response is `stopped: true, stillRunning: false`,
        // which would trigger the cancel-cleanup branch and clobber run-B
        // without the new guard.

        store.cancelStreaming()

        // Wait until the test's cancel Task has reached the (blocked) stopRun
        // call, so we know the cancel pipeline is in-flight before we race a
        // new run against it.
        let didReachStopRun = await AIChatStoreTestSupport.waitForCondition(
            description: "stopRun observed by fake",
            timeout: .seconds(3),
            pollInterval: .milliseconds(10),
            condition: {
                context.chatService.stopRunRequests.count == initialStopRunCount + 1
            }
        )
        XCTAssertTrue(didReachStopRun)
        XCTAssertEqual(store.composerPhase, .stopping)

        // A new run starts before the cancel response lands.
        store.transitionToStreaming(activeRun: runBSession)
        XCTAssertEqual(store.composerPhase, .running)
        XCTAssertEqual(store.activeRunId, "run-2")

        await stopRunGate.release()

        // Yield MainActor so the just-resumed cancel Task continuation gets
        // a chance to run before the test resumes. In practice MainActor
        // processes the gate-released continuation ahead of the test's
        // re-enqueued continuation, so one yield is sufficient; Swift's
        // concurrency model doesn't formally guarantee this ordering, so if
        // a future runtime change makes this flaky, raise the yield count
        // or replace with an explicit settle-counter signal from the fake.
        //
        // The cancel Task body is synchronous after stopRun returns and its
        // `defer` always schedules a persist via schedulePersistCurrentState,
        // so once the body has run, waitForPendingStatePersistence is the
        // deterministic drain step.
        await Task.yield()
        await store.waitForPendingStatePersistence()

        XCTAssertEqual(
            store.activeRunId,
            "run-2",
            "stale stop-A cleanup must not clobber the freshly-streaming run-B"
        )
        XCTAssertEqual(store.composerPhase, .running)
        XCTAssertEqual(context.chatService.stopRunRequests.last?.runId, "run-1")
    }
}
