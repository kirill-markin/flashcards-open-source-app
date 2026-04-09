package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.ai.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.cloud.SyncLocalStore
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.model.AccountDeletionState
import com.flashcardsopensourceapp.data.local.model.CloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.CloudSettings
import com.flashcardsopensourceapp.data.local.model.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.SyncStatus
import com.flashcardsopensourceapp.data.local.model.SyncStatusSnapshot
import com.flashcardsopensourceapp.data.local.model.shouldRefreshCloudIdToken
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

class LocalSyncRepository(
    private val database: AppDatabase,
    private val preferencesStore: CloudPreferencesStore,
    private val remoteService: CloudRemoteGateway,
    private val syncLocalStore: SyncLocalStore,
    private val operationCoordinator: CloudOperationCoordinator,
    private val resetCoordinator: CloudIdentityResetCoordinator,
    private val guestSessionStore: GuestAiSessionStore,
    private val cloudGuestSessionCoordinator: CloudGuestSessionCoordinator,
    private val appVersion: String
) : SyncRepository, AutoSyncEventRepository {
    private val syncStatusState = MutableStateFlow(
        SyncStatusSnapshot(
            status = SyncStatus.Idle,
            lastSuccessfulSyncAtMillis = null,
            lastErrorMessage = ""
        )
    )
    private val autoSyncEventsFlow = MutableSharedFlow<AutoSyncEvent>(
        replay = 0,
        extraBufferCapacity = 32
    )

    override fun observeSyncStatus(): Flow<SyncStatusSnapshot> {
        return syncStatusState.asStateFlow()
    }

    override suspend fun scheduleSync() {
        syncNow()
    }

    override suspend fun syncNow() {
        performSync(autoSyncRequest = null)
    }

    override fun observeAutoSyncEvents(): Flow<AutoSyncEvent> {
        return autoSyncEventsFlow
    }

    override suspend fun runAutoSync(request: AutoSyncRequest) {
        performSync(autoSyncRequest = request)
    }

    private suspend fun performSync(autoSyncRequest: AutoSyncRequest?) {
        operationCoordinator.runExclusive {
            val currentCloudSettings = preferencesStore.currentCloudSettings()
            val previousCloudState = currentCloudSettings.cloudState
            val currentStatus = syncStatusState.value.status
            emitAutoSyncRequested(autoSyncRequest = autoSyncRequest)
            if (currentStatus is SyncStatus.Blocked) {
                if (currentStatus.installationId == currentCloudSettings.installationId) {
                    val error = IllegalStateException(currentStatus.message)
                    emitAutoSyncFailure(
                        autoSyncRequest = autoSyncRequest,
                        error = error
                    )
                    throw error
                }
                syncStatusState.value = SyncStatusSnapshot(
                    status = SyncStatus.Idle,
                    lastSuccessfulSyncAtMillis = syncStatusState.value.lastSuccessfulSyncAtMillis,
                    lastErrorMessage = ""
                )
            }
            if (preferencesStore.currentAccountDeletionState() != AccountDeletionState.Hidden) {
                emitAutoSyncSuccess(autoSyncRequest = autoSyncRequest)
                return@runExclusive
            }
            val reconciliation = cloudGuestSessionCoordinator.reconcilePersistedCloudStateLocked()
            val cloudSettings = reconciliation.cloudSettings
            val failureWorkspaceId = cloudSettings.activeWorkspaceId ?: cloudSettings.linkedWorkspaceId
            if (reconciliation.didRunSync) {
                syncStatusState.value = SyncStatusSnapshot(
                    status = SyncStatus.Idle,
                    lastSuccessfulSyncAtMillis = System.currentTimeMillis(),
                    lastErrorMessage = ""
                )
                emitAutoSyncSuccess(autoSyncRequest = autoSyncRequest)
                return@runExclusive
            }
            if (
                previousCloudState != CloudAccountState.GUEST &&
                cloudSettings.cloudState == CloudAccountState.GUEST &&
                reconciliation.guestRestoreRequiresSync.not()
            ) {
                syncStatusState.value = SyncStatusSnapshot(
                    status = SyncStatus.Idle,
                    lastSuccessfulSyncAtMillis = syncStatusState.value.lastSuccessfulSyncAtMillis,
                    lastErrorMessage = ""
                )
                emitAutoSyncSuccess(autoSyncRequest = autoSyncRequest)
                return@runExclusive
            }
            syncStatusState.value = syncStatusState.value.copy(status = SyncStatus.Syncing, lastErrorMessage = "")

            var syncTarget: CloudSyncTarget? = null
            try {
                syncTarget = resolveSyncTarget(cloudSettings = cloudSettings)
                runCloudSyncCore(
                    cloudSettings = cloudSettings,
                    workspaceId = syncTarget.workspaceId,
                    syncSession = syncTarget.session,
                    appVersion = appVersion,
                    remoteService = remoteService,
                    syncLocalStore = syncLocalStore
                )
                syncStatusState.value = SyncStatusSnapshot(
                    status = SyncStatus.Idle,
                    lastSuccessfulSyncAtMillis = System.currentTimeMillis(),
                    lastErrorMessage = ""
                )
                emitAutoSyncSuccess(autoSyncRequest = autoSyncRequest)
            } catch (error: CancellationException) {
                syncStatusState.value = SyncStatusSnapshot(
                    status = SyncStatus.Idle,
                    lastSuccessfulSyncAtMillis = syncStatusState.value.lastSuccessfulSyncAtMillis,
                    lastErrorMessage = ""
                )
                throw error
            } catch (error: Exception) {
                if (isRemoteAccountDeletedError(error = error)) {
                    resetCoordinator.disconnectCloudIdentityPreservingLocalState()
                    syncStatusState.value = SyncStatusSnapshot(
                        status = SyncStatus.Idle,
                        lastSuccessfulSyncAtMillis = syncStatusState.value.lastSuccessfulSyncAtMillis,
                        lastErrorMessage = ""
                    )
                    emitAutoSyncSuccess(autoSyncRequest = autoSyncRequest)
                    return@runExclusive
                }
                if (isCloudIdentityConflictError(error = error)) {
                    val message = error.message ?: "Cloud sync is blocked for this installation."
                    syncStatusState.value = SyncStatusSnapshot(
                        status = SyncStatus.Blocked(
                            message = message,
                            installationId = cloudSettings.installationId
                        ),
                        lastSuccessfulSyncAtMillis = syncStatusState.value.lastSuccessfulSyncAtMillis,
                        lastErrorMessage = message
                    )
                    emitAutoSyncFailure(
                        autoSyncRequest = autoSyncRequest,
                        error = error
                    )
                    throw error
                }
                val workspaceIdForFailure = syncTarget?.workspaceId ?: failureWorkspaceId
                if (workspaceIdForFailure != null) {
                    syncLocalStore.markSyncFailure(
                        workspaceIdForFailure,
                        error.message ?: "Cloud sync failed."
                    )
                }
                syncStatusState.value = SyncStatusSnapshot(
                    status = SyncStatus.Failed(error.message ?: "Cloud sync failed."),
                    lastSuccessfulSyncAtMillis = syncStatusState.value.lastSuccessfulSyncAtMillis,
                    lastErrorMessage = error.message ?: "Cloud sync failed."
                )
                emitAutoSyncFailure(
                    autoSyncRequest = autoSyncRequest,
                    error = error
                )
                throw error
            }
        }
    }

    private fun emitAutoSyncRequested(autoSyncRequest: AutoSyncRequest?) {
        if (autoSyncRequest == null) {
            return
        }

        autoSyncEventsFlow.tryEmit(
            AutoSyncEvent.Requested(request = autoSyncRequest)
        )
    }

    private fun emitAutoSyncSuccess(autoSyncRequest: AutoSyncRequest?) {
        if (autoSyncRequest == null) {
            return
        }

        autoSyncEventsFlow.tryEmit(
            AutoSyncEvent.Completed(
                completion = AutoSyncCompletion(
                    request = autoSyncRequest,
                    completedAtMillis = System.currentTimeMillis(),
                    outcome = AutoSyncOutcome.Succeeded
                )
            )
        )
    }

    private fun emitAutoSyncFailure(
        autoSyncRequest: AutoSyncRequest?,
        error: Exception
    ) {
        if (autoSyncRequest == null) {
            return
        }

        autoSyncEventsFlow.tryEmit(
            AutoSyncEvent.Completed(
                completion = AutoSyncCompletion(
                    request = autoSyncRequest,
                    completedAtMillis = System.currentTimeMillis(),
                    outcome = AutoSyncOutcome.Failed(
                        message = error.message ?: "Cloud sync failed."
                    )
                )
            )
        )
    }

    private suspend fun resolveSyncTarget(cloudSettings: CloudSettings): CloudSyncTarget {
        return when (cloudSettings.cloudState) {
            CloudAccountState.LINKED -> {
                val authenticatedSession = authenticatedSession()
                val workspaceId = requireNotNull(
                    cloudSettings.activeWorkspaceId ?: cloudSettings.linkedWorkspaceId
                ) {
                    "Cloud sync requires an active linked workspace."
                }
                CloudSyncTarget(
                    workspaceId = workspaceId,
                    session = CloudSyncSession(
                        apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                        authorizationHeader = "Bearer ${authenticatedSession.credentials.idToken}"
                    )
                )
            }

            CloudAccountState.GUEST -> {
                val configuration = preferencesStore.currentServerConfiguration()
                val workspaceId = requireNotNull(
                    cloudSettings.activeWorkspaceId ?: cloudSettings.linkedWorkspaceId
                ) {
                    "Cloud sync requires an active guest workspace."
                }
                val guestSession = guestSessionStore.loadSession(
                    localWorkspaceId = workspaceId,
                    configuration = configuration
                )
                val storedGuestSession = requireNotNull(guestSession) {
                    "Guest AI session is unavailable."
                }
                require(storedGuestSession.workspaceId == workspaceId) {
                    "Guest cloud sync requires active workspace '$workspaceId', but the stored guest session points to '${storedGuestSession.workspaceId}'."
                }
                CloudSyncTarget(
                    workspaceId = workspaceId,
                    session = CloudSyncSession(
                        apiBaseUrl = storedGuestSession.apiBaseUrl,
                        authorizationHeader = "Guest ${storedGuestSession.guestToken}"
                    )
                )
            }

            else -> {
                throw IllegalStateException("Cloud sync requires a linked or guest cloud account.")
            }
        }
    }

    private suspend fun authenticatedSession(): SyncAuthenticatedCloudSession {
        val configuration = preferencesStore.currentServerConfiguration()
        val storedCredentials = requireNotNull(preferencesStore.loadCredentials()) {
            "Cloud account is not signed in."
        }
        val refreshedCredentials = if (
            shouldRefreshCloudIdToken(
                idTokenExpiresAtMillis = storedCredentials.idTokenExpiresAtMillis,
                nowMillis = System.currentTimeMillis()
            )
        ) {
            remoteService.refreshIdToken(
                refreshToken = storedCredentials.refreshToken,
                authBaseUrl = configuration.authBaseUrl
            ).also(preferencesStore::saveCredentials)
        } else {
            storedCredentials
        }
        val accountSnapshot = remoteService.fetchCloudAccount(
            apiBaseUrl = configuration.apiBaseUrl,
            bearerToken = refreshedCredentials.idToken
        )
        return SyncAuthenticatedCloudSession(
            configuration = configuration,
            credentials = refreshedCredentials,
            accountSnapshot = accountSnapshot
        )
    }
}

private data class SyncAuthenticatedCloudSession(
    val configuration: CloudServiceConfiguration,
    val credentials: StoredCloudCredentials,
    val accountSnapshot: CloudAccountSnapshot
)

private data class CloudSyncTarget(
    val workspaceId: String,
    val session: CloudSyncSession
)
