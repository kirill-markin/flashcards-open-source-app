import Foundation
import XCTest
@testable import Flashcards

final class FsrsCardStateTests: XCTestCase {
    func testFirstAgainMarksCardAsReviewedForDerivedViews() throws {
        let schedule = try computeReviewSchedule(
            card: FsrsSchedulerTestSupport.makeEmptyCard(cardId: "derived-review-card"),
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
        let persistedCard = FsrsSchedulerTestSupport.makeCard(
            from: FsrsSchedulerTestSupport.makeEmptyCard(cardId: "derived-review-card"),
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
                    createdAt: "2026-03-08T09:00:00.000Z",
                    reps: 0,
                    lapses: 0,
                    fsrsCardState: .new,
                    fsrsStepIndex: 0,
                    fsrsStability: 0.212,
                    fsrsDifficulty: 6.4133,
                    fsrsLastReviewedAt: "2026-03-08T09:00:00.000Z",
                    fsrsScheduledDays: 0,
                    clientUpdatedAt: "2026-03-08T09:00:00.000Z",
                    lastModifiedByReplicaId: "replica",
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
                    createdAt: "2026-03-08T09:00:00.000Z",
                    reps: 1,
                    lapses: 0,
                    fsrsCardState: .review,
                    fsrsStepIndex: nil,
                    fsrsStability: nil,
                    fsrsDifficulty: 1,
                    fsrsLastReviewedAt: "2026-03-08T09:00:00.000Z",
                    fsrsScheduledDays: 8,
                    clientUpdatedAt: "2026-03-08T09:00:00.000Z",
                    lastModifiedByReplicaId: "replica",
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
                    createdAt: "2026-03-08T09:00:00.000Z",
                    reps: 1,
                    lapses: 0,
                    fsrsCardState: .learning,
                    fsrsStepIndex: nil,
                    fsrsStability: 2.3065,
                    fsrsDifficulty: 2.11810397,
                    fsrsLastReviewedAt: "2026-03-08T09:00:00.000Z",
                    fsrsScheduledDays: 0,
                    clientUpdatedAt: "2026-03-08T09:00:00.000Z",
                    lastModifiedByReplicaId: "replica",
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
                createdAt: "2026-03-08T09:00:00.000Z",
                reps: 1,
                lapses: 0,
                fsrsCardState: .review,
                fsrsStepIndex: 0,
                fsrsStability: 8.2956,
                fsrsDifficulty: 1,
                fsrsLastReviewedAt: "2026-03-08T09:00:00.000Z",
                fsrsScheduledDays: 8,
                clientUpdatedAt: "2026-03-08T09:00:00.000Z",
                lastModifiedByReplicaId: "replica",
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
            createdAt: "2026-03-08T00:00:00.000Z",
            reps: 0,
            lapses: 0,
            fsrsCardState: .new,
            fsrsStepIndex: nil,
            fsrsStability: nil,
            fsrsDifficulty: nil,
            fsrsLastReviewedAt: nil,
            fsrsScheduledDays: nil,
            clientUpdatedAt: "2026-03-08T00:00:00.000Z",
            lastModifiedByReplicaId: "replica",
            lastOperationId: "operation",
            updatedAt: "",
            deletedAt: nil
        )

        XCTAssertFalse(isCardDue(card: card, now: Date()))
    }
}
