import Foundation
import XCTest
@testable import Flashcards

enum FsrsSchedulerTestSupport {
    static func assertScheduleMatches(
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

    static func assertEqualOptionalDouble(
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

    static func makeSchedulerSettings(from settings: FsrsFixture.Settings) -> WorkspaceSchedulerSettings {
        makeSchedulerSettings(
            algorithm: settings.algorithm,
            desiredRetention: settings.desiredRetention,
            learningStepsMinutes: settings.learningStepsMinutes,
            relearningStepsMinutes: settings.relearningStepsMinutes,
            maximumIntervalDays: settings.maximumIntervalDays,
            enableFuzz: settings.enableFuzz
        )
    }

    static func makeSchedulerSettings(
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

    static func makeEmptyCard(cardId: String) -> Card {
        Card(
            cardId: cardId,
            workspaceId: "test-workspace",
            frontText: "",
            backText: "",
            tags: [],
            effortLevel: .fast,
            dueAt: nil,
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
            lastModifiedByDeviceId: "device",
            lastOperationId: "operation",
            updatedAt: "",
            deletedAt: nil
        )
    }

    static func makeTestCard(
        cardId: String,
        tags: [String],
        effortLevel: EffortLevel,
        dueAt: String?,
        updatedAt: String
    ) -> Card {
        Card(
            cardId: cardId,
            workspaceId: "test-workspace",
            frontText: "Front \(cardId)",
            backText: "Back \(cardId)",
            tags: tags,
            effortLevel: effortLevel,
            dueAt: dueAt,
            createdAt: updatedAt,
            reps: 0,
            lapses: 0,
            fsrsCardState: .new,
            fsrsStepIndex: nil,
            fsrsStability: nil,
            fsrsDifficulty: nil,
            fsrsLastReviewedAt: nil,
            fsrsScheduledDays: nil,
            clientUpdatedAt: updatedAt,
            lastModifiedByDeviceId: "device",
            lastOperationId: "operation",
            updatedAt: updatedAt,
            deletedAt: nil
        )
    }

    static func makeDeck(
        deckId: String,
        name: String,
        filterDefinition: DeckFilterDefinition
    ) -> Deck {
        Deck(
            deckId: deckId,
            workspaceId: "test-workspace",
            name: name,
            filterDefinition: filterDefinition,
            createdAt: "2026-03-08T00:00:00.000Z",
            clientUpdatedAt: "2026-03-08T00:00:00.000Z",
            lastModifiedByDeviceId: "device",
            lastOperationId: "operation",
            updatedAt: "2026-03-08T00:00:00.000Z",
            deletedAt: nil
        )
    }

    static func makeCard(from card: Card, schedule: ReviewSchedule) -> Card {
        Card(
            cardId: card.cardId,
            workspaceId: card.workspaceId,
            frontText: card.frontText,
            backText: card.backText,
            tags: card.tags,
            effortLevel: card.effortLevel,
            dueAt: isoTimestamp(date: schedule.dueAt),
            createdAt: card.createdAt,
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

    static func makeExpected(from schedule: ReviewSchedule) -> FsrsFixture.Expected {
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

    static func makeExpected(from rebuiltState: RebuiltCardScheduleState) -> FsrsFixture.Expected {
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

    static func emptyExpected() -> FsrsFixture.Expected {
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

    static func makeScheduleState(
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
