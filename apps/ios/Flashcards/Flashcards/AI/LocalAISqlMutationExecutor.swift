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
