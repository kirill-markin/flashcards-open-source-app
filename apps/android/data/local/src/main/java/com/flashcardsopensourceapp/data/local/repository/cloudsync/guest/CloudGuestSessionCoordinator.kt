package com.flashcardsopensourceapp.data.local.repository.cloudsync.guest

import com.flashcardsopensourceapp.data.local.ai.remote.GuestCloudSessionCreator
import com.flashcardsopensourceapp.data.local.ai.store.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.bootstrap.ensureLocalWorkspaceShell
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.cloud.remote.sync.RemoteBootstrapPullResponse
import com.flashcardsopensourceapp.data.local.cloud.sync.SyncLocalStore
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.database.entities.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.model.ai.StoredGuestAiSession
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryReason
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryRequiredException
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.network.isLikelyTransientNetworkIoException
import com.flashcardsopensourceapp.data.local.network.isRetryableHttpStatusCode
import com.flashcardsopensourceapp.data.local.repository.cloudsync.account.CloudIdentityResetCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudOperationCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.sync.androidClientPlatform
import com.flashcardsopensourceapp.data.local.repository.cloudsync.workspace.loadCurrentWorkspaceOrNull
import java.io.IOException
import kotlinx.coroutines.CancellationException
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

data class EnsuredGuestCloudSession(
    val workspaceId: String
)

private typealias GuestCloudLinkFinisher = suspend (StoredGuestAiSession, String?) -> Boolean
private typealias GuestBootstrapProbeLoader = suspend (StoredGuestAiSession, String) -> RemoteBootstrapPullResponse

