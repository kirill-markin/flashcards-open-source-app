package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.model.sync.AppMetadataSummary
import com.flashcardsopensourceapp.data.local.model.ai.AiChatBootstrapResponse
import com.flashcardsopensourceapp.data.local.model.ai.AiChatLiveEvent
import com.flashcardsopensourceapp.data.local.model.ai.AiChatLiveStreamEnvelope
import com.flashcardsopensourceapp.data.local.model.ai.AiChatDraftState
import com.flashcardsopensourceapp.data.local.model.ai.AiChatPersistedState
import com.flashcardsopensourceapp.data.local.model.ai.AiChatResumeDiagnostics
import com.flashcardsopensourceapp.data.local.model.ai.AiChatSessionProvisioningResult
import com.flashcardsopensourceapp.data.local.model.ai.AiChatSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.ai.AiChatStopRunResponse
import com.flashcardsopensourceapp.data.local.model.ai.AiChatStartRunResponse
import com.flashcardsopensourceapp.data.local.model.ai.AiChatTranscriptionResult
import com.flashcardsopensourceapp.data.local.model.cards.CardDraft
import com.flashcardsopensourceapp.data.local.model.cards.CardFilter
import com.flashcardsopensourceapp.data.local.model.cards.CardSummary
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSendCodeResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkContext
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCommunityProfile
import com.flashcardsopensourceapp.data.local.model.cloud.CloudFriendInvitationCreateRequest
import com.flashcardsopensourceapp.data.local.model.cloud.CloudFriendInvitationCreateResponse
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudOtpChallenge
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboard
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressReviewSchedule
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceDeletePreview
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceDeleteResult
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceResetProgressPreview
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceResetProgressResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.feedback.CloudFeedbackState
import com.flashcardsopensourceapp.data.local.model.feedback.CloudFeedbackTrigger
import com.flashcardsopensourceapp.data.local.model.cloud.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.cloud.AgentApiKeyConnection
import com.flashcardsopensourceapp.data.local.model.cloud.AgentApiKeyConnectionsResult
import com.flashcardsopensourceapp.data.local.model.cloud.AccountDeletionState
import com.flashcardsopensourceapp.data.local.model.sync.AccountPreferences
import com.flashcardsopensourceapp.data.local.model.cards.DeckDraft
import com.flashcardsopensourceapp.data.local.model.cards.DeckSummary
import com.flashcardsopensourceapp.data.local.model.sync.DeviceDiagnosticsSummary
import com.flashcardsopensourceapp.data.local.model.review.PendingReviewedCard
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardSnapshot
import com.flashcardsopensourceapp.data.local.model.progress.ProgressReviewScheduleSnapshot
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSeriesSnapshot
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSummarySnapshot
import com.flashcardsopensourceapp.data.local.model.review.ReviewCard
import com.flashcardsopensourceapp.data.local.model.review.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.feedback.FeedbackPromptReviewActivity
import com.flashcardsopensourceapp.data.local.model.review.ReviewRating
import com.flashcardsopensourceapp.data.local.model.review.ReviewSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.review.ReviewTimelinePage
import com.flashcardsopensourceapp.data.local.model.sync.SyncStatusSnapshot
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspaceExportData
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspaceOverviewSummary
import com.flashcardsopensourceapp.data.local.model.scheduling.WorkspaceSchedulerSettings
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspaceTagsSummary
import kotlinx.coroutines.flow.Flow

interface CardsRepository {
    fun observeCards(searchQuery: String, filter: CardFilter): Flow<List<CardSummary>>
    fun observeCard(cardId: String): Flow<CardSummary?>
    suspend fun createCard(cardDraft: CardDraft)
    suspend fun updateCard(cardId: String, cardDraft: CardDraft)
    suspend fun deleteCard(cardId: String)
}

interface DecksRepository {
    fun observeDecks(): Flow<List<DeckSummary>>
    fun observeDeck(deckId: String): Flow<DeckSummary?>
    fun observeDeckCards(deckId: String): Flow<List<CardSummary>>
    suspend fun createDeck(deckDraft: DeckDraft): String
    suspend fun updateDeck(deckId: String, deckDraft: DeckDraft)
    suspend fun deleteDeck(deckId: String)
}

interface WorkspaceRepository {
    fun observeWorkspace(): Flow<WorkspaceSummary?>
    fun observeAppMetadata(): Flow<AppMetadataSummary>
    fun observeWorkspaceOverview(): Flow<WorkspaceOverviewSummary?>
    fun observeWorkspaceSchedulerSettings(): Flow<WorkspaceSchedulerSettings?>
    fun observeWorkspaceTagsSummary(): Flow<WorkspaceTagsSummary>
    fun observeDeviceDiagnostics(): Flow<DeviceDiagnosticsSummary?>
    suspend fun loadWorkspaceExportData(): WorkspaceExportData?
    suspend fun updateWorkspaceSchedulerSettings(
        desiredRetention: Double,
        learningStepsMinutes: List<Int>,
        relearningStepsMinutes: List<Int>,
        maximumIntervalDays: Int,
        enableFuzz: Boolean
    )
}

