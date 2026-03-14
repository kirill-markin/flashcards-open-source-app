import Foundation
import XCTest
@testable import Flashcards

@MainActor
enum FlashcardsStoreTestSupport {
    struct StoreEnvironment {
        let database: LocalDatabase
        let userDefaults: UserDefaults
        let credentialStore: CloudCredentialStore
    }

    struct StoreContext {
        let store: FlashcardsStore
        let database: LocalDatabase
    }

    struct CloudSyncContext {
        let store: FlashcardsStore
        let database: LocalDatabase
        let credentialStore: CloudCredentialStore
        let cloudSyncService: MockCloudSyncService
    }

    enum ScriptedReviewSubmissionOutcome: Sendable {
        case submitToDatabase
        case fail(message: String)
    }

    actor ScriptedReviewSubmissionExecutor: ReviewSubmissionExecuting {
        private let databaseURL: URL
        private var database: LocalDatabase?
        private var outcomes: [ScriptedReviewSubmissionOutcome]
        private let delayNanoseconds: UInt64

        init(databaseURL: URL, outcomes: [ScriptedReviewSubmissionOutcome], delayNanoseconds: UInt64) {
            self.databaseURL = databaseURL
            self.database = nil
            self.outcomes = outcomes
            self.delayNanoseconds = delayNanoseconds
        }

        func submitReview(workspaceId: String, submission: ReviewSubmission) async throws -> Card {
            if self.delayNanoseconds > 0 {
                try await Task.sleep(nanoseconds: self.delayNanoseconds)
            }

            guard self.outcomes.isEmpty == false else {
                throw LocalStoreError.validation("Missing scripted review outcome")
            }

            let nextOutcome = self.outcomes.removeFirst()
            switch nextOutcome {
            case .submitToDatabase:
                let database = try self.resolvedDatabase()
                return try database.submitReview(workspaceId: workspaceId, reviewSubmission: submission)
            case .fail(let message):
                throw LocalStoreError.validation(message)
            }
        }

        private func resolvedDatabase() throws -> LocalDatabase {
            if let database {
                return database
            }

            let database = try LocalDatabase(databaseURL: self.databaseURL)
            self.database = database
            return database
        }
    }

    enum MockCloudSyncRunOutcome {
        case succeed
        case fail(message: String)
    }

    @MainActor
    final class MockCloudSyncService: CloudSyncServing {
        private(set) var runLinkedSyncCallCount: Int
        private(set) var runLinkedSyncSessions: [CloudLinkedSession]
        private var runLinkedSyncOutcomes: [MockCloudSyncRunOutcome]
        private var isRunLinkedSyncBlocked: Bool
        private var runLinkedSyncContinuation: CheckedContinuation<Void, Never>?

        init(runLinkedSyncOutcomes: [MockCloudSyncRunOutcome], isRunLinkedSyncBlocked: Bool) {
            self.runLinkedSyncCallCount = 0
            self.runLinkedSyncSessions = []
            self.runLinkedSyncOutcomes = runLinkedSyncOutcomes
            self.isRunLinkedSyncBlocked = isRunLinkedSyncBlocked
        }

        func fetchCloudAccount(apiBaseUrl: String, bearerToken: String) async throws -> CloudAccountSnapshot {
            throw LocalStoreError.validation("Unexpected fetchCloudAccount call in FlashcardsStoreTests")
        }

        func createWorkspace(apiBaseUrl: String, bearerToken: String, name: String) async throws -> CloudWorkspaceSummary {
            throw LocalStoreError.validation("Unexpected createWorkspace call in FlashcardsStoreTests")
        }

        func selectWorkspace(
            apiBaseUrl: String,
            bearerToken: String,
            workspaceId: String
        ) async throws -> CloudWorkspaceSummary {
            throw LocalStoreError.validation("Unexpected selectWorkspace call in FlashcardsStoreTests")
        }

        func listAgentApiKeys(apiBaseUrl: String, bearerToken: String) async throws -> ([AgentApiKeyConnection], String) {
            throw LocalStoreError.validation("Unexpected listAgentApiKeys call in FlashcardsStoreTests")
        }

        func revokeAgentApiKey(
            apiBaseUrl: String,
            bearerToken: String,
            connectionId: String
        ) async throws -> (AgentApiKeyConnection, String) {
            throw LocalStoreError.validation("Unexpected revokeAgentApiKey call in FlashcardsStoreTests")
        }

