package com.flashcardsopensourceapp.data.local.repository.cloudsync.workspace

import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.cloud.sync.SyncLocalStore
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceDeletePreview
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceDeleteResult
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceResetProgressPreview
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceResetProgressResult
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.AuthenticatedCloudSession
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudOperationCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudSessionProvider
import com.flashcardsopensourceapp.data.local.repository.cloudsync.sync.CloudSyncSession
import com.flashcardsopensourceapp.data.local.repository.cloudsync.sync.CloudWorkspaceForkRecoveryMode
import com.flashcardsopensourceapp.data.local.repository.cloudsync.sync.runCloudSyncCore

internal class CloudWorkspaceOperationsCoordinator(
    private val database: AppDatabase,
    private val preferencesStore: CloudPreferencesStore,
    private val remoteService: CloudRemoteGateway,
    private val syncLocalStore: SyncLocalStore,
    private val operationCoordinator: CloudOperationCoordinator,
    private val sessionProvider: CloudSessionProvider,
    private val transitionCoordinator: CloudLinkedWorkspaceTransitionCoordinator,
    private val appVersion: String
) {
    suspend fun renameCurrentWorkspace(name: String): CloudWorkspaceSummary {
        return operationCoordinator.runExclusive {
            require(preferencesStore.currentCloudSettings().cloudState == CloudAccountState.LINKED) {
                "Workspace rename is available only for linked cloud workspaces."
            }
            val authenticatedSession: AuthenticatedCloudSession = sessionProvider.authenticatedSession()
            val workspace: WorkspaceEntity = requireCurrentWorkspace(
                database = database,
                preferencesStore = preferencesStore,
                missingWorkspaceMessage = "Workspace rename requires a current local workspace."
            )
            val trimmedName: String = name.trim()
            require(trimmedName.isNotEmpty()) {
                "Workspace name is required."
            }

            val renamedWorkspace: CloudWorkspaceSummary = remoteService.renameWorkspace(
                apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                bearerToken = authenticatedSession.credentials.idToken,
                workspaceId = workspace.workspaceId,
                name = trimmedName
            )
            database.workspaceDao().updateWorkspace(
                workspace.copy(name = renamedWorkspace.name)
            )
            renamedWorkspace
        }
    }

    suspend fun loadCurrentWorkspaceDeletePreview(): CloudWorkspaceDeletePreview {
        require(preferencesStore.currentCloudSettings().cloudState == CloudAccountState.LINKED) {
            "Workspace deletion is available only for linked cloud workspaces."
        }
        val authenticatedSession: AuthenticatedCloudSession = sessionProvider.authenticatedSession()
        val workspaceId: String = requireCurrentWorkspace(
            database = database,
            preferencesStore = preferencesStore,
            missingWorkspaceMessage = "Workspace deletion requires a current local workspace."
        ).workspaceId
        return remoteService.loadWorkspaceDeletePreview(
            apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
            bearerToken = authenticatedSession.credentials.idToken,
            workspaceId = workspaceId
        )
    }

    suspend fun deleteCurrentWorkspace(confirmationText: String): CloudWorkspaceDeleteResult {
        return operationCoordinator.runExclusive {
            require(preferencesStore.currentCloudSettings().cloudState == CloudAccountState.LINKED) {
                "Workspace deletion is available only for linked cloud workspaces."
            }
            val authenticatedSession: AuthenticatedCloudSession = sessionProvider.authenticatedSession()
            val currentWorkspaceId: String = requireCurrentWorkspace(
                database = database,
                preferencesStore = preferencesStore,
                missingWorkspaceMessage = "Workspace deletion requires a current local workspace."
            ).workspaceId
            val result: CloudWorkspaceDeleteResult = remoteService.deleteWorkspace(
                apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                bearerToken = authenticatedSession.credentials.idToken,
                workspaceId = currentWorkspaceId,
                confirmationText = confirmationText
            )

            transitionCoordinator.applyDeletedWorkspaceReplacement(
                authenticatedSession = authenticatedSession,
                replacementWorkspace = result.workspace
            )
            result
        }
    }

    suspend fun loadCurrentWorkspaceResetProgressPreview(): CloudWorkspaceResetProgressPreview {
        require(preferencesStore.currentCloudSettings().cloudState == CloudAccountState.LINKED) {
            "Workspace progress reset is available only for linked cloud workspaces."
        }
        return operationCoordinator.runExclusive {
            val authenticatedSession: AuthenticatedCloudSession = sessionProvider.authenticatedSession()
            val workspaceId: String = requireCurrentWorkspace(
                database = database,
                preferencesStore = preferencesStore,
                missingWorkspaceMessage = "Workspace progress reset requires a current local workspace."
            ).workspaceId
            runLinkedWorkspaceSyncForProgressReset(
                authenticatedSession = authenticatedSession,
                workspaceId = workspaceId
            )
            remoteService.loadWorkspaceResetProgressPreview(
                apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                bearerToken = authenticatedSession.credentials.idToken,
                workspaceId = workspaceId
            )
        }
    }

    suspend fun resetCurrentWorkspaceProgress(confirmationText: String): CloudWorkspaceResetProgressResult {
        return operationCoordinator.runExclusive {
            require(preferencesStore.currentCloudSettings().cloudState == CloudAccountState.LINKED) {
                "Workspace progress reset is available only for linked cloud workspaces."
            }
            val authenticatedSession: AuthenticatedCloudSession = sessionProvider.authenticatedSession()
            val currentWorkspaceId: String = requireCurrentWorkspace(
                database = database,
                preferencesStore = preferencesStore,
                missingWorkspaceMessage = "Workspace progress reset requires a current local workspace."
            ).workspaceId
            runLinkedWorkspaceSyncForProgressReset(
                authenticatedSession = authenticatedSession,
                workspaceId = currentWorkspaceId
            )
            val result: CloudWorkspaceResetProgressResult = remoteService.resetWorkspaceProgress(
                apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                bearerToken = authenticatedSession.credentials.idToken,
                workspaceId = currentWorkspaceId,
                confirmationText = confirmationText
            )
            runLinkedWorkspaceSyncForProgressReset(
                authenticatedSession = authenticatedSession,
                workspaceId = currentWorkspaceId
            )
            result
        }
    }

    suspend fun listLinkedWorkspaces(): List<CloudWorkspaceSummary> {
        val authenticatedSession: AuthenticatedCloudSession = sessionProvider.authenticatedSession()
        return remoteService.listLinkedWorkspaces(
            apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
            bearerToken = authenticatedSession.credentials.idToken
        )
    }

    private suspend fun runLinkedWorkspaceSyncForProgressReset(
        authenticatedSession: AuthenticatedCloudSession,
        workspaceId: String
    ) {
        runCloudSyncCore(
            cloudSettings = preferencesStore.currentCloudSettings(),
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
    }
}
