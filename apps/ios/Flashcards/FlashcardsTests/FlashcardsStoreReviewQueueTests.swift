import Foundation
import XCTest
@testable import Flashcards

@MainActor
final class FlashcardsStoreReviewQueueTests: XCTestCase {
    func testSelectReviewFilterPublishesHeadBeforeCounts() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreContext(
            testCase: self,
            reviewHeadDelayNanoseconds: 150_000_000,
            reviewCountsDelayNanoseconds: 500_000_000
        )
        let store = context.store

        try store.saveCard(
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Other deck", backText: "Back", tags: ["other"]),
            editingCardId: nil
        )
        try store.saveCard(
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Target first", backText: "Back", tags: ["target"]),
            editingCardId: nil
        )
        try store.saveCard(
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Target second", backText: "Back", tags: ["target"]),
            editingCardId: nil
        )
        try store.createDeck(
            input: FlashcardsStoreTestSupport.makeDeckInput(name: "Target deck", tags: ["target"])
        )
        let targetDeckId = try XCTUnwrap(store.decks.first?.deckId)

        store.selectReviewFilter(reviewFilter: .deck(deckId: targetDeckId))

        XCTAssertEqual(store.selectedReviewFilter, .deck(deckId: targetDeckId))
        XCTAssertTrue(store.isReviewHeadLoading)
        XCTAssertTrue(store.isReviewCountsLoading)
        XCTAssertTrue(store.reviewQueue.isEmpty)
        XCTAssertEqual(store.reviewTotalCount, 0)

        await FlashcardsStoreTestSupport.waitUntil(
            timeoutNanoseconds: 2_000_000_000,
            pollNanoseconds: 20_000_000
        ) {
            store.isReviewHeadLoading == false
        }

        XCTAssertEqual(store.reviewQueue.map(\.frontText), ["Target first", "Target second"])
        XCTAssertTrue(store.isReviewCountsLoading)
        XCTAssertEqual(store.reviewTotalCount, 0)

        await FlashcardsStoreTestSupport.waitUntil(
            timeoutNanoseconds: 2_000_000_000,
            pollNanoseconds: 20_000_000
        ) {
            store.isReviewCountsLoading == false
        }

