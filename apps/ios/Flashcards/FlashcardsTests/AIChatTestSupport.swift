import Foundation
import XCTest
@testable import Flashcards

private enum RequestBodyReadError: LocalizedError {
    case unableToOpenStream
    case failedToReadStream

    var errorDescription: String? {
        switch self {
        case .unableToOpenStream:
            return "Failed to open request body stream"
        case .failedToReadStream:
            return "Failed to read request body stream"
        }
    }
}

func materializedRequest(_ request: URLRequest) throws -> URLRequest {
    guard request.httpBody == nil, let bodyStream = request.httpBodyStream else {
        return request
    }

    var materialized = request
    materialized.httpBody = try readRequestBodyData(stream: bodyStream)
    return materialized
}

private func readRequestBodyData(stream: InputStream) throws -> Data {
    stream.open()
    defer {
        stream.close()
    }

    if stream.streamStatus == .error {
        throw RequestBodyReadError.unableToOpenStream
    }

    var data = Data()
    let bufferSize = 4_096
    let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
    defer {
        buffer.deallocate()
    }

    while stream.hasBytesAvailable {
        let bytesRead = stream.read(buffer, maxLength: bufferSize)
        if bytesRead < 0 {
            throw RequestBodyReadError.failedToReadStream
        }
        if bytesRead == 0 {
            break
        }

        data.append(buffer, count: bytesRead)
    }

    return data
}

typealias AILocalChatRequestBody = AIChatTurnRequestBody
typealias AILocalChatWireMessage = AIChatWireMessage
typealias AILocalChatUserContext = AIChatUserContext
typealias AIChatLocalContext = AIChatContext

protocol AIToolExecuting: Sendable {
    func execute(toolCallRequest: AIToolCallRequest, requestId: String?) async throws -> AIToolExecutionResult
}

struct AIToolExecutionResult: Equatable, Sendable {
    let output: String
    let didMutateAppState: Bool
}

protocol AIChatLocalContextLoading: AIChatContextLoading {
    func loadLocalContext() async throws -> AIChatLocalContext
}

extension AIChatLocalContextLoading {
    func loadContext() async throws -> AIChatContext {
        try await self.loadLocalContext()
    }
}

extension AIChatPersistedState {
    init(messages: [AIChatMessage], selectedModelId: String) {
        self.init(
            messages: messages,
            selectedModelId: selectedModelId,
            chatSessionId: makeAIChatSessionId(),
            codeInterpreterContainerId: nil
        )
    }
}

extension AITurnStreamOutcome {
    init(
        awaitsToolResults: Bool,
        requestedToolCalls: [AIToolCallRequest],
        requestId: String?
    ) {
        _ = awaitsToolResults
        _ = requestedToolCalls
        self.init(requestId: requestId, codeInterpreterContainerId: nil)
    }

    var awaitsToolResults: Bool {
        false
    }

    var requestedToolCalls: [AIToolCallRequest] {
        []
    }
}

@MainActor
extension AIChatStore {
    convenience init(
        flashcardsStore: FlashcardsStore,
        historyStore: any AIChatHistoryStoring,
        chatService: any AIChatStreaming,
        toolExecutor: any AIToolExecuting,
        localContextLoader: any AIChatContextLoading
    ) {
        _ = toolExecutor
        self.init(
            flashcardsStore: flashcardsStore,
            historyStore: historyStore,
            chatService: chatService,
            contextLoader: localContextLoader
        )
    }

    convenience init(
        flashcardsStore: FlashcardsStore,
        historyStore: any AIChatHistoryStoring,
        chatService: any AIChatStreaming,
        toolExecutor: any AIToolExecuting,
        localContextLoader: any AIChatContextLoading,
        voiceRecorder: any AIChatVoiceRecording,
        audioTranscriber: any AIChatAudioTranscribing
    ) {
        _ = toolExecutor
        self.init(
            flashcardsStore: flashcardsStore,
            historyStore: historyStore,
            chatService: chatService,
            contextLoader: localContextLoader,
            voiceRecorder: voiceRecorder,
            audioTranscriber: audioTranscriber
        )
    }
}

final class InMemoryHistoryStore: AIChatHistoryStoring, @unchecked Sendable {
    var savedState: AIChatPersistedState
    private(set) var saveCallCount: Int

    init(savedState: AIChatPersistedState) {
        self.savedState = savedState
        self.saveCallCount = 0
    }

    func activateWorkspace(workspaceId: String?) {}

    func loadState() -> AIChatPersistedState {
        self.savedState
    }

    func saveState(state: AIChatPersistedState) async {
        self.savedState = state
        self.saveCallCount += 1
    }

    func clearState() async {
        self.savedState = AIChatPersistedState(messages: [], selectedModelId: aiChatDefaultModelId)
    }
}

