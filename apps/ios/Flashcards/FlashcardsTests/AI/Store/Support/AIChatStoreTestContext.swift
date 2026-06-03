import Foundation
@testable import Flashcards


extension AIChatStoreTestSupport {
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
}