class CloudGuestSessionCoordinator(
    private val database: AppDatabase,
    private val preferencesStore: CloudPreferencesStore,
    private val remoteService: CloudRemoteGateway,
    private val syncLocalStore: SyncLocalStore,
    private val operationCoordinator: CloudOperationCoordinator,
    private val resetCoordinator: CloudIdentityResetCoordinator,
    private val guestSessionStore: GuestAiSessionStore,
    private val guestSessionCreator: GuestCloudSessionCreator,
    private val appVersion: String
) {
    suspend fun reconcilePersistedCloudStateForStartup() {
        operationCoordinator.runExclusive {
            reconcilePersistedCloudStateLocked(
                finishGuestCloudLink = ::finishGuestCloudLinkForStartupNonCancellableLocked
            )
        }
    }

    suspend fun ensureGuestCloudSession(workspaceId: String): EnsuredGuestCloudSession {
        val restoredSession = restoreGuestCloudSessionIfNeeded(
            workspaceId = workspaceId,
            createSessionIfMissing = true
        )
        return EnsuredGuestCloudSession(
            workspaceId = restoredSession.session.workspaceId
        )
    }

    suspend fun deleteStoredGuestCloudSessionIfPresent() {
        operationCoordinator.runExclusive {
            deleteStoredGuestCloudSessionIfPresentLocked()
        }
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
        return reconcilePersistedCloudStateLocked(
            finishGuestCloudLink = ::finishGuestCloudLinkNonCancellableLocked
        )
    }

    private suspend fun reconcilePersistedCloudStateLocked(
        finishGuestCloudLink: GuestCloudLinkFinisher
    ): CloudIdentityReconciliationResult {
        val activeRecoveryState = preferencesStore.loadCloudCredentialRecoveryState()
        if (activeRecoveryState == null || activeRecoveryState.isPendingGuestUpgradeRecovery()) {
            val recoveredGuestUpgrade: CloudWorkspaceSummary? = resumePendingGuestUpgradeRecoveryIfNeeded(
                database = database,
                preferencesStore = preferencesStore,
                remoteService = remoteService,
                syncLocalStore = syncLocalStore,
                guestSessionStore = guestSessionStore,
                appVersion = appVersion
            )
            if (recoveredGuestUpgrade != null) {
                return CloudIdentityReconciliationResult(
                    cloudSettings = preferencesStore.currentCloudSettings(),
                    restoredGuestSession = null,
                    guestRestoreRequiresSync = false,
                    didRunSync = false
                )
            }
        }

        activeCredentialRecoveryReconciliationResultOrNull(recoveryState = activeRecoveryState)?.let { result ->
            return result
        }

        var currentCloudSettings = preferencesStore.currentCloudSettings()
        if (hasInvalidActiveWorkspaceId(cloudSettings = currentCloudSettings)) {
            normalizeActiveWorkspaceIdToLocalShell()
            currentCloudSettings = preferencesStore.currentCloudSettings()
        }

        if (currentCloudSettings.cloudState == CloudAccountState.LINKING_READY) {
            normalizeLegacyLinkingReadyStateLocked(cloudSettings = currentCloudSettings)
        }

        val configuration = preferencesStore.currentServerConfiguration()
        val storedCredentials = preferencesStore.loadCredentials()
        val storedGuestSession = guestSessionStore.loadAnySession(configuration = configuration)
        if (storedCredentials != null && storedGuestSession != null) {
            guestSessionStore.clearAllSessions()
            resetCoordinator.disconnectCloudIdentityPreservingLocalState()
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
                    markCloudCredentialRecoveryRequired(
                        reason = CloudCredentialRecoveryReason.LINKED_CREDENTIALS_MISSING,
                        cloudSettings = reconciledCloudSettings
                    )
                    resetCoordinator.disconnectCloudIdentityPreservingLocalState()
                    CloudIdentityReconciliationResult(
                        cloudSettings = preferencesStore.currentCloudSettings(),
                        restoredGuestSession = null,
                        guestRestoreRequiresSync = false,
                        didRunSync = false
                    )
                } else {
                    preferencesStore.clearCloudCredentialRecoveryState()
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
                    markCloudCredentialRecoveryRequired(
                        reason = CloudCredentialRecoveryReason.GUEST_SESSION_MISSING,
                        cloudSettings = reconciledCloudSettings
                    )
                    resetCoordinator.disconnectCloudIdentityPreservingLocalState()
                    CloudIdentityReconciliationResult(
                        cloudSettings = preferencesStore.currentCloudSettings(),
                        restoredGuestSession = null,
                        guestRestoreRequiresSync = false,
                        didRunSync = false
                    )
                } else {
                    val shouldSync = finishGuestCloudLink(storedGuestSession, storedGuestSession.workspaceId)
                    preferencesStore.clearCloudCredentialRecoveryState()
                    CloudIdentityReconciliationResult(
                        cloudSettings = preferencesStore.currentCloudSettings(),
                        restoredGuestSession = storedGuestSession,
                        guestRestoreRequiresSync = shouldSync,
                        didRunSync = false
                    )
                }
            }

            CloudAccountState.DISCONNECTED -> {
                CloudIdentityReconciliationResult(
                    cloudSettings = reconciledCloudSettings,
                    restoredGuestSession = null,
                    guestRestoreRequiresSync = false,
                    didRunSync = false
                )
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
        val activeRecoveryState = preferencesStore.loadCloudCredentialRecoveryState()
        if (activeRecoveryState != null) {
            throw CloudCredentialRecoveryRequiredException(recoveryState = activeRecoveryState)
        }

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
            guestSessionCreator.createGuestSession(
                apiBaseUrl = configuration.apiBaseUrl,
                configurationMode = configuration.mode
            )
        }
        val shouldSync = finishGuestCloudLinkNonCancellableLocked(
            session = resolvedSession,
            workspaceId = workspaceId
        )
        preferencesStore.clearCloudCredentialRecoveryState()
        return GuestCloudSessionRestoreResult(
            session = resolvedSession,
            shouldSync = shouldSync
        )
    }

    private fun activeCredentialRecoveryReconciliationResultOrNull(
        recoveryState: CloudCredentialRecoveryState?
    ): CloudIdentityReconciliationResult? {
        if (recoveryState == null) {
            return null
        }
        preferencesStore.loadPendingGuestUpgrade()
        return CloudIdentityReconciliationResult(
            cloudSettings = preferencesStore.currentCloudSettings(),
            restoredGuestSession = null,
            guestRestoreRequiresSync = false,
            didRunSync = false
        )
    }

    private fun CloudCredentialRecoveryState.isPendingGuestUpgradeRecovery(): Boolean {
        return reason == CloudCredentialRecoveryReason.LINKED_CREDENTIALS_MISSING &&
            previousCloudState == CloudAccountState.GUEST
    }

    private fun markCloudCredentialRecoveryRequired(
        reason: CloudCredentialRecoveryReason,
        cloudSettings: CloudSettings
    ) {
        val configuration = preferencesStore.currentServerConfiguration()
        preferencesStore.saveCloudCredentialRecoveryState(
            recoveryState = CloudCredentialRecoveryState(
                reason = reason,
                previousCloudState = cloudSettings.cloudState,
                installationId = cloudSettings.installationId,
                linkedUserId = cloudSettings.linkedUserId,
                linkedWorkspaceId = cloudSettings.linkedWorkspaceId,
                activeWorkspaceId = cloudSettings.activeWorkspaceId,
                linkedEmail = cloudSettings.linkedEmail,
                configurationMode = configuration.mode,
                apiBaseUrl = configuration.apiBaseUrl,
                detectedAtMillis = System.currentTimeMillis()
            )
        )
    }

    private suspend fun deleteStoredGuestCloudSessionIfPresentLocked() {
        val configuration = preferencesStore.currentServerConfiguration()
        val storedGuestSession = guestSessionStore.loadAnySession(configuration = configuration)
            ?: return

        try {
            remoteService.deleteGuestSession(
                apiBaseUrl = storedGuestSession.apiBaseUrl,
                guestToken = storedGuestSession.guestToken
            )
        } catch (error: Exception) {
            if (isGuestSessionInvalidError(error = error).not()) {
                throw error
            }
        }

        clearStoredGuestCloudSessionLocalState(session = storedGuestSession)
    }

    private suspend fun finishGuestCloudLinkNonCancellableLocked(
        session: StoredGuestAiSession,
        workspaceId: String?
    ): Boolean {
        return withContext(NonCancellable) {
            finishGuestCloudLinkIfNeededLocked(
                session = session,
                workspaceId = workspaceId,
                bootstrapProbeLoader = ::loadRequiredGuestBootstrapProbe
            )
        }
    }

    private suspend fun finishGuestCloudLinkForStartupNonCancellableLocked(
        session: StoredGuestAiSession,
        workspaceId: String?
    ): Boolean {
        return withContext(NonCancellable) {
            finishGuestCloudLinkIfNeededLocked(
                session = session,
                workspaceId = workspaceId,
                bootstrapProbeLoader = ::loadStartupGuestBootstrapProbe
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
        workspaceId: String?,
        bootstrapProbeLoader: GuestBootstrapProbeLoader
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

        val bootstrapProbe: RemoteBootstrapPullResponse = bootstrapProbeLoader(
            session,
            currentCloudSettings.installationId
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

    private fun isCloudAuthorizationError(error: Exception): Boolean {
        return error is CloudRemoteException &&
            (error.statusCode == 401 || error.statusCode == 403)
    }

    private fun isGuestSessionInvalidError(error: Exception): Boolean {
        return error is CloudRemoteException &&
            error.statusCode == 401 &&
            error.errorCode == "GUEST_AUTH_INVALID"
    }

    private suspend fun clearStoredGuestCloudSessionLocalState(session: StoredGuestAiSession) {
        guestSessionStore.clearSession(localWorkspaceId = null)
        guestSessionStore.clearSession(localWorkspaceId = session.workspaceId)

        val currentCloudSettings = preferencesStore.currentCloudSettings()
        val shouldDisconnectDeletedGuestState = currentCloudSettings.cloudState == CloudAccountState.GUEST &&
            (
                currentCloudSettings.linkedUserId == session.userId ||
                    currentCloudSettings.linkedWorkspaceId == session.workspaceId ||
                    currentCloudSettings.activeWorkspaceId == session.workspaceId
                )
        if (shouldDisconnectDeletedGuestState) {
            resetCoordinator.disconnectCloudIdentityPreservingLocalState()
        }
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
                .put("platform", androidClientPlatform)
                .put("appVersion", appVersion)
                .put("cursor", org.json.JSONObject.NULL)
                .put("limit", 1)
        )
    }

    private suspend fun loadRequiredGuestBootstrapProbe(
        session: StoredGuestAiSession,
        installationId: String
    ): RemoteBootstrapPullResponse {
        return runGuestBootstrapPull(
            session = session,
            installationId = installationId
        )
    }

    private suspend fun loadStartupGuestBootstrapProbe(
        session: StoredGuestAiSession,
        installationId: String
    ): RemoteBootstrapPullResponse {
        return try {
            loadRequiredGuestBootstrapProbe(
                session = session,
                installationId = installationId
            )
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            if (isRetryableStartupCloudReconciliationFailure(error = error).not()) {
                throw error
            }
            markStartupCloudReconciliationFailure(error = error)
            throw IllegalStateException(
                startupCloudReconciliationFailureMessage(error = error),
                error
            )
        }
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

    private suspend fun normalizeActiveWorkspaceIdToLocalShell() {
        val fallbackWorkspaceId = database.workspaceDao().loadAnyWorkspace()?.workspaceId
        val resolvedWorkspaceId = if (fallbackWorkspaceId != null) {
            fallbackWorkspaceId
        } else {
            ensureLocalWorkspaceShell(
                database = database,
                currentTimeMillis = System.currentTimeMillis()
            )
        }
        preferencesStore.updateActiveWorkspaceId(activeWorkspaceId = resolvedWorkspaceId)
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

    private fun isRetryableStartupCloudReconciliationFailure(error: Exception): Boolean {
        val cloudRemoteError: CloudRemoteException? = error as? CloudRemoteException
            ?: findCloudRemoteCause(error = error)
        if (cloudRemoteError != null) {
            return isRetryableHttpStatusCode(statusCode = cloudRemoteError.statusCode)
        }
        val ioError: IOException? = error as? IOException ?: findIoCause(error = error)
        return ioError != null && isLikelyTransientNetworkIoException(error = ioError)
    }

    private fun findCloudRemoteCause(error: Throwable): CloudRemoteException? {
        var currentCause: Throwable? = error.cause
        while (currentCause != null) {
            if (currentCause is CloudRemoteException) {
                return currentCause
            }
            currentCause = currentCause.cause
        }
        return null
    }

    private fun findIoCause(error: Throwable): IOException? {
        var currentCause: Throwable? = error.cause
        while (currentCause != null) {
            if (currentCause is IOException) {
                return currentCause
            }
            currentCause = currentCause.cause
        }
        return null
    }

    private suspend fun markStartupCloudReconciliationFailure(error: Exception) {
        val cloudSettings: CloudSettings = preferencesStore.currentCloudSettings()
        val workspaceId: String = localWorkspaceIdForSyncFailure(cloudSettings = cloudSettings) ?: return
        syncLocalStore.markSyncFailure(
            workspaceId = workspaceId,
            errorMessage = startupCloudReconciliationFailureMessage(error = error)
        )
    }

    private suspend fun localWorkspaceIdForSyncFailure(cloudSettings: CloudSettings): String? {
        val candidateWorkspaceIds: List<String> = listOfNotNull(
            cloudSettings.activeWorkspaceId,
            cloudSettings.linkedWorkspaceId
        ).distinct()
        return candidateWorkspaceIds.firstOrNull { workspaceId ->
            database.workspaceDao().loadWorkspaceById(workspaceId = workspaceId) != null
        }
    }

    private fun startupCloudReconciliationFailureMessage(error: Exception): String {
        val retryableCause: Throwable = findIoCause(error = error)
            ?: findCloudRemoteCause(error = error)
            ?: error
        val causeMessage: String = retryableCause.message?.trim()?.takeIf { message -> message.isNotEmpty() }
            ?: retryableCause::class.java.simpleName
        return "Startup cloud reconciliation could not finish because cloud sync is temporarily unavailable. " +
            "Check your connection and reopen the app. Cause=$causeMessage"
    }
}
