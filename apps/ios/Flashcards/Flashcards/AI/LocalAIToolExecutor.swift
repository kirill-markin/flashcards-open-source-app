/**
 iOS-local AI tool executor.

 This file mirrors legacy local tool behavior while the backend has already
 moved to the SQL-based shared contract in:
 - `apps/backend/src/aiTools/agentSql.ts`
 - `apps/backend/src/aiTools/sqlDialect.ts`

 The mirror remains separate because iOS executes directly against local
 SQLite-backed state. The browser-local mirror lives in
 `apps/web/src/chat/localToolExecutor.ts`.
 */
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

private struct LocalCardsPagePayload: Encodable {
    let cards: [Card]
    let nextCursor: String?
}

private struct LocalDecksPagePayload: Encodable {
    let decks: [Deck]
    let nextCursor: String?
}

private struct LocalReviewHistoryPagePayload: Encodable {
    let history: [ReviewEvent]
    let nextCursor: String?
}

private struct LocalOutboxPagePayload: Encodable {
    let outbox: [AIOutboxEntryPayload]
    let nextCursor: String?
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
    let cursor: String?
    let limit: Int

    let filter: CardFilter?
}

private struct ListCardsToolInput: Decodable {
    let cursor: String?
    let limit: Int

    let filter: CardFilter?
}

private struct ListDueCardsToolInput: Decodable {
    let cursor: String?
    let limit: Int
}

private struct ListDecksToolInput: Decodable {
    let cursor: String?
    let limit: Int
}

private struct SearchDecksToolInput: Decodable {
    let query: String
    let cursor: String?
    let limit: Int
}

private struct GetDecksToolInput: Decodable {
    let deckIds: [String]
}

private struct ListReviewHistoryToolInput: Decodable {
    let cursor: String?
    let limit: Int
    let cardId: String?
}

private struct ListOutboxToolInput: Decodable {
    let cursor: String?
    let limit: Int
}

private struct LocalPageCursor: Codable {
    let index: Int
}

private struct DynamicCodingKey: CodingKey {
    let stringValue: String
    let intValue: Int?

    init?(stringValue: String) {
        self.stringValue = stringValue
        self.intValue = nil
    }

    init?(intValue: Int) {
        self.stringValue = String(intValue)
        self.intValue = intValue
    }
}

private func validateObjectKeys(
    decoder: Decoder,
    allowedKeys: Set<String>,
    context: String
) throws {
    let container = try decoder.container(keyedBy: DynamicCodingKey.self)
    for key in container.allKeys where allowedKeys.contains(key.stringValue) == false {
        throw LocalStoreError.validation("\(context).\(key.stringValue) is not supported")
    }
}

private func normalizeCardFilter(filter: CardFilter?) -> CardFilter? {
    guard let filter else {
        return nil
    }

    let normalizedFilter = CardFilter(
        tags: normalizeTags(values: filter.tags, referenceTags: []),
        effort: filter.effort.reduce(into: [EffortLevel]()) { result, effortLevel in
            if result.contains(effortLevel) {
                return
            }

            result.append(effortLevel)
        }
    )

    if normalizedFilter.tags.isEmpty && normalizedFilter.effort.isEmpty {
        return nil
    }

    return normalizedFilter
}

extension CardFilter {
    private enum CodingKeys: String, CodingKey {
        case tags
        case effort
    }

    init(from decoder: Decoder) throws {
        try validateObjectKeys(
            decoder: decoder,
            allowedKeys: Set([CodingKeys.tags.rawValue, CodingKeys.effort.rawValue]),
            context: "filter"
        )
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            tags: try container.decodeIfPresent([String].self, forKey: .tags) ?? [],
            effort: try container.decodeIfPresent([EffortLevel].self, forKey: .effort) ?? []
        )
    }
}

extension CreateCardToolInput {
    private enum CodingKeys: String, CodingKey {
        case frontText
        case backText
        case tags
        case effortLevel
    }

