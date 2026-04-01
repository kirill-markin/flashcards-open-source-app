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
import com.flashcardsopensourceapp.data.local.model.buildDeckFilterDefinitionJsonObject
import com.flashcardsopensourceapp.data.local.model.formatIsoTimestamp
import com.flashcardsopensourceapp.data.local.model.makeCustomCloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.shouldRefreshCloudIdToken
import kotlinx.coroutines.CancellationException
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
    private val operationCoordinator: CloudOperationCoordinator,
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
        operationCoordinator.runExclusive {
            preferencesStore.markAccountDeletionInProgress()
            runAccountDeletion()
        }
    }

    override suspend fun resumePendingAccountDeletionIfNeeded() {
        operationCoordinator.runExclusive {
            if (preferencesStore.currentAccountDeletionState() == AccountDeletionState.Hidden) {
                return@runExclusive
            }
            runAccountDeletion()
        }
    }

    override suspend fun retryPendingAccountDeletion() {
        operationCoordinator.runExclusive {
            preferencesStore.markAccountDeletionInProgress()
            runAccountDeletion()
        }
    }

    override suspend fun sendCode(email: String): CloudSendCodeResult {
        val configuration = preferencesStore.currentServerConfiguration()
        return remoteService.sendCode(
            email = email,
            authBaseUrl = configuration.authBaseUrl
        )
    }

    override suspend fun prepareVerifiedSignIn(credentials: StoredCloudCredentials): CloudWorkspaceLinkContext {
        return operationCoordinator.runExclusive {
            val configuration = preferencesStore.currentServerConfiguration()
            preferencesStore.saveCredentials(credentials)
            buildCloudWorkspaceLinkContext(
                credentials = credentials,
                configuration = configuration
            )
        }
    }

    override suspend fun verifyCode(challenge: CloudOtpChallenge, code: String): CloudWorkspaceLinkContext {
        return operationCoordinator.runExclusive {
            val configuration = preferencesStore.currentServerConfiguration()
            val credentials = remoteService.verifyCode(
                challenge = challenge,
                code = code,
                authBaseUrl = configuration.authBaseUrl
            )
            preferencesStore.saveCredentials(credentials)
            buildCloudWorkspaceLinkContext(
                credentials = credentials,
                configuration = configuration
            )
        }
    }

    /**
     * Review/demo accounts can skip OTP and return verified credentials
     * directly from `sendCode()`. The UI still needs the normal post-auth link
     * context so the live smoke can keep one continuous cross-screen story.
     *
     * The post-auth chooser must be driven by the remote cloud selection, not
     * by whatever local workspace shell currently exists on Android.
     */
    private suspend fun buildCloudWorkspaceLinkContext(
        credentials: StoredCloudCredentials,
        configuration: CloudServiceConfiguration
    ): CloudWorkspaceLinkContext {
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
        val currentCloudSettings = preferencesStore.currentCloudSettings()
        val currentLocalWorkspaceId = loadCurrentWorkspaceOrNull(
            database = database,
            preferencesStore = preferencesStore
        )?.workspaceId
        val preferredWorkspaceId = resolvePreferredPostAuthWorkspaceId(
            workspaces = accountSnapshot.workspaces
        )
        preferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.LINKING_READY,
            linkedUserId = accountSnapshot.userId,
            linkedWorkspaceId = null,
            linkedEmail = accountSnapshot.email,
            activeWorkspaceId = currentLocalWorkspaceId ?: currentCloudSettings.activeWorkspaceId
        )
        return CloudWorkspaceLinkContext(
            userId = accountSnapshot.userId,
            email = accountSnapshot.email,
            workspaces = accountSnapshot.workspaces,
            guestUpgradeMode = guestUpgradeMode,
            preferredWorkspaceId = preferredWorkspaceId
        )
    }

    override suspend fun completeCloudLink(selection: CloudWorkspaceLinkSelection): CloudWorkspaceSummary {
        return operationCoordinator.runExclusive {
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
            selectedWorkspace
        }
    }

    override suspend fun completeGuestUpgrade(selection: CloudWorkspaceLinkSelection): CloudWorkspaceSummary {
        return operationCoordinator.runExclusive {
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
            selectedWorkspace
        }
    }

    override suspend fun completeLinkedWorkspaceTransition(
        selection: CloudWorkspaceLinkSelection
    ): CloudWorkspaceSummary {
        return operationCoordinator.runExclusive {
            val authenticatedSession = authenticatedSession()
            val selectedWorkspace = resolveWorkspaceSelection(
                authenticatedSession = authenticatedSession,
                selection = selection
            )
            applyLinkedWorkspaceAndSync(
                authenticatedSession = authenticatedSession,
                selectedWorkspace = selectedWorkspace
            )
            selectedWorkspace
        }
    }

    override suspend fun logout() {
        operationCoordinator.runExclusive {
            resetCoordinator.resetLocalStateForCloudIdentityChange()
        }
    }

    override suspend fun renameCurrentWorkspace(name: String): CloudWorkspaceSummary {
        return operationCoordinator.runExclusive {
            require(preferencesStore.currentCloudSettings().cloudState == CloudAccountState.LINKED) {
                "Workspace rename is available only for linked cloud workspaces."
            }
            val authenticatedSession = authenticatedSession()
            val workspace = requireCurrentWorkspace(
                database = database,
                preferencesStore = preferencesStore,
                missingWorkspaceMessage = "Workspace rename requires a current local workspace."
            )
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
            renamedWorkspace
        }
    }

    override suspend fun loadCurrentWorkspaceDeletePreview(): CloudWorkspaceDeletePreview {
        require(preferencesStore.currentCloudSettings().cloudState == CloudAccountState.LINKED) {
            "Workspace deletion is available only for linked cloud workspaces."
        }
        val authenticatedSession = authenticatedSession()
        val workspaceId = requireCurrentWorkspace(
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

    override suspend fun deleteCurrentWorkspace(confirmationText: String): CloudWorkspaceDeleteResult {
        return operationCoordinator.runExclusive {
            require(preferencesStore.currentCloudSettings().cloudState == CloudAccountState.LINKED) {
                "Workspace deletion is available only for linked cloud workspaces."
            }
            val authenticatedSession = authenticatedSession()
            val currentWorkspaceId = requireCurrentWorkspace(
                database = database,
                preferencesStore = preferencesStore,
                missingWorkspaceMessage = "Workspace deletion requires a current local workspace."
            ).workspaceId
            val result = remoteService.deleteWorkspace(
                apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                bearerToken = authenticatedSession.credentials.idToken,
                workspaceId = currentWorkspaceId,
                confirmationText = confirmationText
            )

            val localReplacementWorkspace = syncLocalStore.migrateLocalShellToLinkedWorkspace(
                workspace = result.workspace,
                remoteWorkspaceIsEmpty = false
            )
            requireLocalWorkspaceSelection(
                stage = "after local replacement for delete",
                expectedWorkspaceId = result.workspace.workspaceId,
                actualWorkspaceId = localReplacementWorkspace.workspaceId
            )
            preferencesStore.updateCloudSettings(
                cloudState = CloudAccountState.LINKED,
                linkedUserId = authenticatedSession.accountSnapshot.userId,
                linkedWorkspaceId = result.workspace.workspaceId,
                linkedEmail = authenticatedSession.accountSnapshot.email,
                activeWorkspaceId = result.workspace.workspaceId
            )
            requireTransitionInvariant(
                stage = "after prefs update for delete",
                expectedWorkspaceId = result.workspace.workspaceId
            )
            runInitialLinkedWorkspaceSync(
                authenticatedSession = authenticatedSession,
                workspaceId = result.workspace.workspaceId
            )
            requireTransitionInvariant(
                stage = "after initial sync for delete",
                expectedWorkspaceId = result.workspace.workspaceId
            )
            result
        }
    }

    override suspend fun deleteAccount(confirmationText: String) {
        operationCoordinator.runExclusive {
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
                    return@runExclusive
                }
                throw error
            }
            resetCoordinator.resetLocalStateForCloudIdentityChange()
        }
    }

    override suspend fun listLinkedWorkspaces(): List<CloudWorkspaceSummary> {
        val authenticatedSession = authenticatedSession()
        return remoteService.listLinkedWorkspaces(
            apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
            bearerToken = authenticatedSession.credentials.idToken
        )
    }

    override suspend fun switchLinkedWorkspace(selection: CloudWorkspaceLinkSelection): CloudWorkspaceSummary {
        return completeLinkedWorkspaceTransition(selection = selection)
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
        operationCoordinator.runExclusive {
            preferencesStore.applyCustomServer(configuration)
            resetCoordinator.resetLocalStateForCloudIdentityChange()
        }
    }

    override suspend fun resetToOfficialServer() {
        operationCoordinator.runExclusive {
            preferencesStore.resetToOfficialServer()
            resetCoordinator.resetLocalStateForCloudIdentityChange()
        }
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

    private suspend fun fetchCloudAccount(
        credentials: StoredCloudCredentials,
        configuration: CloudServiceConfiguration
    ): CloudAccountSnapshot {
        return remoteService.fetchCloudAccount(
            apiBaseUrl = configuration.apiBaseUrl,
            bearerToken = credentials.idToken
        )
    }

    private suspend fun resolveWorkspaceSelection(
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
            authorizationHeader = "Bearer $bearerToken",
            workspaceId = selectedWorkspace.workspaceId,
            body = JSONObject()
                .put("mode", "pull")
                .put("installationId", preferencesStore.currentCloudSettings().installationId)
                .put("platform", "android")
                .put("appVersion", "1.0.0")
                .put("cursor", JSONObject.NULL)
                .put("limit", 1)
        )

        val localLinkedWorkspace = syncLocalStore.migrateLocalShellToLinkedWorkspace(
            workspace = selectedWorkspace,
            remoteWorkspaceIsEmpty = bootstrapProbe.remoteIsEmpty
        )
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
        val localCurrentWorkspace = requireCurrentWorkspace(
            database = database,
            preferencesStore = preferencesStore,
            missingWorkspaceMessage = "Linked workspace is missing locally after cloud link."
        )
        check(localCurrentWorkspace.workspaceId == selectedWorkspace.workspaceId) {
            "Linked workspace '${selectedWorkspace.workspaceId}' did not become the current local workspace. " +
                "Local workspace='${localCurrentWorkspace.workspaceId}'."
        }
    }

    private suspend fun applyLinkedWorkspaceAndSync(
        authenticatedSession: AuthenticatedCloudSession,
        selectedWorkspace: CloudWorkspaceSummary
    ) {
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

    private suspend fun runInitialLinkedWorkspaceSync(
        authenticatedSession: AuthenticatedCloudSession,
        workspaceId: String
    ) {
        val cloudSettings = preferencesStore.currentCloudSettings()
        val localWorkspaceIds = database.workspaceDao().loadWorkspaces().map { workspace -> workspace.workspaceId }
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
                remoteService = remoteService,
                syncLocalStore = syncLocalStore
            )
        } catch (error: Exception) {
            syncLocalStore.markSyncFailure(
                workspaceId = workspaceId,
                errorMessage = error.message ?: "Cloud sync failed."
            )
            throw IllegalStateException(
                buildTransitionInvariantMessage(
                    stage = "initial sync failed",
                    expectedWorkspaceId = workspaceId,
                    localWorkspaceIds = database.workspaceDao().loadWorkspaces().map { workspace -> workspace.workspaceId },
                    cloudSettings = preferencesStore.currentCloudSettings()
                ) + " Cause=${error.message ?: "Cloud sync failed."}",
                error
            )
        }
    }

    private suspend fun requireLocalWorkspaceSelection(
        stage: String,
        expectedWorkspaceId: String,
        actualWorkspaceId: String
    ) {
        val localWorkspaceIds = database.workspaceDao().loadWorkspaces().map { workspace -> workspace.workspaceId }
        val cloudSettings = preferencesStore.currentCloudSettings()
        require(actualWorkspaceId == expectedWorkspaceId) {
            buildTransitionInvariantMessage(
                stage = stage,
                expectedWorkspaceId = expectedWorkspaceId,
                localWorkspaceIds = localWorkspaceIds,
                cloudSettings = cloudSettings
            ) + " ActualLocalWorkspaceId='$actualWorkspaceId'"
        }
    }

    private suspend fun requireTransitionInvariant(
        stage: String,
        expectedWorkspaceId: String
    ) {
        val cloudSettings = preferencesStore.currentCloudSettings()
        val localWorkspaceIds = database.workspaceDao().loadWorkspaces().map { workspace -> workspace.workspaceId }
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

    private suspend fun activeGuestSession(configuration: CloudServiceConfiguration): StoredGuestAiSession? {
        val cloudSettings = preferencesStore.currentCloudSettings()
        val guestWorkspaceId = cloudSettings.activeWorkspaceId ?: cloudSettings.linkedWorkspaceId
        if (cloudSettings.cloudState == CloudAccountState.GUEST && guestWorkspaceId != null) {
            return guestSessionStore.loadSession(
                localWorkspaceId = guestWorkspaceId,
                configuration = configuration
            )
        }

        return guestSessionStore.loadAnySession(configuration = configuration)
    }

    private fun clearGuestSessionsIfNeeded() {
        guestSessionStore.clearAllSessions()
    }
}

