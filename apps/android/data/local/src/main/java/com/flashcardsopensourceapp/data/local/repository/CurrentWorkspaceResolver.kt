package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.WorkspaceEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine

/**
 * Android keeps one explicit current local workspace via `activeWorkspaceId`.
 * The linked-workspaces list is a separate remote concept and must never be
 * used as an implicit fallback for the local shell that cards, settings, and
 * sync operate on.
 */
fun observeCurrentWorkspace(
    database: AppDatabase,
    preferencesStore: CloudPreferencesStore
): Flow<WorkspaceEntity?> {
    return combine(
        database.workspaceDao().observeWorkspaces(),
        preferencesStore.observeCloudSettings()
    ) { workspaces, cloudSettings ->
        resolveCurrentWorkspace(
            activeWorkspaceId = cloudSettings.activeWorkspaceId,
            workspaces = workspaces
        )
    }
}

suspend fun loadCurrentWorkspaceOrNull(
    database: AppDatabase,
    preferencesStore: CloudPreferencesStore
): WorkspaceEntity? {
    return resolveCurrentWorkspace(
        activeWorkspaceId = preferencesStore.currentCloudSettings().activeWorkspaceId,
        workspaces = database.workspaceDao().loadWorkspaces()
    )
}

suspend fun requireCurrentWorkspace(
    database: AppDatabase,
    preferencesStore: CloudPreferencesStore,
    missingWorkspaceMessage: String
): WorkspaceEntity {
    return requireNotNull(
        loadCurrentWorkspaceOrNull(
            database = database,
            preferencesStore = preferencesStore
        )
    ) {
        missingWorkspaceMessage
    }
}

fun resolveCurrentWorkspace(
    activeWorkspaceId: String?,
    workspaces: List<WorkspaceEntity>
): WorkspaceEntity? {
    if (workspaces.isEmpty()) {
        return null
    }

    if (activeWorkspaceId == null) {
        if (workspaces.size == 1) {
            return workspaces.single()
        }

        val workspaceIds = workspaces.map(WorkspaceEntity::workspaceId)
        error("Current workspace is ambiguous because activeWorkspaceId is missing. Local workspaces=$workspaceIds")
    }

    val workspaceById = activeWorkspaceId?.let { workspaceId ->
        workspaces.firstOrNull { workspace -> workspace.workspaceId == workspaceId }
    }
    if (workspaceById != null) {
        return workspaceById
    }

    val workspaceIds = workspaces.map(WorkspaceEntity::workspaceId)
    error(
        "Current workspace is invalid because activeWorkspaceId '$activeWorkspaceId' does not exist locally. " +
            "Local workspaces=$workspaceIds"
    )
}
