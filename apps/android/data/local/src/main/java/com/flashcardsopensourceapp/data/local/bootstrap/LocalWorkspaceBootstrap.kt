package com.flashcardsopensourceapp.data.local.bootstrap

import androidx.room.withTransaction
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.AppLocalSettingsEntity
import com.flashcardsopensourceapp.data.local.database.SyncStateEntity
import com.flashcardsopensourceapp.data.local.database.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.database.WorkspaceSchedulerSettingsEntity
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.encodeSchedulerStepListJson
import com.flashcardsopensourceapp.data.local.model.makeDefaultWorkspaceSchedulerSettings
import java.util.UUID

const val localWorkspaceName: String = "Personal"

suspend fun ensureLocalWorkspaceShell(
    database: AppDatabase,
    currentTimeMillis: Long
): String {
    return database.withTransaction {
        val existingWorkspace = database.workspaceDao().loadAnyWorkspace()
        if (existingWorkspace != null) {
            ensureLocalWorkspaceDependencies(
                database = database,
                workspace = existingWorkspace,
                currentTimeMillis = currentTimeMillis
            )
            ensureAppLocalSettings(
                database = database,
                workspaceId = existingWorkspace.workspaceId,
                currentTimeMillis = currentTimeMillis
            )
            return@withTransaction existingWorkspace.workspaceId
        }

        val workspace = WorkspaceEntity(
            workspaceId = UUID.randomUUID().toString(),
            name = localWorkspaceName,
            createdAtMillis = currentTimeMillis
        )
        database.workspaceDao().insertWorkspace(workspace = workspace)
        ensureLocalWorkspaceDependencies(
            database = database,
            workspace = workspace,
            currentTimeMillis = currentTimeMillis
        )
        ensureAppLocalSettings(
            database = database,
            workspaceId = workspace.workspaceId,
            currentTimeMillis = currentTimeMillis
        )
        workspace.workspaceId
    }
}

private suspend fun ensureLocalWorkspaceDependencies(
    database: AppDatabase,
    workspace: WorkspaceEntity,
    currentTimeMillis: Long
) {
    val existingSettings = database.workspaceSchedulerSettingsDao().loadWorkspaceSchedulerSettings(
        workspaceId = workspace.workspaceId
    )
    if (existingSettings == null) {
        val defaultSettings = makeDefaultWorkspaceSchedulerSettings(
            workspaceId = workspace.workspaceId,
            updatedAtMillis = currentTimeMillis
        )
        database.workspaceSchedulerSettingsDao().insertWorkspaceSchedulerSettings(
            settings = WorkspaceSchedulerSettingsEntity(
                workspaceId = defaultSettings.workspaceId,
                algorithm = defaultSettings.algorithm,
                desiredRetention = defaultSettings.desiredRetention,
                learningStepsMinutesJson = encodeSchedulerStepListJson(defaultSettings.learningStepsMinutes),
                relearningStepsMinutesJson = encodeSchedulerStepListJson(defaultSettings.relearningStepsMinutes),
                maximumIntervalDays = defaultSettings.maximumIntervalDays,
                enableFuzz = defaultSettings.enableFuzz,
                updatedAtMillis = defaultSettings.updatedAtMillis
            )
        )
    }

    val existingSyncState = database.syncStateDao().loadSyncState(workspaceId = workspace.workspaceId)
    if (existingSyncState == null) {
        database.syncStateDao().insertSyncState(
            syncState = SyncStateEntity(
                workspaceId = workspace.workspaceId,
                lastSyncCursor = null,
                lastReviewSequenceId = 0L,
                hasHydratedHotState = false,
                hasHydratedReviewHistory = false,
                lastSyncAttemptAtMillis = null,
                lastSuccessfulSyncAtMillis = null,
                lastSyncError = null
            )
        )
    }
}

private suspend fun ensureAppLocalSettings(
    database: AppDatabase,
    workspaceId: String,
    currentTimeMillis: Long
) {
    val existingSettings = database.appLocalSettingsDao().loadSettings()
    if (existingSettings != null) {
        if (existingSettings.activeWorkspaceId == null) {
            database.appLocalSettingsDao().insertSettings(
                existingSettings.copy(
                    activeWorkspaceId = workspaceId,
                    updatedAtMillis = currentTimeMillis
                )
            )
        }
        return
    }

    database.appLocalSettingsDao().insertSettings(
        AppLocalSettingsEntity(
            settingsId = 1,
            installationId = UUID.randomUUID().toString(),
            cloudState = CloudAccountState.DISCONNECTED.name,
            linkedUserId = null,
            linkedWorkspaceId = null,
            linkedEmail = null,
            activeWorkspaceId = workspaceId,
            updatedAtMillis = currentTimeMillis
        )
    )
}
