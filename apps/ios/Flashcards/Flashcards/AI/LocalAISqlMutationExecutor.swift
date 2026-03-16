import Foundation

private func statementValueString(
    _ value: LocalAISqlStatementValue?
) -> String? {
    guard let value else {
        return nil
    }
    if case .literal(.string(let rawValue)) = value {
        return rawValue
    }
    return nil
}

private func statementValueEffortLevel(
    _ value: LocalAISqlStatementValue?
) -> EffortLevel? {
    guard let rawValue = statementValueString(value) else {
        return nil
    }
    return EffortLevel(rawValue: rawValue)
}

private func statementValueStringArray(
    _ value: LocalAISqlStatementValue?
) -> [String]? {
    guard let value else {
        return nil
    }
    if case .stringArray(let rawValue) = value {
        return rawValue
    }
    return nil
}

private func rowFromInsert(
    columnNames: [String],
    values: [LocalAISqlStatementValue]
) -> [String: LocalAISqlStatementValue] {
    Dictionary(uniqueKeysWithValues: columnNames.enumerated().compactMap { index, columnName in
        guard let value = values[safe: index] else {
            return nil
        }
        return (columnName, value)
    })
}

private func toCreateCardInput(row: [String: LocalAISqlStatementValue]) throws -> CardEditorInput {
    guard let frontText = statementValueString(row["front_text"]),
          let backText = statementValueString(row["back_text"]) else {
        throw LocalStoreError.validation("INSERT INTO cards requires front_text and back_text")
    }
    guard let effortLevel = statementValueEffortLevel(row["effort_level"]) else {
        throw LocalStoreError.validation("INSERT INTO cards requires effort_level to be fast, medium, or long")
    }

    return CardEditorInput(
        frontText: frontText,
        backText: backText,
        tags: statementValueStringArray(row["tags"]) ?? [],
        effortLevel: effortLevel
    )
}

private func toCreateDeckInput(row: [String: LocalAISqlStatementValue]) throws -> DeckEditorInput {
    guard let name = statementValueString(row["name"]) else {
        throw LocalStoreError.validation("INSERT INTO decks requires name")
    }

    let effortLevels = (statementValueStringArray(row["effort_levels"]) ?? []).compactMap(EffortLevel.init(rawValue:))

    return DeckEditorInput(
        name: name,
        filterDefinition: buildDeckFilterDefinition(
            effortLevels: effortLevels,
            tags: statementValueStringArray(row["tags"]) ?? []
        )
    )
}

private func toResolvedCardUpdateInput(
    existingCard: Card,
    row: [String: LocalAISqlStatementValue]
) -> CardEditorInput {
    CardEditorInput(
        frontText: statementValueString(row["front_text"]) ?? existingCard.frontText,
        backText: statementValueString(row["back_text"]) ?? existingCard.backText,
        tags: statementValueStringArray(row["tags"]) ?? existingCard.tags,
        effortLevel: statementValueEffortLevel(row["effort_level"]) ?? existingCard.effortLevel
    )
}

private func toResolvedDeckUpdateInput(
    existingDeck: Deck,
    row: [String: LocalAISqlStatementValue]
) -> DeckEditorInput {
    DeckEditorInput(
        name: statementValueString(row["name"]) ?? existingDeck.name,
        filterDefinition: buildDeckFilterDefinition(
            effortLevels: statementValueStringArray(row["effort_levels"])?.compactMap(EffortLevel.init(rawValue:))
                ?? existingDeck.filterDefinition.effortLevels,
            tags: statementValueStringArray(row["tags"]) ?? existingDeck.filterDefinition.tags
        )
    )
}

private func mutationPayload(
    statementType: String,
    resource: String,
    sql: String,
    normalizedSql: String,
    rows: [LocalAISqlRow],
    affectedCount: Int
) -> LocalAISqlMutationPayload {
    LocalAISqlMutationPayload(
        statementType: statementType,
        resource: resource,
        sql: sql,
        normalizedSql: normalizedSql,
        rows: rows,
        affectedCount: affectedCount
    )
}

