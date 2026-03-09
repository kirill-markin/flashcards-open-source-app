import Foundation

private struct ValidatedWorkspaceSchedulerSettingsInput {
    let algorithm: String
    let desiredRetention: Double
    let learningStepsMinutes: [Int]
    let relearningStepsMinutes: [Int]
    let maximumIntervalDays: Int
    let enableFuzz: Bool
}

struct WorkspaceSettingsStore {
    let core: DatabaseCore

    func loadWorkspace() throws -> Workspace {
        let workspaces = try self.core.query(
            sql: """
            SELECT workspace_id, name, created_at
            FROM workspaces
            ORDER BY created_at ASC
            LIMIT 1
            """,
            values: []
        ) { statement in
            Workspace(
                workspaceId: DatabaseCore.columnText(statement: statement, index: 0),
                name: DatabaseCore.columnText(statement: statement, index: 1),
                createdAt: DatabaseCore.columnText(statement: statement, index: 2)
            )
        }

        guard let workspace = workspaces.first else {
            throw LocalStoreError.database("Workspace row is missing")
        }

        return workspace
    }

    func loadUserSettings(workspaceId: String) throws -> UserSettings {
        let rows = try self.core.query(
            sql: """
            SELECT user_id, workspace_id, email, locale, created_at
            FROM user_settings
            WHERE workspace_id = ?
            ORDER BY created_at ASC
            LIMIT 1
            """,
            values: [.text(workspaceId)]
        ) { statement in
            UserSettings(
                userId: DatabaseCore.columnText(statement: statement, index: 0),
                workspaceId: DatabaseCore.columnText(statement: statement, index: 1),
                email: DatabaseCore.columnOptionalText(statement: statement, index: 2),
                locale: DatabaseCore.columnText(statement: statement, index: 3),
                createdAt: DatabaseCore.columnText(statement: statement, index: 4)
            )
        }

        guard let userSettings = rows.first else {
            throw LocalStoreError.database("User settings row is missing")
        }

        return userSettings
    }

    // Keep in sync with apps/backend/src/workspaceSchedulerSettings.ts::getWorkspaceSchedulerSettings and getWorkspaceSchedulerConfig.
    func loadWorkspaceSchedulerSettings(workspaceId: String) throws -> WorkspaceSchedulerSettings {
        let settings = try self.core.query(
            sql: """
            SELECT
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
            FROM workspaces
            WHERE workspace_id = ?
            LIMIT 1
            """,
            values: [.text(workspaceId)]
        ) { statement in
            let algorithm = DatabaseCore.columnText(statement: statement, index: 0)
            if algorithm != defaultSchedulerAlgorithm {
                throw LocalStoreError.database("Stored scheduler algorithm is invalid: \(algorithm)")
            }

            return WorkspaceSchedulerSettings(
                algorithm: algorithm,
                desiredRetention: DatabaseCore.columnDouble(statement: statement, index: 1),
                learningStepsMinutes: try self.decodeIntegerArray(
                    json: DatabaseCore.columnText(statement: statement, index: 2),
                    fieldName: "learningStepsMinutes"
                ),
                relearningStepsMinutes: try self.decodeIntegerArray(
                    json: DatabaseCore.columnText(statement: statement, index: 3),
                    fieldName: "relearningStepsMinutes"
                ),
                maximumIntervalDays: Int(DatabaseCore.columnInt64(statement: statement, index: 4)),
                enableFuzz: DatabaseCore.columnInt64(statement: statement, index: 5) == 1,
                clientUpdatedAt: DatabaseCore.columnText(statement: statement, index: 6),
                lastModifiedByDeviceId: DatabaseCore.columnText(statement: statement, index: 7),
                lastOperationId: DatabaseCore.columnText(statement: statement, index: 8),
                updatedAt: DatabaseCore.columnText(statement: statement, index: 9)
            )
        }

        guard let schedulerSettings = settings.first else {
            throw LocalStoreError.database("Workspace row is missing")
        }

        return schedulerSettings
    }

    func loadCloudSettings() throws -> CloudSettings {
        let settings = try self.core.query(
            sql: """
            SELECT device_id, cloud_state, linked_user_id, linked_workspace_id, linked_email, onboarding_completed, updated_at
            FROM app_local_settings
            WHERE settings_id = 1
            LIMIT 1
            """,
            values: []
        ) { statement in
            let rawCloudState = DatabaseCore.columnText(statement: statement, index: 1)
            guard let cloudState = CloudAccountState(rawValue: rawCloudState) else {
                throw LocalStoreError.database("Stored cloud state is invalid: \(rawCloudState)")
            }

            return CloudSettings(
                deviceId: DatabaseCore.columnText(statement: statement, index: 0),
                cloudState: cloudState,
                linkedUserId: DatabaseCore.columnOptionalText(statement: statement, index: 2),
                linkedWorkspaceId: DatabaseCore.columnOptionalText(statement: statement, index: 3),
                linkedEmail: DatabaseCore.columnOptionalText(statement: statement, index: 4),
                onboardingCompleted: DatabaseCore.columnInt64(statement: statement, index: 5) == 1,
                updatedAt: DatabaseCore.columnText(statement: statement, index: 6)
            )
        }

        guard let cloudSettings = settings.first else {
            throw LocalStoreError.database("App local settings row is missing")
        }

        return cloudSettings
    }

