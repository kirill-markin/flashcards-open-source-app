import Foundation
import XCTest
@testable import Flashcards

@MainActor
final class GuestCloudUpgradeIdentityResetTests: XCTestCase {
    func testCloudIdentityResetClearsPendingGuestUpgradeAndUnblocksMutationGates() async throws {
        let suiteName: String = "guest-upgrade-reset-cleanup-\(UUID().uuidString)"
        let userDefaults: UserDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let encoder: JSONEncoder = JSONEncoder()
        let decoder: JSONDecoder = JSONDecoder()
        let databaseURL: URL = FileManager.default.temporaryDirectory
            .appendingPathComponent("guest-upgrade-reset-cleanup-\(UUID().uuidString.lowercased())")
            .appendingPathExtension("sqlite")
        let database: LocalDatabase = try LocalDatabase(databaseURL: databaseURL)
        let credentialStore: CloudCredentialStore = CloudCredentialStore(service: "tests-\(suiteName)-cloud-auth")
        let guestCredentialStore: GuestCloudCredentialStore = GuestCloudCredentialStore(
            service: "tests-\(suiteName)-guest-auth",
            bundle: .main,
            userDefaults: userDefaults
        )
        let reviewSubmissionOutboxMutationGate: ReviewSubmissionOutboxMutationGate = ReviewSubmissionOutboxMutationGate()
        let store: FlashcardsStore = FlashcardsStore(
            userDefaults: userDefaults,
            encoder: encoder,
            decoder: decoder,
            database: database,
            cloudAuthService: CloudAuthService(),
            cloudSyncService: GuestUpgradeDrainCloudSyncService(),
            credentialStore: credentialStore,
            guestCloudAuthService: GuestCloudAuthService(),
            guestCredentialStore: guestCredentialStore,
            reviewSubmissionOutboxMutationGate: reviewSubmissionOutboxMutationGate,
            reviewSubmissionExecutor: nil,
            reviewHeadLoader: defaultReviewHeadLoader,
            reviewCountsLoader: defaultReviewCountsLoader,
            reviewQueueChunkLoader: defaultReviewQueueChunkLoader,
            reviewQueueWindowLoader: defaultReviewQueueWindowLoader,
            reviewTimelinePageLoader: defaultReviewTimelinePageLoader,
            initialGlobalErrorMessage: ""
        )
        defer {
            store.shutdownForTests()
            try? database.close()
            try? FileManager.default.removeItem(at: databaseURL)
            try? credentialStore.clearCredentials()
            try? guestCredentialStore.clearGuestSession()
            userDefaults.removePersistentDomain(forName: suiteName)
        }

        userDefaults.set(Data("pending".utf8), forKey: pendingGuestUpgradeUserDefaultsKey)
        store.isGuestUpgradeLocalOutboxMutationBlocked = true
        await reviewSubmissionOutboxMutationGate.blockNewReviewSubmissionsAndWaitForActiveSubmissions()

        XCTAssertThrowsError(try store.assertLocalOutboxMutationAllowedDuringPendingGuestUpgrade()) { error in
            XCTAssertEqual(
                "Account upgrade is finishing. Wait for the upgrade to complete before making more local changes.",
                Flashcards.errorMessage(error: error)
            )
        }
        XCTAssertThrowsError(try reviewSubmissionOutboxMutationGate.beginReviewSubmission()) { error in
            XCTAssertEqual(
                "Account upgrade is finishing. Wait for the upgrade to complete before making more local changes.",
                Flashcards.errorMessage(error: error)
            )
        }

        try store.resetLocalStateForCloudIdentityChange()

        XCTAssertNil(userDefaults.data(forKey: pendingGuestUpgradeUserDefaultsKey))
        XCTAssertFalse(store.isGuestUpgradeLocalOutboxMutationBlocked)
        XCTAssertNoThrow(try store.assertLocalOutboxMutationAllowedDuringPendingGuestUpgrade())
        do {
            try reviewSubmissionOutboxMutationGate.beginReviewSubmission()
            reviewSubmissionOutboxMutationGate.finishReviewSubmission()
        } catch {
            XCTFail("Review submission gate should be unblocked after identity reset: \(Flashcards.errorMessage(error: error))")
        }
    }
}