func makeStubAIChatLocalContext(totalCards: Int) -> AIChatLocalContext {
    AIChatLocalContext(
        workspace: Workspace(
            workspaceId: "workspace-1",
            name: "Workspace",
            createdAt: "2026-03-09T00:00:00.000Z"
        ),
        schedulerSettings: WorkspaceSchedulerSettings(
            algorithm: "fsrs-6",
            desiredRetention: 0.9,
            learningStepsMinutes: [1, 10],
            relearningStepsMinutes: [10],
            maximumIntervalDays: 36500,
            enableFuzz: true,
            clientUpdatedAt: "2026-03-09T00:00:00.000Z",
            lastModifiedByDeviceId: "device-1",
            lastOperationId: "operation-settings",
            updatedAt: "2026-03-09T00:00:00.000Z"
        ),
        totalActiveCards: totalCards
    )
}

final class FailingChatService: AIChatStreaming, @unchecked Sendable {
    func streamTurn(
        session: CloudLinkedSession,
        request: AILocalChatRequestBody,
        tapStartedAt: Date?,
        onDelta: @escaping @Sendable (String) async -> Void,
        onToolCall: @escaping @Sendable (AIChatToolCall) async -> Void,
        onToolCallRequest: @escaping @Sendable (AIToolCallRequest) async -> Void,
        onRepairAttempt: @escaping @Sendable (AIChatRepairAttemptStatus) async -> Void,
        onLatencyReported: @escaping @Sendable (AIChatLatencyReportBody) async -> Void
    ) async throws -> AITurnStreamOutcome {
        _ = tapStartedAt
        _ = onLatencyReported
        XCTFail("streamTurn should not be called in this test")
        return AITurnStreamOutcome(awaitsToolResults: false, requestedToolCalls: [], requestId: nil)
    }

    func reportFailureDiagnostics(
        session: CloudLinkedSession,
        body: AIChatFailureReportBody
    ) async {
    }

    func reportLatencyDiagnostics(
        session: CloudLinkedSession,
        body: AIChatLatencyReportBody
    ) async {
    }
}

struct ThrowingChatService: AIChatStreaming, @unchecked Sendable {
    let error: Error

    func streamTurn(
        session: CloudLinkedSession,
        request: AILocalChatRequestBody,
        tapStartedAt: Date?,
        onDelta: @escaping @Sendable (String) async -> Void,
        onToolCall: @escaping @Sendable (AIChatToolCall) async -> Void,
        onToolCallRequest: @escaping @Sendable (AIToolCallRequest) async -> Void,
        onRepairAttempt: @escaping @Sendable (AIChatRepairAttemptStatus) async -> Void,
        onLatencyReported: @escaping @Sendable (AIChatLatencyReportBody) async -> Void
    ) async throws -> AITurnStreamOutcome {
        _ = tapStartedAt
        _ = onLatencyReported
        throw self.error
    }

    func reportFailureDiagnostics(
        session: CloudLinkedSession,
        body: AIChatFailureReportBody
    ) async {
    }

    func reportLatencyDiagnostics(
        session: CloudLinkedSession,
        body: AIChatLatencyReportBody
    ) async {
    }
}

struct RepairingChatService: AIChatStreaming, @unchecked Sendable {
    let terminalError: Error?

    func streamTurn(
        session: CloudLinkedSession,
        request: AILocalChatRequestBody,
        tapStartedAt: Date?,
        onDelta: @escaping @Sendable (String) async -> Void,
        onToolCall: @escaping @Sendable (AIChatToolCall) async -> Void,
        onToolCallRequest: @escaping @Sendable (AIToolCallRequest) async -> Void,
        onRepairAttempt: @escaping @Sendable (AIChatRepairAttemptStatus) async -> Void,
        onLatencyReported: @escaping @Sendable (AIChatLatencyReportBody) async -> Void
    ) async throws -> AITurnStreamOutcome {
        _ = tapStartedAt
        _ = onLatencyReported
        await onDelta("Checking")
        await onRepairAttempt(
            AIChatRepairAttemptStatus(
                message: "Assistant is correcting sql.",
                attempt: 1,
                maxAttempts: 3,
                toolName: "sql"
            )
        )

        if let terminalError {
            throw terminalError
        }

        await onToolCallRequest(
            AIToolCallRequest(
                toolCallId: "call-1",
                name: "sql",
                input: "{\"sql\":null}"
            )
        )
        return AITurnStreamOutcome(awaitsToolResults: false, requestedToolCalls: [], requestId: "request-123")
    }

    func reportFailureDiagnostics(
        session: CloudLinkedSession,
        body: AIChatFailureReportBody
    ) async {
    }