private fun resolvePreferredPostAuthWorkspaceId(
    workspaces: List<CloudWorkspaceSummary>
): String? {
    if (workspaces.size == 1) {
        return workspaces.first().workspaceId
    }
    val selectedWorkspaceIds = workspaces.filter(CloudWorkspaceSummary::isSelected)
        .map(CloudWorkspaceSummary::workspaceId)
        .distinct()
    return if (selectedWorkspaceIds.size == 1) {
        selectedWorkspaceIds.single()
    } else {
        null
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
    private val operationCoordinator: CloudOperationCoordinator,
    private val resetCoordinator: CloudIdentityResetCoordinator,
    private val guestSessionStore: GuestAiSessionStore,
    private val cloudGuestSessionCoordinator: CloudGuestSessionCoordinator
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
        operationCoordinator.runExclusive {
            val currentCloudSettings = preferencesStore.currentCloudSettings()
            val currentStatus = syncStatusState.value.status
            if (currentStatus is SyncStatus.Blocked) {
                if (currentStatus.installationId == currentCloudSettings.installationId) {
                    throw IllegalStateException(currentStatus.message)
                }
                syncStatusState.value = SyncStatusSnapshot(
                    status = SyncStatus.Idle,
                    lastSuccessfulSyncAtMillis = syncStatusState.value.lastSuccessfulSyncAtMillis,
                    lastErrorMessage = ""
                )
            }
            if (preferencesStore.currentAccountDeletionState() != AccountDeletionState.Hidden) {
                return@runExclusive
            }
            val cloudSettings = cloudGuestSessionCoordinator.reconcilePersistedCloudStateLocked().cloudSettings
            val syncTarget = resolveSyncTarget(cloudSettings = cloudSettings)

            syncStatusState.value = syncStatusState.value.copy(status = SyncStatus.Syncing, lastErrorMessage = "")

            try {
                runCloudSyncCore(
                    cloudSettings = cloudSettings,
                    workspaceId = syncTarget.workspaceId,
                    syncSession = syncTarget.session,
                    remoteService = remoteService,
                    syncLocalStore = syncLocalStore
                )
                syncStatusState.value = SyncStatusSnapshot(
                    status = SyncStatus.Idle,
                    lastSuccessfulSyncAtMillis = System.currentTimeMillis(),
                    lastErrorMessage = ""
                )
            } catch (error: CancellationException) {
                syncStatusState.value = SyncStatusSnapshot(
                    status = SyncStatus.Idle,
                    lastSuccessfulSyncAtMillis = syncStatusState.value.lastSuccessfulSyncAtMillis,
                    lastErrorMessage = ""
                )
                throw error
            } catch (error: Exception) {
                if (isRemoteAccountDeletedError(error = error)) {
                    resetCoordinator.resetLocalStateForCloudIdentityChange()
                    syncStatusState.value = SyncStatusSnapshot(
                        status = SyncStatus.Idle,
                        lastSuccessfulSyncAtMillis = null,
                        lastErrorMessage = ""
                    )
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
                    throw error
                }
                syncLocalStore.markSyncFailure(syncTarget.workspaceId, error.message ?: "Cloud sync failed.")
                syncStatusState.value = SyncStatusSnapshot(
                    status = SyncStatus.Failed(error.message ?: "Cloud sync failed."),
                    lastSuccessfulSyncAtMillis = syncStatusState.value.lastSuccessfulSyncAtMillis,
                    lastErrorMessage = error.message ?: "Cloud sync failed."
                )
                throw error
            }
        }
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

    private suspend fun authenticatedSession(): AuthenticatedCloudSession {
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

private suspend fun runCloudSyncCore(
    cloudSettings: CloudSettings,
    workspaceId: String,
    syncSession: CloudSyncSession,
    remoteService: CloudRemoteGateway,
    syncLocalStore: SyncLocalStore
) {
    syncLocalStore.recordSyncAttempt(workspaceId)
    val syncState = syncLocalStore.ensureSyncState(workspaceId)
    var lastHotCursor = syncState.lastSyncCursor?.toLongOrNull() ?: 0L
    var lastReviewSequenceId = syncState.lastReviewSequenceId
    var hasHydratedHotState = syncState.hasHydratedHotState
    var hasHydratedReviewHistory = syncState.hasHydratedReviewHistory
    var bootstrapResponse: RemoteBootstrapPullResponse? = null

    if (hasHydratedHotState.not()) {
        bootstrapResponse = remoteService.bootstrapPull(
            apiBaseUrl = syncSession.apiBaseUrl,
            authorizationHeader = syncSession.authorizationHeader,
            workspaceId = workspaceId,
            body = JSONObject()
                .put("mode", "pull")
                .put("installationId", cloudSettings.installationId)
                .put("platform", "android")
                .put("appVersion", "1.0.0")
                .put("cursor", JSONObject.NULL)
                .put("limit", bootstrapPageLimit)
        )

        if (bootstrapResponse.remoteIsEmpty) {
            val bootstrapEntries = syncLocalStore.buildBootstrapEntries(workspaceId)
            if (bootstrapEntries.length() > 0) {
                val bootstrapPushResponse = remoteService.bootstrapPush(
                    apiBaseUrl = syncSession.apiBaseUrl,
                    authorizationHeader = syncSession.authorizationHeader,
                    workspaceId = workspaceId,
                    body = JSONObject()
                        .put("mode", "push")
                        .put("installationId", cloudSettings.installationId)
                        .put("platform", "android")
                        .put("appVersion", "1.0.0")
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
                    apiBaseUrl = syncSession.apiBaseUrl,
                    authorizationHeader = syncSession.authorizationHeader,
                    workspaceId = workspaceId,
                    body = JSONObject()
                        .put("mode", "pull")
                        .put("installationId", cloudSettings.installationId)
                        .put("platform", "android")
                        .put("appVersion", "1.0.0")
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
                    apiBaseUrl = syncSession.apiBaseUrl,
                    authorizationHeader = syncSession.authorizationHeader,
                    workspaceId = workspaceId,
                    body = JSONObject()
                        .put("installationId", cloudSettings.installationId)
                        .put("platform", "android")
                        .put("appVersion", "1.0.0")
                        .put("reviewEvents", reviewEvents)
                )
                lastReviewSequenceId = importResponse.nextReviewSequenceId ?: lastReviewSequenceId
            }
        } else {
            var hasMore = true
            while (hasMore) {
                val reviewHistoryPage = remoteService.pullReviewHistory(
                    apiBaseUrl = syncSession.apiBaseUrl,
                    authorizationHeader = syncSession.authorizationHeader,
                    workspaceId = workspaceId,
                    body = JSONObject()
                        .put("installationId", cloudSettings.installationId)
                        .put("platform", "android")
                        .put("appVersion", "1.0.0")
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
                apiBaseUrl = syncSession.apiBaseUrl,
                authorizationHeader = syncSession.authorizationHeader,
                workspaceId = workspaceId,
                body = buildPushRequest(
                    installationId = cloudSettings.installationId,
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
            apiBaseUrl = syncSession.apiBaseUrl,
            authorizationHeader = syncSession.authorizationHeader,
            workspaceId = workspaceId,
                body = JSONObject()
                    .put("installationId", cloudSettings.installationId)
                    .put("platform", "android")
                    .put("appVersion", "1.0.0")
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
            apiBaseUrl = syncSession.apiBaseUrl,
            authorizationHeader = syncSession.authorizationHeader,
            workspaceId = workspaceId,
            body = JSONObject()
                .put("installationId", cloudSettings.installationId)
                .put("platform", "android")
                .put("appVersion", "1.0.0")
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
}

private fun isRemoteAccountDeletedError(error: Exception): Boolean {
    return error is CloudRemoteException
        && error.statusCode == 410
        && error.errorCode == "ACCOUNT_DELETED"
}

internal fun isCloudIdentityConflictError(error: Exception): Boolean {
    return error is CloudRemoteException && (
        error.errorCode == "SYNC_INSTALLATION_PLATFORM_MISMATCH" ||
            error.errorCode == "SYNC_REPLICA_CONFLICT"
        )
}

private data class AuthenticatedCloudSession(
    val configuration: CloudServiceConfiguration,
    val credentials: StoredCloudCredentials,
    val accountSnapshot: CloudAccountSnapshot
)

private data class CloudSyncSession(
    val apiBaseUrl: String,
    val authorizationHeader: String
)

private data class CloudSyncTarget(
    val workspaceId: String,
    val session: CloudSyncSession
)

private fun buildPushRequest(installationId: String, outboxEntries: List<PersistedOutboxEntry>): JSONObject {
    return JSONObject()
        .put("installationId", installationId)
        .put("platform", "android")
        .put("appVersion", "1.0.0")
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
            .put("clientEventId", payload.payload.clientEventId)
            .put("rating", payload.payload.rating)
            .put("reviewedAtClient", payload.payload.reviewedAtClient)
    }
}

private fun buildDeckFilterDefinitionJson(filterDefinition: com.flashcardsopensourceapp.data.local.model.DeckFilterDefinition): JSONObject {
    return buildDeckFilterDefinitionJsonObject(filterDefinition = filterDefinition)
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
