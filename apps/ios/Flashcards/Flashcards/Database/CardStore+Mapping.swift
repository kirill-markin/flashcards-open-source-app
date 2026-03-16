import Foundation

extension CardStore {
    func mapCard(statement: OpaquePointer) throws -> Card {
        let tagsJson = DatabaseCore.columnText(statement: statement, index: 4)
        let tagsData = Data(tagsJson.utf8)
        let tags = try self.core.decoder.decode([String].self, from: tagsData)
        let rawEffortLevel = DatabaseCore.columnText(statement: statement, index: 5)
        guard let effortLevel = EffortLevel(rawValue: rawEffortLevel) else {
            throw LocalStoreError.database("Stored card effort level is invalid: \(rawEffortLevel)")
        }
        let rawFsrsCardState = DatabaseCore.columnText(statement: statement, index: 10)
        guard let fsrsCardState = FsrsCardState(rawValue: rawFsrsCardState) else {
            throw LocalStoreError.database("Stored FSRS card state is invalid: \(rawFsrsCardState)")
        }

        return Card(
            cardId: DatabaseCore.columnText(statement: statement, index: 0),
            workspaceId: DatabaseCore.columnText(statement: statement, index: 1),
            frontText: DatabaseCore.columnText(statement: statement, index: 2),
            backText: DatabaseCore.columnText(statement: statement, index: 3),
            tags: tags,
            effortLevel: effortLevel,
            dueAt: DatabaseCore.columnOptionalText(statement: statement, index: 6),
            createdAt: DatabaseCore.columnText(statement: statement, index: 7),
            reps: Int(DatabaseCore.columnInt64(statement: statement, index: 8)),
            lapses: Int(DatabaseCore.columnInt64(statement: statement, index: 9)),
            fsrsCardState: fsrsCardState,
            fsrsStepIndex: DatabaseCore.columnOptionalInt(statement: statement, index: 11),
            fsrsStability: DatabaseCore.columnOptionalDouble(statement: statement, index: 12),
            fsrsDifficulty: DatabaseCore.columnOptionalDouble(statement: statement, index: 13),
            fsrsLastReviewedAt: DatabaseCore.columnOptionalText(statement: statement, index: 14),
            fsrsScheduledDays: DatabaseCore.columnOptionalInt(statement: statement, index: 15),
            clientUpdatedAt: DatabaseCore.columnText(statement: statement, index: 16),
            lastModifiedByDeviceId: DatabaseCore.columnText(statement: statement, index: 17),
            lastOperationId: DatabaseCore.columnText(statement: statement, index: 18),
            updatedAt: DatabaseCore.columnText(statement: statement, index: 19),
            deletedAt: DatabaseCore.columnOptionalText(statement: statement, index: 20)
        )
    }
}