    func updateCloudSettings(
        cloudState: CloudAccountState,
        linkedUserId: String?,
        linkedWorkspaceId: String?,
        linkedEmail: String?
    ) throws {
        let updatedRows = try self.core.execute(
            sql: """
            UPDATE app_local_settings
            SET cloud_state = ?, linked_user_id = ?, linked_workspace_id = ?, linked_email = ?, updated_at = ?
            WHERE settings_id = 1
            """,
            values: [
                .text(cloudState.rawValue),
                linkedUserId.map(SQLiteValue.text) ?? .null,
                linkedWorkspaceId.map(SQLiteValue.text) ?? .null,
                linkedEmail.map(SQLiteValue.text) ?? .null,
                .text(currentIsoTimestamp())
            ]
        )

        if updatedRows == 0 {
            throw LocalStoreError.database("App local settings row is missing")
        }
    }

    // Keep in sync with apps/backend/src/workspaceSchedulerSettings.ts::updateWorkspaceSchedulerSettings.
    func updateWorkspaceSchedulerSettings(
        workspaceId: String,
        desiredRetention: Double,
        learningStepsMinutes: [Int],
        relearningStepsMinutes: [Int],
        maximumIntervalDays: Int,
        enableFuzz: Bool,
        deviceId: String,
        operationId: String,
        now: String
    ) throws -> WorkspaceSchedulerSettings {
        let validatedInput = try validateWorkspaceSchedulerSettingsInput(
            desiredRetention: desiredRetention,
            learningStepsMinutes: learningStepsMinutes,
            relearningStepsMinutes: relearningStepsMinutes,
            maximumIntervalDays: maximumIntervalDays,
            enableFuzz: enableFuzz
        )
        let learningStepsJson = try self.encodeIntegerArray(values: validatedInput.learningStepsMinutes)
        let relearningStepsJson = try self.encodeIntegerArray(values: validatedInput.relearningStepsMinutes)
        let updatedRows = try self.core.execute(
            sql: """
            UPDATE workspaces
            SET fsrs_algorithm = ?, fsrs_desired_retention = ?, fsrs_learning_steps_minutes_json = ?, fsrs_relearning_steps_minutes_json = ?, fsrs_maximum_interval_days = ?, fsrs_enable_fuzz = ?, fsrs_client_updated_at = ?, fsrs_last_modified_by_device_id = ?, fsrs_last_operation_id = ?, fsrs_updated_at = ?
            WHERE workspace_id = ?
            """,
            values: [
                .text(validatedInput.algorithm),
                .real(validatedInput.desiredRetention),
                .text(learningStepsJson),
                .text(relearningStepsJson),
                .integer(Int64(validatedInput.maximumIntervalDays)),
                .integer(validatedInput.enableFuzz ? 1 : 0),
                .text(now),
                .text(deviceId),
                .text(operationId),
                .text(now),
                .text(workspaceId)
            ]
        )

        if updatedRows == 0 {
            throw LocalStoreError.database("Workspace row is missing")
        }

        return try self.loadWorkspaceSchedulerSettings(workspaceId: workspaceId)
    }

    func encodeIntegerArray(values: [Int]) throws -> String {
        try self.core.encodeJsonString(value: values)
    }

    private func decodeIntegerArray(json: String, fieldName: String) throws -> [Int] {
        let data = Data(json.utf8)
        let values = try self.core.decoder.decode([Int].self, from: data)
        _ = try validateSchedulerStepList(values: values, fieldName: fieldName)
        return values
    }
}

// Keep in sync with apps/backend/src/workspaceSchedulerSettings.ts::parseSteps.
private func validateSchedulerStepList(values: [Int], fieldName: String) throws -> [Int] {
    if values.isEmpty {
        throw LocalStoreError.validation("\(fieldName) must not be empty")
    }

    for value in values {
        if value <= 0 || value >= 1_440 {
            throw LocalStoreError.validation("\(fieldName) must contain positive integer minutes under 1440")
        }
    }

    for index in 1..<values.count {
        if values[index] <= values[index - 1] {
            throw LocalStoreError.validation("\(fieldName) must be strictly increasing")
        }
    }

    return values
}

// Keep in sync with apps/backend/src/workspaceSchedulerSettings.ts::validateWorkspaceSchedulerSettingsInput.
private func validateWorkspaceSchedulerSettingsInput(
    desiredRetention: Double,
    learningStepsMinutes: [Int],
    relearningStepsMinutes: [Int],
    maximumIntervalDays: Int,
    enableFuzz: Bool
) throws -> ValidatedWorkspaceSchedulerSettingsInput {
    if desiredRetention <= 0 || desiredRetention >= 1 {
        throw LocalStoreError.validation("desiredRetention must be greater than 0 and less than 1")
    }

    if maximumIntervalDays < 1 {
        throw LocalStoreError.validation("maximumIntervalDays must be a positive integer")
    }

    return ValidatedWorkspaceSchedulerSettingsInput(
        algorithm: defaultSchedulerAlgorithm,
        desiredRetention: desiredRetention,
        learningStepsMinutes: try validateSchedulerStepList(
            values: learningStepsMinutes,
            fieldName: "learningStepsMinutes"
        ),
        relearningStepsMinutes: try validateSchedulerStepList(
            values: relearningStepsMinutes,
            fieldName: "relearningStepsMinutes"
        ),
        maximumIntervalDays: maximumIntervalDays,
        enableFuzz: enableFuzz
    )
}
