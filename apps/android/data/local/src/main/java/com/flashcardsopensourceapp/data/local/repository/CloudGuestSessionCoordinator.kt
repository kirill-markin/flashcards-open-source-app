package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.ai.AiChatRemoteService
import com.flashcardsopensourceapp.data.local.ai.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.CloudRemoteException
import com.flashcardsopensourceapp.data.local.cloud.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.cloud.RemoteBootstrapPullResponse
import com.flashcardsopensourceapp.data.local.cloud.SyncLocalStore
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.model.CloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudSettings
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.StoredGuestAiSession
import com.flashcardsopensourceapp.data.local.model.shouldRefreshCloudIdToken
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext

internal data class CloudIdentityReconciliationResult(
    val cloudSettings: CloudSettings,
    val restoredGuestSession: StoredGuestAiSession?,
    val guestRestoreRequiresSync: Boolean,
    val didRunSync: Boolean
)

internal data class GuestCloudSessionRestoreResult(
    val session: StoredGuestAiSession,
    val shouldSync: Boolean
)

class CloudGuestSessionCoordinator(
    private val database: AppDatabase,
    private val preferencesStore: CloudPreferencesStore,
    private val remoteService: CloudRemoteGateway,
    private val syncLocalStore: SyncLocalStore,
    private val operationCoordinator: CloudOperationCoordinator,
    private val resetCoordinator: CloudIdentityResetCoordinator,
    private val guestSessionStore: GuestAiSessionStore,
    private val aiChatRemoteService: AiChatRemoteService
) {
    suspend fun reconcilePersistedCloudStateForStartup() {
        reconcilePersistedCloudState()
    }

    internal suspend fun reconcilePersistedCloudState(): CloudIdentityReconciliationResult {
        return operationCoordinator.runExclusive {
            reconcilePersistedCloudStateLocked()
        }
    }

    internal suspend fun restoreGuestCloudSessionIfNeeded(
        workspaceId: String?,
        createSessionIfMissing: Boolean
    ): GuestCloudSessionRestoreResult {
        return operationCoordinator.runExclusive {
            restoreGuestCloudSessionIfNeededLocked(
                workspaceId = workspaceId,
                createSessionIfMissing = createSessionIfMissing
            )
        }
    }

    internal suspend fun reconcilePersistedCloudStateLocked(): CloudIdentityReconciliationResult {
        val currentCloudSettings = preferencesStore.currentCloudSettings()
        if (hasInvalidActiveWorkspaceId(cloudSettings = currentCloudSettings)) {
            resetCoordinator.resetLocalStateForCloudIdentityChange()
            return CloudIdentityReconciliationResult(
                cloudSettings = preferencesStore.currentCloudSettings(),
                restoredGuestSession = null,
                guestRestoreRequiresSync = false,
                didRunSync = false
            )
        }

        if (currentCloudSettings.cloudState == CloudAccountState.LINKING_READY) {
            normalizeLegacyLinkingReadyStateLocked(cloudSettings = currentCloudSettings)
        }

        val configuration = preferencesStore.currentServerConfiguration()
        val storedCredentials = preferencesStore.loadCredentials()
        val storedGuestSession = guestSessionStore.loadAnySession(configuration = configuration)
        if (storedCredentials != null && storedGuestSession != null) {
            resetCoordinator.resetLocalStateForCloudIdentityChange()
            return CloudIdentityReconciliationResult(
                cloudSettings = preferencesStore.currentCloudSettings(),
                restoredGuestSession = null,
                guestRestoreRequiresSync = false,
                didRunSync = false
            )
        }

        val reconciledCloudSettings = preferencesStore.currentCloudSettings()
        return when (reconciledCloudSettings.cloudState) {
            CloudAccountState.LINKED -> {
                if (storedCredentials == null) {
                    resetCoordinator.resetLocalStateForCloudIdentityChange()
                    CloudIdentityReconciliationResult(
                        cloudSettings = preferencesStore.currentCloudSettings(),
                        restoredGuestSession = null,
                        guestRestoreRequiresSync = false,
                        didRunSync = false
                    )
                } else {
                    CloudIdentityReconciliationResult(
                        cloudSettings = reconciledCloudSettings,
                        restoredGuestSession = null,
                        guestRestoreRequiresSync = false,
                        didRunSync = false
                    )
                }
            }

            CloudAccountState.GUEST -> {
                if (storedGuestSession == null) {
                    resetCoordinator.resetLocalStateForCloudIdentityChange()
                    CloudIdentityReconciliationResult(
                        cloudSettings = preferencesStore.currentCloudSettings(),
                        restoredGuestSession = null,
                        guestRestoreRequiresSync = false,
                        didRunSync = false
                    )
                } else {
                    val shouldSync = finishGuestCloudLinkNonCancellableLocked(
                        session = storedGuestSession,
                        workspaceId = storedGuestSession.workspaceId
                    )
                    CloudIdentityReconciliationResult(
                        cloudSettings = preferencesStore.currentCloudSettings(),
                        restoredGuestSession = storedGuestSession,
                        guestRestoreRequiresSync = shouldSync,
                        didRunSync = false
                    )
                }
            }

            CloudAccountState.DISCONNECTED -> {
                if (storedGuestSession != null) {
                    val shouldSync = finishGuestCloudLinkNonCancellableLocked(
                        session = storedGuestSession,
                        workspaceId = storedGuestSession.workspaceId
                    )
                    CloudIdentityReconciliationResult(
                        cloudSettings = preferencesStore.currentCloudSettings(),
                        restoredGuestSession = storedGuestSession,
                        guestRestoreRequiresSync = shouldSync,
                        didRunSync = false
                    )
                } else if (
                    storedCredentials != null &&
                    isAuthenticatedSilentRestoreEligible(
                        cloudSettings = reconciledCloudSettings,
                        configuration = configuration
                    )
                ) {
                    restoreAuthenticatedCloudSessionAfterReinstallLocked(
                        storedCredentials = storedCredentials,
                        configuration = configuration
                    )
                    CloudIdentityReconciliationResult(
                        cloudSettings = preferencesStore.currentCloudSettings(),
                        restoredGuestSession = null,
                        guestRestoreRequiresSync = false,
                        didRunSync = true
                    )
                } else {
                    CloudIdentityReconciliationResult(
                        cloudSettings = reconciledCloudSettings,
                        restoredGuestSession = null,
                        guestRestoreRequiresSync = false,
                        didRunSync = false
                    )
                }
            }

            CloudAccountState.LINKING_READY -> {
                error("Legacy linking-ready cloud state must be normalized before reconciliation.")
            }
        }
    }

    private suspend fun restoreGuestCloudSessionIfNeededLocked(
        workspaceId: String?,
        createSessionIfMissing: Boolean
    ): GuestCloudSessionRestoreResult {
        val reconciliation = reconcilePersistedCloudStateLocked()
        if (reconciliation.cloudSettings.cloudState == CloudAccountState.GUEST) {
            val session = requireNotNull(reconciliation.restoredGuestSession) {
                "Guest cloud state is missing a stored guest session."
            }
            return GuestCloudSessionRestoreResult(
                session = session,
                shouldSync = reconciliation.guestRestoreRequiresSync
            )
        }

        val configuration = preferencesStore.currentServerConfiguration()
        val existingSession = loadGuestSessionForCurrentConfiguration(
            workspaceId = workspaceId,
            configurationApiBaseUrl = configuration.apiBaseUrl
        )
        val resolvedSession = if (existingSession != null) {
            existingSession
        } else {
            require(createSessionIfMissing) {
                "Guest AI session is unavailable."
            }
            // A missing stored session here means we already crossed a full
            // local identity reset boundary such as logout or account deletion.
            // The recreated guest session must therefore be treated as a brand
            // new guest identity, not as a continuation of any older guest
            // account that may have been linked previously.
            aiChatRemoteService.createGuestSession(
                apiBaseUrl = configuration.apiBaseUrl,
                configurationMode = configuration.mode
            )
        }
        return GuestCloudSessionRestoreResult(
            session = resolvedSession,
            shouldSync = finishGuestCloudLinkNonCancellableLocked(
                session = resolvedSession,
                workspaceId = workspaceId
            )
        )
    }

    private suspend fun finishGuestCloudLinkNonCancellableLocked(
        session: StoredGuestAiSession,
        workspaceId: String?
    ): Boolean {
        return withContext(NonCancellable) {
            finishGuestCloudLinkIfNeededLocked(
                session = session,
                workspaceId = workspaceId
            )
        }
    }

    private fun loadGuestSessionForCurrentConfiguration(
        workspaceId: String?,
        configurationApiBaseUrl: String
    ): StoredGuestAiSession? {
        val configuration = preferencesStore.currentServerConfiguration()
        require(configuration.apiBaseUrl == configurationApiBaseUrl) {
            "Guest session configuration mismatch. expected='${configuration.apiBaseUrl}' actual='$configurationApiBaseUrl'"
        }
        if (workspaceId.isNullOrBlank()) {
            return guestSessionStore.loadAnySession(configuration = configuration)
        }

        return guestSessionStore.loadSession(
            localWorkspaceId = workspaceId,
            configuration = configuration
        )
    }

    private suspend fun finishGuestCloudLinkIfNeededLocked(
        session: StoredGuestAiSession,
        workspaceId: String?
    ): Boolean {
        val currentCloudSettings = preferencesStore.currentCloudSettings()
        val currentWorkspace = loadCurrentWorkspaceForRestoreOrNull(workspaceId = workspaceId)
        val isAlreadyGuestLinked = currentCloudSettings.cloudState == CloudAccountState.GUEST &&
            currentWorkspace?.workspaceId == session.workspaceId &&
            currentCloudSettings.linkedUserId == session.userId &&
            currentCloudSettings.linkedWorkspaceId == session.workspaceId &&
            currentCloudSettings.activeWorkspaceId == session.workspaceId
        if (isAlreadyGuestLinked) {
            guestSessionStore.saveSession(localWorkspaceId = session.workspaceId, session = session)
            markGuestCloudState(session = session)
            return false
        }

        val bootstrapProbe = runGuestBootstrapPull(
            session = session,
            installationId = currentCloudSettings.installationId
        )
        val workspaceSummary = guestWorkspaceSummary(
            currentWorkspaceId = currentWorkspace?.workspaceId,
            currentWorkspaceName = currentWorkspace?.name,
            currentWorkspaceCreatedAtMillis = currentWorkspace?.createdAtMillis,
            session = session
        )
        val resultingWorkspace = syncLocalStore.migrateLocalShellToLinkedWorkspace(
            workspace = workspaceSummary,
            remoteWorkspaceIsEmpty = bootstrapProbe.remoteIsEmpty
        )
        require(resultingWorkspace.workspaceId == session.workspaceId) {
            "Guest workspace restore produced an unexpected local workspace. " +
                "Expected='${session.workspaceId}' Actual='${resultingWorkspace.workspaceId}'."
        }
        if (currentWorkspace?.workspaceId != null && currentWorkspace.workspaceId != session.workspaceId) {
            guestSessionStore.clearSession(localWorkspaceId = currentWorkspace.workspaceId)
        }
        guestSessionStore.saveSession(localWorkspaceId = session.workspaceId, session = session)
        markGuestCloudState(session = session)
        return bootstrapProbe.remoteIsEmpty.not()
    }

    private suspend fun isAuthenticatedSilentRestoreEligible(
        cloudSettings: CloudSettings,
        configuration: CloudServiceConfiguration
    ): Boolean {
        if (configuration.mode != CloudServiceConfigurationMode.OFFICIAL) {
            return false
        }
        if (
            cloudSettings.cloudState != CloudAccountState.DISCONNECTED
        ) {
            return false
        }
        return isSafeForAuthenticatedSilentRestore()
    }

    private suspend fun isSafeForAuthenticatedSilentRestore(): Boolean {
        val workspaceCount = database.workspaceDao().countWorkspaces()
        if (workspaceCount != 1) {
            return false
        }
        if (database.cardDao().countActiveCards() != 0) {
            return false
        }
        if (database.deckDao().countDecks() != 0) {
            return false
        }
        if (database.reviewLogDao().countReviewLogs() != 0) {
            return false
        }
        return database.outboxDao().countOutboxEntries() == 0
    }

    private suspend fun restoreAuthenticatedCloudSessionAfterReinstallLocked(
        storedCredentials: StoredCloudCredentials,
        configuration: CloudServiceConfiguration
    ) {
        val initialCredentials = refreshStoredCredentialsIfNeeded(
            storedCredentials = storedCredentials,
            configuration = configuration,
            forceRefresh = false
        )
        try {
            performAuthenticatedSilentRestoreLocked(
                credentials = initialCredentials,
                configuration = configuration
            )
            return
        } catch (error: Exception) {
            if (isCloudAuthorizationError(error).not()) {
                throw error
            }
        }

        val refreshedCredentials = refreshStoredCredentialsIfNeeded(
            storedCredentials = storedCredentials,
            configuration = configuration,
            forceRefresh = true
        )
        performAuthenticatedSilentRestoreLocked(
            credentials = refreshedCredentials,
            configuration = configuration
        )
    }

    private suspend fun performAuthenticatedSilentRestoreLocked(
        credentials: StoredCloudCredentials,
        configuration: CloudServiceConfiguration
    ) {
        val accountSnapshot = remoteService.fetchCloudAccount(
            apiBaseUrl = configuration.apiBaseUrl,
            bearerToken = credentials.idToken
        )
        val selectedWorkspace = selectedWorkspaceForAuthenticatedSilentRestore(accountSnapshot)
        applyLinkedWorkspaceAndSyncLocked(
            accountSnapshot = accountSnapshot,
            credentials = credentials,
            configuration = configuration,
            selectedWorkspace = selectedWorkspace
        )
    }

    private fun selectedWorkspaceForAuthenticatedSilentRestore(
        accountSnapshot: CloudAccountSnapshot
    ): CloudWorkspaceSummary {
        return requireNotNull(accountSnapshot.workspaces.firstOrNull(CloudWorkspaceSummary::isSelected)) {
            "Authenticated cloud account is missing a selected workspace."
        }
    }

    private suspend fun refreshStoredCredentialsIfNeeded(
        storedCredentials: StoredCloudCredentials,
        configuration: CloudServiceConfiguration,
        forceRefresh: Boolean
    ): StoredCloudCredentials {
        if (
            forceRefresh.not() &&
            shouldRefreshCloudIdToken(
                idTokenExpiresAtMillis = storedCredentials.idTokenExpiresAtMillis,
                nowMillis = System.currentTimeMillis()
            ).not()
        ) {
            return storedCredentials
        }

        val refreshedCredentials = remoteService.refreshIdToken(
            refreshToken = storedCredentials.refreshToken,
            authBaseUrl = configuration.authBaseUrl
        )
        preferencesStore.saveCredentials(refreshedCredentials)
        return refreshedCredentials
    }

    private suspend fun applyLinkedWorkspaceAndSyncLocked(
        accountSnapshot: CloudAccountSnapshot,
        credentials: StoredCloudCredentials,
        configuration: CloudServiceConfiguration,
        selectedWorkspace: CloudWorkspaceSummary
    ) {
        val bootstrapProbe = remoteService.bootstrapPull(
            apiBaseUrl = configuration.apiBaseUrl,
            authorizationHeader = "Bearer ${credentials.idToken}",
            workspaceId = selectedWorkspace.workspaceId,
            body = org.json.JSONObject()
                .put("mode", "pull")
                .put("installationId", preferencesStore.currentCloudSettings().installationId)
                .put("platform", "android")
                .put("appVersion", "1.0.0")
                .put("cursor", org.json.JSONObject.NULL)
                .put("limit", 1)
        )
        val localLinkedWorkspace = syncLocalStore.migrateLocalShellToLinkedWorkspace(
            workspace = selectedWorkspace,
            remoteWorkspaceIsEmpty = bootstrapProbe.remoteIsEmpty
        )
        require(localLinkedWorkspace.workspaceId == selectedWorkspace.workspaceId) {
            "Authenticated silent restore produced an unexpected local workspace. " +
                "Expected='${selectedWorkspace.workspaceId}' Actual='${localLinkedWorkspace.workspaceId}'."
        }
        preferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.LINKED,
            linkedUserId = accountSnapshot.userId,
            linkedWorkspaceId = selectedWorkspace.workspaceId,
            linkedEmail = accountSnapshot.email,
            activeWorkspaceId = selectedWorkspace.workspaceId
        )
        runCloudSyncCore(
            cloudSettings = preferencesStore.currentCloudSettings(),
            workspaceId = selectedWorkspace.workspaceId,
            syncSession = CloudSyncSession(
                apiBaseUrl = configuration.apiBaseUrl,
                authorizationHeader = "Bearer ${credentials.idToken}"
            ),
            remoteService = remoteService,
            syncLocalStore = syncLocalStore
        )
    }

    private fun isCloudAuthorizationError(error: Exception): Boolean {
        return error is CloudRemoteException &&
            (error.statusCode == 401 || error.statusCode == 403)
    }

    private suspend fun loadCurrentWorkspaceForRestoreOrNull(workspaceId: String?): WorkspaceEntity? {
        if (workspaceId.isNullOrBlank()) {
            return loadCurrentWorkspaceOrNull(
                database = database,
                preferencesStore = preferencesStore
            )
        }

        val workspaces = database.workspaceDao().loadWorkspaces()
        if (workspaces.isEmpty()) {
            return null
        }
        return workspaces.firstOrNull { workspace ->
            workspace.workspaceId == workspaceId
        }
    }

    private suspend fun runGuestBootstrapPull(
        session: StoredGuestAiSession,
        installationId: String
    ): RemoteBootstrapPullResponse {
        return remoteService.bootstrapPull(
            apiBaseUrl = session.apiBaseUrl,
            authorizationHeader = "Guest ${session.guestToken}",
            workspaceId = session.workspaceId,
            body = org.json.JSONObject()
                .put("mode", "pull")
                .put("installationId", installationId)
                .put("platform", "android")
                .put("appVersion", "1.0.0")
                .put("cursor", org.json.JSONObject.NULL)
                .put("limit", 1)
        )
    }

    private fun guestWorkspaceSummary(
        currentWorkspaceId: String?,
        currentWorkspaceName: String?,
        currentWorkspaceCreatedAtMillis: Long?,
        session: StoredGuestAiSession
    ): CloudWorkspaceSummary {
        val workspaceName = if (currentWorkspaceId == session.workspaceId) {
            currentWorkspaceName ?: "Personal"
        } else {
            currentWorkspaceName ?: "Personal"
        }
        val createdAtMillis = if (currentWorkspaceId == session.workspaceId) {
            currentWorkspaceCreatedAtMillis ?: System.currentTimeMillis()
        } else {
            currentWorkspaceCreatedAtMillis ?: System.currentTimeMillis()
        }
        return CloudWorkspaceSummary(
            workspaceId = session.workspaceId,
            name = workspaceName,
            createdAtMillis = createdAtMillis,
            isSelected = true
        )
    }

    private suspend fun markGuestCloudState(session: StoredGuestAiSession) {
        val currentCloudState = preferencesStore.currentCloudSettings().cloudState
        if (
            currentCloudState == CloudAccountState.LINKED ||
            currentCloudState == CloudAccountState.LINKING_READY
        ) {
            return
        }

        preferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.GUEST,
            linkedUserId = session.userId,
            linkedWorkspaceId = session.workspaceId,
            linkedEmail = null,
            activeWorkspaceId = session.workspaceId
        )
    }

    private suspend fun hasInvalidActiveWorkspaceId(cloudSettings: CloudSettings): Boolean {
        val activeWorkspaceId = cloudSettings.activeWorkspaceId ?: return false
        return database.workspaceDao().loadWorkspaceById(activeWorkspaceId) == null
    }

    private suspend fun normalizeLegacyLinkingReadyStateLocked(cloudSettings: CloudSettings) {
        preferencesStore.clearCredentials()
        preferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.DISCONNECTED,
            linkedUserId = null,
            linkedWorkspaceId = null,
            linkedEmail = null,
            activeWorkspaceId = cloudSettings.activeWorkspaceId
        )
    }
}
