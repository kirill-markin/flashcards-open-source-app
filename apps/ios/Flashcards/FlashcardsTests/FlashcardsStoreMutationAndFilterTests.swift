import Foundation
import XCTest
@testable import Flashcards

@MainActor
final class FlashcardsStoreMutationAndFilterTests: XCTestCase {
    func testSaveCardUpdatesPublishedStateImmediately() throws {
        let store = try FlashcardsStoreTestSupport.makeStore(testCase: self)

        try store.saveCard(
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Front", backText: "Back", tags: ["tag-a"]),
            editingCardId: nil
        )

        XCTAssertEqual(store.cards.count, 1)
        XCTAssertEqual(store.cards.first?.frontText, "Front")
        XCTAssertEqual(store.cards.first?.backText, "Back")
        XCTAssertEqual(store.homeSnapshot.totalCards, 1)
        XCTAssertEqual(store.homeSnapshot.dueCount, 1)
        XCTAssertEqual(store.reviewQueue.count, 1)
    }

    func testDeleteCardRemovesPublishedStateImmediately() throws {
        let store = try FlashcardsStoreTestSupport.makeStore(testCase: self)
        try store.saveCard(
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Front", backText: "Back", tags: ["tag-a"]),
            editingCardId: nil
        )
        let cardId = try XCTUnwrap(store.cards.first?.cardId)

        try store.deleteCard(cardId: cardId)

        XCTAssertTrue(store.cards.isEmpty)
        XCTAssertTrue(store.reviewQueue.isEmpty)
        XCTAssertEqual(store.homeSnapshot.totalCards, 0)
        XCTAssertEqual(store.homeSnapshot.dueCount, 0)
    }

    func testDeckMutationsUpdatePublishedStateImmediately() throws {
        let store = try FlashcardsStoreTestSupport.makeStore(testCase: self)
        try store.saveCard(
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Front", backText: "Back", tags: ["tag-a"]),
            editingCardId: nil
        )

        try store.createDeck(
            input: FlashcardsStoreTestSupport.makeDeckInput(name: "Tagged", tags: ["tag-a"])
        )

        XCTAssertEqual(store.decks.count, 1)
        XCTAssertEqual(store.deckItems.count, 1)
        XCTAssertEqual(store.deckItems.first?.deck.name, "Tagged")
        XCTAssertEqual(store.deckItems.first?.totalCards, 1)

        let deckId = try XCTUnwrap(store.decks.first?.deckId)
        try store.updateDeck(
            deckId: deckId,
            input: FlashcardsStoreTestSupport.makeDeckInput(name: "Renamed", tags: ["tag-a"])
        )

        XCTAssertEqual(store.decks.first?.name, "Renamed")
        XCTAssertEqual(store.deckItems.first?.deck.name, "Renamed")
        XCTAssertEqual(store.deckItems.first?.totalCards, 1)

        try store.deleteDeck(deckId: deckId)

        XCTAssertTrue(store.decks.isEmpty)
        XCTAssertTrue(store.deckItems.isEmpty)
    }

    func testSubmitReviewUpdatesPublishedReviewStateImmediately() throws {
        let store = try FlashcardsStoreTestSupport.makeStore(testCase: self)
        try store.saveCard(
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Front", backText: "Back", tags: ["tag-a"]),
            editingCardId: nil
        )
        let cardId = try XCTUnwrap(store.cards.first?.cardId)

        try store.submitReview(cardId: cardId, rating: .good)

        XCTAssertEqual(store.cards.first?.reps, 1)
        XCTAssertEqual(store.homeSnapshot.reviewedCount, 1)
        XCTAssertEqual(store.homeSnapshot.dueCount, 0)
        XCTAssertTrue(store.reviewQueue.isEmpty)
    }

    func testReloadLoadsPersistedTagReviewFilterWhenTagExists() throws {
        let environment = try FlashcardsStoreTestSupport.makeStoreEnvironment(testCase: self)
        let workspaceId = try testWorkspaceId(database: environment.database)
        let card = try environment.database.saveCard(
            workspaceId: workspaceId,
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Front", backText: "Back", tags: ["grammar"]),
            cardId: nil
        )
        environment.userDefaults.set(
            Data("{\"kind\":\"tag\",\"tag\":\"grammar\"}".utf8),
            forKey: "selected-review-filter"
        )

        let store = FlashcardsStoreTestSupport.makeStore(environment: environment)

        XCTAssertEqual(store.selectedReviewFilter, .tag(tag: "grammar"))
        XCTAssertEqual(store.reviewQueue.map(\.cardId), [card.cardId])
    }

    func testReloadResetsPersistedTagReviewFilterWhenTagIsMissing() throws {
        let environment = try FlashcardsStoreTestSupport.makeStoreEnvironment(testCase: self)
        environment.userDefaults.set(
            Data("{\"kind\":\"tag\",\"tag\":\"missing-tag\"}".utf8),
            forKey: "selected-review-filter"
        )

        let store = FlashcardsStoreTestSupport.makeStore(environment: environment)

        XCTAssertEqual(store.selectedReviewFilter, .allCards)
    }

    func testSelectReviewFilterExtendsTemporaryFastCloudSyncPolling() throws {
        let store = try FlashcardsStoreTestSupport.makeStore(testCase: self)
        store.selectTab(tab: .ai)
        store.cloudSyncFastPollingUntil = nil

        store.selectReviewFilter(reviewFilter: .allCards)

        let deadline = try XCTUnwrap(store.cloudSyncFastPollingUntil)
        XCTAssertGreaterThan(deadline.timeIntervalSinceNow, 0)
        XCTAssertEqual(
            store.currentCloudSyncPollingInterval(now: Date()),
            cloudSyncFastPollingIntervalSeconds
        )
    }

    func testUpdateSchedulerSettingsExtendsTemporaryFastCloudSyncPolling() throws {
        let store = try FlashcardsStoreTestSupport.makeStore(testCase: self)
        store.selectTab(tab: .settings)
        store.cloudSyncFastPollingUntil = nil

        try store.updateSchedulerSettings(
            desiredRetention: 0.9,
            learningStepsMinutes: [1, 10],
            relearningStepsMinutes: [10],
            maximumIntervalDays: 36500,
            enableFuzz: true
        )

        let deadline = try XCTUnwrap(store.cloudSyncFastPollingUntil)
        XCTAssertGreaterThan(deadline.timeIntervalSinceNow, 0)
        XCTAssertEqual(
            store.currentCloudSyncPollingInterval(now: Date()),
            cloudSyncFastPollingIntervalSeconds
        )
    }
}
