package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.ai.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.cloud.SyncLocalStore
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.model.AccountDeletionState
import com.flashcardsopensourceapp.data.local.model.AgentApiKeyConnectionsResult
import com.flashcardsopensourceapp.data.local.model.CloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.CloudOtpChallenge
import com.flashcardsopensourceapp.data.local.model.CloudSendCodeResult
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.CloudSettings
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceDeletePreview
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceDeleteResult
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceResetProgressPreview
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceResetProgressResult
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkContext
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.StoredGuestAiSession
import com.flashcardsopensourceapp.data.local.model.makeCustomCloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.shouldRefreshCloudIdToken
import kotlinx.coroutines.flow.Flow
import org.json.JSONObject

private const val accountDeletionConfirmationTextForCloudApi: String = "delete my account"

class LocalCloudAccountRepository(
    private val database: AppDatabase,
    private val preferencesStore: CloudPreferencesStore,
    private val remoteService: CloudRemoteGateway,
    private val syncLocalStore: SyncLocalStore,
    private val operationCoordinator: CloudOperationCoordinator,
    private val resetCoordinator: CloudIdentityResetCoordinator,
    private val guestSessionStore: GuestAiSessionStore,
    private val appVersion: String
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
            val linkContext = buildCloudWorkspaceLinkContext(
                credentials = credentials,
                configuration = configuration
            )
            if (linkContext.guestUpgradeMode != null) {
                markGuestUpgradePreparationState()
            }
            linkContext
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
        val preferredWorkspaceId = resolvePreferredPostAuthWorkspaceId(
            workspaces = accountSnapshot.workspaces
        )
        return CloudWorkspaceLinkContext(
            userId = accountSnapshot.userId,
            email = accountSnapshot.email,
            credentials = credentials,
            workspaces = accountSnapshot.workspaces,
            guestUpgradeMode = guestUpgradeMode,
            preferredWorkspaceId = preferredWorkspaceId
        )
    }

    override suspend fun completeCloudLink(
        linkContext: CloudWorkspaceLinkContext,
        selection: CloudWorkspaceLinkSelection
    ): CloudWorkspaceSummary {
        return operationCoordinator.runExclusive {
            val authenticatedSession = authenticatedSession(linkContext = linkContext)
            val selectedWorkspace = resolveWorkspaceSelection(
                linkContext = linkContext,
                authenticatedSession = authenticatedSession,
                selection = selection
            )
            clearGuestSessionsIfNeeded()
            applyLinkedWorkspace(
                accountSnapshot = authenticatedSession.accountSnapshot,
                bearerToken = authenticatedSession.credentials.idToken,
                selectedWorkspace = selectedWorkspace
            )
            preferencesStore.saveCredentials(authenticatedSession.credentials)
            selectedWorkspace
        }
    }

    override suspend fun completeGuestUpgrade(
        linkContext: CloudWorkspaceLinkContext,
        selection: CloudWorkspaceLinkSelection
    ): CloudWorkspaceSummary {
        return operationCoordinator.runExclusive {
            val authenticatedSession = authenticatedSession(linkContext = linkContext)
            val configuration = preferencesStore.currentServerConfiguration()
            val guestSession = requireNotNull(activeGuestSession(configuration = configuration)) {
                "Guest AI session is unavailable."
            }
            val validatedSelection = validateWorkspaceSelection(
                linkContext = linkContext,
                selection = selection
            )
            val selectedWorkspace = remoteService.completeGuestUpgrade(
                apiBaseUrl = configuration.apiBaseUrl,
                bearerToken = authenticatedSession.credentials.idToken,
                guestToken = guestSession.guestToken,
                selection = validatedSelection.toGuestUpgradeSelection()
            )
            clearGuestSessionsIfNeeded()
            applyLinkedWorkspace(
                accountSnapshot = authenticatedSession.accountSnapshot,
                bearerToken = authenticatedSession.credentials.idToken,
                selectedWorkspace = selectedWorkspace
            )
            preferencesStore.saveCredentials(authenticatedSession.credentials)
            selectedWorkspace
        }
    }

    override suspend fun completeLinkedWorkspaceTransition(
        selection: CloudWorkspaceLinkSelection
    ): CloudWorkspaceSummary {
        return operationCoordinator.runExclusive {
            val authenticatedSession = authenticatedSession()
            val selectedWorkspace = when (selection) {
                is CloudWorkspaceLinkSelection.Existing -> {
                    require(authenticatedSession.accountSnapshot.workspaces.any { workspace ->
                        workspace.workspaceId == selection.workspaceId
                    }) {
                        "Selected workspace is unavailable. Refresh the workspace list and try again."
                    }
                    remoteService.selectWorkspace(
                        apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                        bearerToken = authenticatedSession.credentials.idToken,
                        workspaceId = selection.workspaceId
                    )
                }

                CloudWorkspaceLinkSelection.CreateNew -> remoteService.createWorkspace(
                    apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                    bearerToken = authenticatedSession.credentials.idToken,
                    name = "Personal"
                )
            }
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

    override suspend fun loadCurrentWorkspaceResetProgressPreview(): CloudWorkspaceResetProgressPreview {
        require(preferencesStore.currentCloudSettings().cloudState == CloudAccountState.LINKED) {
            "Workspace progress reset is available only for linked cloud workspaces."
        }
        return operationCoordinator.runExclusive {
            val authenticatedSession = authenticatedSession()
            val workspaceId = requireCurrentWorkspace(
                database = database,
                preferencesStore = preferencesStore,
                missingWorkspaceMessage = "Workspace progress reset requires a current local workspace."
            ).workspaceId
            runCloudSyncCore(
                cloudSettings = preferencesStore.currentCloudSettings(),
                workspaceId = workspaceId,
                syncSession = CloudSyncSession(
                    apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                    authorizationHeader = "Bearer ${authenticatedSession.credentials.idToken}"
                ),
                appVersion = appVersion,
                remoteService = remoteService,
                syncLocalStore = syncLocalStore
            )
            remoteService.loadWorkspaceResetProgressPreview(
                apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                bearerToken = authenticatedSession.credentials.idToken,
                workspaceId = workspaceId
            )
        }
    }

    override suspend fun resetCurrentWorkspaceProgress(confirmationText: String): CloudWorkspaceResetProgressResult {
        return operationCoordinator.runExclusive {
            require(preferencesStore.currentCloudSettings().cloudState == CloudAccountState.LINKED) {
                "Workspace progress reset is available only for linked cloud workspaces."
            }
            val authenticatedSession = authenticatedSession()
            val currentWorkspaceId = requireCurrentWorkspace(
                database = database,
                preferencesStore = preferencesStore,
                missingWorkspaceMessage = "Workspace progress reset requires a current local workspace."
            ).workspaceId
            runCloudSyncCore(
                cloudSettings = preferencesStore.currentCloudSettings(),
                workspaceId = currentWorkspaceId,
                syncSession = CloudSyncSession(
                    apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                    authorizationHeader = "Bearer ${authenticatedSession.credentials.idToken}"
                ),
                appVersion = appVersion,
                remoteService = remoteService,
                syncLocalStore = syncLocalStore
            )
            val result = remoteService.resetWorkspaceProgress(
                apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                bearerToken = authenticatedSession.credentials.idToken,
                workspaceId = currentWorkspaceId,
                confirmationText = confirmationText
            )
            runCloudSyncCore(
                cloudSettings = preferencesStore.currentCloudSettings(),
                workspaceId = currentWorkspaceId,
                syncSession = CloudSyncSession(
                    apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                    authorizationHeader = "Bearer ${authenticatedSession.credentials.idToken}"
                ),
                appVersion = appVersion,
                remoteService = remoteService,
                syncLocalStore = syncLocalStore
            )
            result
        }
    }

    override suspend fun loadProgressSeries(
        timeZone: String,
        from: String,
        to: String
    ): CloudProgressSeries {
        return operationCoordinator.runExclusive {
            val progressSession = progressSession()
            remoteService.loadProgressSeries(
                apiBaseUrl = progressSession.apiBaseUrl,
                authorizationHeader = progressSession.authorizationHeader,
                timeZone = timeZone,
                from = from,
                to = to
            )
        }
    }

    override suspend fun loadProgressSummary(
        timeZone: String,
    ): CloudProgressSummary {
        return operationCoordinator.runExclusive {
            val progressSession = progressSession()
            remoteService.loadProgressSummary(
                apiBaseUrl = progressSession.apiBaseUrl,
                authorizationHeader = progressSession.authorizationHeader,
                timeZone = timeZone,
            )
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

    private suspend fun authenticatedSession(linkContext: CloudWorkspaceLinkContext): AuthenticatedCloudSession {
        try {
            val configuration = preferencesStore.currentServerConfiguration()
            val refreshedCredentials = if (
                shouldRefreshCloudIdToken(
                    idTokenExpiresAtMillis = linkContext.credentials.idTokenExpiresAtMillis,
                    nowMillis = System.currentTimeMillis()
                )
            ) {
                remoteService.refreshIdToken(
                    refreshToken = linkContext.credentials.refreshToken,
                    authBaseUrl = configuration.authBaseUrl
                )
            } else {
                linkContext.credentials
            }
            val accountSnapshot = fetchCloudAccount(refreshedCredentials, configuration)
            require(accountSnapshot.userId == linkContext.userId) {
                "Cloud account changed during workspace setup. Start sign-in again."
            }

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
        linkContext: CloudWorkspaceLinkContext,
        authenticatedSession: AuthenticatedCloudSession,
        selection: CloudWorkspaceLinkSelection
    ): CloudWorkspaceSummary {
        val validatedSelection = validateWorkspaceSelection(
            linkContext = linkContext,
            selection = selection
        )

        return when (validatedSelection) {
            is CloudWorkspaceLinkSelection.Existing -> remoteService.selectWorkspace(
                apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                bearerToken = authenticatedSession.credentials.idToken,
                workspaceId = validatedSelection.workspaceId
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
                .put("platform", androidClientPlatform)
                .put("appVersion", appVersion)
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
                appVersion = appVersion,
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
            val activeWorkspaceSession = guestSessionStore.loadSession(
                localWorkspaceId = guestWorkspaceId,
                configuration = configuration
            )
            if (activeWorkspaceSession != null) {
                return activeWorkspaceSession
            }
        }

        return guestSessionStore.loadAnySession(configuration = configuration)
    }

    private suspend fun progressSession(): ProgressCloudSession {
        val cloudSettings = preferencesStore.currentCloudSettings()
        return when (cloudSettings.cloudState) {
            CloudAccountState.LINKED -> {
                val authenticatedSession = authenticatedSession()
                ProgressCloudSession(
                    apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                    authorizationHeader = "Bearer ${authenticatedSession.credentials.idToken}"
                )
            }

            CloudAccountState.GUEST -> {
                val configuration = preferencesStore.currentServerConfiguration()
                val guestSession = requireNotNull(activeGuestSession(configuration = configuration)) {
                    "Guest progress requires an active guest session."
                }
                ProgressCloudSession(
                    apiBaseUrl = guestSession.apiBaseUrl,
                    authorizationHeader = "Guest ${guestSession.guestToken}"
                )
            }

            else -> {
                throw IllegalStateException("Progress requires a linked or guest cloud account.")
            }
        }
    }

    private suspend fun markGuestUpgradePreparationState() {
        val cloudSettings = preferencesStore.currentCloudSettings()
        preferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.GUEST,
            linkedUserId = null,
            linkedWorkspaceId = null,
            linkedEmail = null,
            activeWorkspaceId = cloudSettings.activeWorkspaceId
        )
    }

    private fun clearGuestSessionsIfNeeded() {
        guestSessionStore.clearAllSessions()
    }
}

private data class AuthenticatedCloudSession(
    val configuration: CloudServiceConfiguration,
    val credentials: StoredCloudCredentials,
    val accountSnapshot: CloudAccountSnapshot
)

private data class ProgressCloudSession(
    val apiBaseUrl: String,
    val authorizationHeader: String
)