    func reportLatencyDiagnostics(
        session: CloudLinkedSession,
        body: AIChatLatencyReportBody
    ) async {
    }
}

struct FailingToolExecutor: AIToolExecuting, AIChatLocalContextLoading {
    func execute(toolCallRequest: AIToolCallRequest, requestId: String?) async throws -> AIToolExecutionResult {
        XCTFail("execute should not be called in this test")
        return AIToolExecutionResult(output: "", didMutateAppState: false)
    }

    func loadLocalContext() async throws -> AIChatLocalContext {
        makeStubAIChatLocalContext(totalCards: 1)
    }
}

actor RecoveringToolFailureChatService: AIChatStreaming {
    private var requests: [AILocalChatRequestBody]
    private var callCount: Int

    init() {
        self.requests = []
        self.callCount = 0
    }

    func streamTurn(
        session: CloudLinkedSession,
        request: AILocalChatRequestBody,
        tapStartedAt: Date?,
        onDelta: @escaping @Sendable (String) async -> Void,
        onToolCall: @escaping @Sendable (AIChatToolCall) async -> Void,
        onToolCallRequest: @escaping @Sendable (AIToolCallRequest) async -> Void,
        onRepairAttempt: @escaping @Sendable (AIChatRepairAttemptStatus) async -> Void,
        onLatencyReported: @escaping @Sendable (AIChatLatencyReportBody) async -> Void
    ) async throws -> AITurnStreamOutcome {
        _ = tapStartedAt
        _ = onLatencyReported
        self.requests.append(request)
        self.callCount += 1

        if self.callCount == 1 {
            let toolCallRequest = AIToolCallRequest(
                toolCallId: "tool-recover-1",
                name: "sql",
                input: "{\"sql\":\"SELECT tags FROM cards\"}"
            )
            await onToolCallRequest(toolCallRequest)
            return AITurnStreamOutcome(
                awaitsToolResults: true,
                requestedToolCalls: [toolCallRequest],
                requestId: "request-recover-1"
            )
        }

        await onDelta("Recovered")
        return AITurnStreamOutcome(awaitsToolResults: false, requestedToolCalls: [], requestId: "request-recover-2")
    }

    func reportFailureDiagnostics(
        session: CloudLinkedSession,
        body: AIChatFailureReportBody
    ) async {
    }

    func reportLatencyDiagnostics(
        session: CloudLinkedSession,
        body: AIChatLatencyReportBody
    ) async {
    }

    func snapshotRequests() -> [AILocalChatRequestBody] {
        self.requests
    }
}

actor RepeatingToolFailureChatService: AIChatStreaming {
    private var requests: [AILocalChatRequestBody]
    private var callCount: Int

    init() {
        self.requests = []
        self.callCount = 0
    }

    func streamTurn(
        session: CloudLinkedSession,
        request: AILocalChatRequestBody,
        tapStartedAt: Date?,
        onDelta: @escaping @Sendable (String) async -> Void,
        onToolCall: @escaping @Sendable (AIChatToolCall) async -> Void,
        onToolCallRequest: @escaping @Sendable (AIToolCallRequest) async -> Void,
        onRepairAttempt: @escaping @Sendable (AIChatRepairAttemptStatus) async -> Void,
        onLatencyReported: @escaping @Sendable (AIChatLatencyReportBody) async -> Void
    ) async throws -> AITurnStreamOutcome {
        _ = tapStartedAt
        _ = onLatencyReported
        self.requests.append(request)
        self.callCount += 1

        let toolCallRequest = AIToolCallRequest(
            toolCallId: "tool-fail-\(self.callCount)",
            name: "sql",
            input: "{\"sql\":\"SELECT tags FROM cards LIMIT \(self.callCount * 10) OFFSET 0\"}"
        )
        await onToolCallRequest(toolCallRequest)
        return AITurnStreamOutcome(
            awaitsToolResults: true,
            requestedToolCalls: [toolCallRequest],
            requestId: "request-fail-\(self.callCount)"
        )
    }

    func reportFailureDiagnostics(
        session: CloudLinkedSession,
        body: AIChatFailureReportBody
    ) async {
    }

    func reportLatencyDiagnostics(
        session: CloudLinkedSession,
        body: AIChatLatencyReportBody
    ) async {
    }

    func snapshotRequests() -> [AILocalChatRequestBody] {
        self.requests
    }
}

