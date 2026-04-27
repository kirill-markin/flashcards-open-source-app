import Foundation

private struct WorkspaceForkOutboxRow {
    let operationId: String
    let entityType: SyncEntityType
    let entityId: String
    let payloadJson: String
}

private enum WorkspaceForkJSONValue: Codable, Equatable {
    case object([String: WorkspaceForkJSONValue])
    case array([WorkspaceForkJSONValue])
    case string(String)
    case integer(Int)
    case double(Double)
    case bool(Bool)
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Int.self) {
            self = .integer(value)
        } else if let value = try? container.decode(Double.self) {
            self = .double(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([WorkspaceForkJSONValue].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: WorkspaceForkJSONValue].self))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .object(let value):
            try container.encode(value)
        case .array(let value):
            try container.encode(value)
        case .string(let value):
            try container.encode(value)
        case .integer(let value):
            try container.encode(value)
        case .double(let value):
            try container.encode(value)
        case .bool(let value):
            try container.encode(value)
        case .null:
            try container.encodeNil()
        }
    }
}

private extension Dictionary where Key == String, Value == WorkspaceForkJSONValue {
    func requireString(fieldName: String, context: String) throws -> String {
        guard let value = self[fieldName] else {
            throw LocalStoreError.database("Workspace identity fork payload is missing \(fieldName) for \(context)")
        }

        guard case .string(let stringValue) = value else {
            throw LocalStoreError.database("Workspace identity fork payload field \(fieldName) is not a string for \(context)")
        }

        return stringValue
    }
}

struct WorkspaceOutboxRewriter {
    let core: DatabaseCore

    func rewriteOutboxForWorkspaceFork(
        sourceWorkspaceId: String,
        destinationWorkspaceId: String,
        forkMappings: WorkspaceForkIdMappings
    ) throws {
        let rows = try self.loadWorkspaceForkOutboxRows(workspaceId: sourceWorkspaceId)
        for row in rows {
            let rewrittenEntityId = try self.rewrittenWorkspaceForkOutboxEntityId(
                row: row,
                destinationWorkspaceId: destinationWorkspaceId,
                forkMappings: forkMappings
            )
            let rewrittenPayloadJson = try self.rewrittenWorkspaceForkOutboxPayloadJson(
                row: row,
                forkMappings: forkMappings
            )
            try self.core.execute(
                sql: """
                UPDATE outbox
                SET workspace_id = ?, entity_id = ?, payload_json = ?
                WHERE operation_id = ?
                """,
                values: [
                    .text(destinationWorkspaceId),
                    .text(rewrittenEntityId),
                    .text(rewrittenPayloadJson),
                    .text(row.operationId)
                ]
            )
        }
    }

    func rewriteOutboxForCardPublicSyncConflict(
        workspaceId: String,
        sourceCardId: String,
        replacementCardId: String
    ) throws {
        let rows: [WorkspaceForkOutboxRow] = try self.loadWorkspaceForkOutboxRows(workspaceId: workspaceId)
        for row in rows {
            switch row.entityType {
            case .card:
                try self.rewriteCardOutboxRowForPublicSyncConflict(
                    row: row,
                    sourceCardId: sourceCardId,
                    replacementCardId: replacementCardId
                )
            case .reviewEvent:
                try self.rewriteReviewEventOutboxCardReferenceForPublicSyncConflict(
                    row: row,
                    sourceCardId: sourceCardId,
                    replacementCardId: replacementCardId
                )
            case .deck, .workspaceSchedulerSettings:
                break
            }
        }
    }

    func rewriteOutboxForDeckPublicSyncConflict(
        workspaceId: String,
        sourceDeckId: String,
        replacementDeckId: String
    ) throws {
        let rows: [WorkspaceForkOutboxRow] = try self.loadWorkspaceForkOutboxRows(workspaceId: workspaceId)
        for row in rows {
            guard row.entityType == .deck else {
                continue
            }

            try self.rewriteDeckOutboxRowForPublicSyncConflict(
                row: row,
                sourceDeckId: sourceDeckId,
                replacementDeckId: replacementDeckId
            )
        }
    }

    func rewriteOutboxForReviewEventPublicSyncConflict(
        workspaceId: String,
        sourceReviewEventId: String,
        replacementReviewEventId: String
    ) throws {
        let rows: [WorkspaceForkOutboxRow] = try self.loadWorkspaceForkOutboxRows(workspaceId: workspaceId)
        for row in rows {
            guard row.entityType == .reviewEvent else {
                continue
            }

            try self.rewriteReviewEventOutboxRowForPublicSyncConflict(
                row: row,
                sourceReviewEventId: sourceReviewEventId,
                replacementReviewEventId: replacementReviewEventId
            )
        }
    }

