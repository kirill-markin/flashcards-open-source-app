import Foundation

extension LocalDatabase {
    func createDeck(workspaceId: String, input: DeckEditorInput) throws -> Deck {
        try self.deckStore.validateDeckInput(input: input)

        return try self.core.inTransaction {
            let cloudSettings = try self.workspaceSettingsStore.loadCloudSettings()
            let now = nowIsoTimestamp()
            return try self.persistDeckCreation(
                workspaceId: workspaceId,
                input: input,
                cloudSettings: cloudSettings,
                now: now
            )
        }
    }

    func createDecks(workspaceId: String, inputs: [DeckEditorInput]) throws -> [Deck] {
        try self.validateDeckBatchCount(count: inputs.count)
        for input in inputs {
            try self.deckStore.validateDeckInput(input: input)
        }

        return try self.core.inTransaction {
            let cloudSettings = try self.workspaceSettingsStore.loadCloudSettings()
            let now = nowIsoTimestamp()
            var createdDecks: [Deck] = []
            createdDecks.reserveCapacity(inputs.count)

            for input in inputs {
                createdDecks.append(
                    try self.persistDeckCreation(
                        workspaceId: workspaceId,
                        input: input,
                        cloudSettings: cloudSettings,
                        now: now
                    )
                )
            }

            return createdDecks
        }
    }

    func updateDeck(workspaceId: String, deckId: String, input: DeckEditorInput) throws -> Deck {
        try self.deckStore.validateDeckInput(input: input)

        return try self.core.inTransaction {
            let cloudSettings = try self.workspaceSettingsStore.loadCloudSettings()
            let now = nowIsoTimestamp()
            return try self.persistDeckUpdate(
                workspaceId: workspaceId,
                deckId: deckId,
                input: input,
                cloudSettings: cloudSettings,
                now: now
            )
        }
    }

    func updateDecks(workspaceId: String, updates: [DeckUpdateInput]) throws -> [Deck] {
        try self.validateDeckBatchCount(count: updates.count)
        try self.validateUniqueDeckIds(deckIds: updates.map { update in
            update.deckId
        })
        for update in updates {
            try self.deckStore.validateDeckInput(input: update.input)
        }

        return try self.core.inTransaction {
            let cloudSettings = try self.workspaceSettingsStore.loadCloudSettings()
            let now = nowIsoTimestamp()
            var updatedDecks: [Deck] = []
            updatedDecks.reserveCapacity(updates.count)

            for update in updates {
                updatedDecks.append(
                    try self.persistDeckUpdate(
                        workspaceId: workspaceId,
                        deckId: update.deckId,
                        input: update.input,
                        cloudSettings: cloudSettings,
                        now: now
                    )
                )
            }

            return updatedDecks
        }
    }

    func deleteDeck(workspaceId: String, deckId: String) throws -> Deck {
        return try self.core.inTransaction {
            let cloudSettings = try self.workspaceSettingsStore.loadCloudSettings()
            let now = nowIsoTimestamp()
            return try self.persistDeletedDeck(
                workspaceId: workspaceId,
                deckId: deckId,
                cloudSettings: cloudSettings,
                now: now
            )
        }
    }

    func deleteDecks(workspaceId: String, deckIds: [String]) throws -> BulkDeleteDecksResult {
        try self.validateDeckBatchCount(count: deckIds.count)
        try self.validateUniqueDeckIds(deckIds: deckIds)

        return try self.core.inTransaction {
            let cloudSettings = try self.workspaceSettingsStore.loadCloudSettings()
            let now = nowIsoTimestamp()

            for deckId in deckIds {
                _ = try self.persistDeletedDeck(
                    workspaceId: workspaceId,
                    deckId: deckId,
                    cloudSettings: cloudSettings,
                    now: now
                )
            }

            return BulkDeleteDecksResult(
                deletedDeckIds: deckIds,
                deletedCount: deckIds.count
            )
        }
    }

    private func persistDeckCreation(
        workspaceId: String,
        input: DeckEditorInput,
        cloudSettings: CloudSettings,
        now: String
    ) throws -> Deck {
        let operationId = UUID().uuidString.lowercased()
        let newDeck = try self.deckStore.createDeck(
            workspaceId: workspaceId,
            input: input,
            deviceId: cloudSettings.deviceId,
            operationId: operationId,
            now: now
        )
        try self.outboxStore.enqueueDeckUpsertOperation(
            workspaceId: workspaceId,
            deviceId: cloudSettings.deviceId,
            operationId: operationId,
            clientUpdatedAt: now,
            deck: newDeck
        )
        return newDeck
    }

    private func persistDeckUpdate(
        workspaceId: String,
        deckId: String,
        input: DeckEditorInput,
        cloudSettings: CloudSettings,
        now: String
    ) throws -> Deck {
        let operationId = UUID().uuidString.lowercased()
        let updatedDeck = try self.deckStore.updateDeck(
            workspaceId: workspaceId,
            deckId: deckId,
            input: input,
            deviceId: cloudSettings.deviceId,
            operationId: operationId,
            now: now
        )
        try self.outboxStore.enqueueDeckUpsertOperation(
            workspaceId: workspaceId,
            deviceId: cloudSettings.deviceId,
            operationId: operationId,
            clientUpdatedAt: now,
            deck: updatedDeck
        )
        return updatedDeck
    }

    private func persistDeletedDeck(
        workspaceId: String,
        deckId: String,
        cloudSettings: CloudSettings,
        now: String
    ) throws -> Deck {
        let operationId = UUID().uuidString.lowercased()
        let deletedDeck = try self.deckStore.deleteDeck(
            workspaceId: workspaceId,
            deckId: deckId,
            deviceId: cloudSettings.deviceId,
            operationId: operationId,
            now: now
        )
        try self.outboxStore.enqueueDeckUpsertOperation(
            workspaceId: workspaceId,
            deviceId: cloudSettings.deviceId,
            operationId: operationId,
            clientUpdatedAt: now,
            deck: deletedDeck
        )
        return deletedDeck
    }

    func validateDeckBatchCount(count: Int) throws {
        if count < 1 {
            throw LocalStoreError.validation("Deck batch must contain at least one item")
        }

        if count > 100 {
            throw LocalStoreError.validation("Deck batch must contain at most 100 items")
        }
    }

    func validateUniqueDeckIds(deckIds: [String]) throws {
        let uniqueDeckIds = Set(deckIds)
        if uniqueDeckIds.count != deckIds.count {
            throw LocalStoreError.validation("Deck batch must not contain duplicate deckId values")
        }
    }
}
