import Foundation
import XCTest
@testable import Flashcards

final class FlashcardsStorePollingAndNavigationTests: XCTestCase {
    @MainActor
    func testCurrentCloudSyncPollingIntervalReturnsFastForReviewTab() {
        let now = Date(timeIntervalSince1970: 1_773_600_000)

        XCTAssertEqual(
            currentCloudSyncPollingInterval(
                selectedTab: .review,
                fastPollingUntil: nil,
                now: now
            ),
            cloudSyncFastPollingIntervalSeconds
        )
    }

    @MainActor
    func testCurrentCloudSyncPollingIntervalReturnsFastForCardsTab() {
        let now = Date(timeIntervalSince1970: 1_773_600_000)

        XCTAssertEqual(
            currentCloudSyncPollingInterval(
                selectedTab: .cards,
                fastPollingUntil: nil,
                now: now
            ),
            cloudSyncFastPollingIntervalSeconds
        )
    }

    @MainActor
    func testCurrentCloudSyncPollingIntervalReturnsFastForTemporaryFastWindow() {
        let now = Date(timeIntervalSince1970: 1_773_600_000)

        XCTAssertEqual(
            currentCloudSyncPollingInterval(
                selectedTab: .ai,
                fastPollingUntil: now.addingTimeInterval(30),
                now: now
            ),
            cloudSyncFastPollingIntervalSeconds
        )
    }

    @MainActor
    func testCurrentCloudSyncPollingIntervalReturnsDefaultAfterFastWindowExpires() {
        let now = Date(timeIntervalSince1970: 1_773_600_000)

        XCTAssertEqual(
            currentCloudSyncPollingInterval(
                selectedTab: .settings,
                fastPollingUntil: now.addingTimeInterval(-1),
                now: now
            ),
            cloudSyncDefaultPollingIntervalSeconds
        )
    }

    @MainActor
    func testExtendCloudSyncFastPollingUntilDoesNotShortenExistingDeadline() {
        let now = Date(timeIntervalSince1970: 1_773_600_000)
        let currentDeadline = now.addingTimeInterval(300)

        XCTAssertEqual(
            extendCloudSyncFastPollingUntil(
                currentDeadline: currentDeadline,
                now: now,
                duration: cloudSyncFastPollingDurationSeconds
            ),
            currentDeadline
        )
    }

    @MainActor
    func testStoreCurrentCloudSyncPollingIntervalReturnsFastForReviewTab() throws {
        let store = try FlashcardsStoreTestSupport.makeStore(testCase: self)
        store.cloudSyncFastPollingUntil = nil

        XCTAssertEqual(
            store.currentCloudSyncPollingInterval(selectedTab: .review, now: Date()),
            cloudSyncFastPollingIntervalSeconds
        )
    }

    @MainActor
    func testStoreCurrentCloudSyncPollingIntervalReturnsFastForCardsTab() throws {
        let store = try FlashcardsStoreTestSupport.makeStore(testCase: self)
        store.cloudSyncFastPollingUntil = nil

        XCTAssertEqual(
            store.currentCloudSyncPollingInterval(selectedTab: .cards, now: Date()),
            cloudSyncFastPollingIntervalSeconds
        )
    }

    @MainActor
    func testSaveCardExtendsTemporaryFastCloudSyncPolling() throws {
        let store = try FlashcardsStoreTestSupport.makeStore(testCase: self)
        store.cloudSyncFastPollingUntil = nil

        try store.saveCard(
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Front", backText: "Back", tags: ["tag-a"]),
            editingCardId: nil
        )

        let deadline = try XCTUnwrap(store.cloudSyncFastPollingUntil)
        XCTAssertGreaterThan(deadline.timeIntervalSinceNow, 0)
        XCTAssertEqual(
            store.currentCloudSyncPollingInterval(selectedTab: .ai, now: Date()),
            cloudSyncFastPollingIntervalSeconds
        )
    }

