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
        onToolCallRequest: @escaping @Sendable (AIToolCallRequest) async -> Void,
        onRepairAttempt: @escaping @Sendable (AIChatRepairAttemptStatus) async -> Void
    ) async throws -> AITurnStreamOutcome {
        await onDelta("Checking")
        await onRepairAttempt(
            AIChatRepairAttemptStatus(
                message: "Assistant is correcting list_cards.",
                attempt: 1,
                maxAttempts: 3,
                toolName: "list_cards"
            )
        )

        if let terminalError {
            throw terminalError
        }

        await onToolCallRequest(
            AIToolCallRequest(
                toolCallId: "call-1",
                name: "list_cards",
                input: "{\"limit\":null}"
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

struct BurstChatService: AIChatStreaming {
    let deltas: [String]

    func streamTurn(
        session: CloudLinkedSession,
        request: AILocalChatRequestBody,
        onDelta: @escaping @Sendable (String) async -> Void,
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
        onToolCallRequest: @escaping @Sendable (AIToolCallRequest) async -> Void,
        onRepairAttempt: @escaping @Sendable (AIChatRepairAttemptStatus) async -> Void
    ) async throws -> AITurnStreamOutcome {
        self.callCount += 1

        if self.callCount == 1 {
            let toolCallRequest = AIToolCallRequest(
                toolCallId: "tool-create-card",
                name: "create_cards",
                input: "{\"cards\":[{\"frontText\":\"Front\",\"backText\":\"Back\",\"tags\":[\"tag-a\"],\"effortLevel\":\"medium\"}]}"
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

struct SuspendingChatService: AIChatStreaming, @unchecked Sendable {
    func streamTurn(
        session: CloudLinkedSession,
        request: AILocalChatRequestBody,
        onDelta: @escaping @Sendable (String) async -> Void,
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
        onToolCallRequest: @escaping @Sendable (AIToolCallRequest) async -> Void,
        onRepairAttempt: @escaping @Sendable (AIChatRepairAttemptStatus) async -> Void
    ) async throws -> AITurnStreamOutcome {
        await onRepairAttempt(
            AIChatRepairAttemptStatus(
                message: "Assistant is correcting list_cards.",
                attempt: 1,
                maxAttempts: 3,
                toolName: "list_cards"
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
                idTokenExpiresAt: isoTimestamp(date: Date().addingTimeInterval(3600))
            )
        )

        return FlashcardsStore(
            userDefaults: userDefaults,
            encoder: encoder,
            decoder: decoder,
            database: database,
            cloudAuthService: CloudAuthService(),
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