        func deleteAccount(apiBaseUrl: String, bearerToken: String, confirmationText: String) async throws {
            throw LocalStoreError.validation("Unexpected deleteAccount call in FlashcardsStoreTests")
        }

        func runLinkedSync(linkedSession: CloudLinkedSession) async throws {
            self.runLinkedSyncCallCount += 1
            self.runLinkedSyncSessions.append(linkedSession)

            if self.isRunLinkedSyncBlocked {
                await withCheckedContinuation { continuation in
                    self.runLinkedSyncContinuation = continuation
                }
                try Task.checkCancellation()
            }

            guard self.runLinkedSyncOutcomes.isEmpty == false else {
                return
            }

            let nextOutcome = self.runLinkedSyncOutcomes.removeFirst()
            switch nextOutcome {
            case .succeed:
                return
            case .fail(let message):
                throw LocalStoreError.validation(message)
            }
        }

        func resumeRunLinkedSync() {
            self.isRunLinkedSyncBlocked = false
            self.runLinkedSyncContinuation?.resume()
            self.runLinkedSyncContinuation = nil
        }
    }

    static func makeStore(testCase: XCTestCase) throws -> FlashcardsStore {
        try self.makeStoreContext(testCase: testCase).store
    }

    static func makeStore(environment: StoreEnvironment) -> FlashcardsStore {
        FlashcardsStore(
            userDefaults: environment.userDefaults,
            encoder: JSONEncoder(),
            decoder: JSONDecoder(),
            database: environment.database,
            cloudAuthService: CloudAuthService(),
            credentialStore: environment.credentialStore,
            reviewSubmissionExecutor: ReviewSubmissionExecutor(databaseURL: environment.database.databaseURL),
            reviewHeadLoader: self.makeDelayedReviewHeadLoader(delayNanoseconds: 0),
            reviewCountsLoader: self.makeDelayedReviewCountsLoader(delayNanoseconds: 0),
            reviewQueueChunkLoader: self.makeDelayedReviewQueueChunkLoader(delayNanoseconds: 0),
            reviewTimelinePageLoader: self.makeReviewTimelinePageLoader(),
            initialGlobalErrorMessage: ""
        )
    }

    static func makeStore(
        environment: StoreEnvironment,
        reviewHeadDelayNanoseconds: UInt64,
        reviewCountsDelayNanoseconds: UInt64
    ) -> FlashcardsStore {
        FlashcardsStore(
            userDefaults: environment.userDefaults,
            encoder: JSONEncoder(),
            decoder: JSONDecoder(),
            database: environment.database,
            cloudAuthService: CloudAuthService(),
            credentialStore: environment.credentialStore,
            reviewSubmissionExecutor: ReviewSubmissionExecutor(databaseURL: environment.database.databaseURL),
            reviewHeadLoader: self.makeDelayedReviewHeadLoader(delayNanoseconds: reviewHeadDelayNanoseconds),
            reviewCountsLoader: self.makeDelayedReviewCountsLoader(delayNanoseconds: reviewCountsDelayNanoseconds),
            reviewQueueChunkLoader: self.makeDelayedReviewQueueChunkLoader(delayNanoseconds: 0),
            reviewTimelinePageLoader: self.makeReviewTimelinePageLoader(),
            initialGlobalErrorMessage: ""
        )
    }

    static func makeStoreContext(testCase: XCTestCase) throws -> StoreContext {
        let environment = try self.makeStoreEnvironment(testCase: testCase)

        return StoreContext(
            store: self.makeStore(environment: environment),
            database: environment.database
        )
    }

    static func makeStoreContext(
        testCase: XCTestCase,
        reviewHeadDelayNanoseconds: UInt64,
        reviewCountsDelayNanoseconds: UInt64
    ) throws -> StoreContext {
        let environment = try self.makeStoreEnvironment(testCase: testCase)

        return StoreContext(
            store: self.makeStore(
                environment: environment,
                reviewHeadDelayNanoseconds: reviewHeadDelayNanoseconds,
                reviewCountsDelayNanoseconds: reviewCountsDelayNanoseconds
            ),
            database: environment.database
        )
    }

