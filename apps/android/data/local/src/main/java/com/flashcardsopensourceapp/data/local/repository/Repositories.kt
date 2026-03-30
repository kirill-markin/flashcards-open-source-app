package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.model.AppMetadataSummary
import com.flashcardsopensourceapp.data.local.model.AiChatPersistedState
import com.flashcardsopensourceapp.data.local.model.AiChatSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.AiChatStreamEvent
import com.flashcardsopensourceapp.data.local.model.AiChatStreamOutcome
import com.flashcardsopensourceapp.data.local.model.AiChatTranscriptionResult
import com.flashcardsopensourceapp.data.local.model.CardDraft
import com.flashcardsopensourceapp.data.local.model.CardFilter
import com.flashcardsopensourceapp.data.local.model.CardSummary
import com.flashcardsopensourceapp.data.local.model.CloudSendCodeResult
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkContext
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.CloudSettings
import com.flashcardsopensourceapp.data.local.model.CloudOtpChallenge
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceDeletePreview
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceDeleteResult
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.AgentApiKeyConnection
import com.flashcardsopensourceapp.data.local.model.AgentApiKeyConnectionsResult
import com.flashcardsopensourceapp.data.local.model.AccountDeletionState
import com.flashcardsopensourceapp.data.local.model.DeckDraft
import com.flashcardsopensourceapp.data.local.model.DeckSummary
import com.flashcardsopensourceapp.data.local.model.DeviceDiagnosticsSummary
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.ReviewRating
import com.flashcardsopensourceapp.data.local.model.ReviewSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.ReviewTimelinePage
import com.flashcardsopensourceapp.data.local.model.SyncStatusSnapshot
import com.flashcardsopensourceapp.data.local.model.WorkspaceExportData
import com.flashcardsopensourceapp.data.local.model.WorkspaceOverviewSummary
import com.flashcardsopensourceapp.data.local.model.WorkspaceSchedulerSettings
import com.flashcardsopensourceapp.data.local.model.WorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.WorkspaceTagsSummary
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
    suspend fun createDeck(deckDraft: DeckDraft)
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
        pendingReviewedCardIds: Set<String>
    ): Flow<ReviewSessionSnapshot>

    suspend fun loadReviewTimelinePage(
        selectedFilter: ReviewFilter,
        pendingReviewedCardIds: Set<String>,
        offset: Int,
        limit: Int
    ): ReviewTimelinePage

    suspend fun recordReview(cardId: String, rating: ReviewRating, reviewedAtMillis: Long)
}

interface SyncRepository {
    fun observeSyncStatus(): Flow<SyncStatusSnapshot>
    suspend fun scheduleSync()
    suspend fun syncNow()
}

interface CloudAccountRepository {
    fun observeCloudSettings(): Flow<CloudSettings>
    fun observeAccountDeletionState(): Flow<AccountDeletionState>
    fun observeServerConfiguration(): Flow<CloudServiceConfiguration>
    suspend fun beginAccountDeletion()
    suspend fun resumePendingAccountDeletionIfNeeded()
    suspend fun retryPendingAccountDeletion()
    suspend fun sendCode(email: String): CloudSendCodeResult
    suspend fun prepareVerifiedSignIn(credentials: StoredCloudCredentials): CloudWorkspaceLinkContext
    suspend fun verifyCode(challenge: CloudOtpChallenge, code: String): CloudWorkspaceLinkContext
    suspend fun completeCloudLink(selection: CloudWorkspaceLinkSelection): CloudWorkspaceSummary
    suspend fun completeGuestUpgrade(selection: CloudWorkspaceLinkSelection): CloudWorkspaceSummary
    suspend fun completeLinkedWorkspaceTransition(selection: CloudWorkspaceLinkSelection): CloudWorkspaceSummary
    suspend fun logout()
    suspend fun renameCurrentWorkspace(name: String): CloudWorkspaceSummary
    suspend fun loadCurrentWorkspaceDeletePreview(): CloudWorkspaceDeletePreview
    suspend fun deleteCurrentWorkspace(confirmationText: String): CloudWorkspaceDeleteResult
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

interface AiChatRepository {
    fun observeConsent(): Flow<Boolean>
    fun hasConsent(): Boolean
    fun updateConsent(hasConsent: Boolean)
    suspend fun prepareSessionForAi(workspaceId: String?)
    suspend fun loadPersistedState(workspaceId: String?): AiChatPersistedState
    suspend fun savePersistedState(workspaceId: String?, state: AiChatPersistedState)
    suspend fun clearPersistedState(workspaceId: String?)
    suspend fun loadChatSnapshot(workspaceId: String?, sessionId: String?): AiChatSessionSnapshot?
    suspend fun resetSession(workspaceId: String?, sessionId: String?): AiChatSessionSnapshot
    suspend fun transcribeAudio(
        workspaceId: String?,
        sessionId: String?,
        fileName: String,
        mediaType: String,
        audioBytes: ByteArray
    ): AiChatTranscriptionResult
    suspend fun warmUpLinkedSession()
    suspend fun startRun(
        workspaceId: String?,
        state: AiChatPersistedState,
        content: List<com.flashcardsopensourceapp.data.local.model.AiChatContentPart>,
        onEvent: suspend (AiChatStreamEvent) -> Unit
    ): AiChatStreamOutcome
}
