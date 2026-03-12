import Foundation
import XCTest
@testable import Flashcards

final class InMemoryHistoryStore: AIChatHistoryStoring, @unchecked Sendable {
    var savedState: AIChatPersistedState
    private(set) var saveCallCount: Int

    init(savedState: AIChatPersistedState) {
        self.savedState = savedState
        self.saveCallCount = 0
    }

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

final class FailingChatService: AIChatStreaming, @unchecked Sendable {
    func streamTurn(
        session: CloudLinkedSession,
        request: AILocalChatRequestBody,
        onDelta: @escaping @Sendable (String) async -> Void,
        onToolCall: @escaping @Sendable (AIChatToolCall) async -> Void,
        onToolCallRequest: @escaping @Sendable (AIToolCallRequest) async -> Void,
        onRepairAttempt: @escaping @Sendable (AIChatRepairAttemptStatus) async -> Void
    ) async throws -> AITurnStreamOutcome {
        XCTFail("streamTurn should not be called in this test")
        return AITurnStreamOutcome(awaitsToolResults: false, requestedToolCalls: [], requestId: nil)
    }

    func reportFailureDiagnostics(
        session: CloudLinkedSession,
        body: AIChatFailureReportBody
    ) async {
    }
}

struct ThrowingChatService: AIChatStreaming, @unchecked Sendable {
    let error: Error

    func streamTurn(
        session: CloudLinkedSession,
        request: AILocalChatRequestBody,
        onDelta: @escaping @Sendable (String) async -> Void,
        onToolCall: @escaping @Sendable (AIChatToolCall) async -> Void,
        onToolCallRequest: @escaping @Sendable (AIToolCallRequest) async -> Void,
        onRepairAttempt: @escaping @Sendable (AIChatRepairAttemptStatus) async -> Void
    ) async throws -> AITurnStreamOutcome {
        throw self.error
    }

    func reportFailureDiagnostics(
        session: CloudLinkedSession,
        body: AIChatFailureReportBody
    ) async {
    }
}

struct RepairingChatService: AIChatStreaming, @unchecked Sendable {
    let terminalError: Error?

    func streamTurn(
        session: CloudLinkedSession,
        request: AILocalChatRequestBody,
        onDelta: @escaping @Sendable (String) async -> Void,
        onToolCall: @escaping @Sendable (AIChatToolCall) async -> Void,
        onToolCallRequest: @escaping @Sendable (AIToolCallRequest) async -> Void,
        onRepairAttempt: @escaping @Sendable (AIChatRepairAttemptStatus) async -> Void
    ) async throws -> AITurnStreamOutcome {
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
}

struct FailingToolExecutor: AIToolExecuting, AIChatSnapshotLoading {
    func execute(toolCallRequest: AIToolCallRequest, requestId: String?) async throws -> AIToolExecutionResult {
        XCTFail("execute should not be called in this test")
        return AIToolExecutionResult(output: "", didMutateAppState: false)
    }

    func loadSnapshot() async throws -> AppStateSnapshot {
        XCTFail("loadSnapshot should not be called in this test")
        throw LocalStoreError.uninitialized("Snapshot should not be requested")
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
        onDelta: @escaping @Sendable (String) async -> Void,
        onToolCall: @escaping @Sendable (AIChatToolCall) async -> Void,
        onToolCallRequest: @escaping @Sendable (AIToolCallRequest) async -> Void,
        onRepairAttempt: @escaping @Sendable (AIChatRepairAttemptStatus) async -> Void
    ) async throws -> AITurnStreamOutcome {
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
        onDelta: @escaping @Sendable (String) async -> Void,
        onToolCall: @escaping @Sendable (AIChatToolCall) async -> Void,
        onToolCallRequest: @escaping @Sendable (AIToolCallRequest) async -> Void,
        onRepairAttempt: @escaping @Sendable (AIChatRepairAttemptStatus) async -> Void
    ) async throws -> AITurnStreamOutcome {
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

    func snapshotRequests() -> [AILocalChatRequestBody] {
        self.requests
    }
}

actor RecoveringToolFailureExecutor: AIToolExecuting, AIChatSnapshotLoading {
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

    func loadSnapshot() async throws -> AppStateSnapshot {
        throw LocalStoreError.uninitialized("Snapshot should not be requested")
    }
}

actor AlwaysFailingToolExecutor: AIToolExecuting, AIChatSnapshotLoading {
    func execute(toolCallRequest: AIToolCallRequest, requestId: String?) async throws -> AIToolExecutionResult {
        throw StubLocalizedError(message: "Unsupported SELECT statement")
    }

    func loadSnapshot() async throws -> AppStateSnapshot {
        throw LocalStoreError.uninitialized("Snapshot should not be requested")
    }
}

struct BurstChatService: AIChatStreaming {
    let deltas: [String]