    static func makeStoreContext(
        testCase: XCTestCase,
        makeReviewSubmissionExecutor: (LocalDatabase) -> ReviewSubmissionExecuting
    ) throws -> StoreContext {
        let environment = try self.makeStoreEnvironment(testCase: testCase)
        let reviewSubmissionExecutor = makeReviewSubmissionExecutor(environment.database)

        return StoreContext(
            store: FlashcardsStore(
                userDefaults: environment.userDefaults,
                encoder: JSONEncoder(),
                decoder: JSONDecoder(),
                database: environment.database,
                cloudAuthService: CloudAuthService(),
                credentialStore: environment.credentialStore,
                reviewSubmissionExecutor: reviewSubmissionExecutor,
                reviewHeadLoader: self.makeDelayedReviewHeadLoader(delayNanoseconds: 0),
                reviewCountsLoader: self.makeDelayedReviewCountsLoader(delayNanoseconds: 0),
                reviewQueueChunkLoader: self.makeDelayedReviewQueueChunkLoader(delayNanoseconds: 0),
                reviewTimelinePageLoader: self.makeReviewTimelinePageLoader(),
                initialGlobalErrorMessage: ""
            ),
            database: environment.database
        )
    }

    static func makeStoreContext(
        testCase: XCTestCase,
        makeReviewSubmissionExecutor: (LocalDatabase) -> ReviewSubmissionExecuting,
        reviewHeadDelayNanoseconds: UInt64,
        reviewCountsDelayNanoseconds: UInt64
    ) throws -> StoreContext {
        let environment = try self.makeStoreEnvironment(testCase: testCase)
        let reviewSubmissionExecutor = makeReviewSubmissionExecutor(environment.database)

        return StoreContext(
            store: FlashcardsStore(
                userDefaults: environment.userDefaults,
                encoder: JSONEncoder(),
                decoder: JSONDecoder(),
                database: environment.database,
                cloudAuthService: CloudAuthService(),
                credentialStore: environment.credentialStore,
                reviewSubmissionExecutor: reviewSubmissionExecutor,
                reviewHeadLoader: self.makeDelayedReviewHeadLoader(delayNanoseconds: reviewHeadDelayNanoseconds),
                reviewCountsLoader: self.makeDelayedReviewCountsLoader(delayNanoseconds: reviewCountsDelayNanoseconds),
                reviewQueueChunkLoader: self.makeDelayedReviewQueueChunkLoader(delayNanoseconds: 0),
                reviewTimelinePageLoader: self.makeReviewTimelinePageLoader(),
                initialGlobalErrorMessage: ""
            ),
            database: environment.database
        )
    }

    static func makeStoreEnvironment(testCase: XCTestCase) throws -> StoreEnvironment {
        let databaseDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: databaseDirectory, withIntermediateDirectories: true)
        testCase.addTeardownBlock {
            try? FileManager.default.removeItem(at: databaseDirectory)
        }

        let suiteName = "flashcards-store-tests-\(UUID().uuidString)"
        let userDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        userDefaults.removePersistentDomain(forName: suiteName)
        testCase.addTeardownBlock {
            userDefaults.removePersistentDomain(forName: suiteName)
        }

