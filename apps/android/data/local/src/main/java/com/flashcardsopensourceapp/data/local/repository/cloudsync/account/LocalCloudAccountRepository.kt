package com.flashcardsopensourceapp.data.local.repository.cloudsync.account

import com.flashcardsopensourceapp.data.local.model.sync.preservingLocalAccountIdentity
import java.io.File

import com.flashcardsopensourceapp.data.local.ai.store.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.CloudSocialGuestBinding
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.cloud.sync.SyncLocalStore
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.model.ai.StoredGuestAiSession
import com.flashcardsopensourceapp.data.local.model.cards.CardDraft
import com.flashcardsopensourceapp.data.local.model.cloud.AccountDeletionState
import com.flashcardsopensourceapp.data.local.model.cloud.AgentApiKeyConnectionsResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCommunityProfile
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudEntitlement
import com.flashcardsopensourceapp.data.local.model.cloud.CloudFriendInvitationCreateRequest
import com.flashcardsopensourceapp.data.local.model.cloud.CloudFriendInvitationCreateResponse
import com.flashcardsopensourceapp.data.local.model.cloud.CloudEmailSession
import com.flashcardsopensourceapp.data.local.model.cloud.CloudOtpChallenge
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSendCodeResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.media.ReviewMediaAssetFile
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCardMaintenanceAttempt
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCardMaintenanceConfirmation
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCardMaintenancePreview
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCardMaintenanceTarget
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
import com.flashcardsopensourceapp.data.local.model.sync.SavedAppLocale
import com.flashcardsopensourceapp.data.local.model.sync.applyAccountPreferencesUpdate
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportDownloadResponse
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportFormat
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportPreview
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportRequest
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportConfirmOptions
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportConfirmResult
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportPreview
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.FirstReviewOnboardingPushPendingException
import com.flashcardsopensourceapp.data.local.repository.cards.LocalCardsRepository
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.loadActiveGuestSessionOrNull
import com.flashcardsopensourceapp.data.local.repository.cloudsync.progress.CloudProgressRemoteReader
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudOperationCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudSessionProvider
import com.flashcardsopensourceapp.data.local.repository.cloudsync.workspace.CloudLinkedWorkspaceTransitionCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.workspace.CloudWorkspaceLinkCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.workspace.CloudWorkspaceOperationsCoordinator
import com.flashcardsopensourceapp.data.local.review.prompts.RemoteReviewPromptConfig
import com.flashcardsopensourceapp.core.observability.analytics.Analytics
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsEvent
import com.flashcardsopensourceapp.core.observability.analytics.FirstReviewOnboardingSource
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext

class LocalCloudAccountRepository(
    private val database: AppDatabase,
    private val preferencesStore: CloudPreferencesStore,
    private val remoteService: CloudRemoteGateway,
    private val syncLocalStore: SyncLocalStore,
    private val operationCoordinator: CloudOperationCoordinator,
    private val resetCoordinator: CloudIdentityResetCoordinator,
    private val guestSessionStore: GuestAiSessionStore,
    private val loadReviewMediaAssetFile: suspend (String) -> ReviewMediaAssetFile,
    private val appVersion: String,
    private val analytics: Analytics,
    /** The onboarding demo card in the current app language; `:app` owns its text. */
    private val demoCardDraftProvider: () -> CardDraft,
    /**
     * Fired when capturing or deleting the guest's demo card in a merge guest upgrade fails. The
     * upgrade still succeeds, and the repository owns no observability of its own.
     */
    private val onGuestUpgradeDemoCardCleanupFailed: (workspaceId: String, error: Exception) -> Unit,
    /** Receives `reviewPrompts` from each account refresh that has one; the app graph caches or reports it. */
    private val onReviewPromptConfigFetched: (RemoteReviewPromptConfig) -> Unit,
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
    onProductAnalyticsPreferencePushRefused: (Int?) -> Unit = {}
) : CloudAccountRepository {
    private val sessionProvider: CloudSessionProvider = CloudSessionProvider(
        preferencesStore = preferencesStore,
        remoteService = remoteService,
        operationCoordinator = operationCoordinator,
        resetCoordinator = resetCoordinator
    )
    private val productAnalyticsPreferenceCoordinator = CloudProductAnalyticsPreferenceCoordinator(
        preferencesStore = preferencesStore,
        remoteService = remoteService,
        operationCoordinator = operationCoordinator,
        guestSessionStore = guestSessionStore,
        resolveLinkedSessionLocked = ::resolveAccountContextSessionLocked,
        onProductAnalyticsPreferencePushRefused = onProductAnalyticsPreferencePushRefused
    )
    private val transitionCoordinator: CloudLinkedWorkspaceTransitionCoordinator =
        CloudLinkedWorkspaceTransitionCoordinator(
            database = database,
            preferencesStore = preferencesStore,
            remoteService = remoteService,
            syncLocalStore = syncLocalStore,
            operationCoordinator = operationCoordinator,
            loadReviewMediaAssetFile = loadReviewMediaAssetFile,
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
        cardsRepository = LocalCardsRepository(
            database = database,
            preferencesStore = preferencesStore,
            syncLocalStore = syncLocalStore
        ),
        demoCardDraftProvider = demoCardDraftProvider,
        onGuestUpgradeDemoCardCleanupFailed = onGuestUpgradeDemoCardCleanupFailed,
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
            resetCoordinator = resetCoordinator,
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

    override fun observeEntitlement(): Flow<CloudEntitlement?> {
        return preferencesStore.observeEntitlement()
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
        val requestedIdentity = preferencesStore.currentCloudSettings()
        return operationCoordinator.runExclusive {
            val currentIdentity = preferencesStore.currentCloudSettings()
            check(
                requestedIdentity.installationId == currentIdentity.installationId &&
                    requestedIdentity.linkedUserId == currentIdentity.linkedUserId &&
                    requestedIdentity.cloudState == currentIdentity.cloudState
            ) {
                "Account changed before preferences could be saved. Choose the preference again."
            }
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
                preferencesStore.saveAccountPreferences(preferences = previousPreferences)
                throw error
            } catch (error: Exception) {
                preferencesStore.saveAccountPreferences(preferences = previousPreferences)
                throw error
            }
        }
    }

    override suspend fun updateFirstReviewOnboardingCompleted(completed: Boolean) {
        val owner = preferencesStore.firstReviewOnboardingOwner()
        if (preferencesStore.saveFirstReviewOnboardingCompletedForOwner(completed, owner)) {
            analytics.track(if (completed) {
                AnalyticsEvent.FirstReviewOnboardingCompleted(FirstReviewOnboardingSource.SETTINGS)
            } else {
                AnalyticsEvent.FirstReviewOnboardingReset
            })
        }
        try {
            operationCoordinator.runExclusive { pushPendingFirstReviewOnboardingLocked() }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            throw FirstReviewOnboardingPushPendingException(error)
        }
    }

    private suspend fun pushPendingFirstReviewOnboardingLocked() {
        if (preferencesStore.currentAccountDeletionState() != AccountDeletionState.Hidden) return
        if (preferencesStore.pendingFirstReviewOnboardingEdit() == null) return
        val session = resolveAccountContextSessionLocked() ?: return
        preferencesStore.pushPendingFirstReviewOnboarding(
            remoteService = remoteService,
            apiBaseUrl = session.apiBaseUrl,
            authorizationHeader = session.authorizationHeader
        )
    }

    override suspend fun saveAppLocaleIfChanged(locale: String) {
        // Only the identity and session reads need the coordinator. The request goes out after it is
        // released, so sync and other exclusive work that follows a sign-in does not wait behind it.
        val pendingSave: PendingAppLocaleSave = operationCoordinator.runExclusive {
            resolvePendingAppLocaleSaveLocked(locale = locale)
        } ?: return
        remoteService.updateAccountPreferences(
            apiBaseUrl = pendingSave.session.apiBaseUrl,
            authorizationHeader = pendingSave.session.authorizationHeader,
            update = AccountPreferencesUpdate(
                accentColor = null,
                theme = null,
                reviewReactionAnimationsEnabled = null,
                productAnalyticsEnabled = null,
                productAnalyticsEnabledOrigin = null,
                locale = locale,
                firstReviewOnboardingCompleted = null
            )
        )
        // A user who signed out or switched meanwhile has not had the language saved for them.
        if (currentAppLocaleUserIdOrNull() == pendingSave.savedAppLocale.userId) {
            preferencesStore.saveSavedAppLocale(savedAppLocale = pendingSave.savedAppLocale)
        }
    }

    private suspend fun resolvePendingAppLocaleSaveLocked(locale: String): PendingAppLocaleSave? {
        // Like sync: an account being deleted is not written to.
        if (preferencesStore.currentAccountDeletionState() != AccountDeletionState.Hidden) {
            return null
        }
        val userId: String = currentAppLocaleUserIdOrNull() ?: return null
        val savedAppLocale = SavedAppLocale(userId = userId, locale = locale)
        if (preferencesStore.loadSavedAppLocale() == savedAppLocale) {
            return null
        }
        val session: AccountContextSession = resolveAccountContextSessionLocked() ?: return null
        return PendingAppLocaleSave(session = session, savedAppLocale = savedAppLocale)
    }

    private fun currentAppLocaleUserIdOrNull(): String? {
        return preferencesStore.currentCloudSettings().linkedUserId?.trim()?.ifEmpty { null }
    }

    override suspend fun updateProductAnalyticsEnabled(enabled: Boolean) {
        productAnalyticsPreferenceCoordinator.updateEnabled(enabled = enabled)
    }

    override suspend fun sendCode(email: String): CloudSendCodeResult {
        return signInCoordinator.sendCode(email = email)
    }

    override suspend fun prepareVerifiedSignIn(credentials: StoredCloudCredentials): CloudWorkspaceLinkContext {
        return signInCoordinator.prepareVerifiedSignIn(credentials = credentials)
    }

    internal suspend fun socialSignInGuestBinding(): CloudSocialGuestBinding? = operationCoordinator.runExclusive {
        loadActiveGuestSessionOrNull(
            preferencesStore = preferencesStore,
            guestSessionStore = guestSessionStore,
            configuration = preferencesStore.currentServerConfiguration()
        )?.takeIf { session -> session.isAnalyticsOnly.not() }?.let { session ->
            CloudSocialGuestBinding(userId = session.userId, workspaceId = session.workspaceId)
        }
    }

    suspend fun prepareSocialSignIn(credentials: StoredCloudCredentials): CloudWorkspaceLinkContext {
        return signInCoordinator.prepareSocialSignIn(credentials = credentials)
    }

    suspend fun verifyEmailCodeSession(
        challenge: CloudOtpChallenge,
        code: String,
        onVerificationStarted: () -> Unit,
        onVerified: suspend (CloudEmailSession) -> Unit
    ): CloudWorkspaceLinkContext = signInCoordinator.verifyCodeSession(challenge, code, onVerificationStarted, onVerified)

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
            selection = selection,
            retainedWorkspace = null,
            onWorkspaceSelected = {}
        )
    }

    /** The Wear OS watch's link: always replaces the local shell; see [CloudWorkspaceLinkCoordinator.completeReplicaCloudLink]. */
    suspend fun completeReplicaCloudLink(
        linkContext: CloudWorkspaceLinkContext,
        workspaceId: String
    ): CloudWorkspaceSummary {
        return workspaceLinkCoordinator.completeReplicaCloudLink(linkContext = linkContext, workspaceId = workspaceId)
    }

    internal suspend fun completeSocialCloudLink(
        linkContext: CloudWorkspaceLinkContext,
        selection: CloudWorkspaceLinkSelection,
        retainedWorkspace: CloudWorkspaceSummary?,
        onWorkspaceSelected: suspend (CloudWorkspaceSummary) -> Unit
    ): CloudWorkspaceSummary {
        return workspaceLinkCoordinator.completeCloudLink(
            linkContext = linkContext,
            selection = selection,
            retainedWorkspace = retainedWorkspace,
            onWorkspaceSelected = onWorkspaceSelected
        )
    }

    override suspend fun refreshGuestUpgradeWorkspaces(
        linkContext: CloudWorkspaceLinkContext,
        socialAttemptId: String?
    ): CloudWorkspaceLinkContext {
        return workspaceLinkCoordinator.refreshGuestUpgradeWorkspaces(linkContext, socialAttemptId)
    }

    override suspend fun completeGuestUpgrade(
        linkContext: CloudWorkspaceLinkContext,
        selection: CloudWorkspaceLinkSelection,
        onGuestCompletionStarted: () -> Unit,
        onGuestCompletionFinished: () -> Unit
    ): CloudWorkspaceSummary {
        return workspaceLinkCoordinator.completeGuestUpgrade(
            linkContext = linkContext,
            selection = selection,
            socialAttemptId = null,
            onGuestCompletionStarted = onGuestCompletionStarted,
            onGuestCompletionFinished = onGuestCompletionFinished
        )
    }

    internal suspend fun completeSocialGuestUpgrade(
        linkContext: CloudWorkspaceLinkContext,
        selection: CloudWorkspaceLinkSelection,
        attempt: String,
        onGuestCompletionStarted: () -> Unit,
        onGuestCompletionFinished: () -> Unit
    ): CloudWorkspaceSummary {
        return workspaceLinkCoordinator.completeGuestUpgrade(
            linkContext = linkContext,
            selection = selection,
            socialAttemptId = attempt,
            onGuestCompletionStarted = onGuestCompletionStarted,
            onGuestCompletionFinished = onGuestCompletionFinished
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

    override suspend fun previewCardMaintenance(target: CloudCardMaintenanceTarget): CloudCardMaintenancePreview {
        return workspaceOperationsCoordinator.previewCardMaintenance(target = target)
    }

    override suspend fun executeCardMaintenance(confirmation: CloudCardMaintenanceConfirmation): Int {
        return workspaceOperationsCoordinator.executeCardMaintenance(confirmation = confirmation)
    }

    override fun loadCardMaintenanceAttempt(workspaceId: String, attemptId: String): CloudCardMaintenanceAttempt? {
        return workspaceOperationsCoordinator.loadCardMaintenanceAttempt(workspaceId = workspaceId, attemptId = attemptId)
    }

    override fun observeCardMaintenanceAttempt(workspaceId: String, attemptId: String): Flow<CloudCardMaintenanceAttempt?> {
        return workspaceOperationsCoordinator.observeCardMaintenanceAttempt(workspaceId = workspaceId, attemptId = attemptId)
    }

    override suspend fun refreshCardMaintenanceWorkspace(workspaceId: String, attemptId: String) {
        workspaceOperationsCoordinator.refreshCardMaintenanceWorkspace(workspaceId = workspaceId, attemptId = attemptId)
    }

    override suspend fun previewCurrentWorkspacePackageExport(
        expectedWorkspaceId: String,
        request: WorkspacePackageExportRequest
    ): WorkspacePackageExportPreview {
        return workspaceOperationsCoordinator.previewCurrentWorkspacePackageExport(
            expectedWorkspaceId = expectedWorkspaceId,
            request = request
        )
    }

    override suspend fun exportCurrentWorkspacePackage(
        expectedWorkspaceId: String,
        format: WorkspacePackageExportFormat,
        request: WorkspacePackageExportRequest,
        destination: File
    ): WorkspacePackageExportDownloadResponse {
        return workspaceOperationsCoordinator.exportCurrentWorkspacePackage(
            expectedWorkspaceId = expectedWorkspaceId,
            format = format,
            request = request,
            destination = destination
        )
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

    internal suspend fun reconcileConnectedAccount(result: com.flashcardsopensourceapp.data.local.model.cloud.CloudConnectionCommit) {
        operationCoordinator.runExclusive {
            val session = sessionProvider.authenticatedSession()
            val identity = requireNotNull(session.accountSnapshot.authenticatedIdentity) {
                "Connected account metadata is not available. Refresh the account before continuing."
            }
            check(result.canonicalAccountId in identity.linkedAccountIds &&
                result.sourceUserId in identity.linkedAccountIds)
            workspaceLinkCoordinator.retainConnectedAccount(session, result.selectedWorkspaceId)
        }
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
        // An analytics guest can deliver a pending answer even when there is no account to fetch.
        productAnalyticsPreferenceCoordinator.reconcilePendingLocked()
        pushPendingFirstReviewOnboardingLocked()
        val session = resolveAccountContextSessionLocked() ?: return
        val accountSnapshot = remoteService.fetchCloudAccount(
            apiBaseUrl = session.apiBaseUrl,
            authorizationHeader = session.authorizationHeader
        ).preservingLocalAccountIdentity(
            settings = preferencesStore.currentCloudSettings()
        )
        persistAccountSnapshotForCurrentCloudIdentity(accountSnapshot = accountSnapshot)
        accountSnapshot.reviewPromptConfig?.let(onReviewPromptConfigFetched)
    }

    private suspend fun resolveAccountContextSessionLocked(): AccountContextSession? {
        if (preferencesStore.loadCloudCredentialRecoveryState() != null) {
            return null
        }

        val cloudSettings = preferencesStore.currentCloudSettings()
        val configuration = preferencesStore.currentServerConfiguration()
        return when (cloudSettings.cloudState) {
            CloudAccountState.LINKED -> {
                val storedCredentials = requireNotNull(
                    withContext(Dispatchers.IO) { preferencesStore.loadCredentials() }
                ) {
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
                    ).also { credentials ->
                        withContext(Dispatchers.IO) {
                            preferencesStore.saveCredentials(credentials)
                        }
                    }
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
            resetCoordinator.resetLocalStateForLinkedAccountMismatch()
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

internal data class AccountContextSession(
    val apiBaseUrl: String,
    val authorizationHeader: String
)

private data class PendingAppLocaleSave(
    val session: AccountContextSession,
    val savedAppLocale: SavedAppLocale
)
