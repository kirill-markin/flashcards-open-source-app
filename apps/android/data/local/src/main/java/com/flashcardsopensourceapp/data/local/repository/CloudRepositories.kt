package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.ai.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.CloudRemoteException
import com.flashcardsopensourceapp.data.local.cloud.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.cloud.RemoteBootstrapPullResponse
import com.flashcardsopensourceapp.data.local.cloud.SyncLocalStore
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.model.AccountDeletionState
import com.flashcardsopensourceapp.data.local.model.CloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeMode
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeSelection
import com.flashcardsopensourceapp.data.local.model.CloudOtpChallenge
import com.flashcardsopensourceapp.data.local.model.CloudSendCodeResult
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.CloudSettings
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkContext
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceDeletePreview
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceDeleteResult
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.AgentApiKeyConnectionsResult
import com.flashcardsopensourceapp.data.local.model.PersistedOutboxEntry
import com.flashcardsopensourceapp.data.local.model.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.StoredGuestAiSession
import com.flashcardsopensourceapp.data.local.model.SyncOperationPayload
import com.flashcardsopensourceapp.data.local.model.SyncStatus
import com.flashcardsopensourceapp.data.local.model.SyncStatusSnapshot
import com.flashcardsopensourceapp.data.local.model.formatIsoTimestamp
import com.flashcardsopensourceapp.data.local.model.makeCustomCloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.shouldRefreshCloudIdToken
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject

private const val syncPullPageLimit: Int = 200
private const val bootstrapPageLimit: Int = 200
private const val accountDeletionConfirmationTextForCloudApi: String = "delete my account"

