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

struct FsrsFixture: Decodable {
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

final class FsrsSchedulerParityTests: XCTestCase {
    func testFullFsrsVectors() throws {
        let fixtures = try Self.loadFixtures()

        for fixture in fixtures {
            let settings = FsrsSchedulerTestSupport.makeSchedulerSettings(from: fixture.settings)
            var card = FsrsSchedulerTestSupport.makeEmptyCard(cardId: fixture.cardId)
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
                card = FsrsSchedulerTestSupport.makeCard(from: card, schedule: nextSchedule)
            }

            FsrsSchedulerTestSupport.assertScheduleMatches(
                actual: lastSchedule.map(FsrsSchedulerTestSupport.makeExpected(from:)) ?? FsrsSchedulerTestSupport.emptyExpected(),
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

            FsrsSchedulerTestSupport.assertScheduleMatches(
                actual: FsrsSchedulerTestSupport.makeExpected(from: rebuiltState),
                expected: fixture.rebuiltExpected,
                message: fixture.name + " rebuild"
            )
        }
    }

    func testWorkspaceSchedulerConfigChangesAffectOnlyFutureReviews() throws {
        let initialSettings = FsrsSchedulerTestSupport.makeSchedulerSettings(
            algorithm: "fsrs-6",
            desiredRetention: 0.9,
            learningStepsMinutes: [1, 10],
            relearningStepsMinutes: [10],
            maximumIntervalDays: 36_500,
            enableFuzz: true
        )
        let updatedSettings = FsrsSchedulerTestSupport.makeSchedulerSettings(
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
            card: FsrsSchedulerTestSupport.makeEmptyCard(cardId: "config-change-card"),
            settings: initialSettings,
            rating: .good,
            now: firstReviewAt
        )
        let persistedCard = FsrsSchedulerTestSupport.makeCard(
            from: FsrsSchedulerTestSupport.makeEmptyCard(cardId: "config-change-card"),
            schedule: initialSchedule
        )

        let secondFutureSchedule = try computeReviewSchedule(
            card: persistedCard,
            settings: updatedSettings,
            rating: .again,
            now: secondReviewAt
        )
        let thirdFutureSchedule = try computeReviewSchedule(
            card: FsrsSchedulerTestSupport.makeCard(
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
            card: FsrsSchedulerTestSupport.makeScheduleState(
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
            settings: FsrsSchedulerTestSupport.makeSchedulerSettings(
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
            card: FsrsSchedulerTestSupport.makeScheduleState(
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
            settings: FsrsSchedulerTestSupport.makeSchedulerSettings(
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
        let settings = FsrsSchedulerTestSupport.makeSchedulerSettings(
            algorithm: "fsrs-6",
            desiredRetention: 0.9,
            learningStepsMinutes: [1, 10],
            relearningStepsMinutes: [10],
            maximumIntervalDays: 36_500,
            enableFuzz: true
        )

        let firstAgain = try computeReviewSchedule(
            card: FsrsSchedulerTestSupport.makeScheduleState(
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
            card: FsrsSchedulerTestSupport.makeScheduleState(
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
            card: FsrsSchedulerTestSupport.makeScheduleState(
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
            card: FsrsSchedulerTestSupport.makeScheduleState(
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
            card: FsrsSchedulerTestSupport.makeScheduleState(
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
            card: FsrsSchedulerTestSupport.makeEmptyCard(cardId: "learning-again-good-card"),
            settings: FsrsSchedulerTestSupport.makeSchedulerSettings(
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
            card: FsrsSchedulerTestSupport.makeScheduleState(
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
            settings: FsrsSchedulerTestSupport.makeSchedulerSettings(
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
            card: FsrsSchedulerTestSupport.makeEmptyCard(cardId: "learning-hard-good-card"),
            settings: FsrsSchedulerTestSupport.makeSchedulerSettings(
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
            card: FsrsSchedulerTestSupport.makeScheduleState(
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
            settings: FsrsSchedulerTestSupport.makeSchedulerSettings(
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
                card: FsrsSchedulerTestSupport.makeScheduleState(
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
                settings: FsrsSchedulerTestSupport.makeSchedulerSettings(
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
                settings: FsrsSchedulerTestSupport.makeSchedulerSettings(
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
                card: FsrsSchedulerTestSupport.makeScheduleState(
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
                settings: FsrsSchedulerTestSupport.makeSchedulerSettings(
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
                settings: FsrsSchedulerTestSupport.makeSchedulerSettings(
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
        let settings = FsrsSchedulerTestSupport.makeSchedulerSettings(
            algorithm: "fsrs-6",
            desiredRetention: 0.9,
            learningStepsMinutes: [1, 10],
            relearningStepsMinutes: [10],
            maximumIntervalDays: 36_500,
            enableFuzz: true
        )

        let newAgain = try computeReviewSchedule(
            card: FsrsSchedulerTestSupport.makeEmptyCard(cardId: "counter-new-card"),
            settings: settings,
            rating: .again,
            now: try XCTUnwrap(parseIsoTimestamp(value: "2026-03-08T09:00:00.000Z"))
        )
        XCTAssertEqual(newAgain.reps, 1)
        XCTAssertEqual(newAgain.lapses, 0)

        let learningAgain = try computeReviewSchedule(
            card: FsrsSchedulerTestSupport.makeScheduleState(
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
            card: FsrsSchedulerTestSupport.makeScheduleState(
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
}

private extension FsrsSchedulerParityTests {
    static func fixtureURL() -> URL {
        let currentFileURL = URL(fileURLWithPath: #filePath)
        return currentFileURL
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("tests/fsrs-full-vectors.json")
    }

    static func loadFixtures() throws -> [FsrsFixture] {
        let fixtureData = try Data(contentsOf: fixtureURL())
        return try JSONDecoder().decode([FsrsFixture].self, from: fixtureData)
    }
}
