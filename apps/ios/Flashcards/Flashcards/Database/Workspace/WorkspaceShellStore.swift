import Foundation

struct WorkspaceShellStore {
    let core: DatabaseCore
    let workspaceSettingsStore: WorkspaceSettingsStore

    func assertNoPendingOutboxEntriesBeforeGuestWorkspaceDelete(workspaceId: String) throws {
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

    func insertWorkspaceFromLocalSettings(
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

    func insertWorkspaceShell(workspace: CloudWorkspaceSummary) throws {
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

    func ensureLinkedWorkspaceShell(workspace: CloudWorkspaceSummary) throws {
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

    func ensureSyncStateExists(workspaceId: String) throws {
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

    func resetSyncState(workspaceId: String) throws {
        _ = try self.core.execute(
            sql: "DELETE FROM sync_state WHERE workspace_id = ?",
            values: [.text(workspaceId)]
        )
        try self.ensureSyncStateExists(workspaceId: workspaceId)
    }

    func updateAccountWorkspaceReference(workspaceId: String) throws {
        _ = try self.core.execute(
            sql: """
            UPDATE user_settings
            SET workspace_id = ?
            """,
            values: [.text(workspaceId)]
        )
    }

    func deleteWorkspaceIfExists(workspaceId: String) throws {
        _ = try self.core.execute(
            sql: "DELETE FROM workspaces WHERE workspace_id = ?",
            values: [.text(workspaceId)]
        )
    }

    func deleteOtherWorkspaces(exceptWorkspaceId: String) throws {
        _ = try self.core.execute(
            sql: "DELETE FROM workspaces WHERE workspace_id <> ?",
            values: [.text(exceptWorkspaceId)]
        )
    }

    func assertSingleWorkspaceInvariant(expectedWorkspaceId: String) throws {
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
