import Foundation
import XCTest
@testable import Flashcards

enum AIChatStoreTestSupport {
    private static let backgroundTaskTimeout: Duration = .seconds(2)
    private static let taskTimeout: Duration = .seconds(3)
    private static let toolRunPostSyncTaskTimeout: Duration = .seconds(5)
    private static let workspaceSwitchToolRunPostSyncTimeout: Duration = .seconds(8)
    private static let taskPollInterval: Duration = .milliseconds(10)

    struct Context {
        let suiteName: String
        let userDefaults: UserDefaults
        let databaseURL: URL
        let database: LocalDatabase
        let historyStore: AIChatHistoryStore
        let flashcardsStore: FlashcardsStore
        let chatService: ChatService
        let cloudSyncService: CloudSyncService

        @MainActor
        static func make() -> Context {
            let suiteName = "ai-chat-run-tool-call-tracking-\(UUID().uuidString)"
            let userDefaults = UserDefaults(suiteName: suiteName)!
            let databaseURL = FileManager.default.temporaryDirectory
                .appendingPathComponent("ai-chat-run-tool-call-tracking-\(UUID().uuidString.lowercased())")
                .appendingPathExtension("sqlite")
            let database = try! LocalDatabase(databaseURL: databaseURL)
            let historyStore = AIChatHistoryStore(
                userDefaults: userDefaults,
                encoder: JSONEncoder(),
                decoder: JSONDecoder()
            )
            let cloudSyncService = CloudSyncService()
            let chatService = ChatService()
            let flashcardsStore = FlashcardsStore(
                userDefaults: userDefaults,
                encoder: JSONEncoder(),
                decoder: JSONDecoder(),
                database: database,
                cloudAuthService: CloudAuthService(),
                cloudSyncService: cloudSyncService,
                credentialStore: CloudCredentialStore(service: "tests-\(suiteName)-cloud-auth"),
                guestCloudAuthService: GuestCloudAuthService(),
                guestCredentialStore: GuestCloudCredentialStore(
                    service: "tests-\(suiteName)-guest-auth",
                    bundle: .main,
                    userDefaults: userDefaults
                ),
                reviewSubmissionOutboxMutationGate: ReviewSubmissionOutboxMutationGate(),
                reviewSubmissionExecutor: nil,
                reviewHeadLoader: defaultReviewHeadLoader,
                reviewCountsLoader: defaultReviewCountsLoader,
                reviewQueueChunkLoader: defaultReviewQueueChunkLoader,
                reviewQueueWindowLoader: defaultReviewQueueWindowLoader,
                reviewTimelinePageLoader: defaultReviewTimelinePageLoader,
                initialGlobalErrorMessage: ""
            )

            return Context(
                suiteName: suiteName,
                userDefaults: userDefaults,
                databaseURL: databaseURL,
                database: database,
                historyStore: historyStore,
                flashcardsStore: flashcardsStore,
                chatService: chatService,
                cloudSyncService: cloudSyncService
            )
        }

        @MainActor
        func makeStore() -> AIChatStore {
            self.makeStore(
                voiceRecorder: AIChatDisabledVoiceRecorder(),
                audioTranscriber: AIChatDisabledAudioTranscriber()
            )
        }

        @MainActor
        func makeStore(
            voiceRecorder: any AIChatVoiceRecording,
            audioTranscriber: any AIChatAudioTranscribing
        ) -> AIChatStore {
            AIChatStore(
                flashcardsStore: self.flashcardsStore,
                historyStore: self.historyStore,
                chatService: self.chatService,
                contextLoader: ContextLoader(),
                voiceRecorder: voiceRecorder,
                audioTranscriber: audioTranscriber
            )
        }

        @MainActor
        func configureLinkedCloudSession() throws {
            try self.configureLinkedCloudSession(workspaceId: "workspace-1")
        }