    private func loadWorkspaceForkOutboxRows(workspaceId: String) throws -> [WorkspaceForkOutboxRow] {
        try self.core.query(
            sql: """
            SELECT operation_id, entity_type, entity_id, payload_json
            FROM outbox
            WHERE workspace_id = ?
            ORDER BY created_at ASC, operation_id ASC
            """,
            values: [.text(workspaceId)]
        ) { statement in
            let entityTypeRaw = DatabaseCore.columnText(statement: statement, index: 1)
            guard let entityType = SyncEntityType(rawValue: entityTypeRaw) else {
                throw LocalStoreError.database("Stored outbox entity type is invalid during workspace fork: \(entityTypeRaw)")
            }
            return WorkspaceForkOutboxRow(
                operationId: DatabaseCore.columnText(statement: statement, index: 0),
                entityType: entityType,
                entityId: DatabaseCore.columnText(statement: statement, index: 2),
                payloadJson: DatabaseCore.columnText(statement: statement, index: 3)
            )
        }
    }

    private func rewrittenWorkspaceForkOutboxEntityId(
        row: WorkspaceForkOutboxRow,
        destinationWorkspaceId: String,
        forkMappings: WorkspaceForkIdMappings
    ) throws -> String {
        switch row.entityType {
        case .card:
            return try forkMappings.cardIdsBySourceId.requireMappedId(entityType: "card", sourceId: row.entityId)
        case .deck:
            return try forkMappings.deckIdsBySourceId.requireMappedId(entityType: "deck", sourceId: row.entityId)
        case .workspaceSchedulerSettings:
            return destinationWorkspaceId
        case .reviewEvent:
            return try forkMappings.reviewEventIdsBySourceId.requireMappedId(
                entityType: "review_event",
                sourceId: row.entityId
            )
        }
    }

    private func rewrittenWorkspaceForkOutboxPayloadJson(
        row: WorkspaceForkOutboxRow,
        forkMappings: WorkspaceForkIdMappings
    ) throws -> String {
        var payload = try self.core.decoder.decode(
            [String: WorkspaceForkJSONValue].self,
            from: Data(row.payloadJson.utf8)
        )

        switch row.entityType {
        case .card:
            let sourceCardId = try payload.requireString(fieldName: "cardId", context: "fork.outbox.card.cardId")
            payload["cardId"] = .string(
                try forkMappings.cardIdsBySourceId.requireMappedId(entityType: "card", sourceId: sourceCardId)
            )
        case .deck:
            let sourceDeckId = try payload.requireString(fieldName: "deckId", context: "fork.outbox.deck.deckId")
            payload["deckId"] = .string(
                try forkMappings.deckIdsBySourceId.requireMappedId(entityType: "deck", sourceId: sourceDeckId)
            )
        case .workspaceSchedulerSettings:
            break
        case .reviewEvent:
            let sourceReviewEventId = try payload.requireString(
                fieldName: "reviewEventId",
                context: "fork.outbox.reviewEvent.reviewEventId"
            )
            let sourceCardId = try payload.requireString(
                fieldName: "cardId",
                context: "fork.outbox.reviewEvent.cardId"
            )
            payload["reviewEventId"] = .string(
                try forkMappings.reviewEventIdsBySourceId.requireMappedId(
                    entityType: "review_event",
                    sourceId: sourceReviewEventId
                )
            )
            payload["cardId"] = .string(
                try forkMappings.cardIdsBySourceId.requireMappedId(entityType: "card", sourceId: sourceCardId)
            )
        }

        return try self.core.encodeJsonString(value: payload)
    }

    private func rewriteCardOutboxRowForPublicSyncConflict(
        row: WorkspaceForkOutboxRow,
        sourceCardId: String,
        replacementCardId: String
    ) throws {
        var payload: [String: WorkspaceForkJSONValue] = try self.decodeWorkspaceForkOutboxPayload(row: row)
        let payloadCardId: String = try payload.requireString(
            fieldName: "cardId",
            context: "publicSyncConflict.outbox.card.cardId"
        )
        let rowReferencesSource: Bool = row.entityId == sourceCardId
        let payloadReferencesSource: Bool = payloadCardId == sourceCardId
        guard rowReferencesSource == payloadReferencesSource else {
            throw LocalStoreError.database(
                "Public sync conflict recovery found mismatched card outbox ids for operation \(row.operationId): entityId=\(row.entityId) payload.cardId=\(payloadCardId)"
            )
        }
        guard rowReferencesSource else {
            return
        }

        payload["cardId"] = .string(replacementCardId)
        try self.updatePublicSyncConflictOutboxRow(
            operationId: row.operationId,
            entityId: replacementCardId,
            payload: payload
        )
    }

