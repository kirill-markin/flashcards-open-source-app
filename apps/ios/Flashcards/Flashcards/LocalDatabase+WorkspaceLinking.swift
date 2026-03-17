import Foundation

extension LocalDatabase {
    func updateCloudSettings(
        cloudState: CloudAccountState,
        linkedUserId: String?,
        linkedWorkspaceId: String?,
        linkedEmail: String?
    ) throws {
        try self.workspaceSettingsStore.updateCloudSettings(
            cloudState: cloudState,
            linkedUserId: linkedUserId,
            linkedWorkspaceId: linkedWorkspaceId,
            linkedEmail: linkedEmail
        )
    }

    func updateWorkspaceName(workspaceId: String, name: String) throws -> Workspace {
        try self.workspaceSettingsStore.updateWorkspaceName(workspaceId: workspaceId, name: name)
    }

    func relinkWorkspace(localWorkspaceId: String, linkedSession: CloudLinkedSession) throws {
        if localWorkspaceId == linkedSession.workspaceId {
            try self.updateCloudSettings(
                cloudState: .linked,
                linkedUserId: linkedSession.userId,
                linkedWorkspaceId: linkedSession.workspaceId,
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
                    sql: "INSERT INTO sync_state (workspace_id, last_applied_change_id, updated_at) VALUES (?, 0, ?)",
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
                linkedEmail: linkedSession.email
            )
        }
    }

    func replaceLocalWorkspaceAfterRemoteDelete(
        localWorkspaceId: String,
        replacementWorkspace: CloudWorkspaceSummary,
        linkedSession: CloudLinkedSession
    ) throws {
        let currentSettings = try self.workspaceSettingsStore.loadWorkspaceSchedulerSettings(workspaceId: localWorkspaceId)

        try self.core.inTransaction {
            let existingReplacementWorkspaceCount = try self.core.scalarInt(
                sql: "SELECT COUNT(*) FROM workspaces WHERE workspace_id = ?",
                values: [.text(replacementWorkspace.workspaceId)]
            )

            if existingReplacementWorkspaceCount == 0 {
                try self.insertWorkspaceFromLocalSettings(
                    workspaceId: replacementWorkspace.workspaceId,
                    name: replacementWorkspace.name,
                    createdAt: replacementWorkspace.createdAt,
                    settings: currentSettings
                )
            } else {
                _ = try self.core.execute(
                    sql: """
                    UPDATE workspaces
                    SET name = ?, created_at = ?
                    WHERE workspace_id = ?
                    """,
                    values: [
                        .text(replacementWorkspace.name),
                        .text(replacementWorkspace.createdAt),
                        .text(replacementWorkspace.workspaceId)
                    ]
                )
            }

            let workspaceScopedTables: [String] = ["cards", "decks", "review_events", "outbox", "sync_state"]
            try self.deleteWorkspaceRows(
                tableNames: workspaceScopedTables,
                workspaceId: localWorkspaceId
            )
            try self.deleteWorkspaceRows(
                tableNames: workspaceScopedTables,
                workspaceId: replacementWorkspace.workspaceId
            )

            _ = try self.core.execute(
                sql: """
                UPDATE user_settings
                SET workspace_id = ?
                WHERE workspace_id = ?
                """,
                values: [
                    .text(replacementWorkspace.workspaceId),
                    .text(localWorkspaceId)
                ]
            )

            _ = try self.core.execute(
                sql: "DELETE FROM workspaces WHERE workspace_id = ?",
                values: [.text(localWorkspaceId)]
            )

            try self.core.execute(
                sql: """
                INSERT OR REPLACE INTO sync_state (workspace_id, last_applied_change_id, updated_at)
                VALUES (?, 0, ?)
                """,
                values: [
                    .text(replacementWorkspace.workspaceId),
                    .text(nowIsoTimestamp())
                ]
            )

            try self.workspaceSettingsStore.updateCloudSettings(
                cloudState: .linked,
                linkedUserId: linkedSession.userId,
                linkedWorkspaceId: replacementWorkspace.workspaceId,
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
                fsrs_last_modified_by_device_id,
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
                .text(settings.lastModifiedByDeviceId),
                .text(settings.lastOperationId),
                .text(settings.updatedAt)
            ]
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

    private func deleteWorkspaceRows(tableNames: [String], workspaceId: String) throws {
        for tableName in tableNames {
            _ = try self.core.execute(
                sql: "DELETE FROM \(tableName) WHERE workspace_id = ?",
                values: [.text(workspaceId)]
            )
        }
    }
}
