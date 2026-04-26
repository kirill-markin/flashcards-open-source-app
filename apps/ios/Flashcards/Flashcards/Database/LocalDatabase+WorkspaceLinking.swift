import CryptoKit
import Foundation

private let cardIdentityForkNamespace: UUID = UUID(uuidString: "5b0c7f2e-6f2a-4b7e-9e1b-2b5f0a4a91b1")!
private let deckIdentityForkNamespace: UUID = UUID(uuidString: "98e66f2c-d3c7-4e3f-a7df-55d8e19ad2b4")!
private let reviewEventIdentityForkNamespace: UUID = UUID(uuidString: "3a214a3e-9c89-426d-a21f-11a5f5c1d6e8")!
private let workspaceForkReviewEventSelectBatchSize: Int = 500
private let publicSyncConflictReIdMaxAttempts: Int = 5

struct PublicSyncConflictReIdRecovery: Hashable {
    let entityType: SyncEntityType
    let sourceEntityId: String
    let replacementEntityId: String
}

private struct WorkspaceForkIdMappings {
    let cardIdsBySourceId: [String: String]
    let deckIdsBySourceId: [String: String]
    let reviewEventIdsBySourceId: [String: String]
}

private struct WorkspaceForkReviewEventRow {
    let sourceReviewEventId: String
    let sourceCardId: String
    let replicaId: String
    let clientEventId: String
    let rating: Int64
    let reviewedAtClient: String
    let reviewedAtServer: String
}

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

func forkedCardIdForWorkspace(
    sourceWorkspaceId: String,
    destinationWorkspaceId: String,
    sourceCardId: String
) -> String {
    forkedWorkspaceEntityId(
        namespace: cardIdentityForkNamespace,
        sourceWorkspaceId: sourceWorkspaceId,
        destinationWorkspaceId: destinationWorkspaceId,
        sourceEntityId: sourceCardId
    )
}

func forkedDeckIdForWorkspace(
    sourceWorkspaceId: String,
    destinationWorkspaceId: String,
    sourceDeckId: String
) -> String {
    forkedWorkspaceEntityId(
        namespace: deckIdentityForkNamespace,
        sourceWorkspaceId: sourceWorkspaceId,
        destinationWorkspaceId: destinationWorkspaceId,
        sourceEntityId: sourceDeckId
    )
}

func forkedReviewEventIdForWorkspace(
    sourceWorkspaceId: String,
    destinationWorkspaceId: String,
    sourceReviewEventId: String
) -> String {
    forkedWorkspaceEntityId(
        namespace: reviewEventIdentityForkNamespace,
        sourceWorkspaceId: sourceWorkspaceId,
        destinationWorkspaceId: destinationWorkspaceId,
        sourceEntityId: sourceReviewEventId
    )
}

private func forkedWorkspaceEntityId(
    namespace: UUID,
    sourceWorkspaceId: String,
    destinationWorkspaceId: String,
    sourceEntityId: String
) -> String {
    if sourceWorkspaceId == destinationWorkspaceId {
        return sourceEntityId
    }

    let name = "\(sourceWorkspaceId):\(destinationWorkspaceId):\(sourceEntityId)"
    return uuidV5(namespace: namespace, name: name).uuidString.lowercased()
}

private func uuidV5(namespace: UUID, name: String) -> UUID {
    let hashInput = namespace.bigEndianBytes + Array(name.utf8)
    var hash = Array(Insecure.SHA1.hash(data: Data(hashInput)))
    hash[6] = (hash[6] & 0x0f) | 0x50
    hash[8] = (hash[8] & 0x3f) | 0x80
    return UUID(uuid: (
        hash[0],
        hash[1],
        hash[2],
        hash[3],
        hash[4],
        hash[5],
        hash[6],
        hash[7],
        hash[8],
        hash[9],
        hash[10],
        hash[11],
        hash[12],
        hash[13],
        hash[14],
        hash[15]
    ))
}

private extension UUID {
    var bigEndianBytes: [UInt8] {
        [
            self.uuid.0,
            self.uuid.1,
            self.uuid.2,
            self.uuid.3,
            self.uuid.4,
            self.uuid.5,
            self.uuid.6,
            self.uuid.7,
            self.uuid.8,
            self.uuid.9,
            self.uuid.10,
            self.uuid.11,
            self.uuid.12,
            self.uuid.13,
            self.uuid.14,
            self.uuid.15,
        ]
    }
}

