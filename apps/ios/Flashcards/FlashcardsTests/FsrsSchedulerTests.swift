import Foundation
import XCTest
@testable import Flashcards

/**
 FSRS parity tests for the Swift scheduler copy.

 Keep in sync with:
 - apps/backend/src/schedule.test.ts
 - tests/fsrs-full-vectors.json
 - docs/fsrs-scheduling-logic.md
 */

private struct FsrsFixture: Decodable {
    struct Settings: Decodable {
        let algorithm: String
        let desiredRetention: Double
        let learningStepsMinutes: [Int]
        let relearningStepsMinutes: [Int]
        let maximumIntervalDays: Int
        let enableFuzz: Bool
    }

    struct ReviewVector: Decodable {
        let at: String
        let rating: Int
    }

    struct Expected: Decodable {
        let dueAt: String?
        let reps: Int
        let lapses: Int
        let fsrsCardState: FsrsCardState
        let fsrsStepIndex: Int?
        let fsrsStability: Double?
        let fsrsDifficulty: Double?
        let fsrsLastReviewedAt: String?
        let fsrsScheduledDays: Int?
    }

    let name: String
    let cardId: String
    let settings: Settings
    let reviews: [ReviewVector]
    let expected: Expected
    let rebuiltExpected: Expected
}

final class FsrsSchedulerTests: XCTestCase {
    func testFullFsrsVectors() throws {
        let fixtures = try Self.loadFixtures()

        for fixture in fixtures {
            let settings = Self.makeSchedulerSettings(from: fixture.settings)
            var card = Self.makeEmptyCard(cardId: fixture.cardId)
            var lastSchedule: ReviewSchedule?

            for review in fixture.reviews {
                guard let rating = ReviewRating(rawValue: review.rating) else {
                    throw XCTSkip("Invalid rating in fixture")
                }
                guard let reviewedAt = parseIsoTimestamp(value: review.at) else {
                    throw XCTSkip("Invalid timestamp in fixture")
                }

                let nextSchedule = try computeReviewSchedule(
                    card: card,
                    settings: settings,
                    rating: rating,
                    now: reviewedAt
                )
                lastSchedule = nextSchedule
                card = Self.makeCard(from: card, schedule: nextSchedule)
            }

            Self.assertScheduleMatches(
                actual: lastSchedule.map(Self.makeExpected(from:)) ?? Self.emptyExpected(),
                expected: fixture.expected,
                message: fixture.name
            )

            let rebuiltState = try rebuildCardScheduleState(
                cardId: fixture.cardId,
                settings: settings,
                reviewEvents: try fixture.reviews.map { review in
                    guard let rating = ReviewRating(rawValue: review.rating) else {
                        throw XCTSkip("Invalid rating in fixture")
                    }
                    guard let reviewedAt = parseIsoTimestamp(value: review.at) else {
                        throw XCTSkip("Invalid timestamp in fixture")
                    }

                    return FsrsReviewHistoryEvent(
                        rating: rating,
                        reviewedAt: reviewedAt
                    )
                }
            )

            Self.assertScheduleMatches(
                actual: Self.makeExpected(from: rebuiltState),
                expected: fixture.rebuiltExpected,
                message: fixture.name + " rebuild"
            )
        }
    }

    func testWorkspaceSchedulerConfigChangesAffectOnlyFutureReviews() throws {
        let initialSettings = Self.makeSchedulerSettings(
            algorithm: "fsrs-6",
            desiredRetention: 0.9,
            learningStepsMinutes: [1, 10],
            relearningStepsMinutes: [10],
            maximumIntervalDays: 36_500,
            enableFuzz: true
        )
        let updatedSettings = Self.makeSchedulerSettings(
            algorithm: "fsrs-6",
            desiredRetention: 0.9,
            learningStepsMinutes: [1],
            relearningStepsMinutes: [10],
            maximumIntervalDays: 36_500,
            enableFuzz: true
        )
        let firstReviewAt = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-08T09:00:00.000Z"))
        let secondReviewAt = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-08T09:01:00.000Z"))
        let thirdReviewAt = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-16T09:00:00.000Z"))

        let initialSchedule = try computeReviewSchedule(
            card: Self.makeEmptyCard(cardId: "config-change-card"),
            settings: initialSettings,
            rating: .good,
            now: firstReviewAt
        )
        let persistedCard = Self.makeCard(
            from: Self.makeEmptyCard(cardId: "config-change-card"),
            schedule: initialSchedule
        )

        let secondFutureSchedule = try computeReviewSchedule(
            card: persistedCard,
            settings: updatedSettings,
            rating: .again,
            now: secondReviewAt
        )
        let thirdFutureSchedule = try computeReviewSchedule(
            card: Self.makeCard(
                from: persistedCard,
                schedule: secondFutureSchedule
            ),
            settings: updatedSettings,
            rating: .again,
            now: thirdReviewAt
        )
        let rebuiltState = try rebuildCardScheduleState(
            cardId: "config-change-card",
            settings: updatedSettings,
            reviewEvents: [
                FsrsReviewHistoryEvent(rating: .good, reviewedAt: firstReviewAt),
                FsrsReviewHistoryEvent(rating: .again, reviewedAt: secondReviewAt),
                FsrsReviewHistoryEvent(rating: .again, reviewedAt: thirdReviewAt)
            ]
        )

        XCTAssertEqual(isoTimestamp(date: thirdFutureSchedule.fsrsLastReviewedAt), isoTimestamp(date: thirdReviewAt))
        XCTAssertNotEqual(rebuiltState.dueAt.map(isoTimestamp(date:)), isoTimestamp(date: thirdFutureSchedule.dueAt))
        XCTAssertNotEqual(rebuiltState.fsrsCardState, thirdFutureSchedule.fsrsCardState)
        XCTAssertNotEqual(rebuiltState.lapses, thirdFutureSchedule.lapses)
    }

