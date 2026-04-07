import Foundation

struct LocalDatabaseBootstrapper {
    let core: DatabaseCore

    func ensureDefaultState() throws {
        if try self.defaultStateNeedsInitialization() == false {
            return
        }

        try self.core.inTransaction {
            let installationId = try self.ensureAppLocalSettingsRow()
            let workspaceId = try self.ensureDefaultWorkspaceRow(installationId: installationId)
            try self.ensureActiveWorkspaceReference(defaultWorkspaceId: workspaceId)
            try self.ensureSyncStateRow(workspaceId: workspaceId)
            try self.ensureUserSettingsRow(workspaceId: workspaceId)
        }
    }

    private func defaultStateNeedsInitialization() throws -> Bool {
        let appSettingsCount = try self.core.scalarInt(
            sql: "SELECT COUNT(*) FROM app_local_settings",
            values: []
        )
        if appSettingsCount == 0 {
            return true
        }

        let workspaceCount = try self.core.scalarInt(
            sql: "SELECT COUNT(*) FROM workspaces",
            values: []
        )
        if workspaceCount == 0 {
            return true
        }

        let userSettingsCount = try self.core.scalarInt(
            sql: "SELECT COUNT(*) FROM user_settings",
            values: []
        )
        if userSettingsCount == 0 {
            return true
        }

        guard let activeWorkspaceId = try self.core.scalarOptionalText(
            sql: "SELECT active_workspace_id FROM app_local_settings WHERE settings_id = 1",
            values: []
        ) else {
            return true
        }

        let hasActiveWorkspace = try self.core.scalarInt(
            sql: "SELECT COUNT(*) FROM workspaces WHERE workspace_id = ?",
            values: [.text(activeWorkspaceId)]
        ) > 0
        if hasActiveWorkspace == false {
            return true
        }

        let hasSyncState = try self.core.scalarInt(
            sql: "SELECT COUNT(*) FROM sync_state WHERE workspace_id = ?",
            values: [.text(activeWorkspaceId)]
        ) > 0
        return hasSyncState == false
    }

    private func ensureAppLocalSettingsRow() throws -> String {
        let appSettingsCount = try self.core.scalarInt(
            sql: "SELECT COUNT(*) FROM app_local_settings",
            values: []
        )
        if appSettingsCount == 0 {
            let installationId = UUID().uuidString.lowercased()
            try self.core.execute(
                sql: """
                INSERT INTO app_local_settings (
                    settings_id,
                    installation_id,
                    cloud_state,
                    linked_user_id,
                    linked_workspace_id,
                    active_workspace_id,
                    linked_email,
                    onboarding_completed,
                    updated_at
                )
                VALUES (1, ?, 'disconnected', NULL, NULL, NULL, NULL, 0, ?)
                """,
                values: [
                    .text(installationId),
                    .text(nowIsoTimestamp())
                ]
            )
            return installationId
        }

        return try self.core.scalarText(
            sql: "SELECT installation_id FROM app_local_settings WHERE settings_id = 1",
            values: []
        )
    }

    private func ensureDefaultWorkspaceRow(installationId: String) throws -> String {
        let workspaceCount = try self.core.scalarInt(
            sql: "SELECT COUNT(*) FROM workspaces",
            values: []
        )

        if workspaceCount == 0 {
            let now = nowIsoTimestamp()
            let operationId = UUID().uuidString.lowercased()
            let workspaceId = UUID().uuidString.lowercased()
            try self.core.execute(
                sql: """
                INSERT INTO workspaces (
                    workspace_id,
                    name,
                    created_at,
                    fsrs_client_updated_at,
                    fsrs_last_modified_by_replica_id,
                    fsrs_last_operation_id,
                    fsrs_updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                values: [
                    .text(workspaceId),
                    .text("Personal"),
                    .text(now),
                    .text(now),
                    .text(installationId),
                    .text(operationId),
                    .text(now)
                ]
            )
            try self.core.execute(
                sql: """
                UPDATE app_local_settings
                SET active_workspace_id = ?, updated_at = ?
                WHERE settings_id = 1
                """,
                values: [
                    .text(workspaceId),
                    .text(nowIsoTimestamp())
                ]
            )
            return workspaceId
        }

        return try self.core.scalarText(
            sql: """
            SELECT workspace_id
            FROM workspaces
            ORDER BY created_at ASC
            LIMIT 1
            """,
            values: []
        )
    }

    private func ensureActiveWorkspaceReference(defaultWorkspaceId: String) throws {
        let activeWorkspaceId = try self.core.scalarOptionalText(
            sql: "SELECT active_workspace_id FROM app_local_settings WHERE settings_id = 1",
            values: []
        )
        let hasActiveWorkspace: Bool
        if let activeWorkspaceId {
            hasActiveWorkspace = try self.core.scalarInt(
                sql: "SELECT COUNT(*) FROM workspaces WHERE workspace_id = ?",
                values: [.text(activeWorkspaceId)]
            ) > 0
        } else {
            hasActiveWorkspace = false
        }

        if hasActiveWorkspace == false {
            try self.core.execute(
                sql: """
                UPDATE app_local_settings
                SET active_workspace_id = ?, updated_at = ?
                WHERE settings_id = 1
                """,
                values: [
                    .text(defaultWorkspaceId),
                    .text(nowIsoTimestamp())
                ]
            )
        }
    }

    private func ensureSyncStateRow(workspaceId: String) throws {
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

    private func ensureUserSettingsRow(workspaceId: String) throws {
        let userSettingsCount = try self.core.scalarInt(
            sql: "SELECT COUNT(*) FROM user_settings",
            values: []
        )
        if userSettingsCount == 0 {
            let locale = Locale.current.language.languageCode?.identifier ?? "en"
            try self.core.execute(
                sql: """
                INSERT INTO user_settings (user_id, workspace_id, email, locale, created_at)
                VALUES (?, ?, NULL, ?, ?)
                """,
                values: [
                    .text("local-user"),
                    .text(workspaceId),
                    .text(locale),
                    .text(nowIsoTimestamp())
                ]
            )
        }
    }
}