class LocalCloudAccountRepository(
    private val database: AppDatabase,
    private val preferencesStore: CloudPreferencesStore,
    private val remoteService: CloudRemoteGateway,
    private val syncLocalStore: SyncLocalStore,
    private val resetCoordinator: CloudIdentityResetCoordinator,
    private val guestSessionStore: GuestAiSessionStore
) : CloudAccountRepository {
    private var isAccountDeletionRunning: Boolean = false

    override fun observeCloudSettings(): Flow<CloudSettings> {
        return preferencesStore.observeCloudSettings()
    }

    override fun observeAccountDeletionState(): Flow<AccountDeletionState> {
        return preferencesStore.observeAccountDeletionState()
    }

    override fun observeServerConfiguration(): Flow<CloudServiceConfiguration> {
        return preferencesStore.observeServerConfiguration()
    }

    override suspend fun beginAccountDeletion() {
        preferencesStore.markAccountDeletionInProgress()
        runAccountDeletion()
    }

    override suspend fun resumePendingAccountDeletionIfNeeded() {
        if (preferencesStore.currentAccountDeletionState() == AccountDeletionState.Hidden) {
            return
        }
        runAccountDeletion()
    }

    override suspend fun retryPendingAccountDeletion() {
        preferencesStore.markAccountDeletionInProgress()
        runAccountDeletion()
    }

    override suspend fun sendCode(email: String): CloudSendCodeResult {
        val configuration = preferencesStore.currentServerConfiguration()
        return remoteService.sendCode(
            email = email,
            authBaseUrl = configuration.authBaseUrl
        )
    }

    override suspend fun verifyCode(challenge: CloudOtpChallenge, code: String): CloudWorkspaceLinkContext {
        val configuration = preferencesStore.currentServerConfiguration()
        val credentials = remoteService.verifyCode(
            challenge = challenge,
            code = code,
            authBaseUrl = configuration.authBaseUrl
        )
        preferencesStore.saveCredentials(credentials)

        val accountSnapshot = fetchCloudAccount(credentials = credentials, configuration = configuration)
        val guestSession = activeGuestSession(configuration = configuration)
        val guestUpgradeMode = if (guestSession == null) {
            null
        } else {
            remoteService.prepareGuestUpgrade(
                apiBaseUrl = configuration.apiBaseUrl,
                bearerToken = credentials.idToken,
                guestToken = guestSession.guestToken
            )
        }
        preferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.LINKING_READY,
            linkedUserId = accountSnapshot.userId,
            linkedWorkspaceId = null,
            linkedEmail = accountSnapshot.email,
            activeWorkspaceId = database.workspaceDao().loadWorkspace()?.workspaceId
        )
        return CloudWorkspaceLinkContext(
            userId = accountSnapshot.userId,
            email = accountSnapshot.email,
            workspaces = accountSnapshot.workspaces,
            guestUpgradeMode = guestUpgradeMode
        )
    }

    override suspend fun completeCloudLink(selection: CloudWorkspaceLinkSelection): CloudWorkspaceSummary {
        val authenticatedSession = authenticatedSession()
        val selectedWorkspace = resolveWorkspaceSelection(
            authenticatedSession = authenticatedSession,
            selection = selection
        )
        clearGuestSessionsIfNeeded()
        applyLinkedWorkspace(
            accountSnapshot = authenticatedSession.accountSnapshot,
            bearerToken = authenticatedSession.credentials.idToken,
            selectedWorkspace = selectedWorkspace
        )
        return selectedWorkspace
    }

    override suspend fun completeGuestUpgrade(selection: CloudWorkspaceLinkSelection): CloudWorkspaceSummary {
        val authenticatedSession = authenticatedSession()
        val configuration = preferencesStore.currentServerConfiguration()
        val guestSession = requireNotNull(activeGuestSession(configuration = configuration)) {
            "Guest AI session is unavailable."
        }
        val selectedWorkspace = remoteService.completeGuestUpgrade(
            apiBaseUrl = configuration.apiBaseUrl,
            bearerToken = authenticatedSession.credentials.idToken,
            guestToken = guestSession.guestToken,
            selection = selection.toGuestUpgradeSelection()
        )
        clearGuestSessionsIfNeeded()
        applyLinkedWorkspace(
            accountSnapshot = authenticatedSession.accountSnapshot,
            bearerToken = authenticatedSession.credentials.idToken,
            selectedWorkspace = selectedWorkspace
        )
        return selectedWorkspace
    }

    override suspend fun logout() {
        resetCoordinator.resetLocalStateForCloudIdentityChange()
    }

    override suspend fun renameCurrentWorkspace(name: String): CloudWorkspaceSummary {
        require(preferencesStore.currentCloudSettings().cloudState == CloudAccountState.LINKED) {
            "Workspace rename is available only for linked cloud workspaces."
        }
        val authenticatedSession = authenticatedSession()
        val workspace = requireNotNull(database.workspaceDao().loadWorkspace()) {
            "Workspace rename requires a local workspace."
        }
        val trimmedName = name.trim()
        require(trimmedName.isNotEmpty()) {
            "Workspace name is required."
        }

        val renamedWorkspace = remoteService.renameWorkspace(
            apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
            bearerToken = authenticatedSession.credentials.idToken,
            workspaceId = workspace.workspaceId,
            name = trimmedName
        )
        database.workspaceDao().updateWorkspace(
            workspace.copy(name = renamedWorkspace.name)
        )
        return renamedWorkspace
    }

    override suspend fun loadCurrentWorkspaceDeletePreview(): CloudWorkspaceDeletePreview {
        require(preferencesStore.currentCloudSettings().cloudState == CloudAccountState.LINKED) {
            "Workspace deletion is available only for linked cloud workspaces."
        }
        val authenticatedSession = authenticatedSession()
        val workspaceId = requireNotNull(database.workspaceDao().loadWorkspace()?.workspaceId) {
            "Workspace deletion requires a local workspace."
        }
        return remoteService.loadWorkspaceDeletePreview(
            apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
            bearerToken = authenticatedSession.credentials.idToken,
            workspaceId = workspaceId
        )
    }

    override suspend fun deleteCurrentWorkspace(confirmationText: String): CloudWorkspaceDeleteResult {
        require(preferencesStore.currentCloudSettings().cloudState == CloudAccountState.LINKED) {
            "Workspace deletion is available only for linked cloud workspaces."
        }
        val authenticatedSession = authenticatedSession()
        val currentWorkspaceId = requireNotNull(database.workspaceDao().loadWorkspace()?.workspaceId) {
            "Workspace deletion requires a local workspace."
        }
        val result = remoteService.deleteWorkspace(
            apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
            bearerToken = authenticatedSession.credentials.idToken,
            workspaceId = currentWorkspaceId,
            confirmationText = confirmationText
        )

        syncLocalStore.replaceLocalWorkspaceWithShell(result.workspace)
        preferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.LINKED,
            linkedUserId = authenticatedSession.accountSnapshot.userId,
            linkedWorkspaceId = result.workspace.workspaceId,
            linkedEmail = authenticatedSession.accountSnapshot.email,
            activeWorkspaceId = result.workspace.workspaceId
        )
        return result
    }

    override suspend fun deleteAccount(confirmationText: String) {
        val authenticatedSession = authenticatedSession()
        try {
            remoteService.deleteAccount(
                apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                bearerToken = authenticatedSession.credentials.idToken,
                confirmationText = confirmationText
            )
        } catch (error: Exception) {
            if (isRemoteAccountDeletedError(error = error)) {
                resetCoordinator.resetLocalStateForCloudIdentityChange()
                return
            }
            throw error
        }
        resetCoordinator.resetLocalStateForCloudIdentityChange()
    }

    override suspend fun listLinkedWorkspaces(): List<CloudWorkspaceSummary> {
        val authenticatedSession = authenticatedSession()
        return remoteService.listLinkedWorkspaces(
            apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
            bearerToken = authenticatedSession.credentials.idToken
        )
    }

    override suspend fun switchLinkedWorkspace(selection: CloudWorkspaceLinkSelection): CloudWorkspaceSummary {
        val authenticatedSession = authenticatedSession()
        val selectedWorkspace = resolveWorkspaceSelection(
            authenticatedSession = authenticatedSession,
            selection = selection
        )
        applyLinkedWorkspace(
            accountSnapshot = authenticatedSession.accountSnapshot,
            bearerToken = authenticatedSession.credentials.idToken,
            selectedWorkspace = selectedWorkspace
        )
        return selectedWorkspace
    }

    override suspend fun listAgentConnections(): AgentApiKeyConnectionsResult {
        require(preferencesStore.currentCloudSettings().cloudState == CloudAccountState.LINKED) {
            "Agent connections are available only for linked cloud accounts."
        }
        val authenticatedSession = authenticatedSession()
        return remoteService.listAgentConnections(
            apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
            bearerToken = authenticatedSession.credentials.idToken
        )
    }

    override suspend fun revokeAgentConnection(connectionId: String): AgentApiKeyConnectionsResult {
        require(preferencesStore.currentCloudSettings().cloudState == CloudAccountState.LINKED) {
            "Agent connections are available only for linked cloud accounts."
        }
        val authenticatedSession = authenticatedSession()
        return remoteService.revokeAgentConnection(
            apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
            bearerToken = authenticatedSession.credentials.idToken,
            connectionId = connectionId
        )
    }

    override suspend fun currentServerConfiguration(): CloudServiceConfiguration {
        return preferencesStore.currentServerConfiguration()
    }

    override suspend fun validateCustomServer(customOrigin: String): CloudServiceConfiguration {
        val configuration = makeCustomCloudServiceConfiguration(customOrigin = customOrigin)
        remoteService.validateConfiguration(configuration)
        return configuration
    }

    override suspend fun applyCustomServer(configuration: CloudServiceConfiguration) {
        preferencesStore.applyCustomServer(configuration)
        resetCoordinator.resetLocalStateForCloudIdentityChange()
    }

    override suspend fun resetToOfficialServer() {
        preferencesStore.resetToOfficialServer()
        resetCoordinator.resetLocalStateForCloudIdentityChange()
    }

    private suspend fun runAccountDeletion() {
        if (isAccountDeletionRunning) {
            return
        }

        isAccountDeletionRunning = true
        try {
            val authenticatedSession = authenticatedSession()
            try {
                remoteService.deleteAccount(
                    apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                    bearerToken = authenticatedSession.credentials.idToken,
                    confirmationText = accountDeletionConfirmationTextForCloudApi
                )
            } catch (error: Exception) {
                if (isRemoteAccountDeletedError(error = error).not()) {
                    preferencesStore.markAccountDeletionFailed(
                        message = error.message ?: "Account deletion failed."
                    )
                    return
                }
            }
            resetCoordinator.resetLocalStateForCloudIdentityChange()
        } catch (error: Exception) {
            if (isRemoteAccountDeletedError(error = error)) {
                resetCoordinator.resetLocalStateForCloudIdentityChange()
                return
            }
            preferencesStore.markAccountDeletionFailed(
                message = error.message ?: "Account deletion failed."
            )
        } finally {
            isAccountDeletionRunning = false
        }
    }

    private suspend fun authenticatedSession(): AuthenticatedCloudSession {
        try {
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
            val accountSnapshot = fetchCloudAccount(refreshedCredentials, configuration)

            return AuthenticatedCloudSession(
                configuration = configuration,
                credentials = refreshedCredentials,
                accountSnapshot = accountSnapshot
            )
        } catch (error: Exception) {
            if (isRemoteAccountDeletedError(error = error)) {
                resetCoordinator.resetLocalStateForCloudIdentityChange()
                throw IllegalStateException("Your account has already been deleted.")
            }
            throw error
        }
    }

    private fun fetchCloudAccount(
        credentials: StoredCloudCredentials,
        configuration: CloudServiceConfiguration
    ): CloudAccountSnapshot {
        return remoteService.fetchCloudAccount(
            apiBaseUrl = configuration.apiBaseUrl,
            bearerToken = credentials.idToken
        )
    }

    private fun resolveWorkspaceSelection(
        authenticatedSession: AuthenticatedCloudSession,
        selection: CloudWorkspaceLinkSelection
    ): CloudWorkspaceSummary {
        return when (selection) {
            is CloudWorkspaceLinkSelection.Existing -> remoteService.selectWorkspace(
                apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                bearerToken = authenticatedSession.credentials.idToken,
                workspaceId = selection.workspaceId
            )

            CloudWorkspaceLinkSelection.CreateNew -> remoteService.createWorkspace(
                apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                bearerToken = authenticatedSession.credentials.idToken,
                name = "Personal"
            )
        }
    }

    private suspend fun applyLinkedWorkspace(
        accountSnapshot: CloudAccountSnapshot,
        bearerToken: String,
        selectedWorkspace: CloudWorkspaceSummary
    ) {
        val configuration = preferencesStore.currentServerConfiguration()
        val bootstrapProbe = remoteService.bootstrapPull(
            apiBaseUrl = configuration.apiBaseUrl,
            bearerToken = bearerToken,
            workspaceId = selectedWorkspace.workspaceId,
            body = JSONObject()
                .put("mode", "pull")
                .put("deviceId", preferencesStore.currentCloudSettings().deviceId)
                .put("platform", "android")
                .put("appVersion", "0.1.0")
                .put("cursor", JSONObject.NULL)
                .put("limit", 1)
        )

        if (bootstrapProbe.remoteIsEmpty) {
            syncLocalStore.relinkCurrentWorkspaceKeepingLocalData(selectedWorkspace)
        } else {
            syncLocalStore.replaceLocalWorkspaceWithShell(selectedWorkspace)
        }

        preferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.LINKED,
            linkedUserId = accountSnapshot.userId,
            linkedWorkspaceId = selectedWorkspace.workspaceId,
            linkedEmail = accountSnapshot.email,
            activeWorkspaceId = selectedWorkspace.workspaceId
        )
    }

    private suspend fun activeGuestSession(configuration: CloudServiceConfiguration): StoredGuestAiSession? {
        val localWorkspaceId = database.workspaceDao().loadWorkspace()?.workspaceId
        return guestSessionStore.loadSession(
            localWorkspaceId = localWorkspaceId,
            configuration = configuration
        ) ?: guestSessionStore.loadAnySession(configuration = configuration)
    }

    private fun clearGuestSessionsIfNeeded() {
        guestSessionStore.clearAllSessions()
    }
}