        @MainActor
        func configureLinkedCloudSession(workspaceId: String) throws {
            let linkedSession = CloudLinkedSession(
                userId: "user-1",
                workspaceId: workspaceId,
                email: "user@example.com",
                configurationMode: .official,
                apiBaseUrl: "https://api.example.com",
                authorization: .bearer("token-1")
            )
            self.flashcardsStore.workspace = Workspace(
                workspaceId: workspaceId,
                name: "Workspace",
                createdAt: "2026-04-08T10:00:00Z"
            )
            self.flashcardsStore.cloudSettings = CloudSettings(
                installationId: "installation-1",
                cloudState: .linked,
                linkedUserId: "user-1",
                linkedWorkspaceId: workspaceId,
                activeWorkspaceId: workspaceId,
                linkedEmail: "user@example.com",
                onboardingCompleted: true,
                updatedAt: "2026-04-08T10:00:00Z"
            )
            try self.flashcardsStore.cloudRuntime.saveCredentials(
                credentials: StoredCloudCredentials(
                    refreshToken: "refresh-token-1",
                    idToken: "token-1",
                    idTokenExpiresAt: "2099-01-01T00:00:00Z"
                )
            )
            self.flashcardsStore.cloudRuntime.setActiveCloudSession(linkedSession: linkedSession)
            self.historyStore.activateWorkspace(
                workspaceId: makeAIChatHistoryScopedWorkspaceId(
                    workspaceId: self.flashcardsStore.workspace?.workspaceId,
                    cloudSettings: self.flashcardsStore.cloudSettings
                )
            )
        }

        func linkedHistoryWorkspaceId(workspaceId: String) -> String {
            makeAIChatHistoryScopedWorkspaceId(
                workspaceId: workspaceId,
                cloudSettings: CloudSettings(
                    installationId: "installation-1",
                    cloudState: .linked,
                    linkedUserId: "user-1",
                    linkedWorkspaceId: workspaceId,
                    activeWorkspaceId: workspaceId,
                    linkedEmail: "user@example.com",
                    onboardingCompleted: true,
                    updatedAt: "2026-04-08T10:00:00Z"
                )
            )!
        }

        @MainActor
        func configureGuestCloudSession() throws {
            let configuration = try self.flashcardsStore.currentCloudServiceConfiguration()
            let guestSession = StoredGuestCloudSession(
                guestToken: "guest-token-1",
                userId: "guest-user-1",
                workspaceId: "workspace-1",
                configurationMode: configuration.mode,
                apiBaseUrl: configuration.apiBaseUrl
            )
            let linkedSession = CloudLinkedSession(
                userId: guestSession.userId,
                workspaceId: guestSession.workspaceId,
                email: nil,
                configurationMode: guestSession.configurationMode,
                apiBaseUrl: guestSession.apiBaseUrl,
                authorization: .guest(guestSession.guestToken)
            )
            self.flashcardsStore.workspace = Workspace(
                workspaceId: "workspace-1",
                name: "Workspace",
                createdAt: "2026-04-08T10:00:00Z"
            )
            self.flashcardsStore.cloudSettings = CloudSettings(
                installationId: "installation-1",
                cloudState: .guest,
                linkedUserId: guestSession.userId,
                linkedWorkspaceId: guestSession.workspaceId,
                activeWorkspaceId: guestSession.workspaceId,
                linkedEmail: nil,
                onboardingCompleted: true,
                updatedAt: "2026-04-08T10:00:00Z"
            )
            try self.flashcardsStore.dependencies.guestCredentialStore.saveGuestSession(session: guestSession)
            self.flashcardsStore.cloudRuntime.setActiveCloudSession(linkedSession: linkedSession)
            self.historyStore.activateWorkspace(
                workspaceId: makeAIChatHistoryScopedWorkspaceId(
                    workspaceId: self.flashcardsStore.workspace?.workspaceId,
                    cloudSettings: self.flashcardsStore.cloudSettings
                )
            )
        }

        func tearDown() {
            self.userDefaults.removePersistentDomain(forName: self.suiteName)
        }
    }

    struct ContextLoader: AIChatContextLoading {
        func loadContext() async throws -> AIChatContext {
            fatalError("Not used in AIChatStoreTestSupport.")
        }
    }