    init(from decoder: Decoder) throws {
        try validateObjectKeys(
            decoder: decoder,
            allowedKeys: Set([
                CodingKeys.frontText.rawValue,
                CodingKeys.backText.rawValue,
                CodingKeys.tags.rawValue,
                CodingKeys.effortLevel.rawValue
            ]),
            context: "create_cards.cards[]"
        )
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.frontText = try container.decode(String.self, forKey: .frontText)
        self.backText = try container.decode(String.self, forKey: .backText)
        self.tags = try container.decodeIfPresent([String].self, forKey: .tags) ?? []
        self.effortLevel = try container.decode(EffortLevel.self, forKey: .effortLevel)
    }
}

extension CreateDeckToolInput {
    private enum CodingKeys: String, CodingKey {
        case name
        case effortLevels
        case tags
    }

    init(from decoder: Decoder) throws {
        try validateObjectKeys(
            decoder: decoder,
            allowedKeys: Set([
                CodingKeys.name.rawValue,
                CodingKeys.effortLevels.rawValue,
                CodingKeys.tags.rawValue
            ]),
            context: "create_decks.decks[]"
        )
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.name = try container.decode(String.self, forKey: .name)
        self.effortLevels = try container.decodeIfPresent([EffortLevel].self, forKey: .effortLevels) ?? []
        self.tags = try container.decodeIfPresent([String].self, forKey: .tags) ?? []
    }
}

extension SearchCardsToolInput {
    private enum CodingKeys: String, CodingKey {
        case query
        case cursor
        case limit
        case filter
    }

    init(from decoder: Decoder) throws {
        try validateObjectKeys(
            decoder: decoder,
            allowedKeys: Set([
                CodingKeys.query.rawValue,
                CodingKeys.cursor.rawValue,
                CodingKeys.limit.rawValue,
                CodingKeys.filter.rawValue
            ]),
            context: "search_cards"
        )
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.query = try container.decode(String.self, forKey: .query)
        self.cursor = try container.decodeIfPresent(String.self, forKey: .cursor)
        self.limit = try container.decode(Int.self, forKey: .limit)
        self.filter = normalizeCardFilter(filter: try container.decodeIfPresent(CardFilter.self, forKey: .filter))
    }
}

extension ListCardsToolInput {
    private enum CodingKeys: String, CodingKey {
        case cursor
        case limit
        case filter
    }

    init(from decoder: Decoder) throws {
        try validateObjectKeys(
            decoder: decoder,
            allowedKeys: Set([
                CodingKeys.cursor.rawValue,
                CodingKeys.limit.rawValue,
                CodingKeys.filter.rawValue
            ]),
            context: "list_cards"
        )
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.cursor = try container.decodeIfPresent(String.self, forKey: .cursor)
        self.limit = try container.decode(Int.self, forKey: .limit)
        self.filter = normalizeCardFilter(filter: try container.decodeIfPresent(CardFilter.self, forKey: .filter))
    }
}