        XCTAssertEqual(store.displayedReviewDueCount, 2)
        XCTAssertEqual(store.reviewTotalCount, 2)
    }

    func testSelectReviewFilterDiscardsStaleAsyncResults() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreContext(
            testCase: self,
            reviewHeadDelayNanoseconds: 200_000_000,
            reviewCountsDelayNanoseconds: 400_000_000
        )
        let store = context.store

        try store.saveCard(
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Alpha", backText: "Back", tags: ["alpha"]),
            editingCardId: nil
        )
        try store.saveCard(
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Beta", backText: "Back", tags: ["beta"]),
            editingCardId: nil
        )
        try store.createDeck(
            input: FlashcardsStoreTestSupport.makeDeckInput(name: "Alpha deck", tags: ["alpha"])
        )
        try store.createDeck(
            input: FlashcardsStoreTestSupport.makeDeckInput(name: "Beta deck", tags: ["beta"])
        )

        let alphaDeckId = try XCTUnwrap(store.decks.first(where: { deck in
            deck.name == "Alpha deck"
        })?.deckId)
        let betaDeckId = try XCTUnwrap(store.decks.first(where: { deck in
            deck.name == "Beta deck"
        })?.deckId)

        store.selectReviewFilter(reviewFilter: .deck(deckId: alphaDeckId))
        store.selectReviewFilter(reviewFilter: .deck(deckId: betaDeckId))

        await FlashcardsStoreTestSupport.waitUntil(
            timeoutNanoseconds: 2_000_000_000,
            pollNanoseconds: 20_000_000
        ) {
            store.isReviewCountsLoading == false
        }

        XCTAssertEqual(store.selectedReviewFilter, .deck(deckId: betaDeckId))
        XCTAssertEqual(store.reviewQueue.map(\.frontText), ["Beta"])
        XCTAssertEqual(store.displayedReviewDueCount, 1)
        XCTAssertEqual(store.reviewTotalCount, 1)
    }

    func testSeedQueueAdvancesImmediatelyWhileCountsStillLoad() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreContext(
            testCase: self,
            makeReviewSubmissionExecutor: { database in
                FlashcardsStoreTestSupport.ScriptedReviewSubmissionExecutor(
                    databaseURL: database.databaseURL,
                    outcomes: [.submitToDatabase],
                    delayNanoseconds: 600_000_000
                )
            },
            reviewHeadDelayNanoseconds: 50_000_000,
            reviewCountsDelayNanoseconds: 500_000_000
        )
        let store = context.store

        try store.saveCard(
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "First target", backText: "Back", tags: ["target"]),
            editingCardId: nil
        )
        try store.saveCard(
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Second target", backText: "Back", tags: ["target"]),
            editingCardId: nil
        )
        try store.saveCard(
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Third target", backText: "Back", tags: ["target"]),
            editingCardId: nil
        )
        try store.createDeck(
            input: FlashcardsStoreTestSupport.makeDeckInput(name: "Target deck", tags: ["target"])
        )
        let targetDeckId = try XCTUnwrap(store.decks.first?.deckId)

        store.selectReviewFilter(reviewFilter: .deck(deckId: targetDeckId))

        await FlashcardsStoreTestSupport.waitUntil(
            timeoutNanoseconds: 2_000_000_000,
            pollNanoseconds: 20_000_000
        ) {
            store.isReviewHeadLoading == false
        }

        XCTAssertTrue(store.isReviewCountsLoading)
        let firstCard = try XCTUnwrap(store.effectiveReviewQueue.first)
        let secondCard = try XCTUnwrap(store.effectiveReviewQueue.dropFirst().first)

        try store.enqueueReviewSubmission(cardId: firstCard.cardId, rating: .good)

        XCTAssertTrue(store.isReviewCountsLoading)
        XCTAssertEqual(store.effectiveReviewQueue.first?.cardId, secondCard.cardId)

        await FlashcardsStoreTestSupport.waitUntil(
            timeoutNanoseconds: 3_000_000_000,
            pollNanoseconds: 20_000_000
        ) {
            store.pendingReviewCardIds.isEmpty
        }

        XCTAssertNil(store.reviewSubmissionFailure)
    }

    func testReviewQueueReplenishesWhenVisibleQueueDropsToThreshold() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreContext(
            testCase: self,
            makeReviewSubmissionExecutor: { database in
                FlashcardsStoreTestSupport.ScriptedReviewSubmissionExecutor(
                    databaseURL: database.databaseURL,
                    outcomes: Array(repeating: .submitToDatabase, count: 4),
                    delayNanoseconds: 600_000_000
                )
            },
            reviewHeadDelayNanoseconds: 0,
            reviewCountsDelayNanoseconds: 0
        )
        let store = context.store

        for index in 1...10 {
            try store.saveCard(
                input: FlashcardsStoreTestSupport.makeCardInput(
                    frontText: "Card \(index)",
                    backText: "Back \(index)",
                    tags: ["target"]
                ),
                editingCardId: nil
            )
        }
        try store.createDeck(
            input: FlashcardsStoreTestSupport.makeDeckInput(name: "Target deck", tags: ["target"])
        )
        let targetDeckId = try XCTUnwrap(store.decks.first?.deckId)

        store.selectReviewFilter(reviewFilter: .deck(deckId: targetDeckId))

        await FlashcardsStoreTestSupport.waitUntil(
            timeoutNanoseconds: 2_000_000_000,
            pollNanoseconds: 20_000_000
        ) {
            store.isReviewHeadLoading == false
        }

        XCTAssertEqual(store.reviewQueue.count, 8)

        let cardsToSubmit = Array(store.effectiveReviewQueue.prefix(4))
        for card in cardsToSubmit {
            try store.enqueueReviewSubmission(cardId: card.cardId, rating: .good)
        }

        await FlashcardsStoreTestSupport.waitUntil(
            timeoutNanoseconds: 2_000_000_000,
            pollNanoseconds: 20_000_000
        ) {
            store.isReviewQueueChunkLoading == false && store.effectiveReviewQueue.count == 6
        }

        XCTAssertEqual(store.reviewQueue.count, 10)
    }

    func testEnqueueReviewSubmissionOptimisticallyRemovesCurrentCard() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreContext(testCase: self) { database in
            FlashcardsStoreTestSupport.ScriptedReviewSubmissionExecutor(
                databaseURL: database.databaseURL,
                outcomes: [.submitToDatabase],
                delayNanoseconds: 300_000_000
            )
        }
        let store = context.store

        try store.saveCard(
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "First front", backText: "First back", tags: ["tag-a"]),
            editingCardId: nil
        )
        try store.saveCard(
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Second front", backText: "Second back", tags: ["tag-b"]),
            editingCardId: nil
        )

        let initialQueue = store.effectiveReviewQueue
        let firstCard = try XCTUnwrap(initialQueue.first)
        let secondCard = try XCTUnwrap(initialQueue.dropFirst().first)

        try store.enqueueReviewSubmission(cardId: firstCard.cardId, rating: .good)

        XCTAssertTrue(store.isReviewPending(cardId: firstCard.cardId))
        XCTAssertEqual(store.effectiveReviewQueue.count, 1)
        XCTAssertEqual(store.displayedReviewDueCount, 1)
        XCTAssertEqual(store.effectiveReviewQueue.first?.cardId, secondCard.cardId)

        await FlashcardsStoreTestSupport.waitUntil(
            timeoutNanoseconds: 2_000_000_000,
            pollNanoseconds: 20_000_000
        ) {
            store.isReviewPending(cardId: firstCard.cardId) == false
        }

        XCTAssertNil(store.reviewSubmissionFailure)
        XCTAssertEqual(
            store.cards.first(where: { card in
                card.cardId == firstCard.cardId
            })?.reps,
            1
        )
    }

    func testReviewSubmissionReconcilesInPlaceWithoutLoaderFlashOrRemoteBanner() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreContext(
            testCase: self,
            makeReviewSubmissionExecutor: { database in
                FlashcardsStoreTestSupport.ScriptedReviewSubmissionExecutor(
                    databaseURL: database.databaseURL,
                    outcomes: [.submitToDatabase],
                    delayNanoseconds: 50_000_000
                )
            },
            reviewHeadDelayNanoseconds: 400_000_000,
            reviewCountsDelayNanoseconds: 400_000_000
        )
        let store = context.store

        try store.saveCard(
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "First front", backText: "First back", tags: ["tag-a"]),
            editingCardId: nil
        )
        try store.saveCard(
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Second front", backText: "Second back", tags: ["tag-b"]),
            editingCardId: nil
        )

        await FlashcardsStoreTestSupport.waitUntil(
            timeoutNanoseconds: 3_000_000_000,
            pollNanoseconds: 20_000_000
        ) {
            store.isReviewHeadLoading == false && store.reviewQueue.count == 2
        }

        let initialQueue = store.effectiveReviewQueue
        let firstCard = try XCTUnwrap(initialQueue.first)
        let secondCard = try XCTUnwrap(initialQueue.dropFirst().first)

        try store.enqueueReviewSubmission(cardId: firstCard.cardId, rating: .good)

        XCTAssertFalse(store.isReviewHeadLoading)
        XCTAssertEqual(store.effectiveReviewQueue.first?.cardId, secondCard.cardId)

        await FlashcardsStoreTestSupport.waitUntil(
            timeoutNanoseconds: 3_000_000_000,
            pollNanoseconds: 20_000_000
        ) {
            store.isReviewPending(cardId: firstCard.cardId) == false
        }

        XCTAssertFalse(store.isReviewHeadLoading)
        XCTAssertEqual(store.effectiveReviewQueue.first?.cardId, secondCard.cardId)
        XCTAssertEqual(store.displayedReviewDueCount, 1)
        XCTAssertNil(store.reviewOverlayBanner)
    }

    func testEnqueueReviewSubmissionRejectsDuplicatePendingCard() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreContext(testCase: self) { database in
            FlashcardsStoreTestSupport.ScriptedReviewSubmissionExecutor(
                databaseURL: database.databaseURL,
                outcomes: [.submitToDatabase],
                delayNanoseconds: 300_000_000
            )
        }
        let store = context.store

        try store.saveCard(
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Front", backText: "Back", tags: ["tag-a"]),
            editingCardId: nil
        )
        let cardId = try XCTUnwrap(store.effectiveReviewQueue.first?.cardId)

        try store.enqueueReviewSubmission(cardId: cardId, rating: .good)

        XCTAssertThrowsError(try store.enqueueReviewSubmission(cardId: cardId, rating: .hard)) { error in
            guard case LocalStoreError.validation(let message) = error else {
                return XCTFail("Expected LocalStoreError.validation, got \(error)")
            }
            XCTAssertEqual(message, "Review submission is already pending for this card")
        }

        await FlashcardsStoreTestSupport.waitUntil(
            timeoutNanoseconds: 2_000_000_000,
            pollNanoseconds: 20_000_000
        ) {
            store.isReviewPending(cardId: cardId) == false
        }
    }

    func testEnqueueReviewSubmissionFailureRestoresQueueAndSetsAlert() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreContext(testCase: self) { database in
            FlashcardsStoreTestSupport.ScriptedReviewSubmissionExecutor(
                databaseURL: database.databaseURL,
                outcomes: [.fail(message: "Injected review failure")],
                delayNanoseconds: 10_000_000
            )
        }
        let store = context.store

        try store.saveCard(
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Front", backText: "Back", tags: ["tag-a"]),
            editingCardId: nil
        )
        let cardId = try XCTUnwrap(store.effectiveReviewQueue.first?.cardId)

        try store.enqueueReviewSubmission(cardId: cardId, rating: .good)
        XCTAssertTrue(store.effectiveReviewQueue.isEmpty)

        await FlashcardsStoreTestSupport.waitUntil(
            timeoutNanoseconds: 2_000_000_000,
            pollNanoseconds: 20_000_000
        ) {
            store.reviewSubmissionFailure != nil
        }

        let failure = try XCTUnwrap(store.reviewSubmissionFailure)
        XCTAssertTrue(failure.message.contains("Injected review failure"))
        XCTAssertEqual(store.effectiveReviewQueue.first?.cardId, cardId)
        XCTAssertFalse(store.isReviewPending(cardId: cardId))

        store.dismissReviewSubmissionFailure()
        XCTAssertNil(store.reviewSubmissionFailure)
    }

    func testReviewSubmissionProcessorContinuesAfterFailure() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreContext(testCase: self) { database in
            FlashcardsStoreTestSupport.ScriptedReviewSubmissionExecutor(
                databaseURL: database.databaseURL,
                outcomes: [
                    .fail(message: "First review failed"),
                    .submitToDatabase
                ],
                delayNanoseconds: 10_000_000
            )
        }
        let store = context.store

        try store.saveCard(
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "First front", backText: "First back", tags: ["tag-a"]),
            editingCardId: nil
        )
        try store.saveCard(
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Second front", backText: "Second back", tags: ["tag-b"]),
            editingCardId: nil
        )

        let initialQueue = store.effectiveReviewQueue
        let firstCardId = try XCTUnwrap(initialQueue.first?.cardId)
        let secondCardId = try XCTUnwrap(initialQueue.dropFirst().first?.cardId)

        try store.enqueueReviewSubmission(cardId: firstCardId, rating: .good)
        try store.enqueueReviewSubmission(cardId: secondCardId, rating: .good)

        await FlashcardsStoreTestSupport.waitUntil(
            timeoutNanoseconds: 3_000_000_000,
            pollNanoseconds: 20_000_000
        ) {
            store.pendingReviewCardIds.isEmpty
        }

        let firstCard = try XCTUnwrap(store.cards.first(where: { card in
            card.cardId == firstCardId
        }))
        let secondCard = try XCTUnwrap(store.cards.first(where: { card in
            card.cardId == secondCardId
        }))
        let failure = try XCTUnwrap(store.reviewSubmissionFailure)

        XCTAssertEqual(firstCard.reps, 0)
        XCTAssertEqual(secondCard.reps, 1)
        XCTAssertTrue(failure.message.contains("First review failed"))
    }

    func testApplyExternalSnapshotUpdatesEffectiveQueueDuringPendingReview() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreContext(testCase: self) { database in
            FlashcardsStoreTestSupport.ScriptedReviewSubmissionExecutor(
                databaseURL: database.databaseURL,
                outcomes: [.submitToDatabase],
                delayNanoseconds: 400_000_000
            )
        }
        let store = context.store

        try store.saveCard(
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Local front", backText: "Local back", tags: ["tag-a"]),
            editingCardId: nil
        )
        let pendingCardId = try XCTUnwrap(store.effectiveReviewQueue.first?.cardId)
        try store.enqueueReviewSubmission(cardId: pendingCardId, rating: .good)

        let baseBootstrapSnapshot = try testBootstrapSnapshot(database: context.database)
        let remoteCard = FlashcardsStoreTestSupport.makeRemoteDueCard(
            workspaceId: baseBootstrapSnapshot.workspace.workspaceId,
            cardId: "remote-due-card"
        )
        try context.database.applySyncChange(
            workspaceId: baseBootstrapSnapshot.workspace.workspaceId,
            change: SyncChange(
                changeId: 1,
                entityType: .card,
                entityId: remoteCard.cardId,
                action: .upsert,
                payload: .card(remoteCard)
            )
        )
        store.refreshLocalReadModels(now: Date())

        XCTAssertTrue(store.effectiveReviewQueue.contains(where: { card in
            card.cardId == "remote-due-card"
        }))
        XCTAssertFalse(store.effectiveReviewQueue.contains(where: { card in
            card.cardId == pendingCardId
        }))

        await FlashcardsStoreTestSupport.waitUntil(
            timeoutNanoseconds: 3_000_000_000,
            pollNanoseconds: 20_000_000
        ) {
            store.isReviewPending(cardId: pendingCardId) == false
        }
    }
}