private func selectMutationRows(
    statement: LocalAISqlStatement,
    cards: [Card],
    decks: [Deck]
) throws -> [LocalAISqlRow] {
    switch statement {
    case .update(let updateStatement):
        let rows: [LocalAISqlRow] = updateStatement.resourceName == .cards
            ? cards.map(toSqlCardRow)
            : decks.map(toSqlDeckRow)
        return try applyPredicateClauses(
            source: LocalAISqlFromSource(resourceName: updateStatement.resourceName, unnestColumnName: nil, unnestAlias: nil),
            rows: rows,
            predicateClauses: updateStatement.predicateClauses
        )
    case .delete(let deleteStatement):
        let rows: [LocalAISqlRow] = deleteStatement.resourceName == .cards
            ? cards.map(toSqlCardRow)
            : decks.map(toSqlDeckRow)
        return try applyPredicateClauses(
            source: LocalAISqlFromSource(resourceName: deleteStatement.resourceName, unnestColumnName: nil, unnestAlias: nil),
            rows: rows,
            predicateClauses: deleteStatement.predicateClauses
        )
    default:
        throw LocalStoreError.validation("Expected a mutation SQL statement")
    }
}

func executeLocalAISqlMutationBatch(
    database: LocalDatabase,
    bootstrapSnapshot: AppBootstrapSnapshot,
    sql: String,
    statements: [LocalAISqlStatement],
    statementSqls: [String],
    encoder: JSONEncoder
) throws -> LocalAISqlExecutionResult {
    let workspaceId = bootstrapSnapshot.workspace.workspaceId

    let batchPayload = try database.core.inTransaction {
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        var currentCards = try database.cardStore.loadCards(workspaceId: workspaceId)
        var currentDecks = try database.deckStore.loadDecks(workspaceId: workspaceId)
        var statementPayloads: [LocalAISqlSinglePayload] = []
        var affectedCountTotal = 0

        for (index, statement) in statements.enumerated() {
            let statementSql = statementSqls[safe: index] ?? {
                switch statement {
                case .showTables(let payload):
                    return payload.normalizedSql
                case .describe(let payload):
                    return payload.normalizedSql
                case .select(let payload):
                    return payload.normalizedSql
                case .insert(let payload):
                    return payload.normalizedSql
                case .update(let payload):
                    return payload.normalizedSql
                case .delete(let payload):
                    return payload.normalizedSql
                }
            }()

            switch statement {
            case .insert(let insertStatement):
                if insertStatement.resourceName == .cards {
                    let inputs = try insertStatement.rows.map { values in
                        try toCreateCardInput(row: rowFromInsert(columnNames: insertStatement.columnNames, values: values))
                    }
                    try database.validateCardBatchCount(count: inputs.count)
                    for input in inputs {
                        try database.cardStore.validateCardInput(input: input)
                    }

                    var createdCards: [Card] = []
                    for input in inputs {
                        let operationId = UUID().uuidString.lowercased()
                        let now = nowIsoTimestamp()
                        let createdCard = try database.cardStore.saveCard(
                            workspaceId: workspaceId,
                            input: input,
                            cardId: nil,
                            deviceId: cloudSettings.deviceId,
                            operationId: operationId,
                            now: now
                        )
                        try database.outboxStore.enqueueCardUpsertOperation(
                            workspaceId: workspaceId,
                            deviceId: cloudSettings.deviceId,
                            operationId: operationId,
                            clientUpdatedAt: now,
                            card: createdCard
                        )
                        createdCards.append(createdCard)
                        currentCards.insert(createdCard, at: 0)
                    }

                    affectedCountTotal += createdCards.count
                    statementPayloads.append(.mutation(mutationPayload(
                        statementType: "insert",
                        resource: insertStatement.resourceName.rawValue,
                        sql: statementSql,
                        normalizedSql: insertStatement.normalizedSql,
                        rows: createdCards.map(toSqlCardRow),
                        affectedCount: createdCards.count
                    )))
                    continue
                }

                let inputs = try insertStatement.rows.map { values in
                    try toCreateDeckInput(row: rowFromInsert(columnNames: insertStatement.columnNames, values: values))
                }
                try database.validateDeckBatchCount(count: inputs.count)
                for input in inputs {
                    try database.deckStore.validateDeckInput(input: input)
                }

                var createdDecks: [Deck] = []
                for input in inputs {
                    let operationId = UUID().uuidString.lowercased()
                    let now = nowIsoTimestamp()
                    let createdDeck = try database.deckStore.createDeck(
                        workspaceId: workspaceId,
                        input: input,
                        deviceId: cloudSettings.deviceId,
                        operationId: operationId,
                        now: now
                    )
                    try database.outboxStore.enqueueDeckUpsertOperation(
                        workspaceId: workspaceId,
                        deviceId: cloudSettings.deviceId,
                        operationId: operationId,
                        clientUpdatedAt: now,
                        deck: createdDeck
                    )
                    createdDecks.append(createdDeck)
                    currentDecks.insert(createdDeck, at: 0)
                }

                affectedCountTotal += createdDecks.count
                statementPayloads.append(.mutation(mutationPayload(
                    statementType: "insert",
                    resource: insertStatement.resourceName.rawValue,
                    sql: statementSql,
                    normalizedSql: insertStatement.normalizedSql,
                    rows: createdDecks.map(toSqlDeckRow),
                    affectedCount: createdDecks.count
                )))
            case .update(let updateStatement):
                let matchingRows = try selectMutationRows(
                    statement: statement,
                    cards: currentCards,
                    decks: currentDecks
                )
                let assignmentRow = Dictionary(uniqueKeysWithValues: updateStatement.assignments.map { assignment in
                    (assignment.columnName, assignment.value)
                })

                if updateStatement.resourceName == .cards {
                    let updates = try matchingRows.map { row in
                        guard case .string(let cardId) = row["card_id"] else {
                            throw LocalStoreError.validation("Expected card_id in selected row")
                        }
                        guard let existingCard = currentCards.first(where: { card in
                            card.cardId == cardId
                        }) else {
                            throw LocalStoreError.notFound("Card not found")
                        }
                        return CardUpdateInput(
                            cardId: cardId,
                            input: toResolvedCardUpdateInput(existingCard: existingCard, row: assignmentRow)
                        )
                    }
                    try database.validateCardBatchCount(count: updates.count)
                    try database.validateUniqueCardIds(cardIds: updates.map { update in
                        update.cardId
                    })

                    var updatedCards: [Card] = []
                    for update in updates {
                        try database.cardStore.validateCardInput(input: update.input)
                        let operationId = UUID().uuidString.lowercased()
                        let now = nowIsoTimestamp()
                        let updatedCard = try database.cardStore.saveCard(
                            workspaceId: workspaceId,
                            input: update.input,
                            cardId: update.cardId,
                            deviceId: cloudSettings.deviceId,
                            operationId: operationId,
                            now: now
                        )
                        try database.outboxStore.enqueueCardUpsertOperation(
                            workspaceId: workspaceId,
                            deviceId: cloudSettings.deviceId,
                            operationId: operationId,
                            clientUpdatedAt: now,
                            card: updatedCard
                        )
                        updatedCards.append(updatedCard)
                        currentCards = currentCards.map { card in
                            card.cardId == updatedCard.cardId ? updatedCard : card
                        }
                    }

                    affectedCountTotal += updatedCards.count
                    statementPayloads.append(.mutation(mutationPayload(
                        statementType: "update",
                        resource: updateStatement.resourceName.rawValue,
                        sql: statementSql,
                        normalizedSql: updateStatement.normalizedSql,
                        rows: updatedCards.map(toSqlCardRow),
                        affectedCount: updatedCards.count
                    )))
                    continue
                }

                let updates = try matchingRows.map { row in
                    guard case .string(let deckId) = row["deck_id"] else {
                        throw LocalStoreError.validation("Expected deck_id in selected row")
                    }
                    guard let existingDeck = currentDecks.first(where: { deck in
                        deck.deckId == deckId
                    }) else {
                        throw LocalStoreError.notFound("Deck not found")
                    }
                    return DeckUpdateInput(
                        deckId: deckId,
                        input: toResolvedDeckUpdateInput(existingDeck: existingDeck, row: assignmentRow)
                    )
                }
                try database.validateDeckBatchCount(count: updates.count)
                try database.validateUniqueDeckIds(deckIds: updates.map { update in
                    update.deckId
                })

                var updatedDecks: [Deck] = []
                for update in updates {
                    try database.deckStore.validateDeckInput(input: update.input)
                    let operationId = UUID().uuidString.lowercased()
                    let now = nowIsoTimestamp()
                    let updatedDeck = try database.deckStore.updateDeck(
                        workspaceId: workspaceId,
                        deckId: update.deckId,
                        input: update.input,
                        deviceId: cloudSettings.deviceId,
                        operationId: operationId,
                        now: now
                    )
                    try database.outboxStore.enqueueDeckUpsertOperation(
                        workspaceId: workspaceId,
                        deviceId: cloudSettings.deviceId,
                        operationId: operationId,
                        clientUpdatedAt: now,
                        deck: updatedDeck
                    )
                    updatedDecks.append(updatedDeck)
                    currentDecks = currentDecks.map { deck in
                        deck.deckId == updatedDeck.deckId ? updatedDeck : deck
                    }
                }

                affectedCountTotal += updatedDecks.count
                statementPayloads.append(.mutation(mutationPayload(
                    statementType: "update",
                    resource: updateStatement.resourceName.rawValue,
                    sql: statementSql,
                    normalizedSql: updateStatement.normalizedSql,
                    rows: updatedDecks.map(toSqlDeckRow),
                    affectedCount: updatedDecks.count
                )))
            case .delete(let deleteStatement):
                let matchingRows = try selectMutationRows(
                    statement: statement,
                    cards: currentCards,
                    decks: currentDecks
                )

                if deleteStatement.resourceName == .cards {
                    let cardIds = try matchingRows.map { row in
                        guard case .string(let cardId) = row["card_id"] else {
                            throw LocalStoreError.validation("Expected card_id in selected row")
                        }
                        return cardId
                    }
                    try database.validateCardBatchCount(count: cardIds.count)
                    try database.validateUniqueCardIds(cardIds: cardIds)

                    for cardId in cardIds {
                        let operationId = UUID().uuidString.lowercased()
                        let now = nowIsoTimestamp()
                        let deletedCard = try database.cardStore.deleteCard(
                            workspaceId: workspaceId,
                            cardId: cardId,
                            deviceId: cloudSettings.deviceId,
                            operationId: operationId,
                            now: now
                        )
                        try database.outboxStore.enqueueCardUpsertOperation(
                            workspaceId: workspaceId,
                            deviceId: cloudSettings.deviceId,
                            operationId: operationId,
                            clientUpdatedAt: now,
                            card: deletedCard
                        )
                        currentCards.removeAll { card in
                            card.cardId == cardId
                        }
                    }

                    affectedCountTotal += cardIds.count
                    statementPayloads.append(.mutation(mutationPayload(
                        statementType: "delete",
                        resource: deleteStatement.resourceName.rawValue,
                        sql: statementSql,
                        normalizedSql: deleteStatement.normalizedSql,
                        rows: [],
                        affectedCount: cardIds.count
                    )))
                    continue
                }

                let deckIds = try matchingRows.map { row in
                    guard case .string(let deckId) = row["deck_id"] else {
                        throw LocalStoreError.validation("Expected deck_id in selected row")
                    }
                    return deckId
                }
                try database.validateDeckBatchCount(count: deckIds.count)
                try database.validateUniqueDeckIds(deckIds: deckIds)

                for deckId in deckIds {
                    let operationId = UUID().uuidString.lowercased()
                    let now = nowIsoTimestamp()
                    let deletedDeck = try database.deckStore.deleteDeck(
                        workspaceId: workspaceId,
                        deckId: deckId,
                        deviceId: cloudSettings.deviceId,
                        operationId: operationId,
                        now: now
                    )
                    try database.outboxStore.enqueueDeckUpsertOperation(
                        workspaceId: workspaceId,
                        deviceId: cloudSettings.deviceId,
                        operationId: operationId,
                        clientUpdatedAt: now,
                        deck: deletedDeck
                    )
                    currentDecks.removeAll { deck in
                        deck.deckId == deckId
                    }
                }

                affectedCountTotal += deckIds.count
                statementPayloads.append(.mutation(mutationPayload(
                    statementType: "delete",
                    resource: deleteStatement.resourceName.rawValue,
                    sql: statementSql,
                    normalizedSql: deleteStatement.normalizedSql,
                    rows: [],
                    affectedCount: deckIds.count
                )))
            default:
                throw LocalStoreError.validation("Expected a mutation SQL statement")
            }
        }

        return LocalAISqlBatchPayload(
            statementType: "batch",
            resource: nil,
            sql: sql,
            normalizedSql: statements.compactMap { statement in
                switch statement {
                case .showTables(let payload):
                    return payload.normalizedSql
                case .describe(let payload):
                    return payload.normalizedSql
                case .select(let payload):
                    return payload.normalizedSql
                case .insert(let payload):
                    return payload.normalizedSql
                case .update(let payload):
                    return payload.normalizedSql
                case .delete(let payload):
                    return payload.normalizedSql
                }
            }.joined(separator: "; "),
            statements: statementPayloads,
            statementCount: statementPayloads.count,
            affectedCountTotal: affectedCountTotal
        )
    }

    return LocalAISqlExecutionResult(
        output: try encodeJSON(value: batchPayload, encoder: encoder),
        didMutateAppState: true
    )
}

