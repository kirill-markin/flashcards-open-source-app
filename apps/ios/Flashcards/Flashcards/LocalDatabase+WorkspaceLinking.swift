import Foundation

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

    func relinkWorkspace(localWorkspaceId: String, linkedSession: CloudLinkedSession) throws {
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
            let existingWorkspaceCount = try self.core.scalarInt(
                sql: "SELECT COUNT(*) FROM workspaces WHERE workspace_id = ?",
                values: [.text(linkedSession.workspaceId)]
            )

            if existingWorkspaceCount == 0 {
                let localWorkspace = try self.workspaceSettingsStore.loadWorkspace()
                let currentSettings = try self.workspaceSettingsStore.loadWorkspaceSchedulerSettings(workspaceId: localWorkspaceId)
                try self.insertWorkspaceFromLocalSettings(
                    workspaceId: linkedSession.workspaceId,
                    name: localWorkspace.name,
                    createdAt: localWorkspace.createdAt,
                    settings: currentSettings
                )
            }

            let workspaceScopedTables: [String] = ["user_settings", "cards", "decks", "review_events", "outbox", "sync_state"]
            try self.updateWorkspaceReferences(
                tableNames: workspaceScopedTables,
                sourceWorkspaceId: localWorkspaceId,
                destinationWorkspaceId: linkedSession.workspaceId
            )

            _ = try self.core.execute(
                sql: "DELETE FROM workspaces WHERE workspace_id = ?",
                values: [.text(localWorkspaceId)]
            )

            let syncStateCount = try self.core.scalarInt(
                sql: "SELECT COUNT(*) FROM sync_state WHERE workspace_id = ?",
                values: [.text(linkedSession.workspaceId)]
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
                        .text(linkedSession.workspaceId),
                        .text(nowIsoTimestamp())
                    ]
                )
            }

            try self.workspaceSettingsStore.updateCloudSettings(
                cloudState: .linked,
                linkedUserId: linkedSession.userId,
                linkedWorkspaceId: linkedSession.workspaceId,
                activeWorkspaceId: linkedSession.workspaceId,
                linkedEmail: linkedSession.email
            )
        }
    }

    func replaceLocalWorkspaceAfterRemoteDelete(
        localWorkspaceId: String,
        replacementWorkspace: CloudWorkspaceSummary,
        linkedSession: CloudLinkedSession
    ) throws {
        try self.core.inTransaction {
            try self.ensureLinkedWorkspaceShell(workspace: replacementWorkspace)
            try self.ensureSyncStateExists(workspaceId: replacementWorkspace.workspaceId)
            try self.updateAccountWorkspaceReference(workspaceId: replacementWorkspace.workspaceId)
            _ = try self.core.execute(
                sql: "DELETE FROM workspaces WHERE workspace_id = ?",
                values: [.text(localWorkspaceId)]
            )

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

    private func updateAccountWorkspaceReference(workspaceId: String) throws {
        _ = try self.core.execute(
            sql: """
            UPDATE user_settings
            SET workspace_id = ?
            """,
            values: [.text(workspaceId)]
        )
    }

    private func updateWorkspaceReferences(
        tableNames: [String],
        sourceWorkspaceId: String,
        destinationWorkspaceId: String
    ) throws {
        for tableName in tableNames {
            _ = try self.core.execute(
                sql: "UPDATE \(tableName) SET workspace_id = ? WHERE workspace_id = ?",
                values: [
                    .text(destinationWorkspaceId),
                    .text(sourceWorkspaceId)
                ]
            )
        }
    }
}