actor RecoveringToolFailureExecutor: AIToolExecuting, AIChatLocalContextLoading {
    private var executionCount: Int

    init() {
        self.executionCount = 0
    }

    func execute(toolCallRequest: AIToolCallRequest, requestId: String?) async throws -> AIToolExecutionResult {
        self.executionCount += 1
        if self.executionCount == 1 {
            throw StubLocalizedError(message: "Unsupported SELECT statement")
        }

        return AIToolExecutionResult(output: "{\"ok\":true}", didMutateAppState: false)
    }

    func loadLocalContext() async throws -> AIChatLocalContext {
        makeStubAIChatLocalContext(totalCards: 1)
    }
}

actor AlwaysFailingToolExecutor: AIToolExecuting, AIChatLocalContextLoading {
    func execute(toolCallRequest: AIToolCallRequest, requestId: String?) async throws -> AIToolExecutionResult {
        throw StubLocalizedError(message: "Unsupported SELECT statement")
    }

    func loadLocalContext() async throws -> AIChatLocalContext {
        makeStubAIChatLocalContext(totalCards: 1)
    }
}

struct BurstChatService: AIChatStreaming {
    let deltas: [String]

    func streamTurn(
        session: CloudLinkedSession,
        request: AILocalChatRequestBody,
        tapStartedAt: Date?,
        onDelta: @escaping @Sendable (String) async -> Void,
        onToolCall: @escaping @Sendable (AIChatToolCall) async -> Void,
        onToolCallRequest: @escaping @Sendable (AIToolCallRequest) async -> Void,
        onRepairAttempt: @escaping @Sendable (AIChatRepairAttemptStatus) async -> Void,
        onLatencyReported: @escaping @Sendable (AIChatLatencyReportBody) async -> Void
    ) async throws -> AITurnStreamOutcome {
        _ = tapStartedAt
        _ = onLatencyReported
        for delta in self.deltas {
            await onDelta(delta)
        }

        return AITurnStreamOutcome(awaitsToolResults: false, requestedToolCalls: [], requestId: "request-burst")
    }

    func reportFailureDiagnostics(
        session: CloudLinkedSession,
        body: AIChatFailureReportBody
    ) async {
    }

    func reportLatencyDiagnostics(
        session: CloudLinkedSession,
        body: AIChatLatencyReportBody
    ) async {
    }
}

actor MutatingChatService: AIChatStreaming {
    private var callCount: Int = 0

    func streamTurn(
        session: CloudLinkedSession,
        request: AILocalChatRequestBody,
        tapStartedAt: Date?,
        onDelta: @escaping @Sendable (String) async -> Void,
        onToolCall: @escaping @Sendable (AIChatToolCall) async -> Void,
        onToolCallRequest: @escaping @Sendable (AIToolCallRequest) async -> Void,
        onRepairAttempt: @escaping @Sendable (AIChatRepairAttemptStatus) async -> Void,
        onLatencyReported: @escaping @Sendable (AIChatLatencyReportBody) async -> Void
    ) async throws -> AITurnStreamOutcome {
        _ = tapStartedAt
        _ = onLatencyReported
        self.callCount += 1

        if self.callCount == 1 {
            let toolCallRequest = AIToolCallRequest(
                toolCallId: "tool-create-card",
                name: "sql",
                input: "{\"sql\":\"INSERT INTO cards (front_text, back_text, tags, effort_level) VALUES ('Front', 'Back', ('tag-a'), 'medium')\"}"
            )
            await onToolCallRequest(toolCallRequest)
            return AITurnStreamOutcome(
                awaitsToolResults: true,
                requestedToolCalls: [toolCallRequest],
                requestId: "request-create"
            )
        }

        await onDelta("Saved")
        return AITurnStreamOutcome(awaitsToolResults: false, requestedToolCalls: [], requestId: "request-done")
    }

    func reportFailureDiagnostics(
        session: CloudLinkedSession,
        body: AIChatFailureReportBody
    ) async {
    }

    func reportLatencyDiagnostics(
        session: CloudLinkedSession,
        body: AIChatLatencyReportBody
    ) async {
    }
}

actor DelayedToolCompletionChatService: AIChatStreaming {
    func streamTurn(
        session: CloudLinkedSession,
        request: AILocalChatRequestBody,
        tapStartedAt: Date?,
        onDelta: @escaping @Sendable (String) async -> Void,
        onToolCall: @escaping @Sendable (AIChatToolCall) async -> Void,
        onToolCallRequest: @escaping @Sendable (AIToolCallRequest) async -> Void,
        onRepairAttempt: @escaping @Sendable (AIChatRepairAttemptStatus) async -> Void,
        onLatencyReported: @escaping @Sendable (AIChatLatencyReportBody) async -> Void
    ) async throws -> AITurnStreamOutcome {
        _ = tapStartedAt
        _ = onLatencyReported
        _ = onToolCallRequest
        await onToolCall(
            AIChatToolCall(
                id: "tool-delayed-1",
                name: "sql",
                status: .started,
                input: "{\"sql\":\"SHOW TABLES\"}",
                output: nil
            )
        )
        try await Task.sleep(nanoseconds: 150_000_000)
        await onToolCall(
            AIChatToolCall(
                id: "tool-delayed-1",
                name: "sql",
                status: .completed,
                input: "{\"sql\":\"SHOW TABLES\"}",
                output: "{\"ok\":true}"
            )
        )
        await onDelta("Done")
        return AITurnStreamOutcome(awaitsToolResults: false, requestedToolCalls: [], requestId: "request-delayed-tool")
    }

    func reportFailureDiagnostics(
        session: CloudLinkedSession,
        body: AIChatFailureReportBody
    ) async {
    }

    func reportLatencyDiagnostics(
        session: CloudLinkedSession,
        body: AIChatLatencyReportBody
    ) async {
    }
}