    func testUtcDayBoundariesUseUtcCalendarDays() throws {
        let schedule = try computeReviewSchedule(
            card: Self.makeScheduleState(
                cardId: "utc-boundary-card",
                reps: 1,
                lapses: 0,
                fsrsCardState: .review,
                fsrsStepIndex: nil,
                fsrsStability: 8.2956,
                fsrsDifficulty: 1,
                fsrsLastReviewedAt: "2026-03-08T23:30:00.000Z",
                fsrsScheduledDays: 8
            ),
            settings: Self.makeSchedulerSettings(
                algorithm: "fsrs-6",
                desiredRetention: 0.9,
                learningStepsMinutes: [1, 10],
                relearningStepsMinutes: [10],
                maximumIntervalDays: 36_500,
                enableFuzz: true
            ),
            rating: .good,
            now: try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T00:10:00.000Z"))
        )

        XCTAssertEqual(isoTimestamp(date: schedule.dueAt), "2026-03-22T00:10:00.000Z")
        XCTAssertEqual(schedule.reps, 2)
        XCTAssertEqual(schedule.lapses, 0)
        XCTAssertEqual(schedule.fsrsStability, 13.48506225, accuracy: 0.00000001)
        XCTAssertEqual(schedule.fsrsScheduledDays, 13)
    }

    func testSameDayHardLowersShortTermStability() throws {
        let schedule = try computeReviewSchedule(
            card: Self.makeScheduleState(
                cardId: "short-term-hard-card",
                reps: 1,
                lapses: 0,
                fsrsCardState: .learning,
                fsrsStepIndex: 1,
                fsrsStability: 2.3065,
                fsrsDifficulty: 2.11810397,
                fsrsLastReviewedAt: "2026-03-08T09:00:00.000Z",
                fsrsScheduledDays: 0
            ),
            settings: Self.makeSchedulerSettings(
                algorithm: "fsrs-6",
                desiredRetention: 0.9,
                learningStepsMinutes: [1, 10],
                relearningStepsMinutes: [10],
                maximumIntervalDays: 36_500,
                enableFuzz: true
            ),
            rating: .hard,
            now: try XCTUnwrap(parseIsoTimestamp(value: "2026-03-08T09:10:00.000Z"))
        )

        XCTAssertEqual(schedule.fsrsStability, 1.33337872, accuracy: 0.00000001)
        XCTAssertEqual(schedule.fsrsDifficulty, 4.75285849, accuracy: 0.00000001)
    }

    func testRoundTo8MatchesJavaScriptToFixedParitySentinels() {
        XCTAssertEqual(roundTo8(value: 0.123456785), 0.12345678, accuracy: 0.00000001)
        XCTAssertEqual(roundTo8(value: 0.123456775), 0.12345678, accuracy: 0.00000001)
        XCTAssertEqual(roundTo8(value: 2.968729585), 2.96872959, accuracy: 0.00000001)
        XCTAssertEqual(roundTo8(value: 149.319654585), 149.31965458, accuracy: 0.00000001)
    }

