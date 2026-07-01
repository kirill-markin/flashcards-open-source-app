package com.flashcardsopensourceapp.data.local.repository.cloudsync.workspace

import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.cloud.sync.SyncLocalStore
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.database.entities.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceDeletePreview
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceDeleteResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceResetProgressPreview
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceResetProgressResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportDownloadResponse
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportPreview
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportRequest
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportConfirmOptions
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportConfirmResult
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportPreview
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
        val cloudSettings: CloudSettings = preferencesStore.currentCloudSettings()
        require(cloudSettings.cloudState == CloudAccountState.LINKED) {
            "Workspace progress reset is available only for linked cloud workspaces."
        }
        return operationCoordinator.runExclusive {
            val authenticatedSession: AuthenticatedCloudSession = sessionProvider.authenticatedSession()
            val workspaceId: String = requireCurrentWorkspace(
                database = database,
                preferencesStore = preferencesStore,
                missingWorkspaceMessage = "Workspace progress reset requires a current local workspace."
            ).workspaceId
            runLinkedWorkspaceSync(
                authenticatedSession = authenticatedSession,
                workspaceId = workspaceId,
                cloudSettings = cloudSettings
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
            val cloudSettings: CloudSettings = preferencesStore.currentCloudSettings()
            require(cloudSettings.cloudState == CloudAccountState.LINKED) {
                "Workspace progress reset is available only for linked cloud workspaces."
            }
            val authenticatedSession: AuthenticatedCloudSession = sessionProvider.authenticatedSession()
            val currentWorkspaceId: String = requireCurrentWorkspace(
                database = database,
                preferencesStore = preferencesStore,
                missingWorkspaceMessage = "Workspace progress reset requires a current local workspace."
            ).workspaceId
            runLinkedWorkspaceSync(
                authenticatedSession = authenticatedSession,
                workspaceId = currentWorkspaceId,
                cloudSettings = cloudSettings
            )
            val result: CloudWorkspaceResetProgressResult = remoteService.resetWorkspaceProgress(
                apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                bearerToken = authenticatedSession.credentials.idToken,
                workspaceId = currentWorkspaceId,
                confirmationText = confirmationText
            )
            runLinkedWorkspaceSync(
                authenticatedSession = authenticatedSession,
                workspaceId = currentWorkspaceId,
                cloudSettings = cloudSettings
            )
            result
        }
    }

    suspend fun previewCurrentWorkspacePackageExport(
        request: WorkspacePackageExportRequest
    ): WorkspacePackageExportPreview {
        return operationCoordinator.runExclusive {
            val cloudSettings: CloudSettings = preferencesStore.currentCloudSettings()
            require(cloudSettings.cloudState == CloudAccountState.LINKED) {
                "Workspace package export is available only for linked cloud workspaces."
            }
            val authenticatedSession: AuthenticatedCloudSession = sessionProvider.authenticatedSession()
            val workspaceId: String = requireCurrentWorkspace(
                database = database,
                preferencesStore = preferencesStore,
                missingWorkspaceMessage = "Workspace package export requires a current local workspace."
            ).workspaceId
            runLinkedWorkspaceSync(
                authenticatedSession = authenticatedSession,
                workspaceId = workspaceId,
                cloudSettings = cloudSettings
            )
            remoteService.previewWorkspacePackageExport(
                apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                authorizationHeader = "Bearer ${authenticatedSession.credentials.idToken}",
                workspaceId = workspaceId,
                request = request
            )
        }
    }

    suspend fun exportCurrentWorkspacePackage(
        request: WorkspacePackageExportRequest
    ): WorkspacePackageExportDownloadResponse {
        return operationCoordinator.runExclusive {
            require(preferencesStore.currentCloudSettings().cloudState == CloudAccountState.LINKED) {
                "Workspace package export is available only for linked cloud workspaces."
            }
            val authenticatedSession: AuthenticatedCloudSession = sessionProvider.authenticatedSession()
            val workspaceId: String = requireCurrentWorkspace(
                database = database,
                preferencesStore = preferencesStore,
                missingWorkspaceMessage = "Workspace package export requires a current local workspace."
            ).workspaceId
            remoteService.exportWorkspacePackage(
                apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                authorizationHeader = "Bearer ${authenticatedSession.credentials.idToken}",
                workspaceId = workspaceId,
                request = request
            )
        }
    }

    suspend fun previewCurrentWorkspacePackageImport(packageBytes: ByteArray): WorkspacePackageImportPreview {
        return operationCoordinator.runExclusive {
            require(preferencesStore.currentCloudSettings().cloudState == CloudAccountState.LINKED) {
                "Workspace package import is available only for linked cloud workspaces."
            }
            val authenticatedSession: AuthenticatedCloudSession = sessionProvider.authenticatedSession()
            val workspaceId: String = requireCurrentWorkspace(
                database = database,
                preferencesStore = preferencesStore,
                missingWorkspaceMessage = "Workspace package import requires a current local workspace."
            ).workspaceId
            remoteService.previewWorkspacePackageImport(
                apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                authorizationHeader = "Bearer ${authenticatedSession.credentials.idToken}",
                workspaceId = workspaceId,
                packageBytes = packageBytes
            )
        }
    }

    suspend fun confirmCurrentWorkspacePackageImport(
        fileName: String,
        packageBytes: ByteArray,
        options: WorkspacePackageImportConfirmOptions
    ): WorkspacePackageImportConfirmResult {
        return operationCoordinator.runExclusive {
            val cloudSettings: CloudSettings = preferencesStore.currentCloudSettings()
            require(cloudSettings.cloudState == CloudAccountState.LINKED) {
                "Workspace package import is available only for linked cloud workspaces."
            }
            val trimmedFileName = fileName.trim()
            require(trimmedFileName.isNotEmpty()) {
                "Workspace package import requires a selected ZIP file name."
            }
            val authenticatedSession: AuthenticatedCloudSession = sessionProvider.authenticatedSession()
            val workspaceId: String = requireCurrentWorkspace(
                database = database,
                preferencesStore = preferencesStore,
                missingWorkspaceMessage = "Workspace package import requires a current local workspace."
            ).workspaceId
            runLinkedWorkspaceSync(
                authenticatedSession = authenticatedSession,
                workspaceId = workspaceId,
                cloudSettings = cloudSettings
            )
            val lastModifiedByReplicaId: String = buildClientWorkspaceReplicaId(
                workspaceId = workspaceId,
                installationId = cloudSettings.installationId
            )
            val result: WorkspacePackageImportConfirmResult = remoteService.confirmWorkspacePackageImport(
                apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                authorizationHeader = "Bearer ${authenticatedSession.credentials.idToken}",
                workspaceId = workspaceId,
                fileName = trimmedFileName,
                packageBytes = packageBytes,
                lastModifiedByReplicaId = lastModifiedByReplicaId,
                options = options
            )
            runLinkedWorkspaceSync(
                authenticatedSession = authenticatedSession,
                workspaceId = workspaceId,
                cloudSettings = cloudSettings
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

    private suspend fun runLinkedWorkspaceSync(
        authenticatedSession: AuthenticatedCloudSession,
        workspaceId: String,
        cloudSettings: CloudSettings
    ) {
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
    }
}