struct SlowSuccessToolExecutor: AIToolExecuting, AIChatLocalContextLoading {
    let pauseNanoseconds: UInt64

    func execute(toolCallRequest: AIToolCallRequest, requestId: String?) async throws -> AIToolExecutionResult {
        try await Task.sleep(nanoseconds: self.pauseNanoseconds)
        return AIToolExecutionResult(output: "{\"ok\":true}", didMutateAppState: false)
    }

    func loadLocalContext() async throws -> AIChatLocalContext {
        makeStubAIChatLocalContext(totalCards: 1)
    }
}

struct SuspendingChatService: AIChatStreaming, @unchecked Sendable {
    func streamTurn(
        session: CloudLinkedSession,
        request: AILocalChatRequestBody,
        tapStartedAt: Date?,
        onDelta: @escaping @Sendable (String) async -> Void,
        onToolCall: @escaping @Sendable (AIChatToolCall) async -> Void,
        onToolCallRequest: @escaping @Sendable (AIToolCallRequest) async -> Void,
        onRepairAttempt: @escaping @Sendable (AIChatRepairAttemptStatus) async -> Void,
        onLatencyReported: @escaping @Sendable (AIChatLatencyReportBody) async -> Void
    ) async throws -> AITurnStreamOutcome {
        _ = tapStartedAt
        _ = onLatencyReported
        try await Task.sleep(nanoseconds: 10_000_000_000)
        return AITurnStreamOutcome(awaitsToolResults: false, requestedToolCalls: [], requestId: "request-suspending")
    }

    func reportFailureDiagnostics(
        session: CloudLinkedSession,
        body: AIChatFailureReportBody
    ) async {
    }

    func reportLatencyDiagnostics(
        session: CloudLinkedSession,
        body: AIChatLatencyReportBody
    ) async {
    }
}

struct RepairingSuspendingChatService: AIChatStreaming, @unchecked Sendable {
    func streamTurn(
        session: CloudLinkedSession,
        request: AILocalChatRequestBody,
        tapStartedAt: Date?,
        onDelta: @escaping @Sendable (String) async -> Void,
        onToolCall: @escaping @Sendable (AIChatToolCall) async -> Void,
        onToolCallRequest: @escaping @Sendable (AIToolCallRequest) async -> Void,
        onRepairAttempt: @escaping @Sendable (AIChatRepairAttemptStatus) async -> Void,
        onLatencyReported: @escaping @Sendable (AIChatLatencyReportBody) async -> Void
    ) async throws -> AITurnStreamOutcome {
        _ = tapStartedAt
        _ = onLatencyReported
        await onRepairAttempt(
            AIChatRepairAttemptStatus(
                message: "Assistant is correcting sql.",
                attempt: 1,
                maxAttempts: 3,
                toolName: "sql"
            )
        )
        try await Task.sleep(nanoseconds: 10_000_000_000)
        return AITurnStreamOutcome(awaitsToolResults: false, requestedToolCalls: [], requestId: "request-repairing")
    }

    func reportFailureDiagnostics(
        session: CloudLinkedSession,
        body: AIChatFailureReportBody
    ) async {
    }

    func reportLatencyDiagnostics(
        session: CloudLinkedSession,
        body: AIChatLatencyReportBody
    ) async {
    }
}

struct ToolCallRequestOnlyChatService: AIChatStreaming, @unchecked Sendable {
    func streamTurn(
        session: CloudLinkedSession,
        request: AILocalChatRequestBody,
        tapStartedAt: Date?,
        onDelta: @escaping @Sendable (String) async -> Void,
        onToolCall: @escaping @Sendable (AIChatToolCall) async -> Void,
        onToolCallRequest: @escaping @Sendable (AIToolCallRequest) async -> Void,
        onRepairAttempt: @escaping @Sendable (AIChatRepairAttemptStatus) async -> Void,
        onLatencyReported: @escaping @Sendable (AIChatLatencyReportBody) async -> Void
    ) async throws -> AITurnStreamOutcome {
        _ = tapStartedAt
        _ = onDelta
        _ = onToolCall
        _ = onRepairAttempt
        _ = onLatencyReported
        await onToolCallRequest(
            AIToolCallRequest(
                toolCallId: "call-tool-only",
                name: "sql",
                input: "{\"sql\":\"SHOW TABLES\"}"
            )
        )
        return AITurnStreamOutcome(awaitsToolResults: false, requestedToolCalls: [], requestId: "request-tool-only")
    }