    func testReviewFailureRelearningSequenceMatchesOfficialTsFsrs523() throws {
        let settings = Self.makeSchedulerSettings(
            algorithm: "fsrs-6",
            desiredRetention: 0.9,
            learningStepsMinutes: [1, 10],
            relearningStepsMinutes: [10],
            maximumIntervalDays: 36_500,
            enableFuzz: true
        )

        let firstAgain = try computeReviewSchedule(
            card: Self.makeScheduleState(
                cardId: "official-relearning-card",
                reps: 54,
                lapses: 8,
                fsrsCardState: .review,
                fsrsStepIndex: nil,
                fsrsStability: 76.50524045,
                fsrsDifficulty: 9.7990791,
                fsrsLastReviewedAt: "2036-06-15T00:27:00.000Z",
                fsrsScheduledDays: 72
            ),
            settings: settings,
            rating: .again,
            now: try XCTUnwrap(parseIsoTimestamp(value: "2036-07-12T23:33:00.000Z"))
        )
        XCTAssertEqual(firstAgain.fsrsStability, 2.96872958, accuracy: 0.00000001)
        XCTAssertEqual(firstAgain.fsrsDifficulty, 9.91918704, accuracy: 0.00000001)

        let secondAgain = try computeReviewSchedule(
            card: Self.makeScheduleState(
                cardId: "official-relearning-card",
                reps: firstAgain.reps,
                lapses: firstAgain.lapses,
                fsrsCardState: firstAgain.fsrsCardState,
                fsrsStepIndex: firstAgain.fsrsStepIndex,
                fsrsStability: firstAgain.fsrsStability,
                fsrsDifficulty: firstAgain.fsrsDifficulty,
                fsrsLastReviewedAt: isoTimestamp(date: firstAgain.fsrsLastReviewedAt),
                fsrsScheduledDays: firstAgain.fsrsScheduledDays
            ),
            settings: settings,
            rating: .again,
            now: try XCTUnwrap(parseIsoTimestamp(value: "2036-07-18T23:55:00.000Z"))
        )
        let hardRelearning = try computeReviewSchedule(
            card: Self.makeScheduleState(
                cardId: "official-relearning-card",
                reps: secondAgain.reps,
                lapses: secondAgain.lapses,
                fsrsCardState: secondAgain.fsrsCardState,
                fsrsStepIndex: secondAgain.fsrsStepIndex,
                fsrsStability: secondAgain.fsrsStability,
                fsrsDifficulty: secondAgain.fsrsDifficulty,
                fsrsLastReviewedAt: isoTimestamp(date: secondAgain.fsrsLastReviewedAt),
                fsrsScheduledDays: secondAgain.fsrsScheduledDays
            ),
            settings: settings,
            rating: .hard,
            now: try XCTUnwrap(parseIsoTimestamp(value: "2036-07-25T18:11:00.000Z"))
        )
        let easyGraduation = try computeReviewSchedule(
            card: Self.makeScheduleState(
                cardId: "official-relearning-card",
                reps: hardRelearning.reps,
                lapses: hardRelearning.lapses,
                fsrsCardState: hardRelearning.fsrsCardState,
                fsrsStepIndex: hardRelearning.fsrsStepIndex,
                fsrsStability: hardRelearning.fsrsStability,
                fsrsDifficulty: hardRelearning.fsrsDifficulty,
                fsrsLastReviewedAt: isoTimestamp(date: hardRelearning.fsrsLastReviewedAt),
                fsrsScheduledDays: hardRelearning.fsrsScheduledDays
            ),
            settings: settings,
            rating: .easy,
            now: try XCTUnwrap(parseIsoTimestamp(value: "2036-07-27T18:37:00.000Z"))
        )
        let finalReview = try computeReviewSchedule(
            card: Self.makeScheduleState(
                cardId: "official-relearning-card",
                reps: easyGraduation.reps,
                lapses: easyGraduation.lapses,
                fsrsCardState: easyGraduation.fsrsCardState,
                fsrsStepIndex: easyGraduation.fsrsStepIndex,
                fsrsStability: easyGraduation.fsrsStability,
                fsrsDifficulty: easyGraduation.fsrsDifficulty,
                fsrsLastReviewedAt: isoTimestamp(date: easyGraduation.fsrsLastReviewedAt),
                fsrsScheduledDays: easyGraduation.fsrsScheduledDays
            ),
            settings: settings,
            rating: .easy,
            now: try XCTUnwrap(parseIsoTimestamp(value: "2036-09-03T07:47:00.000Z"))
        )

        XCTAssertEqual(isoTimestamp(date: finalReview.dueAt), "2036-09-12T07:47:00.000Z")
        XCTAssertEqual(finalReview.fsrsStability, 6.82018621, accuracy: 0.00000001)
        XCTAssertEqual(finalReview.fsrsScheduledDays, 9)
    }

