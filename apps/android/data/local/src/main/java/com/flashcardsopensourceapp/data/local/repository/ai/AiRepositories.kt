package com.flashcardsopensourceapp.data.local.repository.ai

import com.flashcardsopensourceapp.data.local.ai.store.AiChatHistoryStore
import com.flashcardsopensourceapp.data.local.ai.diagnostics.AiChatDiagnosticsLogger
import com.flashcardsopensourceapp.data.local.ai.store.AiChatPreferencesStore
import com.flashcardsopensourceapp.data.local.ai.store.OwnOpenAiKeyStore
import com.flashcardsopensourceapp.data.local.ai.remote.AiChatAttachmentFileMissingException
import com.flashcardsopensourceapp.data.local.ai.remote.AiChatAttachmentUploadException
import com.flashcardsopensourceapp.data.local.ai.remote.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.ai.remote.AiChatRemoteService
import com.flashcardsopensourceapp.data.local.ai.store.makeAiChatHistoryScopedWorkspaceId
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.model.ai.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.ai.AiChatBootstrapResponse
import com.flashcardsopensourceapp.data.local.model.ai.AiChatDraftState
import com.flashcardsopensourceapp.data.local.model.ai.AiChatPersistedState
import com.flashcardsopensourceapp.data.local.model.ai.AiChatLiveEvent
import com.flashcardsopensourceapp.data.local.model.ai.AiChatLiveStreamEnvelope
import com.flashcardsopensourceapp.data.local.model.ai.AiChatNewSessionRequest
import com.flashcardsopensourceapp.data.local.model.ai.AiChatResumeDiagnostics
import com.flashcardsopensourceapp.data.local.model.ai.AiChatSessionHistoryPage
import com.flashcardsopensourceapp.data.local.model.ai.AiChatSessionHistorySummary
import com.flashcardsopensourceapp.data.local.model.ai.AiChatSessionProvisioningResult
import com.flashcardsopensourceapp.data.local.model.ai.AiChatSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.ai.AiChatStopRunRequest
import com.flashcardsopensourceapp.data.local.model.ai.AiChatStopRunResponse
import com.flashcardsopensourceapp.data.local.model.ai.AiChatStartRunRequest
import com.flashcardsopensourceapp.data.local.model.ai.AiChatStartRunResponse
import com.flashcardsopensourceapp.data.local.model.ai.AiChatTranscriptionResult
import com.flashcardsopensourceapp.data.local.model.ai.AiUsageStatus
import com.flashcardsopensourceapp.data.local.model.ai.OwnOpenAiKeySettings
import com.flashcardsopensourceapp.data.local.model.ai.aiChatSessionsPageLimit
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.ai.buildAiChatRequestContent
import com.flashcardsopensourceapp.data.local.model.cloud.shouldRefreshCloudIdToken
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.network.SignedPutUploader
import com.flashcardsopensourceapp.data.local.repository.AiChatPreparedRemoteSession
import com.flashcardsopensourceapp.data.local.repository.AiChatRepository
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.CloudGuestSessionCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.GuestCloudSessionRestoreResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException
import java.net.SocketTimeoutException
import java.util.TimeZone
import java.util.UUID

