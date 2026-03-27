import Foundation
import XCTest
@testable import Flashcards

final class AIChatStoreFlowTests: AIChatTestCaseBase {
    @MainActor
    func testAIChatStoreRequiresConsentBeforeGuestAIChatCanStart() throws {
        let flashcardsStore = try self.makeStore()
        let contextLoader = StubContextLoader()
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(savedState: AIChatPersistedState(messages: [])),
            chatService: MockSessionChatService(),
            contextLoader: contextLoader
        )

        chatStore.inputText = "hello"
        chatStore.sendMessage()

        XCTAssertEqual(chatStore.messages.count, 0)
        XCTAssertEqual(
            chatStore.activeAlert,
            .generalError(message: aiChatExternalProviderConsentRequiredMessage)
        )
    }

    @MainActor
    func testAIChatStoreReplacesOptimisticMessagesWithBackendSnapshot() async throws {
        let flashcardsStore = try self.makeLinkedStore()
        let contextLoader = StubContextLoader()
        let service = MockSessionChatService(
            snapshots: [
                makeSnapshot(
                    sessionId: "session-1",
                    runState: "running",
                    messages: [
                        AIChatMessage(
                            id: "message-user-1",
                            role: .user,
                            content: [.text("hello")],
                            timestamp: "2026-03-09T10:00:00.000Z",
                            isError: false
                        ),
                        AIChatMessage(
                            id: "message-assistant-1",
                            role: .assistant,
                            content: [.text("Stored answer")],
                            timestamp: "2026-03-09T10:00:01.000Z",
                            isError: false
                        )
                    ]
                ),
                makeSnapshot(
                    sessionId: "session-1",
                    runState: "idle",
                    messages: [
                        AIChatMessage(
                            id: "message-user-1",
                            role: .user,
                            content: [.text("hello")],
                            timestamp: "2026-03-09T10:00:00.000Z",
                            isError: false
                        ),
                        AIChatMessage(
                            id: "message-assistant-1",
                            role: .assistant,
                            content: [.text("Stored answer")],
                            timestamp: "2026-03-09T10:00:01.000Z",
                            isError: false
                        )
                    ]
                )
            ]
        )
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(savedState: AIChatPersistedState(messages: [])),
            chatService: service,
            contextLoader: contextLoader
        )

        chatStore.inputText = "hello"
        chatStore.sendMessage()

        try await self.waitForChatCompletion(chatStore: chatStore)

        XCTAssertEqual(chatStore.messages.count, 2)
        XCTAssertEqual(chatStore.messages[0].role, .user)
        XCTAssertEqual(chatStore.messages[0].text, "hello")
        XCTAssertEqual(chatStore.messages[1].role, .assistant)
        XCTAssertEqual(chatStore.messages[1].text, "Stored answer")
        let startedRequests = await service.startedRequests()
        XCTAssertEqual(startedRequests.count, 1)
    }

    @MainActor
    func testAIChatStoreShowsStartRunFailureInsideAssistantMessage() async throws {
        let flashcardsStore = try self.makeLinkedStore()
        let contextLoader = StubContextLoader()
        let service = MockSessionChatService(startError: StubLocalizedError(message: "Chat failed"))
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(savedState: AIChatPersistedState(messages: [])),
            chatService: service,
            contextLoader: contextLoader
        )

        chatStore.inputText = "hello"
        chatStore.sendMessage()

        try await self.waitForChatCompletion(chatStore: chatStore)

        XCTAssertNil(chatStore.activeAlert)
        XCTAssertEqual(chatStore.messages.count, 2)
        XCTAssertEqual(chatStore.messages[1].text, "Chat failed")
        XCTAssertTrue(chatStore.messages[1].isError)
    }

    @MainActor
    func testAIChatStoreShowsAccountUpgradePromptForGuestLimitErrors() async throws {
        let flashcardsStore = try self.makeLinkedStore()
        let contextLoader = StubContextLoader()
        let diagnostics = AIChatFailureDiagnostics(
            clientRequestId: "client-request-1",
            backendRequestId: "request-guest-limit-1",
            stage: .responseNotOk,
            errorKind: .invalidHttpResponse,
            statusCode: 429,
            eventType: nil,
            toolName: nil,
            toolCallId: nil,
            lineNumber: nil,
            rawSnippet: nil,
            decoderSummary: nil,
            continuationAttempt: nil,
            continuationToolCallIds: []
        )
        let service = MockSessionChatService(
            startError: AIChatServiceError.invalidResponse(
                CloudApiErrorDetails(
                    message: aiChatGuestQuotaReachedMessage,
                    requestId: "request-guest-limit-1",
                    code: "GUEST_AI_LIMIT_REACHED"
                ),
                aiChatGuestQuotaReachedMessage,
                diagnostics
            )
        )
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(savedState: AIChatPersistedState(messages: [])),
            chatService: service,
            contextLoader: contextLoader
        )

        chatStore.inputText = "hello"
        chatStore.sendMessage()

        try await self.waitForChatCompletion(chatStore: chatStore)

        XCTAssertGreaterThanOrEqual(chatStore.messages.count, 1)
        let lastMessage = try XCTUnwrap(chatStore.messages.last)
        XCTAssertEqual(lastMessage.accountUpgradePrompt?.message, aiChatGuestQuotaReachedMessage)
        XCTAssertEqual(lastMessage.accountUpgradePrompt?.buttonTitle, aiChatGuestQuotaButtonTitle)
        XCTAssertFalse(lastMessage.isError)
        XCTAssertTrue(chatStore.messages.contains { message in
            message.role == .user && message.text == "hello"
        })
    }

    @MainActor
    func testAIChatStoreCancelStreamingStopsBackendRun() async throws {
        let flashcardsStore = try self.makeLinkedStore()
        let contextLoader = StubContextLoader()
        let service = MockSessionChatService(
            snapshots: [
                makeSnapshot(
                    sessionId: "session-1",
                    runState: "running",
                    messages: [
                        AIChatMessage(
                            id: "message-user-1",
                            role: .user,
                            content: [.text("hello")],
                            timestamp: "2026-03-09T10:00:00.000Z",
                            isError: false
                        )
                    ]
                )
            ],
            snapshotDelayNanoseconds: 400_000_000
        )
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(savedState: AIChatPersistedState(
                messages: [],
                chatSessionId: "session-1"
            )),
            chatService: service,
            contextLoader: contextLoader
        )

        chatStore.inputText = "hello"
        chatStore.sendMessage()
        try await Task.sleep(nanoseconds: 100_000_000)
        chatStore.cancelStreaming()
        try await self.waitForChatCompletion(chatStore: chatStore)

        let stoppedSessionIds = await service.stoppedSessionIds()
        XCTAssertEqual(stoppedSessionIds, ["session-1"])
    }

    @MainActor
    func testAIChatStoreClearHistoryResetsBackendSession() async throws {
        let flashcardsStore = try self.makeLinkedStore()
        let contextLoader = StubContextLoader()
        let service = MockSessionChatService(
            resetResponse: AIChatResetSessionResponse(
                ok: true,
                sessionId: "session-reset",
                chatConfig: aiChatDefaultServerConfig
            )
        )
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(savedState: AIChatPersistedState(
                messages: [
                    AIChatMessage(
                        id: "message-1",
                        role: .assistant,
                        content: [.text("old")],
                        timestamp: "2026-03-09T10:00:00.000Z",
                        isError: false
                    )
                ],
                chatSessionId: "session-old",
                lastKnownChatConfig: aiChatDefaultServerConfig
            )),
            chatService: service,
            contextLoader: contextLoader
        )

        chatStore.clearHistory()
        try await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertTrue(chatStore.messages.isEmpty)
        let resetSessionIds = await service.resetSessionIds()
        XCTAssertEqual(resetSessionIds, [nil])
    }
}

