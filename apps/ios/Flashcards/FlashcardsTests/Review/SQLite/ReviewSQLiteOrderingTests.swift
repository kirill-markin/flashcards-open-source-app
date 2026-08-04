import Foundation
import XCTest
@testable import Flashcards

final class ReviewSQLiteOrderingTests: XCTestCase {
    private var databaseURL: URL?
    private var database: LocalDatabase?

    override func tearDownWithError() throws {
        if let database {
            try database.close()
        }
        if let databaseURL {
            try? FileManager.default.removeItem(at: databaseURL)
        }
        self.database = nil
        self.databaseURL = nil
        try super.tearDownWithError()
    }

    func testSQLiteReviewQueueAndTimelineUseRecentlyReviewedDuePriorityBuckets() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))

        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "old-due",
            dueAt: "2026-03-09T07:59:59.999Z",
            createdAt: "2026-03-09T08:30:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "recent-now",
            dueAt: "2026-03-09T09:00:00.000Z",
            createdAt: "2026-03-09T08:00:00.000Z",
            fsrsLastReviewedAt: "2026-03-09T09:00:00Z",
            tags: []
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "recent-cutoff",
            dueAt: "2026-03-09T08:00:00.000Z",
            createdAt: "2026-03-09T07:30:00.000Z",
            fsrsLastReviewedAt: "2026-03-09T08:00:00.000Z",
            tags: []
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "due-last-hour-old-review",
            dueAt: "2026-03-09T08:15:00.000Z",
            createdAt: "2026-03-09T07:45:00.000Z",
            fsrsLastReviewedAt: "2026-03-09T07:59:59.999Z",
            tags: []
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "new-card",
            dueAt: nil,
            createdAt: "2026-03-09T09:30:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "future-one-millisecond",
            dueAt: "2026-03-09T09:00:00.001Z",
            createdAt: "2026-03-09T10:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "malformed-due",
            dueAt: "1000",
            createdAt: "2026-03-09T11:00:00.000Z"
        )

        let limitedHead = try database.loadReviewHead(
            workspaceId: workspace.workspaceId,
            resolvedReviewFilter: .allCards,
            reviewQueryDefinition: .allCards,
            now: now,
            limit: 3
        )
        let fullHead = try database.loadReviewHead(
            workspaceId: workspace.workspaceId,
            resolvedReviewFilter: .allCards,
            reviewQueryDefinition: .allCards,
            now: now,
            limit: 10
        )
        let timelinePage = try database.loadReviewTimelinePage(
            workspaceId: workspace.workspaceId,
            reviewQueryDefinition: .allCards,
            now: now,
            limit: 10,
            offset: 0
        )

        XCTAssertEqual(limitedHead.seedReviewQueue.map(\.cardId), ["recent-cutoff", "recent-now", "old-due"])
        XCTAssertTrue(limitedHead.hasMoreCards)
        XCTAssertEqual(fullHead.seedReviewQueue.map(\.cardId), ["recent-cutoff", "recent-now", "old-due", "due-last-hour-old-review", "new-card"])
        XCTAssertFalse(fullHead.hasMoreCards)
        XCTAssertEqual(
            timelinePage.cards.map(\.cardId),
            ["recent-cutoff", "recent-now", "old-due", "due-last-hour-old-review", "new-card", "future-one-millisecond", "malformed-due"]
        )
        XCTAssertFalse(timelinePage.hasMoreCards)
    }

    func testSQLiteReviewQueueAndTimelineTreatVariableFractionDueAtAsParseable() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))

        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "recent-one-digit-fraction",
            dueAt: "2026-03-09T08:30:00.1Z",
            createdAt: "2026-03-09T08:00:00.000Z",
            fsrsLastReviewedAt: "2026-03-09T08:30:00.100Z",
            tags: []
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "old-six-digit-fraction",
            dueAt: "2026-03-09T07:30:00.123456Z",
            createdAt: "2026-03-09T07:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "future-one-digit-fraction",
            dueAt: "2026-03-09T09:00:00.1Z",
            createdAt: "2026-03-09T09:30:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "malformed-due",
            dueAt: "1000",
            createdAt: "2026-03-09T10:00:00.000Z"
        )

        let reviewHead = try database.loadReviewHead(
            workspaceId: workspace.workspaceId,
            resolvedReviewFilter: .allCards,
            reviewQueryDefinition: .allCards,
            now: now,
            limit: 10
        )
        let timelinePage = try database.loadReviewTimelinePage(
            workspaceId: workspace.workspaceId,
            reviewQueryDefinition: .allCards,
            now: now,
            limit: 10,
            offset: 0
        )

        XCTAssertEqual(reviewHead.seedReviewQueue.map(\.cardId), ["recent-one-digit-fraction", "old-six-digit-fraction"])
        XCTAssertFalse(reviewHead.hasMoreCards)
        XCTAssertEqual(
            timelinePage.cards.map(\.cardId),
            [
                "recent-one-digit-fraction",
                "old-six-digit-fraction",
                "future-one-digit-fraction",
                "malformed-due"
            ]
        )
        XCTAssertFalse(timelinePage.hasMoreCards)
    }

    func testSQLiteReviewQueueAndTimelineMatchSwiftTruncatedFractionSemantics() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.123Z"))

        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "canonical-now-older",
            dueAt: "2026-03-09T09:00:00.123Z",
            createdAt: "2026-03-09T08:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "truncated-now-newer",
            dueAt: "2026-03-09T09:00:00.123999Z",
            createdAt: "2026-03-09T08:30:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "future-one-millisecond",
            dueAt: "2026-03-09T09:00:00.124Z",
            createdAt: "2026-03-09T09:00:00.000Z"
        )

        let reviewHead = try database.loadReviewHead(
            workspaceId: workspace.workspaceId,
            resolvedReviewFilter: .allCards,
            reviewQueryDefinition: .allCards,
            now: now,
            limit: 10
        )
        let timelinePage = try database.loadReviewTimelinePage(
            workspaceId: workspace.workspaceId,
            reviewQueryDefinition: .allCards,
            now: now,
            limit: 10,
            offset: 0
        )

        XCTAssertEqual(reviewHead.seedReviewQueue.map(\.cardId), ["canonical-now-older", "truncated-now-newer"])
        XCTAssertFalse(reviewHead.hasMoreCards)
        XCTAssertEqual(
            timelinePage.cards.map(\.cardId),
            ["canonical-now-older", "truncated-now-newer", "future-one-millisecond"]
        )
        XCTAssertEqual(
            timelinePage.cards.map(\.cardId),
            sortCardsForReviewTimeline(cards: timelinePage.cards, now: now).map(\.cardId)
        )
        XCTAssertFalse(timelinePage.hasMoreCards)
    }

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

    func testSQLiteReviewTimelineOrdersMalformedDueAtByOlderCreatedAtThenCardId() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))

        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "malformed-newer-a",
            dueAt: "3000",
            createdAt: "2026-03-09T11:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "malformed-newer-z",
            dueAt: "2000",
            createdAt: "2026-03-09T11:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "malformed-older",
            dueAt: "1000",
            createdAt: "2026-03-09T10:00:00.000Z"
        )

        let reviewHead = try database.loadReviewHead(
            workspaceId: workspace.workspaceId,
            resolvedReviewFilter: .allCards,
            reviewQueryDefinition: .allCards,
            now: now,
            limit: 10
        )
        let timelinePage = try database.loadReviewTimelinePage(
            workspaceId: workspace.workspaceId,
            reviewQueryDefinition: .allCards,
            now: now,
            limit: 10,
            offset: 0
        )

        XCTAssertEqual(reviewHead.seedReviewQueue.map(\.cardId), [])
        XCTAssertFalse(reviewHead.hasMoreCards)
        XCTAssertEqual(
            timelinePage.cards.map(\.cardId),
            ["malformed-older", "malformed-newer-a", "malformed-newer-z"]
        )
        XCTAssertFalse(timelinePage.hasMoreCards)
    }

    func testSQLiteReviewQueueRejectsShapeValidInvalidTimestampComponents() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))

        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "recent-valid",
            dueAt: "2026-03-09T08:59:00.000Z",
            createdAt: "2026-03-09T08:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "invalid-month",
            dueAt: "2026-13-09T08:59:00.000Z",
            createdAt: "2026-03-09T11:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "invalid-minute",
            dueAt: "2026-03-09T08:99:00.000Z",
            createdAt: "2026-03-09T10:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "invalid-second",
            dueAt: "2026-03-09T08:59:60.000Z",
            createdAt: "2026-03-09T09:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "invalid-calendar-day",
            dueAt: "2026-02-31T08:59:00.000Z",
            createdAt: "2026-03-09T12:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "invalid-non-leap-day",
            dueAt: "2026-02-29T08:59:00.000Z",
            createdAt: "2026-03-09T11:30:00.000Z"
        )

        let reviewHead = try database.loadReviewHead(
            workspaceId: workspace.workspaceId,
            resolvedReviewFilter: .allCards,
            reviewQueryDefinition: .allCards,
            now: now,
            limit: 10
        )
        let timelinePage = try database.loadReviewTimelinePage(
            workspaceId: workspace.workspaceId,
            reviewQueryDefinition: .allCards,
            now: now,
            limit: 10,
            offset: 0
        )

        XCTAssertEqual(reviewHead.seedReviewQueue.map(\.cardId), ["recent-valid"])
        XCTAssertFalse(reviewHead.hasMoreCards)
        XCTAssertEqual(
            timelinePage.cards.map(\.cardId),
            [
                "recent-valid",
                "invalid-second",
                "invalid-minute",
                "invalid-month",
                "invalid-non-leap-day",
                "invalid-calendar-day"
            ]
        )
        XCTAssertFalse(timelinePage.hasMoreCards)
    }

    func testSQLiteReviewQueueAcceptsValidLeapDayDueAt() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2024-02-29T09:00:00.000Z"))

        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "valid-leap-day",
            dueAt: "2024-02-29T08:59:00.000Z",
            createdAt: "2024-02-29T08:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "invalid-calendar-day",
            dueAt: "2024-02-30T08:59:00.000Z",
            createdAt: "2024-02-29T09:00:00.000Z"
        )

        let reviewHead = try database.loadReviewHead(
            workspaceId: workspace.workspaceId,
            resolvedReviewFilter: .allCards,
            reviewQueryDefinition: .allCards,
            now: now,
            limit: 10
        )
        let timelinePage = try database.loadReviewTimelinePage(
            workspaceId: workspace.workspaceId,
            reviewQueryDefinition: .allCards,
            now: now,
            limit: 10,
            offset: 0
        )

        XCTAssertEqual(reviewHead.seedReviewQueue.map(\.cardId), ["valid-leap-day"])
        XCTAssertFalse(reviewHead.hasMoreCards)
        XCTAssertEqual(timelinePage.cards.map(\.cardId), ["valid-leap-day", "invalid-calendar-day"])
        XCTAssertFalse(timelinePage.hasMoreCards)
    }

    func testSQLiteReviewQueueAndTimelineOrderEquivalentDueTimesByCreatedAtAscending() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))

        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "same-due-older",
            dueAt: "2026-03-09T08:30:00.000Z",
            createdAt: "2026-03-09T07:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "same-due-newer",
            dueAt: "2026-03-09T08:30:00Z",
            createdAt: "2026-03-09T08:00:00.000Z"
        )

        let reviewHead = try database.loadReviewHead(
            workspaceId: workspace.workspaceId,
            resolvedReviewFilter: .allCards,
            reviewQueryDefinition: .allCards,
            now: now,
            limit: 10
        )
        let timelinePage = try database.loadReviewTimelinePage(
            workspaceId: workspace.workspaceId,
            reviewQueryDefinition: .allCards,
            now: now,
            limit: 10,
            offset: 0
        )

        XCTAssertEqual(reviewHead.seedReviewQueue.map(\.cardId), ["same-due-older", "same-due-newer"])
        XCTAssertFalse(reviewHead.hasMoreCards)
        XCTAssertEqual(timelinePage.cards.map(\.cardId), ["same-due-older", "same-due-newer"])
        XCTAssertFalse(timelinePage.hasMoreCards)
    }

    func testSQLiteReviewQueueAndTimelineOrderNewCardsByCreatedAtAscending() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))

        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "new-card-older",
            dueAt: nil,
            createdAt: "2026-03-09T07:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "new-card-newer",
            dueAt: nil,
            createdAt: "2026-03-09T08:00:00.000Z"
        )

        let reviewHead = try database.loadReviewHead(
            workspaceId: workspace.workspaceId,
            resolvedReviewFilter: .allCards,
            reviewQueryDefinition: .allCards,
            now: now,
            limit: 10
        )
        let timelinePage = try database.loadReviewTimelinePage(
            workspaceId: workspace.workspaceId,
            reviewQueryDefinition: .allCards,
            now: now,
            limit: 10,
            offset: 0
        )

        XCTAssertEqual(reviewHead.seedReviewQueue.map(\.cardId), ["new-card-older", "new-card-newer"])
        XCTAssertFalse(reviewHead.hasMoreCards)
        XCTAssertEqual(timelinePage.cards.map(\.cardId), ["new-card-older", "new-card-newer"])
        XCTAssertFalse(timelinePage.hasMoreCards)
    }

    func testSQLiteReviewQueueIncludesOldDueNonCanonicalBeforeLimitedCanonicalRows() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))

        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "non-canonical-old-earliest",
            dueAt: "2026-03-09T06:00:00Z",
            createdAt: "2026-03-09T08:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "canonical-old-first",
            dueAt: "2026-03-09T06:30:00.000Z",
            createdAt: "2026-03-09T08:30:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "canonical-old-second",
            dueAt: "2026-03-09T07:00:00.000Z",
            createdAt: "2026-03-09T08:45:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "canonical-old-third",
            dueAt: "2026-03-09T07:30:00.000Z",
            createdAt: "2026-03-09T09:00:00.000Z"
        )

        let reviewHead = try database.loadReviewHead(
            workspaceId: workspace.workspaceId,
            resolvedReviewFilter: .allCards,
            reviewQueryDefinition: .allCards,
            now: now,
            limit: 2
        )

        XCTAssertEqual(
            reviewHead.seedReviewQueue.map(\.cardId),
            ["non-canonical-old-earliest", "canonical-old-first"]
        )
        XCTAssertTrue(reviewHead.hasMoreCards)
    }

    func testSQLiteReviewQueueOrdersLimitedNonCanonicalOldDueByNormalizedTimestampTies() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))

        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "fraction-a-newer",
            dueAt: "2026-03-09T07:30:00.1Z",
            createdAt: "2026-03-09T07:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "fraction-b-newer",
            dueAt: "2026-03-09T07:30:00.1000Z",
            createdAt: "2026-03-09T07:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "fraction-c-older",
            dueAt: "2026-03-09T07:30:00.10000Z",
            createdAt: "2026-03-09T06:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "fraction-d-oldest",
            dueAt: "2026-03-09T07:30:00.100000Z",
            createdAt: "2026-03-09T05:00:00.000Z"
        )

        let queueRows = try database.cardStore.loadReviewQueueRows(
            workspaceId: workspace.workspaceId,
            reviewQueryDefinition: .allCards,
            now: now,
            limit: 1,
            excludedCardIds: []
        )

        XCTAssertEqual(queueRows.map(\.cardId), ["fraction-d-oldest", "fraction-c-older"])
    }

    func testSQLiteReviewCountsUseActiveQueueDueEligibility() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))

        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "recent-due",
            dueAt: "2026-03-09T08:30:00.000Z",
            createdAt: "2026-03-09T08:00:00.000Z",
            fsrsLastReviewedAt: "2026-03-09T08:30:00.000Z",
            tags: []
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "old-due",
            dueAt: "2026-03-09T07:30:00Z",
            createdAt: "2026-03-09T07:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "new-card",
            dueAt: nil,
            createdAt: "2026-03-09T10:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "future-due",
            dueAt: "2026-03-09T09:00:00.001Z",
            createdAt: "2026-03-09T11:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "malformed-due",
            dueAt: "1000",
            createdAt: "2026-03-09T12:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "invalid-calendar-day",
            dueAt: "2026-02-31T08:59:00.000Z",
            createdAt: "2026-03-09T13:00:00.000Z"
        )

        let reviewHead = try database.loadReviewHead(
            workspaceId: workspace.workspaceId,
            resolvedReviewFilter: .allCards,
            reviewQueryDefinition: .allCards,
            now: now,
            limit: 10
        )
        let reviewCounts = try database.loadReviewCounts(
            workspaceId: workspace.workspaceId,
            reviewQueryDefinition: .allCards,
            now: now
        )

        XCTAssertEqual(reviewHead.seedReviewQueue.map(\.cardId), ["recent-due", "old-due", "new-card"])
        XCTAssertFalse(reviewHead.hasMoreCards)
        XCTAssertEqual(reviewCounts, ReviewCounts(dueCount: 3, totalCount: 6))
    }

    func testSQLiteActiveDueBucketOrderUsesDueAtIndexOrder() throws {
        XCTAssertFalse(cardStoreActiveDueBucketOrderSQL.lowercased().contains("julianday"))
        XCTAssertTrue(cardStoreActiveDueBucketOrderSQL.lowercased().contains("due_at_millis"))
        XCTAssertTrue(cardStoreActiveDueBucketOrderSQL.lowercased().contains("created_at asc"))

        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let planDetails = try database.core.query(
            sql: """
            EXPLAIN QUERY PLAN
            SELECT
            \(cardStoreSelectColumnsSQL)
            FROM cards
            WHERE workspace_id = ?
                AND deleted_at IS NULL
                AND due_at_millis IS NOT NULL
                AND due_at_millis <= ?
                AND (
                    fsrs_last_reviewed_at_millis IS NULL
                    OR fsrs_last_reviewed_at_millis < ?
                    OR fsrs_last_reviewed_at_millis > ?
                )
            ORDER BY \(cardStoreActiveDueBucketOrderSQL)
            LIMIT ?
            """,
            values: [
                .text(workspace.workspaceId),
                .integer(try XCTUnwrap(parseStrictIsoTimestampEpochMillis(value: "2026-03-09T08:00:00.000Z"))),
                .integer(try XCTUnwrap(parseStrictIsoTimestampEpochMillis(value: "2026-03-09T08:00:00.000Z"))),
                .integer(try XCTUnwrap(parseStrictIsoTimestampEpochMillis(value: "2026-03-09T09:00:00.000Z"))),
                .integer(11)
            ]
        ) { statement in
            DatabaseCore.columnText(statement: statement, index: 3)
        }
        let queryPlan = planDetails.joined(separator: "\n")

        XCTAssertTrue(queryPlan.contains("idx_cards_workspace_due_millis_active"), queryPlan)
        XCTAssertFalse(queryPlan.contains("USE TEMP B-TREE"), queryPlan)
    }

    private func makeDatabase() throws -> LocalDatabase {
        let databaseURL = try self.makeDatabaseURL()
        let database = try LocalDatabase(databaseURL: databaseURL)
        self.databaseURL = databaseURL
        self.database = database
        return database
    }

    private func makeDatabaseURL() throws -> URL {
        let databaseDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString.lowercased(), isDirectory: true)
        try FileManager.default.createDirectory(
            at: databaseDirectory,
            withIntermediateDirectories: true,
            attributes: nil
        )
        return databaseDirectory.appendingPathComponent("flashcards.sqlite", isDirectory: false)
    }

    private func insertCard(
        database: LocalDatabase,
        workspaceId: String,
        cardId: String,
        dueAt: String?,
        createdAt: String
    ) throws {
        try self.insertCard(
            database: database,
            workspaceId: workspaceId,
            cardId: cardId,
            dueAt: dueAt,
            createdAt: createdAt,
            fsrsLastReviewedAt: nil,
            tags: []
        )
    }

    private func insertCard(
        database: LocalDatabase,
        workspaceId: String,
        cardId: String,
        dueAt: String?,
        createdAt: String,
        tags: [String]
    ) throws {
        try self.insertCard(
            database: database,
            workspaceId: workspaceId,
            cardId: cardId,
            dueAt: dueAt,
            createdAt: createdAt,
            fsrsLastReviewedAt: nil,
            tags: tags
        )
    }

    private func insertCard(
        database: LocalDatabase,
        workspaceId: String,
        cardId: String,
        dueAt: String?,
        createdAt: String,
        fsrsLastReviewedAt: String?,
        tags: [String]
    ) throws {
        let tagsJson = try database.core.encodeJsonString(value: tags)
        let metadataJson = try database.core.encodeJsonString(value: makeDefaultCardMetadata(createdAt: createdAt))
        try database.core.execute(
            sql: """
            INSERT INTO cards (
                card_id,
                workspace_id,
                front_text,
                back_text,
                card_type,
                metadata_json,
                tags_json,
                due_at,
                due_at_millis,
                created_at,
                reps,
                lapses,
                fsrs_card_state,
                fsrs_step_index,
                fsrs_stability,
                fsrs_difficulty,
                fsrs_last_reviewed_at,
                fsrs_last_reviewed_at_millis,
                fsrs_scheduled_days,
                client_updated_at,
                last_modified_by_replica_id,
                last_operation_id,
                updated_at,
                deleted_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'new', NULL, NULL, NULL, ?, ?, NULL, ?, 'test-replica', ?, ?, NULL)
            """,
            values: [
                .text(cardId),
                .text(workspaceId),
                .text("Front \(cardId)"),
                .text("Back \(cardId)"),
                .text(basicCardType),
                .text(metadataJson),
                .text(tagsJson),
                dueAt.map(SQLiteValue.text) ?? .null,
                dueAt.flatMap(parseStrictIsoTimestampEpochMillis).map(SQLiteValue.integer) ?? .null,
                .text(createdAt),
                fsrsLastReviewedAt.map(SQLiteValue.text) ?? .null,
                fsrsLastReviewedAt.flatMap(parseStrictIsoTimestampEpochMillis).map(SQLiteValue.integer) ?? .null,
                .text(createdAt),
                .text("operation-\(cardId)"),
                .text(createdAt)
            ]
        )
        try database.cardStore.replaceCardTagsReadModel(
            workspaceId: workspaceId,
            cardId: cardId,
            tags: tags
        )
    }
}
