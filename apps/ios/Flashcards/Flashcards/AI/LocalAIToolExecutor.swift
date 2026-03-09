import Foundation

enum AIToolExecutionError: LocalizedError {
    case unsupportedTool(String)
    case missingWorkspace
    case invalidToolInput(
        requestId: String?,
        toolName: String,
        toolCallId: String,
        expectedInputType: String,
        decoderSummary: String,
        rawInputSnippet: String
    )

    var errorDescription: String? {
        switch self {
        case .unsupportedTool(let name):
            return "Unsupported AI tool: \(name)"
        case .missingWorkspace:
            return "Workspace is unavailable"
        case .invalidToolInput(let requestId, let toolName, let toolCallId, _, _, _):
            let reference = requestId?.isEmpty == false ? requestId ?? toolCallId : toolCallId
            return [
                "AI tool input was invalid.",
                "Reference: \(reference)",
                "Stage: \(AIChatFailureStage.toolInputDecode.rawValue)",
                "Tool: \(toolName)",
            ].joined(separator: "\n")
        }
    }
}

private struct AIWorkspaceContextPayload: Encodable {
    let workspace: Workspace
    let userSettings: UserSettings
    let schedulerSettings: WorkspaceSchedulerSettings
    let cloudSettings: CloudSettings
    let homeSnapshot: HomeSnapshot
}

private struct AIOutboxEntryPayload: Encodable {
    let operationId: String
    let workspaceId: String
    let entityType: String
    let entityId: String
    let action: String
    let clientUpdatedAt: String
    let createdAt: String
    let attemptCount: Int
    let lastError: String
    let payloadSummary: String
}

private struct AISuccessPayload: Encodable {
    let ok: Bool
    let message: String
}

private struct AIBulkDeleteCardsPayload: Encodable {
    let ok: Bool
    let deletedCardIds: [String]
    let deletedCount: Int
}

private struct CreateCardToolInput: Decodable {
    let frontText: String
    let backText: String
    let tags: [String]
    let effortLevel: EffortLevel
}

private struct CreateCardsToolInput: Decodable {
    let cards: [CreateCardToolInput]
}

private struct UpdateCardToolInput: Decodable {
    let cardId: String
    let frontText: String?
    let backText: String?
    let tags: [String]?
    let effortLevel: EffortLevel?
}

private struct UpdateCardsToolInput: Decodable {
    let updates: [UpdateCardToolInput]
}

private struct DeleteCardToolInput: Decodable {
    let cardId: String
}

private struct DeleteCardsToolInput: Decodable {
    let cardIds: [String]
}

private struct CreateDeckToolInput: Decodable {
    let name: String
    let effortLevels: [EffortLevel]
    let combineWith: DeckCombineOperator
    let tagsOperator: DeckTagsOperator
    let tags: [String]
}

private struct UpdateDeckToolInput: Decodable {
    let deckId: String
    let name: String?
    let effortLevels: [EffortLevel]?
    let combineWith: DeckCombineOperator?
    let tagsOperator: DeckTagsOperator?
    let tags: [String]?
}

private struct DeleteDeckToolInput: Decodable {
    let deckId: String
}

private struct GetCardToolInput: Decodable {
    let cardId: String
}

private struct SearchCardsToolInput: Decodable {
    let query: String
    let limit: Int?
}

private struct ListCardsToolInput: Decodable {
    let limit: Int?
}

private struct ListDueCardsToolInput: Decodable {
    let limit: Int?
}

private struct GetDeckToolInput: Decodable {
    let deckId: String
}

private struct ListReviewHistoryToolInput: Decodable {
    let limit: Int?
    let cardId: String?
}

private struct ListOutboxToolInput: Decodable {
    let limit: Int?
}

private struct SubmitReviewToolInput: Decodable {
    let cardId: String
    let rating: AIReviewRating
}

private struct UpdateSchedulerSettingsToolInput: Decodable {
    let desiredRetention: Double
    let learningStepsMinutes: [Int]
    let relearningStepsMinutes: [Int]
    let maximumIntervalDays: Int
    let enableFuzz: Bool
}