    func streamTurn(
        session: CloudLinkedSession,
        request: AILocalChatRequestBody,
        onDelta: @escaping @Sendable (String) async -> Void,
        onToolCall: @escaping @Sendable (AIChatToolCall) async -> Void,
        onToolCallRequest: @escaping @Sendable (AIToolCallRequest) async -> Void,
        onRepairAttempt: @escaping @Sendable (AIChatRepairAttemptStatus) async -> Void
    ) async throws -> AITurnStreamOutcome {
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
}

actor MutatingChatService: AIChatStreaming {
    private var callCount: Int = 0

    func streamTurn(
        session: CloudLinkedSession,
        request: AILocalChatRequestBody,
        onDelta: @escaping @Sendable (String) async -> Void,
        onToolCall: @escaping @Sendable (AIChatToolCall) async -> Void,
        onToolCallRequest: @escaping @Sendable (AIToolCallRequest) async -> Void,
        onRepairAttempt: @escaping @Sendable (AIChatRepairAttemptStatus) async -> Void
    ) async throws -> AITurnStreamOutcome {
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
}

actor DelayedToolCompletionChatService: AIChatStreaming {
    private var callCount: Int = 0

    func streamTurn(
        session: CloudLinkedSession,
        request: AILocalChatRequestBody,
        onDelta: @escaping @Sendable (String) async -> Void,
        onToolCall: @escaping @Sendable (AIChatToolCall) async -> Void,
        onToolCallRequest: @escaping @Sendable (AIToolCallRequest) async -> Void,
        onRepairAttempt: @escaping @Sendable (AIChatRepairAttemptStatus) async -> Void
    ) async throws -> AITurnStreamOutcome {
        self.callCount += 1

        if self.callCount == 1 {
            let toolCallRequest = AIToolCallRequest(
                toolCallId: "tool-delayed-1",
                name: "sql",
                input: "{\"sql\":\"SHOW TABLES\"}"
            )
            await onToolCallRequest(toolCallRequest)
            return AITurnStreamOutcome(
                awaitsToolResults: true,
                requestedToolCalls: [toolCallRequest],
                requestId: "request-delayed-tool-1"
            )
        }

        await onDelta("Done")
        return AITurnStreamOutcome(awaitsToolResults: false, requestedToolCalls: [], requestId: "request-delayed-tool-2")
    }

    func reportFailureDiagnostics(
        session: CloudLinkedSession,
        body: AIChatFailureReportBody
    ) async {
    }
}

struct SlowSuccessToolExecutor: AIToolExecuting, AIChatSnapshotLoading {
    let pauseNanoseconds: UInt64

    func execute(toolCallRequest: AIToolCallRequest, requestId: String?) async throws -> AIToolExecutionResult {
        try await Task.sleep(nanoseconds: self.pauseNanoseconds)
        return AIToolExecutionResult(output: "{\"ok\":true}", didMutateAppState: false)
    }

    func loadSnapshot() async throws -> AppStateSnapshot {
        throw LocalStoreError.uninitialized("Snapshot should not be requested")
    }
}

struct SuspendingChatService: AIChatStreaming, @unchecked Sendable {
    func streamTurn(
        session: CloudLinkedSession,
        request: AILocalChatRequestBody,
        onDelta: @escaping @Sendable (String) async -> Void,
        onToolCall: @escaping @Sendable (AIChatToolCall) async -> Void,
        onToolCallRequest: @escaping @Sendable (AIToolCallRequest) async -> Void,
        onRepairAttempt: @escaping @Sendable (AIChatRepairAttemptStatus) async -> Void
    ) async throws -> AITurnStreamOutcome {
        try await Task.sleep(nanoseconds: 10_000_000_000)
        return AITurnStreamOutcome(awaitsToolResults: false, requestedToolCalls: [], requestId: "request-suspending")
    }

    func reportFailureDiagnostics(
        session: CloudLinkedSession,
        body: AIChatFailureReportBody
    ) async {
    }
}

struct RepairingSuspendingChatService: AIChatStreaming, @unchecked Sendable {
    func streamTurn(
        session: CloudLinkedSession,
        request: AILocalChatRequestBody,
        onDelta: @escaping @Sendable (String) async -> Void,
        onToolCall: @escaping @Sendable (AIChatToolCall) async -> Void,
        onToolCallRequest: @escaping @Sendable (AIToolCallRequest) async -> Void,
        onRepairAttempt: @escaping @Sendable (AIChatRepairAttemptStatus) async -> Void
    ) async throws -> AITurnStreamOutcome {
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
        onDelta: @escaping @Sendable (String) async -> Void,
        onToolCall: @escaping @Sendable (AIChatToolCall) async -> Void,
        onToolCallRequest: @escaping @Sendable (AIToolCallRequest) async -> Void,
        onRepairAttempt: @escaping @Sendable (AIChatRepairAttemptStatus) async -> Void
    ) async throws -> AITurnStreamOutcome {
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
}

struct ToolCallOnlyChatService: AIChatStreaming, @unchecked Sendable {
    let toolCall: AIChatToolCall

    func streamTurn(
        session: CloudLinkedSession,
        request: AILocalChatRequestBody,
        onDelta: @escaping @Sendable (String) async -> Void,
        onToolCall: @escaping @Sendable (AIChatToolCall) async -> Void,
        onToolCallRequest: @escaping @Sendable (AIToolCallRequest) async -> Void,
        onRepairAttempt: @escaping @Sendable (AIChatRepairAttemptStatus) async -> Void
    ) async throws -> AITurnStreamOutcome {
        await onToolCall(self.toolCall)
        return AITurnStreamOutcome(awaitsToolResults: false, requestedToolCalls: [], requestId: "request-tool-call-only")
    }

    func reportFailureDiagnostics(
        session: CloudLinkedSession,
        body: AIChatFailureReportBody
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
            content: contentParts,
            toolCallId: toolCallId,
            name: name,
            output: output
        )
    }
}

extension AILocalChatRequestBody {
    init(messages: [AILocalChatWireMessage], model: String, timezone: String) {
        self.init(messages: messages, model: model, timezone: timezone, devicePlatform: "ios")
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
        self.addTeardownBlock {
            try? FileManager.default.removeItem(at: databaseDirectory)
        }

        let suiteName = "flashcards-store-tests-\(UUID().uuidString)"
        let userDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        userDefaults.removePersistentDomain(forName: suiteName)
        self.addTeardownBlock {
            userDefaults.removePersistentDomain(forName: suiteName)
        }

        return FlashcardsStore(
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
            initialGlobalErrorMessage: ""
        )
    }

    @MainActor
    func makeLinkedStore() throws -> FlashcardsStore {
        try self.makeLinkedStore(
            cloudAuthService: CloudAuthService(),
            idTokenExpiresAt: isoTimestamp(date: Date().addingTimeInterval(3600))
        )
    }

    @MainActor
    func makeLinkedStore(
        cloudAuthService: CloudAuthService,
        idTokenExpiresAt: String
    ) throws -> FlashcardsStore {
        let databaseDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: databaseDirectory, withIntermediateDirectories: true)
        self.addTeardownBlock {
            try? FileManager.default.removeItem(at: databaseDirectory)
        }

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

        return FlashcardsStore(
            userDefaults: userDefaults,
            encoder: encoder,
            decoder: decoder,
            database: database,
            cloudAuthService: cloudAuthService,
            credentialStore: credentialStore,
            initialGlobalErrorMessage: ""
        )
    }

    @MainActor
    func waitForChatCompletion(chatStore: AIChatStore) async throws {
        for _ in 0..<50 {
            if chatStore.isStreaming == false {
                return
            }

            try await Task.sleep(nanoseconds: 20_000_000)
        }

        XCTFail("Timed out waiting for chat completion")
    }

    @MainActor
    func waitForRepairStatus(chatStore: AIChatStore) async throws {
        for _ in 0..<50 {
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
            let (response, data) = try handler(self.request)
            self.client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            self.client?.urlProtocol(self, didLoad: data)
            self.client?.urlProtocolDidFinishLoading(self)
        } catch {
            self.client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
