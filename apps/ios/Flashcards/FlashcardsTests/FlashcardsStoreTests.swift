import Foundation
import XCTest
@testable import Flashcards

@MainActor
final class FlashcardsStoreTests: XCTestCase {
    func testSaveCardUpdatesPublishedStateImmediately() throws {
        let store = try self.makeStore()

        try store.saveCard(
            input: self.makeCardInput(frontText: "Front", backText: "Back", tags: ["tag-a"]),
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
        let store = try self.makeStore()
        try store.saveCard(
            input: self.makeCardInput(frontText: "Front", backText: "Back", tags: ["tag-a"]),
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
        let store = try self.makeStore()
        try store.saveCard(
            input: self.makeCardInput(frontText: "Front", backText: "Back", tags: ["tag-a"]),
            editingCardId: nil
        )

        try store.createDeck(
            input: self.makeDeckInput(name: "Tagged", tags: ["tag-a"])
        )

        XCTAssertEqual(store.decks.count, 1)
        XCTAssertEqual(store.deckItems.count, 1)
        XCTAssertEqual(store.deckItems.first?.deck.name, "Tagged")
        XCTAssertEqual(store.deckItems.first?.totalCards, 1)

        let deckId = try XCTUnwrap(store.decks.first?.deckId)
        try store.updateDeck(
            deckId: deckId,
            input: self.makeDeckInput(name: "Renamed", tags: ["tag-a"])
        )

        XCTAssertEqual(store.decks.first?.name, "Renamed")
        XCTAssertEqual(store.deckItems.first?.deck.name, "Renamed")
        XCTAssertEqual(store.deckItems.first?.totalCards, 1)

        try store.deleteDeck(deckId: deckId)

        XCTAssertTrue(store.decks.isEmpty)
        XCTAssertTrue(store.deckItems.isEmpty)
    }

    func testSubmitReviewUpdatesPublishedReviewStateImmediately() throws {
        let store = try self.makeStore()
        try store.saveCard(
            input: self.makeCardInput(frontText: "Front", backText: "Back", tags: ["tag-a"]),
            editingCardId: nil
        )
        let cardId = try XCTUnwrap(store.cards.first?.cardId)

        try store.submitReview(cardId: cardId, rating: .good)

        XCTAssertEqual(store.cards.first?.reps, 1)
        XCTAssertEqual(store.homeSnapshot.reviewedCount, 1)
        XCTAssertEqual(store.homeSnapshot.dueCount, 0)
        XCTAssertTrue(store.reviewQueue.isEmpty)
    }

    func testOpenAICardCreationSelectsAITabAndSetsPresentationRequest() throws {
        let store = try self.makeStore()

        store.openAICardCreation()

        XCTAssertEqual(store.selectedTab, .ai)
        XCTAssertEqual(store.aiChatPresentationRequest, .createCard)
    }

    private func makeStore() throws -> FlashcardsStore {
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

    private func makeCardInput(frontText: String, backText: String, tags: [String]) -> CardEditorInput {
        CardEditorInput(
            frontText: frontText,
            backText: backText,
            tags: tags,
            effortLevel: .medium
        )
    }

    private func makeDeckInput(name: String, tags: [String]) -> DeckEditorInput {
        DeckEditorInput(
            name: name,
            filterDefinition: buildDeckFilterDefinition(
                effortLevels: [],
                tags: tags
            )
        )
    }
}
