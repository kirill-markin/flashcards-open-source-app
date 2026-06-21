import Foundation
import XCTest
@testable import Flashcards

class CloudCredentialRecoveryTestCase: LocalWorkspaceSyncTestCase {
    func saveRecoveryTestCard(database: LocalDatabase, workspaceId: String) throws -> Card {
        try database.saveCard(
            workspaceId: workspaceId,
            input: CardEditorInput(
                frontText: "Question",
                backText: "Answer",
                tags: ["recovery"],
            ),
            cardId: nil
        )
    }

    func guestSessionFixture(
        token: String,
        userId: String,
        workspaceId: String,
        configuration: CloudServiceConfiguration
    ) -> StoredGuestCloudSession {
        StoredGuestCloudSession(
            guestToken: token,
            userId: userId,
            workspaceId: workspaceId,
            configurationMode: configuration.mode,
            apiBaseUrl: configuration.apiBaseUrl
        )
    }

    func makeCredentialStore(
        suiteName: String,
        encoder: JSONEncoder,
        decoder: JSONDecoder
    ) -> CloudCredentialStore {
        CloudCredentialStore(
            encoder: encoder,
            decoder: decoder,
            service: "tests-\(suiteName)-cloud-auth",
            account: "primary"
        )
    }

    func makeGuestCredentialStore(
        suiteName: String,
        userDefaults: UserDefaults,
        encoder: JSONEncoder,
        decoder: JSONDecoder
    ) -> GuestCloudCredentialStore {
        GuestCloudCredentialStore(
            encoder: encoder,
            decoder: decoder,
            service: "tests-\(suiteName)-guest-auth",
            account: "primary",
            bundle: .main,
            userDefaults: userDefaults
        )
    }

    @MainActor
    func makeRecoveryStore(
        userDefaults: UserDefaults,
        encoder: JSONEncoder,
        decoder: JSONDecoder,
        database: LocalDatabase,
        credentialStore: CloudCredentialStore,
        guestCredentialStore: GuestCloudCredentialStore,
        guestCloudAuthService: GuestCloudAuthService,
        cloudSyncService: GuestUpgradeDrainCloudSyncService
    ) -> FlashcardsStore {
        FlashcardsStore(
            userDefaults: userDefaults,
            encoder: encoder,
            decoder: decoder,
            database: database,
            cloudAuthService: CloudAuthService(),
            cloudSyncService: cloudSyncService,
            credentialStore: credentialStore,
            guestCloudAuthService: guestCloudAuthService,
            guestCredentialStore: guestCredentialStore,
            reviewSubmissionOutboxMutationGate: ReviewSubmissionOutboxMutationGate(),
            reviewSubmissionExecutor: nil,
            reviewHeadLoader: defaultReviewHeadLoader,
            reviewCountsLoader: defaultReviewCountsLoader,
            reviewQueueChunkLoader: defaultReviewQueueChunkLoader,
            reviewQueueWindowLoader: defaultReviewQueueWindowLoader,
            reviewTimelinePageLoader: defaultReviewTimelinePageLoader,
            initialGlobalErrorMessage: ""
        )
    }

    func makeRecoverySyncTrigger() -> CloudSyncTrigger {
        CloudSyncTrigger(
            source: .manualSyncNow,
            now: Date(timeIntervalSince1970: 1_775_000_000),
            extendsFastPolling: false,
            allowsVisibleChangeBanner: false,
            surfacesGlobalErrorMessage: false,
            capturesTechnicalFailures: false
        )
    }

    func loadPersistedRecoveryState(
        userDefaults: UserDefaults,
        decoder: JSONDecoder
    ) throws -> CloudCredentialRecoveryState {
        let data: Data = try XCTUnwrap(userDefaults.data(forKey: cloudCredentialRecoveryStateUserDefaultsKey))
        return try decoder.decode(CloudCredentialRecoveryState.self, from: data)
    }
}

private struct RecoveryPayloadKeyCollector: Decodable {
    let keys: Set<String>

    init(from decoder: Decoder) throws {
        let container: KeyedDecodingContainer<RecoveryPayloadCodingKey> = try decoder.container(
            keyedBy: RecoveryPayloadCodingKey.self
        )
        self.keys = Set(container.allKeys.map(\.stringValue))
    }
}

private struct RecoveryPayloadCodingKey: CodingKey {
    let stringValue: String
    let intValue: Int?

    init(stringValue: String) {
        self.stringValue = stringValue
        self.intValue = nil
    }

    init(intValue: Int) {
        self.stringValue = String(intValue)
        self.intValue = intValue
    }
}

func XCTAssertBlockedSyncStatus(
    _ syncStatus: SyncStatus,
    expectedReason: CloudCredentialRecoveryReason,
    file: StaticString,
    line: UInt
) {
    guard case .blocked(let message) = syncStatus else {
        XCTFail("Expected blocked sync status.", file: file, line: line)
        return
    }

    XCTAssertEqual(
        localizedCloudCredentialRecoveryBlockedMessage(reason: expectedReason),
        message,
        file: file,
        line: line
    )
}

func XCTAssertRecoveryPayloadHasNoSecrets(
    userDefaults: UserDefaults,
    file: StaticString,
    line: UInt
) {
    guard let data: Data = userDefaults.data(forKey: cloudCredentialRecoveryStateUserDefaultsKey) else {
        XCTFail("Expected persisted recovery payload.", file: file, line: line)
        return
    }

    let allowedKeys: Set<String> = [
        "activeWorkspaceId",
        "apiBaseUrl",
        "configurationMode",
        "detectedAt",
        "installationId",
        "linkedEmail",
        "linkedUserId",
        "linkedWorkspaceId",
        "previousCloudState",
        "reason"
    ]

    do {
        let payloadKeys: Set<String> = try JSONDecoder().decode(RecoveryPayloadKeyCollector.self, from: data).keys
        let unexpectedKeys: Set<String> = payloadKeys.subtracting(allowedKeys)
        XCTAssertTrue(
            unexpectedKeys.isEmpty,
            "Recovery payload contains unexpected keys: \(unexpectedKeys.sorted())",
            file: file,
            line: line
        )
    } catch {
        XCTFail("Expected valid recovery payload JSON: \(Flashcards.errorMessage(error: error))", file: file, line: line)
    }
}
