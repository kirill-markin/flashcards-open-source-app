package com.flashcardsopensourceapp.data.local.repository.cloudsync.account

import com.flashcardsopensourceapp.data.local.ai.store.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.cloud.sync.SyncLocalStore
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.model.ai.StoredGuestAiSession
import com.flashcardsopensourceapp.data.local.model.cloud.AccountDeletionState
import com.flashcardsopensourceapp.data.local.model.cloud.AgentApiKeyConnectionsResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCommunityProfile
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudFriendInvitationCreateRequest
import com.flashcardsopensourceapp.data.local.model.cloud.CloudFriendInvitationCreateResponse
import com.flashcardsopensourceapp.data.local.model.cloud.CloudOtpChallenge
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSendCodeResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceDeletePreview
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceDeleteResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkContext
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceResetProgressPreview
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceResetProgressResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.cloud.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.cloud.shouldRefreshCloudIdToken
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboard
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardProfile
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressReviewSchedule
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakLeaderboard
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.sync.AccountPreferences
import com.flashcardsopensourceapp.data.local.model.sync.CloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.loadActiveGuestSessionOrNull
import com.flashcardsopensourceapp.data.local.repository.cloudsync.progress.CloudProgressRemoteReader
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudOperationCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudSessionProvider
import com.flashcardsopensourceapp.data.local.repository.cloudsync.workspace.CloudLinkedWorkspaceTransitionCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.workspace.CloudWorkspaceLinkCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.workspace.CloudWorkspaceOperationsCoordinator
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow

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
    private val sessionProvider: CloudSessionProvider = CloudSessionProvider(
        preferencesStore = preferencesStore,
        remoteService = remoteService,
        operationCoordinator = operationCoordinator,
        resetCoordinator = resetCoordinator
    )
    private val transitionCoordinator: CloudLinkedWorkspaceTransitionCoordinator =
        CloudLinkedWorkspaceTransitionCoordinator(
            database = database,
            preferencesStore = preferencesStore,
            remoteService = remoteService,
            syncLocalStore = syncLocalStore,
            operationCoordinator = operationCoordinator,
            appVersion = appVersion
        )
    private val signInCoordinator: CloudSignInCoordinator = CloudSignInCoordinator(
        database = database,
        preferencesStore = preferencesStore,
        remoteService = remoteService,
        syncLocalStore = syncLocalStore,
        operationCoordinator = operationCoordinator,
        guestSessionStore = guestSessionStore,
        sessionProvider = sessionProvider,
        appVersion = appVersion
    )
    private val workspaceLinkCoordinator: CloudWorkspaceLinkCoordinator = CloudWorkspaceLinkCoordinator(
        database = database,
        preferencesStore = preferencesStore,
        remoteService = remoteService,
        syncLocalStore = syncLocalStore,
        operationCoordinator = operationCoordinator,
        resetCoordinator = resetCoordinator,
        guestSessionStore = guestSessionStore,
        sessionProvider = sessionProvider,
        transitionCoordinator = transitionCoordinator,
        appVersion = appVersion
    )
    private val workspaceOperationsCoordinator: CloudWorkspaceOperationsCoordinator =
        CloudWorkspaceOperationsCoordinator(
            database = database,
            preferencesStore = preferencesStore,
            remoteService = remoteService,
            syncLocalStore = syncLocalStore,
            operationCoordinator = operationCoordinator,
            sessionProvider = sessionProvider,
            transitionCoordinator = transitionCoordinator,
            appVersion = appVersion
        )
    private val accountDeletionCoordinator: CloudAccountDeletionCoordinator = CloudAccountDeletionCoordinator(
        database = database,
        preferencesStore = preferencesStore,
        remoteService = remoteService,
        syncLocalStore = syncLocalStore,
        operationCoordinator = operationCoordinator,
        resetCoordinator = resetCoordinator,
        guestSessionStore = guestSessionStore,
        sessionProvider = sessionProvider,
        appVersion = appVersion
    )
    private val progressRemoteReader: CloudProgressRemoteReader = CloudProgressRemoteReader(
        preferencesStore = preferencesStore,
        remoteService = remoteService,
        operationCoordinator = operationCoordinator,
        guestSessionStore = guestSessionStore,
        sessionProvider = sessionProvider
    )
    private val agentConnectionsReader: CloudAgentConnectionsReader = CloudAgentConnectionsReader(
        preferencesStore = preferencesStore,
        remoteService = remoteService,
        sessionProvider = sessionProvider
    )
    private val serverConfigurationCoordinator: CloudServerConfigurationCoordinator =
        CloudServerConfigurationCoordinator(
            preferencesStore = preferencesStore,
            remoteService = remoteService,
            operationCoordinator = operationCoordinator,
            resetCoordinator = resetCoordinator
        )

    override fun observeCloudSettings(): Flow<CloudSettings> {
        return preferencesStore.observeCloudSettings()
    }

    override fun observeAccountPreferences(): Flow<AccountPreferences> {
        return preferencesStore.observeAccountPreferences()
    }

    override fun observeAccountDeletionState(): Flow<AccountDeletionState> {
        return preferencesStore.observeAccountDeletionState()
    }

    override fun observeServerConfiguration(): Flow<CloudServiceConfiguration> {
        return preferencesStore.observeServerConfiguration()
    }

    override fun observeCloudCredentialRecoveryState(): Flow<CloudCredentialRecoveryState?> {
        return preferencesStore.observeCloudCredentialRecoveryState()
    }

    override suspend fun eraseLocalDataForCredentialRecovery() {
        operationCoordinator.runExclusive {
            require(preferencesStore.loadCloudCredentialRecoveryState() != null) {
                "Local credential recovery erase requires an active recovery state."
            }
            resetCoordinator.eraseLocalDataForCredentialRecovery()
        }
    }

    override suspend fun beginAccountDeletion() {
        accountDeletionCoordinator.beginAccountDeletion()
    }

    override suspend fun resumePendingAccountDeletionIfNeeded() {
        accountDeletionCoordinator.resumePendingAccountDeletionIfNeeded()
    }

    override suspend fun retryPendingAccountDeletion() {
        accountDeletionCoordinator.retryPendingAccountDeletion()
    }

    override suspend fun refreshAccountContext() {
        operationCoordinator.runExclusive {
            refreshAccountContextLocked()
        }
    }

    override suspend fun updateAccountPreferences(preferences: AccountPreferences): AccountPreferences {
        return operationCoordinator.runExclusive {
            val previousPreferences = preferencesStore.currentAccountPreferences()
            preferencesStore.saveAccountPreferences(preferences = preferences)

            try {
                val session = requireNotNull(resolveAccountContextSessionLocked()) {
                    "Account preferences require an active linked or guest cloud account."
                }
                val updatedPreferences = remoteService.updateAccountPreferences(
                    apiBaseUrl = session.apiBaseUrl,
                    authorizationHeader = session.authorizationHeader,
                    preferences = preferences
                )
                preferencesStore.saveAccountPreferences(preferences = updatedPreferences)
                updatedPreferences
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                preferencesStore.saveAccountPreferences(preferences = previousPreferences)
                throw error
            }
        }
    }

    override suspend fun sendCode(email: String): CloudSendCodeResult {
        return signInCoordinator.sendCode(email = email)
    }

    override suspend fun prepareVerifiedSignIn(credentials: StoredCloudCredentials): CloudWorkspaceLinkContext {
        return signInCoordinator.prepareVerifiedSignIn(credentials = credentials)
    }

    override suspend fun verifyCode(challenge: CloudOtpChallenge, code: String): CloudWorkspaceLinkContext {
        return signInCoordinator.verifyCode(
            challenge = challenge,
            code = code
        )
    }

    override suspend fun completeCloudLink(
        linkContext: CloudWorkspaceLinkContext,
        selection: CloudWorkspaceLinkSelection
    ): CloudWorkspaceSummary {
        return workspaceLinkCoordinator.completeCloudLink(
            linkContext = linkContext,
            selection = selection
        )
    }

    override suspend fun completeGuestUpgrade(
        linkContext: CloudWorkspaceLinkContext,
        selection: CloudWorkspaceLinkSelection
    ): CloudWorkspaceSummary {
        return workspaceLinkCoordinator.completeGuestUpgrade(
            linkContext = linkContext,
            selection = selection
        )
    }

    override suspend fun completeLinkedWorkspaceTransition(
        selection: CloudWorkspaceLinkSelection
    ): CloudWorkspaceSummary {
        return workspaceLinkCoordinator.completeLinkedWorkspaceTransition(selection = selection)
    }

    override suspend fun resetInvalidCloudCredentialRecoveryState() {
        workspaceLinkCoordinator.resetInvalidCloudCredentialRecoveryState()
    }

    override suspend fun logout() {
        workspaceLinkCoordinator.logout()
    }

    override suspend fun renameCurrentWorkspace(name: String): CloudWorkspaceSummary {
        return workspaceOperationsCoordinator.renameCurrentWorkspace(name = name)
    }

    override suspend fun loadCurrentWorkspaceDeletePreview(): CloudWorkspaceDeletePreview {
        return workspaceOperationsCoordinator.loadCurrentWorkspaceDeletePreview()
    }

    override suspend fun deleteCurrentWorkspace(confirmationText: String): CloudWorkspaceDeleteResult {
        return workspaceOperationsCoordinator.deleteCurrentWorkspace(confirmationText = confirmationText)
    }

    override suspend fun loadCurrentWorkspaceResetProgressPreview(): CloudWorkspaceResetProgressPreview {
        return workspaceOperationsCoordinator.loadCurrentWorkspaceResetProgressPreview()
    }

    override suspend fun resetCurrentWorkspaceProgress(
        confirmationText: String
    ): CloudWorkspaceResetProgressResult {
        return workspaceOperationsCoordinator.resetCurrentWorkspaceProgress(confirmationText = confirmationText)
    }

    override suspend fun loadProgressSeries(
        timeZone: String,
        from: String,
        to: String
    ): CloudProgressSeries {
        return progressRemoteReader.loadProgressSeries(
            timeZone = timeZone,
            from = from,
            to = to
        )
    }

    override suspend fun loadProgressSummary(timeZone: String): CloudProgressSummary {
        return progressRemoteReader.loadProgressSummary(timeZone = timeZone)
    }

    override suspend fun loadProgressReviewSchedule(timeZone: String): CloudProgressReviewSchedule {
        return progressRemoteReader.loadProgressReviewSchedule(timeZone = timeZone)
    }

    override suspend fun loadProgressLeaderboard(): CloudProgressLeaderboard {
        return progressRemoteReader.loadProgressLeaderboard()
    }

    override suspend fun loadProgressStreakLeaderboard(): CloudProgressStreakLeaderboard {
        return progressRemoteReader.loadProgressStreakLeaderboard()
    }

    override suspend fun loadProgressLeaderboardProfile(publicProfileId: String): CloudProgressLeaderboardProfile {
        return progressRemoteReader.loadProgressLeaderboardProfile(publicProfileId = publicProfileId)
    }

    override suspend fun loadCommunityProfile(): CloudCommunityProfile {
        return progressRemoteReader.loadCommunityProfile()
    }

    override suspend fun updateCommunityLeaderboardParticipation(
        leaderboardParticipationEnabled: Boolean
    ): CloudCommunityProfile {
        val updatedProfile = progressRemoteReader.updateCommunityLeaderboardParticipation(
            leaderboardParticipationEnabled = leaderboardParticipationEnabled
        )
        // A participation change flips the leaderboard payload server-side immediately,
        // while the cached payload would stay rendered until its hourly nextRefreshAfter.
        // Dropping the cache makes the next Progress visit refetch the correct status.
        database.progressRemoteCacheDao().deleteAllProgressLeaderboardCaches()
        database.progressRemoteCacheDao().deleteAllProgressStreakLeaderboardCaches()
        return updatedProfile
    }

    override suspend fun createFriendInvitation(
        request: CloudFriendInvitationCreateRequest
    ): CloudFriendInvitationCreateResponse {
        return operationCoordinator.runExclusive {
            val authenticatedSession = sessionProvider.authenticatedSession()
            remoteService.createFriendInvitation(
                apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                authorizationHeader = "Bearer ${authenticatedSession.credentials.idToken}",
                request = request
            )
        }
    }

    override suspend fun deleteAccount(confirmationText: String) {
        accountDeletionCoordinator.deleteAccount(confirmationText = confirmationText)
    }

    override suspend fun listLinkedWorkspaces(): List<CloudWorkspaceSummary> {
        return workspaceOperationsCoordinator.listLinkedWorkspaces()
    }

    override suspend fun switchLinkedWorkspace(selection: CloudWorkspaceLinkSelection): CloudWorkspaceSummary {
        return workspaceLinkCoordinator.completeLinkedWorkspaceTransition(selection = selection)
    }

    override suspend fun listAgentConnections(): AgentApiKeyConnectionsResult {
        return agentConnectionsReader.listAgentConnections()
    }

    override suspend fun revokeAgentConnection(connectionId: String): AgentApiKeyConnectionsResult {
        return agentConnectionsReader.revokeAgentConnection(connectionId = connectionId)
    }

    override suspend fun currentServerConfiguration(): CloudServiceConfiguration {
        return serverConfigurationCoordinator.currentServerConfiguration()
    }

    override suspend fun validateCustomServer(customOrigin: String): CloudServiceConfiguration {
        return serverConfigurationCoordinator.validateCustomServer(customOrigin = customOrigin)
    }

    override suspend fun applyCustomServer(configuration: CloudServiceConfiguration) {
        serverConfigurationCoordinator.applyCustomServer(configuration = configuration)
    }

    override suspend fun resetToOfficialServer() {
        serverConfigurationCoordinator.resetToOfficialServer()
    }

    private suspend fun refreshAccountContextLocked() {
        val session = resolveAccountContextSessionLocked() ?: return
        val accountSnapshot = remoteService.fetchCloudAccount(
            apiBaseUrl = session.apiBaseUrl,
            authorizationHeader = session.authorizationHeader
        )
        persistAccountSnapshotForCurrentCloudIdentity(accountSnapshot = accountSnapshot)
    }

    private suspend fun resolveAccountContextSessionLocked(): AccountContextSession? {
        if (preferencesStore.loadCloudCredentialRecoveryState() != null) {
            return null
        }

        val cloudSettings = preferencesStore.currentCloudSettings()
        val configuration = preferencesStore.currentServerConfiguration()
        return when (cloudSettings.cloudState) {
            CloudAccountState.LINKED -> {
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
                AccountContextSession(
                    apiBaseUrl = configuration.apiBaseUrl,
                    authorizationHeader = "Bearer ${refreshedCredentials.idToken}"
                )
            }

            CloudAccountState.GUEST -> {
                val guestSession: StoredGuestAiSession = requireNotNull(
                    loadActiveGuestSessionOrNull(
                        preferencesStore = preferencesStore,
                        guestSessionStore = guestSessionStore,
                        configuration = configuration
                    )
                ) {
                    "Guest cloud session is unavailable."
                }
                AccountContextSession(
                    apiBaseUrl = guestSession.apiBaseUrl,
                    authorizationHeader = "Guest ${guestSession.guestToken}"
                )
            }

            CloudAccountState.DISCONNECTED,
            CloudAccountState.LINKING_READY -> null
        }
    }

    private suspend fun persistAccountSnapshotForCurrentCloudIdentity(accountSnapshot: CloudAccountSnapshot) {
        val cloudSettings = preferencesStore.currentCloudSettings()
        if (cloudSettings.cloudState != CloudAccountState.LINKED && cloudSettings.cloudState != CloudAccountState.GUEST) {
            return
        }

        val expectedUserId = cloudSettings.linkedUserId?.trim()?.ifEmpty { null }
        if (expectedUserId != null && expectedUserId != accountSnapshot.userId) {
            resetCoordinator.resetLocalStateForCloudIdentityChange()
            throw IllegalStateException(
                "Cloud account changed during account context refresh. Local cloud identity was reset; sign in again."
            )
        }

        preferencesStore.saveAccountPreferences(preferences = accountSnapshot.preferences)
        val updatedLinkedEmail = if (cloudSettings.cloudState == CloudAccountState.LINKED) {
            accountSnapshot.email
        } else {
            cloudSettings.linkedEmail
        }
        if (cloudSettings.linkedUserId != accountSnapshot.userId || cloudSettings.linkedEmail != updatedLinkedEmail) {
            preferencesStore.updateCloudSettings(
                cloudState = cloudSettings.cloudState,
                linkedUserId = accountSnapshot.userId,
                linkedWorkspaceId = cloudSettings.linkedWorkspaceId,
                linkedEmail = updatedLinkedEmail,
                activeWorkspaceId = cloudSettings.activeWorkspaceId
            )
        }
    }
}

private data class AccountContextSession(
    val apiBaseUrl: String,
    val authorizationHeader: String
)