private fun CloudWorkspaceLinkSelection.toGuestUpgradeSelection(): CloudGuestUpgradeSelection {
    return when (this) {
        is CloudWorkspaceLinkSelection.Existing -> CloudGuestUpgradeSelection.Existing(workspaceId = workspaceId)
        CloudWorkspaceLinkSelection.CreateNew -> CloudGuestUpgradeSelection.CreateNew
    }
}

class LocalSyncRepository(
    private val database: AppDatabase,
    private val preferencesStore: CloudPreferencesStore,
    private val remoteService: CloudRemoteGateway,
    private val syncLocalStore: SyncLocalStore,
    private val resetCoordinator: CloudIdentityResetCoordinator
) : SyncRepository {
    private val syncStatusState = MutableStateFlow(
        SyncStatusSnapshot(
            status = SyncStatus.Idle,
            lastSuccessfulSyncAtMillis = null,
            lastErrorMessage = ""
        )
    )

    override fun observeSyncStatus(): Flow<SyncStatusSnapshot> {
        return syncStatusState.asStateFlow()
    }

    override suspend fun scheduleSync() {
        syncNow()
    }

    override suspend fun syncNow() {
        if (preferencesStore.currentAccountDeletionState() != AccountDeletionState.Hidden) {
            return
        }
        val cloudSettings = preferencesStore.currentCloudSettings()
        require(cloudSettings.cloudState == CloudAccountState.LINKED) {
            "Cloud sync requires a linked cloud account."
        }
        val workspaceId = requireNotNull(cloudSettings.linkedWorkspaceId) {
            "Cloud sync requires a linked workspace."
        }
        val authenticatedSession = authenticatedSession()

        syncStatusState.value = syncStatusState.value.copy(status = SyncStatus.Syncing, lastErrorMessage = "")
        syncLocalStore.recordSyncAttempt(workspaceId)

        try {
            var syncState = syncLocalStore.ensureSyncState(workspaceId)
            var lastHotCursor = syncState.lastSyncCursor?.toLongOrNull() ?: 0L
            var lastReviewSequenceId = syncState.lastReviewSequenceId
            var hasHydratedHotState = syncState.hasHydratedHotState
            var hasHydratedReviewHistory = syncState.hasHydratedReviewHistory
            var bootstrapResponse: RemoteBootstrapPullResponse? = null

            if (hasHydratedHotState.not()) {
                bootstrapResponse = remoteService.bootstrapPull(
                    apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                    bearerToken = authenticatedSession.credentials.idToken,
                    workspaceId = workspaceId,
                    body = JSONObject()
                        .put("mode", "pull")
                        .put("deviceId", cloudSettings.deviceId)
                        .put("platform", "android")
                        .put("appVersion", "0.1.0")
                        .put("cursor", JSONObject.NULL)
                        .put("limit", bootstrapPageLimit)
                )

                if (bootstrapResponse.remoteIsEmpty) {
                    val bootstrapEntries = syncLocalStore.buildBootstrapEntries(workspaceId)
                    if (bootstrapEntries.length() > 0) {
                        val bootstrapPushResponse = remoteService.bootstrapPush(
                            apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                            bearerToken = authenticatedSession.credentials.idToken,
                            workspaceId = workspaceId,
                            body = JSONObject()
                                .put("mode", "push")
                                .put("deviceId", cloudSettings.deviceId)
                                .put("platform", "android")
                                .put("appVersion", "0.1.0")
                                .put("entries", bootstrapEntries)
                        )
                        lastHotCursor = bootstrapPushResponse.bootstrapHotChangeId ?: lastHotCursor
                    }
                } else {
                    syncLocalStore.applyBootstrapEntries(workspaceId, bootstrapResponse.entries)
                    lastHotCursor = bootstrapResponse.bootstrapHotChangeId
                    var nextCursor = bootstrapResponse.nextCursor

                    while (bootstrapResponse.hasMore && nextCursor != null) {
                        val nextPage = remoteService.bootstrapPull(
                            apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                            bearerToken = authenticatedSession.credentials.idToken,
                            workspaceId = workspaceId,
                            body = JSONObject()
                                .put("mode", "pull")
                                .put("deviceId", cloudSettings.deviceId)
                                .put("platform", "android")
                                .put("appVersion", "0.1.0")
                                .put("cursor", nextCursor)
                                .put("limit", bootstrapPageLimit)
                        )
                        syncLocalStore.applyBootstrapEntries(workspaceId, nextPage.entries)
                        nextCursor = nextPage.nextCursor
                        lastHotCursor = nextPage.bootstrapHotChangeId
                        if (nextPage.hasMore.not()) {
                            break
                        }
                    }
                }

                hasHydratedHotState = true
            }

            if (hasHydratedReviewHistory.not()) {
                if (bootstrapResponse?.remoteIsEmpty == true) {
                    val reviewEvents = syncLocalStore.buildReviewHistoryImportEvents(workspaceId)
                    if (reviewEvents.length() > 0) {
                        val importResponse = remoteService.importReviewHistory(
                            apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                            bearerToken = authenticatedSession.credentials.idToken,
                            workspaceId = workspaceId,
                            body = JSONObject()
                                .put("deviceId", cloudSettings.deviceId)
                                .put("platform", "android")
                                .put("appVersion", "0.1.0")
                                .put("reviewEvents", reviewEvents)
                        )
                        lastReviewSequenceId = importResponse.nextReviewSequenceId ?: lastReviewSequenceId
                    }
                } else {
                    var hasMore = true
                    while (hasMore) {
                        val reviewHistoryPage = remoteService.pullReviewHistory(
                            apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                            bearerToken = authenticatedSession.credentials.idToken,
                            workspaceId = workspaceId,
                            body = JSONObject()
                                .put("deviceId", cloudSettings.deviceId)
                                .put("platform", "android")
                                .put("appVersion", "0.1.0")
                                .put("afterReviewSequenceId", lastReviewSequenceId)
                                .put("limit", syncPullPageLimit)
                        )
                        syncLocalStore.applyReviewHistory(reviewHistoryPage.reviewEvents)
                        lastReviewSequenceId = reviewHistoryPage.nextReviewSequenceId
                        hasMore = reviewHistoryPage.hasMore
                    }
                }

                hasHydratedReviewHistory = true
            }

            val outboxEntries = syncLocalStore.loadOutboxEntries(workspaceId)
            if (outboxEntries.isNotEmpty()) {
                try {
                    val pushResponse = remoteService.push(
                        apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                        bearerToken = authenticatedSession.credentials.idToken,
                        workspaceId = workspaceId,
                        body = buildPushRequest(
                            deviceId = cloudSettings.deviceId,
                            outboxEntries = outboxEntries
                        )
                    )
                    syncLocalStore.deleteOutboxEntries(pushResponse.operations.map { result -> result.operationId })
                    val pushCursor = pushResponse.operations.mapNotNull { result -> result.resultingHotChangeId }.maxOrNull()
                    if (pushCursor != null && pushCursor > lastHotCursor) {
                        lastHotCursor = pushCursor
                    }
                } catch (error: Exception) {
                    syncLocalStore.markOutboxEntriesFailed(
                        outboxEntries.map(PersistedOutboxEntry::operationId),
                        error.message ?: "Cloud push failed."
                    )
                    throw error
                }
            }

            var hasMoreHotChanges = true
            while (hasMoreHotChanges) {
                val pullResponse = remoteService.pull(
                    apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                    bearerToken = authenticatedSession.credentials.idToken,
                    workspaceId = workspaceId,
                    body = JSONObject()
                        .put("deviceId", cloudSettings.deviceId)
                        .put("platform", "android")
                        .put("appVersion", "0.1.0")
                        .put("afterHotChangeId", lastHotCursor)
                        .put("limit", syncPullPageLimit)
                )
                syncLocalStore.applyPullChanges(workspaceId, pullResponse.changes)
                lastHotCursor = pullResponse.nextHotChangeId
                hasMoreHotChanges = pullResponse.hasMore
            }

            var hasMoreReviewHistory = true
            while (hasMoreReviewHistory) {
                val reviewHistoryPage = remoteService.pullReviewHistory(
                    apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                    bearerToken = authenticatedSession.credentials.idToken,
                    workspaceId = workspaceId,
                    body = JSONObject()
                        .put("deviceId", cloudSettings.deviceId)
                        .put("platform", "android")
                        .put("appVersion", "0.1.0")
                        .put("afterReviewSequenceId", lastReviewSequenceId)
                        .put("limit", syncPullPageLimit)
                )
                syncLocalStore.applyReviewHistory(reviewHistoryPage.reviewEvents)
                lastReviewSequenceId = reviewHistoryPage.nextReviewSequenceId
                hasMoreReviewHistory = reviewHistoryPage.hasMore
            }

            syncLocalStore.markSyncSuccess(
                workspaceId = workspaceId,
                lastSyncCursor = lastHotCursor.toString(),
                lastReviewSequenceId = lastReviewSequenceId,
                hasHydratedHotState = hasHydratedHotState,
                hasHydratedReviewHistory = hasHydratedReviewHistory
            )
            syncStatusState.value = SyncStatusSnapshot(
                status = SyncStatus.Idle,
                lastSuccessfulSyncAtMillis = System.currentTimeMillis(),
                lastErrorMessage = ""
            )
        } catch (error: Exception) {
            if (isRemoteAccountDeletedError(error = error)) {
                resetCoordinator.resetLocalStateForCloudIdentityChange()
                syncStatusState.value = SyncStatusSnapshot(
                    status = SyncStatus.Idle,
                    lastSuccessfulSyncAtMillis = null,
                    lastErrorMessage = ""
                )
                return
            }
            syncLocalStore.markSyncFailure(workspaceId, error.message ?: "Cloud sync failed.")
            syncStatusState.value = SyncStatusSnapshot(
                status = SyncStatus.Failed(error.message ?: "Cloud sync failed."),
                lastSuccessfulSyncAtMillis = syncStatusState.value.lastSuccessfulSyncAtMillis,
                lastErrorMessage = error.message ?: "Cloud sync failed."
            )
            throw error
        }
    }

    private fun authenticatedSession(): AuthenticatedCloudSession {
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
        return AuthenticatedCloudSession(
            configuration = configuration,
            credentials = refreshedCredentials,
            accountSnapshot = accountSnapshot
        )
    }
}