/**
 Executes local AI tools against the iOS app snapshot and local database.

 This actor owns the iOS-specific mirror of the shared AI tool behavior. Keep
 tool names, payload shapes, and visible semantics aligned with the backend and
 browser-local counterparts referenced in the file-level docstring.
 */
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
        case "list_tags":
            let snapshot = try self.loadSnapshotNow()
            return AIToolExecutionResult(
                output: try self.encodeJSON(value: workspaceTagsSummary(cards: snapshot.cards)),
                didMutateAppState: false
            )
        case "list_cards":
            let input = try self.decodeInput(ListCardsToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            let snapshot = try self.loadSnapshotNow()
            let startIndex = try self.pageStartIndex(cursor: input.cursor)
            return AIToolExecutionResult(
                output: try self.encodeJSON(
                    value: self.makeCardsPagePayload(
                        cards: self.cardsMatchingFilter(cards: self.currentActiveCards(snapshot: snapshot), filter: input.filter),
                        startIndex: startIndex,
                        limit: try self.normalizeLimit(input.limit)
                    )
                ),
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
            let startIndex = try self.pageStartIndex(cursor: input.cursor)
            let matchedCards = try self.searchCards(snapshot: snapshot, query: input.query, limit: Int.max, filter: input.filter)
            return AIToolExecutionResult(
                output: try self.encodeJSON(
                    value: self.makeCardsPagePayload(
                        cards: matchedCards,
                        startIndex: startIndex,
                        limit: try self.normalizeLimit(input.limit)
                    )
                ),
                didMutateAppState: false
            )
        case "list_due_cards":
            let input = try self.decodeInput(ListDueCardsToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            let snapshot = try self.loadSnapshotNow()
            let startIndex = try self.pageStartIndex(cursor: input.cursor)
            return AIToolExecutionResult(
                output: try self.encodeJSON(
                    value: self.makeCardsPagePayload(
                        cards: self.dueCards(snapshot: snapshot),
                        startIndex: startIndex,
                        limit: try self.normalizeLimit(input.limit)
                    )
                ),
                didMutateAppState: false
            )
        case "list_decks":
            let input = try self.decodeInput(ListDecksToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            let snapshot = try self.loadSnapshotNow()
            let startIndex = try self.pageStartIndex(cursor: input.cursor)
            return AIToolExecutionResult(
                output: try self.encodeJSON(
                    value: self.makeDecksPagePayload(
                        decks: self.activeDecks(snapshot: snapshot),
                        startIndex: startIndex,
                        limit: try self.normalizeLimit(input.limit)
                    )
                ),
                didMutateAppState: false
            )
        case "search_decks":
            let input = try self.decodeInput(SearchDecksToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            let snapshot = try self.loadSnapshotNow()
            let startIndex = try self.pageStartIndex(cursor: input.cursor)
            let matchedDecks = try self.searchDecks(snapshot: snapshot, query: input.query, limit: Int.max)
            return AIToolExecutionResult(
                output: try self.encodeJSON(
                    value: self.makeDecksPagePayload(
                        decks: matchedDecks,
                        startIndex: startIndex,
                        limit: try self.normalizeLimit(input.limit)
                    )
                ),
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
            let startIndex = try self.pageStartIndex(cursor: input.cursor)
            return AIToolExecutionResult(
                output: try self.encodeJSON(
                    value: self.makeReviewHistoryPagePayload(
                        history: try self.loadReviewHistory(
                            workspaceId: snapshot.workspace.workspaceId,
                            limit: Int.max,
                            cardId: input.cardId
                        ),
                        startIndex: startIndex,
                        limit: try self.normalizeLimit(input.limit)
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
            let startIndex = try self.pageStartIndex(cursor: input.cursor)
            return AIToolExecutionResult(
                output: try self.encodeJSON(
                    value: try self.makeOutboxPayload(
                        workspaceId: snapshot.workspace.workspaceId,
                        startIndex: startIndex,
                        limit: try self.normalizeLimit(input.limit)
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

    private func makeOutboxPayload(workspaceId: String, startIndex: Int, limit: Int) throws -> LocalOutboxPagePayload {
        let entries = try self.databaseInstance().loadOutboxEntries(workspaceId: workspaceId, limit: Int.max)
        let visibleEntries = Array(entries.dropFirst(startIndex).prefix(limit))
        return LocalOutboxPagePayload(
            outbox: visibleEntries.map { entry in
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
            },
            nextCursor: self.nextCursor(totalCount: entries.count, startIndex: startIndex, visibleCount: visibleEntries.count)
        )
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

    private func cardsMatchingFilter(cards: [Card], filter: CardFilter?) -> [Card] {
        guard let filter else {
            return cards
        }

        return cards.filter { card in
            matchesCardFilter(filter: filter, card: card)
        }
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

    /**
     Mirrors backend card-search semantics for the iOS-local runtime.

     Counterparts:
     - backend DB implementation: `apps/backend/src/cards/queries.ts`
     - browser-local mirror: `apps/web/src/chat/localToolExecutor.ts`
     */
    private func searchCards(snapshot: AppStateSnapshot, query: String, limit: Int, filter: CardFilter?) throws -> [Card] {
        let searchTokens = tokenizeSearchText(searchText: query)
        if searchTokens.isEmpty {
            throw LocalStoreError.validation("query must not be empty")
        }

        return Array(self.cardsMatchingFilter(cards: self.currentActiveCards(snapshot: snapshot), filter: filter).filter { card in
            matchesAllSearchTokens(
                values: [card.frontText, card.backText] + card.tags + [card.effortLevel.rawValue],
                searchTokens: searchTokens
            )
        }.prefix(limit))
    }

    /**
     Mirrors backend deck-search semantics for the iOS-local runtime.

     Counterparts:
     - backend DB implementation: `apps/backend/src/decks.ts`
     - browser-local mirror: `apps/web/src/chat/localToolExecutor.ts`
     */
    private func searchDecks(snapshot: AppStateSnapshot, query: String, limit: Int) throws -> [Deck] {
        let searchTokens = tokenizeSearchText(searchText: query)
        if searchTokens.isEmpty {
            throw LocalStoreError.validation("query must not be empty")
        }

        return Array(self.activeDecks(snapshot: snapshot).filter { deck in
            matchesAnySearchToken(
                values: [deck.name] + deck.filterDefinition.tags + deck.filterDefinition.effortLevels.map { effortLevel in
                    effortLevel.rawValue
                },
                searchTokens: searchTokens
            )
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

    private func normalizeLimit(_ limit: Int) throws -> Int {
        if limit < 1 || limit > 100 {
            throw LocalStoreError.validation("limit must be an integer between 1 and 100")
        }

        return limit
    }

    private func pageStartIndex(cursor: String?) throws -> Int {
        guard let cursor else {
            return 0
        }

        return try self.decodePageCursor(cursor: cursor)
    }

    private func makeCardsPagePayload(cards: [Card], startIndex: Int, limit: Int) -> LocalCardsPagePayload {
        let visibleCards = Array(cards.dropFirst(startIndex).prefix(limit))
        return LocalCardsPagePayload(
            cards: visibleCards,
            nextCursor: self.nextCursor(totalCount: cards.count, startIndex: startIndex, visibleCount: visibleCards.count)
        )
    }

    private func makeDecksPagePayload(decks: [Deck], startIndex: Int, limit: Int) -> LocalDecksPagePayload {
        let visibleDecks = Array(decks.dropFirst(startIndex).prefix(limit))
        return LocalDecksPagePayload(
            decks: visibleDecks,
            nextCursor: self.nextCursor(totalCount: decks.count, startIndex: startIndex, visibleCount: visibleDecks.count)
        )
    }

    private func makeReviewHistoryPagePayload(history: [ReviewEvent], startIndex: Int, limit: Int) -> LocalReviewHistoryPagePayload {
        let visibleHistory = Array(history.dropFirst(startIndex).prefix(limit))
        return LocalReviewHistoryPagePayload(
            history: visibleHistory,
            nextCursor: self.nextCursor(totalCount: history.count, startIndex: startIndex, visibleCount: visibleHistory.count)
        )
    }

    private func nextCursor(totalCount: Int, startIndex: Int, visibleCount: Int) -> String? {
        let nextIndex = startIndex + visibleCount
        if nextIndex >= totalCount {
            return nil
        }

        return self.encodePageCursor(index: nextIndex)
    }

    private func encodePageCursor(index: Int) -> String {
        let json = "{\"index\":\(index)}"
        let data = Data(json.utf8)
        return data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private func decodePageCursor(cursor: String) throws -> Int {
        let normalizedCursor = cursor
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let paddingLength = (4 - (normalizedCursor.count % 4)) % 4
        let paddedCursor = normalizedCursor + String(repeating: "=", count: paddingLength)
        guard let data = Data(base64Encoded: paddedCursor) else {
            throw LocalStoreError.validation("cursor is invalid: Cursor payload must be base64")
        }

        do {
            let payload = try JSONDecoder().decode(LocalPageCursor.self, from: data)
            if payload.index < 0 {
                throw LocalStoreError.validation("cursor is invalid: Cursor index must be a non-negative integer")
            }
            return payload.index
        } catch let error as LocalStoreError {
            throw error
        } catch {
            throw LocalStoreError.validation("cursor is invalid: \(localizedMessage(error: error))")
        }
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
