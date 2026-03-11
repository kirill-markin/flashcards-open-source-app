import Foundation
import XCTest
@testable import Flashcards

private struct CardsPagePayload: Decodable {
    let cards: [Card]
    let nextCursor: String?
}

private struct DecksPagePayload: Decodable {
    let decks: [Deck]
    let nextCursor: String?
}

@MainActor
final class LocalAIToolExecutorTests: AIChatTestCaseBase {
    func testLocalToolExecutorReadsWorkspaceContextAndCreatesConfirmedCard() async throws {
        let flashcardsStore = try self.makeStore()
        let databaseURL = try XCTUnwrap(flashcardsStore.localDatabaseURL)
        let executor = LocalAIToolExecutor(
            databaseURL: databaseURL,
            encoder: JSONEncoder(),
            decoder: JSONDecoder()
        )

        let workspaceContextResult = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-1",
                name: "get_workspace_context",
                input: "{}"
            ),
            requestId: "request-1"
        )
        let workspaceContext = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: Data(workspaceContextResult.output.utf8)) as? [String: Any]
        )
        let workspace = try XCTUnwrap(workspaceContext["workspace"] as? [String: Any])
        XCTAssertEqual(workspace["name"] as? String, "Personal")

        let createdCardResult = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-2",
                name: "create_cards",
                input: "{\"cards\":[{\"frontText\":\"Front\",\"backText\":\"Back\",\"tags\":[\"tag-a\"],\"effortLevel\":\"medium\"}]}"
            ),
            requestId: "request-1"
        )
        let createdCards = try JSONDecoder().decode([Card].self, from: Data(createdCardResult.output.utf8))
        XCTAssertEqual(createdCards.count, 1)
        XCTAssertEqual(createdCards[0].frontText, "Front")
        let snapshot = try await executor.loadSnapshot()
        XCTAssertEqual(snapshot.cards.count, 1)
    }

    @MainActor
    func testLocalToolExecutorCreatesCardsWithoutConfirmationText() async throws {
        let flashcardsStore = try self.makeStore()
        let databaseURL = try XCTUnwrap(flashcardsStore.localDatabaseURL)
        let executor = LocalAIToolExecutor(
            databaseURL: databaseURL,
            encoder: JSONEncoder(),
            decoder: JSONDecoder()
        )

        let createdCardsResult = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-bulk-create",
                name: "create_cards",
                input: """
                {"cards":[
                    {"frontText":"Front 1","backText":"Back 1","tags":["tag-a"],"effortLevel":"medium"},
                    {"frontText":"Front 2","backText":"Back 2","tags":["tag-b"],"effortLevel":"fast"}
                ]}
                """
            ),
            requestId: "request-1"
        )
        let createdCards = try JSONDecoder().decode([Card].self, from: Data(createdCardsResult.output.utf8))
        XCTAssertEqual(createdCards.count, 2)
        let snapshot = try await executor.loadSnapshot()
        XCTAssertEqual(snapshot.cards.count, 2)
    }

    @MainActor
    func testLocalToolExecutorGetCardsReturnsRequestedOrderAndFailsForMissingCard() async throws {
        let flashcardsStore = try self.makeStore()
        let databaseURL = try XCTUnwrap(flashcardsStore.localDatabaseURL)
        let executor = LocalAIToolExecutor(
            databaseURL: databaseURL,
            encoder: JSONEncoder(),
            decoder: JSONDecoder()
        )

        let createdCardsResult = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-create-for-get",
                name: "create_cards",
                input: """
                {"cards":[
                    {"frontText":"Front 1","backText":"Back 1","tags":["tag-a"],"effortLevel":"medium"},
                    {"frontText":"Front 2","backText":"Back 2","tags":["tag-b"],"effortLevel":"fast"}
                ]}
                """
            ),
            requestId: "request-1"
        )
        let createdCards = try JSONDecoder().decode([Card].self, from: Data(createdCardsResult.output.utf8))

        let fetchedCardsResult = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-get-cards",
                name: "get_cards",
                input: """
                {"cardIds":["\(createdCards[1].cardId)","\(createdCards[0].cardId)"]}
                """
            ),
            requestId: "request-1"
        )
        let fetchedCards = try JSONDecoder().decode([Card].self, from: Data(fetchedCardsResult.output.utf8))
        XCTAssertEqual(fetchedCards.map(\.cardId), [createdCards[1].cardId, createdCards[0].cardId])

        do {
            _ = try await executor.execute(
                toolCallRequest: AIToolCallRequest(
                    toolCallId: "call-get-missing-card",
                    name: "get_cards",
                    input: "{\"cardIds\":[\"missing-card\"]}"
                ),
                requestId: "request-1"
            )
            XCTFail("Expected missing card error")
        } catch let error as LocalStoreError {
            XCTAssertEqual(error.localizedDescription, "Card not found")
        }
    }

    @MainActor
    func testLocalToolExecutorSearchesCardsByEffortLevel() async throws {
        let flashcardsStore = try self.makeStore()
        let databaseURL = try XCTUnwrap(flashcardsStore.localDatabaseURL)
        let executor = LocalAIToolExecutor(
            databaseURL: databaseURL,
            encoder: JSONEncoder(),
            decoder: JSONDecoder()
        )

        let createdCardsResult = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-create-for-search",
                name: "create_cards",
                input: """
                {"cards":[
                    {"frontText":"Front 1","backText":"Back 1","tags":["tag-a"],"effortLevel":"medium"},
                    {"frontText":"Front 2","backText":"Back 2","tags":["tag-b"],"effortLevel":"fast"}
                ]}
                """
            ),
            requestId: "request-1"
        )
        let createdCards = try JSONDecoder().decode([Card].self, from: Data(createdCardsResult.output.utf8))

        let searchedCardsResult = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-search-cards-effort",
                name: "search_cards",
                input: "{\"query\":\"medium\",\"cursor\":null,\"limit\":100,\"filter\":null}"
            ),
            requestId: "request-1"
        )
        let searchedCardsPayload = try JSONDecoder().decode(CardsPagePayload.self, from: Data(searchedCardsResult.output.utf8))
        let searchedCards = searchedCardsPayload.cards

        XCTAssertEqual(searchedCards.map(\.cardId), [createdCards[0].cardId])
        XCTAssertEqual(searchedCards.first?.effortLevel, .medium)
        XCTAssertNil(searchedCardsPayload.nextCursor)

        let searchedAndCardsResult = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-search-cards-and",
                name: "search_cards",
                input: "{\"query\":\"front medium\",\"cursor\":null,\"limit\":100,\"filter\":null}"
            ),
            requestId: "request-1"
        )
        let searchedAndCardsPayload = try JSONDecoder().decode(CardsPagePayload.self, from: Data(searchedAndCardsResult.output.utf8))
        let searchedAndCards = searchedAndCardsPayload.cards
        XCTAssertEqual(searchedAndCards.map(\.cardId), [createdCards[0].cardId])
        XCTAssertNil(searchedAndCardsPayload.nextCursor)
    }

    @MainActor
    func testLocalToolExecutorSearchCardsMergesTokensAfterFifthToken() async throws {
        let flashcardsStore = try self.makeStore()
        let databaseURL = try XCTUnwrap(flashcardsStore.localDatabaseURL)
        let executor = LocalAIToolExecutor(
            databaseURL: databaseURL,
            encoder: JSONEncoder(),
            decoder: JSONDecoder()
        )

        let createdCardsResult = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-create-for-search-tail",
                name: "create_cards",
                input: """
                {"cards":[
                    {"frontText":"alpha beta","backText":"gamma delta epsilon zeta eta","tags":["combo"],"effortLevel":"medium"},
                    {"frontText":"alpha beta","backText":"gamma delta epsilon zeta","tags":["single"],"effortLevel":"fast"}
                ]}
                """
            ),
            requestId: "request-1"
        )
        let createdCards = try JSONDecoder().decode([Card].self, from: Data(createdCardsResult.output.utf8))

        let searchedCardsResult = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-search-cards-tail",
                name: "search_cards",
                input: "{\"query\":\"alpha beta gamma delta epsilon zeta eta\",\"cursor\":null,\"limit\":100,\"filter\":null}"
            ),
            requestId: "request-1"
        )
        let searchedCardsPayload = try JSONDecoder().decode(CardsPagePayload.self, from: Data(searchedCardsResult.output.utf8))
        let searchedCards = searchedCardsPayload.cards
        XCTAssertEqual(searchedCards.map(\.cardId), [createdCards[0].cardId])
        XCTAssertNil(searchedCardsPayload.nextCursor)
    }

    @MainActor
    func testLocalToolExecutorFiltersListedAndSearchedCards() async throws {
        let flashcardsStore = try self.makeStore()
        let databaseURL = try XCTUnwrap(flashcardsStore.localDatabaseURL)
        let executor = LocalAIToolExecutor(
            databaseURL: databaseURL,
            encoder: JSONEncoder(),
            decoder: JSONDecoder()
        )

        let createdCardsResult = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-create-cards-filter",
                name: "create_cards",
                input: """
                {"cards":[
                    {"frontText":"Grammar front","backText":"Back 1","tags":["grammar","verbs"],"effortLevel":"fast"},
                    {"frontText":"Grammar front","backText":"Back 2","tags":["grammar"],"effortLevel":"fast"},
                    {"frontText":"Grammar front","backText":"Back 3","tags":["grammar","verbs"],"effortLevel":"medium"}
                ]}
                """
            ),
            requestId: "request-1"
        )
        let createdCards = try JSONDecoder().decode([Card].self, from: Data(createdCardsResult.output.utf8))

        let listedCardsResult = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-list-cards-filter",
                name: "list_cards",
                input: "{\"cursor\":null,\"limit\":100,\"filter\":{\"tags\":[\" grammar \",\"verbs\"],\"effort\":[\"fast\",\"fast\"]}}"
            ),
            requestId: "request-1"
        )
        let listedCardsPayload = try JSONDecoder().decode(CardsPagePayload.self, from: Data(listedCardsResult.output.utf8))
        XCTAssertEqual(listedCardsPayload.cards.map(\.cardId), [createdCards[0].cardId])
        XCTAssertNil(listedCardsPayload.nextCursor)

        let searchedCardsResult = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-search-cards-filter",
                name: "search_cards",
                input: "{\"query\":\"grammar\",\"cursor\":null,\"limit\":100,\"filter\":{\"tags\":[\"grammar\"],\"effort\":[\"fast\"]}}"
            ),
            requestId: "request-1"
        )
        let searchedCardsPayload = try JSONDecoder().decode(CardsPagePayload.self, from: Data(searchedCardsResult.output.utf8))
        XCTAssertEqual(searchedCardsPayload.cards.map(\.cardId), [createdCards[0].cardId, createdCards[1].cardId])
        XCTAssertNil(searchedCardsPayload.nextCursor)
    }

    @MainActor
    func testLocalToolExecutorWrapsInvalidInputWithDiagnostics() async throws {
        let flashcardsStore = try self.makeStore()
        let databaseURL = try XCTUnwrap(flashcardsStore.localDatabaseURL)
        let executor = LocalAIToolExecutor(
            databaseURL: databaseURL,
            encoder: JSONEncoder(),
            decoder: JSONDecoder()
        )

        do {
            _ = try await executor.execute(
                toolCallRequest: AIToolCallRequest(
                    toolCallId: "call-invalid",
                    name: "list_cards",
                    input: "{\"cursor\":null,\"limit\":5}\n{\"cursor\":null,\"limit\":10}"
                ),
                requestId: "request-123"
            )
            XCTFail("Expected invalid tool input error")
        } catch let error as AIToolExecutionError {
            guard case .invalidToolInput(let requestId, let toolName, let toolCallId, _, let decoderSummary, let rawInputSnippet) = error else {
                return XCTFail("Expected invalidToolInput, received \(error.localizedDescription)")
            }

            XCTAssertEqual(requestId, "request-123")
            XCTAssertEqual(toolName, "list_cards")
            XCTAssertEqual(toolCallId, "call-invalid")
            XCTAssertFalse(decoderSummary.isEmpty)
            XCTAssertEqual(rawInputSnippet, "{\"cursor\":null,\"limit\":5}\n{\"cursor\":null,\"limit\":10}")
        }
    }

    @MainActor
    func testLocalToolExecutorRejectsRemovedTools() async throws {
        let flashcardsStore = try self.makeStore()
        let databaseURL = try XCTUnwrap(flashcardsStore.localDatabaseURL)
        let executor = LocalAIToolExecutor(
            databaseURL: databaseURL,
            encoder: JSONEncoder(),
            decoder: JSONDecoder()
        )

        do {
            _ = try await executor.execute(
                toolCallRequest: AIToolCallRequest(
                    toolCallId: "call-submit-review",
                    name: "submit_review",
                    input: "{\"cardId\":\"card-1\",\"rating\":\"good\"}"
                ),
                requestId: "request-1"
            )
            XCTFail("Expected unsupported submit_review tool error")
        } catch let error as AIToolExecutionError {
            guard case .unsupportedTool(let toolName) = error else {
                return XCTFail("Expected unsupported tool error, received \(error)")
            }

            XCTAssertEqual(toolName, "submit_review")
        }

        do {
            _ = try await executor.execute(
                toolCallRequest: AIToolCallRequest(
                    toolCallId: "call-update-settings",
                    name: "update_scheduler_settings",
                    input: "{\"desiredRetention\":0.9,\"learningStepsMinutes\":[1],\"relearningStepsMinutes\":[10],\"maximumIntervalDays\":365,\"enableFuzz\":true}"
                ),
                requestId: "request-1"
            )
            XCTFail("Expected unsupported update_scheduler_settings tool error")
        } catch let error as AIToolExecutionError {
            guard case .unsupportedTool(let toolName) = error else {
                return XCTFail("Expected unsupported tool error, received \(error)")
            }

            XCTAssertEqual(toolName, "update_scheduler_settings")
        }
    }

    @MainActor
    func testLocalToolExecutorCreatesUpdatesAndDeletesCardsInBulk() async throws {
        let flashcardsStore = try self.makeStore()
        let databaseURL = try XCTUnwrap(flashcardsStore.localDatabaseURL)
        let executor = LocalAIToolExecutor(
            databaseURL: databaseURL,
            encoder: JSONEncoder(),
            decoder: JSONDecoder()
        )

        let createdCardsResult = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-create-cards",
                name: "create_cards",
                input: """
                {"cards":[
                    {"frontText":"Front 1","backText":"Back 1","tags":["tag-a"],"effortLevel":"medium"},
                    {"frontText":"Front 2","backText":"Back 2","tags":["tag-b"],"effortLevel":"fast"}
                ]}
                """
            ),
            requestId: "request-1"
        )
        let createdCards = try JSONDecoder().decode([Card].self, from: Data(createdCardsResult.output.utf8))
        XCTAssertEqual(createdCards.count, 2)
        XCTAssertTrue(createdCardsResult.didMutateAppState)

        let updatedCardsResult = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-update-cards",
                name: "update_cards",
                input: """
                {"updates":[
                    {"cardId":"\(createdCards[0].cardId)","frontText":"Updated Front 1"},
                    {"cardId":"\(createdCards[1].cardId)","tags":["tag-c","tag-d"],"effortLevel":"long"}
                ]}
                """
            ),
            requestId: "request-1"
        )
        let updatedCards = try JSONDecoder().decode([Card].self, from: Data(updatedCardsResult.output.utf8))
        XCTAssertEqual(updatedCards.count, 2)
        XCTAssertEqual(
            Set(updatedCards.map { card in
                card.cardId
            }),
            Set(createdCards.map { card in
                card.cardId
            })
        )
        XCTAssertTrue(updatedCards.contains { card in
            card.cardId == createdCards[0].cardId && card.frontText == "Updated Front 1"
        })
        XCTAssertTrue(updatedCards.contains { card in
            card.cardId == createdCards[1].cardId && card.tags == ["tag-c", "tag-d"] && card.effortLevel == .long
        })

        let deletedCardsResult = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-delete-cards",
                name: "delete_cards",
                input: """
                {"cardIds":["\(createdCards[0].cardId)","\(createdCards[1].cardId)"]}
                """
            ),
            requestId: "request-1"
        )
        let deletedCardsPayload = try JSONDecoder().decode(BulkDeleteCardsPayload.self, from: Data(deletedCardsResult.output.utf8))
        XCTAssertTrue(deletedCardsPayload.ok)
        XCTAssertEqual(deletedCardsPayload.deletedCount, 2)
        XCTAssertEqual(Set(deletedCardsPayload.deletedCardIds), Set(createdCards.map(\.cardId)))
        let snapshot = try await executor.loadSnapshot()
        XCTAssertEqual(snapshot.cards.count, 0)
    }

    @MainActor
    func testLocalToolExecutorListsSearchesAndGetsDecks() async throws {
        let flashcardsStore = try self.makeStore()
        let databaseURL = try XCTUnwrap(flashcardsStore.localDatabaseURL)
        let executor = LocalAIToolExecutor(
            databaseURL: databaseURL,
            encoder: JSONEncoder(),
            decoder: JSONDecoder()
        )

        let createdDecksResult = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-create-decks",
                name: "create_decks",
                input: """
                {"decks":[
                    {"name":"Grammar","effortLevels":["fast"],"tags":["grammar"]},
                    {"name":"Long reading","effortLevels":["long"],"tags":["reading"]}
                ]}
                """
            ),
            requestId: "request-1"
        )
        let createdDecks = try JSONDecoder().decode([Deck].self, from: Data(createdDecksResult.output.utf8))
        XCTAssertEqual(createdDecks.count, 2)

        let listedDecksResult = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-list-decks",
                name: "list_decks",
                input: "{\"cursor\":null,\"limit\":100}"
            ),
            requestId: "request-1"
        )
        let listedDecksPayload = try JSONDecoder().decode(DecksPagePayload.self, from: Data(listedDecksResult.output.utf8))
        let listedDecks = listedDecksPayload.decks
        XCTAssertEqual(Set(listedDecks.map(\.deckId)), Set(createdDecks.map(\.deckId)))
        XCTAssertNil(listedDecksPayload.nextCursor)

        let searchedByTagResult = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-search-decks-tag",
                name: "search_decks",
                input: "{\"query\":\"grammar\",\"cursor\":null,\"limit\":100}"
            ),
            requestId: "request-1"
        )
        let searchedByTagPayload = try JSONDecoder().decode(DecksPagePayload.self, from: Data(searchedByTagResult.output.utf8))
        let searchedByTag = searchedByTagPayload.decks
        XCTAssertEqual(searchedByTag.map(\.deckId), [createdDecks[0].deckId])
        XCTAssertNil(searchedByTagPayload.nextCursor)

        let searchedByEffortResult = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-search-decks-effort",
                name: "search_decks",
                input: "{\"query\":\"long\",\"cursor\":null,\"limit\":100}"
            ),
            requestId: "request-1"
        )
        let searchedByEffortPayload = try JSONDecoder().decode(DecksPagePayload.self, from: Data(searchedByEffortResult.output.utf8))
        let searchedByEffort = searchedByEffortPayload.decks
        XCTAssertEqual(searchedByEffort.map(\.deckId), [createdDecks[1].deckId])
        XCTAssertNil(searchedByEffortPayload.nextCursor)

        let searchedByOrResult = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-search-decks-or",
                name: "search_decks",
                input: "{\"query\":\"missing grammar\",\"cursor\":null,\"limit\":100}"
            ),
            requestId: "request-1"
        )
        let searchedByOrPayload = try JSONDecoder().decode(DecksPagePayload.self, from: Data(searchedByOrResult.output.utf8))
        let searchedByOr = searchedByOrPayload.decks
        XCTAssertEqual(searchedByOr.map(\.deckId), [createdDecks[0].deckId])
        XCTAssertNil(searchedByOrPayload.nextCursor)

        let fetchedDecksResult = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-get-decks",
                name: "get_decks",
                input: """
                {"deckIds":["\(createdDecks[1].deckId)","\(createdDecks[0].deckId)"]}
                """
            ),
            requestId: "request-1"
        )
        let fetchedDecks = try JSONDecoder().decode([Deck].self, from: Data(fetchedDecksResult.output.utf8))
        XCTAssertEqual(fetchedDecks.map(\.deckId), [createdDecks[1].deckId, createdDecks[0].deckId])
    }

    @MainActor
    func testLocalToolExecutorGetDecksFailsForMissingDeck() async throws {
        let flashcardsStore = try self.makeStore()
        let databaseURL = try XCTUnwrap(flashcardsStore.localDatabaseURL)
        let executor = LocalAIToolExecutor(
            databaseURL: databaseURL,
            encoder: JSONEncoder(),
            decoder: JSONDecoder()
        )

        do {
            _ = try await executor.execute(
                toolCallRequest: AIToolCallRequest(
                    toolCallId: "call-get-missing-deck",
                    name: "get_decks",
                    input: "{\"deckIds\":[\"missing-deck\"]}"
                ),
                requestId: "request-1"
            )
            XCTFail("Expected missing deck error")
        } catch let error as LocalStoreError {
            XCTAssertEqual(error.localizedDescription, "Deck not found")
        }
    }

    @MainActor
    func testLocalToolExecutorCreatesUpdatesAndDeletesDecksInBulk() async throws {
        let flashcardsStore = try self.makeStore()
        let databaseURL = try XCTUnwrap(flashcardsStore.localDatabaseURL)
        let executor = LocalAIToolExecutor(
            databaseURL: databaseURL,
            encoder: JSONEncoder(),
            decoder: JSONDecoder()
        )

        let createdDecksResult = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-create-decks",
                name: "create_decks",
                input: """
                {"decks":[
                    {"name":"Grammar","effortLevels":["fast"],"tags":["grammar"]},
                    {"name":"Reading","effortLevels":["medium"],"tags":["reading"]}
                ]}
                """
            ),
            requestId: "request-1"
        )
        let createdDecks = try JSONDecoder().decode([Deck].self, from: Data(createdDecksResult.output.utf8))
        XCTAssertEqual(createdDecks.count, 2)
        XCTAssertTrue(createdDecksResult.didMutateAppState)

        let updatedDecksResult = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-update-decks",
                name: "update_decks",
                input: """
                {"updates":[
                    {"deckId":"\(createdDecks[0].deckId)","name":"Grammar updated","effortLevels":null,"tags":["grammar","verbs"]},
                    {"deckId":"\(createdDecks[1].deckId)","name":null,"effortLevels":["long"],"tags":null}
                ]}
                """
            ),
            requestId: "request-1"
        )
        let updatedDecks = try JSONDecoder().decode([Deck].self, from: Data(updatedDecksResult.output.utf8))
        XCTAssertEqual(updatedDecks.count, 2)
        XCTAssertTrue(updatedDecks.contains { deck in
            deck.deckId == createdDecks[0].deckId
                && deck.name == "Grammar updated"
                && deck.filterDefinition.tags == ["grammar", "verbs"]
        })
        XCTAssertTrue(updatedDecks.contains { deck in
            deck.deckId == createdDecks[1].deckId
                && deck.filterDefinition.effortLevels == [.long]
        })

        let deletedDecksResult = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-delete-decks",
                name: "delete_decks",
                input: """
                {"deckIds":["\(createdDecks[0].deckId)","\(createdDecks[1].deckId)"]}
                """
            ),
            requestId: "request-1"
        )
        let deletedDecksPayload = try JSONDecoder().decode(BulkDeleteDecksPayload.self, from: Data(deletedDecksResult.output.utf8))
        XCTAssertTrue(deletedDecksPayload.ok)
        XCTAssertEqual(deletedDecksPayload.deletedCount, 2)
        XCTAssertEqual(Set(deletedDecksPayload.deletedDeckIds), Set(createdDecks.map(\.deckId)))
        let snapshot = try await executor.loadSnapshot()
        XCTAssertEqual(snapshot.decks.count, 0)
    }

    @MainActor

    func testLocalToolExecutorReadsLatestCommittedStateBetweenCalls() async throws {
        let flashcardsStore = try self.makeStore()
        let databaseURL = try XCTUnwrap(flashcardsStore.localDatabaseURL)
        let executor = LocalAIToolExecutor(
            databaseURL: databaseURL,
            encoder: JSONEncoder(),
            decoder: JSONDecoder()
        )

        let initialListResult = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-list-initial",
                name: "list_cards",
                input: "{\"cursor\":null,\"limit\":100}"
            ),
            requestId: "request-list"
        )
        let initialCards = try JSONDecoder().decode(CardsPagePayload.self, from: Data(initialListResult.output.utf8))
        XCTAssertEqual(initialCards.cards.count, 0)
        XCTAssertNil(initialCards.nextCursor)

        try flashcardsStore.saveCard(
            input: CardEditorInput(
                frontText: "Fresh Front",
                backText: "Fresh Back",
                tags: ["fresh"],
                effortLevel: .medium
            ),
            editingCardId: nil
        )

        let updatedListResult = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-list-updated",
                name: "list_cards",
                input: "{\"cursor\":null,\"limit\":100}"
            ),
            requestId: "request-list"
        )
        let updatedCards = try JSONDecoder().decode(CardsPagePayload.self, from: Data(updatedListResult.output.utf8))
        XCTAssertEqual(updatedCards.cards.count, 1)
        XCTAssertEqual(updatedCards.cards.first?.frontText, "Fresh Front")
        XCTAssertNil(updatedCards.nextCursor)
    }

}
