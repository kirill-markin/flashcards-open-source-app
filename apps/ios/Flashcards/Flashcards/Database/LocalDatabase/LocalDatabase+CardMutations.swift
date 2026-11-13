import Foundation

let localCardCreateBatchLimit: Int = 5_000
private let localCardEditBatchLimit: Int = 100

struct SpreadsheetImportScope: Equatable, Sendable {
    let workspaceId: String
    let installationId: String
    let linkedUserId: String?

    init(workspaceId: String, cloudSettings: CloudSettings) {
        self.workspaceId = workspaceId
        self.installationId = cloudSettings.installationId
        self.linkedUserId = cloudSettings.linkedUserId
    }

    static func changedError() -> LocalStoreError {
        .validation(aiSettingsLocalized(
            "settings.workspace.import.anki.workspaceChanged",
            "The workspace or account changed. Go back to Library and start the import again."
        ))
    }
}

extension LocalDatabase {
    func saveCard(
        workspaceId: String,
        input: CardEditorInput,
        cardId: String?,
        mediaAssetIdsReadyForUpload: Set<String>
    ) throws -> Card {
        try self.saveCard(
            workspaceId: workspaceId,
            input: input,
            cardId: cardId,
            observedTags: nil,
            mediaAssetIdsReadyForUpload: mediaAssetIdsReadyForUpload
        )
    }

    func saveCard(
        workspaceId: String,
        input: CardEditorInput,
        cardId: String?,
        observedTags: [String]?,
        mediaAssetIdsReadyForUpload: Set<String>
    ) throws -> Card {
        try self.cardStore.validateCardInput(input: input)

        return try self.core.inTransaction {
            let reconciledInput: CardEditorInput
            if let cardId, let observedTags {
                let currentCard = try self.cardStore.loadCard(workspaceId: workspaceId, cardId: cardId)
                reconciledInput = CardEditorInput(
                    frontText: input.frontText,
                    backText: input.backText,
                    tags: reconcileDraftTags(
                        draftTags: input.tags,
                        observedTags: observedTags,
                        refreshedTags: currentCard.tags
                    )
                )
            } else {
                reconciledInput = input
            }

            let now = nowIsoTimestamp()
            let cloudSettings = try self.workspaceSettingsStore.loadCloudSettings()
            let persistedCard = try self.persistCardMutation(
                workspaceId: workspaceId,
                input: reconciledInput,
                initialMetadata: nil,
                cardId: cardId,
                cloudSettings: cloudSettings,
                now: now
            )
            try self.prepareCardMediaUploadsAfterSave(
                workspaceId: workspaceId,
                input: reconciledInput,
                mediaAssetIdsReadyForUpload: mediaAssetIdsReadyForUpload,
                createdAt: now
            )
            return persistedCard
        }
    }

    func createCards(workspaceId: String, inputs: [CardEditorInput]) throws -> [Card] {
        try self.createCards(workspaceId: workspaceId, inputs: inputs, spreadsheetImportScope: nil)
    }

    func createSpreadsheetImportCards(scope: SpreadsheetImportScope, inputs: [CardEditorInput]) throws -> Int {
        try self.createCards(workspaceId: scope.workspaceId, inputs: inputs, spreadsheetImportScope: scope).count
    }

    private func createCards(
        workspaceId: String,
        inputs: [CardEditorInput],
        spreadsheetImportScope: SpreadsheetImportScope?
    ) throws -> [Card] {
        try self.validateCardBatchCount(count: inputs.count, maximumCount: localCardCreateBatchLimit)
        for input in inputs {
            try self.cardStore.validateCardInput(input: input)
        }

        return try self.core.inTransaction {
            let now = nowIsoTimestamp()
            let cloudSettings = try self.workspaceSettingsStore.loadCloudSettings()
            if let spreadsheetImportScope {
                let activeWorkspace = try self.workspaceSettingsStore.loadWorkspace()
                guard spreadsheetImportScope == SpreadsheetImportScope(
                    workspaceId: activeWorkspace.workspaceId,
                    cloudSettings: cloudSettings
                ) else {
                    throw SpreadsheetImportScope.changedError()
                }
            }
            var createdCards: [Card] = []
            createdCards.reserveCapacity(inputs.count)

            for input in inputs {
                createdCards.append(
                    try self.persistCardMutation(
                        workspaceId: workspaceId,
                        input: input,
                        initialMetadata: nil,
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
        try self.validateCardBatchCount(count: updates.count, maximumCount: localCardEditBatchLimit)
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
                        initialMetadata: nil,
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
        try self.validateCardBatchCount(count: cardIds.count, maximumCount: localCardEditBatchLimit)
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

    func persistCardMutation(
        workspaceId: String,
        input: CardEditorInput,
        initialMetadata: CardMetadata?,
        cardId: String?,
        cloudSettings: CloudSettings,
        now: String
    ) throws -> Card {
        let operationId = UUID().uuidString.lowercased()
        let isInitialCreate = cardId == nil
        // Fresh creates install the card into the review queue; text/tag edits
        // don't touch FSRS fields. Kept as two separate locals — both happen to
        // derive from `cardId == nil` today but encode independent intents.
        let reviewScheduleImpact = cardId == nil
        let persistedCard = try self.cardStore.saveCard(
            workspaceId: workspaceId,
            input: input,
            initialMetadata: initialMetadata,
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

    private func validateCardBatchCount(count: Int, maximumCount: Int) throws {
        if count < 1 {
            throw LocalStoreError.validation("Card batch must contain at least one item")
        }

        if count > maximumCount {
            throw LocalStoreError.validation("Card batch must contain at most \(maximumCount) items")
        }
    }

    func validateUniqueCardIds(cardIds: [String]) throws {
        let uniqueCardIds = Set(cardIds)
        if uniqueCardIds.count != cardIds.count {
            throw LocalStoreError.validation("Card batch must not contain duplicate cardId values")
        }
    }

    private func prepareCardMediaUploadsAfterSave(
        workspaceId: String,
        input: CardEditorInput,
        mediaAssetIdsReadyForUpload: Set<String>,
        createdAt: String
    ) throws {
        guard mediaAssetIdsReadyForUpload.isEmpty == false else {
            return
        }

        let referencedMediaAssetIds = managedMediaAssetIdsReferencedInMarkdown(text: input.frontText)
            .union(managedMediaAssetIdsReferencedInMarkdown(text: input.backText))
            .intersection(mediaAssetIdsReadyForUpload)
        for mediaAssetId in referencedMediaAssetIds.sorted() {
            _ = try self.prepareReferencedMediaAssetUploadForSavedCard(
                workspaceId: workspaceId,
                mediaAssetId: mediaAssetId,
                createdAt: createdAt
            )
        }
    }
}