        return StoreEnvironment(
            database: try LocalDatabase(
                databaseURL: databaseDirectory.appendingPathComponent("flashcards.sqlite", isDirectory: false)
            ),
            userDefaults: userDefaults,
            credentialStore: CloudCredentialStore(
                encoder: JSONEncoder(),
                decoder: JSONDecoder(),
                service: "tests-\(UUID().uuidString)",
                account: "primary"
            )
        )
    }

    static func makeStoreWithMockCloudSyncService(
        testCase: XCTestCase,
        runLinkedSyncOutcomes: [MockCloudSyncRunOutcome],
        isRunLinkedSyncBlocked: Bool
    ) throws -> CloudSyncContext {
        let environment = try self.makeStoreEnvironment(testCase: testCase)
        let store = self.makeStore(environment: environment)
        let cloudSyncService = MockCloudSyncService(
            runLinkedSyncOutcomes: runLinkedSyncOutcomes,
            isRunLinkedSyncBlocked: isRunLinkedSyncBlocked
        )

        store.cloudRuntime = CloudSessionRuntime(
            cloudAuthService: CloudAuthService(),
            cloudSyncService: cloudSyncService,
            credentialStore: environment.credentialStore
        )

        return CloudSyncContext(
            store: store,
            database: environment.database,
            credentialStore: environment.credentialStore,
            cloudSyncService: cloudSyncService
        )
    }

    static func makeStoredCloudCredentials() -> StoredCloudCredentials {
        StoredCloudCredentials(
            refreshToken: "refresh-token",
            idToken: "id-token",
            idTokenExpiresAt: "2030-01-01T00:00:00.000Z"
        )
    }

    static func makeLinkedSession(workspaceId: String) -> CloudLinkedSession {
        CloudLinkedSession(
            userId: "user-1",
            workspaceId: workspaceId,
            email: "user@example.com",
            apiBaseUrl: "https://api.example.com/v1",
            bearerToken: "id-token"
        )
    }

    static func linkDatabaseWorkspace(database: LocalDatabase, workspaceId: String) throws {
        try database.updateCloudSettings(
            cloudState: .linked,
            linkedUserId: "user-1",
            linkedWorkspaceId: workspaceId,
            linkedEmail: "user@example.com"
        )
    }

    static func makeCardInput(frontText: String, backText: String, tags: [String]) -> CardEditorInput {
        CardEditorInput(
            frontText: frontText,
            backText: backText,
            tags: tags,
            effortLevel: .medium
        )
    }

    static func makeDeckInput(name: String, tags: [String]) -> DeckEditorInput {
        DeckEditorInput(
            name: name,
            filterDefinition: buildDeckFilterDefinition(
                effortLevels: [],
                tags: tags
            )
        )
    }

    static func makeRemoteDueCard(workspaceId: String, cardId: String) -> Card {
        let now = currentIsoTimestamp()

        return Card(
            cardId: cardId,
            workspaceId: workspaceId,
            frontText: "Remote front",
            backText: "Remote back",
            tags: [],
            effortLevel: .medium,
            dueAt: nil,
            reps: 0,
            lapses: 0,
            fsrsCardState: .new,
            fsrsStepIndex: nil,
            fsrsStability: nil,
            fsrsDifficulty: nil,
            fsrsLastReviewedAt: nil,
            fsrsScheduledDays: nil,
            clientUpdatedAt: now,
            lastModifiedByDeviceId: "remote-device",
            lastOperationId: "remote-operation",
            updatedAt: now,
            deletedAt: nil
        )
    }

    static func waitUntil(
        timeoutNanoseconds: UInt64,
        pollNanoseconds: UInt64,
        condition: () -> Bool
    ) async {
        let deadline = DispatchTime.now().uptimeNanoseconds + timeoutNanoseconds
        while DispatchTime.now().uptimeNanoseconds < deadline {
            if condition() {
                return
            }

            do {
                try await Task.sleep(nanoseconds: pollNanoseconds)
            } catch {
                XCTFail("waitUntil was unexpectedly cancelled: \(error)")
                return
            }
        }

        XCTFail("Timed out waiting for condition")
    }

    private static func makeDelayedReviewHeadLoader(delayNanoseconds: UInt64) -> ReviewHeadLoader {
        return { reviewFilter, decks, cards, now, seedQueueSize in
            if delayNanoseconds > 0 {
                try await Task.sleep(nanoseconds: delayNanoseconds)
            }

            try Task.checkCancellation()
            return makeReviewHeadLoadState(
                reviewFilter: reviewFilter,
                decks: decks,
                cards: cards,
                now: now,
                seedQueueSize: seedQueueSize
            )
        }
    }

    private static func makeDelayedReviewCountsLoader(delayNanoseconds: UInt64) -> ReviewCountsLoader {
        return { databaseURL, workspaceId, reviewQueryDefinition, now in
            if delayNanoseconds > 0 {
                try await Task.sleep(nanoseconds: delayNanoseconds)
            }

            try Task.checkCancellation()
            let database = try LocalDatabase(databaseURL: databaseURL)
            return try database.loadReviewCounts(
                workspaceId: workspaceId,
                reviewQueryDefinition: reviewQueryDefinition,
                now: now
            )
        }
    }

    private static func makeDelayedReviewQueueChunkLoader(delayNanoseconds: UInt64) -> ReviewQueueChunkLoader {
        return { reviewFilter, decks, cards, excludedCardIds, now, chunkSize in
            if delayNanoseconds > 0 {
                try await Task.sleep(nanoseconds: delayNanoseconds)
            }

            try Task.checkCancellation()
            return makeReviewQueueChunkLoadState(
                reviewFilter: reviewFilter,
                decks: decks,
                cards: cards,
                now: now,
                limit: chunkSize,
                excludedCardIds: excludedCardIds
            )
        }
    }

    private static func makeReviewTimelinePageLoader() -> ReviewTimelinePageLoader {
        return { databaseURL, workspaceId, reviewQueryDefinition, now, limit, offset in
            let database = try LocalDatabase(databaseURL: databaseURL)
            return try database.loadReviewTimelinePage(
                workspaceId: workspaceId,
                reviewQueryDefinition: reviewQueryDefinition,
                now: now,
                limit: limit,
                offset: offset
            )
        }
    }
}