private extension Dictionary where Key == String, Value == String {
    func requireMappedId(entityType: String, sourceId: String) throws -> String {
        guard let mappedId = self[sourceId] else {
            throw LocalStoreError.database(
                "Workspace identity fork is missing mapped \(entityType) id for source id '\(sourceId)'"
            )
        }

        return mappedId
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

extension LocalDatabase {
    func updateCloudSettings(
        cloudState: CloudAccountState,
        linkedUserId: String?,
        linkedWorkspaceId: String?,
        activeWorkspaceId: String?,
        linkedEmail: String?
    ) throws {
        try self.workspaceSettingsStore.updateCloudSettings(
            cloudState: cloudState,
            linkedUserId: linkedUserId,
            linkedWorkspaceId: linkedWorkspaceId,
            activeWorkspaceId: activeWorkspaceId,
            linkedEmail: linkedEmail
        )
    }

    func updateWorkspaceName(workspaceId: String, name: String) throws -> Workspace {
        try self.workspaceSettingsStore.updateWorkspaceName(workspaceId: workspaceId, name: name)
    }

    func switchActiveWorkspace(
        workspace: CloudWorkspaceSummary,
        linkedSession: CloudLinkedSession
    ) throws {
        try self.core.inTransaction {
            try self.ensureLinkedWorkspaceShell(workspace: workspace)
            try self.ensureSyncStateExists(workspaceId: workspace.workspaceId)
            try self.updateAccountWorkspaceReference(workspaceId: workspace.workspaceId)
            try self.workspaceSettingsStore.updateCloudSettings(
                cloudState: .linked,
                linkedUserId: linkedSession.userId,
                linkedWorkspaceId: workspace.workspaceId,
                activeWorkspaceId: workspace.workspaceId,
                linkedEmail: linkedSession.email
            )
        }
    }

    /**
     Migrates the current local workspace shell into a linked workspace target.

     `sync_state` belongs to the remote workspace identity, not to whichever
     local rows currently happen to exist on device. When the workspace id
     changes we therefore never carry hot/review cursors across. For an empty
     remote workspace we preserve local cards/decks/reviews and recreate fresh
     sync state. For a non-empty remote workspace we discard the old local shell
     and rehydrate from the server.
     */
    func migrateLocalWorkspaceToLinkedWorkspace(
        localWorkspaceId: String,
        linkedSession: CloudLinkedSession,
        remoteWorkspaceIsEmpty: Bool
    ) throws {
        if localWorkspaceId == linkedSession.workspaceId {
            try self.updateCloudSettings(
                cloudState: .linked,
                linkedUserId: linkedSession.userId,
                linkedWorkspaceId: linkedSession.workspaceId,
                activeWorkspaceId: linkedSession.workspaceId,
                linkedEmail: linkedSession.email
            )
            return
        }

        try self.core.inTransaction {
            if remoteWorkspaceIsEmpty {
                try self.preserveLocalDataForEmptyRemoteWorkspace(
                    sourceWorkspaceId: localWorkspaceId,
                    destinationWorkspaceId: linkedSession.workspaceId
                )
            } else {
                try self.replaceLocalShellForNonEmptyRemoteWorkspace(
                    sourceWorkspaceId: localWorkspaceId,
                    destinationWorkspaceId: linkedSession.workspaceId
                )
            }

            try self.deleteOtherWorkspaces(exceptWorkspaceId: linkedSession.workspaceId)
            try self.assertSingleWorkspaceInvariant(expectedWorkspaceId: linkedSession.workspaceId)
            try self.workspaceSettingsStore.updateCloudSettings(
                cloudState: .linked,
                linkedUserId: linkedSession.userId,
                linkedWorkspaceId: linkedSession.workspaceId,
                activeWorkspaceId: linkedSession.workspaceId,
                linkedEmail: linkedSession.email
            )
        }
    }

    /**
     Switches local storage after backend guest-upgrade completion.

     Backend completion only merges guest cloud state that was already synced,
     so this path never migrates pending guest outbox rows into the linked
     workspace. Remaining local hydration comes from ordinary linked sync.
     */
    func switchGuestUpgradeToLinkedWorkspaceFromRemote(
        localWorkspaceId: String,
        linkedSession: CloudLinkedSession,
        workspace: CloudWorkspaceSummary
    ) throws {
        guard linkedSession.workspaceId == workspace.workspaceId else {
            throw LocalStoreError.database(
                "Guest upgrade linked session workspace does not match selected workspace: session=\(linkedSession.workspaceId) selected=\(workspace.workspaceId)"
            )
        }

        try self.core.inTransaction {
            if localWorkspaceId == workspace.workspaceId {
                try self.ensureLinkedWorkspaceShell(workspace: workspace)
                try self.updateAccountWorkspaceReference(workspaceId: workspace.workspaceId)
            } else {
                try self.assertNoPendingOutboxEntriesBeforeGuestWorkspaceDelete(workspaceId: localWorkspaceId)
                try self.deleteWorkspaceIfExists(workspaceId: workspace.workspaceId)
                try self.ensureLinkedWorkspaceShell(workspace: workspace)
                try self.resetSyncState(workspaceId: workspace.workspaceId)
                try self.updateAccountWorkspaceReference(workspaceId: workspace.workspaceId)
                try self.deleteWorkspaceIfExists(workspaceId: localWorkspaceId)
            }
            try self.deleteOtherWorkspaces(exceptWorkspaceId: workspace.workspaceId)
            try self.assertSingleWorkspaceInvariant(expectedWorkspaceId: workspace.workspaceId)
            try self.workspaceSettingsStore.updateCloudSettings(
                cloudState: .linked,
                linkedUserId: linkedSession.userId,
                linkedWorkspaceId: workspace.workspaceId,
                activeWorkspaceId: workspace.workspaceId,
                linkedEmail: linkedSession.email
            )
        }
    }

    func repairLocalIdForPublicSyncConflict(
        workspaceId: String,
        syncConflict: CloudSyncConflictDetails
    ) throws -> PublicSyncConflictReIdRecovery {
        guard syncConflict.recoverable else {
            throw LocalStoreError.validation(
                "Public sync conflict is not recoverable for \(syncConflict.entityType.rawValue) \(syncConflict.entityId)"
            )
        }

        return try self.core.inTransaction {
            let replacementEntityId: String = try self.makeFreshPublicSyncConflictEntityId(
                entityType: syncConflict.entityType
            )

            switch syncConflict.entityType {
            case .card:
                try self.rewriteLocalCardIdForPublicSyncConflict(
                    workspaceId: workspaceId,
                    sourceCardId: syncConflict.entityId,
                    replacementCardId: replacementEntityId
                )
            case .deck:
                try self.rewriteLocalDeckIdForPublicSyncConflict(
                    workspaceId: workspaceId,
                    sourceDeckId: syncConflict.entityId,
                    replacementDeckId: replacementEntityId
                )
            case .reviewEvent:
                try self.rewriteLocalReviewEventIdForPublicSyncConflict(
                    workspaceId: workspaceId,
                    sourceReviewEventId: syncConflict.entityId,
                    replacementReviewEventId: replacementEntityId
                )
            case .workspaceSchedulerSettings:
                throw LocalStoreError.validation(
                    "Public sync conflict recovery cannot re-id workspace scheduler settings for workspace \(workspaceId)"
                )
            }

            return PublicSyncConflictReIdRecovery(
                entityType: syncConflict.entityType,
                sourceEntityId: syncConflict.entityId,
                replacementEntityId: replacementEntityId
            )
        }
    }

    func replaceLocalWorkspaceAfterRemoteDelete(
        localWorkspaceId: String,
        replacementWorkspace: CloudWorkspaceSummary,
        linkedSession: CloudLinkedSession
    ) throws {
        try self.core.inTransaction {
            try self.deleteWorkspaceIfExists(workspaceId: replacementWorkspace.workspaceId)
            try self.ensureLinkedWorkspaceShell(workspace: replacementWorkspace)
            try self.resetSyncState(workspaceId: replacementWorkspace.workspaceId)
            try self.updateAccountWorkspaceReference(workspaceId: replacementWorkspace.workspaceId)
            try self.deleteWorkspaceIfExists(workspaceId: localWorkspaceId)
            try self.deleteOtherWorkspaces(exceptWorkspaceId: replacementWorkspace.workspaceId)
            try self.assertSingleWorkspaceInvariant(expectedWorkspaceId: replacementWorkspace.workspaceId)
            try self.workspaceSettingsStore.updateCloudSettings(
                cloudState: .linked,
                linkedUserId: linkedSession.userId,
                linkedWorkspaceId: replacementWorkspace.workspaceId,
                activeWorkspaceId: replacementWorkspace.workspaceId,
                linkedEmail: linkedSession.email
            )
        }
    }

    func resetForAccountDeletion() throws {
        try self.core.resetForAccountDeletion()
    }

    private func assertNoPendingOutboxEntriesBeforeGuestWorkspaceDelete(workspaceId: String) throws {
        let pendingOutboxCount = try self.core.scalarInt(
            sql: "SELECT COUNT(*) FROM outbox WHERE workspace_id = ?",
            values: [.text(workspaceId)]
        )
        guard pendingOutboxCount == 0 else {
            throw LocalStoreError.database(
                "Guest upgrade cannot delete workspace \(workspaceId) because \(pendingOutboxCount) pending guest outbox entries remain."
            )
        }
    }

    private func insertWorkspaceFromLocalSettings(
        workspaceId: String,
        name: String,
        createdAt: String,
        settings: WorkspaceSchedulerSettings
    ) throws {
        try self.core.execute(
            sql: """
            INSERT INTO workspaces (
                workspace_id,
                name,
                created_at,
                fsrs_algorithm,
                fsrs_desired_retention,
                fsrs_learning_steps_minutes_json,
                fsrs_relearning_steps_minutes_json,
                fsrs_maximum_interval_days,
                fsrs_enable_fuzz,
                fsrs_client_updated_at,
                fsrs_last_modified_by_replica_id,
                fsrs_last_operation_id,
                fsrs_updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            values: [
                .text(workspaceId),
                .text(name),
                .text(createdAt),
                .text(settings.algorithm),
                .real(settings.desiredRetention),
                .text(try self.workspaceSettingsStore.encodeIntegerArray(values: settings.learningStepsMinutes)),
                .text(try self.workspaceSettingsStore.encodeIntegerArray(values: settings.relearningStepsMinutes)),
                .integer(Int64(settings.maximumIntervalDays)),
                .integer(settings.enableFuzz ? 1 : 0),
                .text(settings.clientUpdatedAt),
                .text(settings.lastModifiedByReplicaId),
                .text(settings.lastOperationId),
                .text(settings.updatedAt)
            ]
        )
    }

    private func insertWorkspaceShell(workspace: CloudWorkspaceSummary) throws {
        let cloudSettings = try self.workspaceSettingsStore.loadCloudSettings()
        let now = nowIsoTimestamp()
        let operationId = UUID().uuidString.lowercased()
        try self.core.execute(
            sql: """
            INSERT INTO workspaces (
                workspace_id,
                name,
                created_at,
                fsrs_algorithm,
                fsrs_desired_retention,
                fsrs_learning_steps_minutes_json,
                fsrs_relearning_steps_minutes_json,
                fsrs_maximum_interval_days,
                fsrs_enable_fuzz,
                fsrs_client_updated_at,
                fsrs_last_modified_by_replica_id,
                fsrs_last_operation_id,
                fsrs_updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            values: [
                .text(workspace.workspaceId),
                .text(workspace.name),
                .text(workspace.createdAt),
                .text(defaultSchedulerSettingsConfig.algorithm),
                .real(defaultSchedulerSettingsConfig.desiredRetention),
                .text(defaultSchedulerSettingsConfig.learningStepsMinutesJson),
                .text(defaultSchedulerSettingsConfig.relearningStepsMinutesJson),
                .integer(Int64(defaultSchedulerSettingsConfig.maximumIntervalDays)),
                .integer(defaultSchedulerSettingsConfig.enableFuzz ? 1 : 0),
                .text(now),
                .text(cloudSettings.installationId),
                .text(operationId),
                .text(now)
            ]
        )
    }

    private func ensureLinkedWorkspaceShell(workspace: CloudWorkspaceSummary) throws {
        let existingWorkspaceCount = try self.core.scalarInt(
            sql: "SELECT COUNT(*) FROM workspaces WHERE workspace_id = ?",
            values: [.text(workspace.workspaceId)]
        )

        if existingWorkspaceCount == 0 {
            try self.insertWorkspaceShell(workspace: workspace)
            return
        }

        _ = try self.core.execute(
            sql: """
            UPDATE workspaces
            SET name = ?, created_at = ?
            WHERE workspace_id = ?
            """,
            values: [
                .text(workspace.name),
                .text(workspace.createdAt),
                .text(workspace.workspaceId)
            ]
        )
    }

    private func ensureSyncStateExists(workspaceId: String) throws {
        let syncStateCount = try self.core.scalarInt(
            sql: "SELECT COUNT(*) FROM sync_state WHERE workspace_id = ?",
            values: [.text(workspaceId)]
        )
        if syncStateCount == 0 {
            try self.core.execute(
                sql: """
                INSERT INTO sync_state (
                    workspace_id,
                    last_applied_hot_change_id,
                    last_applied_review_sequence_id,
                    has_hydrated_hot_state,
                    has_hydrated_review_history,
                    updated_at
                )
                VALUES (?, 0, 0, 0, 0, ?)
                """,
                values: [
                    .text(workspaceId),
                    .text(nowIsoTimestamp())
                ]
            )
        }
    }

    private func resetSyncState(workspaceId: String) throws {
        _ = try self.core.execute(
            sql: "DELETE FROM sync_state WHERE workspace_id = ?",
            values: [.text(workspaceId)]
        )
        try self.ensureSyncStateExists(workspaceId: workspaceId)
    }

    private func makeFreshPublicSyncConflictEntityId(entityType: SyncEntityType) throws -> String {
        var attemptIndex: Int = 0
        while attemptIndex < publicSyncConflictReIdMaxAttempts {
            let candidateId: String = UUID().uuidString.lowercased()
            if try self.publicSyncConflictEntityExists(entityType: entityType, entityId: candidateId) == false {
                return candidateId
            }

            attemptIndex += 1
        }

        throw LocalStoreError.database(
            "Failed to generate a fresh local id for \(entityType.rawValue) after \(publicSyncConflictReIdMaxAttempts) attempts"
        )
    }

    private func publicSyncConflictEntityExists(entityType: SyncEntityType, entityId: String) throws -> Bool {
        switch entityType {
        case .card:
            return try self.core.scalarInt(
                sql: "SELECT COUNT(*) FROM cards WHERE card_id = ?",
                values: [.text(entityId)]
            ) > 0
        case .deck:
            return try self.core.scalarInt(
                sql: "SELECT COUNT(*) FROM decks WHERE deck_id = ?",
                values: [.text(entityId)]
            ) > 0
        case .reviewEvent:
            return try self.core.scalarInt(
                sql: "SELECT COUNT(*) FROM review_events WHERE review_event_id = ?",
                values: [.text(entityId)]
            ) > 0
        case .workspaceSchedulerSettings:
            return try self.core.scalarInt(
                sql: "SELECT COUNT(*) FROM workspaces WHERE workspace_id = ?",
                values: [.text(entityId)]
            ) > 0
        }
    }

    private func rewriteLocalCardIdForPublicSyncConflict(
        workspaceId: String,
        sourceCardId: String,
        replacementCardId: String
    ) throws {
        let insertedRows: Int = try self.core.execute(
            sql: """
            INSERT INTO cards (
                card_id,
                workspace_id,
                front_text,
                back_text,
                tags_json,
                effort_level,
                due_at,
                created_at,
                reps,
                lapses,
                fsrs_card_state,
                fsrs_step_index,
                fsrs_stability,
                fsrs_difficulty,
                fsrs_last_reviewed_at,
                fsrs_scheduled_days,
                client_updated_at,
                last_modified_by_replica_id,
                last_operation_id,
                updated_at,
                deleted_at
            )
            SELECT
                ?,
                workspace_id,
                front_text,
                back_text,
                tags_json,
                effort_level,
                due_at,
                created_at,
                reps,
                lapses,
                fsrs_card_state,
                fsrs_step_index,
                fsrs_stability,
                fsrs_difficulty,
                fsrs_last_reviewed_at,
                fsrs_scheduled_days,
                client_updated_at,
                last_modified_by_replica_id,
                last_operation_id,
                updated_at,
                deleted_at
            FROM cards
            WHERE workspace_id = ? AND card_id = ?
            """,
            values: [
                .text(replacementCardId),
                .text(workspaceId),
                .text(sourceCardId)
            ]
        )
        guard insertedRows == 1 else {
            throw LocalStoreError.database(
                "Public sync conflict recovery could not find local card \(sourceCardId) in workspace \(workspaceId)"
            )
        }

        _ = try self.core.execute(
            sql: """
            UPDATE card_tags
            SET card_id = ?
            WHERE workspace_id = ? AND card_id = ?
            """,
            values: [
                .text(replacementCardId),
                .text(workspaceId),
                .text(sourceCardId)
            ]
        )
        _ = try self.core.execute(
            sql: """
            UPDATE review_events
            SET card_id = ?
            WHERE workspace_id = ? AND card_id = ?
            """,
            values: [
                .text(replacementCardId),
                .text(workspaceId),
                .text(sourceCardId)
            ]
        )
        try self.rewriteOutboxForCardPublicSyncConflict(
            workspaceId: workspaceId,
            sourceCardId: sourceCardId,
            replacementCardId: replacementCardId
        )

        let deletedRows: Int = try self.core.execute(
            sql: "DELETE FROM cards WHERE workspace_id = ? AND card_id = ?",
            values: [
                .text(workspaceId),
                .text(sourceCardId)
            ]
        )
        guard deletedRows == 1 else {
            throw LocalStoreError.database(
                "Public sync conflict recovery could not remove source card \(sourceCardId) in workspace \(workspaceId)"
            )
        }
    }

    private func rewriteLocalDeckIdForPublicSyncConflict(
        workspaceId: String,
        sourceDeckId: String,
        replacementDeckId: String
    ) throws {
        let insertedRows: Int = try self.core.execute(
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
            SELECT
                ?,
                workspace_id,
                name,
                filter_definition_json,
                created_at,
                client_updated_at,
                last_modified_by_replica_id,
                last_operation_id,
                updated_at,
                deleted_at
            FROM decks
            WHERE workspace_id = ? AND deck_id = ?
            """,
            values: [
                .text(replacementDeckId),
                .text(workspaceId),
                .text(sourceDeckId)
            ]
        )
        guard insertedRows == 1 else {
            throw LocalStoreError.database(
                "Public sync conflict recovery could not find local deck \(sourceDeckId) in workspace \(workspaceId)"
            )
        }

        try self.rewriteOutboxForDeckPublicSyncConflict(
            workspaceId: workspaceId,
            sourceDeckId: sourceDeckId,
            replacementDeckId: replacementDeckId
        )

        let deletedRows: Int = try self.core.execute(
            sql: "DELETE FROM decks WHERE workspace_id = ? AND deck_id = ?",
            values: [
                .text(workspaceId),
                .text(sourceDeckId)
            ]
        )
        guard deletedRows == 1 else {
            throw LocalStoreError.database(
                "Public sync conflict recovery could not remove source deck \(sourceDeckId) in workspace \(workspaceId)"
            )
        }
    }

    private func rewriteLocalReviewEventIdForPublicSyncConflict(
        workspaceId: String,
        sourceReviewEventId: String,
        replacementReviewEventId: String
    ) throws {
        let updatedRows: Int = try self.core.execute(
            sql: """
            UPDATE review_events
            SET review_event_id = ?
            WHERE workspace_id = ? AND review_event_id = ?
            """,
            values: [
                .text(replacementReviewEventId),
                .text(workspaceId),
                .text(sourceReviewEventId)
            ]
        )
        guard updatedRows == 1 else {
            throw LocalStoreError.database(
                "Public sync conflict recovery could not find local review_event \(sourceReviewEventId) in workspace \(workspaceId)"
            )
        }

        try self.rewriteOutboxForReviewEventPublicSyncConflict(
            workspaceId: workspaceId,
            sourceReviewEventId: sourceReviewEventId,
            replacementReviewEventId: replacementReviewEventId
        )
    }

    private func updateAccountWorkspaceReference(workspaceId: String) throws {
        _ = try self.core.execute(
            sql: """
            UPDATE user_settings
            SET workspace_id = ?
            """,
            values: [.text(workspaceId)]
        )
    }

    private func preserveLocalDataForEmptyRemoteWorkspace(
        sourceWorkspaceId: String,
        destinationWorkspaceId: String
    ) throws {
        let localWorkspace = try self.workspaceSettingsStore.loadWorkspace()
        let currentSettings = try self.workspaceSettingsStore.loadWorkspaceSchedulerSettings(workspaceId: sourceWorkspaceId)
        let forkMappings = try self.loadWorkspaceForkIdMappings(
            sourceWorkspaceId: sourceWorkspaceId,
            destinationWorkspaceId: destinationWorkspaceId
        )

        try self.deleteWorkspaceIfExists(workspaceId: destinationWorkspaceId)
        try self.insertWorkspaceFromLocalSettings(
            workspaceId: destinationWorkspaceId,
            name: localWorkspace.name,
            createdAt: localWorkspace.createdAt,
            settings: currentSettings
        )

        try self.insertForkedCards(
            sourceWorkspaceId: sourceWorkspaceId,
            destinationWorkspaceId: destinationWorkspaceId,
            forkMappings: forkMappings
        )
        try self.insertForkedDecks(
            sourceWorkspaceId: sourceWorkspaceId,
            destinationWorkspaceId: destinationWorkspaceId,
            forkMappings: forkMappings
        )
        try self.insertForkedCardTags(
            sourceWorkspaceId: sourceWorkspaceId,
            destinationWorkspaceId: destinationWorkspaceId,
            forkMappings: forkMappings
        )
        try self.insertForkedReviewEvents(
            sourceWorkspaceId: sourceWorkspaceId,
            destinationWorkspaceId: destinationWorkspaceId,
            forkMappings: forkMappings
        )
        try self.rewriteOutboxForWorkspaceFork(
            sourceWorkspaceId: sourceWorkspaceId,
            destinationWorkspaceId: destinationWorkspaceId,
            forkMappings: forkMappings
        )

        try self.updateAccountWorkspaceReference(workspaceId: destinationWorkspaceId)
        try self.deleteWorkspaceIfExists(workspaceId: sourceWorkspaceId)
        try self.resetSyncState(workspaceId: destinationWorkspaceId)
    }

    private func loadWorkspaceForkIdMappings(
        sourceWorkspaceId: String,
        destinationWorkspaceId: String
    ) throws -> WorkspaceForkIdMappings {
        let cardIds = try self.loadEntityIds(
            sql: "SELECT card_id FROM cards WHERE workspace_id = ? ORDER BY card_id ASC",
            workspaceId: sourceWorkspaceId
        )
        let deckIds = try self.loadEntityIds(
            sql: "SELECT deck_id FROM decks WHERE workspace_id = ? ORDER BY deck_id ASC",
            workspaceId: sourceWorkspaceId
        )
        let reviewEventIds = try self.loadEntityIds(
            sql: "SELECT review_event_id FROM review_events WHERE workspace_id = ? ORDER BY review_event_id ASC",
            workspaceId: sourceWorkspaceId
        )

        return WorkspaceForkIdMappings(
            cardIdsBySourceId: Dictionary(uniqueKeysWithValues: cardIds.map { cardId in
                (
                    cardId,
                    forkedCardIdForWorkspace(
                        sourceWorkspaceId: sourceWorkspaceId,
                        destinationWorkspaceId: destinationWorkspaceId,
                        sourceCardId: cardId
                    )
                )
            }),
            deckIdsBySourceId: Dictionary(uniqueKeysWithValues: deckIds.map { deckId in
                (
                    deckId,
                    forkedDeckIdForWorkspace(
                        sourceWorkspaceId: sourceWorkspaceId,
                        destinationWorkspaceId: destinationWorkspaceId,
                        sourceDeckId: deckId
                    )
                )
            }),
            reviewEventIdsBySourceId: Dictionary(uniqueKeysWithValues: reviewEventIds.map { reviewEventId in
                (
                    reviewEventId,
                    forkedReviewEventIdForWorkspace(
                        sourceWorkspaceId: sourceWorkspaceId,
                        destinationWorkspaceId: destinationWorkspaceId,
                        sourceReviewEventId: reviewEventId
                    )
                )
            })
        )
    }

    private func loadEntityIds(sql: String, workspaceId: String) throws -> [String] {
        try self.core.query(
            sql: sql,
            values: [.text(workspaceId)]
        ) { statement in
            DatabaseCore.columnText(statement: statement, index: 0)
        }
    }

    private func insertForkedCards(
        sourceWorkspaceId: String,
        destinationWorkspaceId: String,
        forkMappings: WorkspaceForkIdMappings
    ) throws {
        for (sourceCardId, destinationCardId) in forkMappings.cardIdsBySourceId {
            try self.core.execute(
                sql: """
                INSERT INTO cards (
                    card_id,
                    workspace_id,
                    front_text,
                    back_text,
                    tags_json,
                    effort_level,
                    due_at,
                    created_at,
                    reps,
                    lapses,
                    fsrs_card_state,
                    fsrs_step_index,
                    fsrs_stability,
                    fsrs_difficulty,
                    fsrs_last_reviewed_at,
                    fsrs_scheduled_days,
                    client_updated_at,
                    last_modified_by_replica_id,
                    last_operation_id,
                    updated_at,
                    deleted_at
                )
                SELECT
                    ?,
                    ?,
                    front_text,
                    back_text,
                    tags_json,
                    effort_level,
                    due_at,
                    created_at,
                    reps,
                    lapses,
                    fsrs_card_state,
                    fsrs_step_index,
                    fsrs_stability,
                    fsrs_difficulty,
                    fsrs_last_reviewed_at,
                    fsrs_scheduled_days,
                    client_updated_at,
                    last_modified_by_replica_id,
                    last_operation_id,
                    updated_at,
                    deleted_at
                FROM cards
                WHERE workspace_id = ? AND card_id = ?
                """,
                values: [
                    .text(destinationCardId),
                    .text(destinationWorkspaceId),
                    .text(sourceWorkspaceId),
                    .text(sourceCardId)
                ]
            )
        }
    }

    private func insertForkedDecks(
        sourceWorkspaceId: String,
        destinationWorkspaceId: String,
        forkMappings: WorkspaceForkIdMappings
    ) throws {
        for (sourceDeckId, destinationDeckId) in forkMappings.deckIdsBySourceId {
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
                SELECT
                    ?,
                    ?,
                    name,
                    filter_definition_json,
                    created_at,
                    client_updated_at,
                    last_modified_by_replica_id,
                    last_operation_id,
                    updated_at,
                    deleted_at
                FROM decks
                WHERE workspace_id = ? AND deck_id = ?
                """,
                values: [
                    .text(destinationDeckId),
                    .text(destinationWorkspaceId),
                    .text(sourceWorkspaceId),
                    .text(sourceDeckId)
                ]
            )
        }
    }

    private func insertForkedCardTags(
        sourceWorkspaceId: String,
        destinationWorkspaceId: String,
        forkMappings: WorkspaceForkIdMappings
    ) throws {
        let cardTags = try self.core.query(
            sql: """
            SELECT card_id, tag
            FROM card_tags
            WHERE workspace_id = ?
            ORDER BY card_id ASC, tag ASC
            """,
            values: [.text(sourceWorkspaceId)]
        ) { statement in
            (
                DatabaseCore.columnText(statement: statement, index: 0),
                DatabaseCore.columnText(statement: statement, index: 1)
            )
        }

        for (sourceCardId, tag) in cardTags {
            try self.core.execute(
                sql: """
                INSERT INTO card_tags (workspace_id, card_id, tag)
                VALUES (?, ?, ?)
                """,
                values: [
                    .text(destinationWorkspaceId),
                    .text(try forkMappings.cardIdsBySourceId.requireMappedId(entityType: "card", sourceId: sourceCardId)),
                    .text(tag)
                ]
            )
        }
    }

    private func insertForkedReviewEvents(
        sourceWorkspaceId: String,
        destinationWorkspaceId: String,
        forkMappings: WorkspaceForkIdMappings
    ) throws {
        let sourceReviewEventIds: [String] = forkMappings.reviewEventIdsBySourceId.keys.sorted()
        let sourceReviewEvents: [WorkspaceForkReviewEventRow] = try self.loadWorkspaceForkReviewEvents(
            sourceWorkspaceId: sourceWorkspaceId,
            sourceReviewEventIds: sourceReviewEventIds
        )

        for sourceReviewEvent in sourceReviewEvents {
            let destinationReviewEventId: String = try forkMappings.reviewEventIdsBySourceId.requireMappedId(
                entityType: "review_event",
                sourceId: sourceReviewEvent.sourceReviewEventId
            )
            let destinationCardId: String = try forkMappings.cardIdsBySourceId.requireMappedId(
                entityType: "card",
                sourceId: sourceReviewEvent.sourceCardId
            )
            try self.core.execute(
                sql: """
                INSERT INTO review_events (
                    review_event_id,
                    workspace_id,
                    card_id,
                    replica_id,
                    client_event_id,
                    rating,
                    reviewed_at_client,
                    reviewed_at_server
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                values: [
                    .text(destinationReviewEventId),
                    .text(destinationWorkspaceId),
                    .text(destinationCardId),
                    .text(sourceReviewEvent.replicaId),
                    .text(sourceReviewEvent.clientEventId),
                    .integer(sourceReviewEvent.rating),
                    .text(sourceReviewEvent.reviewedAtClient),
                    .text(sourceReviewEvent.reviewedAtServer)
                ]
            )
        }
    }

    private func loadWorkspaceForkReviewEvents(
        sourceWorkspaceId: String,
        sourceReviewEventIds: [String]
    ) throws -> [WorkspaceForkReviewEventRow] {
        guard sourceReviewEventIds.isEmpty == false else {
            return []
        }

        var rows: [WorkspaceForkReviewEventRow] = []
        var batchStartIndex: Int = 0
        while batchStartIndex < sourceReviewEventIds.count {
            let batchEndIndex: Int = min(
                batchStartIndex + workspaceForkReviewEventSelectBatchSize,
                sourceReviewEventIds.count
            )
            let batchReviewEventIds: [String] = Array(sourceReviewEventIds[batchStartIndex..<batchEndIndex])
            rows.append(contentsOf: try self.loadWorkspaceForkReviewEventBatch(
                sourceWorkspaceId: sourceWorkspaceId,
                sourceReviewEventIds: batchReviewEventIds
            ))
            batchStartIndex = batchEndIndex
        }

        return rows
    }

    private func loadWorkspaceForkReviewEventBatch(
        sourceWorkspaceId: String,
        sourceReviewEventIds: [String]
    ) throws -> [WorkspaceForkReviewEventRow] {
        guard sourceReviewEventIds.isEmpty == false else {
            return []
        }

        let placeholders: String = sourceReviewEventIds.map { _ in "?" }.joined(separator: ", ")
        let rows: [WorkspaceForkReviewEventRow] = try self.core.query(
            sql: """
            SELECT review_event_id, card_id, replica_id, client_event_id, rating, reviewed_at_client, reviewed_at_server
            FROM review_events
            WHERE workspace_id = ? AND review_event_id IN (\(placeholders))
            ORDER BY review_event_id ASC
            """,
            values: [.text(sourceWorkspaceId)] + sourceReviewEventIds.map { sourceReviewEventId in
                .text(sourceReviewEventId)
            }
        ) { statement in
            WorkspaceForkReviewEventRow(
                sourceReviewEventId: DatabaseCore.columnText(statement: statement, index: 0),
                sourceCardId: DatabaseCore.columnText(statement: statement, index: 1),
                replicaId: DatabaseCore.columnText(statement: statement, index: 2),
                clientEventId: DatabaseCore.columnText(statement: statement, index: 3),
                rating: DatabaseCore.columnInt64(statement: statement, index: 4),
                reviewedAtClient: DatabaseCore.columnText(statement: statement, index: 5),
                reviewedAtServer: DatabaseCore.columnText(statement: statement, index: 6)
            )
        }

        let loadedReviewEventIds: Set<String> = Set(rows.map(\.sourceReviewEventId))
        let missingReviewEventIds: [String] = sourceReviewEventIds.filter { sourceReviewEventId in
            loadedReviewEventIds.contains(sourceReviewEventId) == false
        }
        guard missingReviewEventIds.isEmpty else {
            throw LocalStoreError.database(
                "Workspace identity fork is missing source review_event rows: \(missingReviewEventIds.joined(separator: ", "))"
            )
        }

        return rows
    }

    private func rewriteOutboxForWorkspaceFork(
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

    private func rewriteOutboxForCardPublicSyncConflict(
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

    private func rewriteOutboxForDeckPublicSyncConflict(
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

    private func rewriteOutboxForReviewEventPublicSyncConflict(
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

    private func replaceLocalShellForNonEmptyRemoteWorkspace(
        sourceWorkspaceId: String,
        destinationWorkspaceId: String
    ) throws {
        let sourceWorkspace = try self.workspaceSettingsStore.loadWorkspace()
        try self.deleteWorkspaceIfExists(workspaceId: destinationWorkspaceId)
        try self.insertWorkspaceShell(
            workspace: CloudWorkspaceSummary(
                workspaceId: destinationWorkspaceId,
                name: sourceWorkspace.name,
                createdAt: sourceWorkspace.createdAt,
                isSelected: true
            )
        )
        try self.resetSyncState(workspaceId: destinationWorkspaceId)
        try self.updateAccountWorkspaceReference(workspaceId: destinationWorkspaceId)
        try self.deleteWorkspaceIfExists(workspaceId: sourceWorkspaceId)
    }

    private func deleteWorkspaceIfExists(workspaceId: String) throws {
        _ = try self.core.execute(
            sql: "DELETE FROM workspaces WHERE workspace_id = ?",
            values: [.text(workspaceId)]
        )
    }

    private func deleteOtherWorkspaces(exceptWorkspaceId: String) throws {
        _ = try self.core.execute(
            sql: "DELETE FROM workspaces WHERE workspace_id <> ?",
            values: [.text(exceptWorkspaceId)]
        )
    }

    private func assertSingleWorkspaceInvariant(expectedWorkspaceId: String) throws {
        let workspaceIds = try self.core.query(
            sql: "SELECT workspace_id FROM workspaces ORDER BY created_at ASC",
            values: []
        ) { statement in
            DatabaseCore.columnText(statement: statement, index: 0)
        }

        if workspaceIds.count != 1 || workspaceIds.first != expectedWorkspaceId {
            throw LocalStoreError.database(
                "Linked workspace migration left an invalid local workspace state: expected=\(expectedWorkspaceId) actual=\(workspaceIds)"
            )
        }
    }
}
