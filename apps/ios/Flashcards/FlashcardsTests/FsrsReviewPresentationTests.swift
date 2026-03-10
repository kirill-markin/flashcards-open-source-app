import Foundation
import XCTest
@testable import Flashcards

final class FsrsReviewPresentationTests: XCTestCase {
    func testMakeReviewTimelineForAllCardsReturnsActiveAndTotalCounts() throws {
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))
        let cards = [
            FsrsSchedulerTestSupport.makeTestCard(
                cardId: "active-new",
                tags: [],
                effortLevel: .fast,
                dueAt: nil,
                updatedAt: "2026-03-09T08:00:00.000Z"
            ),
            FsrsSchedulerTestSupport.makeTestCard(
                cardId: "active-due",
                tags: [],
                effortLevel: .fast,
                dueAt: "2026-03-09T08:30:00.000Z",
                updatedAt: "2026-03-09T07:00:00.000Z"
            ),
            FsrsSchedulerTestSupport.makeTestCard(
                cardId: "future",
                tags: [],
                effortLevel: .fast,
                dueAt: "2026-03-09T10:00:00.000Z",
                updatedAt: "2026-03-09T06:00:00.000Z"
            ),
            FsrsSchedulerTestSupport.makeTestCard(
                cardId: "malformed",
                tags: [],
                effortLevel: .fast,
                dueAt: "not-an-iso-date",
                updatedAt: "2026-03-09T05:00:00.000Z"
            )
        ]

        let reviewQueue = makeReviewQueue(reviewFilter: .allCards, decks: [], cards: cards, now: now)
        let reviewTimeline = makeReviewTimeline(reviewFilter: .allCards, decks: [], cards: cards, now: now)

        XCTAssertEqual(reviewQueue.count, 3)
        XCTAssertEqual(reviewTimeline.count, 4)
        XCTAssertEqual(Array(reviewTimeline.prefix(reviewQueue.count)).map(\.cardId), reviewQueue.map(\.cardId))
    }

    func testMakeReviewTimelineForDeckFilterReturnsMatchingActiveAndTotalCounts() throws {
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))
        let decks = [
            FsrsSchedulerTestSupport.makeDeck(
                deckId: "biology",
                name: "Biology",
                filterDefinition: buildDeckFilterDefinition(
                    effortLevels: [],
                    tags: ["bio"]
                )
            )
        ]
        let cards = [
            FsrsSchedulerTestSupport.makeTestCard(
                cardId: "matching-active",
                tags: ["bio"],
                effortLevel: .fast,
                dueAt: "2026-03-09T08:00:00.000Z",
                updatedAt: "2026-03-09T08:00:00.000Z"
            ),
            FsrsSchedulerTestSupport.makeTestCard(
                cardId: "matching-future",
                tags: ["bio"],
                effortLevel: .fast,
                dueAt: "2026-03-09T11:00:00.000Z",
                updatedAt: "2026-03-09T07:00:00.000Z"
            ),
            FsrsSchedulerTestSupport.makeTestCard(
                cardId: "other-active",
                tags: ["math"],
                effortLevel: .fast,
                dueAt: "2026-03-09T07:30:00.000Z",
                updatedAt: "2026-03-09T06:00:00.000Z"
            )
        ]

        let reviewQueue = makeReviewQueue(
            reviewFilter: .deck(deckId: "biology"),
            decks: decks,
            cards: cards,
            now: now
        )
        let reviewTimeline = makeReviewTimeline(
            reviewFilter: .deck(deckId: "biology"),
            decks: decks,
            cards: cards,
            now: now
        )

        XCTAssertEqual(reviewQueue.map(\.cardId), ["matching-active"])
        XCTAssertEqual(reviewTimeline.map(\.cardId), ["matching-active", "matching-future"])
    }

    func testMakeReviewTimelineAppendsFutureCardsSortedByDueAtAndUpdatedAt() throws {
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))
        let cards = [
            FsrsSchedulerTestSupport.makeTestCard(
                cardId: "current",
                tags: [],
                effortLevel: .fast,
                dueAt: "2026-03-09T08:00:00.000Z",
                updatedAt: "2026-03-09T08:30:00.000Z"
            ),
            FsrsSchedulerTestSupport.makeTestCard(
                cardId: "future-early",
                tags: [],
                effortLevel: .fast,
                dueAt: "2026-03-09T10:00:00.000Z",
                updatedAt: "2026-03-09T06:00:00.000Z"
            ),
            FsrsSchedulerTestSupport.makeTestCard(
                cardId: "future-tie-newer",
                tags: [],
                effortLevel: .fast,
                dueAt: "2026-03-09T11:00:00.000Z",
                updatedAt: "2026-03-09T08:00:00.000Z"
            ),
            FsrsSchedulerTestSupport.makeTestCard(
                cardId: "future-tie-older",
                tags: [],
                effortLevel: .fast,
                dueAt: "2026-03-09T11:00:00.000Z",
                updatedAt: "2026-03-09T07:00:00.000Z"
            )
        ]

        let reviewQueue = makeReviewQueue(reviewFilter: .allCards, decks: [], cards: cards, now: now)
        let reviewTimeline = makeReviewTimeline(reviewFilter: .allCards, decks: [], cards: cards, now: now)

        XCTAssertEqual(reviewQueue.map(\.cardId), ["current"])
        XCTAssertEqual(
            reviewTimeline.map(\.cardId),
            ["current", "future-early", "future-tie-newer", "future-tie-older"]
        )
    }

    func testInitialIncrementalVisibleCountShowsFirstPage() {
        XCTAssertEqual(initialIncrementalVisibleCount(totalCount: 120, initialCount: 50), 50)
    }

    func testNextIncrementalVisibleCountLoadsNextPage() {
        XCTAssertEqual(nextIncrementalVisibleCount(currentVisibleCount: 50, totalCount: 120, pageSize: 50), 100)
    }

    func testNextIncrementalVisibleCountDoesNotExceedTotalCount() {
        XCTAssertEqual(nextIncrementalVisibleCount(currentVisibleCount: 100, totalCount: 120, pageSize: 50), 120)
    }

    func testReviewAnswerPresentationOrderIsInvertedForDisplay() {
        XCTAssertEqual(reviewAnswerPresentationOrder, [.easy, .good, .hard, .again])
    }

    func testFormatReviewIntervalDescriptionHandlesLessThanAMinute() {
        let now = Date(timeIntervalSince1970: 1_710_000_000)
        let dueAt = now.addingTimeInterval(30)

        XCTAssertEqual(formatReviewIntervalDescription(now: now, dueAt: dueAt), "in less than a minute")
    }

    func testFormatReviewIntervalDescriptionHandlesMinutes() {
        let now = Date(timeIntervalSince1970: 1_710_000_000)
        let dueAt = now.addingTimeInterval(5 * 60)

        XCTAssertEqual(formatReviewIntervalDescription(now: now, dueAt: dueAt), "in 5 minutes")
    }

    func testFormatReviewIntervalDescriptionHandlesHours() {
        let now = Date(timeIntervalSince1970: 1_710_000_000)
        let dueAt = now.addingTimeInterval(3 * 60 * 60)

        XCTAssertEqual(formatReviewIntervalDescription(now: now, dueAt: dueAt), "in 3 hours")
    }

    func testFormatReviewIntervalDescriptionHandlesDays() {
        let now = Date(timeIntervalSince1970: 1_710_000_000)
        let dueAt = now.addingTimeInterval(4 * 86_400)

        XCTAssertEqual(formatReviewIntervalDescription(now: now, dueAt: dueAt), "in 4 days")
    }

    func testMakeReviewAnswerOptionsUsesDisplayOrderAndSchedulePreviewText() throws {
        let settings = FsrsSchedulerTestSupport.makeSchedulerSettings(
            algorithm: "fsrs-6",
            desiredRetention: 0.9,
            learningStepsMinutes: [1, 10],
            relearningStepsMinutes: [10],
            maximumIntervalDays: 36_500,
            enableFuzz: true
        )
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))
        let card = FsrsSchedulerTestSupport.makeEmptyCard(cardId: "review-answer-options-card")

        let options = try makeReviewAnswerOptions(card: card, schedulerSettings: settings, now: now)
        let expectedIntervalDescriptions = try reviewAnswerPresentationOrder.map { rating in
            let schedule = try computeReviewSchedule(
                card: card,
                settings: settings,
                rating: rating,
                now: now
            )
            return formatReviewIntervalDescription(now: now, dueAt: schedule.dueAt)
        }

        XCTAssertEqual(options.map(\.rating), reviewAnswerPresentationOrder)
        XCTAssertEqual(options.map(\.intervalDescription), expectedIntervalDescriptions)
    }
}