private fun isRemoteAccountDeletedError(error: Exception): Boolean {
    return error is CloudRemoteException
        && error.statusCode == 410
        && error.errorCode == "ACCOUNT_DELETED"
}

private data class AuthenticatedCloudSession(
    val configuration: CloudServiceConfiguration,
    val credentials: StoredCloudCredentials,
    val accountSnapshot: CloudAccountSnapshot
)

private fun buildPushRequest(deviceId: String, outboxEntries: List<PersistedOutboxEntry>): JSONObject {
    return JSONObject()
        .put("deviceId", deviceId)
        .put("platform", "android")
        .put("appVersion", "0.1.0")
        .put(
            "operations",
            JSONArray().apply {
                outboxEntries.forEach { entry ->
                    put(
                        JSONObject()
                            .put("operationId", entry.operation.operationId)
                            .put("entityType", entry.operation.entityType.toRemoteValue())
                            .put("entityId", entry.operation.entityId)
                            .put("action", entry.operation.action.toRemoteValue())
                            .put("clientUpdatedAt", entry.operation.clientUpdatedAt)
                            .put("payload", buildOperationPayload(entry.operation.payload))
                    )
                }
            }
        )
}

private fun buildOperationPayload(payload: SyncOperationPayload): JSONObject {
    return when (payload) {
        is SyncOperationPayload.Card -> JSONObject()
            .put("cardId", payload.payload.cardId)
            .put("frontText", payload.payload.frontText)
            .put("backText", payload.payload.backText)
            .put("tags", JSONArray(payload.payload.tags))
            .put("effortLevel", payload.payload.effortLevel)
            .put("dueAt", payload.payload.dueAt)
            .put("createdAt", payload.payload.createdAt)
            .put("reps", payload.payload.reps)
            .put("lapses", payload.payload.lapses)
            .put("fsrsCardState", payload.payload.fsrsCardState)
            .put("fsrsStepIndex", payload.payload.fsrsStepIndex)
            .put("fsrsStability", payload.payload.fsrsStability)
            .put("fsrsDifficulty", payload.payload.fsrsDifficulty)
            .put("fsrsLastReviewedAt", payload.payload.fsrsLastReviewedAt)
            .put("fsrsScheduledDays", payload.payload.fsrsScheduledDays)
            .put("deletedAt", payload.payload.deletedAt)

        is SyncOperationPayload.Deck -> JSONObject()
            .put("deckId", payload.payload.deckId)
            .put("name", payload.payload.name)
            .put("filterDefinition", buildDeckFilterDefinitionJson(payload.payload.filterDefinition))
            .put("createdAt", payload.payload.createdAt)
            .put("deletedAt", payload.payload.deletedAt)

        is SyncOperationPayload.WorkspaceSchedulerSettings -> JSONObject()
            .put("algorithm", payload.payload.algorithm)
            .put("desiredRetention", payload.payload.desiredRetention)
            .put("learningStepsMinutes", JSONArray(payload.payload.learningStepsMinutes))
            .put("relearningStepsMinutes", JSONArray(payload.payload.relearningStepsMinutes))
            .put("maximumIntervalDays", payload.payload.maximumIntervalDays)
            .put("enableFuzz", payload.payload.enableFuzz)

        is SyncOperationPayload.ReviewEvent -> JSONObject()
            .put("reviewEventId", payload.payload.reviewEventId)
            .put("cardId", payload.payload.cardId)
            .put("deviceId", payload.payload.deviceId)
            .put("clientEventId", payload.payload.clientEventId)
            .put("rating", payload.payload.rating)
            .put("reviewedAtClient", payload.payload.reviewedAtClient)
    }
}

