package com.flashcardsopensourceapp.data.local.repository.cloudsync.account

import com.flashcardsopensourceapp.data.local.ai.store.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
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
import com.flashcardsopensourceapp.data.local.model.sync.AccountPreferencesUpdate
import com.flashcardsopensourceapp.data.local.model.sync.CloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.model.sync.applyAccountPreferencesUpdate
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportDownloadResponse
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportPreview
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportRequest
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportConfirmOptions
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportConfirmResult
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportPreview
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.ProductAnalyticsPreferencePushPendingException
import com.flashcardsopensourceapp.data.local.repository.ProductAnalyticsPreferencePushRefusedException
import com.flashcardsopensourceapp.data.local.repository.ProductAnalyticsPreferencePushUndeliverableException
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.loadActiveGuestSessionOrNull
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.loadProductAnalyticsGuestSessionOrNull
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
    private val appVersion: String,
    /**
     * Fired once a plain sign-in has stored its credentials. The app graph turns it into one
     * `CloudGuestSessionCoordinator.linkAnalyticsGuestIdentityToSignedInAccount` attempt off the
     * sign-in's own coroutine.
     */
    private val onAnalyticsGuestIdentityLinkRequested: () -> Unit = {},
    /**
     * Fired once with the refusing status code when a pending product-analytics answer is given up
     * as undeliverable. The repository owns no observability of its own, and the app graph turns it
     * into a single analytics-pipeline warning.
     */
    private val onProductAnalyticsPreferencePushRefused: (Int?) -> Unit = {}
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
        appVersion = appVersion,
        onAnalyticsGuestIdentityLinkRequested = onAnalyticsGuestIdentityLinkRequested
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

    override suspend fun updateAccountPreferences(update: AccountPreferencesUpdate): AccountPreferences {
        return operationCoordinator.runExclusive {
            val previousPreferences = preferencesStore.currentAccountPreferences()
            preferencesStore.saveAccountPreferences(
                preferences = applyAccountPreferencesUpdate(
                    preferences = previousPreferences,
                    update = update
                )
            )

            try {
                val session = requireNotNull(resolveAccountContextSessionLocked()) {
                    "Account preferences require an active linked or guest cloud account."
                }
                val updatedPreferences = remoteService.updateAccountPreferences(
                    apiBaseUrl = session.apiBaseUrl,
                    authorizationHeader = session.authorizationHeader,
                    update = update
                )
                preferencesStore.savePushedAccountPreferences(preferences = updatedPreferences)
                updatedPreferences
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                preferencesStore.saveAccountPreferences(preferences = previousPreferences)
                throw error
            }
        }
    }

    override suspend fun updateProductAnalyticsEnabled(enabled: Boolean) {
        // Outside the coordinator, before anything can wait: this is a `SharedPreferences` commit
        // and a state-flow update, and only the push below needs exclusivity. The coordinator is
        // shared with full sync, workspace operations, guest upgrade recovery and account deletion,
        // all of which hold it across network I/O for arbitrarily long, and until the answer is
        // written the kill switch still reads as on and the client keeps recording and flushing.
        //
        // Durable before the request, and never rolled back by it: a device told to stop has to
        // stop whether or not the server can be reached, and the answer has to survive the process
        // dying on the next line.
        preferencesStore.saveProductAnalyticsEnabledPendingPush(enabled = enabled)
        operationCoordinator.runExclusive {
            // The push's own failure is held rather than thrown, because it is not the outcome: the
            // answer is what the person asked about, and the readback below decides what became of
            // it. An account refresh — fired on entering Settings, on launch and on foreground —
            // can hold or win the coordinator after the durable write and deliver, or be refused
            // on, this very answer, because `refreshAccountContextLocked` must keep going to the
            // account read. The push below then finds nothing pending and returns.
            val pushFailure: Exception? = try {
                pushPendingProductAnalyticsPreferenceLocked()
                null
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                error
            }
            val failure: Exception? = productAnalyticsAnswerFailureLocked(
                enabled = enabled,
                cause = pushFailure
            )
            if (failure != null) {
                throw failure
            }
        }
    }

    /**
     * What became of the answer after this caller's turn, read from the store rather than inferred
     * from the push, and null where there is nothing to report.
     *
     * Asserting the outcome instead of the refusal record alone is what stops one server refusal
     * being reported two different ways depending on who won the coordinator. A refusal the handler
     * deliberately leaves owed — a revoked credential — writes no record, so a concurrent refresh
     * absorbing it would otherwise leave this caller with no failure to see and the person with a
     * silent success for a delivery that never happened.
     *
     * A superseded answer is not this caller's to report. Their own answer reached wherever it was
     * going, and what is owed now belongs to the toggle that replaced it and carries its own marker.
     *
     * Known limitation: an answer whose marker was dropped at an identity boundary reads here as
     * delivered. `CloudPreferencesStore.clearAccountPreferences` drops an owed opt-in's marker on
     * logout, and nothing in the store distinguishes that from a push that landed, so a toggle
     * racing a logout reports plain success although the account copy went with the identity it
     * belonged to. Left as is: telling the two apart needs a durable record of why the marker went
     * away, the local answer survives the boundary and is still honored, and an owed opt-in is the
     * direction where a lost account copy collects less rather than more.
     */
    private fun productAnalyticsAnswerFailureLocked(enabled: Boolean, cause: Exception?): Exception? {
        if (preferencesStore.currentAccountPreferences().productAnalyticsEnabled != enabled) {
            return null
        }
        if (preferencesStore.isProductAnalyticsEnabledPushRefused()) {
            return ProductAnalyticsPreferencePushRefusedException(cause = cause)
        }
        if (preferencesStore.isProductAnalyticsEnabledPendingPush().not()) {
            return null
        }
        if (enabled.not() && productAnalyticsAnswerHasNowhereToLand()) {
            return ProductAnalyticsPreferencePushUndeliverableException(cause = cause)
        }
        return cause ?: ProductAnalyticsPreferencePushPendingException(cause = null)
    }

    /**
     * Whether an owed opt-out has no identity left that will ever receive it.
     *
     * Asked only of an opt-out, because that is the answer that removes its own delivery: a client
     * told to stop never flushes, so it never asks for an analytics guest session and nothing mints
     * one. An owed opt-in is the opposite — analytics resumes, the next flush mints a session, and
     * the next account read delivers the answer — so it stays an ordinary retryable failure.
     *
     * A signed-in account always has somewhere to land, and so does one waiting on credential
     * recovery it entered from `LINKED`: that account outlives the credential, and the next refresh
     * after it is restored delivers the answer. A recovery entered from `GUEST` is not that case —
     * it is an install with no account whose guest session is what went missing — so it falls
     * through to the lookup below and reads as undeliverable, which is the true answer for it,
     * including for the erase escape hatch that ends such a recovery with no identity at all. Only
     * an install with no account and no analytics guest session left has nothing to reach.
     *
     * Two states answer `true` although an account does exist: an `INVALID_STORED_STATE` recovery,
     * which is recorded with `previousCloudState = DISCONNECTED` whatever the install was before,
     * and `LINKING_READY` with no stored guest session while a sign-in is still in flight. Both
     * understate what exists rather than mislead, because the message they produce only claims
     * there is nothing to update now and that signing in will save the answer — which stays true
     * in both.
     *
     * Deliberately not [resolveProductAnalyticsSessionLocked]: that answers what can be presented
     * right now and would refresh an ID token over the network to say so, while the question here is
     * whether a later attempt has any chance at all.
     */
    private fun productAnalyticsAnswerHasNowhereToLand(): Boolean {
        if (preferencesStore.currentCloudSettings().cloudState == CloudAccountState.LINKED) {
            return false
        }
        val recoveryState: CloudCredentialRecoveryState? = preferencesStore.loadCloudCredentialRecoveryState()
        if (recoveryState?.previousCloudState == CloudAccountState.LINKED) {
            return false
        }
        // The same lookup the push and the analytics batches resolve through, so this cannot drift
        // on which session counts as the analytics one.
        return loadProductAnalyticsGuestSessionOrNull(
            guestSessionStore = guestSessionStore,
            configuration = preferencesStore.currentServerConfiguration()
        ) == null
    }

    override suspend fun sendCode(email: String): CloudSendCodeResult {
        return signInCoordinator.sendCode(email = email)
    }

    override suspend fun prepareVerifiedSignIn(credentials: StoredCloudCredentials): CloudWorkspaceLinkContext {
        return signInCoordinator.prepareVerifiedSignIn(credentials = credentials)
    }

    override suspend fun verifyCode(
        challenge: CloudOtpChallenge,
        code: String,
        onVerified: () -> Unit
    ): CloudWorkspaceLinkContext {
        return signInCoordinator.verifyCode(
            challenge = challenge,
            code = code,
            onVerified = onVerified
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

    override suspend fun previewCurrentWorkspacePackageExport(
        request: WorkspacePackageExportRequest
    ): WorkspacePackageExportPreview {
        return workspaceOperationsCoordinator.previewCurrentWorkspacePackageExport(request = request)
    }

    override suspend fun exportCurrentWorkspacePackage(
        request: WorkspacePackageExportRequest
    ): WorkspacePackageExportDownloadResponse {
        return workspaceOperationsCoordinator.exportCurrentWorkspacePackage(request = request)
    }

    override suspend fun previewCurrentWorkspacePackageImport(
        packageBytes: ByteArray
    ): WorkspacePackageImportPreview {
        return workspaceOperationsCoordinator.previewCurrentWorkspacePackageImport(packageBytes = packageBytes)
    }

    override suspend fun confirmCurrentWorkspacePackageImport(
        fileName: String,
        packageBytes: ByteArray,
        options: WorkspacePackageImportConfirmOptions
    ): WorkspacePackageImportConfirmResult {
        return workspaceOperationsCoordinator.confirmCurrentWorkspacePackageImport(
            fileName = fileName,
            packageBytes = packageBytes,
            options = options
        )
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
        // Before the read: an answer still owed to the server would otherwise be overwritten by the
        // older answer the server is about to report.
        //
        // Never fatal to the refresh. A push that keeps failing — a server down, a device offline,
        // a refusal `handleRefusedProductAnalyticsPreferencePushLocked` deliberately leaves owed —
        // would otherwise abort every refresh this install ever runs, because the marker stays set:
        // workspaces, linked email and account-deletion state would stop updating and Settings
        // would report a failure on every launch. The failure is
        // already reported by the HTTP layer, and the direct `updateProductAnalyticsEnabled` caller
        // is the one that surfaces it to the person who asked; here the answer simply stays owed
        // and the next refresh retries it.
        try {
            pushPendingProductAnalyticsPreferenceLocked()
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            // Deliberately continues to the account read below.
        }
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

    private suspend fun pushPendingProductAnalyticsPreferenceLocked() {
        if (preferencesStore.isProductAnalyticsEnabledPendingPush().not()) {
            return
        }

        // Never null while the marker is set: every writer of the marker commits it in the same
        // `SharedPreferences` transaction as the answer it owes, and no writer removes the answer
        // while one is owed, all of it under the store's product-analytics lock. The elvis only
        // keeps the expression total.
        val enabled: Boolean = preferencesStore.currentAccountPreferences().productAnalyticsEnabled ?: return
        // No credential yet. The device already honors the answer on its own, and the next refresh
        // that finds a credential delivers it; minting one here is not an option, because recording
        // a refusal must never create the identity it refuses.
        val session = resolveProductAnalyticsSessionLocked() ?: return
        val updatedPreferences = try {
            remoteService.updateAccountPreferences(
                apiBaseUrl = session.apiBaseUrl,
                authorizationHeader = session.authorizationHeader,
                update = AccountPreferencesUpdate(
                    reviewReactionAnimationsEnabled = null,
                    productAnalyticsEnabled = enabled
                )
            )
        } catch (error: CloudRemoteException) {
            // Recorded here, classified by the caller. What the refusal did to the answer is written
            // to the store, and reading it back there is the only way the direct caller sees the
            // same outcome whether its own push or a concurrent refresh hit the refusal.
            handleRefusedProductAnalyticsPreferencePushLocked(
                enabled = enabled,
                session = session,
                error = error
            )
            throw error
        }
        // The acknowledgement save, which never re-arms the marker it is about to clear. Cleared
        // after it: a crash in between costs one redundant PATCH on the next refresh, while the
        // reverse order would drop an answer that is not yet fully stored.
        //
        // Conditional on the pushed answer still being the stored one, compared and cleared in one
        // step inside the store. The durable write happens outside the coordinator, so a second
        // toggle can land — and re-arm the marker — while this push is parked in its PATCH;
        // clearing unconditionally would wipe the marker that second answer just armed, and its own
        // job would then find nothing pending and send nothing. The ordinary success case always
        // matches, because `savePushedAccountPreferences` keeps this device's own answer, so the
        // marker cannot be left set forever by a push that nothing superseded. When it does not
        // match, the newer answer is already owed and carries its own marker, so the next push
        // delivers it.
        //
        // A server that accepts the PATCH but does not know the field answers with it absent, which
        // decodes as null, keeps the stored answer, and lets this clear mark as delivered something
        // the server ignored. Left as is: the hosted product deploys the backend ahead of its
        // clients, so only a custom origin can reach a server that does not know the field.
        preferencesStore.savePushedAccountPreferences(preferences = updatedPreferences)
        preferencesStore.clearProductAnalyticsEnabledPendingPushIfAnswerIs(enabled = enabled)
    }

    /**
     * A refusal that repeating cannot fix, handled so the same doomed PATCH does not re-issue on
     * every refresh for the life of the install.
     *
     * `401` and `410` on the analytics guest credential are the server saying the session behind it
     * is gone. Left in place, [resolveProductAnalyticsSessionLocked] would keep handing back the
     * same dead token. The analytics batch path retires it too, from
     * `AppAnalyticsSupport.onCredentialRefused`, and one dead token can be refused on both paths in
     * the same process — a flush and this push can each present it. Whichever runs second finds the
     * session already gone, or a replacement the check below rejects as not the refused one, and
     * does nothing; retiring is idempotent that way rather than coordinated. Retiring it leaves the
     * answer owed. An owed opt-in is then delivered by the next process,
     * which mints a replacement session as soon as analytics needs a credential again; an owed
     * opt-out stays owed and undeliverable, because a client told to stop never flushes, so it
     * never asks for a credential and nothing mints one. That is deliberate: this device has
     * already stopped collecting, and minting a fresh server-side identity purely to announce that
     * it will send nothing would create the very thing the person opted out of. A refusal on a
     * cloud guest is left alone: that credential is not this path's to retire, and AI chat,
     * feedback and sync own its recovery.
     *
     * Any other durable `4xx` is a verdict on the request itself — an unknown or rejected field, a
     * body this server will never accept — so the answer is given up as undeliverable and the
     * refusal reported once. Recorded rather than merely un-marked: clearing the marker alone would
     * let the undelivered-opt-out re-arm in `CloudPreferencesStore.saveAccountPreferences` put the
     * same doomed push straight back on the next account read, re-issuing it and re-reporting it on
     * every refresh. The device still honors the answer locally either way, and the person's own
     * retoggle drops the record and sends a fresh one.
     *
     * A refusal of an answer a second toggle has already replaced is dropped whole: the marker it
     * would clear belongs to that newer answer, so the store refuses to record it, and the warning
     * goes with it. Reporting a giving-up there would name an answer that was superseded rather
     * than abandoned, and would break the one-warning-per-answer contract the refused answer's own
     * report already satisfies.
     *
     * `403`, `408` and `429` stay owed exactly as a transient failure does: they are authorization
     * and pressure, not a verdict on the answer.
     */
    private fun handleRefusedProductAnalyticsPreferencePushLocked(
        enabled: Boolean,
        session: AccountContextSession,
        error: CloudRemoteException
    ) {
        val statusCode: Int = error.statusCode ?: return
        if (statusCode !in 400..499) {
            return
        }
        if (statusCode == 401 || statusCode == 410) {
            retireRefusedProductAnalyticsGuestSessionLocked(session = session)
            return
        }
        if (statusCode == 403 || statusCode == 408 || statusCode == 429) {
            return
        }

        if (preferencesStore.markProductAnalyticsEnabledPushRefusedIfAnswerIs(enabled = enabled)) {
            onProductAnalyticsPreferencePushRefused(statusCode)
        }
    }

    private fun retireRefusedProductAnalyticsGuestSessionLocked(session: AccountContextSession) {
        val guestSession: StoredGuestAiSession = loadProductAnalyticsGuestSessionOrNull(
            guestSessionStore = guestSessionStore,
            configuration = preferencesStore.currentServerConfiguration()
        ) ?: return
        if (guestSession.isAnalyticsOnly.not()) {
            return
        }
        // The refused credential has to be the one still stored: a bearer token, or a guest already
        // replaced since the request, says nothing about what would be presented next.
        if (session.authorizationHeader != "Guest ${guestSession.guestToken}") {
            return
        }

        // Not the two keys it happens to sit under: a session bound to another local workspace would
        // survive and be presented as the next analytics credential. In practice that scan finds
        // exactly the entry resolved above — this install holds one guest identity at a time,
        // because a mint only runs when `loadAnySession` finds nothing and `saveSession` drops the
        // duplicate keys of what it writes — so the wider sweep is for leftovers an older build or
        // a restored preferences file could leave behind. Such a leftover is dropped with the
        // refused one rather than kept, which is why the cloud guest this path leaves alone is the
        // resolved credential and not every stored entry.
        guestSessionStore.clearStoredSessions()
    }

    /**
     * The analytics answer reaches further than the other preferences: an install that never signed
     * in still has a server-side identity once analytics minted its guest session, and that session
     * is where its answer belongs.
     *
     * Every guest case therefore resolves through [loadProductAnalyticsGuestSessionOrNull], the one
     * function that also picks the credential the analytics batches are delivered under. Routing a
     * `GUEST` install through the account-context lookup instead would park the answer on the
     * workspace-bound session while the events left on another one.
     */
    private suspend fun resolveProductAnalyticsSessionLocked(): AccountContextSession? {
        if (preferencesStore.loadCloudCredentialRecoveryState() != null) {
            return null
        }
        if (preferencesStore.currentCloudSettings().cloudState == CloudAccountState.LINKED) {
            return resolveAccountContextSessionLocked()
        }

        val guestSession: StoredGuestAiSession = loadProductAnalyticsGuestSessionOrNull(
            guestSessionStore = guestSessionStore,
            configuration = preferencesStore.currentServerConfiguration()
        ) ?: return null
        return AccountContextSession(
            apiBaseUrl = guestSession.apiBaseUrl,
            authorizationHeader = "Guest ${guestSession.guestToken}"
        )
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