    func reportFailureDiagnostics(
        session: CloudLinkedSession,
        body: AIChatFailureReportBody
    ) async {
    }

    func reportLatencyDiagnostics(
        session: CloudLinkedSession,
        body: AIChatLatencyReportBody
    ) async {
    }
}

struct StubLocalizedError: LocalizedError {
    let message: String

    var errorDescription: String? {
        self.message
    }
}

struct DelayedBurstChatService: AIChatStreaming, @unchecked Sendable {
    let firstDelta: String
    let trailingDeltas: [String]
    let pauseAfterFirstDeltaNanoseconds: UInt64
    let pauseBeforeCompletionNanoseconds: UInt64

    func streamTurn(
        session: CloudLinkedSession,
        request: AILocalChatRequestBody,
        tapStartedAt: Date?,
        onDelta: @escaping @Sendable (String) async -> Void,
        onToolCall: @escaping @Sendable (AIChatToolCall) async -> Void,
        onToolCallRequest: @escaping @Sendable (AIToolCallRequest) async -> Void,
        onRepairAttempt: @escaping @Sendable (AIChatRepairAttemptStatus) async -> Void,
        onLatencyReported: @escaping @Sendable (AIChatLatencyReportBody) async -> Void
    ) async throws -> AITurnStreamOutcome {
        _ = tapStartedAt
        _ = onLatencyReported
        await onDelta(self.firstDelta)
        try await Task.sleep(nanoseconds: self.pauseAfterFirstDeltaNanoseconds)
        for delta in self.trailingDeltas {
            await onDelta(delta)
        }
        try await Task.sleep(nanoseconds: self.pauseBeforeCompletionNanoseconds)
        return AITurnStreamOutcome(awaitsToolResults: false, requestedToolCalls: [], requestId: "request-delayed-burst")
    }

    func reportFailureDiagnostics(
        session: CloudLinkedSession,
        body: AIChatFailureReportBody
    ) async {
    }

    func reportLatencyDiagnostics(
        session: CloudLinkedSession,
        body: AIChatLatencyReportBody
    ) async {
    }
}

struct ToolCallOnlyChatService: AIChatStreaming, @unchecked Sendable {
    let toolCall: AIChatToolCall

    func streamTurn(
        session: CloudLinkedSession,
        request: AILocalChatRequestBody,
        tapStartedAt: Date?,
        onDelta: @escaping @Sendable (String) async -> Void,
        onToolCall: @escaping @Sendable (AIChatToolCall) async -> Void,
        onToolCallRequest: @escaping @Sendable (AIToolCallRequest) async -> Void,
        onRepairAttempt: @escaping @Sendable (AIChatRepairAttemptStatus) async -> Void,
        onLatencyReported: @escaping @Sendable (AIChatLatencyReportBody) async -> Void
    ) async throws -> AITurnStreamOutcome {
        _ = tapStartedAt
        _ = onLatencyReported
        await onToolCall(self.toolCall)
        return AITurnStreamOutcome(awaitsToolResults: false, requestedToolCalls: [], requestId: "request-tool-call-only")
    }

    func reportFailureDiagnostics(
        session: CloudLinkedSession,
        body: AIChatFailureReportBody
    ) async {
    }

    func reportLatencyDiagnostics(
        session: CloudLinkedSession,
        body: AIChatLatencyReportBody
    ) async {
    }
}

struct BulkDeleteCardsPayload: Decodable {
    let ok: Bool
    let deletedCardIds: [String]
    let deletedCount: Int
}

struct BulkDeleteDecksPayload: Decodable {
    let ok: Bool
    let deletedDeckIds: [String]
    let deletedCount: Int
}

actor DeltaRecorder {
    private var values: [String] = []

    func append(_ value: String) {
        self.values.append(value)
    }

    func snapshot() -> [String] {
        self.values
    }
}

final class RequestRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var requests: [URLRequest] = []

    func append(_ request: URLRequest) {
        self.lock.lock()
        defer {
            self.lock.unlock()
        }
        self.requests.append(request)
    }

    func snapshot() -> [URLRequest] {
        self.lock.lock()
        defer {
            self.lock.unlock()
        }
        return self.requests
    }
}