private fun buildDeckFilterDefinitionJson(filterDefinition: com.flashcardsopensourceapp.data.local.model.DeckFilterDefinition): JSONObject {
    return JSONObject()
        .put("version", filterDefinition.version)
        .put("effortLevels", JSONArray(filterDefinition.effortLevels.map { effortLevel -> effortLevel.name.lowercase() }))
        .put("tags", JSONArray(filterDefinition.tags))
}

private fun com.flashcardsopensourceapp.data.local.model.SyncEntityType.toRemoteValue(): String {
    return when (this) {
        com.flashcardsopensourceapp.data.local.model.SyncEntityType.CARD -> "card"
        com.flashcardsopensourceapp.data.local.model.SyncEntityType.DECK -> "deck"
        com.flashcardsopensourceapp.data.local.model.SyncEntityType.WORKSPACE_SCHEDULER_SETTINGS -> "workspace_scheduler_settings"
        com.flashcardsopensourceapp.data.local.model.SyncEntityType.REVIEW_EVENT -> "review_event"
    }
}

private fun com.flashcardsopensourceapp.data.local.model.SyncAction.toRemoteValue(): String {
    return when (this) {
        com.flashcardsopensourceapp.data.local.model.SyncAction.UPSERT -> "upsert"
        com.flashcardsopensourceapp.data.local.model.SyncAction.APPEND -> "append"
    }
}