    func testLearningGoodFromTheFirstShortTermStepGraduatesToReview() throws {
        let againSchedule = try computeReviewSchedule(
            card: Self.makeEmptyCard(cardId: "learning-again-good-card"),
            settings: Self.makeSchedulerSettings(
                algorithm: "fsrs-6",
                desiredRetention: 0.9,
                learningStepsMinutes: [1, 10],
                relearningStepsMinutes: [10],
                maximumIntervalDays: 36_500,
                enableFuzz: true
            ),
            rating: .again,
            now: try XCTUnwrap(parseIsoTimestamp(value: "2026-03-08T09:00:00.000Z"))
        )
        let afterAgain = try computeReviewSchedule(
            card: Self.makeScheduleState(
                cardId: "learning-again-good-card",
                reps: againSchedule.reps,
                lapses: againSchedule.lapses,
                fsrsCardState: againSchedule.fsrsCardState,
                fsrsStepIndex: againSchedule.fsrsStepIndex,
                fsrsStability: againSchedule.fsrsStability,
                fsrsDifficulty: againSchedule.fsrsDifficulty,
                fsrsLastReviewedAt: isoTimestamp(date: againSchedule.fsrsLastReviewedAt),
                fsrsScheduledDays: againSchedule.fsrsScheduledDays
            ),
            settings: Self.makeSchedulerSettings(
                algorithm: "fsrs-6",
                desiredRetention: 0.9,
                learningStepsMinutes: [1, 10],
                relearningStepsMinutes: [10],
                maximumIntervalDays: 36_500,
                enableFuzz: true
            ),
            rating: .good,
            now: try XCTUnwrap(parseIsoTimestamp(value: "2026-03-08T09:01:00.000Z"))
        )
        XCTAssertEqual(isoTimestamp(date: afterAgain.dueAt), "2026-03-09T09:01:00.000Z")
        XCTAssertEqual(afterAgain.fsrsCardState, .review)
        XCTAssertNil(afterAgain.fsrsStepIndex)
        XCTAssertEqual(afterAgain.fsrsScheduledDays, 1)

        let hardSchedule = try computeReviewSchedule(
            card: Self.makeEmptyCard(cardId: "learning-hard-good-card"),
            settings: Self.makeSchedulerSettings(
                algorithm: "fsrs-6",
                desiredRetention: 0.9,
                learningStepsMinutes: [1, 10],
                relearningStepsMinutes: [10],
                maximumIntervalDays: 36_500,
                enableFuzz: true
            ),
            rating: .hard,
            now: try XCTUnwrap(parseIsoTimestamp(value: "2026-03-08T09:00:00.000Z"))
        )
        let afterHard = try computeReviewSchedule(
            card: Self.makeScheduleState(
                cardId: "learning-hard-good-card",
                reps: hardSchedule.reps,
                lapses: hardSchedule.lapses,
                fsrsCardState: hardSchedule.fsrsCardState,
                fsrsStepIndex: hardSchedule.fsrsStepIndex,
                fsrsStability: hardSchedule.fsrsStability,
                fsrsDifficulty: hardSchedule.fsrsDifficulty,
                fsrsLastReviewedAt: isoTimestamp(date: hardSchedule.fsrsLastReviewedAt),
                fsrsScheduledDays: hardSchedule.fsrsScheduledDays
            ),
            settings: Self.makeSchedulerSettings(
                algorithm: "fsrs-6",
                desiredRetention: 0.9,
                learningStepsMinutes: [1, 10],
                relearningStepsMinutes: [10],
                maximumIntervalDays: 36_500,
                enableFuzz: true
            ),
            rating: .good,
            now: try XCTUnwrap(parseIsoTimestamp(value: "2026-03-08T09:06:00.000Z"))
        )
        XCTAssertEqual(isoTimestamp(date: afterHard.dueAt), "2026-03-09T09:06:00.000Z")
        XCTAssertEqual(afterHard.fsrsCardState, .review)
        XCTAssertNil(afterHard.fsrsStepIndex)
        XCTAssertEqual(afterHard.fsrsScheduledDays, 1)
    }

    func testBackwardsTimestampsThrowDuringDirectScheduling() throws {
        XCTAssertThrowsError(
            try computeReviewSchedule(
                card: Self.makeScheduleState(
                    cardId: "backwards-direct-card",
                    reps: 1,
                    lapses: 0,
                    fsrsCardState: .review,
                    fsrsStepIndex: nil,
                    fsrsStability: 8.2956,
                    fsrsDifficulty: 1,
                    fsrsLastReviewedAt: "2026-03-09T09:00:00.000Z",
                    fsrsScheduledDays: 8
                ),
                settings: Self.makeSchedulerSettings(
                    algorithm: "fsrs-6",
                    desiredRetention: 0.9,
                    learningStepsMinutes: [1, 10],
                    relearningStepsMinutes: [10],
                    maximumIntervalDays: 36_500,
                    enableFuzz: true
                ),
                rating: .good,
                now: try XCTUnwrap(parseIsoTimestamp(value: "2026-03-08T08:59:00.000Z"))
            )
        ) { error in
            XCTAssertEqual(
                error.localizedDescription,
                "Review timestamp moved backwards: lastReviewedAt=2026-03-09T09:00:00.000Z, now=2026-03-08T08:59:00.000Z"
            )
        }
    }

    func testBackwardsTimestampsThrowDuringRebuild() throws {
        XCTAssertThrowsError(
            try rebuildCardScheduleState(
                cardId: "backwards-rebuild-card",
                settings: Self.makeSchedulerSettings(
                    algorithm: "fsrs-6",
                    desiredRetention: 0.9,
                    learningStepsMinutes: [1, 10],
                    relearningStepsMinutes: [10],
                    maximumIntervalDays: 36_500,
                    enableFuzz: true
                ),
                reviewEvents: [
                    FsrsReviewHistoryEvent(
                        rating: .good,
                        reviewedAt: try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:10:00.000Z"))
                    ),
                    FsrsReviewHistoryEvent(
                        rating: .good,
                        reviewedAt: try XCTUnwrap(parseIsoTimestamp(value: "2026-03-08T09:00:00.000Z"))
                    )
                ]
            )
        ) { error in
            XCTAssertEqual(
                error.localizedDescription,
                "Review timestamp moved backwards: lastReviewedAt=2026-03-09T09:10:00.000Z, now=2026-03-08T09:00:00.000Z"
            )
        }
    }