private enum AIReviewRating: String, Decodable {
    case again
    case hard
    case good
    case easy

    var reviewRating: ReviewRating {
        switch self {
        case .again:
            return .again
        case .hard:
            return .hard
        case .good:
            return .good
        case .easy:
            return .easy
        }
    }
}

@MainActor
struct LocalAIToolExecutor: AIToolExecuting {
    private let flashcardsStore: FlashcardsStore
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    init(flashcardsStore: FlashcardsStore, encoder: JSONEncoder, decoder: JSONDecoder) {
        self.flashcardsStore = flashcardsStore
        self.encoder = encoder
        self.decoder = decoder
    }

    func execute(toolCallRequest: AIToolCallRequest, requestId: String?) async throws -> String {
        switch toolCallRequest.name {
        case "get_workspace_context":
            return try self.encodeJSON(value: try self.makeWorkspaceContextPayload())
        case "list_cards":
            let input = try self.decodeInput(ListCardsToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            return try self.encodeJSON(value: Array(self.currentActiveCards().prefix(self.normalizeLimit(input.limit))))
        case "get_card":
            let input = try self.decodeInput(GetCardToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            return try self.encodeJSON(value: try self.findCard(cardId: input.cardId))
        case "search_cards":
            let input = try self.decodeInput(SearchCardsToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            return try self.encodeJSON(value: try self.searchCards(query: input.query, limit: self.normalizeLimit(input.limit)))
        case "list_due_cards":
            let input = try self.decodeInput(ListDueCardsToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            return try self.encodeJSON(value: Array(self.dueCards().prefix(self.normalizeLimit(input.limit))))
        case "list_decks":
            return try self.encodeJSON(value: self.activeDecks())
        case "get_deck":
            let input = try self.decodeInput(GetDeckToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            return try self.encodeJSON(value: try self.findDeck(deckId: input.deckId))
        case "list_review_history":
            let input = try self.decodeInput(ListReviewHistoryToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            return try self.encodeJSON(value: try self.flashcardsStore.loadAIReviewHistory(limit: self.normalizeLimit(input.limit), cardId: input.cardId))
        case "get_scheduler_settings":
            guard let schedulerSettings = self.flashcardsStore.schedulerSettings else {
                throw AIToolExecutionError.missingWorkspace
            }
            return try self.encodeJSON(value: schedulerSettings)
        case "get_cloud_settings":
            guard let cloudSettings = self.flashcardsStore.cloudSettings else {
                throw AIToolExecutionError.missingWorkspace
            }
            return try self.encodeJSON(value: cloudSettings)
        case "list_outbox":
            let input = try self.decodeInput(ListOutboxToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            return try self.encodeJSON(value: try self.makeOutboxPayload(limit: self.normalizeLimit(input.limit)))
        case "create_card":
            let input = try self.decodeInput(CreateCardToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            return try self.createCard(input: input)
        case "create_cards":
            let input = try self.decodeInput(CreateCardsToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            return try self.createCards(input: input)
        case "update_card":
            let input = try self.decodeInput(UpdateCardToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            return try self.updateCard(input: input)
        case "update_cards":
            let input = try self.decodeInput(UpdateCardsToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            return try self.updateCards(input: input)
        case "delete_card":
            let input = try self.decodeInput(DeleteCardToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            try self.flashcardsStore.deleteCard(cardId: input.cardId)
            return try self.encodeJSON(value: AISuccessPayload(ok: true, message: "Deleted card \(input.cardId)"))
        case "delete_cards":
            let input = try self.decodeInput(DeleteCardsToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            return try self.deleteCards(input: input)
        case "create_deck":
            let input = try self.decodeInput(CreateDeckToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            return try self.createDeck(input: input)
        case "update_deck":
            let input = try self.decodeInput(UpdateDeckToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            return try self.updateDeck(input: input)
        case "delete_deck":
            let input = try self.decodeInput(DeleteDeckToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            try self.flashcardsStore.deleteDeck(deckId: input.deckId)
            return try self.encodeJSON(value: AISuccessPayload(ok: true, message: "Deleted deck \(input.deckId)"))
        case "submit_review":
            let input = try self.decodeInput(SubmitReviewToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            try self.flashcardsStore.submitReview(cardId: input.cardId, rating: input.rating.reviewRating)
            return try self.encodeJSON(value: try self.findCard(cardId: input.cardId))
        case "update_scheduler_settings":
            let input = try self.decodeInput(UpdateSchedulerSettingsToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            try self.flashcardsStore.updateSchedulerSettings(
                desiredRetention: input.desiredRetention,
                learningStepsMinutes: input.learningStepsMinutes,
                relearningStepsMinutes: input.relearningStepsMinutes,
                maximumIntervalDays: input.maximumIntervalDays,
                enableFuzz: input.enableFuzz
            )
            guard let schedulerSettings = self.flashcardsStore.schedulerSettings else {
                throw AIToolExecutionError.missingWorkspace
            }
            return try self.encodeJSON(value: schedulerSettings)
        default:
            throw AIToolExecutionError.unsupportedTool(toolCallRequest.name)
        }
    }

    private func makeWorkspaceContextPayload() throws -> AIWorkspaceContextPayload {
        guard
            let workspace = self.flashcardsStore.workspace,
            let userSettings = self.flashcardsStore.userSettings,
            let schedulerSettings = self.flashcardsStore.schedulerSettings,
            let cloudSettings = self.flashcardsStore.cloudSettings
        else {
            throw AIToolExecutionError.missingWorkspace
        }

        return AIWorkspaceContextPayload(
            workspace: workspace,
            userSettings: userSettings,
            schedulerSettings: schedulerSettings,
            cloudSettings: cloudSettings,
            homeSnapshot: self.flashcardsStore.homeSnapshot
        )
    }

    private func makeOutboxPayload(limit: Int) throws -> [AIOutboxEntryPayload] {
        try self.flashcardsStore.loadAIOutboxEntries(limit: limit).map { entry in
            AIOutboxEntryPayload(
                operationId: entry.operationId,
                workspaceId: entry.workspaceId,
                entityType: entry.operation.entityType.rawValue,
                entityId: entry.operation.entityId,
                action: entry.operation.action.rawValue,
                clientUpdatedAt: entry.operation.clientUpdatedAt,
                createdAt: entry.createdAt,
                attemptCount: entry.attemptCount,
                lastError: entry.lastError,
                payloadSummary: self.describeOutboxPayload(entry.operation.payload)
            )
        }
    }

    private func createCard(input: CreateCardToolInput) throws -> String {
        let beforeIds = Set(self.flashcardsStore.cards.map { card in
            card.cardId
        })
        try self.flashcardsStore.saveCard(
            input: CardEditorInput(
                frontText: input.frontText,
                backText: input.backText,
                tags: input.tags,
                effortLevel: input.effortLevel
            ),
            editingCardId: nil
        )

        guard let createdCard = self.flashcardsStore.cards.first(where: { card in
            beforeIds.contains(card.cardId) == false
        }) else {
            throw LocalStoreError.database("Created card could not be loaded")
        }

        return try self.encodeJSON(value: createdCard)
    }

    private func createCards(input: CreateCardsToolInput) throws -> String {
        try self.validateCardBatchCount(count: input.cards.count)
        let createdCards = try self.flashcardsStore.createCards(inputs: input.cards.map { item in
            CardEditorInput(
                frontText: item.frontText,
                backText: item.backText,
                tags: item.tags,
                effortLevel: item.effortLevel
            )
        })

        return try self.encodeJSON(value: createdCards)
    }

    private func updateCard(input: UpdateCardToolInput) throws -> String {
        let existingCard = try self.findCard(cardId: input.cardId)
        try self.flashcardsStore.saveCard(
            input: CardEditorInput(
                frontText: input.frontText ?? existingCard.frontText,
                backText: input.backText ?? existingCard.backText,
                tags: input.tags ?? existingCard.tags,
                effortLevel: input.effortLevel ?? existingCard.effortLevel
            ),
            editingCardId: input.cardId
        )

        return try self.encodeJSON(value: try self.findCard(cardId: input.cardId))
    }

    private func updateCards(input: UpdateCardsToolInput) throws -> String {
        try self.validateCardBatchCount(count: input.updates.count)
        try self.validateUniqueCardIds(cardIds: input.updates.map { update in
            update.cardId
        })

        let updates = try input.updates.map { update in
            let existingCard = try self.findCard(cardId: update.cardId)
            return CardUpdateInput(
                cardId: update.cardId,
                input: CardEditorInput(
                    frontText: update.frontText ?? existingCard.frontText,
                    backText: update.backText ?? existingCard.backText,
                    tags: update.tags ?? existingCard.tags,
                    effortLevel: update.effortLevel ?? existingCard.effortLevel
                )
            )
        }
        let updatedCards = try self.flashcardsStore.updateCards(updates: updates)

        return try self.encodeJSON(value: updatedCards)
    }

    private func createDeck(input: CreateDeckToolInput) throws -> String {
        let beforeIds = Set(self.flashcardsStore.decks.map { deck in
            deck.deckId
        })
        try self.flashcardsStore.createDeck(
            input: DeckEditorInput(
                name: input.name,
                filterDefinition: buildDeckFilterDefinition(
                    effortLevels: input.effortLevels,
                    combineWith: input.combineWith,
                    tagsOperator: input.tagsOperator,
                    tags: input.tags
                )
            )
        )

        guard let createdDeck = self.flashcardsStore.decks.first(where: { deck in
            beforeIds.contains(deck.deckId) == false
        }) else {
            throw LocalStoreError.database("Created deck could not be loaded")
        }

        return try self.encodeJSON(value: createdDeck)
    }

    private func updateDeck(input: UpdateDeckToolInput) throws -> String {
        let existingDeck = try self.findDeck(deckId: input.deckId)
        let currentDeckFilterState = self.extractDeckFilterState(deck: existingDeck)

        try self.flashcardsStore.updateDeck(
            deckId: input.deckId,
            input: DeckEditorInput(
                name: input.name ?? existingDeck.name,
                filterDefinition: buildDeckFilterDefinition(
                    effortLevels: input.effortLevels ?? currentDeckFilterState.effortLevels,
                    combineWith: input.combineWith ?? currentDeckFilterState.combineWith,
                    tagsOperator: input.tagsOperator ?? currentDeckFilterState.tagsOperator,
                    tags: input.tags ?? currentDeckFilterState.tags
                )
            )
        )

        return try self.encodeJSON(value: try self.findDeck(deckId: input.deckId))
    }

    private func deleteCards(input: DeleteCardsToolInput) throws -> String {
        try self.validateCardBatchCount(count: input.cardIds.count)
        try self.validateUniqueCardIds(cardIds: input.cardIds)
        let result = try self.flashcardsStore.deleteCards(cardIds: input.cardIds)

        return try self.encodeJSON(
            value: AIBulkDeleteCardsPayload(
                ok: true,
                deletedCardIds: result.deletedCardIds,
                deletedCount: result.deletedCount
            )
        )
    }

    private func currentActiveCards() -> [Card] {
        Flashcards.activeCards(cards: self.flashcardsStore.cards)
    }

    private func activeDecks() -> [Deck] {
        self.flashcardsStore.decks.filter { deck in
            deck.deletedAt == nil
        }
    }

    private func dueCards() -> [Card] {
        sortCardsForReviewQueue(cards: self.currentActiveCards(), now: Date())
    }

    private func findCard(cardId: String) throws -> Card {
        guard let card = self.flashcardsStore.cards.first(where: { item in
            item.cardId == cardId && item.deletedAt == nil
        }) else {
            throw LocalStoreError.notFound("Card not found")
        }

        return card
    }

    private func findDeck(deckId: String) throws -> Deck {
        guard let deck = self.flashcardsStore.decks.first(where: { item in
            item.deckId == deckId && item.deletedAt == nil
        }) else {
            throw LocalStoreError.notFound("Deck not found")
        }

        return deck
    }

    private func searchCards(query: String, limit: Int) throws -> [Card] {
        let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if normalizedQuery.isEmpty {
            throw LocalStoreError.validation("query must not be empty")
        }

        return Array(self.currentActiveCards().filter { card in
            card.frontText.lowercased().contains(normalizedQuery)
                || card.backText.lowercased().contains(normalizedQuery)
                || card.tags.contains(where: { tag in
                    tag.lowercased().contains(normalizedQuery)
                })
        }.prefix(limit))
    }

    private func extractDeckFilterState(deck: Deck) -> (effortLevels: [EffortLevel], combineWith: DeckCombineOperator, tagsOperator: DeckTagsOperator, tags: [String]) {
        var effortLevels: [EffortLevel] = []
        var tagsOperator: DeckTagsOperator = .containsAny
        var tags: [String] = []

        for predicate in deck.filterDefinition.predicates {
            switch predicate {
            case .effortLevel(let values):
                effortLevels = values
            case .tags(let operatorName, let values):
                tagsOperator = operatorName
                tags = values
            }
        }

        return (
            effortLevels: effortLevels,
            combineWith: deck.filterDefinition.combineWith,
            tagsOperator: tagsOperator,
            tags: tags
        )
    }

    private func describeOutboxPayload(_ payload: SyncOperationPayload) -> String {
        switch payload {
        case .card(let cardPayload):
            return "card \(cardPayload.cardId)"
        case .deck(let deckPayload):
            return "deck \(deckPayload.deckId)"
        case .workspaceSchedulerSettings:
            return "workspace scheduler settings"
        case .reviewEvent(let reviewEventPayload):
            return "review event \(reviewEventPayload.reviewEventId)"
        }
    }

    private func normalizeLimit(_ limit: Int?) -> Int {
        guard let limit else {
            return 20
        }

        return min(max(limit, 1), 100)
    }

    private func validateCardBatchCount(count: Int) throws {
        if count < 1 {
            throw LocalStoreError.validation("Card batch must contain at least one item")
        }

        if count > 100 {
            throw LocalStoreError.validation("Card batch must contain at most 100 items")
        }
    }

    private func validateUniqueCardIds(cardIds: [String]) throws {
        let uniqueCardIds = Set(cardIds)
        if uniqueCardIds.count != cardIds.count {
            throw LocalStoreError.validation("Card batch must not contain duplicate cardId values")
        }
    }

    private func decodeInput<Input: Decodable>(
        _ type: Input.Type,
        toolCallRequest: AIToolCallRequest,
        requestId: String?
    ) throws -> Input {
        let data = Data(toolCallRequest.input.utf8)
        do {
            return try self.decoder.decode(type, from: data)
        } catch {
            let summary = aiChatDecoderSummary(error: error)
            let rawInputSnippet = aiChatTruncatedSnippet(toolCallRequest.input)
            logFlashcardsError(
                domain: "chat",
                action: "local_tool_input_decode_failed",
                metadata: [
                    "requestId": requestId ?? "-",
                    "toolName": toolCallRequest.name,
                    "toolCallId": toolCallRequest.toolCallId,
                    "expectedInputType": String(describing: type),
                    "decoderSummary": summary,
                    "rawInputSnippet": rawInputSnippet,
                ]
            )
            throw AIToolExecutionError.invalidToolInput(
                requestId: requestId,
                toolName: toolCallRequest.name,
                toolCallId: toolCallRequest.toolCallId,
                expectedInputType: String(describing: type),
                decoderSummary: summary,
                rawInputSnippet: rawInputSnippet
            )
        }
    }

    private func encodeJSON<Value: Encodable>(value: Value) throws -> String {
        let data = try self.encoder.encode(value)
        guard let json = String(data: data, encoding: .utf8) else {
            throw LocalStoreError.database("Failed to encode AI tool output")
        }

        return json
    }
}
