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
}
