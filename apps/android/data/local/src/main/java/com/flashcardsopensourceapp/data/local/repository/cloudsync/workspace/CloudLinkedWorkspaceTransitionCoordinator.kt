package com.flashcardsopensourceapp.data.local.repository.cloudsync.workspace

import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.cloud.sync.SyncLocalStore
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.database.entities.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.model.sync.CloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.AuthenticatedCloudSession
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudOperationCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.isCloudIdentityConflictError
import com.flashcardsopensourceapp.data.local.repository.cloudsync.sync.CloudSyncBlockedException
import com.flashcardsopensourceapp.data.local.repository.cloudsync.sync.CloudSyncSession
import com.flashcardsopensourceapp.data.local.repository.cloudsync.sync.CloudWorkspaceForkRecoveryMode
import com.flashcardsopensourceapp.data.local.repository.cloudsync.sync.androidClientPlatform
import com.flashcardsopensourceapp.data.local.repository.cloudsync.sync.runCloudSyncCore
import org.json.JSONObject

internal class CloudLinkedWorkspaceTransitionCoordinator(
    private val database: AppDatabase,
    private val preferencesStore: CloudPreferencesStore,
    private val remoteService: CloudRemoteGateway,
    private val syncLocalStore: SyncLocalStore,
    private val operationCoordinator: CloudOperationCoordinator,
    private val appVersion: String
) {
    suspend fun applyLinkedWorkspace(
        accountSnapshot: CloudAccountSnapshot,
        bearerToken: String,
        selectedWorkspace: CloudWorkspaceSummary
    ) {
        operationCoordinator.requireExclusiveOperation(operationName = "Linked workspace application")
        val remoteWorkspaceIsEmpty: Boolean = resolveRemoteWorkspaceEmptiness(
            bearerToken = bearerToken,
            selectedWorkspace = selectedWorkspace
        )
        migrateLocalShellToLinkedWorkspace(
            accountSnapshot = accountSnapshot,
            selectedWorkspace = selectedWorkspace,
            remoteWorkspaceIsEmpty = remoteWorkspaceIsEmpty
        )
    }

    suspend fun applyLinkedWorkspacePreservingLocalData(
        accountSnapshot: CloudAccountSnapshot,
        selectedWorkspace: CloudWorkspaceSummary
    ) {
        operationCoordinator.requireExclusiveOperation(operationName = "Linked workspace application")
        migrateLocalShellToLinkedWorkspace(
            accountSnapshot = accountSnapshot,
            selectedWorkspace = selectedWorkspace,
            remoteWorkspaceIsEmpty = true
        )
    }

    suspend fun applyLinkedWorkspaceAndSync(
        authenticatedSession: AuthenticatedCloudSession,
        selectedWorkspace: CloudWorkspaceSummary
    ) {
        operationCoordinator.requireExclusiveOperation(operationName = "Linked workspace transition")
        applyLinkedWorkspace(
            accountSnapshot = authenticatedSession.accountSnapshot,
            bearerToken = authenticatedSession.credentials.idToken,
            selectedWorkspace = selectedWorkspace
        )
        requireTransitionInvariant(
            stage = "after prefs update",
            expectedWorkspaceId = selectedWorkspace.workspaceId
        )
        runInitialLinkedWorkspaceSync(
            authenticatedSession = authenticatedSession,
            workspaceId = selectedWorkspace.workspaceId
        )
        requireTransitionInvariant(
            stage = "after initial sync",
            expectedWorkspaceId = selectedWorkspace.workspaceId
        )
    }

    suspend fun applyDeletedWorkspaceReplacement(
        authenticatedSession: AuthenticatedCloudSession,
        replacementWorkspace: CloudWorkspaceSummary
    ) {
        operationCoordinator.requireExclusiveOperation(operationName = "Deleted workspace replacement")
        val localReplacementWorkspace: WorkspaceEntity = syncLocalStore.migrateLocalShellToLinkedWorkspace(
            workspace = replacementWorkspace,
            remoteWorkspaceIsEmpty = false
        )
        requireLocalWorkspaceSelection(
            stage = "after local replacement for delete",
            expectedWorkspaceId = replacementWorkspace.workspaceId,
            actualWorkspaceId = localReplacementWorkspace.workspaceId
        )
        preferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.LINKED,
            linkedUserId = authenticatedSession.accountSnapshot.userId,
            linkedWorkspaceId = replacementWorkspace.workspaceId,
            linkedEmail = authenticatedSession.accountSnapshot.email,
            activeWorkspaceId = replacementWorkspace.workspaceId
        )
        preferencesStore.saveAccountPreferences(preferences = authenticatedSession.accountSnapshot.preferences)
        requireTransitionInvariant(
            stage = "after prefs update for delete",
            expectedWorkspaceId = replacementWorkspace.workspaceId
        )
        runInitialLinkedWorkspaceSync(
            authenticatedSession = authenticatedSession,
            workspaceId = replacementWorkspace.workspaceId
        )
        requireTransitionInvariant(
            stage = "after initial sync for delete",
            expectedWorkspaceId = replacementWorkspace.workspaceId
        )
    }

    suspend fun runInitialLinkedWorkspaceSync(
        authenticatedSession: AuthenticatedCloudSession,
        workspaceId: String
    ) {
        operationCoordinator.requireExclusiveOperation(operationName = "Initial linked workspace sync")
        val cloudSettings: CloudSettings = preferencesStore.currentCloudSettings()
        val localWorkspaceIds: List<String> = database.workspaceDao()
            .loadWorkspaces()
            .map(WorkspaceEntity::workspaceId)
        require(cloudSettings.cloudState == CloudAccountState.LINKED) {
            "Initial linked workspace sync requires a linked cloud account."
        }
        require(cloudSettings.linkedWorkspaceId == workspaceId) {
            buildTransitionInvariantMessage(
                stage = "before initial sync",
                expectedWorkspaceId = workspaceId,
                localWorkspaceIds = localWorkspaceIds,
                cloudSettings = cloudSettings
            )
        }
        try {
            runCloudSyncCore(
                cloudSettings = cloudSettings,
                workspaceId = workspaceId,
                syncSession = CloudSyncSession(
                    apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                    authorizationHeader = "Bearer ${authenticatedSession.credentials.idToken}"
                ),
                appVersion = appVersion,
                remoteService = remoteService,
                syncLocalStore = syncLocalStore,
                workspaceForkRecoveryMode = CloudWorkspaceForkRecoveryMode.ENABLED
            )
        } catch (error: Exception) {
            val preservesBlockedSyncState: Boolean = error is CloudSyncBlockedException || isCloudIdentityConflictError(
                error = error
            )
            if (preservesBlockedSyncState.not()) {
                syncLocalStore.markSyncFailure(
                    workspaceId = workspaceId,
                    errorMessage = error.message ?: "Cloud sync failed."
                )
            }
            throw IllegalStateException(
                buildTransitionInvariantMessage(
                    stage = "initial sync failed",
                    expectedWorkspaceId = workspaceId,
                    localWorkspaceIds = database.workspaceDao().loadWorkspaces().map(WorkspaceEntity::workspaceId),
                    cloudSettings = preferencesStore.currentCloudSettings()
                ) + " Cause=${error.message ?: "Cloud sync failed."}",
                error
            )
        }
    }

    suspend fun requireTransitionInvariant(
        stage: String,
        expectedWorkspaceId: String
    ) {
        operationCoordinator.requireExclusiveOperation(operationName = "Linked workspace transition invariant")
        val cloudSettings: CloudSettings = preferencesStore.currentCloudSettings()
        val localWorkspaceIds: List<String> = database.workspaceDao()
            .loadWorkspaces()
            .map(WorkspaceEntity::workspaceId)
        require(localWorkspaceIds.size == 1) {
            buildTransitionInvariantMessage(
                stage = stage,
                expectedWorkspaceId = expectedWorkspaceId,
                localWorkspaceIds = localWorkspaceIds,
                cloudSettings = cloudSettings
            )
        }
        require(localWorkspaceIds.single() == expectedWorkspaceId) {
            buildTransitionInvariantMessage(
                stage = stage,
                expectedWorkspaceId = expectedWorkspaceId,
                localWorkspaceIds = localWorkspaceIds,
                cloudSettings = cloudSettings
            )
        }
        require(cloudSettings.linkedWorkspaceId == expectedWorkspaceId) {
            buildTransitionInvariantMessage(
                stage = stage,
                expectedWorkspaceId = expectedWorkspaceId,
                localWorkspaceIds = localWorkspaceIds,
                cloudSettings = cloudSettings
            )
        }
        require(cloudSettings.activeWorkspaceId == expectedWorkspaceId) {
            buildTransitionInvariantMessage(
                stage = stage,
                expectedWorkspaceId = expectedWorkspaceId,
                localWorkspaceIds = localWorkspaceIds,
                cloudSettings = cloudSettings
            )
        }
    }

    private suspend fun migrateLocalShellToLinkedWorkspace(
        accountSnapshot: CloudAccountSnapshot,
        selectedWorkspace: CloudWorkspaceSummary,
        remoteWorkspaceIsEmpty: Boolean
    ) {
        val localLinkedWorkspace: WorkspaceEntity = syncLocalStore.migrateLocalShellToLinkedWorkspace(
            workspace = selectedWorkspace,
            remoteWorkspaceIsEmpty = remoteWorkspaceIsEmpty
        )
        finalizeLinkedWorkspaceMigration(
            accountSnapshot = accountSnapshot,
            selectedWorkspace = selectedWorkspace,
            localLinkedWorkspace = localLinkedWorkspace,
            missingWorkspaceMessage = "Linked workspace is missing locally after cloud link."
        )
    }

    private suspend fun finalizeLinkedWorkspaceMigration(
        accountSnapshot: CloudAccountSnapshot,
        selectedWorkspace: CloudWorkspaceSummary,
        localLinkedWorkspace: WorkspaceEntity,
        missingWorkspaceMessage: String
    ) {
        check(localLinkedWorkspace.workspaceId == selectedWorkspace.workspaceId) {
            "Linked workspace migration produced an unexpected local workspace. " +
                "Expected='${selectedWorkspace.workspaceId}' Actual='${localLinkedWorkspace.workspaceId}'."
        }

        preferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.LINKED,
            linkedUserId = accountSnapshot.userId,
            linkedWorkspaceId = selectedWorkspace.workspaceId,
            linkedEmail = accountSnapshot.email,
            activeWorkspaceId = selectedWorkspace.workspaceId
        )
        preferencesStore.saveAccountPreferences(preferences = accountSnapshot.preferences)
        val localCurrentWorkspace: WorkspaceEntity = requireCurrentWorkspace(
            database = database,
            preferencesStore = preferencesStore,
            missingWorkspaceMessage = missingWorkspaceMessage
        )
        check(localCurrentWorkspace.workspaceId == selectedWorkspace.workspaceId) {
            "Linked workspace '${selectedWorkspace.workspaceId}' did not become the current local workspace. " +
                "Local workspace='${localCurrentWorkspace.workspaceId}'."
        }
    }

    private suspend fun resolveRemoteWorkspaceEmptiness(
        bearerToken: String,
        selectedWorkspace: CloudWorkspaceSummary
    ): Boolean {
        val configuration: CloudServiceConfiguration = preferencesStore.currentServerConfiguration()
        return remoteService.bootstrapPull(
            apiBaseUrl = configuration.apiBaseUrl,
            authorizationHeader = "Bearer $bearerToken",
            workspaceId = selectedWorkspace.workspaceId,
            body = JSONObject()
                .put("mode", "pull")
                .put("installationId", preferencesStore.currentCloudSettings().installationId)
                .put("platform", androidClientPlatform)
                .put("appVersion", appVersion)
                .put("cursor", JSONObject.NULL)
                .put("limit", 1)
        ).remoteIsEmpty
    }

    private suspend fun requireLocalWorkspaceSelection(
        stage: String,
        expectedWorkspaceId: String,
        actualWorkspaceId: String
    ) {
        val localWorkspaceIds: List<String> = database.workspaceDao()
            .loadWorkspaces()
            .map(WorkspaceEntity::workspaceId)
        val cloudSettings: CloudSettings = preferencesStore.currentCloudSettings()
        require(actualWorkspaceId == expectedWorkspaceId) {
            buildTransitionInvariantMessage(
                stage = stage,
                expectedWorkspaceId = expectedWorkspaceId,
                localWorkspaceIds = localWorkspaceIds,
                cloudSettings = cloudSettings
            ) + " ActualLocalWorkspaceId='$actualWorkspaceId'"
        }
    }
}

private fun buildTransitionInvariantMessage(
    stage: String,
    expectedWorkspaceId: String,
    localWorkspaceIds: List<String>,
    cloudSettings: CloudSettings
): String {
    return "Linked workspace transition invariant failed at stage '$stage'. " +
        "expectedWorkspaceId='$expectedWorkspaceId' " +
        "activeWorkspaceId='${cloudSettings.activeWorkspaceId}' " +
        "linkedWorkspaceId='${cloudSettings.linkedWorkspaceId}' " +
        "localWorkspaceIds=$localWorkspaceIds"
}
