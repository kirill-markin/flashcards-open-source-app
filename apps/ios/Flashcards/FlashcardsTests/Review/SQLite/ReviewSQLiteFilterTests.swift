import Foundation
import XCTest
@testable import Flashcards

final class ReviewSQLiteFilterTests: ReviewSQLiteTestCase {
    func testSQLiteResolvedTagReviewFilterMatchesUnicodeStoredTagVariants() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))
        let decomposedTag = "E\u{301}clair"

        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "uppercase-tag-card",
            dueAt: nil,
            createdAt: "2026-03-09T08:30:00.000Z",
            tags: ["Éclair"]
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "lowercase-tag-card",
            dueAt: nil,
            createdAt: "2026-03-09T08:00:00.000Z",
            tags: ["éclair"]
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "plain-tag-card",
            dueAt: nil,
            createdAt: "2026-03-09T07:00:00.000Z",
            tags: ["plain"]
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "duplicate-identity-tag-card",
            dueAt: nil,
            createdAt: "2026-03-09T07:30:00.000Z",
            tags: ["Éclair", "éclair"]
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "decomposed-tag-card",
            dueAt: nil,
            createdAt: "2026-03-09T07:45:00.000Z",
            tags: [decomposedTag]
        )

        let resolvedReviewQuery = try database.loadResolvedReviewQuery(
            workspaceId: workspace.workspaceId,
            reviewFilter: .tag(tag: "éclair")
        )
        let reviewHead = try database.loadReviewHead(
            workspaceId: workspace.workspaceId,
            resolvedReviewFilter: resolvedReviewQuery.reviewFilter,
            reviewQueryDefinition: resolvedReviewQuery.queryDefinition,
            now: now,
            limit: 8
        )
        let reviewCounts = try database.loadReviewCounts(
            workspaceId: workspace.workspaceId,
            reviewQueryDefinition: resolvedReviewQuery.queryDefinition,
            now: now
        )
        let tagSummary = try database.loadWorkspaceTagsSummary(workspaceId: workspace.workspaceId)
        let matchingTagSummaries = tagSummary.tags.filter { summary in
            normalizeTagKey(tag: summary.tag) == normalizeTagKey(tag: "éclair")
        }

        guard case .tags(let resolvedTagNames) = resolvedReviewQuery.reviewFilter else {
            XCTFail("Expected resolved tag review filter")
            return
        }
        XCTAssertEqual(resolvedTagNames.count, 1)
        XCTAssertEqual(normalizeTagKey(tag: resolvedTagNames[0]), normalizeTagKey(tag: "éclair"))
        guard case .tag(let exactTagNames) = resolvedReviewQuery.queryDefinition else {
            XCTFail("Expected resolved direct tag query definition")
            return
        }
        XCTAssertEqual(exactTagNames.count, 3)
        XCTAssertTrue(exactTagNames.contains { tagName in
            tagName.unicodeScalars.elementsEqual(decomposedTag.unicodeScalars)
        })
        XCTAssertEqual(
            reviewHead.seedReviewQueue.map(\.cardId),
            [
                "duplicate-identity-tag-card",
                "decomposed-tag-card",
                "lowercase-tag-card",
                "uppercase-tag-card"
            ]
        )
        XCTAssertEqual(reviewCounts, ReviewCounts(dueCount: 4, totalCount: 4))
        XCTAssertEqual(matchingTagSummaries.count, 1)
        XCTAssertEqual(matchingTagSummaries.first?.cardsCount, 4)
    }

    func testSQLiteTagReviewFilterMatchesAnySelectedTagAndEmptySelectionMatchesNone() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))

        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "biology-card",
            dueAt: nil,
            createdAt: "2026-03-09T08:00:00.000Z",
            tags: ["Biology"]
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "chemistry-card",
            dueAt: nil,
            createdAt: "2026-03-09T07:00:00.000Z",
            tags: ["Chemistry"]
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "untagged-card",
            dueAt: nil,
            createdAt: "2026-03-09T06:00:00.000Z",
            tags: []
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "physics-card",
            dueAt: nil,
            createdAt: "2026-03-09T05:00:00.000Z",
            tags: ["Physics"]
        )

        let unionQuery = try database.loadResolvedReviewQuery(
            workspaceId: workspace.workspaceId,
            reviewFilter: makeReviewTagsFilter(tags: ["chemistry", "biology"])
        )
        let unionHead = try database.loadReviewHead(
            workspaceId: workspace.workspaceId,
            resolvedReviewFilter: unionQuery.reviewFilter,
            reviewQueryDefinition: unionQuery.queryDefinition,
            now: now,
            limit: 8
        )
        let emptyQuery = try database.loadResolvedReviewQuery(
            workspaceId: workspace.workspaceId,
            reviewFilter: makeReviewTagsFilter(tags: [])
        )
        let emptyCounts = try database.loadReviewCounts(
            workspaceId: workspace.workspaceId,
            reviewQueryDefinition: emptyQuery.queryDefinition,
            now: now
        )
        let missingTagQuery = try database.loadResolvedReviewQuery(
            workspaceId: workspace.workspaceId,
            reviewFilter: makeReviewTagsFilter(tags: ["Missing"])
        )
        let partiallyResolvedQuery = try database.loadResolvedReviewQuery(
            workspaceId: workspace.workspaceId,
            reviewFilter: makeReviewTagsFilter(tags: ["biology", "Missing"])
        )
        let reloadedPartiallyResolvedQuery = try database.loadResolvedReviewQuery(
            workspaceId: workspace.workspaceId,
            reviewFilter: partiallyResolvedQuery.reviewFilter
        )
        let restoredCompleteFilter = try makeReviewFilter(
            persistedReviewFilter: makePersistedReviewFilter(
                reviewFilter: makeReviewTagsFilter(tags: ["biology", "chemistry", "physics"])
            )
        )
        let completeSelectionQuery = try database.loadResolvedReviewQuery(
            workspaceId: workspace.workspaceId,
            reviewFilter: restoredCompleteFilter
        )
        let notificationCard = try XCTUnwrap(
            database.loadCurrentReviewNotificationCard(
                workspaceId: workspace.workspaceId,
                reviewFilter: partiallyResolvedQuery.reviewFilter,
                now: now
            )
        )
        let completeSelectionNotificationCard = try XCTUnwrap(
            database.loadCurrentReviewNotificationCard(
                workspaceId: workspace.workspaceId,
                reviewFilter: restoredCompleteFilter,
                now: now
            )
        )

        XCTAssertEqual(unionQuery.reviewFilter, makeReviewTagsFilter(tags: ["Biology", "Chemistry"]))
        XCTAssertEqual(unionHead.seedReviewQueue.map(\.cardId), ["chemistry-card", "biology-card"])
        XCTAssertEqual(emptyQuery.reviewFilter, makeReviewTagsFilter(tags: []))
        XCTAssertEqual(emptyCounts, ReviewCounts(dueCount: 0, totalCount: 0))
        XCTAssertEqual(missingTagQuery.reviewFilter, makeReviewTagsFilter(tags: ["Missing"]))
        XCTAssertEqual(missingTagQuery.queryDefinition, .tag(exactTagNames: []))
        XCTAssertEqual(
            partiallyResolvedQuery.reviewFilter,
            makeReviewTagsFilter(tags: ["Biology", "Missing"])
        )
        XCTAssertEqual(partiallyResolvedQuery.queryDefinition, .tag(exactTagNames: ["Biology"]))
        XCTAssertEqual(reloadedPartiallyResolvedQuery, partiallyResolvedQuery)
        XCTAssertEqual(completeSelectionQuery.reviewFilter, .allCards)
        XCTAssertEqual(completeSelectionQuery.queryDefinition, .allCards)
        XCTAssertEqual(notificationCard.cardId, "biology-card")
        XCTAssertEqual(
            try makeReviewFilter(persistedReviewFilter: notificationCard.reviewFilter),
            partiallyResolvedQuery.reviewFilter
        )
        XCTAssertEqual(completeSelectionNotificationCard.cardId, "physics-card")
        XCTAssertEqual(
            try makeReviewFilter(persistedReviewFilter: completeSelectionNotificationCard.reviewFilter),
            .allCards
        )
    }

    func testSQLiteDeckReviewQueueOrdersNewCardsByCreatedAtAscending() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))

        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "deck-matching-newer",
            dueAt: nil,
            createdAt: "2026-03-09T08:30:00.000Z",
            tags: ["topic"]
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "deck-matching-older",
            dueAt: nil,
            createdAt: "2026-03-09T08:00:00.000Z",
            tags: ["topic"]
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "deck-nonmatching-oldest",
            dueAt: nil,
            createdAt: "2026-03-09T07:00:00.000Z",
            tags: ["other"]
        )
        let deck = try database.createDeck(
            workspaceId: workspace.workspaceId,
            input: DeckEditorInput(
                name: "Topic",
                filterDefinition: buildDeckFilterDefinition(tags: ["topic"])
            )
        )

        let resolvedReviewQuery = try database.loadResolvedReviewQuery(
            workspaceId: workspace.workspaceId,
            reviewFilter: .deck(deckId: deck.deckId)
        )
        let reviewHead = try database.loadReviewHead(
            workspaceId: workspace.workspaceId,
            resolvedReviewFilter: resolvedReviewQuery.reviewFilter,
            reviewQueryDefinition: resolvedReviewQuery.queryDefinition,
            now: now,
            limit: 8
        )

        XCTAssertEqual(reviewHead.seedReviewQueue.map(\.cardId), ["deck-matching-older", "deck-matching-newer"])
        XCTAssertFalse(reviewHead.hasMoreCards)
    }

    func testSQLiteResolvedDeckReviewFilterMatchesUnicodeStoredTagName() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))

        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "unicode-deck-card",
            dueAt: nil,
            createdAt: "2026-03-09T08:00:00.000Z",
            tags: ["Éclair"]
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "plain-deck-card",
            dueAt: nil,
            createdAt: "2026-03-09T07:00:00.000Z",
            tags: ["plain"]
        )
        let deck = try database.createDeck(
            workspaceId: workspace.workspaceId,
            input: DeckEditorInput(
                name: "Desserts",
                filterDefinition: buildDeckFilterDefinition(tags: ["éclair"])
            )
        )

        let resolvedReviewQuery = try database.loadResolvedReviewQuery(
            workspaceId: workspace.workspaceId,
            reviewFilter: .deck(deckId: deck.deckId)
        )
        let reviewHead = try database.loadReviewHead(
            workspaceId: workspace.workspaceId,
            resolvedReviewFilter: resolvedReviewQuery.reviewFilter,
            reviewQueryDefinition: resolvedReviewQuery.queryDefinition,
            now: now,
            limit: 8
        )
        let reviewCounts = try database.loadReviewCounts(
            workspaceId: workspace.workspaceId,
            reviewQueryDefinition: resolvedReviewQuery.queryDefinition,
            now: now
        )
        let deckSnapshot = try database.loadDecksListSnapshot(
            workspaceId: workspace.workspaceId,
            now: now
        )
        let matchingDeckCards = try database.loadCardsMatchingDeck(
            workspaceId: workspace.workspaceId,
            filterDefinition: deck.filterDefinition
        )

        XCTAssertEqual(resolvedReviewQuery.reviewFilter, .deck(deckId: deck.deckId))
        XCTAssertEqual(
            resolvedReviewQuery.queryDefinition,
            .deck(filterDefinition: buildDeckFilterDefinition(tags: ["Éclair"]))
        )
        XCTAssertEqual(reviewHead.seedReviewQueue.map(\.cardId), ["unicode-deck-card"])
        XCTAssertEqual(reviewCounts, ReviewCounts(dueCount: 1, totalCount: 1))
        XCTAssertEqual(deckSnapshot.deckSummaries.first(where: { summary in
            summary.deckId == deck.deckId
        })?.totalCards, 1)
        XCTAssertEqual(matchingDeckCards.map(\.cardId), ["unicode-deck-card"])
    }

    func testSQLiteCardsListFilterMatchesUnicodeStoredTagVariants() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()

        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "uppercase-tag-card",
            dueAt: nil,
            createdAt: "2026-03-09T08:30:00.000Z",
            tags: ["Éclair"]
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "lowercase-tag-card",
            dueAt: nil,
            createdAt: "2026-03-09T08:00:00.000Z",
            tags: ["éclair"]
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "plain-tag-card",
            dueAt: nil,
            createdAt: "2026-03-09T07:00:00.000Z",
            tags: ["plain"]
        )

        let matchingSnapshot = try database.loadCardsListSnapshot(
            workspaceId: workspace.workspaceId,
            searchText: "",
            filter: CardFilter(tags: ["éclair"])
        )
        let missingSnapshot = try database.loadCardsListSnapshot(
            workspaceId: workspace.workspaceId,
            searchText: "",
            filter: CardFilter(tags: ["missing"])
        )

        XCTAssertEqual(matchingSnapshot.cards.map(\.cardId), ["uppercase-tag-card", "lowercase-tag-card"])
        XCTAssertEqual(matchingSnapshot.totalCount, 2)
        XCTAssertTrue(missingSnapshot.cards.isEmpty)
        XCTAssertEqual(missingSnapshot.totalCount, 0)
    }

}