    func testSameDayBackwardsTimestampsThrowDuringDirectScheduling() throws {
        XCTAssertThrowsError(
            try computeReviewSchedule(
                card: Self.makeScheduleState(
                    cardId: "same-day-backwards-direct-card",
                    reps: 1,
                    lapses: 0,
                    fsrsCardState: .review,
                    fsrsStepIndex: nil,
                    fsrsStability: 8.2956,
                    fsrsDifficulty: 1,
                    fsrsLastReviewedAt: "2026-03-08T09:10:00.000Z",
                    fsrsScheduledDays: 8
                ),
                settings: Self.makeSchedulerSettings(
                    algorithm: "fsrs-6",
                    desiredRetention: 0.9,
                    learningStepsMinutes: [1, 10],
                    relearningStepsMinutes: [10],
                    maximumIntervalDays: 36_500,
                    enableFuzz: true
                ),
                rating: .good,
                now: try XCTUnwrap(parseIsoTimestamp(value: "2026-03-08T09:00:00.000Z"))
            )
        ) { error in
            XCTAssertEqual(
                error.localizedDescription,
                "Review timestamp moved backwards: lastReviewedAt=2026-03-08T09:10:00.000Z, now=2026-03-08T09:00:00.000Z"
            )
        }
    }

    func testSameDayBackwardsTimestampsThrowDuringRebuild() throws {
        XCTAssertThrowsError(
            try rebuildCardScheduleState(
                cardId: "same-day-backwards-rebuild-card",
                settings: Self.makeSchedulerSettings(
                    algorithm: "fsrs-6",
                    desiredRetention: 0.9,
                    learningStepsMinutes: [1, 10],
                    relearningStepsMinutes: [10],
                    maximumIntervalDays: 36_500,
                    enableFuzz: true
                ),
                reviewEvents: [
                    FsrsReviewHistoryEvent(
                        rating: .good,
                        reviewedAt: try XCTUnwrap(parseIsoTimestamp(value: "2026-03-08T09:10:00.000Z"))
                    ),
                    FsrsReviewHistoryEvent(
                        rating: .good,
                        reviewedAt: try XCTUnwrap(parseIsoTimestamp(value: "2026-03-08T09:00:00.000Z"))
                    )
                ]
            )
        ) { error in
            XCTAssertEqual(
                error.localizedDescription,
                "Review timestamp moved backwards: lastReviewedAt=2026-03-08T09:10:00.000Z, now=2026-03-08T09:00:00.000Z"
            )
        }
    }

    func testAgainUpdatesRepsAndLapsesWithOfficialSemantics() throws {
        let settings = Self.makeSchedulerSettings(
            algorithm: "fsrs-6",
            desiredRetention: 0.9,
            learningStepsMinutes: [1, 10],
            relearningStepsMinutes: [10],
            maximumIntervalDays: 36_500,
            enableFuzz: true
        )

        let newAgain = try computeReviewSchedule(
            card: Self.makeEmptyCard(cardId: "counter-new-card"),
            settings: settings,
            rating: .again,
            now: try XCTUnwrap(parseIsoTimestamp(value: "2026-03-08T09:00:00.000Z"))
        )
        XCTAssertEqual(newAgain.reps, 1)
        XCTAssertEqual(newAgain.lapses, 0)

        let learningAgain = try computeReviewSchedule(
            card: Self.makeScheduleState(
                cardId: "counter-learning-card",
                reps: newAgain.reps,
                lapses: newAgain.lapses,
                fsrsCardState: newAgain.fsrsCardState,
                fsrsStepIndex: newAgain.fsrsStepIndex,
                fsrsStability: newAgain.fsrsStability,
                fsrsDifficulty: newAgain.fsrsDifficulty,
                fsrsLastReviewedAt: isoTimestamp(date: newAgain.fsrsLastReviewedAt),
                fsrsScheduledDays: newAgain.fsrsScheduledDays
            ),
            settings: settings,
            rating: .again,
            now: try XCTUnwrap(parseIsoTimestamp(value: "2026-03-08T09:01:00.000Z"))
        )
        XCTAssertEqual(learningAgain.reps, 2)
        XCTAssertEqual(learningAgain.lapses, 0)

        let reviewAgain = try computeReviewSchedule(
            card: Self.makeScheduleState(
                cardId: "counter-review-card",
                reps: 1,
                lapses: 0,
                fsrsCardState: .review,
                fsrsStepIndex: nil,
                fsrsStability: 8.2956,
                fsrsDifficulty: 1,
                fsrsLastReviewedAt: "2026-03-08T09:00:00.000Z",
                fsrsScheduledDays: 8
            ),
            settings: settings,
            rating: .again,
            now: try XCTUnwrap(parseIsoTimestamp(value: "2026-03-16T09:00:00.000Z"))
        )
        XCTAssertEqual(reviewAgain.reps, 2)
        XCTAssertEqual(reviewAgain.lapses, 1)
    }

