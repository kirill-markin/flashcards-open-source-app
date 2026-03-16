import Foundation
import XCTest
@testable import Flashcards

final class LocalDatabaseBootstrapAndCrudTests: XCTestCase {
    func testInitBootstrapsDefaultSnapshot() throws {
        let database = try LocalDatabaseTestSupport.makeDatabase(testCase: self)

        let bootstrapSnapshot = try testBootstrapSnapshot(database: database)

        XCTAssertEqual(bootstrapSnapshot.workspace.name, "Personal")
        XCTAssertEqual(bootstrapSnapshot.userSettings.userId, "local-user")
        XCTAssertEqual(bootstrapSnapshot.schedulerSettings.algorithm, defaultSchedulerSettingsConfig.algorithm)
        XCTAssertEqual(try testActiveCards(database: database), [])
        XCTAssertEqual(try testActiveDecks(database: database), [])
        XCTAssertEqual(bootstrapSnapshot.cloudSettings.cloudState, .disconnected)
    }

    func testCardCreateUpdateDeleteEnqueuesOutboxOperations() throws {
        let database = try LocalDatabaseTestSupport.makeDatabase(testCase: self)
        let workspaceId = try testWorkspaceId(database: database)

        _ = try database.saveCard(
            workspaceId: workspaceId,
            input: LocalDatabaseTestSupport.makeCardInput(frontText: "Front 1", backText: "Back 1"),
            cardId: nil
        )

        var cards = try testActiveCards(database: database)
        XCTAssertEqual(cards.count, 1)
        let cardId = try XCTUnwrap(cards.first?.cardId)

        var outboxEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 50)
        XCTAssertEqual(outboxEntries.count, 1)
        XCTAssertTrue(outboxEntries.contains { entry in
            if case .card(let payload) = entry.operation.payload {
                return payload.cardId == cardId && payload.deletedAt == nil && payload.frontText == "Front 1"
            }

            return false
        })

        _ = try database.saveCard(
            workspaceId: workspaceId,
            input: LocalDatabaseTestSupport.makeCardInput(frontText: "Front 2", backText: "Back 2"),
            cardId: cardId
        )

        cards = try testActiveCards(database: database)
        XCTAssertEqual(cards.first?.frontText, "Front 2")

        outboxEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 50)
        XCTAssertEqual(outboxEntries.count, 2)
        XCTAssertTrue(outboxEntries.contains { entry in
            if case .card(let payload) = entry.operation.payload {
                return payload.cardId == cardId && payload.deletedAt == nil && payload.frontText == "Front 2"
            }

            return false
        })

        _ = try database.deleteCard(workspaceId: workspaceId, cardId: cardId)

        cards = try testActiveCards(database: database)
        XCTAssertEqual(cards.count, 0)

        outboxEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 50)
        XCTAssertEqual(outboxEntries.count, 3)
        XCTAssertTrue(outboxEntries.contains { entry in
            if case .card(let payload) = entry.operation.payload {
                return payload.cardId == cardId && payload.deletedAt != nil
            }

            return false
        })
    }

    func testSaveCardAllowsEmptyBackText() throws {
        let database = try LocalDatabaseTestSupport.makeDatabase(testCase: self)
        let workspaceId = try testWorkspaceId(database: database)

        _ = try database.saveCard(
            workspaceId: workspaceId,
            input: LocalDatabaseTestSupport.makeCardInput(frontText: "Front", backText: "   "),
            cardId: nil
        )

        let card = try testFirstActiveCard(database: database)
        XCTAssertEqual(card.frontText, "Front")
        XCTAssertEqual(card.backText, "")
    }

    func testBulkCardCreateUpdateDeleteEnqueuesOutboxOperations() throws {
        let database = try LocalDatabaseTestSupport.makeDatabase(testCase: self)
        let workspaceId = try testWorkspaceId(database: database)

        let createdCards = try database.createCards(
            workspaceId: workspaceId,
            inputs: [
                LocalDatabaseTestSupport.makeCardInput(frontText: "Front 1", backText: "Back 1"),
                LocalDatabaseTestSupport.makeCardInput(frontText: "Front 2", backText: "Back 2")
            ]
        )

        var cards = try testActiveCards(database: database)
        XCTAssertEqual(createdCards.count, 2)
        XCTAssertEqual(cards.count, 2)

        var outboxEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 50)
        XCTAssertEqual(outboxEntries.count, 2)
        XCTAssertEqual(
            outboxEntries.filter { entry in
                entry.operation.entityType == .card
            }.count,
            2
        )

        let updatedCards = try database.updateCards(
            workspaceId: workspaceId,
            updates: [
                CardUpdateInput(
                    cardId: createdCards[0].cardId,
                    input: CardEditorInput(
                        frontText: "Updated Front 1",
                        backText: createdCards[0].backText,
                        tags: createdCards[0].tags,
                        effortLevel: createdCards[0].effortLevel
                    )
                ),
                CardUpdateInput(
                    cardId: createdCards[1].cardId,
                    input: CardEditorInput(
                        frontText: createdCards[1].frontText,
                        backText: "Updated Back 2",
                        tags: ["tag-b"],
                        effortLevel: .long
                    )
                )
            ]
        )

        cards = try testActiveCards(database: database)
        XCTAssertEqual(updatedCards.count, 2)
        XCTAssertTrue(cards.contains { card in
            card.cardId == createdCards[0].cardId && card.frontText == "Updated Front 1"
        })
        XCTAssertTrue(cards.contains { card in
            card.cardId == createdCards[1].cardId && card.backText == "Updated Back 2" && card.effortLevel == .long
        })

        outboxEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 50)
        XCTAssertEqual(outboxEntries.count, 4)

        let deleteResult = try database.deleteCards(
            workspaceId: workspaceId,
            cardIds: createdCards.map(\.cardId)
        )

        cards = try testActiveCards(database: database)
        XCTAssertEqual(deleteResult.deletedCount, 2)
        XCTAssertEqual(Set(deleteResult.deletedCardIds), Set(createdCards.map(\.cardId)))
        XCTAssertEqual(cards.count, 0)

        outboxEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 50)
        XCTAssertEqual(outboxEntries.count, 6)
        XCTAssertEqual(
            outboxEntries.filter { entry in
                if case .card(let payload) = entry.operation.payload {
                    return payload.deletedAt != nil
                }

                return false
            }.count,
            2
        )
    }

    func testBulkCreateCardsAllowsEmptyBackText() throws {
        let database = try LocalDatabaseTestSupport.makeDatabase(testCase: self)
        let workspaceId = try testWorkspaceId(database: database)

        let createdCards = try database.createCards(
            workspaceId: workspaceId,
            inputs: [
                LocalDatabaseTestSupport.makeCardInput(frontText: "Front 1", backText: ""),
                LocalDatabaseTestSupport.makeCardInput(frontText: "Front 2", backText: "Back 2")
            ]
        )

        XCTAssertEqual(createdCards.count, 2)
        XCTAssertTrue(createdCards.contains { card in
            card.frontText == "Front 1" && card.backText.isEmpty
        })
    }

    func testBulkCreateCardsRollsBackOnInvalidInput() throws {
        let database = try LocalDatabaseTestSupport.makeDatabase(testCase: self)
        let workspaceId = try testWorkspaceId(database: database)

        XCTAssertThrowsError(
            try database.createCards(
                workspaceId: workspaceId,
                inputs: [
                    LocalDatabaseTestSupport.makeCardInput(frontText: "Front 1", backText: "Back 1"),
                    LocalDatabaseTestSupport.makeCardInput(frontText: " ", backText: "Back 2")
                ]
            )
        ) { error in
            XCTAssertEqual(Flashcards.errorMessage(error: error), "Card front text must not be empty")
        }

        XCTAssertEqual(try testActiveCards(database: database).count, 0)
        XCTAssertEqual(try database.loadOutboxEntries(workspaceId: workspaceId, limit: 50).count, 0)
    }

    func testBulkUpdateCardsRollsBackOnMissingCard() throws {
        let database = try LocalDatabaseTestSupport.makeDatabase(testCase: self)
        let workspaceId = try testWorkspaceId(database: database)
        _ = try database.saveCard(
            workspaceId: workspaceId,
            input: LocalDatabaseTestSupport.makeCardInput(frontText: "Front 1", backText: "Back 1"),
            cardId: nil
        )
        let existingCard = try testFirstActiveCard(database: database)

        XCTAssertThrowsError(
            try database.updateCards(
                workspaceId: workspaceId,
                updates: [
                    CardUpdateInput(
                        cardId: existingCard.cardId,
                        input: CardEditorInput(
                            frontText: "Changed Front",
                            backText: existingCard.backText,
                            tags: existingCard.tags,
                            effortLevel: existingCard.effortLevel
                        )
                    ),
                    CardUpdateInput(
                        cardId: "missing-card-id",
                        input: LocalDatabaseTestSupport.makeCardInput(frontText: "Front 2", backText: "Back 2")
                    )
                ]
            )
        ) { error in
            XCTAssertEqual(Flashcards.errorMessage(error: error), "Card not found")
        }

        let cards = try testActiveCards(database: database)
        XCTAssertEqual(cards.count, 1)
        XCTAssertEqual(cards.first?.frontText, "Front 1")
        XCTAssertEqual(try database.loadOutboxEntries(workspaceId: workspaceId, limit: 50).count, 1)
    }

    func testBulkUpdateCardsAllowsClearingBackText() throws {
        let database = try LocalDatabaseTestSupport.makeDatabase(testCase: self)
        let workspaceId = try testWorkspaceId(database: database)
        _ = try database.saveCard(
            workspaceId: workspaceId,
            input: LocalDatabaseTestSupport.makeCardInput(frontText: "Front 1", backText: "Back 1"),
            cardId: nil
        )
        let existingCard = try testFirstActiveCard(database: database)

        let updatedCards = try database.updateCards(
            workspaceId: workspaceId,
            updates: [
                CardUpdateInput(
                    cardId: existingCard.cardId,
                    input: LocalDatabaseTestSupport.makeCardInput(frontText: existingCard.frontText, backText: "  ")
                )
            ]
        )

        XCTAssertEqual(updatedCards.count, 1)
        XCTAssertEqual(updatedCards[0].backText, "")
        XCTAssertEqual(try testActiveCards(database: database).first?.backText, "")
    }

    func testBulkDeleteCardsRollsBackOnMissingCard() throws {
        let database = try LocalDatabaseTestSupport.makeDatabase(testCase: self)
        let workspaceId = try testWorkspaceId(database: database)
        _ = try database.saveCard(
            workspaceId: workspaceId,
            input: LocalDatabaseTestSupport.makeCardInput(frontText: "Front 1", backText: "Back 1"),
            cardId: nil
        )
        let existingCard = try testFirstActiveCard(database: database)

        XCTAssertThrowsError(
            try database.deleteCards(
                workspaceId: workspaceId,
                cardIds: [existingCard.cardId, "missing-card-id"]
            )
        ) { error in
            XCTAssertEqual(Flashcards.errorMessage(error: error), "Card not found")
        }

        let cards = try testActiveCards(database: database)
        XCTAssertEqual(cards.count, 1)
        XCTAssertEqual(cards.first?.cardId, existingCard.cardId)
        XCTAssertEqual(try database.loadOutboxEntries(workspaceId: workspaceId, limit: 50).count, 1)
    }

    func testBulkUpdateCardsRejectsDuplicateCardIds() throws {
        let database = try LocalDatabaseTestSupport.makeDatabase(testCase: self)
        let workspaceId = try testWorkspaceId(database: database)
        _ = try database.saveCard(
            workspaceId: workspaceId,
            input: LocalDatabaseTestSupport.makeCardInput(frontText: "Front 1", backText: "Back 1"),
            cardId: nil
        )
        let existingCard = try testFirstActiveCard(database: database)

        XCTAssertThrowsError(
            try database.updateCards(
                workspaceId: workspaceId,
                updates: [
                    CardUpdateInput(
                        cardId: existingCard.cardId,
                        input: LocalDatabaseTestSupport.makeCardInput(frontText: "Front 2", backText: "Back 2")
                    ),
                    CardUpdateInput(
                        cardId: existingCard.cardId,
                        input: LocalDatabaseTestSupport.makeCardInput(frontText: "Front 3", backText: "Back 3")
                    )
                ]
            )
        ) { error in
            XCTAssertEqual(Flashcards.errorMessage(error: error), "Card batch must not contain duplicate cardId values")
        }

        let cards = try testActiveCards(database: database)
        XCTAssertEqual(cards.count, 1)
        XCTAssertEqual(cards.first?.frontText, "Front 1")
        XCTAssertEqual(try database.loadOutboxEntries(workspaceId: workspaceId, limit: 50).count, 1)
    }

    func testDeckCreateUpdateDeleteEnqueuesOutboxOperations() throws {
        let database = try LocalDatabaseTestSupport.makeDatabase(testCase: self)
        let workspaceId = try testWorkspaceId(database: database)

        _ = try database.createDeck(
            workspaceId: workspaceId,
            input: LocalDatabaseTestSupport.makeDeckInput(name: "Deck 1")
        )

        var decks = try testActiveDecks(database: database)
        XCTAssertEqual(decks.count, 1)
        let deckId = try XCTUnwrap(decks.first?.deckId)

        var outboxEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 50)
        XCTAssertEqual(outboxEntries.count, 1)
        XCTAssertTrue(outboxEntries.contains { entry in
            if case .deck(let payload) = entry.operation.payload {
                return payload.deckId == deckId && payload.deletedAt == nil && payload.name == "Deck 1"
            }

            return false
        })

        _ = try database.updateDeck(
            workspaceId: workspaceId,
            deckId: deckId,
            input: LocalDatabaseTestSupport.makeDeckInput(name: "Deck 2")
        )

        decks = try testActiveDecks(database: database)
        XCTAssertEqual(decks.first?.name, "Deck 2")

        outboxEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 50)
        XCTAssertEqual(outboxEntries.count, 2)
        XCTAssertTrue(outboxEntries.contains { entry in
            if case .deck(let payload) = entry.operation.payload {
                return payload.deckId == deckId && payload.deletedAt == nil && payload.name == "Deck 2"
            }

            return false
        })

        _ = try database.deleteDeck(workspaceId: workspaceId, deckId: deckId)

        decks = try testActiveDecks(database: database)
        XCTAssertEqual(decks.count, 0)

        outboxEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 50)
        XCTAssertEqual(outboxEntries.count, 3)
        XCTAssertTrue(outboxEntries.contains { entry in
            if case .deck(let payload) = entry.operation.payload {
                return payload.deckId == deckId && payload.deletedAt != nil
            }

            return false
        })
    }
}
