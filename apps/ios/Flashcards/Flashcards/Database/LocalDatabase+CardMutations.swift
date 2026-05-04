import Foundation

extension LocalDatabase {
    func saveCard(workspaceId: String, input: CardEditorInput, cardId: String?) throws -> Card {
        try self.cardStore.validateCardInput(input: input)

        return try self.core.inTransaction {
            let now = nowIsoTimestamp()
            let cloudSettings = try self.workspaceSettingsStore.loadCloudSettings()
            return try self.persistCardMutation(
                workspaceId: workspaceId,
                input: input,
                cardId: cardId,
                cloudSettings: cloudSettings,
                now: now
            )
        }
    }

    func createCards(workspaceId: String, inputs: [CardEditorInput]) throws -> [Card] {
        try self.validateCardBatchCount(count: inputs.count)
        for input in inputs {
            try self.cardStore.validateCardInput(input: input)
        }

        return try self.core.inTransaction {
            let now = nowIsoTimestamp()
            let cloudSettings = try self.workspaceSettingsStore.loadCloudSettings()
            var createdCards: [Card] = []
            createdCards.reserveCapacity(inputs.count)

            for input in inputs {
                createdCards.append(
                    try self.persistCardMutation(
                        workspaceId: workspaceId,
                        input: input,
                        cardId: nil,
                        cloudSettings: cloudSettings,
                        now: now
                    )
                )
            }

            return createdCards
        }
    }

    func deleteCard(workspaceId: String, cardId: String) throws -> Card {
        return try self.core.inTransaction {
            let now = nowIsoTimestamp()
            let cloudSettings = try self.workspaceSettingsStore.loadCloudSettings()
            return try self.persistDeletedCard(
                workspaceId: workspaceId,
                cardId: cardId,
                cloudSettings: cloudSettings,
                now: now
            )
        }
    }

    func updateCards(workspaceId: String, updates: [CardUpdateInput]) throws -> [Card] {
        try self.validateCardBatchCount(count: updates.count)
        try self.validateUniqueCardIds(cardIds: updates.map { update in
            update.cardId
        })
        for update in updates {
            try self.cardStore.validateCardInput(input: update.input)
        }

        return try self.core.inTransaction {
            let now = nowIsoTimestamp()
            let cloudSettings = try self.workspaceSettingsStore.loadCloudSettings()
            var updatedCards: [Card] = []
            updatedCards.reserveCapacity(updates.count)

            for update in updates {
                updatedCards.append(
                    try self.persistCardMutation(
                        workspaceId: workspaceId,
                        input: update.input,
                        cardId: update.cardId,
                        cloudSettings: cloudSettings,
                        now: now
                    )
                )
            }

            return updatedCards
        }
    }

    func deleteCards(workspaceId: String, cardIds: [String]) throws -> BulkDeleteCardsResult {
        try self.validateCardBatchCount(count: cardIds.count)
        try self.validateUniqueCardIds(cardIds: cardIds)

        return try self.core.inTransaction {
            let now = nowIsoTimestamp()
            let cloudSettings = try self.workspaceSettingsStore.loadCloudSettings()

            for cardId in cardIds {
                _ = try self.persistDeletedCard(
                    workspaceId: workspaceId,
                    cardId: cardId,
                    cloudSettings: cloudSettings,
                    now: now
                )
            }

            return BulkDeleteCardsResult(
                deletedCardIds: cardIds,
                deletedCount: cardIds.count
            )
        }
    }

    private func persistCardMutation(
        workspaceId: String,
        input: CardEditorInput,
        cardId: String?,
        cloudSettings: CloudSettings,
        now: String
    ) throws -> Card {
        let operationId = UUID().uuidString.lowercased()
        let isInitialCreate = cardId == nil
        // Fresh creates install the card into the review queue; text/tag edits
        // via this path don't touch FSRS fields, so the schedule is unaffected.
        // Both intents happen to coincide here but are computed independently
        // so a future change to either side stays surgical.
        let reviewScheduleImpact = cardId == nil
        let persistedCard = try self.cardStore.saveCard(
            workspaceId: workspaceId,
            input: input,
            cardId: cardId,
            installationId: cloudSettings.installationId,
            operationId: operationId,
            now: now
        )
        try self.outboxStore.enqueueCardUpsertOperation(
            workspaceId: workspaceId,
            installationId: cloudSettings.installationId,
            operationId: operationId,
            clientUpdatedAt: now,
            card: persistedCard,
            isInitialCreate: isInitialCreate,
            reviewScheduleImpact: reviewScheduleImpact
        )
        return persistedCard
    }

    private func persistDeletedCard(
        workspaceId: String,
        cardId: String,
        cloudSettings: CloudSettings,
        now: String
    ) throws -> Card {
        let operationId = UUID().uuidString.lowercased()
        let deletedCard = try self.cardStore.deleteCard(
            workspaceId: workspaceId,
            cardId: cardId,
            installationId: cloudSettings.installationId,
            operationId: operationId,
            now: now
        )
        try self.outboxStore.enqueueCardUpsertOperation(
            workspaceId: workspaceId,
            installationId: cloudSettings.installationId,
            operationId: operationId,
            clientUpdatedAt: now,
            card: deletedCard,
            isInitialCreate: false,
            reviewScheduleImpact: true
        )
        return deletedCard
    }

    func validateCardBatchCount(count: Int) throws {
        if count < 1 {
            throw LocalStoreError.validation("Card batch must contain at least one item")
        }

        if count > 100 {
            throw LocalStoreError.validation("Card batch must contain at most 100 items")
        }
    }

    func validateUniqueCardIds(cardIds: [String]) throws {
        let uniqueCardIds = Set(cardIds)
        if uniqueCardIds.count != cardIds.count {
            throw LocalStoreError.validation("Card batch must not contain duplicate cardId values")
        }
    }
}