    final class ChatService: AIChatSessionServicing, @unchecked Sendable {
        var events: [String]
        var loadSnapshotSessionIds: [String?]
        var loadBootstrapSessionIds: [String?]
        var loadBootstrapGate: AsyncGate?
        var startRunRequests: [AIChatStartRunRequestBody]
        var createNewSessionRequests: [AIChatNewSessionRequestBody]
        var loadBootstrapHandler: ((String?) throws -> AIChatBootstrapResponse)?
        var startRunHandler: ((AIChatStartRunRequestBody) throws -> AIChatStartRunResponse)?
        var createNewSessionHandler: ((AIChatNewSessionRequestBody) throws -> AIChatNewSessionResponse)?

        var createNewSessionSessionIds: [String?] {
            self.createNewSessionRequests.map(\.sessionId)
        }

        init() {
            self.events = []
            self.loadSnapshotSessionIds = []
            self.loadBootstrapSessionIds = []
            self.loadBootstrapGate = nil
            self.startRunRequests = []
            self.createNewSessionRequests = []
            self.loadBootstrapHandler = nil
            self.startRunHandler = nil
            self.createNewSessionHandler = nil
        }

        func loadSnapshot(
            session: CloudLinkedSession,
            sessionId: String?
        ) async throws -> AIChatSessionSnapshot {
            _ = session
            self.events.append("loadSnapshot:\(sessionId ?? "nil")")
            self.loadSnapshotSessionIds.append(sessionId)
            throw LocalStoreError.validation("Unexpected AI chat snapshot request in tests.")
        }

        func loadBootstrap(
            session: CloudLinkedSession,
            sessionId: String?,
            limit: Int,
            resumeAttemptDiagnostics: AIChatResumeAttemptDiagnostics?
        ) async throws -> AIChatBootstrapResponse {
            _ = session
            _ = limit
            _ = resumeAttemptDiagnostics
            self.events.append("loadBootstrap:\(sessionId ?? "nil")")
            self.loadBootstrapSessionIds.append(sessionId)
            if let loadBootstrapGate = self.loadBootstrapGate {
                await loadBootstrapGate.wait()
            }
            guard let loadBootstrapHandler else {
                throw LocalStoreError.validation("Unexpected AI chat bootstrap request in tests.")
            }
            return try loadBootstrapHandler(sessionId)
        }

        func loadOlderMessages(
            session: CloudLinkedSession,
            sessionId: String,
            beforeCursor: String,
            limit: Int
        ) async throws -> AIChatOlderMessagesResponse {
            _ = session
            _ = sessionId
            _ = beforeCursor
            _ = limit
            throw LocalStoreError.validation("Unexpected AI chat older-messages request in tests.")
        }

        func startRun(
            session: CloudLinkedSession,
            request: AIChatStartRunRequestBody
        ) async throws -> AIChatStartRunResponse {
            _ = session
            self.events.append("startRun:\(request.sessionId ?? "nil")")
            self.startRunRequests.append(request)
            guard let startRunHandler else {
                throw LocalStoreError.validation("Unexpected AI chat start-run request in tests.")
            }
            return try startRunHandler(request)
        }

        func createNewSession(
            session: CloudLinkedSession,
            request: AIChatNewSessionRequestBody
        ) async throws -> AIChatNewSessionResponse {
            _ = session
            self.events.append("createNewSession:\(request.sessionId ?? "nil")")
            self.createNewSessionRequests.append(request)
            guard let createNewSessionHandler else {
                throw LocalStoreError.validation("Unexpected AI chat new-session request in tests.")
            }
            return try createNewSessionHandler(request)
        }

        func stopRun(
            session: CloudLinkedSession,
            sessionId: String
        ) async throws -> AIChatStopRunResponse {
            _ = session
            return AIChatStopRunResponse(
                sessionId: sessionId,
                stopped: false,
                stillRunning: false
            )
        }
    }

    struct WorkspaceBootstrapEmptinessRequest: Equatable {
        let apiBaseUrl: String
        let authorizationHeader: String
        let workspaceId: String
        let installationId: String
    }