private actor MockSessionChatService: AIChatSessionServicing {
    private let snapshots: [AIChatSessionSnapshot]
    private let startError: Error?
    private let resetResponseValue: AIChatResetSessionResponse
    private let snapshotDelayNanoseconds: UInt64
    private var loadCount: Int
    private var started: [AIChatStartRunRequestBody]
    private var stopped: [String]
    private var resetSessions: [String?]

    init(
        snapshots: [AIChatSessionSnapshot] = [
            makeSnapshot(sessionId: "session-1", runState: "idle", messages: [])
        ],
        startError: Error? = nil,
        resetResponse: AIChatResetSessionResponse = AIChatResetSessionResponse(
            ok: true,
            sessionId: "session-reset",
            chatConfig: aiChatDefaultServerConfig
        ),
        snapshotDelayNanoseconds: UInt64 = 0
    ) {
        self.snapshots = snapshots
        self.startError = startError
        self.resetResponseValue = resetResponse
        self.snapshotDelayNanoseconds = snapshotDelayNanoseconds
        self.loadCount = 0
        self.started = []
        self.stopped = []
        self.resetSessions = []
    }

    func loadSnapshot(
        session: CloudLinkedSession,
        sessionId: String?
    ) async throws -> AIChatSessionSnapshot {
        _ = session
        _ = sessionId
        if self.snapshotDelayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: self.snapshotDelayNanoseconds)
        }

        let index = min(self.loadCount, self.snapshots.count - 1)
        self.loadCount += 1
        return self.snapshots[index]
    }

    func startRun(
        session: CloudLinkedSession,
        request: AIChatStartRunRequestBody
    ) async throws -> AIChatStartRunResponse {
        _ = session
        self.started.append(request)
        if let startError = self.startError {
            throw startError
        }

        return AIChatStartRunResponse(
            ok: true,
            sessionId: request.sessionId ?? "session-1",
            runId: "run-1",
            runState: "running",
            chatConfig: aiChatDefaultServerConfig
        )
    }

    func resetSession(
        session: CloudLinkedSession,
        sessionId: String?
    ) async throws -> AIChatResetSessionResponse {
        _ = session
        self.resetSessions.append(sessionId)
        return self.resetResponseValue
    }

    func stopRun(
        session: CloudLinkedSession,
        sessionId: String
    ) async throws -> AIChatStopRunResponse {
        _ = session
        self.stopped.append(sessionId)
        return AIChatStopRunResponse(
            ok: true,
            sessionId: sessionId,
            runId: "run-1",
            stopped: true,
            stillRunning: false
        )
    }

    func startedRequests() -> [AIChatStartRunRequestBody] {
        self.started
    }

    func stoppedSessionIds() -> [String] {
        self.stopped
    }

    func resetSessionIds() -> [String?] {
        self.resetSessions
    }
}

private func makeSnapshot(
    sessionId: String,
    runState: String,
    messages: [AIChatMessage]
) -> AIChatSessionSnapshot {
    AIChatSessionSnapshot(
        sessionId: sessionId,
        runState: runState,
        updatedAt: Int(Date().timeIntervalSince1970 * 1000),
        mainContentInvalidationVersion: 0,
        chatConfig: aiChatDefaultServerConfig,
        messages: messages
    )
}