extension AIChatMessage {
    init(
        id: String,
        role: AIChatRole,
        text: String,
        toolCalls: [AIChatToolCall],
        timestamp: String,
        isError: Bool
    ) {
        var content: [AIChatContentPart] = []
        if text.isEmpty == false {
            content.append(.text(text))
        }
        content.append(contentsOf: toolCalls.map { .toolCall($0) })

        self.init(
            id: id,
            role: role,
            content: content,
            timestamp: timestamp,
            isError: isError
        )
    }

    var text: String {
        self.content.reduce(into: "") { partialResult, part in
            if case .text(let value) = part {
                partialResult.append(value)
            }
        }
    }

    var toolCalls: [AIChatToolCall] {
        self.content.compactMap { part in
            if case .toolCall(let toolCall) = part {
                return toolCall
            }

            return nil
        }
    }

    var accountUpgradePrompt: (message: String, buttonTitle: String)? {
        self.content.reduce(into: nil) { partialResult, part in
            if case .accountUpgradePrompt(let message, let buttonTitle) = part {
                partialResult = (message, buttonTitle)
            }
        }
    }
}

extension AILocalChatWireMessage {
    init(
        role: String,
        content: String,
        toolCalls: [AIChatToolCall]?,
        toolCallId: String?,
        name: String?,
        output: String?
    ) {
        var contentParts: [AIChatContentPart]? = content.isEmpty ? nil : [.text(content)]
        if let toolCalls {
            if contentParts == nil {
                contentParts = []
            }
            contentParts?.append(contentsOf: toolCalls.map { .toolCall($0) })
        }

        self.init(
            role: role,
            content: contentParts ?? []
        )
    }

    var toolCallId: String? {
        nil
    }

    var name: String? {
        nil
    }

    var output: String? {
        nil
    }
}

extension AILocalChatRequestBody {
    init(messages: [AILocalChatWireMessage], model: String, timezone: String) {
        self.init(
            messages: messages,
            model: model,
            timezone: timezone,
            devicePlatform: "ios",
            chatSessionId: makeAIChatSessionId(),
            codeInterpreterContainerId: nil,
            userContext: AILocalChatUserContext(totalCards: 0)
        )
    }
}

class AIChatTestCaseBase: XCTestCase {
    override class func setUp() {
        super.setUp()
        URLProtocol.registerClass(AIChatMockUrlProtocol.self)
    }

    override class func tearDown() {
        URLProtocol.unregisterClass(AIChatMockUrlProtocol.self)
        super.tearDown()
    }

    override func tearDown() {
        AIChatMockUrlProtocol.requestHandler = nil
        super.tearDown()
    }
    @MainActor
    func makeStore() throws -> FlashcardsStore {
        let databaseDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: databaseDirectory, withIntermediateDirectories: true)

        let suiteName = "flashcards-store-tests-\(UUID().uuidString)"
        let userDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        userDefaults.removePersistentDomain(forName: suiteName)
        self.addTeardownBlock {
            userDefaults.removePersistentDomain(forName: suiteName)
        }