    struct ProgressSummaryRequest: Equatable {
        let apiBaseUrl: String
        let authorizationHeader: String
        let timeZone: String
    }

    struct ProgressSeriesRequest: Equatable {
        let apiBaseUrl: String
        let authorizationHeader: String
        let timeZone: String
        let from: String
        let to: String
    }

    @MainActor
    final class CloudSyncService: CloudSyncServing {
        var runLinkedSyncCallCount: Int
        var syncExpectation: XCTestExpectation?
        var runLinkedSyncErrors: [Error]
        var runLinkedSyncGate: AsyncGate?
        var isWorkspaceEmptyForBootstrapResult: Bool
        var isWorkspaceEmptyForBootstrapRequests: [WorkspaceBootstrapEmptinessRequest]
        var progressSummaryRequests: [ProgressSummaryRequest]
        var progressSeriesRequests: [ProgressSeriesRequest]

        init() {
            self.runLinkedSyncCallCount = 0
            self.syncExpectation = nil
            self.runLinkedSyncErrors = []
            self.runLinkedSyncGate = nil
            self.isWorkspaceEmptyForBootstrapResult = true
            self.isWorkspaceEmptyForBootstrapRequests = []
            self.progressSummaryRequests = []
            self.progressSeriesRequests = []
        }

        func fetchCloudAccount(apiBaseUrl: String, bearerToken: String) async throws -> CloudAccountSnapshot {
            _ = apiBaseUrl
            _ = bearerToken
            fatalError("Not used in AIChatStoreTestSupport.")
        }

        func loadProgressSummary(
            apiBaseUrl: String,
            authorizationHeader: String,
            timeZone: String
        ) async throws -> UserProgressSummary {
            self.progressSummaryRequests.append(
                ProgressSummaryRequest(
                    apiBaseUrl: apiBaseUrl,
                    authorizationHeader: authorizationHeader,
                    timeZone: timeZone
                )
            )
            return UserProgressSummary(
                timeZone: timeZone,
                summary: ProgressSummary(
                    currentStreakDays: 0,
                    hasReviewedToday: false,
                    lastReviewedOn: nil,
                    activeReviewDays: 0
                ),
                generatedAt: "2026-04-25T00:00:00.000Z"
            )
        }

        func loadProgressSeries(
            apiBaseUrl: String,
            authorizationHeader: String,
            timeZone: String,
            from: String,
            to: String
        ) async throws -> UserProgressSeries {
            self.progressSeriesRequests.append(
                ProgressSeriesRequest(
                    apiBaseUrl: apiBaseUrl,
                    authorizationHeader: authorizationHeader,
                    timeZone: timeZone,
                    from: from,
                    to: to
                )
            )
            return UserProgressSeries(
                timeZone: timeZone,
                from: from,
                to: to,
                dailyReviews: [],
                summary: ProgressSummary(
                    currentStreakDays: 0,
                    hasReviewedToday: false,
                    lastReviewedOn: nil,
                    activeReviewDays: 0
                ),
                generatedAt: "2026-04-25T00:00:00.000Z"
            )
        }

        func createWorkspace(apiBaseUrl: String, bearerToken: String, name: String) async throws -> CloudWorkspaceSummary {
            _ = apiBaseUrl
            _ = bearerToken
            _ = name
            fatalError("Not used in AIChatStoreTestSupport.")
        }

        func renameWorkspace(
            apiBaseUrl: String,
            bearerToken: String,
            workspaceId: String,
            name: String
        ) async throws -> CloudWorkspaceSummary {
            _ = apiBaseUrl
            _ = bearerToken
            _ = workspaceId
            _ = name
            fatalError("Not used in AIChatStoreTestSupport.")
        }

        func loadWorkspaceDeletePreview(
            apiBaseUrl: String,
            bearerToken: String,
            workspaceId: String
        ) async throws -> CloudWorkspaceDeletePreview {
            _ = apiBaseUrl
            _ = bearerToken
            _ = workspaceId
            fatalError("Not used in AIChatStoreTestSupport.")
        }