    func testFirstAgainMarksCardAsReviewedForDerivedViews() throws {
        let schedule = try computeReviewSchedule(
            card: Self.makeEmptyCard(cardId: "derived-review-card"),
            settings: Self.makeSchedulerSettings(
                algorithm: "fsrs-6",
                desiredRetention: 0.9,
                learningStepsMinutes: [1, 10],
                relearningStepsMinutes: [10],
                maximumIntervalDays: 36_500,
                enableFuzz: true
            ),
            rating: .again,
            now: try XCTUnwrap(parseIsoTimestamp(value: "2026-03-08T09:00:00.000Z"))
        )
        let persistedCard = Self.makeCard(
            from: Self.makeEmptyCard(cardId: "derived-review-card"),
            schedule: schedule
        )

        XCTAssertFalse(isCardNew(card: persistedCard))
        XCTAssertTrue(isCardReviewed(card: persistedCard))
    }

    func testInvalidFsrsStateReasonRejectsBrokenCards() {
        XCTAssertEqual(
            invalidFsrsStateReason(
                card: Card(
                    cardId: "broken-new",
                    workspaceId: "workspace",
                    frontText: "",
                    backText: "",
                    tags: [],
                    effortLevel: .fast,
                    dueAt: nil,
                    reps: 0,
                    lapses: 0,
                    fsrsCardState: .new,
                    fsrsStepIndex: 0,
                    fsrsStability: 0.212,
                    fsrsDifficulty: 6.4133,
                    fsrsLastReviewedAt: "2026-03-08T09:00:00.000Z",
                    fsrsScheduledDays: 0,
                    clientUpdatedAt: "2026-03-08T09:00:00.000Z",
                    lastModifiedByDeviceId: "device",
                    lastOperationId: "operation",
                    updatedAt: "2026-03-08T09:00:00.000Z",
                    deletedAt: nil
                )
            ),
            "New card has persisted FSRS state"
        )
        XCTAssertEqual(
            invalidFsrsStateReason(
                card: Card(
                    cardId: "broken-review",
                    workspaceId: "workspace",
                    frontText: "",
                    backText: "",
                    tags: [],
                    effortLevel: .fast,
                    dueAt: "2026-03-16T09:00:00.000Z",
                    reps: 1,
                    lapses: 0,
                    fsrsCardState: .review,
                    fsrsStepIndex: nil,
                    fsrsStability: nil,
                    fsrsDifficulty: 1,
                    fsrsLastReviewedAt: "2026-03-08T09:00:00.000Z",
                    fsrsScheduledDays: 8,
                    clientUpdatedAt: "2026-03-08T09:00:00.000Z",
                    lastModifiedByDeviceId: "device",
                    lastOperationId: "operation",
                    updatedAt: "2026-03-08T09:00:00.000Z",
                    deletedAt: nil
                )
            ),
            "Persisted FSRS card state is incomplete"
        )
        XCTAssertEqual(
            invalidFsrsStateReason(
                card: Card(
                    cardId: "broken-learning",
                    workspaceId: "workspace",
                    frontText: "",
                    backText: "",
                    tags: [],
                    effortLevel: .fast,
                    dueAt: "2026-03-08T09:10:00.000Z",
                    reps: 1,
                    lapses: 0,
                    fsrsCardState: .learning,
                    fsrsStepIndex: nil,
                    fsrsStability: 2.3065,
                    fsrsDifficulty: 2.11810397,
                    fsrsLastReviewedAt: "2026-03-08T09:00:00.000Z",
                    fsrsScheduledDays: 0,
                    clientUpdatedAt: "2026-03-08T09:00:00.000Z",
                    lastModifiedByDeviceId: "device",
                    lastOperationId: "operation",
                    updatedAt: "2026-03-08T09:00:00.000Z",
                    deletedAt: nil
                )
            ),
            "Learning or relearning card is missing fsrsStepIndex"
        )
    }

