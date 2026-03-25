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

typealias AIChatLocalContext = AIChatContext

protocol AIChatLocalContextLoading: AIChatContextLoading {
    func loadLocalContext() async throws -> AIChatLocalContext
}

extension AIChatLocalContextLoading {
    func loadContext() async throws -> AIChatContext {
        try await self.loadLocalContext()
    }
}

extension AIChatPersistedState {
    init(messages: [AIChatMessage], chatSessionId: String = makeAIChatSessionId()) {
        self.init(
            messages: messages,
            chatSessionId: chatSessionId,
            lastKnownChatConfig: nil
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
        self.savedState = AIChatPersistedState(messages: [])
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

struct StubContextLoader: AIChatLocalContextLoading {
    let totalCards: Int

    init(totalCards: Int = 1) {
        self.totalCards = totalCards
    }

    func loadLocalContext() async throws -> AIChatLocalContext {
        makeStubAIChatLocalContext(totalCards: self.totalCards)
    }
}

final class FailingChatService: AIChatSessionServicing, @unchecked Sendable {
    func loadSnapshot(
        session: CloudLinkedSession,
        sessionId: String?
    ) async throws -> AIChatSessionSnapshot {
        _ = session
        return AIChatSessionSnapshot(
            sessionId: sessionId ?? "session-test",
            runState: "idle",
            updatedAt: 0,
            mainContentInvalidationVersion: 0,
            chatConfig: aiChatDefaultServerConfig,
            messages: []
        )
    }

    func startRun(
        session: CloudLinkedSession,
        request: AIChatStartRunRequestBody
    ) async throws -> AIChatStartRunResponse {
        _ = session
        XCTFail("startRun should not be called in this test")
        return AIChatStartRunResponse(
            ok: true,
            sessionId: request.sessionId ?? "session-test",
            runId: "run-test",
            runState: "idle",
            chatConfig: aiChatDefaultServerConfig
        )
    }

    func resetSession(
        session: CloudLinkedSession,
        sessionId: String?
    ) async throws -> AIChatResetSessionResponse {
        _ = session
        return AIChatResetSessionResponse(
            ok: true,
            sessionId: sessionId ?? "session-reset",
            chatConfig: aiChatDefaultServerConfig
        )
    }

    func stopRun(
        session: CloudLinkedSession,
        sessionId: String
    ) async throws -> AIChatStopRunResponse {
        _ = session
        return AIChatStopRunResponse(
            ok: true,
            sessionId: sessionId,
            runId: "run-test",
            stopped: true,
            stillRunning: false
        )
    }
}

struct StubLocalizedError: LocalizedError {
    let message: String

    var errorDescription: String? {
        self.message
    }
}

actor SuspendingChatService: AIChatSessionServicing {
    private var hasStopped: Bool

    init() {
        self.hasStopped = false
    }

    func loadSnapshot(
        session: CloudLinkedSession,
        sessionId: String?
    ) async throws -> AIChatSessionSnapshot {
        _ = session
        return AIChatSessionSnapshot(
            sessionId: sessionId ?? "session-suspending",
            runState: self.hasStopped ? "idle" : "running",
            updatedAt: self.hasStopped ? 2 : 1,
            mainContentInvalidationVersion: 0,
            chatConfig: aiChatDefaultServerConfig,
            messages: []
        )
    }

    func startRun(
        session: CloudLinkedSession,
        request: AIChatStartRunRequestBody
    ) async throws -> AIChatStartRunResponse {
        _ = session
        self.hasStopped = false
        return AIChatStartRunResponse(
            ok: true,
            sessionId: request.sessionId ?? "session-suspending",
            runId: "run-suspending",
            runState: "running",
            chatConfig: aiChatDefaultServerConfig
        )
    }

    func resetSession(
        session: CloudLinkedSession,
        sessionId: String?
    ) async throws -> AIChatResetSessionResponse {
        _ = session
        self.hasStopped = true
        return AIChatResetSessionResponse(
            ok: true,
            sessionId: sessionId ?? "session-reset",
            chatConfig: aiChatDefaultServerConfig
        )
    }

    func stopRun(
        session: CloudLinkedSession,
        sessionId: String
    ) async throws -> AIChatStopRunResponse {
        _ = session
        self.hasStopped = true
        return AIChatStopRunResponse(
            ok: true,
            sessionId: sessionId,
            runId: "run-suspending",
            stopped: true,
            stillRunning: false
        )
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