        func loadWorkspaceResetProgressPreview(
            apiBaseUrl: String,
            bearerToken: String,
            workspaceId: String
        ) async throws -> CloudWorkspaceResetProgressPreview {
            _ = apiBaseUrl
            _ = bearerToken
            _ = workspaceId
            fatalError("Not used in AIChatStoreTestSupport.")
        }

        func deleteWorkspace(
            apiBaseUrl: String,
            bearerToken: String,
            workspaceId: String,
            confirmationText: String
        ) async throws -> CloudWorkspaceDeleteResult {
            _ = apiBaseUrl
            _ = bearerToken
            _ = workspaceId
            _ = confirmationText
            fatalError("Not used in AIChatStoreTestSupport.")
        }

        func resetWorkspaceProgress(
            apiBaseUrl: String,
            bearerToken: String,
            workspaceId: String,
            confirmationText: String
        ) async throws -> CloudWorkspaceResetProgressResult {
            _ = apiBaseUrl
            _ = bearerToken
            _ = workspaceId
            _ = confirmationText
            fatalError("Not used in AIChatStoreTestSupport.")
        }

        func selectWorkspace(
            apiBaseUrl: String,
            bearerToken: String,
            workspaceId: String
        ) async throws -> CloudWorkspaceSummary {
            _ = apiBaseUrl
            _ = bearerToken
            _ = workspaceId
            fatalError("Not used in AIChatStoreTestSupport.")
        }

        func listAgentApiKeys(
            apiBaseUrl: String,
            bearerToken: String
        ) async throws -> ([AgentApiKeyConnection], String) {
            _ = apiBaseUrl
            _ = bearerToken
            fatalError("Not used in AIChatStoreTestSupport.")
        }

        func revokeAgentApiKey(
            apiBaseUrl: String,
            bearerToken: String,
            connectionId: String
        ) async throws -> (AgentApiKeyConnection, String) {
            _ = apiBaseUrl
            _ = bearerToken
            _ = connectionId
            fatalError("Not used in AIChatStoreTestSupport.")
        }

        func isWorkspaceEmptyForBootstrap(
            apiBaseUrl: String,
            authorizationHeader: String,
            workspaceId: String,
            installationId: String
        ) async throws -> Bool {
            self.isWorkspaceEmptyForBootstrapRequests.append(
                WorkspaceBootstrapEmptinessRequest(
                    apiBaseUrl: apiBaseUrl,
                    authorizationHeader: authorizationHeader,
                    workspaceId: workspaceId,
                    installationId: installationId
                )
            )
            return self.isWorkspaceEmptyForBootstrapResult
        }

        func deleteAccount(apiBaseUrl: String, bearerToken: String, confirmationText: String) async throws {
            _ = apiBaseUrl
            _ = bearerToken
            _ = confirmationText
            fatalError("Not used in AIChatStoreTestSupport.")
        }

        func runLinkedSync(linkedSession: CloudLinkedSession) async throws -> CloudSyncResult {
            _ = linkedSession
            self.runLinkedSyncCallCount += 1
            self.syncExpectation?.fulfill()
            if let runLinkedSyncGate = self.runLinkedSyncGate {
                await runLinkedSyncGate.wait()
                self.runLinkedSyncGate = nil
            }
            if self.runLinkedSyncErrors.isEmpty == false {
                let error = self.runLinkedSyncErrors.removeFirst()
                throw error
            }
            return CloudSyncResult(
                appliedPullChangeCount: 0,
                changedEntityTypes: [],
                localIdRepairEntityTypes: [],
                acknowledgedOperationCount: 0,
                acknowledgedReviewEventOperationCount: 0,
                cleanedUpOperationCount: 0,
                cleanedUpReviewEventOperationCount: 0
            )
        }
    }

    @MainActor
    final class TestVoiceRecorder: AIChatVoiceRecording {
        func startRecording() async throws {
            throw LocalStoreError.validation("Not used in AI chat dictation tests.")
        }

