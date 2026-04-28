package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.ai.AiChatHistoryStore
import com.flashcardsopensourceapp.data.local.ai.AiChatDiagnosticsLogger
import com.flashcardsopensourceapp.data.local.ai.AiChatPreferencesStore
import com.flashcardsopensourceapp.data.local.ai.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.ai.AiChatRemoteService
import com.flashcardsopensourceapp.data.local.ai.makeAiChatHistoryScopedWorkspaceId
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.model.AiChatBootstrapResponse
import com.flashcardsopensourceapp.data.local.model.AiChatDraftState
import com.flashcardsopensourceapp.data.local.model.AiChatPersistedState
import com.flashcardsopensourceapp.data.local.model.AiChatLiveEvent
import com.flashcardsopensourceapp.data.local.model.AiChatLiveStreamEnvelope
import com.flashcardsopensourceapp.data.local.model.AiChatNewSessionRequest
import com.flashcardsopensourceapp.data.local.model.AiChatResumeDiagnostics
import com.flashcardsopensourceapp.data.local.model.AiChatSessionProvisioningResult
import com.flashcardsopensourceapp.data.local.model.AiChatSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.AiChatStopRunResponse
import com.flashcardsopensourceapp.data.local.model.AiChatStartRunRequest
import com.flashcardsopensourceapp.data.local.model.AiChatStartRunResponse
import com.flashcardsopensourceapp.data.local.model.AiChatTranscriptionResult
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.buildAiChatRequestContent
import com.flashcardsopensourceapp.data.local.model.shouldRefreshCloudIdToken
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.CloudRemoteGateway
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flow
import java.util.TimeZone
import java.util.UUID

private data class AuthorizedAiChatSession(
    val apiBaseUrl: String,
    val authorizationHeader: String
)