private const val aiChatStartRunMaximumAttemptCount: Int = 2
private const val aiChatGatewayTimeoutStatusCode: Int = 504

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
    private val signedPutUploader: SignedPutUploader,
    private val historyStore: AiChatHistoryStore,
    private val aiChatPreferencesStore: AiChatPreferencesStore,
    private val ownOpenAiKeyStore: OwnOpenAiKeyStore
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

    override fun observeComposerSuggestionsEnabled(): Flow<Boolean> {
        return aiChatPreferencesStore.observeComposerSuggestionsEnabled()
    }

    override fun areComposerSuggestionsEnabled(): Boolean {
        return aiChatPreferencesStore.areComposerSuggestionsEnabled()
    }

    override fun updateComposerSuggestionsEnabled(isEnabled: Boolean) {
        aiChatPreferencesStore.updateComposerSuggestionsEnabled(isEnabled = isEnabled)
    }

    override fun observeOwnOpenAiKeySettings(): Flow<OwnOpenAiKeySettings> {
        return ownOpenAiKeyStore.observeSettings()
    }

    override fun currentOwnOpenAiKeySettings(): OwnOpenAiKeySettings {
        return ownOpenAiKeyStore.observeSettings().value
    }

    override fun isOwnOpenAiKeyActive(): Boolean {
        return ownOpenAiKeyStore.isActive()
    }

    override fun updateOwnOpenAiKeyEnabled(isEnabled: Boolean) {
        ownOpenAiKeyStore.updateEnabled(isEnabled = isEnabled)
    }

    override fun updateOwnOpenAiKey(apiKey: String) {
        ownOpenAiKeyStore.updateApiKey(apiKey = apiKey)
    }

    override suspend fun loadAiUsage(workspaceId: String?): AiUsageStatus {
        val session = authorizedSession(workspaceId = workspaceId)
        return aiChatRemoteService.loadAiUsage(
            apiBaseUrl = session.apiBaseUrl,
            authorizationHeader = session.authorizationHeader
        )
    }

    override fun makeExplicitSessionId(): String {
        return UUID.randomUUID().toString().lowercase()
    }

    override suspend fun prepareSessionForAi(workspaceId: String?): AiChatPreparedRemoteSession {
        val remoteWorkspaceId = requireRemoteWorkspaceId(workspaceId = workspaceId)
        val session = authorizedSession(workspaceId = remoteWorkspaceId)
        return AiChatPreparedRemoteSession(
            workspaceId = remoteWorkspaceId,
            apiBaseUrl = session.apiBaseUrl,
            authorizationHeader = session.authorizationHeader
        )
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
                        "stage" to error.stage
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
        provisionalSessionId: String?,
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

        val explicitSessionId = provisionalSessionId ?: makeExplicitSessionId()
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
        val preparedSession = prepareSessionForAi(workspaceId = workspaceId)
        return loadBootstrapFromPreparedSession(
            preparedSession = preparedSession,
            sessionId = sessionId,
            limit = limit,
            resumeDiagnostics = resumeDiagnostics
        )
    }

    override suspend fun loadBootstrapFromPreparedSession(
        preparedSession: AiChatPreparedRemoteSession,
        sessionId: String,
        limit: Int,
        resumeDiagnostics: AiChatResumeDiagnostics?
    ): AiChatBootstrapResponse {
        return aiChatRemoteService.loadBootstrap(
            apiBaseUrl = preparedSession.apiBaseUrl,
            authorizationHeader = preparedSession.authorizationHeader,
            sessionId = sessionId,
            limit = limit,
            workspaceId = preparedSession.workspaceId,
            resumeDiagnostics = resumeDiagnostics
        )
    }

    override suspend fun loadCurrentBootstrap(workspaceId: String?, limit: Int): AiChatBootstrapResponse {
        val preparedSession = prepareSessionForAi(workspaceId = workspaceId)
        return aiChatRemoteService.loadBootstrap(
            apiBaseUrl = preparedSession.apiBaseUrl,
            authorizationHeader = preparedSession.authorizationHeader,
            sessionId = null,
            limit = limit,
            workspaceId = preparedSession.workspaceId,
            resumeDiagnostics = null
        )
    }

    override suspend fun createNewSession(
        workspaceId: String?,
        sessionId: String,
        uiLocale: String?
    ): AiChatSessionSnapshot {
        val preparedSession = prepareSessionForAi(workspaceId = workspaceId)
        return createNewSessionFromPreparedSession(
            preparedSession = preparedSession,
            sessionId = sessionId,
            uiLocale = uiLocale
        )
    }

    override suspend fun createNewSessionFromPreparedSession(
        preparedSession: AiChatPreparedRemoteSession,
        sessionId: String,
        uiLocale: String?
    ): AiChatSessionSnapshot {
        return aiChatRemoteService.createNewSession(
            apiBaseUrl = preparedSession.apiBaseUrl,
            authorizationHeader = preparedSession.authorizationHeader,
            request = AiChatNewSessionRequest(
                sessionId = sessionId,
                workspaceId = preparedSession.workspaceId,
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
            ownOpenAiKey = ownOpenAiKeyStore.activeApiKeyOrNull(),
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
        draftMessage: String,
        pendingAttachments: List<AiChatAttachment>,
        uiLocale: String?
    ): AiChatStartRunResponse {
        val remoteWorkspaceId = requireRemoteWorkspaceId(workspaceId = workspaceId)
        val resolvedSessionId = requireExplicitAiChatSessionIdForRun(state = state)
        val uploadIdsByAttachmentId = uploadAttachments(
            session = authorizedSession(workspaceId = remoteWorkspaceId),
            pendingAttachments = pendingAttachments
        )
        // Uploads can outlast an ID token, so the turn itself asks for a fresh one.
        val session = authorizedSession(workspaceId = remoteWorkspaceId)
        val request = AiChatStartRunRequest(
            sessionId = resolvedSessionId,
            workspaceId = remoteWorkspaceId,
            clientRequestId = java.util.UUID.randomUUID().toString().lowercase(),
            content = buildAiChatRequestContent(
                draftMessage = draftMessage,
                pendingAttachments = pendingAttachments,
                uploadIdsByAttachmentId = uploadIdsByAttachmentId
            ),
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
                "contentSummary" to AiChatDiagnosticsLogger.summarizeOutgoingContent(content = request.content)
            )
        )

        return try {
            startRunRetryingTimeout(session = session, request = request)
        } catch (error: AiChatRemoteException) {
            AiChatDiagnosticsLogger.error(
                event = "start_run_failed",
                fields = listOf(
                    "workspaceId" to workspaceId,
                    "chatSessionId" to request.sessionId,
                    "apiBaseUrl" to session.apiBaseUrl,
                    "messageCount" to state.messages.size.toString(),
                    "contentSummary" to AiChatDiagnosticsLogger.summarizeOutgoingContent(content = request.content),
                    "requestId" to error.requestId,
                    "statusCode" to error.statusCode?.toString(),
                    "code" to error.code,
                    "stage" to error.stage
                ),
                throwable = error
            )
            throw error
        }
    }

    /**
     * A timed-out `POST /chat` may still have been accepted, so the retry repeats its clientRequestId
     * and the backend replays that turn instead of starting a second one. The gateway answers 504 at
     * its integration timeout, well before the client's own read timeout, while the Lambda keeps running.
     */
    private suspend fun startRunRetryingTimeout(
        session: AuthorizedAiChatSession,
        request: AiChatStartRunRequest
    ): AiChatStartRunResponse {
        for (attemptNumber in 1 until aiChatStartRunMaximumAttemptCount) {
            try {
                return aiChatRemoteService.startRun(
                    apiBaseUrl = session.apiBaseUrl,
                    authorizationHeader = session.authorizationHeader,
                    ownOpenAiKey = ownOpenAiKeyStore.activeApiKeyOrNull(),
                    request = request
                )
            } catch (error: SocketTimeoutException) {
                warnStartRunTimeoutRetry(
                    request = request,
                    attemptNumber = attemptNumber,
                    statusCode = null,
                    error = error
                )
            } catch (error: AiChatRemoteException) {
                if (error.statusCode != aiChatGatewayTimeoutStatusCode) {
                    throw error
                }
                warnStartRunTimeoutRetry(
                    request = request,
                    attemptNumber = attemptNumber,
                    statusCode = error.statusCode,
                    error = error
                )
            }
        }

        return aiChatRemoteService.startRun(
            apiBaseUrl = session.apiBaseUrl,
            authorizationHeader = session.authorizationHeader,
            ownOpenAiKey = ownOpenAiKeyStore.activeApiKeyOrNull(),
            request = request
        )
    }

    private fun warnStartRunTimeoutRetry(
        request: AiChatStartRunRequest,
        attemptNumber: Int,
        statusCode: Int?,
        error: Exception
    ) {
        AiChatDiagnosticsLogger.warn(
            event = "start_run_timeout_retry",
            fields = listOf(
                "chatSessionId" to request.sessionId,
                "clientRequestId" to request.clientRequestId,
                "attemptNumber" to attemptNumber.toString(),
                "statusCode" to statusCode?.toString(),
                "message" to error.message
            )
        )
    }

    /** Uploads the files of one turn in order and returns each upload id by attachment id. */
    private suspend fun uploadAttachments(
        session: AuthorizedAiChatSession,
        pendingAttachments: List<AiChatAttachment>
    ): Map<String, String> {
        return pendingAttachments.filterIsInstance<AiChatAttachment.Binary>().associate { attachment ->
            attachment.id to uploadAttachment(session = session, attachment = attachment)
        }
    }

    private suspend fun uploadAttachment(
        session: AuthorizedAiChatSession,
        attachment: AiChatAttachment.Binary
    ): String {
        val bytes = readAttachmentBytes(attachment = attachment)
        val upload = aiChatRemoteService.createFileUpload(
            apiBaseUrl = session.apiBaseUrl,
            authorizationHeader = session.authorizationHeader,
            fileName = attachment.fileName,
            mediaType = attachment.mediaType,
            sizeBytes = bytes.size.toLong()
        )
        try {
            signedPutUploader.uploadSignedPut(
                url = upload.url,
                headers = upload.headers,
                bodyBytes = bytes
            )
        } catch (error: IOException) {
            throw AiChatAttachmentUploadException(
                fileName = attachment.fileName,
                uploadFailure = error
            )
        }
        return upload.uploadId
    }

    private suspend fun readAttachmentBytes(attachment: AiChatAttachment.Binary): ByteArray {
        return withContext(Dispatchers.IO) {
            try {
                File(attachment.localFilePath).readBytes()
            } catch (error: FileNotFoundException) {
                throw AiChatAttachmentFileMissingException(
                    fileName = attachment.fileName,
                    cause = error
                )
            }
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

    override suspend fun stopRun(workspaceId: String?, sessionId: String, runId: String?): AiChatStopRunResponse {
        val remoteWorkspaceId = requireRemoteWorkspaceId(workspaceId = workspaceId)
        val session = authorizedSession(workspaceId = remoteWorkspaceId)
        return aiChatRemoteService.stopRun(
            apiBaseUrl = session.apiBaseUrl,
            authorizationHeader = session.authorizationHeader,
            request = AiChatStopRunRequest(
                sessionId = sessionId,
                workspaceId = remoteWorkspaceId,
                runId = runId
            )
        )
    }

    override suspend fun listChatSessions(
        workspaceId: String,
        cursor: String?,
        searchText: String?
    ): AiChatSessionHistoryPage {
        val session = authorizedSession(workspaceId = workspaceId)
        return aiChatRemoteService.listSessions(
            apiBaseUrl = session.apiBaseUrl,
            authorizationHeader = session.authorizationHeader,
            workspaceId = workspaceId,
            cursor = cursor,
            searchText = searchText,
            limit = aiChatSessionsPageLimit
        )
    }

    override suspend fun renameChatSession(
        workspaceId: String,
        sessionId: String,
        title: String
    ): AiChatSessionHistorySummary {
        val session = authorizedSession(workspaceId = workspaceId)
        return aiChatRemoteService.renameSession(
            apiBaseUrl = session.apiBaseUrl,
            authorizationHeader = session.authorizationHeader,
            workspaceId = workspaceId,
            sessionId = sessionId,
            title = title
        )
    }

    override suspend fun archiveChatSession(workspaceId: String, sessionId: String) {
        val session = authorizedSession(workspaceId = workspaceId)
        val archivedSession = aiChatRemoteService.archiveSession(
            apiBaseUrl = session.apiBaseUrl,
            authorizationHeader = session.authorizationHeader,
            workspaceId = workspaceId,
            sessionId = sessionId
        )
        require(archivedSession.sessionId == sessionId) {
            "AI chat archive returned mismatched sessionId. requestedSessionId=$sessionId responseSessionId=${archivedSession.sessionId}"
        }
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