    func testResetFsrsStateReturnsCanonicalNewCard() {
        let repairedCard = resetFsrsState(
            card: Card(
                cardId: "broken-card",
                workspaceId: "workspace",
                frontText: "front",
                backText: "back",
                tags: ["tag"],
                effortLevel: .fast,
                dueAt: "2026-03-16T09:00:00.000Z",
                reps: 1,
                lapses: 0,
                fsrsCardState: .review,
                fsrsStepIndex: 0,
                fsrsStability: 8.2956,
                fsrsDifficulty: 1,
                fsrsLastReviewedAt: "2026-03-08T09:00:00.000Z",
                fsrsScheduledDays: 8,
                clientUpdatedAt: "2026-03-08T09:00:00.000Z",
                lastModifiedByDeviceId: "device",
                lastOperationId: "operation",
                updatedAt: "2026-03-08T09:00:00.000Z",
                deletedAt: nil
            ),
            updatedAt: "2026-03-08T09:05:00.000Z"
        )

        XCTAssertNil(repairedCard.dueAt)
        XCTAssertEqual(repairedCard.reps, 0)
        XCTAssertEqual(repairedCard.lapses, 0)
        XCTAssertEqual(repairedCard.fsrsCardState, FsrsCardState.new)
        XCTAssertNil(repairedCard.fsrsStepIndex)
        XCTAssertNil(repairedCard.fsrsStability)
        XCTAssertNil(repairedCard.fsrsDifficulty)
        XCTAssertNil(repairedCard.fsrsLastReviewedAt)
        XCTAssertNil(repairedCard.fsrsScheduledDays)
        XCTAssertEqual(repairedCard.updatedAt, "2026-03-08T09:05:00.000Z")
    }

    func testMalformedDueAtIsStillDue() {
        let card = Card(
            cardId: "malformed-due-card",
            workspaceId: "workspace",
            frontText: "",
            backText: "",
            tags: [],
            effortLevel: .fast,
            dueAt: "not-an-iso-date",
            reps: 0,
            lapses: 0,
            fsrsCardState: .new,
            fsrsStepIndex: nil,
            fsrsStability: nil,
            fsrsDifficulty: nil,
            fsrsLastReviewedAt: nil,
            fsrsScheduledDays: nil,
            clientUpdatedAt: "2026-03-08T00:00:00.000Z",
            lastModifiedByDeviceId: "device",
            lastOperationId: "operation",
            updatedAt: "",
            deletedAt: nil
        )

        XCTAssertTrue(isCardDue(card: card, now: Date()))
    }

    private static func assertScheduleMatches(
        actual: FsrsFixture.Expected,
        expected: FsrsFixture.Expected,
        message: String
    ) {
        XCTAssertEqual(actual.dueAt, expected.dueAt, message)
        XCTAssertEqual(actual.reps, expected.reps, message)
        XCTAssertEqual(actual.lapses, expected.lapses, message)
        XCTAssertEqual(actual.fsrsCardState, expected.fsrsCardState, message)
        XCTAssertEqual(actual.fsrsStepIndex, expected.fsrsStepIndex, message)
        assertEqualOptionalDouble(actual.fsrsStability, expected.fsrsStability, message: message)
        assertEqualOptionalDouble(actual.fsrsDifficulty, expected.fsrsDifficulty, message: message)
        XCTAssertEqual(actual.fsrsLastReviewedAt, expected.fsrsLastReviewedAt, message)
        XCTAssertEqual(actual.fsrsScheduledDays, expected.fsrsScheduledDays, message)
    }

    private static func assertEqualOptionalDouble(
        _ actual: Double?,
        _ expected: Double?,
        message: String
    ) {
        switch (actual, expected) {
        case let (.some(actualValue), .some(expectedValue)):
            XCTAssertEqual(actualValue, expectedValue, accuracy: 0.00000001, message)
        case (.none, .none):
            XCTAssertTrue(true, message)
        default:
            XCTFail(message)
        }
    }

