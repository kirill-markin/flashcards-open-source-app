package com.flashcardsopensourceapp.data.local.repository.cloudsync.workspace

import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.cloud.sync.SyncLocalStore
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.database.entities.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCardMaintenanceAttempt
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCardMaintenanceConfirmation
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCardMaintenancePreview
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCardMaintenanceTarget
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCardMaintenanceRefreshException
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCardMaintenanceSignInRequiredException
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCardMaintenanceWorkspaceChangedException
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceDeletePreview
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceDeleteResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceResetProgressPreview
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceResetProgressResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportDownloadResponse
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportFormat
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportPreview
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportRequest
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportConfirmOptions
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportConfirmResult
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportPreview
import com.flashcardsopensourceapp.data.local.repository.cloudsync.account.CloudIdentityResetCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.AuthenticatedCloudSession
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudOperationCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudSessionProvider
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.isRemoteAccountDeletedError
import com.flashcardsopensourceapp.data.local.repository.cloudsync.sync.CloudSyncSession
import com.flashcardsopensourceapp.data.local.repository.cloudsync.sync.CloudWorkspaceForkRecoveryMode
import com.flashcardsopensourceapp.data.local.repository.cloudsync.sync.runCloudSyncCore
import java.io.File
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext

internal class CloudWorkspaceOperationsCoordinator(
    private val database: AppDatabase,
    private val preferencesStore: CloudPreferencesStore,
    private val remoteService: CloudRemoteGateway,
    private val syncLocalStore: SyncLocalStore,
    private val operationCoordinator: CloudOperationCoordinator,
    private val sessionProvider: CloudSessionProvider,
    private val resetCoordinator: CloudIdentityResetCoordinator,
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

    suspend fun previewCardMaintenance(target: CloudCardMaintenanceTarget): CloudCardMaintenancePreview {
        return withCardMaintenanceWorkspace(workspaceId = target.workspaceId) { session, cloudSettings ->
            runLinkedWorkspaceSync(
                authenticatedSession = session,
                workspaceId = target.workspaceId,
                cloudSettings = cloudSettings
            )
            remoteService.previewCardMaintenance(
                apiBaseUrl = session.configuration.apiBaseUrl,
                bearerToken = session.credentials.idToken,
                target = target
            )
        }
    }

    suspend fun executeCardMaintenance(confirmation: CloudCardMaintenanceConfirmation): Int {
        val workspaceId = confirmation.target.workspaceId
        return withCardMaintenanceWorkspace(workspaceId = workspaceId) { session, cloudSettings ->
            preferencesStore.runWithLocalOutboxWritesBlocked(
                reason = "Wait for card maintenance to finish before changing this workspace."
            ) {
                drainCardMaintenanceOutbox(
                    session = session,
                    workspaceId = workspaceId,
                    cloudSettings = cloudSettings
                )
                withContext(NonCancellable) {
                    val attempt = CloudCardMaintenanceAttempt(
                        attemptId = confirmation.attemptId,
                        previewFingerprint = confirmation.previewFingerprint,
                        affectedCardsCount = null,
                        isRefreshComplete = false
                    )
                    preferencesStore.saveCardMaintenanceAttempt(workspaceId = workspaceId, attempt = attempt)
                    val affectedCardsCount = try {
                        remoteService.executeCardMaintenance(
                            apiBaseUrl = session.configuration.apiBaseUrl,
                            bearerToken = session.credentials.idToken,
                            confirmation = confirmation
                        )
                    } catch (error: CloudRemoteException) {
                        if (error.statusCode in setOf(400, 401, 403, 404, 409)) {
                            preferencesStore.clearCardMaintenanceAttempt(workspaceId = workspaceId)
                        }
                        throw error
                    }
                    try {
                        preferencesStore.saveCardMaintenanceAttempt(
                            workspaceId = workspaceId,
                            attempt = attempt.copy(affectedCardsCount = affectedCardsCount)
                        )
                        runLinkedWorkspaceSync(
                            authenticatedSession = session,
                            workspaceId = workspaceId,
                            cloudSettings = cloudSettings
                        )
                    } catch (error: CancellationException) {
                        throw error
                    } catch (error: Exception) {
                        if (isRemoteAccountDeletedError(error = error)) throw error
                        throw CloudCardMaintenanceRefreshException(affectedCardsCount = affectedCardsCount, cause = error)
                    }
                    affectedCardsCount
                }
            }
        }
    }

    fun loadCardMaintenanceAttempt(workspaceId: String, attemptId: String): CloudCardMaintenanceAttempt? {
        return preferencesStore.loadCardMaintenanceAttempt(workspaceId = workspaceId)
            ?.takeIf { attempt -> attempt.attemptId == attemptId }
    }

    fun observeCardMaintenanceAttempt(workspaceId: String, attemptId: String): Flow<CloudCardMaintenanceAttempt?> {
        return preferencesStore.observeCardMaintenanceAttempt(workspaceId = workspaceId).map { attempt ->
            attempt?.takeIf { it.attemptId == attemptId }
        }
    }

    suspend fun refreshCardMaintenanceWorkspace(workspaceId: String, attemptId: String) {
        operationCoordinator.runExclusive {
            val attempt = loadCardMaintenanceAttempt(workspaceId = workspaceId, attemptId = attemptId)
            if (attempt?.isRefreshComplete == true) return@runExclusive

            withCardMaintenanceWorkspace(workspaceId = workspaceId) { session, cloudSettings ->
                runLinkedWorkspaceSync(
                    authenticatedSession = session,
                    workspaceId = workspaceId,
                    cloudSettings = cloudSettings
                )
            }
        }
    }

    private suspend fun drainCardMaintenanceOutbox(
        session: AuthenticatedCloudSession,
        workspaceId: String,
        cloudSettings: CloudSettings
    ) {
        var pendingCount = syncLocalStore.countOutboxEntries(workspaceId = workspaceId)
        do {
            runLinkedWorkspaceSync(
                authenticatedSession = session,
                workspaceId = workspaceId,
                cloudSettings = cloudSettings
            )
            val remainingCount = syncLocalStore.countOutboxEntries(workspaceId = workspaceId)
            if (remainingCount == 0) return
            check(remainingCount < pendingCount) {
                "Sync did not drain pending changes for workspace '$workspaceId' before card maintenance."
            }
            pendingCount = remainingCount
        } while (true)
    }

    private suspend fun <Result> withCardMaintenanceWorkspace(
        workspaceId: String,
        action: suspend (AuthenticatedCloudSession, CloudSettings) -> Result
    ): Result {
        return operationCoordinator.runExclusive {
            val cloudSettings = preferencesStore.currentCloudSettings()
            if (cloudSettings.cloudState != CloudAccountState.LINKED) {
                throw CloudCardMaintenanceSignInRequiredException(cause = null)
            }
            val workspace = loadCurrentWorkspaceOrNull(database = database, preferencesStore = preferencesStore)
            if (workspace?.workspaceId != workspaceId) {
                throw CloudCardMaintenanceWorkspaceChangedException()
            }

            try {
                action(sessionProvider.authenticatedSessionForCardMaintenance(), cloudSettings)
            } catch (error: CloudRemoteException) {
                if (!isRemoteAccountDeletedError(error = error)) throw error
                withContext(NonCancellable) {
                    resetCoordinator.disconnectDeletedCloudIdentityPreservingLocalState()
                }
                throw CloudCardMaintenanceSignInRequiredException(cause = error)
            }
        }
    }

    suspend fun previewCurrentWorkspacePackageExport(
        expectedWorkspaceId: String,
        request: WorkspacePackageExportRequest
    ): WorkspacePackageExportPreview {
        return operationCoordinator.runExclusive {
            val cloudSettings: CloudSettings = preferencesStore.currentCloudSettings()
            require(cloudSettings.cloudState == CloudAccountState.LINKED) {
                "Workspace package export is available only for linked cloud workspaces."
            }
            val authenticatedSession: AuthenticatedCloudSession = sessionProvider.authenticatedSession()
            val workspaceId: String = requireCurrentWorkspacePackageExportId(
                expectedWorkspaceId = expectedWorkspaceId
            )
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
        expectedWorkspaceId: String,
        format: WorkspacePackageExportFormat,
        request: WorkspacePackageExportRequest,
        destination: File
    ): WorkspacePackageExportDownloadResponse {
        return operationCoordinator.runExclusive {
            require(preferencesStore.currentCloudSettings().cloudState == CloudAccountState.LINKED) {
                "Workspace package export is available only for linked cloud workspaces."
            }
            val authenticatedSession: AuthenticatedCloudSession = sessionProvider.authenticatedSession()
            val workspaceId: String = requireCurrentWorkspacePackageExportId(
                expectedWorkspaceId = expectedWorkspaceId
            )
            remoteService.exportWorkspacePackage(
                apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                authorizationHeader = "Bearer ${authenticatedSession.credentials.idToken}",
                workspaceId = workspaceId,
                format = format,
                request = request,
                destination = destination
            )
        }
    }

    private suspend fun requireCurrentWorkspacePackageExportId(expectedWorkspaceId: String): String {
        val currentWorkspaceId = requireCurrentWorkspace(
            database = database,
            preferencesStore = preferencesStore,
            missingWorkspaceMessage = "Workspace package export requires a current local workspace."
        ).workspaceId
        check(currentWorkspaceId == expectedWorkspaceId) {
            "Workspace changed during package export preparation. Expected $expectedWorkspaceId, got $currentWorkspaceId."
        }
        return currentWorkspaceId
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