class LocalAiChatRepository(
    private val database: AppDatabase,
    private val preferencesStore: CloudPreferencesStore,
    private val cloudRemoteService: CloudRemoteGateway,
    private val cloudGuestSessionCoordinator: CloudGuestSessionCoordinator,
    private val syncRepository: SyncRepository,
    private val aiChatRemoteService: AiChatRemoteService,
    private val historyStore: AiChatHistoryStore,
    private val aiChatPreferencesStore: AiChatPreferencesStore
) : AiChatRepository {
    override fun observeConsent(): Flow<Boolean> {
        return aiChatPreferencesStore.observeConsent()
    }

    override fun hasConsent(): Boolean {
        return aiChatPreferencesStore.hasConsent()
    }

    override fun updateConsent(hasConsent: Boolean) {
        aiChatPreferencesStore.updateConsent(hasConsent = hasConsent)
    }

    override suspend fun prepareSessionForAi(workspaceId: String?) {
        authorizedSession(workspaceId = workspaceId)
    }

    override suspend fun ensureReadyForSend(workspaceId: String?) {
        syncRepository.syncNow()
        val hasPendingOutboxEntries = if (workspaceId == null) {
            database.outboxDao().countOutboxEntries() > 0
        } else {
            database.outboxDao().loadOutboxEntries(workspaceId = workspaceId, limit = 1).isNotEmpty()
        }
        require(hasPendingOutboxEntries.not()) {
            "AI chat could not start because local changes are still waiting to sync. Try again after sync finishes."
        }
    }

    override suspend fun loadPersistedState(workspaceId: String?): AiChatPersistedState {
        return historyStore.loadState(workspaceId = historyScopeId(workspaceId = workspaceId))
    }

    override suspend fun savePersistedState(workspaceId: String?, state: AiChatPersistedState) {
        historyStore.saveState(workspaceId = historyScopeId(workspaceId = workspaceId), state = state)
    }

    override suspend fun clearPersistedState(workspaceId: String?) {
        historyStore.clearState(workspaceId = historyScopeId(workspaceId = workspaceId))
    }

    override suspend fun loadDraftState(workspaceId: String?, sessionId: String?): AiChatDraftState {
        return historyStore.loadDraftState(
            workspaceId = historyScopeId(workspaceId = workspaceId),
            sessionId = sessionId
        )
    }

    override suspend fun saveDraftState(workspaceId: String?, sessionId: String?, state: AiChatDraftState) {
        historyStore.saveDraftState(
            workspaceId = historyScopeId(workspaceId = workspaceId),
            sessionId = sessionId,
            state = state
        )
    }

    override suspend fun clearDraftState(workspaceId: String?, sessionId: String?) {
        historyStore.clearDraftState(
            workspaceId = historyScopeId(workspaceId = workspaceId),
            sessionId = sessionId
        )
    }

    override suspend fun loadChatSnapshot(workspaceId: String?, sessionId: String?): AiChatSessionSnapshot? {
        val remoteWorkspaceId = requireRemoteWorkspaceId(workspaceId = workspaceId)
        val session = authorizedSession(workspaceId = remoteWorkspaceId)
        return try {
            aiChatRemoteService.loadSnapshot(
                apiBaseUrl = session.apiBaseUrl,
                authorizationHeader = session.authorizationHeader,
                sessionId = sessionId,
                workspaceId = remoteWorkspaceId
            )
        } catch (error: AiChatRemoteException) {
            if (error.statusCode == 404) {
                AiChatDiagnosticsLogger.warn(
                    event = "load_snapshot_missing_session",
                    fields = listOf(
                        "workspaceId" to workspaceId,
                        "sessionId" to sessionId,
                        "apiBaseUrl" to session.apiBaseUrl,
                        "requestId" to error.requestId,
                        "statusCode" to error.statusCode.toString(),
                        "code" to error.code,
                        "stage" to error.stage
                    )
                )
                null
            } else {
                AiChatDiagnosticsLogger.error(
                    event = "load_snapshot_failed",
                    fields = listOf(
                        "workspaceId" to workspaceId,
                        "sessionId" to sessionId,
                        "apiBaseUrl" to session.apiBaseUrl,
                        "requestId" to error.requestId,
                        "statusCode" to error.statusCode?.toString(),
                        "code" to error.code,
                        "stage" to error.stage,
                        "responseBody" to error.responseBody
                    ),
                    throwable = error
                )
                throw error
            }
        }
    }

    override suspend fun ensureSessionId(
        workspaceId: String?,
        persistedState: AiChatPersistedState,
        uiLocale: String?
    ): AiChatSessionProvisioningResult {
        val normalizedSessionId = resolveAiChatSessionIdOrNull(
            persistedState = persistedState
        )
        if (normalizedSessionId != null) {
            return AiChatSessionProvisioningResult(
                sessionId = normalizedSessionId,
                snapshot = null
            )
        }

        val explicitSessionId = UUID.randomUUID().toString().lowercase()
        val snapshot = createNewSession(
            workspaceId = workspaceId,
            sessionId = explicitSessionId,
            uiLocale = uiLocale
        )
        require(snapshot.sessionId == explicitSessionId) {
            "AI chat session provisioning returned mismatched sessionId. requestedSessionId=$explicitSessionId responseSessionId=${snapshot.sessionId}"
        }
        return AiChatSessionProvisioningResult(
            sessionId = explicitSessionId,
            snapshot = snapshot
        )
    }

    override suspend fun loadBootstrap(
        workspaceId: String?,
        sessionId: String,
        limit: Int,
        resumeDiagnostics: AiChatResumeDiagnostics?
    ): AiChatBootstrapResponse {
        val remoteWorkspaceId = requireRemoteWorkspaceId(workspaceId = workspaceId)
        val session = authorizedSession(workspaceId = remoteWorkspaceId)
        return aiChatRemoteService.loadBootstrap(
            apiBaseUrl = session.apiBaseUrl,
            authorizationHeader = session.authorizationHeader,
            sessionId = sessionId,
            limit = limit,
            workspaceId = remoteWorkspaceId,
            resumeDiagnostics = resumeDiagnostics
        )
    }

    override suspend fun createNewSession(
        workspaceId: String?,
        sessionId: String,
        uiLocale: String?
    ): AiChatSessionSnapshot {
        val remoteWorkspaceId = requireRemoteWorkspaceId(workspaceId = workspaceId)
        val session = authorizedSession(workspaceId = remoteWorkspaceId)
        return aiChatRemoteService.createNewSession(
            apiBaseUrl = session.apiBaseUrl,
            authorizationHeader = session.authorizationHeader,
            request = AiChatNewSessionRequest(
                sessionId = sessionId,
                workspaceId = remoteWorkspaceId,
                uiLocale = uiLocale
            )
        )
    }

    override suspend fun transcribeAudio(
        workspaceId: String?,
        sessionId: String,
        fileName: String,
        mediaType: String,
        audioBytes: ByteArray
    ): AiChatTranscriptionResult {
        val remoteWorkspaceId = requireRemoteWorkspaceId(workspaceId = workspaceId)
        val session = authorizedSession(workspaceId = remoteWorkspaceId)
        return aiChatRemoteService.transcribeAudio(
            apiBaseUrl = session.apiBaseUrl,
            authorizationHeader = session.authorizationHeader,
            sessionId = sessionId,
            workspaceId = remoteWorkspaceId,
            fileName = fileName,
            mediaType = mediaType,
            audioBytes = audioBytes
        )
    }

    override suspend fun warmUpLinkedSession() {
        val cloudSettings = preferencesStore.currentCloudSettings()
        require(cloudSettings.cloudState == CloudAccountState.LINKED) {
            "AI warm-up requires a linked cloud account."
        }
        val configuration = preferencesStore.currentServerConfiguration()
        val storedCredentials = requireNotNull(preferencesStore.loadCredentials()) {
            "Cloud account is not signed in."
        }

        refreshedCredentials(
            storedCredentials = storedCredentials,
            authBaseUrl = configuration.authBaseUrl
        )
    }

    override suspend fun startRun(
        workspaceId: String?,
        state: AiChatPersistedState,
        content: List<AiChatContentPart>,
        uiLocale: String?
    ): AiChatStartRunResponse {
        val remoteWorkspaceId = requireRemoteWorkspaceId(workspaceId = workspaceId)
        val session = authorizedSession(workspaceId = remoteWorkspaceId)
        val resolvedSessionId = requireExplicitAiChatSessionIdForRun(state = state)
        val request = AiChatStartRunRequest(
            sessionId = resolvedSessionId,
            workspaceId = remoteWorkspaceId,
            clientRequestId = java.util.UUID.randomUUID().toString().lowercase(),
            content = buildAiChatRequestContent(content = content),
            timezone = TimeZone.getDefault().id,
            uiLocale = uiLocale,
        )

        AiChatDiagnosticsLogger.info(
            event = "start_run_requested",
            fields = listOf(
                "workspaceId" to workspaceId,
                "chatSessionId" to request.sessionId,
                "apiBaseUrl" to session.apiBaseUrl,
                "messageCount" to state.messages.size.toString(),
                "contentSummary" to AiChatDiagnosticsLogger.summarizeOutgoingContent(content = content)
            )
        )

        return try {
            aiChatRemoteService.startRun(
                apiBaseUrl = session.apiBaseUrl,
                authorizationHeader = session.authorizationHeader,
                request = request
            )
        } catch (error: AiChatRemoteException) {
            AiChatDiagnosticsLogger.error(
                event = "start_run_failed",
                fields = listOf(
                    "workspaceId" to workspaceId,
                    "chatSessionId" to request.sessionId,
                    "apiBaseUrl" to session.apiBaseUrl,
                    "messageCount" to state.messages.size.toString(),
                    "contentSummary" to AiChatDiagnosticsLogger.summarizeOutgoingContent(content = content),
                    "requestId" to error.requestId,
                    "statusCode" to error.statusCode?.toString(),
                    "code" to error.code,
                    "stage" to error.stage,
                    "responseBody" to error.responseBody
                ),
                throwable = error
            )
            throw error
        }
    }

    override fun attachLiveRun(
        workspaceId: String?,
        sessionId: String,
        runId: String,
        liveStream: AiChatLiveStreamEnvelope,
        afterCursor: String?,
        resumeDiagnostics: AiChatResumeDiagnostics?
    ): Flow<AiChatLiveEvent> {
        return flow {
            val session = authorizedSession(workspaceId = workspaceId)
            emitAll(
                aiChatRemoteService.attachLiveRun(
                    apiBaseUrl = session.apiBaseUrl,
                    authorizationHeader = session.authorizationHeader,
                    sessionId = sessionId,
                    runId = runId,
                    liveStream = liveStream,
                    workspaceId = workspaceId,
                    afterCursor = afterCursor,
                    resumeDiagnostics = resumeDiagnostics
                )
            )
        }
    }

    override suspend fun stopRun(workspaceId: String?, sessionId: String): AiChatStopRunResponse {
        val remoteWorkspaceId = requireRemoteWorkspaceId(workspaceId = workspaceId)
        val session = authorizedSession(workspaceId = remoteWorkspaceId)
        return aiChatRemoteService.stopRun(
            apiBaseUrl = session.apiBaseUrl,
            authorizationHeader = session.authorizationHeader,
            sessionId = sessionId,
            workspaceId = remoteWorkspaceId
        )
    }

    private suspend fun authorizedSession(workspaceId: String?): AuthorizedAiChatSession {
        val reconciliation = cloudGuestSessionCoordinator.reconcilePersistedCloudState()
        val configuration = preferencesStore.currentServerConfiguration()
        if (reconciliation.cloudSettings.cloudState == CloudAccountState.LINKED) {
            val credentials = refreshedCredentials(
                storedCredentials = requireNotNull(preferencesStore.loadCredentials()) {
                    "Cloud account is not signed in."
                },
                authBaseUrl = configuration.authBaseUrl
            )
            return AuthorizedAiChatSession(
                apiBaseUrl = configuration.apiBaseUrl,
                authorizationHeader = "Bearer ${credentials.idToken}"
            )
        }

        val guestSession = if (reconciliation.cloudSettings.cloudState == CloudAccountState.GUEST) {
            GuestCloudSessionRestoreResult(
                session = requireNotNull(reconciliation.restoredGuestSession) {
                    "Guest cloud state is missing a stored guest session."
                },
                shouldSync = reconciliation.guestRestoreRequiresSync
            )
        } else {
            cloudGuestSessionCoordinator.restoreGuestCloudSessionIfNeeded(
                workspaceId = workspaceId,
                createSessionIfMissing = true
            )
        }
        if (guestSession.shouldSync) {
            syncRepository.syncNow()
        }
        return AuthorizedAiChatSession(
            apiBaseUrl = guestSession.session.apiBaseUrl,
            authorizationHeader = "Guest ${guestSession.session.guestToken}"
        )
    }

    private fun historyScopeId(workspaceId: String?): String {
        return makeAiChatHistoryScopedWorkspaceId(
            workspaceId = workspaceId,
            cloudSettings = preferencesStore.currentCloudSettings()
        )
    }

    private fun requireRemoteWorkspaceId(workspaceId: String?): String {
        return requireNotNull(workspaceId?.trim()?.ifEmpty { null }) {
            "AI remote request requires an active workspace. Reopen AI from a workspace and try again."
        }
    }

    private suspend fun refreshedCredentials(
        storedCredentials: StoredCloudCredentials,
        authBaseUrl: String
    ): StoredCloudCredentials {
        if (
            shouldRefreshCloudIdToken(
                idTokenExpiresAtMillis = storedCredentials.idTokenExpiresAtMillis,
                nowMillis = System.currentTimeMillis()
            ).not()
        ) {
            return storedCredentials
        }

        return cloudRemoteService.refreshIdToken(
            refreshToken = storedCredentials.refreshToken,
            authBaseUrl = authBaseUrl
        ).also(preferencesStore::saveCredentials)
    }
}

internal fun resolveAiChatSessionIdOrNull(
    persistedState: AiChatPersistedState
): String? {
    return persistedState.chatSessionId.trim().ifEmpty { null }
}

internal fun requireExplicitAiChatSessionIdForRun(
    state: AiChatPersistedState
): String {
    return requireNotNull(resolveAiChatSessionIdOrNull(persistedState = state)) {
        "AI chat session must be provisioned before starting a run."
    }
}