    @MainActor
    func testCreateDeckExtendsTemporaryFastCloudSyncPolling() throws {
        let store = try FlashcardsStoreTestSupport.makeStore(testCase: self)
        store.cloudSyncFastPollingUntil = nil

        try store.createDeck(
            input: FlashcardsStoreTestSupport.makeDeckInput(name: "Tagged", tags: ["tag-a"])
        )

        let deadline = try XCTUnwrap(store.cloudSyncFastPollingUntil)
        XCTAssertGreaterThan(deadline.timeIntervalSinceNow, 0)
        XCTAssertEqual(
            store.currentCloudSyncPollingInterval(selectedTab: .ai, now: Date()),
            cloudSyncFastPollingIntervalSeconds
        )
    }

    @MainActor
    func testSubmitReviewExtendsTemporaryFastCloudSyncPolling() throws {
        let store = try FlashcardsStoreTestSupport.makeStore(testCase: self)
        try store.saveCard(
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Front", backText: "Back", tags: ["tag-a"]),
            editingCardId: nil
        )
        let cardId = try XCTUnwrap(store.cards.first?.cardId)
        store.cloudSyncFastPollingUntil = nil

        try store.submitReview(cardId: cardId, rating: .good)

        let deadline = try XCTUnwrap(store.cloudSyncFastPollingUntil)
        XCTAssertGreaterThan(deadline.timeIntervalSinceNow, 0)
        XCTAssertEqual(
            store.currentCloudSyncPollingInterval(selectedTab: .ai, now: Date()),
            cloudSyncFastPollingIntervalSeconds
        )
    }

    @MainActor
    func testAppNavigationModelOpenAICardCreationSelectsAITabAndSetsPresentationRequest() {
        let navigation = AppNavigationModel()

        navigation.openAICardCreation()

        XCTAssertEqual(navigation.selectedTab, .ai)
        XCTAssertEqual(navigation.aiChatPresentationRequest, .createCard)
    }

    @MainActor
    func testAppNavigationModelOpenSettingsBuildsWorkspaceDecksPath() {
        let navigation = AppNavigationModel()

        navigation.openSettings(destination: .workspaceDecks)

        XCTAssertEqual(navigation.selectedTab, .settings)
        XCTAssertEqual(navigation.settingsPath, [.workspace, .workspaceDecks])
    }

    @MainActor
    func testSettingsNavigationDestinationsIncludeAccount() {
        let destinations: [SettingsNavigationDestination] = [
            .currentWorkspace,
            .device,
            .access,
            .workspace,
            .workspaceOverview,
            .workspaceScheduler,
            .workspaceDecks,
            .workspaceTags,
            .account,
            .accountStatus,
            .accountLegalSupport,
            .accountAgentConnections,
            .accountDangerZone,
        ]

        XCTAssertEqual(destinations, [
            .currentWorkspace,
            .device,
            .access,
            .workspace,
            .workspaceOverview,
            .workspaceScheduler,
            .workspaceDecks,
            .workspaceTags,
            .account,
            .accountStatus,
            .accountLegalSupport,
            .accountAgentConnections,
            .accountDangerZone,
        ])
    }

    @MainActor
    func testFlashcardsLegalAndRepositoryUrlsMatchAppReviewSubmissionContract() {
        XCTAssertEqual(flashcardsPrivacyPolicyUrl, "https://flashcards-open-source-app.com/privacy/")
        XCTAssertEqual(flashcardsTermsOfServiceUrl, "https://flashcards-open-source-app.com/terms/")
        XCTAssertEqual(flashcardsSupportUrl, "https://flashcards-open-source-app.com/support/")
        XCTAssertEqual(flashcardsSupportEmailAddress, "kirill+flashcards@kirill-markin.com")
        XCTAssertEqual(
            flashcardsRepositoryUrl,
            "https://github.com/kirill-markin/flashcards-open-source-app"
        )
    }
}
