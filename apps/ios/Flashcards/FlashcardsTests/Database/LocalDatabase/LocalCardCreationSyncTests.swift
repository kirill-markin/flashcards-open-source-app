import Foundation
import XCTest
@testable import Flashcards

final class LocalCardCreationSyncTests: LocalDatabaseTestCase {
    func testLocalCardCreationProvenanceReachesPushAndBootstrap() throws {
        let database = try self.makeDatabase()
        let workspaceId = try database.workspaceSettingsStore.loadWorkspace().workspaceId
        try database.seedOnboardingDemoCardIntoEmptyWorkspace(workspaceId: workspaceId)
        let seed = try XCTUnwrap(try database.loadActiveCards(workspaceId: workspaceId).first)

        let manual = try database.saveCard(
            workspaceId: workspaceId,
            input: CardEditorInput(frontText: "Manual question", backText: "Answer", tags: []),
            cardId: nil,
            mediaAssetIdsReadyForUpload: []
        )
        let importScope = SpreadsheetImportScope(
            workspaceId: workspaceId,
            cloudSettings: try database.workspaceSettingsStore.loadCloudSettings()
        )
        let importedInput = CardEditorInput(frontText: "Imported question", backText: "Answer", tags: [])
        XCTAssertEqual(1, try database.createSpreadsheetImportCards(scope: importScope, inputs: [importedInput]))
        let imported = try XCTUnwrap(try database.loadActiveCards(workspaceId: workspaceId).first { card in
            card.frontText == importedInput.frontText
        })

        _ = try database.saveCard(
            workspaceId: workspaceId,
            input: CardEditorInput(frontText: "Edited question", backText: "Answer", tags: []),
            cardId: manual.cardId,
            mediaAssetIdsReadyForUpload: []
        )
        _ = try database.submitReview(
            workspaceId: workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: manual.cardId, rating: .good, reviewedAtClient: nowIsoTimestamp(), reviewedTimeZone: "UTC"
            )
        )

        let pushOperations = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 10)
            .map(\.operation)
            .filter { $0.entityType == .card }
        XCTAssertEqual(3, pushOperations.filter { $0.entityId == manual.cardId }.count)
        XCTAssertEqual(1, pushOperations.filter { $0.entityId == imported.cardId }.count)
        XCTAssertEqual(1, pushOperations.filter { $0.entityId == seed.cardId }.count)
        let bootstrapEntries = try database.loadHotBootstrapEntries(workspaceId: workspaceId)
            .filter { $0.entityType == .card }
        XCTAssertEqual(Set([seed.cardId, manual.cardId, imported.cardId]), Set(bootstrapEntries.map(\.entityId)))

        let encoder = JSONEncoder()
        let wireEntries = try pushOperations.map { try encoder.encode(SyncOperationEnvelope(operation: $0)) }
            + bootstrapEntries.map { try encoder.encode(SyncBootstrapEntryEnvelope(entry: $0)) }
        for data in wireEntries {
            let envelope = try JSONDecoder().decode(CardCreationWireEntry.self, from: data)
            let isSeed = envelope.entityId == seed.cardId
            XCTAssertEqual(isSeed ? nil : "user_added", envelope.payload.metadata.creationKind)
            XCTAssertEqual(isSeed, envelope.payload.metadata.onboardingDemo != nil)
        }
    }
}

private struct CardCreationWireEntry: Decodable {
    struct Payload: Decodable {
        struct Metadata: Decodable {
            let creationKind: String?
            let onboardingDemo: OnboardingDemoMetadata?
        }

        let metadata: Metadata
    }

    let entityId: String
    let payload: Payload
}
