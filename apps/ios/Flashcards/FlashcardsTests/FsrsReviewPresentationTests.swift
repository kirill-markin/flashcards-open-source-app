import Foundation
import XCTest
@testable import Flashcards

final class FsrsReviewPresentationTests: XCTestCase {
    private let expectedReviewAnswerOrder: [ReviewRating] = [.again, .hard, .good, .easy]

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

        XCTAssertEqual(reviewQueue.count, 2)
        XCTAssertEqual(reviewTimeline.count, 4)
        XCTAssertEqual(Array(reviewTimeline.prefix(reviewQueue.count)).map(\.cardId), reviewQueue.map(\.cardId))
        XCTAssertEqual(reviewTimeline.map(\.cardId), ["active-due", "active-new", "future", "malformed"])
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

    func testMakeReviewTimelineForEffortFilterKeepsVirtualFilterActiveWithoutMatchingCards() throws {
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))
        let cards = [
            FsrsSchedulerTestSupport.makeTestCard(
                cardId: "fast-active",
                tags: ["grammar"],
                effortLevel: .fast,
                dueAt: "2026-03-09T08:00:00.000Z",
                updatedAt: "2026-03-09T08:30:00.000Z"
            ),
            FsrsSchedulerTestSupport.makeTestCard(
                cardId: "medium-future",
                tags: ["grammar"],
                effortLevel: .medium,
                dueAt: "2026-03-09T11:00:00.000Z",
                updatedAt: "2026-03-09T07:30:00.000Z"
            )
        ]

        let activeQueue = makeReviewQueue(
            reviewFilter: .effort(level: .fast),
            decks: [],
            cards: cards,
            now: now
        )
        let activeTimeline = makeReviewTimeline(
            reviewFilter: .effort(level: .fast),
            decks: [],
            cards: cards,
            now: now
        )
        let emptyTimeline = makeReviewTimeline(
            reviewFilter: .effort(level: .long),
            decks: [],
            cards: cards,
            now: now
        )

        XCTAssertEqual(activeQueue.map(\.cardId), ["fast-active"])
        XCTAssertEqual(activeTimeline.map(\.cardId), ["fast-active"])
        XCTAssertEqual(emptyTimeline, [])
        XCTAssertEqual(
            resolveReviewFilter(reviewFilter: .effort(level: .long), decks: [], cards: cards),
            .effort(level: .long)
        )
    }

    func testMakeReviewTimelineAppendsFutureCardsSortedByDueAtAndCreatedAtDescending() throws {
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

    func testMakeReviewQueuePlacesTimedDueAtBeforeNilDueAtAndUsesCreatedAtDescendingAsFinalTiebreaker() throws {
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))
        let cards = [
            FsrsSchedulerTestSupport.makeTestCard(
                cardId: "timed-tie-older",
                tags: [],
                effortLevel: .fast,
                dueAt: "2026-03-09T08:30:00.000Z",
                updatedAt: "2026-03-09T06:00:00.000Z"
            ),
            FsrsSchedulerTestSupport.makeTestCard(
                cardId: "timed-earlier",
                tags: [],
                effortLevel: .fast,
                dueAt: "2026-03-09T08:00:00.000Z",
                updatedAt: "2026-03-09T08:00:00.000Z"
            ),
            FsrsSchedulerTestSupport.makeTestCard(
                cardId: "timed-tie-newer",
                tags: [],
                effortLevel: .fast,
                dueAt: "2026-03-09T08:30:00.000Z",
                updatedAt: "2026-03-09T07:00:00.000Z"
            ),
            FsrsSchedulerTestSupport.makeTestCard(
                cardId: "nil-due",
                tags: [],
                effortLevel: .fast,
                dueAt: nil,
                updatedAt: "2026-03-09T05:00:00.000Z"
            )
        ]

        XCTAssertEqual(
            makeReviewQueue(reviewFilter: .allCards, decks: [], cards: cards, now: now).map(\.cardId),
            ["timed-earlier", "timed-tie-newer", "timed-tie-older", "nil-due"]
        )
    }

    func testMakeReviewQueueDoesNotTreatFutureNewCardsAsDue() throws {
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))
        let cards = [
            FsrsSchedulerTestSupport.makeTestCard(
                cardId: "future-new",
                tags: [],
                effortLevel: .fast,
                dueAt: "2026-03-09T12:00:00.000Z",
                updatedAt: "2026-03-09T08:00:00.000Z"
            ),
            FsrsSchedulerTestSupport.makeTestCard(
                cardId: "due-card",
                tags: [],
                effortLevel: .fast,
                dueAt: "2026-03-09T08:00:00.000Z",
                updatedAt: "2026-03-09T07:00:00.000Z"
            )
        ]

        XCTAssertEqual(
            makeReviewQueue(reviewFilter: .allCards, decks: [], cards: cards, now: now).map(\.cardId),
            ["due-card"]
        )
    }

    func testCurrentReviewCardUsesCanonicalQueueHead() throws {
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))
        let reviewQueue = makeReviewQueue(
            reviewFilter: .allCards,
            decks: [],
            cards: [
                FsrsSchedulerTestSupport.makeTestCard(
                    cardId: "top-queue-card",
                    tags: [],
                    effortLevel: .fast,
                    dueAt: "2026-03-09T08:00:00.000Z",
                    updatedAt: "2026-03-09T06:00:00.000Z"
                ),
                FsrsSchedulerTestSupport.makeTestCard(
                    cardId: "remotely-updated-card",
                    tags: [],
                    effortLevel: .fast,
                    dueAt: "2026-03-09T08:30:00.000Z",
                    updatedAt: "2026-03-09T08:00:00.000Z"
                )
            ],
            now: now
        )

        XCTAssertEqual(currentReviewCard(reviewQueue: reviewQueue)?.cardId, "top-queue-card")
        XCTAssertNil(currentReviewCard(reviewQueue: []))
    }

    func testNextReviewCardUsesCanonicalQueueSecondPosition() throws {
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))
        let reviewQueue = makeReviewQueue(
            reviewFilter: .allCards,
            decks: [],
            cards: [
                FsrsSchedulerTestSupport.makeTestCard(
                    cardId: "top-queue-card",
                    tags: [],
                    effortLevel: .fast,
                    dueAt: "2026-03-09T08:00:00.000Z",
                    updatedAt: "2026-03-09T06:00:00.000Z"
                ),
                FsrsSchedulerTestSupport.makeTestCard(
                    cardId: "second-queue-card",
                    tags: [],
                    effortLevel: .fast,
                    dueAt: "2026-03-09T08:30:00.000Z",
                    updatedAt: "2026-03-09T08:00:00.000Z"
                )
            ],
            now: now
        )

        XCTAssertEqual(nextReviewCard(reviewQueue: reviewQueue)?.cardId, "second-queue-card")
        XCTAssertNil(nextReviewCard(reviewQueue: Array(reviewQueue.prefix(1))))
        XCTAssertNil(nextReviewCard(reviewQueue: []))
    }

    func testReviewAnswerPresentationOrderMatchesDisplayLayout() {
        XCTAssertEqual(self.expectedReviewAnswerOrder, [.again, .hard, .good, .easy])
    }

    func testFormatReviewIntervalDescriptionHandlesLessThanAMinute() {
        let now = Date(timeIntervalSince1970: 1_710_000_000)
        let dueAt = now.addingTimeInterval(30)

        XCTAssertEqual(formatReviewIntervalText(now: now, dueAt: dueAt), "in less than a minute")
    }

    func testFormatReviewIntervalDescriptionHandlesMinutes() {
        let now = Date(timeIntervalSince1970: 1_710_000_000)
        let dueAt = now.addingTimeInterval(5 * 60)

        XCTAssertEqual(formatReviewIntervalText(now: now, dueAt: dueAt), "in 5 minutes")
    }

    func testFormatReviewIntervalDescriptionHandlesHours() {
        let now = Date(timeIntervalSince1970: 1_710_000_000)
        let dueAt = now.addingTimeInterval(3 * 60 * 60)

        XCTAssertEqual(formatReviewIntervalText(now: now, dueAt: dueAt), "in 3 hours")
    }

    func testFormatReviewIntervalDescriptionHandlesDays() {
        let now = Date(timeIntervalSince1970: 1_710_000_000)
        let dueAt = now.addingTimeInterval(4 * 86_400)

        XCTAssertEqual(formatReviewIntervalText(now: now, dueAt: dueAt), "in 4 days")
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
        let expectedIntervalDescriptions = try self.expectedReviewAnswerOrder.map { rating in
            let schedule = try computeReviewSchedule(
                card: card,
                settings: settings,
                rating: rating,
                now: now
            )
            return formatReviewIntervalText(now: now, dueAt: schedule.dueAt)
        }

        XCTAssertEqual(options.map(\.rating), self.expectedReviewAnswerOrder)
        XCTAssertEqual(options.map(\.intervalDescription), expectedIntervalDescriptions)
    }
}