interface ReviewRepository {
    fun observeReviewSession(
        selectedFilter: ReviewFilter,
        pendingReviewedCards: Set<PendingReviewedCard>,
        presentedCardId: String?
    ): Flow<ReviewSessionSnapshot>

    suspend fun loadReviewTimelinePage(
        selectedFilter: ReviewFilter,
        pendingReviewedCards: Set<PendingReviewedCard>,
        offset: Int,
        limit: Int
    ): ReviewTimelinePage

    suspend fun countRecordedReviews(): Int

    suspend fun countRecordedReviewsInCurrentWorkspace(): Int

    suspend fun loadFeedbackPromptReviewActivity(
        currentLocalDayStartMillis: Long,
        nextLocalDayStartMillis: Long
    ): FeedbackPromptReviewActivity

    suspend fun loadReviewCardForRollback(selectedFilter: ReviewFilter, cardId: String): ReviewCard?

    suspend fun recordReview(cardId: String, rating: ReviewRating, reviewedAtMillis: Long)
}

interface SyncRepository {
    fun observeSyncStatus(): Flow<SyncStatusSnapshot>
    suspend fun scheduleSync()
    suspend fun syncNow()
}

interface ProgressRepository {
    fun observeSummarySnapshot(): Flow<ProgressSummarySnapshot?>
    fun observeSeriesSnapshot(): Flow<ProgressSeriesSnapshot?>
    fun observeReviewScheduleSnapshot(): Flow<ProgressReviewScheduleSnapshot?>
    fun observeLeaderboardSnapshot(): Flow<ProgressLeaderboardSnapshot?>
    suspend fun refreshSummaryIfInvalidated()
    suspend fun refreshSeriesIfInvalidated()
    suspend fun refreshReviewScheduleIfInvalidated()
    suspend fun refreshLeaderboardIfInvalidated()
    suspend fun refreshLeaderboardForReviewShortcut()
    suspend fun refreshSummaryManually()
    suspend fun refreshSeriesManually()
    suspend fun refreshReviewScheduleManually()
    suspend fun refreshLeaderboardManually()
}

interface FeedbackRepository {
    suspend fun loadFeedbackStateForExistingCloudSession(): CloudFeedbackState?
    suspend fun recordAutomaticPromptShownForExistingCloudSession(): CloudFeedbackState?
    suspend fun submitFeedback(trigger: CloudFeedbackTrigger, message: String): CloudFeedbackState
}

interface CloudAccountRepository {
    fun observeCloudSettings(): Flow<CloudSettings>
    fun observeAccountPreferences(): Flow<AccountPreferences>
    fun observeAccountDeletionState(): Flow<AccountDeletionState>
    fun observeServerConfiguration(): Flow<CloudServiceConfiguration>
    fun observeCloudCredentialRecoveryState(): Flow<CloudCredentialRecoveryState?>
    suspend fun eraseLocalDataForCredentialRecovery()
    suspend fun beginAccountDeletion()
    suspend fun resumePendingAccountDeletionIfNeeded()
    suspend fun retryPendingAccountDeletion()
    suspend fun refreshAccountContext()
    suspend fun updateAccountPreferences(preferences: AccountPreferences): AccountPreferences
    suspend fun sendCode(email: String): CloudSendCodeResult
    suspend fun prepareVerifiedSignIn(credentials: StoredCloudCredentials): CloudWorkspaceLinkContext
    suspend fun verifyCode(challenge: CloudOtpChallenge, code: String): CloudWorkspaceLinkContext
    suspend fun completeCloudLink(
        linkContext: CloudWorkspaceLinkContext,
        selection: CloudWorkspaceLinkSelection
    ): CloudWorkspaceSummary
    suspend fun completeGuestUpgrade(
        linkContext: CloudWorkspaceLinkContext,
        selection: CloudWorkspaceLinkSelection
    ): CloudWorkspaceSummary
    suspend fun completeLinkedWorkspaceTransition(selection: CloudWorkspaceLinkSelection): CloudWorkspaceSummary
    suspend fun resetInvalidCloudCredentialRecoveryState()
    suspend fun logout()
    suspend fun renameCurrentWorkspace(name: String): CloudWorkspaceSummary
    suspend fun loadCurrentWorkspaceDeletePreview(): CloudWorkspaceDeletePreview
    suspend fun deleteCurrentWorkspace(confirmationText: String): CloudWorkspaceDeleteResult
    suspend fun loadCurrentWorkspaceResetProgressPreview(): CloudWorkspaceResetProgressPreview
    suspend fun resetCurrentWorkspaceProgress(confirmationText: String): CloudWorkspaceResetProgressResult
    suspend fun loadProgressSummary(timeZone: String): CloudProgressSummary
    suspend fun loadProgressSeries(timeZone: String, from: String, to: String): CloudProgressSeries
    suspend fun loadProgressReviewSchedule(timeZone: String): CloudProgressReviewSchedule
    suspend fun loadProgressLeaderboard(): CloudProgressLeaderboard
    suspend fun loadCommunityProfile(): CloudCommunityProfile
    suspend fun updateCommunityLeaderboardParticipation(
        leaderboardParticipationEnabled: Boolean
    ): CloudCommunityProfile
    suspend fun createFriendInvitation(request: CloudFriendInvitationCreateRequest): CloudFriendInvitationCreateResponse
    suspend fun deleteAccount(confirmationText: String)
    suspend fun listLinkedWorkspaces(): List<CloudWorkspaceSummary>
    suspend fun switchLinkedWorkspace(selection: CloudWorkspaceLinkSelection): CloudWorkspaceSummary
    suspend fun listAgentConnections(): AgentApiKeyConnectionsResult
    suspend fun revokeAgentConnection(connectionId: String): AgentApiKeyConnectionsResult
    suspend fun currentServerConfiguration(): CloudServiceConfiguration
    suspend fun validateCustomServer(customOrigin: String): CloudServiceConfiguration
    suspend fun applyCustomServer(configuration: CloudServiceConfiguration)
    suspend fun resetToOfficialServer()
}