        func stopRecording() async throws -> AIChatRecordedAudio {
            let fileUrl = FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString.lowercased())
                .appendingPathExtension("m4a")
            try Data("audio".utf8).write(to: fileUrl)
            return AIChatRecordedAudio(
                fileUrl: fileUrl,
                fileName: "chat-dictation.m4a",
                mediaType: "audio/mp4"
            )
        }

        func cancelRecording() {
        }
    }

    actor TestAudioTranscriber: AIChatAudioTranscribing {
        private var sessionIds: [String?]

        init() {
            self.sessionIds = []
        }

        func transcribe(
            session: CloudLinkedSession,
            sessionId: String?,
            recordedAudio: AIChatRecordedAudio
        ) async throws -> AIChatTranscriptionResult {
            _ = session
            _ = recordedAudio
            self.sessionIds.append(sessionId)
            guard let sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id for transcription.")
            }
            return AIChatTranscriptionResult(
                text: "Transcript",
                sessionId: sessionId
            )
        }

        func transcribedSessionIds() -> [String?] {
            self.sessionIds
        }
    }

    actor AsyncGate {
        private var continuation: CheckedContinuation<Void, Never>?
        private var isReleased: Bool

        init() {
            self.continuation = nil
            self.isReleased = false
        }

        func wait() async {
            if self.isReleased {
                return
            }

            await withCheckedContinuation { continuation in
                self.continuation = continuation
            }
        }

        func release() {
            self.isReleased = true
            self.continuation?.resume()
            self.continuation = nil
        }
    }

    static func makeConversationEnvelope(
        messages: [AIChatMessage],
        activeRun: AIChatActiveRun?
    ) -> AIChatConversationEnvelope {
        self.makeConversationEnvelope(
            sessionId: "session-1",
            messages: messages,
            activeRun: activeRun
        )
    }

    static func makeConversationEnvelope(
        sessionId: String,
        messages: [AIChatMessage],
        activeRun: AIChatActiveRun?
    ) -> AIChatConversationEnvelope {
        AIChatConversationEnvelope(
            sessionId: sessionId,
            conversationScopeId: sessionId,
            conversation: AIChatConversation(
                messages: messages,
                updatedAt: 1,
                mainContentInvalidationVersion: 1,
                hasOlder: false,
                oldestCursor: nil
            ),
            composerSuggestions: [],
            chatConfig: aiChatDefaultServerConfig,
            activeRun: activeRun
        )
    }

    static func makeActiveRun() -> AIChatActiveRun {
        AIChatActiveRun(
            runId: "run-1",
            status: "running",
            live: AIChatActiveRunLive(
                cursor: "cursor-1",
                stream: AIChatLiveStreamEnvelope(
                    url: "https://example.com/live",
                    authorization: "Bearer token",
                    expiresAt: 1
                )
            ),
            lastHeartbeatAt: nil
        )
    }

    static func makeAssistantToolCallMessage(toolCallStatus: AIChatToolCallStatus) -> AIChatMessage {
        AIChatMessage(
            id: "message-1",
            role: .assistant,
            content: [
                .toolCall(
                    AIChatToolCall(
                        id: "tool-1",
                        name: "sql",
                        status: toolCallStatus,
                        input: "{\"query\":\"select 1\"}",
                        output: nil
                    )
                )
            ],
            timestamp: "2026-04-08T10:00:00Z",
            isError: false,
            isStopped: false,
            cursor: "cursor-1",
            itemId: "item-1"
        )
    }

    static func makeAssistantTextMessage(itemId: String) -> AIChatMessage {
        AIChatMessage(
            id: "message-1",
            role: .assistant,
            content: [.text("Working on it.")],
            timestamp: "2026-04-08T10:00:00Z",
            isError: false,
            isStopped: false,
            cursor: "cursor-1",
            itemId: itemId
        )
    }

    static func makeUserTextMessage(id: String, text: String, timestamp: String) -> AIChatMessage {
        AIChatMessage(
            id: id,
            role: .user,
            content: [.text(text)],
            timestamp: timestamp,
            isError: false,
            isStopped: false,
            cursor: nil,
            itemId: nil
        )
    }

    static func makeAssistantTextMessage(
        id: String,
        itemId: String,
        text: String,
        timestamp: String
    ) -> AIChatMessage {
        AIChatMessage(
            id: id,
            role: .assistant,
            content: [.text(text)],
            timestamp: timestamp,
            isError: false,
            isStopped: false,
            cursor: "cursor-\(id)",
            itemId: itemId
        )
    }

    @MainActor
    static func setAISurfaceVisibility(store: AIChatStore, isVisible: Bool) {
        if isVisible {
            store.hasExternalProviderConsent = true
        }
        var updatedSurfaceState = store.surfaceState
        let currentActivity = updatedSurfaceState.activity
        updatedSurfaceState.activity = AIChatSurfaceActivity(
            isSceneActive: isVisible,
            isAITabSelected: isVisible,
            hasExternalProviderConsent: isVisible ? true : currentActivity.hasExternalProviderConsent,
            workspaceId: currentActivity.workspaceId,
            cloudState: currentActivity.cloudState,
            linkedUserId: currentActivity.linkedUserId,
            activeWorkspaceId: currentActivity.activeWorkspaceId
        )
        store.surfaceState = updatedSurfaceState
    }

    @MainActor
    static func waitForBackgroundTasks(store: AIChatStore) async {
        _ = await self.waitForCondition(
            description: "AI chat background tasks to become idle",
            timeout: self.backgroundTaskTimeout,
            pollInterval: self.taskPollInterval,
            condition: {
                store.activeToolRunPostSyncTask == nil
                    && store.activeBootstrapTask == nil
                    && store.activeSendTask == nil
                    && store.activeDictationTask == nil
                    && store.activeNewSessionTask == nil
                    && store.activePersistTask == nil
                    && store.hasPendingStatePersistence() == false
            }
        )
    }

    @MainActor
    static func waitForCondition(
        description: String,
        timeout: Duration,
        pollInterval: Duration,
        condition: @escaping @MainActor () -> Bool
    ) async -> Bool {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: timeout)

        while true {
            if condition() {
                return true
            }

            if clock.now >= deadline {
                XCTFail("Timed out waiting for \(description).")
                return false
            }

            try? await Task.sleep(for: pollInterval)
        }
    }

    @MainActor
    static func waitForTaskToClear(
        description: String,
        timeout: Duration,
        pollInterval: Duration,
        taskProvider: @escaping @MainActor () -> Task<Void, Never>?
    ) async -> Bool {
        return await self.waitForCondition(
            description: "\(description) became nil",
            timeout: timeout,
            pollInterval: pollInterval,
            condition: {
                taskProvider() == nil
            }
        )
    }

    @MainActor
    static func waitForPendingStatePersistenceToDrain(store: AIChatStore) async {
        _ = await self.waitForCondition(
            description: "pending state persistence drained",
            timeout: self.taskTimeout,
            pollInterval: self.taskPollInterval,
            condition: {
                store.activePersistTask == nil && store.hasPendingStatePersistence() == false
            }
        )
    }

    @MainActor
    static func waitForToolRunPostSyncToSettle(store: AIChatStore) async {
        let didSettle = await self.waitForTaskToClear(
            description: "activeToolRunPostSyncTask",
            timeout: self.toolRunPostSyncTaskTimeout,
            pollInterval: self.taskPollInterval,
            taskProvider: {
                store.activeToolRunPostSyncTask
            }
        )
        if didSettle == false {
            return
        }
        await self.waitForPendingStatePersistenceToDrain(store: store)
    }

    @MainActor
    static func waitForToolRunPostSyncWorkspaceSwitchToSettle(
        store: AIChatStore,
        historyStore: any AIChatHistoryStoring,
        originalWorkspaceId: String,
        replacementWorkspaceId: String
    ) async {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: self.workspaceSwitchToolRunPostSyncTimeout)

        while true {
            let originalState = historyStore.loadState(workspaceId: originalWorkspaceId)
            let replacementState = historyStore.loadState(workspaceId: replacementWorkspaceId)
            let isSettled = store.activeToolRunPostSyncTask == nil
                && store.activePersistTask == nil
                && store.hasPendingStatePersistence() == false
                && store.chatSessionId == replacementState.chatSessionId
                && store.pendingToolRunPostSync
                && originalState.pendingToolRunPostSync == false
                && replacementState.pendingToolRunPostSync

            if isSettled {
                return
            }

            if clock.now >= deadline {
                XCTFail(
                    """
                    Timed out waiting for workspace-switch post-sync settled. \
                    activeToolRunPostSyncTask=\(store.activeToolRunPostSyncTask != nil) \
                    activePersistTask=\(store.activePersistTask != nil) \
                    hasPendingStatePersistence=\(store.hasPendingStatePersistence()) \
                    chatSessionId=\(store.chatSessionId) \
                    replacementChatSessionId=\(replacementState.chatSessionId) \
                    storePendingToolRunPostSync=\(store.pendingToolRunPostSync) \
                    originalPendingToolRunPostSync=\(originalState.pendingToolRunPostSync) \
                    replacementPendingToolRunPostSync=\(replacementState.pendingToolRunPostSync)
                    """
                )
                return
            }

            try? await Task.sleep(for: self.taskPollInterval)
        }
    }

    @MainActor
    static func waitForBootstrapToSettle(store: AIChatStore) async {
        _ = await self.waitForTaskToClear(
            description: "activeBootstrapTask",
            timeout: self.taskTimeout,
            pollInterval: self.taskPollInterval,
            taskProvider: {
                store.activeBootstrapTask
            }
        )
    }

    @MainActor
    static func waitForSendToSettle(store: AIChatStore) async {
        _ = await self.waitForTaskToClear(
            description: "activeSendTask",
            timeout: self.taskTimeout,
            pollInterval: self.taskPollInterval,
            taskProvider: {
                store.activeSendTask
            }
        )
    }

    @MainActor
    static func waitForDictationToSettle(store: AIChatStore) async {
        _ = await self.waitForTaskToClear(
            description: "activeDictationTask",
            timeout: self.taskTimeout,
            pollInterval: self.taskPollInterval,
            taskProvider: {
                store.activeDictationTask
            }
        )
    }

    @MainActor
    static func waitForNewSessionToSettle(store: AIChatStore) async {
        _ = await self.waitForTaskToClear(
            description: "activeNewSessionTask",
            timeout: self.taskTimeout,
            pollInterval: self.taskPollInterval,
            taskProvider: {
                store.activeNewSessionTask
            }
        )
    }

    static func makeNewSessionResponse(sessionId: String) -> AIChatNewSessionResponse {
        let chatConfigData = try! JSONEncoder().encode(aiChatDefaultServerConfig)
        let chatConfigObject = try! JSONSerialization.jsonObject(with: chatConfigData)
        let data = try! JSONSerialization.data(
            withJSONObject: [
                "ok": true,
                "sessionId": sessionId,
                "composerSuggestions": [],
                "chatConfig": chatConfigObject
            ]
        )
        return try! JSONDecoder().decode(AIChatNewSessionResponse.self, from: data)
    }

    static func makeAcceptedStartRunResponse(sessionId: String, userText: String) -> AIChatStartRunResponse {
        AIChatStartRunResponse(
            accepted: true,
            sessionId: sessionId,
            conversationScopeId: sessionId,
            conversation: AIChatConversation(
                messages: [
                    self.makeUserTextMessage(
                        id: "message-0",
                        text: userText,
                        timestamp: "2026-04-08T10:00:00Z"
                    ),
                    self.makeAssistantTextMessage(
                        id: "message-1",
                        itemId: "item-1",
                        text: "Working on it.",
                        timestamp: "2026-04-08T10:00:01Z"
                    )
                ],
                updatedAt: 1,
                mainContentInvalidationVersion: 1,
                hasOlder: false,
                oldestCursor: nil
            ),
            composerSuggestions: [],
            chatConfig: aiChatDefaultServerConfig,
            activeRun: nil,
            deduplicated: nil
        )
    }
}