    private func rewriteDeckOutboxRowForPublicSyncConflict(
        row: WorkspaceForkOutboxRow,
        sourceDeckId: String,
        replacementDeckId: String
    ) throws {
        var payload: [String: WorkspaceForkJSONValue] = try self.decodeWorkspaceForkOutboxPayload(row: row)
        let payloadDeckId: String = try payload.requireString(
            fieldName: "deckId",
            context: "publicSyncConflict.outbox.deck.deckId"
        )
        let rowReferencesSource: Bool = row.entityId == sourceDeckId
        let payloadReferencesSource: Bool = payloadDeckId == sourceDeckId
        guard rowReferencesSource == payloadReferencesSource else {
            throw LocalStoreError.database(
                "Public sync conflict recovery found mismatched deck outbox ids for operation \(row.operationId): entityId=\(row.entityId) payload.deckId=\(payloadDeckId)"
            )
        }
        guard rowReferencesSource else {
            return
        }

        payload["deckId"] = .string(replacementDeckId)
        try self.updatePublicSyncConflictOutboxRow(
            operationId: row.operationId,
            entityId: replacementDeckId,
            payload: payload
        )
    }

    private func rewriteReviewEventOutboxCardReferenceForPublicSyncConflict(
        row: WorkspaceForkOutboxRow,
        sourceCardId: String,
        replacementCardId: String
    ) throws {
        var payload: [String: WorkspaceForkJSONValue] = try self.decodeWorkspaceForkOutboxPayload(row: row)
        let payloadCardId: String = try payload.requireString(
            fieldName: "cardId",
            context: "publicSyncConflict.outbox.reviewEvent.cardId"
        )
        guard payloadCardId == sourceCardId else {
            return
        }

        payload["cardId"] = .string(replacementCardId)
        try self.updatePublicSyncConflictOutboxRow(
            operationId: row.operationId,
            entityId: row.entityId,
            payload: payload
        )
    }

    private func rewriteReviewEventOutboxRowForPublicSyncConflict(
        row: WorkspaceForkOutboxRow,
        sourceReviewEventId: String,
        replacementReviewEventId: String
    ) throws {
        var payload: [String: WorkspaceForkJSONValue] = try self.decodeWorkspaceForkOutboxPayload(row: row)
        let payloadReviewEventId: String = try payload.requireString(
            fieldName: "reviewEventId",
            context: "publicSyncConflict.outbox.reviewEvent.reviewEventId"
        )
        let rowReferencesSource: Bool = row.entityId == sourceReviewEventId
        let payloadReferencesSource: Bool = payloadReviewEventId == sourceReviewEventId
        guard rowReferencesSource == payloadReferencesSource else {
            throw LocalStoreError.database(
                "Public sync conflict recovery found mismatched review_event outbox ids for operation \(row.operationId): entityId=\(row.entityId) payload.reviewEventId=\(payloadReviewEventId)"
            )
        }
        guard rowReferencesSource else {
            return
        }

        payload["reviewEventId"] = .string(replacementReviewEventId)
        try self.updatePublicSyncConflictOutboxRow(
            operationId: row.operationId,
            entityId: replacementReviewEventId,
            payload: payload
        )
    }

    private func decodeWorkspaceForkOutboxPayload(
        row: WorkspaceForkOutboxRow
    ) throws -> [String: WorkspaceForkJSONValue] {
        try self.core.decoder.decode(
            [String: WorkspaceForkJSONValue].self,
            from: Data(row.payloadJson.utf8)
        )
    }

    private func updatePublicSyncConflictOutboxRow(
        operationId: String,
        entityId: String,
        payload: [String: WorkspaceForkJSONValue]
    ) throws {
        try self.core.execute(
            sql: """
            UPDATE outbox
            SET entity_id = ?, payload_json = ?, last_error = NULL
            WHERE operation_id = ?
            """,
            values: [
                .text(entityId),
                .text(try self.core.encodeJsonString(value: payload)),
                .text(operationId)
            ]
        )
    }
}