data class AiChatPreparedRemoteSession(
    val workspaceId: String,
    val apiBaseUrl: String,
    val authorizationHeader: String
)

interface AiChatRepository {
    fun observeConsent(): Flow<Boolean>
    fun hasConsent(): Boolean
    fun updateConsent(hasConsent: Boolean)
    fun makeExplicitSessionId(): String
    suspend fun prepareSessionForAi(workspaceId: String?): AiChatPreparedRemoteSession
    suspend fun ensureReadyForSend(workspaceId: String?)
    suspend fun loadPersistedState(workspaceId: String?): AiChatPersistedState
    suspend fun savePersistedState(workspaceId: String?, state: AiChatPersistedState)
    suspend fun clearPersistedState(workspaceId: String?)
    suspend fun loadDraftState(workspaceId: String?, sessionId: String?): AiChatDraftState
    suspend fun saveDraftState(workspaceId: String?, sessionId: String?, state: AiChatDraftState)
    suspend fun clearDraftState(workspaceId: String?, sessionId: String?)
    suspend fun loadChatSnapshot(workspaceId: String?, sessionId: String?): AiChatSessionSnapshot?
    suspend fun ensureSessionId(
        workspaceId: String?,
        persistedState: AiChatPersistedState,
        provisionalSessionId: String?,
        uiLocale: String?
    ): AiChatSessionProvisioningResult
    suspend fun loadBootstrap(
        workspaceId: String?,
        sessionId: String,
        limit: Int,
        resumeDiagnostics: AiChatResumeDiagnostics?
    ): AiChatBootstrapResponse
    suspend fun loadBootstrapFromPreparedSession(
        preparedSession: AiChatPreparedRemoteSession,
        sessionId: String,
        limit: Int,
        resumeDiagnostics: AiChatResumeDiagnostics?
    ): AiChatBootstrapResponse
    suspend fun createNewSession(
        workspaceId: String?,
        sessionId: String,
        uiLocale: String?
    ): AiChatSessionSnapshot
    suspend fun createNewSessionFromPreparedSession(
        preparedSession: AiChatPreparedRemoteSession,
        sessionId: String,
        uiLocale: String?
    ): AiChatSessionSnapshot
    suspend fun transcribeAudio(
        workspaceId: String?,
        sessionId: String,
        fileName: String,
        mediaType: String,
        audioBytes: ByteArray
    ): AiChatTranscriptionResult
    suspend fun warmUpLinkedSession()
    suspend fun startRun(
        workspaceId: String?,
        state: AiChatPersistedState,
        content: List<com.flashcardsopensourceapp.data.local.model.ai.AiChatContentPart>,
        uiLocale: String?
    ): AiChatStartRunResponse
    fun attachLiveRun(
        workspaceId: String?,
        sessionId: String,
        runId: String,
        liveStream: AiChatLiveStreamEnvelope,
        afterCursor: String?,
        resumeDiagnostics: AiChatResumeDiagnostics?
    ): Flow<AiChatLiveEvent>
    suspend fun stopRun(workspaceId: String?, sessionId: String, runId: String?): AiChatStopRunResponse
}
