import Foundation
import XCTest
@testable import Flashcards

@MainActor
final class FlashcardsStorePollingAndNavigationTests: XCTestCase {
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

    func testSelectTabReviewEnablesFastCloudSyncPolling() throws {
        let store = try FlashcardsStoreTestSupport.makeStore(testCase: self)
        store.cloudSyncFastPollingUntil = nil

        store.selectTab(tab: .review)

        XCTAssertEqual(
            store.currentCloudSyncPollingInterval(now: Date()),
            cloudSyncFastPollingIntervalSeconds
        )
    }

    func testSelectTabCardsEnablesFastCloudSyncPolling() throws {
        let store = try FlashcardsStoreTestSupport.makeStore(testCase: self)
        store.cloudSyncFastPollingUntil = nil

        store.selectTab(tab: .cards)

        XCTAssertEqual(
            store.currentCloudSyncPollingInterval(now: Date()),
            cloudSyncFastPollingIntervalSeconds
        )
    }

    func testSaveCardExtendsTemporaryFastCloudSyncPolling() throws {
        let store = try FlashcardsStoreTestSupport.makeStore(testCase: self)
        store.selectTab(tab: .ai)
        store.cloudSyncFastPollingUntil = nil

        try store.saveCard(
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Front", backText: "Back", tags: ["tag-a"]),
            editingCardId: nil
        )

        let deadline = try XCTUnwrap(store.cloudSyncFastPollingUntil)
        XCTAssertGreaterThan(deadline.timeIntervalSinceNow, 0)
        XCTAssertEqual(
            store.currentCloudSyncPollingInterval(now: Date()),
            cloudSyncFastPollingIntervalSeconds
        )
    }

    func testCreateDeckExtendsTemporaryFastCloudSyncPolling() throws {
        let store = try FlashcardsStoreTestSupport.makeStore(testCase: self)
        store.selectTab(tab: .ai)
        store.cloudSyncFastPollingUntil = nil

        try store.createDeck(
            input: FlashcardsStoreTestSupport.makeDeckInput(name: "Tagged", tags: ["tag-a"])
        )

        let deadline = try XCTUnwrap(store.cloudSyncFastPollingUntil)
        XCTAssertGreaterThan(deadline.timeIntervalSinceNow, 0)
        XCTAssertEqual(
            store.currentCloudSyncPollingInterval(now: Date()),
            cloudSyncFastPollingIntervalSeconds
        )
    }

    func testSubmitReviewExtendsTemporaryFastCloudSyncPolling() throws {
        let store = try FlashcardsStoreTestSupport.makeStore(testCase: self)
        try store.saveCard(
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Front", backText: "Back", tags: ["tag-a"]),
            editingCardId: nil
        )
        let cardId = try XCTUnwrap(store.cards.first?.cardId)
        store.selectTab(tab: .ai)
        store.cloudSyncFastPollingUntil = nil

        try store.submitReview(cardId: cardId, rating: .good)

        let deadline = try XCTUnwrap(store.cloudSyncFastPollingUntil)
        XCTAssertGreaterThan(deadline.timeIntervalSinceNow, 0)
        XCTAssertEqual(
            store.currentCloudSyncPollingInterval(now: Date()),
            cloudSyncFastPollingIntervalSeconds
        )
    }

    func testOpenAICardCreationSelectsAITabAndSetsPresentationRequest() throws {
        let store = try FlashcardsStoreTestSupport.makeStore(testCase: self)

        store.openAICardCreation()

        XCTAssertEqual(store.selectedTab, .ai)
        XCTAssertEqual(store.aiChatPresentationRequest, .createCard)
    }

    func testOpenDeckManagementSelectsSettingsTabAndSetsPresentationRequest() throws {
        let store = try FlashcardsStoreTestSupport.makeStore(testCase: self)

        store.openDeckManagement()

        XCTAssertEqual(store.selectedTab, .settings)
        XCTAssertEqual(store.settingsPresentationRequest, .workspaceDecks)
    }

    func testSettingsNavigationDestinationsIncludeAccount() {
        let destinations: [SettingsNavigationDestination] = [
            .access,
            .workspace,
            .workspaceOverview,
            .workspaceScheduler,
            .workspaceDecks,
            .workspaceTags,
            .workspaceDevice,
            .account,
            .accountStatus,
            .accountAgentConnections,
            .accountDangerZone,
        ]

        XCTAssertEqual(destinations, [
            .access,
            .workspace,
            .workspaceOverview,
            .workspaceScheduler,
            .workspaceDecks,
            .workspaceTags,
            .workspaceDevice,
            .account,
            .accountStatus,
            .accountAgentConnections,
            .accountDangerZone,
        ])
    }
}