    private static func fixtureURL() -> URL {
        let currentFileURL = URL(fileURLWithPath: #filePath)
        return currentFileURL
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("tests/fsrs-full-vectors.json")
    }

    private static func loadFixtures() throws -> [FsrsFixture] {
        let fixtureData = try Data(contentsOf: fixtureURL())
        return try JSONDecoder().decode([FsrsFixture].self, from: fixtureData)
    }

    private static func makeSchedulerSettings(from settings: FsrsFixture.Settings) -> WorkspaceSchedulerSettings {
        makeSchedulerSettings(
            algorithm: settings.algorithm,
            desiredRetention: settings.desiredRetention,
            learningStepsMinutes: settings.learningStepsMinutes,
            relearningStepsMinutes: settings.relearningStepsMinutes,
            maximumIntervalDays: settings.maximumIntervalDays,
            enableFuzz: settings.enableFuzz
        )
    }

    private static func makeSchedulerSettings(
        algorithm: String,
        desiredRetention: Double,
        learningStepsMinutes: [Int],
        relearningStepsMinutes: [Int],
        maximumIntervalDays: Int,
        enableFuzz: Bool
    ) -> WorkspaceSchedulerSettings {
        WorkspaceSchedulerSettings(
            algorithm: algorithm,
            desiredRetention: desiredRetention,
            learningStepsMinutes: learningStepsMinutes,
            relearningStepsMinutes: relearningStepsMinutes,
            maximumIntervalDays: maximumIntervalDays,
            enableFuzz: enableFuzz,
            clientUpdatedAt: "2026-03-08T00:00:00.000Z",
            lastModifiedByDeviceId: "device",
            lastOperationId: "operation",
            updatedAt: "2026-03-08T00:00:00.000Z"
        )
    }

    private static func makeEmptyCard(cardId: String) -> Card {
        Card(
            cardId: cardId,
            workspaceId: "test-workspace",
            frontText: "",
            backText: "",
            tags: [],
            effortLevel: .fast,
            dueAt: nil,
            reps: 0,
            lapses: 0,
            fsrsCardState: .new,
            fsrsStepIndex: nil,
            fsrsStability: nil,
            fsrsDifficulty: nil,
            fsrsLastReviewedAt: nil,
            fsrsScheduledDays: nil,
            clientUpdatedAt: "2026-03-08T00:00:00.000Z",
            lastModifiedByDeviceId: "device",
            lastOperationId: "operation",
            updatedAt: "",
            deletedAt: nil
        )
    }

    private static func makeCard(from card: Card, schedule: ReviewSchedule) -> Card {
        Card(
            cardId: card.cardId,
            workspaceId: card.workspaceId,
            frontText: card.frontText,
            backText: card.backText,
            tags: card.tags,
            effortLevel: card.effortLevel,
            dueAt: isoTimestamp(date: schedule.dueAt),
            reps: schedule.reps,
            lapses: schedule.lapses,
            fsrsCardState: schedule.fsrsCardState,
            fsrsStepIndex: schedule.fsrsStepIndex,
            fsrsStability: schedule.fsrsStability,
            fsrsDifficulty: schedule.fsrsDifficulty,
            fsrsLastReviewedAt: isoTimestamp(date: schedule.fsrsLastReviewedAt),
            fsrsScheduledDays: schedule.fsrsScheduledDays,
            clientUpdatedAt: card.clientUpdatedAt,
            lastModifiedByDeviceId: card.lastModifiedByDeviceId,
            lastOperationId: card.lastOperationId,
            updatedAt: card.updatedAt,
            deletedAt: card.deletedAt
        )
    }

    private static func makeExpected(from schedule: ReviewSchedule) -> FsrsFixture.Expected {
        FsrsFixture.Expected(
            dueAt: isoTimestamp(date: schedule.dueAt),
            reps: schedule.reps,
            lapses: schedule.lapses,
            fsrsCardState: schedule.fsrsCardState,
            fsrsStepIndex: schedule.fsrsStepIndex,
            fsrsStability: schedule.fsrsStability,
            fsrsDifficulty: schedule.fsrsDifficulty,
            fsrsLastReviewedAt: isoTimestamp(date: schedule.fsrsLastReviewedAt),
            fsrsScheduledDays: schedule.fsrsScheduledDays
        )
    }

    private static func makeExpected(from rebuiltState: RebuiltCardScheduleState) -> FsrsFixture.Expected {
        FsrsFixture.Expected(
            dueAt: rebuiltState.dueAt.map(isoTimestamp(date:)),
            reps: rebuiltState.reps,
            lapses: rebuiltState.lapses,
            fsrsCardState: rebuiltState.fsrsCardState,
            fsrsStepIndex: rebuiltState.fsrsStepIndex,
            fsrsStability: rebuiltState.fsrsStability,
            fsrsDifficulty: rebuiltState.fsrsDifficulty,
            fsrsLastReviewedAt: rebuiltState.fsrsLastReviewedAt.map(isoTimestamp(date:)),
            fsrsScheduledDays: rebuiltState.fsrsScheduledDays
        )
    }

    private static func emptyExpected() -> FsrsFixture.Expected {
        FsrsFixture.Expected(
            dueAt: nil,
            reps: 0,
            lapses: 0,
            fsrsCardState: .new,
            fsrsStepIndex: nil,
            fsrsStability: nil,
            fsrsDifficulty: nil,
            fsrsLastReviewedAt: nil,
            fsrsScheduledDays: nil
        )
    }

    private static func makeScheduleState(
        cardId: String,
        reps: Int,
        lapses: Int,
        fsrsCardState: FsrsCardState,
        fsrsStepIndex: Int?,
        fsrsStability: Double?,
        fsrsDifficulty: Double?,
        fsrsLastReviewedAt: String?,
        fsrsScheduledDays: Int?
    ) -> ReviewableCardScheduleState {
        ReviewableCardScheduleState(
            cardId: cardId,
            reps: reps,
            lapses: lapses,
            fsrsCardState: fsrsCardState,
            fsrsStepIndex: fsrsStepIndex,
            fsrsStability: fsrsStability,
            fsrsDifficulty: fsrsDifficulty,
            fsrsLastReviewedAt: fsrsLastReviewedAt.flatMap(parseIsoTimestamp),
            fsrsScheduledDays: fsrsScheduledDays
        )
    }
}
