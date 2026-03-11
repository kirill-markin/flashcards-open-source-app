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

private struct AIBulkDeleteDecksPayload: Encodable {
    let ok: Bool
    let deletedDeckIds: [String]
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

private struct GetCardsToolInput: Decodable {
    let cardIds: [String]
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

private struct DeleteCardsToolInput: Decodable {
    let cardIds: [String]
}

private struct CreateDeckToolInput: Decodable {
    let name: String
    let effortLevels: [EffortLevel]
    let tags: [String]
}

private struct CreateDecksToolInput: Decodable {
    let decks: [CreateDeckToolInput]
}

private struct UpdateDeckToolInput: Decodable {
    let deckId: String
    let name: String?
    let effortLevels: [EffortLevel]?
    let tags: [String]?
}

private struct UpdateDecksToolInput: Decodable {
    let updates: [UpdateDeckToolInput]
}

private struct DeleteDecksToolInput: Decodable {
    let deckIds: [String]
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

private struct SearchDecksToolInput: Decodable {
    let query: String
    let limit: Int?
}

private struct GetDecksToolInput: Decodable {
    let deckIds: [String]
}

private struct ListReviewHistoryToolInput: Decodable {
    let limit: Int?
    let cardId: String?
}

private struct ListOutboxToolInput: Decodable {
    let limit: Int?
}

actor LocalAIToolExecutor: AIToolExecuting, AIChatSnapshotLoading {
    private let databaseURL: URL
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private var database: LocalDatabase?

    init(databaseURL: URL, encoder: JSONEncoder, decoder: JSONDecoder) {
        self.databaseURL = databaseURL
        self.encoder = encoder
        self.decoder = decoder
        self.database = nil
    }

    func execute(toolCallRequest: AIToolCallRequest, requestId: String?) async throws -> AIToolExecutionResult {
        switch toolCallRequest.name {
        case "get_workspace_context":
            let snapshot = try self.loadSnapshotNow()
            return AIToolExecutionResult(
                output: try self.encodeJSON(value: self.makeWorkspaceContextPayload(snapshot: snapshot)),
                didMutateAppState: false
            )
        case "list_cards":
            let input = try self.decodeInput(ListCardsToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            let snapshot = try self.loadSnapshotNow()
            return AIToolExecutionResult(
                output: try self.encodeJSON(value: Array(self.currentActiveCards(snapshot: snapshot).prefix(self.normalizeLimit(input.limit)))),
                didMutateAppState: false
            )
        case "get_cards":
            let input = try self.decodeInput(GetCardsToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            try self.validateCardBatchCount(count: input.cardIds.count)
            try self.validateUniqueCardIds(cardIds: input.cardIds)
            let snapshot = try self.loadSnapshotNow()
            return AIToolExecutionResult(
                output: try self.encodeJSON(value: try self.findCards(snapshot: snapshot, cardIds: input.cardIds)),
                didMutateAppState: false
            )
        case "search_cards":
            let input = try self.decodeInput(SearchCardsToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            let snapshot = try self.loadSnapshotNow()
            return AIToolExecutionResult(
                output: try self.encodeJSON(value: try self.searchCards(snapshot: snapshot, query: input.query, limit: self.normalizeLimit(input.limit))),
                didMutateAppState: false
            )
        case "list_due_cards":
            let input = try self.decodeInput(ListDueCardsToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            let snapshot = try self.loadSnapshotNow()
            return AIToolExecutionResult(
                output: try self.encodeJSON(value: Array(self.dueCards(snapshot: snapshot).prefix(self.normalizeLimit(input.limit)))),
                didMutateAppState: false
            )
        case "list_decks":
            let snapshot = try self.loadSnapshotNow()
            return AIToolExecutionResult(
                output: try self.encodeJSON(value: self.activeDecks(snapshot: snapshot)),
                didMutateAppState: false
            )
        case "search_decks":
            let input = try self.decodeInput(SearchDecksToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            let snapshot = try self.loadSnapshotNow()
            return AIToolExecutionResult(
                output: try self.encodeJSON(value: try self.searchDecks(snapshot: snapshot, query: input.query, limit: self.normalizeLimit(input.limit))),
                didMutateAppState: false
            )
        case "get_decks":
            let input = try self.decodeInput(GetDecksToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            try self.validateDeckBatchCount(count: input.deckIds.count)
            try self.validateUniqueDeckIds(deckIds: input.deckIds)
            let snapshot = try self.loadSnapshotNow()
            return AIToolExecutionResult(
                output: try self.encodeJSON(value: try self.findDecks(snapshot: snapshot, deckIds: input.deckIds)),
                didMutateAppState: false
            )
        case "list_review_history":
            let input = try self.decodeInput(ListReviewHistoryToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            let snapshot = try self.loadSnapshotNow()
            return AIToolExecutionResult(
                output: try self.encodeJSON(
                    value: try self.loadReviewHistory(
                        workspaceId: snapshot.workspace.workspaceId,
                        limit: self.normalizeLimit(input.limit),
                        cardId: input.cardId
                    )
                ),
                didMutateAppState: false
            )
        case "get_scheduler_settings":
            let snapshot = try self.loadSnapshotNow()
            return AIToolExecutionResult(
                output: try self.encodeJSON(value: snapshot.schedulerSettings),
                didMutateAppState: false
            )
        case "get_cloud_settings":
            let snapshot = try self.loadSnapshotNow()
            return AIToolExecutionResult(
                output: try self.encodeJSON(value: snapshot.cloudSettings),
                didMutateAppState: false
            )
        case "list_outbox":
            let input = try self.decodeInput(ListOutboxToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            let snapshot = try self.loadSnapshotNow()
            return AIToolExecutionResult(
                output: try self.encodeJSON(
                    value: try self.makeOutboxPayload(
                        workspaceId: snapshot.workspace.workspaceId,
                        limit: self.normalizeLimit(input.limit)
                    )
                ),
                didMutateAppState: false
            )
        case "create_cards":
            let input = try self.decodeInput(CreateCardsToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            try self.validateCardBatchCount(count: input.cards.count)
            let snapshot = try self.loadSnapshotNow()
            let createdCards = try self.databaseInstance().createCards(
                workspaceId: snapshot.workspace.workspaceId,
                inputs: input.cards.map { item in
                    CardEditorInput(
                        frontText: item.frontText,
                        backText: item.backText,
                        tags: item.tags,
                        effortLevel: item.effortLevel
                    )
                }
            )
            return AIToolExecutionResult(output: try self.encodeJSON(value: createdCards), didMutateAppState: true)
        case "update_cards":
            let input = try self.decodeInput(UpdateCardsToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            try self.validateCardBatchCount(count: input.updates.count)
            try self.validateUniqueCardIds(cardIds: input.updates.map(\.cardId))
            let snapshot = try self.loadSnapshotNow()
            let updates = try input.updates.map { update in
                let existingCard = try self.findCard(snapshot: snapshot, cardId: update.cardId)
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
            let updatedCards = try self.databaseInstance().updateCards(
                workspaceId: snapshot.workspace.workspaceId,
                updates: updates
            )
            return AIToolExecutionResult(output: try self.encodeJSON(value: updatedCards), didMutateAppState: true)
        case "delete_cards":
            let input = try self.decodeInput(DeleteCardsToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            try self.validateCardBatchCount(count: input.cardIds.count)
            try self.validateUniqueCardIds(cardIds: input.cardIds)
            let snapshot = try self.loadSnapshotNow()
            let result = try self.databaseInstance().deleteCards(
                workspaceId: snapshot.workspace.workspaceId,
                cardIds: input.cardIds
            )
            return AIToolExecutionResult(
                output: try self.encodeJSON(
                    value: AIBulkDeleteCardsPayload(
                        ok: true,
                        deletedCardIds: result.deletedCardIds,
                        deletedCount: result.deletedCount
                    )
                ),
                didMutateAppState: true
            )
        case "create_decks":
            let input = try self.decodeInput(CreateDecksToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            try self.validateDeckBatchCount(count: input.decks.count)
            let snapshot = try self.loadSnapshotNow()
            let createdDecks = try self.databaseInstance().createDecks(
                workspaceId: snapshot.workspace.workspaceId,
                inputs: input.decks.map { item in
                    DeckEditorInput(
                        name: item.name,
                        filterDefinition: buildDeckFilterDefinition(
                            effortLevels: item.effortLevels,
                            tags: item.tags
                        )
                    )
                }
            )
            return AIToolExecutionResult(output: try self.encodeJSON(value: createdDecks), didMutateAppState: true)
        case "update_decks":
            let input = try self.decodeInput(UpdateDecksToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            try self.validateDeckBatchCount(count: input.updates.count)
            try self.validateUniqueDeckIds(deckIds: input.updates.map(\.deckId))
            let snapshot = try self.loadSnapshotNow()
            let updates = try input.updates.map { update in
                let existingDeck = try self.findDeck(snapshot: snapshot, deckId: update.deckId)
                let deckFilterState = self.extractDeckFilterState(deck: existingDeck)
                return DeckUpdateInput(
                    deckId: update.deckId,
                    input: DeckEditorInput(
                        name: update.name ?? existingDeck.name,
                        filterDefinition: buildDeckFilterDefinition(
                            effortLevels: update.effortLevels ?? deckFilterState.effortLevels,
                            tags: update.tags ?? deckFilterState.tags
                        )
                    )
                )
            }
            let updatedDecks = try self.databaseInstance().updateDecks(
                workspaceId: snapshot.workspace.workspaceId,
                updates: updates
            )
            return AIToolExecutionResult(output: try self.encodeJSON(value: updatedDecks), didMutateAppState: true)
        case "delete_decks":
            let input = try self.decodeInput(DeleteDecksToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            try self.validateDeckBatchCount(count: input.deckIds.count)
            try self.validateUniqueDeckIds(deckIds: input.deckIds)
            let snapshot = try self.loadSnapshotNow()
            let result = try self.databaseInstance().deleteDecks(
                workspaceId: snapshot.workspace.workspaceId,
                deckIds: input.deckIds
            )
            return AIToolExecutionResult(
                output: try self.encodeJSON(
                    value: AIBulkDeleteDecksPayload(
                        ok: true,
                        deletedDeckIds: result.deletedDeckIds,
                        deletedCount: result.deletedCount
                    )
                ),
                didMutateAppState: true
            )
        default:
            throw AIToolExecutionError.unsupportedTool(toolCallRequest.name)
        }
    }

    func loadSnapshot() async throws -> AppStateSnapshot {
        try self.loadSnapshotNow()
    }

    private func databaseInstance() throws -> LocalDatabase {
        if let database = self.database {
            return database
        }

        let database = try LocalDatabase(databaseURL: self.databaseURL)
        self.database = database
        return database
    }

    private func loadSnapshotNow() throws -> AppStateSnapshot {
        try self.databaseInstance().loadStateSnapshot()
    }

    private func makeWorkspaceContextPayload(snapshot: AppStateSnapshot) -> AIWorkspaceContextPayload {
        AIWorkspaceContextPayload(
            workspace: snapshot.workspace,
            userSettings: snapshot.userSettings,
            schedulerSettings: snapshot.schedulerSettings,
            cloudSettings: snapshot.cloudSettings,
            homeSnapshot: makeHomeSnapshot(cards: snapshot.cards, deckCount: snapshot.decks.count, now: Date())
        )
    }

    private func makeOutboxPayload(workspaceId: String, limit: Int) throws -> [AIOutboxEntryPayload] {
        try self.databaseInstance().loadOutboxEntries(workspaceId: workspaceId, limit: limit).map { entry in
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

    private func loadReviewHistory(workspaceId: String, limit: Int, cardId: String?) throws -> [ReviewEvent] {
        let events = try self.databaseInstance().loadReviewEvents(workspaceId: workspaceId)
        let filteredEvents = cardId == nil
            ? events
            : events.filter { event in
                event.cardId == cardId
            }

        return Array(filteredEvents.prefix(limit))
    }

    private func currentActiveCards(snapshot: AppStateSnapshot) -> [Card] {
        activeCards(cards: snapshot.cards)
    }

    private func activeDecks(snapshot: AppStateSnapshot) -> [Deck] {
        snapshot.decks.filter { deck in
            deck.deletedAt == nil
        }
    }

    private func dueCards(snapshot: AppStateSnapshot) -> [Card] {
        sortCardsForReviewQueue(cards: self.currentActiveCards(snapshot: snapshot), now: Date())
    }

    private func findCard(snapshot: AppStateSnapshot, cardId: String) throws -> Card {
        guard let card = snapshot.cards.first(where: { item in
            item.cardId == cardId && item.deletedAt == nil
        }) else {
            throw LocalStoreError.notFound("Card not found")
        }

        return card
    }

    private func findCards(snapshot: AppStateSnapshot, cardIds: [String]) throws -> [Card] {
        try cardIds.map { cardId in
            try self.findCard(snapshot: snapshot, cardId: cardId)
        }
    }

    private func findDeck(snapshot: AppStateSnapshot, deckId: String) throws -> Deck {
        guard let deck = snapshot.decks.first(where: { item in
            item.deckId == deckId && item.deletedAt == nil
        }) else {
            throw LocalStoreError.notFound("Deck not found")
        }

        return deck
    }

    private func findDecks(snapshot: AppStateSnapshot, deckIds: [String]) throws -> [Deck] {
        try deckIds.map { deckId in
            try self.findDeck(snapshot: snapshot, deckId: deckId)
        }
    }

    private func searchCards(snapshot: AppStateSnapshot, query: String, limit: Int) throws -> [Card] {
        let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if normalizedQuery.isEmpty {
            throw LocalStoreError.validation("query must not be empty")
        }

        return Array(self.currentActiveCards(snapshot: snapshot).filter { card in
            card.frontText.lowercased().contains(normalizedQuery)
                || card.backText.lowercased().contains(normalizedQuery)
                || card.tags.contains(where: { tag in
                    tag.lowercased().contains(normalizedQuery)
                })
                || card.effortLevel.rawValue.lowercased().contains(normalizedQuery)
        }.prefix(limit))
    }

    private func searchDecks(snapshot: AppStateSnapshot, query: String, limit: Int) throws -> [Deck] {
        let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if normalizedQuery.isEmpty {
            throw LocalStoreError.validation("query must not be empty")
        }

        return Array(self.activeDecks(snapshot: snapshot).filter { deck in
            deck.name.lowercased().contains(normalizedQuery)
                || deck.filterDefinition.tags.contains(where: { tag in
                    tag.lowercased().contains(normalizedQuery)
                })
                || deck.filterDefinition.effortLevels.contains(where: { effortLevel in
                    effortLevel.rawValue.lowercased().contains(normalizedQuery)
                })
        }.prefix(limit))
    }

    private func extractDeckFilterState(deck: Deck) -> (effortLevels: [EffortLevel], tags: [String]) {
        (
            effortLevels: deck.filterDefinition.effortLevels,
            tags: deck.filterDefinition.tags
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

    private func validateDeckBatchCount(count: Int) throws {
        if count < 1 {
            throw LocalStoreError.validation("Deck batch must contain at least one item")
        }

        if count > 100 {
            throw LocalStoreError.validation("Deck batch must contain at most 100 items")
        }
    }

    private func validateUniqueDeckIds(deckIds: [String]) throws {
        let uniqueDeckIds = Set(deckIds)
        if uniqueDeckIds.count != deckIds.count {
            throw LocalStoreError.validation("Deck batch must not contain duplicate deckId values")
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

actor UnavailableAIToolExecutor: AIToolExecuting, AIChatSnapshotLoading {
    func execute(toolCallRequest: AIToolCallRequest, requestId: String?) async throws -> AIToolExecutionResult {
        throw LocalStoreError.uninitialized("Local database is unavailable")
    }

    func loadSnapshot() async throws -> AppStateSnapshot {
        throw LocalStoreError.uninitialized("Local database is unavailable")
    }
}
