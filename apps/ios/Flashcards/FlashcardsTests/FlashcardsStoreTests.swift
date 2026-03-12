import Foundation
import XCTest
@testable import Flashcards

private enum ScriptedReviewSubmissionOutcome: Sendable {
    case submitToDatabase
    case fail(message: String)
}

private actor ScriptedReviewSubmissionExecutor: ReviewSubmissionExecuting {
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

private func makeDelayedReviewHeadLoader(delayNanoseconds: UInt64) -> ReviewHeadLoader {
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

private func makeDelayedReviewCountsLoader(delayNanoseconds: UInt64) -> ReviewCountsLoader {
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

private func makeDelayedReviewQueueChunkLoader(delayNanoseconds: UInt64) -> ReviewQueueChunkLoader {
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

private func makeReviewTimelinePageLoader() -> ReviewTimelinePageLoader {
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

@MainActor
final class FlashcardsStoreTests: XCTestCase {
    private struct StoreContext {
        let store: FlashcardsStore
        let database: LocalDatabase
    }

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

    func testOpenDeckManagementSelectsSettingsTabAndSetsPresentationRequest() throws {
        let store = try self.makeStore()

        store.openDeckManagement()

        XCTAssertEqual(store.selectedTab, .settings)
        XCTAssertEqual(store.settingsPresentationRequest, .decks)
    }

    func testSettingsNavigationDestinationsIncludeAccount() {
        let destinations: [SettingsNavigationDestination] = [.decks, .tags, .account, .access]

        XCTAssertEqual(destinations, [.decks, .tags, .account, .access])
    }

    func testReloadLoadsPersistedTagReviewFilterWhenTagExists() throws {
        let environment = try self.makeStoreEnvironment()
        let workspaceId = try environment.database.loadStateSnapshot().workspace.workspaceId
        let card = try environment.database.saveCard(
            workspaceId: workspaceId,
            input: self.makeCardInput(frontText: "Front", backText: "Back", tags: ["grammar"]),
            cardId: nil
        )
        environment.userDefaults.set(
            Data("{\"kind\":\"tag\",\"tag\":\"grammar\"}".utf8),
            forKey: "selected-review-filter"
        )

        let store = self.makeStore(environment: environment)

        XCTAssertEqual(store.selectedReviewFilter, .tag(tag: "grammar"))
        XCTAssertEqual(store.selectedReviewFilterTitle, "grammar")
        XCTAssertEqual(store.reviewQueue.map(\.cardId), [card.cardId])
    }

    func testReloadResetsPersistedTagReviewFilterWhenTagIsMissing() throws {
        let environment = try self.makeStoreEnvironment()
        environment.userDefaults.set(
            Data("{\"kind\":\"tag\",\"tag\":\"missing-tag\"}".utf8),
            forKey: "selected-review-filter"
        )

        let store = self.makeStore(environment: environment)

        XCTAssertEqual(store.selectedReviewFilter, .allCards)
    }

    func testSelectReviewFilterPublishesHeadBeforeCounts() async throws {
        let context = try self.makeStoreContext(
            reviewHeadDelayNanoseconds: 150_000_000,
            reviewCountsDelayNanoseconds: 500_000_000
        )
        let store = context.store

        try store.saveCard(
            input: self.makeCardInput(frontText: "Other deck", backText: "Back", tags: ["other"]),
            editingCardId: nil
        )
        try store.saveCard(
            input: self.makeCardInput(frontText: "Target first", backText: "Back", tags: ["target"]),
            editingCardId: nil
        )
        try store.saveCard(
            input: self.makeCardInput(frontText: "Target second", backText: "Back", tags: ["target"]),
            editingCardId: nil
        )
        try store.createDeck(
            input: self.makeDeckInput(name: "Target deck", tags: ["target"])
        )
        let targetDeckId = try XCTUnwrap(store.decks.first?.deckId)

        store.selectReviewFilter(reviewFilter: .deck(deckId: targetDeckId))

        XCTAssertEqual(store.selectedReviewFilter, .deck(deckId: targetDeckId))
        XCTAssertEqual(store.selectedReviewFilterTitle, "Target deck")
        XCTAssertTrue(store.isReviewHeadLoading)
        XCTAssertTrue(store.isReviewCountsLoading)
        XCTAssertTrue(store.reviewQueue.isEmpty)
        XCTAssertEqual(store.reviewTotalCount, 0)

        await self.waitUntil(
            timeoutNanoseconds: 2_000_000_000,
            pollNanoseconds: 20_000_000
        ) {
            store.isReviewHeadLoading == false
        }

        XCTAssertEqual(store.reviewQueue.map(\.frontText), ["Target first", "Target second"])
        XCTAssertTrue(store.isReviewCountsLoading)
        XCTAssertEqual(store.reviewTotalCount, 0)

        await self.waitUntil(
            timeoutNanoseconds: 2_000_000_000,
            pollNanoseconds: 20_000_000
        ) {
            store.isReviewCountsLoading == false
        }

        XCTAssertEqual(store.displayedReviewDueCount, 2)
        XCTAssertEqual(store.reviewTotalCount, 2)
    }

    func testSelectReviewFilterDiscardsStaleAsyncResults() async throws {
        let context = try self.makeStoreContext(
            reviewHeadDelayNanoseconds: 200_000_000,
            reviewCountsDelayNanoseconds: 400_000_000
        )
        let store = context.store

        try store.saveCard(
            input: self.makeCardInput(frontText: "Alpha", backText: "Back", tags: ["alpha"]),
            editingCardId: nil
        )
        try store.saveCard(
            input: self.makeCardInput(frontText: "Beta", backText: "Back", tags: ["beta"]),
            editingCardId: nil
        )
        try store.createDeck(
            input: self.makeDeckInput(name: "Alpha deck", tags: ["alpha"])
        )
        try store.createDeck(
            input: self.makeDeckInput(name: "Beta deck", tags: ["beta"])
        )

        let alphaDeckId = try XCTUnwrap(store.decks.first(where: { deck in
            deck.name == "Alpha deck"
        })?.deckId)
        let betaDeckId = try XCTUnwrap(store.decks.first(where: { deck in
            deck.name == "Beta deck"
        })?.deckId)

        store.selectReviewFilter(reviewFilter: .deck(deckId: alphaDeckId))
        store.selectReviewFilter(reviewFilter: .deck(deckId: betaDeckId))

        await self.waitUntil(
            timeoutNanoseconds: 2_000_000_000,
            pollNanoseconds: 20_000_000
        ) {
            store.isReviewCountsLoading == false
        }

        XCTAssertEqual(store.selectedReviewFilter, .deck(deckId: betaDeckId))
        XCTAssertEqual(store.selectedReviewFilterTitle, "Beta deck")
        XCTAssertEqual(store.reviewQueue.map(\.frontText), ["Beta"])
        XCTAssertEqual(store.displayedReviewDueCount, 1)
        XCTAssertEqual(store.reviewTotalCount, 1)
    }

    func testSeedQueueAdvancesImmediatelyWhileCountsStillLoad() async throws {
        let context = try self.makeStoreContext(
            makeReviewSubmissionExecutor: { database in
                ScriptedReviewSubmissionExecutor(
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
            input: self.makeCardInput(frontText: "First target", backText: "Back", tags: ["target"]),
            editingCardId: nil
        )
        try store.saveCard(
            input: self.makeCardInput(frontText: "Second target", backText: "Back", tags: ["target"]),
            editingCardId: nil
        )
        try store.saveCard(
            input: self.makeCardInput(frontText: "Third target", backText: "Back", tags: ["target"]),
            editingCardId: nil
        )
        try store.createDeck(
            input: self.makeDeckInput(name: "Target deck", tags: ["target"])
        )
        let targetDeckId = try XCTUnwrap(store.decks.first?.deckId)

        store.selectReviewFilter(reviewFilter: .deck(deckId: targetDeckId))

        await self.waitUntil(
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

        await self.waitUntil(
            timeoutNanoseconds: 3_000_000_000,
            pollNanoseconds: 20_000_000
        ) {
            store.pendingReviewCardIds.isEmpty
        }

        XCTAssertNil(store.reviewSubmissionFailure)
    }

    func testReviewQueueReplenishesWhenVisibleQueueDropsToThreshold() async throws {
        let context = try self.makeStoreContext(
            makeReviewSubmissionExecutor: { database in
                ScriptedReviewSubmissionExecutor(
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
                input: self.makeCardInput(
                    frontText: "Card \(index)",
                    backText: "Back \(index)",
                    tags: ["target"]
                ),
                editingCardId: nil
            )
        }
        try store.createDeck(
            input: self.makeDeckInput(name: "Target deck", tags: ["target"])
        )
        let targetDeckId = try XCTUnwrap(store.decks.first?.deckId)

        store.selectReviewFilter(reviewFilter: .deck(deckId: targetDeckId))

        await self.waitUntil(
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

        await self.waitUntil(
            timeoutNanoseconds: 2_000_000_000,
            pollNanoseconds: 20_000_000
        ) {
            store.isReviewQueueChunkLoading == false && store.effectiveReviewQueue.count == 6
        }

        XCTAssertEqual(store.reviewQueue.count, 10)
    }

    func testEnqueueReviewSubmissionOptimisticallyRemovesCurrentCard() async throws {
        let context = try self.makeStoreContext { database in
            ScriptedReviewSubmissionExecutor(
                databaseURL: database.databaseURL,
                outcomes: [.submitToDatabase],
                delayNanoseconds: 300_000_000
            )
        }
        let store = context.store

        try store.saveCard(
            input: self.makeCardInput(frontText: "First front", backText: "First back", tags: ["tag-a"]),
            editingCardId: nil
        )
        try store.saveCard(
            input: self.makeCardInput(frontText: "Second front", backText: "Second back", tags: ["tag-b"]),
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

        await self.waitUntil(
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

    func testEnqueueReviewSubmissionRejectsDuplicatePendingCard() async throws {
        let context = try self.makeStoreContext { database in
            ScriptedReviewSubmissionExecutor(
                databaseURL: database.databaseURL,
                outcomes: [.submitToDatabase],
                delayNanoseconds: 300_000_000
            )
        }
        let store = context.store

        try store.saveCard(
            input: self.makeCardInput(frontText: "Front", backText: "Back", tags: ["tag-a"]),
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

        await self.waitUntil(
            timeoutNanoseconds: 2_000_000_000,
            pollNanoseconds: 20_000_000
        ) {
            store.isReviewPending(cardId: cardId) == false
        }
    }

    func testEnqueueReviewSubmissionFailureRestoresQueueAndSetsAlert() async throws {
        let context = try self.makeStoreContext { database in
            ScriptedReviewSubmissionExecutor(
                databaseURL: database.databaseURL,
                outcomes: [.fail(message: "Injected review failure")],
                delayNanoseconds: 10_000_000
            )
        }
        let store = context.store

        try store.saveCard(
            input: self.makeCardInput(frontText: "Front", backText: "Back", tags: ["tag-a"]),
            editingCardId: nil
        )
        let cardId = try XCTUnwrap(store.effectiveReviewQueue.first?.cardId)

        try store.enqueueReviewSubmission(cardId: cardId, rating: .good)
        XCTAssertTrue(store.effectiveReviewQueue.isEmpty)

        await self.waitUntil(
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
        let context = try self.makeStoreContext { database in
            ScriptedReviewSubmissionExecutor(
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
            input: self.makeCardInput(frontText: "First front", backText: "First back", tags: ["tag-a"]),
            editingCardId: nil
        )
        try store.saveCard(
            input: self.makeCardInput(frontText: "Second front", backText: "Second back", tags: ["tag-b"]),
            editingCardId: nil
        )

        let initialQueue = store.effectiveReviewQueue
        let firstCardId = try XCTUnwrap(initialQueue.first?.cardId)
        let secondCardId = try XCTUnwrap(initialQueue.dropFirst().first?.cardId)

        try store.enqueueReviewSubmission(cardId: firstCardId, rating: .good)
        try store.enqueueReviewSubmission(cardId: secondCardId, rating: .good)

        await self.waitUntil(
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
        let context = try self.makeStoreContext { database in
            ScriptedReviewSubmissionExecutor(
                databaseURL: database.databaseURL,
                outcomes: [.submitToDatabase],
                delayNanoseconds: 400_000_000
            )
        }
        let store = context.store

        try store.saveCard(
            input: self.makeCardInput(frontText: "Local front", backText: "Local back", tags: ["tag-a"]),
            editingCardId: nil
        )
        let pendingCardId = try XCTUnwrap(store.effectiveReviewQueue.first?.cardId)
        try store.enqueueReviewSubmission(cardId: pendingCardId, rating: .good)

        let baseSnapshot = try context.database.loadStateSnapshot()
        let remoteCard = self.makeRemoteDueCard(
            workspaceId: baseSnapshot.workspace.workspaceId,
            cardId: "remote-due-card"
        )
        store.applyExternalSnapshot(
            snapshot: AppStateSnapshot(
                workspace: baseSnapshot.workspace,
                userSettings: baseSnapshot.userSettings,
                schedulerSettings: baseSnapshot.schedulerSettings,
                cloudSettings: baseSnapshot.cloudSettings,
                cards: baseSnapshot.cards + [remoteCard],
                decks: baseSnapshot.decks
            )
        )

        XCTAssertTrue(store.effectiveReviewQueue.contains(where: { card in
            card.cardId == "remote-due-card"
        }))
        XCTAssertFalse(store.effectiveReviewQueue.contains(where: { card in
            card.cardId == pendingCardId
        }))

        await self.waitUntil(
            timeoutNanoseconds: 3_000_000_000,
            pollNanoseconds: 20_000_000
        ) {
            store.isReviewPending(cardId: pendingCardId) == false
        }
    }

    private func makeStore() throws -> FlashcardsStore {
        try self.makeStoreContext().store
    }

    private func makeStore(
        environment: (
            database: LocalDatabase,
            userDefaults: UserDefaults,
            credentialStore: CloudCredentialStore
        )
    ) -> FlashcardsStore {
        FlashcardsStore(
            userDefaults: environment.userDefaults,
            encoder: JSONEncoder(),
            decoder: JSONDecoder(),
            database: environment.database,
            cloudAuthService: CloudAuthService(),
            credentialStore: environment.credentialStore,
            reviewSubmissionExecutor: ReviewSubmissionExecutor(databaseURL: environment.database.databaseURL),
            reviewHeadLoader: makeDelayedReviewHeadLoader(delayNanoseconds: 0),
            reviewCountsLoader: makeDelayedReviewCountsLoader(delayNanoseconds: 0),
            reviewQueueChunkLoader: makeDelayedReviewQueueChunkLoader(delayNanoseconds: 0),
            reviewTimelinePageLoader: makeReviewTimelinePageLoader(),
            initialGlobalErrorMessage: ""
        )
    }

    private func makeStore(
        environment: (
            database: LocalDatabase,
            userDefaults: UserDefaults,
            credentialStore: CloudCredentialStore
        ),
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
            reviewHeadLoader: makeDelayedReviewHeadLoader(delayNanoseconds: reviewHeadDelayNanoseconds),
            reviewCountsLoader: makeDelayedReviewCountsLoader(delayNanoseconds: reviewCountsDelayNanoseconds),
            reviewQueueChunkLoader: makeDelayedReviewQueueChunkLoader(delayNanoseconds: 0),
            reviewTimelinePageLoader: makeReviewTimelinePageLoader(),
            initialGlobalErrorMessage: ""
        )
    }

    private func makeStoreContext(
        reviewHeadDelayNanoseconds: UInt64,
        reviewCountsDelayNanoseconds: UInt64
    ) throws -> StoreContext {
        let environment = try self.makeStoreEnvironment()

        return StoreContext(
            store: self.makeStore(
                environment: environment,
                reviewHeadDelayNanoseconds: reviewHeadDelayNanoseconds,
                reviewCountsDelayNanoseconds: reviewCountsDelayNanoseconds
            ),
            database: environment.database
        )
    }

    private func makeStoreContext(
        makeReviewSubmissionExecutor: (LocalDatabase) -> ReviewSubmissionExecuting,
        reviewHeadDelayNanoseconds: UInt64,
        reviewCountsDelayNanoseconds: UInt64
    ) throws -> StoreContext {
        let environment = try self.makeStoreEnvironment()
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
                reviewHeadLoader: makeDelayedReviewHeadLoader(delayNanoseconds: reviewHeadDelayNanoseconds),
                reviewCountsLoader: makeDelayedReviewCountsLoader(delayNanoseconds: reviewCountsDelayNanoseconds),
                reviewQueueChunkLoader: makeDelayedReviewQueueChunkLoader(delayNanoseconds: 0),
                reviewTimelinePageLoader: makeReviewTimelinePageLoader(),
                initialGlobalErrorMessage: ""
            ),
            database: environment.database
        )
    }

    private func makeStoreContext() throws -> StoreContext {
        let environment = try self.makeStoreEnvironment()

        return StoreContext(
            store: self.makeStore(environment: environment),
            database: environment.database
        )
    }

    private func makeStoreContext(
        makeReviewSubmissionExecutor: (LocalDatabase) -> ReviewSubmissionExecuting
    ) throws -> StoreContext {
        let environment = try self.makeStoreEnvironment()
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
                reviewHeadLoader: makeDelayedReviewHeadLoader(delayNanoseconds: 0),
                reviewCountsLoader: makeDelayedReviewCountsLoader(delayNanoseconds: 0),
                reviewQueueChunkLoader: makeDelayedReviewQueueChunkLoader(delayNanoseconds: 0),
                reviewTimelinePageLoader: makeReviewTimelinePageLoader(),
                initialGlobalErrorMessage: ""
            ),
            database: environment.database
        )
    }

    private func makeStoreEnvironment() throws -> (
        database: LocalDatabase,
        userDefaults: UserDefaults,
        credentialStore: CloudCredentialStore
    ) {
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

        return (
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

    private func makeRemoteDueCard(workspaceId: String, cardId: String) -> Card {
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

    private func waitUntil(
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
}
