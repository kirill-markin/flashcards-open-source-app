import Foundation
import XCTest
@testable import Flashcards

enum LocalDatabaseTestSupport {
    static func makeDatabase(testCase: XCTestCase) throws -> LocalDatabase {
        let (_, database) = try makeDatabaseWithURL(testCase: testCase)
        return database
    }

    static func makeDatabaseWithURL(testCase: XCTestCase) throws -> (URL, LocalDatabase) {
        let databaseDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: databaseDirectory, withIntermediateDirectories: true)
        let databaseURL = databaseDirectory.appendingPathComponent("flashcards.sqlite", isDirectory: false)
        return (databaseURL, try LocalDatabase(databaseURL: databaseURL))
    }

    static func updateStoredDeviceId(databaseURL: URL, deviceId: String) throws {
        let core = try DatabaseCore(databaseURL: databaseURL)
        _ = try core.execute(
            sql: """
            UPDATE app_local_settings
            SET device_id = ?, updated_at = ?
            WHERE settings_id = 1
            """,
            values: [
                .text(deviceId),
                .text(nowIsoTimestamp())
            ]
        )
    }

    static func makeCardInput(frontText: String, backText: String) -> CardEditorInput {
        CardEditorInput(
            frontText: frontText,
            backText: backText,
            tags: ["tag-a"],
            effortLevel: .medium
        )
    }

    static func makeDeckInput(name: String) -> DeckEditorInput {
        DeckEditorInput(
            name: name,
            filterDefinition: buildDeckFilterDefinition(
                effortLevels: [.medium],
                tags: ["tag-a"]
            )
        )
    }

    static func makeRemoteCard(
        from card: Card,
        frontText: String,
        clientUpdatedAt: String,
        deviceId: String,
        operationId: String
    ) -> Card {
        Card(
            cardId: card.cardId,
            workspaceId: card.workspaceId,
            frontText: frontText,
            backText: card.backText,
            tags: card.tags,
            effortLevel: card.effortLevel,
            dueAt: card.dueAt,
            createdAt: card.createdAt,
            reps: card.reps,
            lapses: card.lapses,
            fsrsCardState: card.fsrsCardState,
            fsrsStepIndex: card.fsrsStepIndex,
            fsrsStability: card.fsrsStability,
            fsrsDifficulty: card.fsrsDifficulty,
            fsrsLastReviewedAt: card.fsrsLastReviewedAt,
            fsrsScheduledDays: card.fsrsScheduledDays,
            clientUpdatedAt: clientUpdatedAt,
            lastModifiedByDeviceId: deviceId,
            lastOperationId: operationId,
            updatedAt: clientUpdatedAt,
            deletedAt: card.deletedAt
        )
    }

    static func makeRemoteDeck(
        from deck: Deck,
        name: String,
        clientUpdatedAt: String,
        deviceId: String,
        operationId: String
    ) -> Deck {
        Deck(
            deckId: deck.deckId,
            workspaceId: deck.workspaceId,
            name: name,
            filterDefinition: deck.filterDefinition,
            createdAt: deck.createdAt,
            clientUpdatedAt: clientUpdatedAt,
            lastModifiedByDeviceId: deviceId,
            lastOperationId: operationId,
            updatedAt: clientUpdatedAt,
            deletedAt: deck.deletedAt
        )
    }

    static func makeRemoteWorkspaceSettings(
        from settings: WorkspaceSchedulerSettings,
        desiredRetention: Double,
        clientUpdatedAt: String,
        deviceId: String,
        operationId: String
    ) -> WorkspaceSchedulerSettings {
        WorkspaceSchedulerSettings(
            algorithm: settings.algorithm,
            desiredRetention: desiredRetention,
            learningStepsMinutes: settings.learningStepsMinutes,
            relearningStepsMinutes: settings.relearningStepsMinutes,
            maximumIntervalDays: settings.maximumIntervalDays,
            enableFuzz: settings.enableFuzz,
            clientUpdatedAt: clientUpdatedAt,
            lastModifiedByDeviceId: deviceId,
            lastOperationId: operationId,
            updatedAt: clientUpdatedAt
        )
    }
}