func executeLocalAISqlMutationStatement(
    database: LocalDatabase,
    bootstrapSnapshot: AppBootstrapSnapshot,
    sql: String,
    statement: LocalAISqlStatement,
    encoder: JSONEncoder
) throws -> LocalAISqlExecutionResult {
    let workspaceId = bootstrapSnapshot.workspace.workspaceId

    switch statement {
    case .insert(let insertStatement):
        if insertStatement.resourceName == .cards {
            let createdCards = try database.createCards(
                workspaceId: workspaceId,
                inputs: try insertStatement.rows.map { values in
                    try toCreateCardInput(row: rowFromInsert(columnNames: insertStatement.columnNames, values: values))
                }
            )
            return LocalAISqlExecutionResult(
                output: try encodeJSON(
                    value: LocalAISqlMutationPayload(
                        statementType: "insert",
                        resource: insertStatement.resourceName.rawValue,
                        sql: sql,
                        normalizedSql: insertStatement.normalizedSql,
                        rows: createdCards.map(toSqlCardRow),
                        affectedCount: createdCards.count
                    ),
                    encoder: encoder
                ),
                didMutateAppState: true
            )
        }

        let createdDecks = try database.createDecks(
            workspaceId: workspaceId,
            inputs: try insertStatement.rows.map { values in
                try toCreateDeckInput(row: rowFromInsert(columnNames: insertStatement.columnNames, values: values))
            }
        )
        return LocalAISqlExecutionResult(
            output: try encodeJSON(
                value: LocalAISqlMutationPayload(
                    statementType: "insert",
                    resource: insertStatement.resourceName.rawValue,
                    sql: sql,
                    normalizedSql: insertStatement.normalizedSql,
                    rows: createdDecks.map(toSqlDeckRow),
                    affectedCount: createdDecks.count
                ),
                encoder: encoder
            ),
            didMutateAppState: true
        )
    case .update(let updateStatement):
        let matchingRows = try applyPredicateClauses(
            source: LocalAISqlFromSource(resourceName: updateStatement.resourceName, unnestColumnName: nil, unnestAlias: nil),
            rows: try loadSelectRows(
                database: database,
                bootstrapSnapshot: bootstrapSnapshot,
                resourceName: updateStatement.resourceName
            ),
            predicateClauses: updateStatement.predicateClauses
        )
        let assignmentRow = Dictionary(uniqueKeysWithValues: updateStatement.assignments.map { assignment in
            (assignment.columnName, assignment.value)
        })

        if updateStatement.resourceName == .cards {
            let updates = try matchingRows.map { row in
                guard case .string(let cardId) = row["card_id"] else {
                    throw LocalStoreError.validation("Expected card_id in selected row")
                }
                return CardUpdateInput(
                    cardId: cardId,
                    input: toResolvedCardUpdateInput(
                        existingCard: try database.loadActiveCard(workspaceId: workspaceId, cardId: cardId),
                        row: assignmentRow
                    )
                )
            }
            let updatedCards = try database.updateCards(workspaceId: workspaceId, updates: updates)
            return LocalAISqlExecutionResult(
                output: try encodeJSON(
                    value: LocalAISqlMutationPayload(
                        statementType: "update",
                        resource: updateStatement.resourceName.rawValue,
                        sql: sql,
                        normalizedSql: updateStatement.normalizedSql,
                        rows: updatedCards.map(toSqlCardRow),
                        affectedCount: updatedCards.count
                    ),
                    encoder: encoder
                ),
                didMutateAppState: true
            )
        }

        let updates = try matchingRows.map { row in
            guard case .string(let deckId) = row["deck_id"] else {
                throw LocalStoreError.validation("Expected deck_id in selected row")
            }
            return DeckUpdateInput(
                deckId: deckId,
                input: toResolvedDeckUpdateInput(
                    existingDeck: try database.loadDeck(workspaceId: workspaceId, deckId: deckId),
                    row: assignmentRow
                )
            )
        }
        let updatedDecks = try database.updateDecks(workspaceId: workspaceId, updates: updates)
        return LocalAISqlExecutionResult(
            output: try encodeJSON(
                value: LocalAISqlMutationPayload(
                    statementType: "update",
                    resource: updateStatement.resourceName.rawValue,
                    sql: sql,
                    normalizedSql: updateStatement.normalizedSql,
                    rows: updatedDecks.map(toSqlDeckRow),
                    affectedCount: updatedDecks.count
                ),
                encoder: encoder
            ),
            didMutateAppState: true
        )
    case .delete(let deleteStatement):
        let matchingRows = try applyPredicateClauses(
            source: LocalAISqlFromSource(resourceName: deleteStatement.resourceName, unnestColumnName: nil, unnestAlias: nil),
            rows: try loadSelectRows(
                database: database,
                bootstrapSnapshot: bootstrapSnapshot,
                resourceName: deleteStatement.resourceName
            ),
            predicateClauses: deleteStatement.predicateClauses
        )

        if deleteStatement.resourceName == .cards {
            let cardIds = try matchingRows.map { row in
                guard case .string(let cardId) = row["card_id"] else {
                    throw LocalStoreError.validation("Expected card_id in selected row")
                }
                return cardId
            }
            _ = try database.deleteCards(workspaceId: workspaceId, cardIds: cardIds)
            return LocalAISqlExecutionResult(
                output: try encodeJSON(
                    value: LocalAISqlMutationPayload(
                        statementType: "delete",
                        resource: deleteStatement.resourceName.rawValue,
                        sql: sql,
                        normalizedSql: deleteStatement.normalizedSql,
                        rows: [],
                        affectedCount: cardIds.count
                    ),
                    encoder: encoder
                ),
                didMutateAppState: true
            )
        }

        let deckIds = try matchingRows.map { row in
            guard case .string(let deckId) = row["deck_id"] else {
                throw LocalStoreError.validation("Expected deck_id in selected row")
                }
                return deckId
            }
        _ = try database.deleteDecks(workspaceId: workspaceId, deckIds: deckIds)
        return LocalAISqlExecutionResult(
            output: try encodeJSON(
                value: LocalAISqlMutationPayload(
                    statementType: "delete",
                    resource: deleteStatement.resourceName.rawValue,
                    sql: sql,
                    normalizedSql: deleteStatement.normalizedSql,
                    rows: [],
                    affectedCount: deckIds.count
                ),
                encoder: encoder
            ),
            didMutateAppState: true
        )
    default:
        throw LocalStoreError.validation("Expected a mutation SQL statement")
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        if indices.contains(index) {
            return self[index]
        }

        return nil
    }
}
