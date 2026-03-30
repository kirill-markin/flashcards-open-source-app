import Foundation

struct DeckStore {
    let core: DatabaseCore

    func validateDeckInput(input: DeckEditorInput) throws {
        if input.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            throw LocalStoreError.validation("Deck name must not be empty")
        }

        if input.filterDefinition.version != 2 {
            throw LocalStoreError.validation("Deck filter version must be 2")
        }
    }

    func loadDecks(workspaceId: String) throws -> [Deck] {
        try self.core.query(
            sql: """
            SELECT deck_id, workspace_id, name, filter_definition_json, created_at, client_updated_at, last_modified_by_replica_id, last_operation_id, updated_at, deleted_at
            FROM decks
            WHERE workspace_id = ? AND deleted_at IS NULL
            ORDER BY created_at DESC, deck_id DESC
            """,
            values: [.text(workspaceId)]
        ) { statement in
            try self.mapDeck(statement: statement)
        }
    }

    func loadDeckIncludingDeleted(workspaceId: String, deckId: String) throws -> Deck {
        let decks = try self.core.query(
            sql: """
            SELECT deck_id, workspace_id, name, filter_definition_json, created_at, client_updated_at, last_modified_by_replica_id, last_operation_id, updated_at, deleted_at
            FROM decks
            WHERE workspace_id = ? AND deck_id = ?
            LIMIT 1
            """,
            values: [
                .text(workspaceId),
                .text(deckId)
            ]
        ) { statement in
            try self.mapDeck(statement: statement)
        }

        guard let deck = decks.first else {
            throw LocalStoreError.notFound("Deck not found")
        }

        return deck
    }

    func loadDeck(workspaceId: String, deckId: String) throws -> Deck {
        let deck = try self.loadDeckIncludingDeleted(workspaceId: workspaceId, deckId: deckId)
        guard deck.deletedAt == nil else {
            throw LocalStoreError.notFound("Deck not found")
        }

        return deck
    }

    func loadDecksIncludingDeleted(workspaceId: String) throws -> [Deck] {
        try self.core.query(
            sql: """
            SELECT deck_id, workspace_id, name, filter_definition_json, created_at, client_updated_at, last_modified_by_replica_id, last_operation_id, updated_at, deleted_at
            FROM decks
            WHERE workspace_id = ?
            ORDER BY created_at DESC, deck_id DESC
            """,
            values: [.text(workspaceId)]
        ) { statement in
            try self.mapDeck(statement: statement)
        }
    }

    func loadOptionalDeckIncludingDeleted(workspaceId: String, deckId: String) throws -> Deck? {
        let decks = try self.core.query(
            sql: """
            SELECT deck_id, workspace_id, name, filter_definition_json, created_at, client_updated_at, last_modified_by_replica_id, last_operation_id, updated_at, deleted_at
            FROM decks
            WHERE workspace_id = ? AND deck_id = ?
            LIMIT 1
            """,
            values: [
                .text(workspaceId),
                .text(deckId)
            ]
        ) { statement in
            try self.mapDeck(statement: statement)
        }

        return decks.first
    }

    func createDeck(
        workspaceId: String,
        input: DeckEditorInput,
        installationId: String,
        operationId: String,
        now: String
    ) throws -> Deck {
        let filterJson = try self.core.encodeJsonString(value: input.filterDefinition)
        let deckId = UUID().uuidString.lowercased()
        try self.core.execute(
            sql: """
            INSERT INTO decks (
                deck_id,
                workspace_id,
                name,
                filter_definition_json,
                created_at,
                client_updated_at,
                last_modified_by_replica_id,
                last_operation_id,
                updated_at,
                deleted_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
            """,
            values: [
                .text(deckId),
                .text(workspaceId),
                .text(input.name),
                .text(filterJson),
                .text(now),
                .text(now),
                .text(installationId),
                .text(operationId),
                .text(now)
            ]
        )

        return try self.loadDeckIncludingDeleted(workspaceId: workspaceId, deckId: deckId)
    }

    func updateDeck(
        workspaceId: String,
        deckId: String,
        input: DeckEditorInput,
        installationId: String,
        operationId: String,
        now: String
    ) throws -> Deck {
        let filterJson = try self.core.encodeJsonString(value: input.filterDefinition)
        let updatedRows = try self.core.execute(
            sql: """
            UPDATE decks
            SET name = ?, filter_definition_json = ?, client_updated_at = ?, last_modified_by_replica_id = ?, last_operation_id = ?, updated_at = ?
            WHERE workspace_id = ? AND deck_id = ? AND deleted_at IS NULL
            """,
            values: [
                .text(input.name),
                .text(filterJson),
                .text(now),
                .text(installationId),
                .text(operationId),
                .text(now),
                .text(workspaceId),
                .text(deckId)
            ]
        )

        if updatedRows == 0 {
            throw LocalStoreError.notFound("Deck not found")
        }

        return try self.loadDeckIncludingDeleted(workspaceId: workspaceId, deckId: deckId)
    }

    func deleteDeck(
        workspaceId: String,
        deckId: String,
        installationId: String,
        operationId: String,
        now: String
    ) throws -> Deck {
        let deletedRows = try self.core.execute(
            sql: """
            UPDATE decks
            SET deleted_at = ?, client_updated_at = ?, last_modified_by_replica_id = ?, last_operation_id = ?, updated_at = ?
            WHERE workspace_id = ? AND deck_id = ? AND deleted_at IS NULL
            """,
            values: [
                .text(now),
                .text(now),
                .text(installationId),
                .text(operationId),
                .text(now),
                .text(workspaceId),
                .text(deckId)
            ]
        )

        if deletedRows == 0 {
            throw LocalStoreError.notFound("Deck not found")
        }

        return try self.loadDeckIncludingDeleted(workspaceId: workspaceId, deckId: deckId)
    }

    func mapDeck(statement: OpaquePointer) throws -> Deck {
        let filterJson = DatabaseCore.columnText(statement: statement, index: 3)
        let filterData = Data(filterJson.utf8)
        let filterDefinition = try self.core.decoder.decode(DeckFilterDefinition.self, from: filterData)

        return Deck(
            deckId: DatabaseCore.columnText(statement: statement, index: 0),
            workspaceId: DatabaseCore.columnText(statement: statement, index: 1),
            name: DatabaseCore.columnText(statement: statement, index: 2),
            filterDefinition: filterDefinition,
            createdAt: DatabaseCore.columnText(statement: statement, index: 4),
            clientUpdatedAt: DatabaseCore.columnText(statement: statement, index: 5),
            lastModifiedByReplicaId: DatabaseCore.columnText(statement: statement, index: 6),
            lastOperationId: DatabaseCore.columnText(statement: statement, index: 7),
            updatedAt: DatabaseCore.columnText(statement: statement, index: 8),
            deletedAt: DatabaseCore.columnOptionalText(statement: statement, index: 9)
        )
    }
}