        let store = FlashcardsStore(
            userDefaults: userDefaults,
            encoder: JSONEncoder(),
            decoder: JSONDecoder(),
            database: try LocalDatabase(
                databaseURL: databaseDirectory.appendingPathComponent("flashcards.sqlite", isDirectory: false)
            ),
            cloudAuthService: CloudAuthService(),
            credentialStore: CloudCredentialStore(
                encoder: JSONEncoder(),
                decoder: JSONDecoder(),
                service: "tests-\(UUID().uuidString)",
                account: "primary"
            ),
            guestCloudAuthService: GuestCloudAuthService(),
            guestCredentialStore: GuestCloudCredentialStore(
                encoder: JSONEncoder(),
                decoder: JSONDecoder(),
                service: "tests-\(UUID().uuidString)",
                account: "primary"
            ),
            initialGlobalErrorMessage: ""
        )
        self.addTeardownBlock {
            try await MainActor.run {
                store.shutdownForTests()
                try store.database?.close()
            }
            try await Task.sleep(nanoseconds: 50_000_000)
            await Task.yield()
            await Task.yield()
        }
        return store
    }

    @MainActor
    func makeLinkedStore() throws -> FlashcardsStore {
        try self.makeLinkedStore(
            cloudAuthService: CloudAuthService(),
            idTokenExpiresAt: formatIsoTimestamp(date: Date().addingTimeInterval(3600))
        )
    }

    @MainActor
    func makeLinkedStore(
        cloudAuthService: CloudAuthService,
        idTokenExpiresAt: String
    ) throws -> FlashcardsStore {
        let databaseDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: databaseDirectory, withIntermediateDirectories: true)

        let suiteName = "flashcards-linked-store-tests-\(UUID().uuidString)"
        let userDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        userDefaults.removePersistentDomain(forName: suiteName)
        self.addTeardownBlock {
            userDefaults.removePersistentDomain(forName: suiteName)
        }

        let encoder = JSONEncoder()
        let decoder = JSONDecoder()
        let database = try LocalDatabase(
            databaseURL: databaseDirectory.appendingPathComponent("flashcards.sqlite", isDirectory: false)
        )
        try database.updateCloudSettings(
            cloudState: .linked,
            linkedUserId: "user-1",
            linkedWorkspaceId: "workspace-1",
            activeWorkspaceId: "workspace-1",
            linkedEmail: "user@example.com"
        )

        let credentialStore = CloudCredentialStore(
            encoder: encoder,
            decoder: decoder,
            service: "tests-\(UUID().uuidString)",
            account: "linked"
        )
        try credentialStore.saveCredentials(
            credentials: StoredCloudCredentials(
                refreshToken: "refresh-token",
                idToken: "id-token",
                idTokenExpiresAt: idTokenExpiresAt
            )
        )

        let store = FlashcardsStore(
            userDefaults: userDefaults,
            encoder: encoder,
            decoder: decoder,
            database: database,
            cloudAuthService: cloudAuthService,
            credentialStore: credentialStore,
            guestCloudAuthService: GuestCloudAuthService(),
            guestCredentialStore: GuestCloudCredentialStore(
                encoder: encoder,
                decoder: decoder,
                service: "tests-\(UUID().uuidString)",
                account: "linked-guest"
            ),
            initialGlobalErrorMessage: ""
        )
        store.cloudRuntime = CloudSessionRuntime(
            cloudAuthService: cloudAuthService,
            cloudSyncService: FlashcardsStoreTestSupport.MockCloudSyncService(
                runLinkedSyncOutcomes: [],
                isRunLinkedSyncBlocked: false
            ),
            credentialStore: credentialStore
        )
        store.cloudRuntime.setActiveCloudSession(
            linkedSession: FlashcardsStoreTestSupport.makeLinkedSession(workspaceId: "workspace-1")
        )
        grantAIChatExternalProviderConsent(userDefaults: userDefaults)
        self.addTeardownBlock {
            try await MainActor.run {
                store.shutdownForTests()
                try store.database?.close()
            }
            try await Task.sleep(nanoseconds: 50_000_000)
            await Task.yield()
            await Task.yield()
        }
        return store
    }

    @MainActor
    func makeLinkedStoreWithoutAIConsent() throws -> FlashcardsStore {
        let store = try self.makeLinkedStore()
        store.userDefaults.removeObject(forKey: aiChatExternalProviderConsentUserDefaultsKey)
        return store
    }

    @MainActor
    func waitForChatStart(chatStore: AIChatStore) async throws {
        for _ in 0..<100 {
            if chatStore.isStreaming || chatStore.messages.isEmpty == false || chatStore.activeAlert != nil {
                return
            }

            try await Task.sleep(nanoseconds: 20_000_000)
        }

        XCTFail("Timed out waiting for chat start")
    }

    @MainActor
    func waitForChatCompletion(chatStore: AIChatStore) async throws {
        var didStart = chatStore.isStreaming || chatStore.messages.isEmpty == false || chatStore.activeAlert != nil

        for _ in 0..<150 {
            let hasStarted = chatStore.isStreaming || chatStore.messages.isEmpty == false || chatStore.activeAlert != nil
            didStart = didStart || hasStarted

            if didStart && chatStore.isStreaming == false {
                return
            }

            try await Task.sleep(nanoseconds: 20_000_000)
        }

        XCTFail("Timed out waiting for chat completion")
    }

    @MainActor
    func waitForRepairStatus(chatStore: AIChatStore) async throws {
        for _ in 0..<150 {
            if chatStore.repairStatus != nil {
                return
            }

            try await Task.sleep(nanoseconds: 20_000_000)
        }

        XCTFail("Timed out waiting for repair status")
    }

    func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [AIChatMockUrlProtocol.self]
        return URLSession(configuration: configuration)
    }
}

final class AIChatMockUrlProtocol: URLProtocol {
    nonisolated(unsafe) static var requestHandler: (@Sendable (URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool {
        true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        guard let handler = AIChatMockUrlProtocol.requestHandler else {
            XCTFail("AIChatMockUrlProtocol.requestHandler is not set")
            return
        }

        do {
            let (response, data) = try handler(materializedRequest(self.request))
            self.client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            self.client?.urlProtocol(self, didLoad: data)
            self.client?.urlProtocolDidFinishLoading(self)
        } catch {
            self.client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
