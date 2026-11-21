package com.flashcardsopensourceapp.data.local.repository.ai

import com.flashcardsopensourceapp.data.local.ai.store.AiChatCustomInstructionsStore
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
import com.flashcardsopensourceapp.data.local.model.ai.AiChatImportRequest
import com.flashcardsopensourceapp.data.local.model.ai.AiImportTarget
import com.flashcardsopensourceapp.data.local.model.ai.AiImportTargetChangedException
import com.flashcardsopensourceapp.data.local.model.ai.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.ai.AiChatBootstrapResponse
import com.flashcardsopensourceapp.data.local.model.ai.AiChatCustomInstructions
import com.flashcardsopensourceapp.data.local.model.ai.AiChatCustomInstructionsScope
import com.flashcardsopensourceapp.data.local.model.ai.AiChatCustomInstructionsScopeChangedException
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
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.cloud.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.cloud.isSameCloudService
import com.flashcardsopensourceapp.data.local.model.sync.preservingLocalAccountIdentity
import com.flashcardsopensourceapp.data.local.model.ai.buildAiChatRequestContent
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.network.SignedPutUploader
import com.flashcardsopensourceapp.data.local.repository.AiChatPreparedImport
import com.flashcardsopensourceapp.data.local.repository.AiChatPreparedRemoteSession
import com.flashcardsopensourceapp.data.local.repository.AiChatRepository
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.CloudGuestSessionCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.GuestCloudSessionRestoreResult
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudOperationCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.refreshExpiredStoredCloudCredentials
import com.flashcardsopensourceapp.data.local.repository.cloudsync.workspace.loadCurrentWorkspaceOrNull
import com.flashcardsopensourceapp.data.local.repository.cloudsync.workspace.observeCurrentWorkspace
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
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
    private val operationCoordinator: CloudOperationCoordinator,
    private val syncRepository: SyncRepository,
    private val aiChatRemoteService: AiChatRemoteService,
    private val signedPutUploader: SignedPutUploader,
    private val historyStore: AiChatHistoryStore,
    private val aiChatPreferencesStore: AiChatPreferencesStore,
    private val ownOpenAiKeyStore: OwnOpenAiKeyStore
) : AiChatRepository {
    private val customInstructionsStore = AiChatCustomInstructionsStore()

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

    override suspend fun prepareImportSession(request: AiChatImportRequest): AiChatPreparedImport {
        val target = request.target
        val session = authorizedSession(workspaceId = target.workspaceId, importTarget = target)
        verifyImportAuthorization(target = target, session = session)
        return AiChatPreparedImport(
            request = request,
            remoteSession = AiChatPreparedRemoteSession(
                workspaceId = target.workspaceId,
                apiBaseUrl = session.apiBaseUrl,
                authorizationHeader = session.authorizationHeader
            )
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

    override suspend fun savePersistedState(
        workspaceId: String?,
        state: AiChatPersistedState,
        importRequest: AiChatImportRequest?
    ) {
        historyStore.saveState(
            workspaceId = historyScopeId(workspaceId = workspaceId, importTarget = importRequest?.target),
            state = state,
            importRequest = importRequest
        )
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

    override suspend fun saveDraftState(
        workspaceId: String?,
        sessionId: String?,
        state: AiChatDraftState
    ): Boolean {
        return historyStore.saveDraftState(
            workspaceId = historyScopeId(workspaceId = workspaceId, importTarget = state.importRequest?.target),
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

    override suspend fun saveImportState(state: AiChatPersistedState, draftState: AiChatDraftState) {
        val target = requireNotNull(draftState.importRequest).target
        historyStore.saveImportState(
            workspaceId = historyScopeId(workspaceId = target.workspaceId, importTarget = target),
            state = state,
            draftState = draftState
        )
    }

    override suspend fun finishImport(request: AiChatImportRequest, state: AiChatPersistedState?): Boolean {
        val target = request.target
        return historyStore.finishImport(
            workspaceId = historyScopeId(workspaceId = target.workspaceId, importTarget = target),
            request = request,
            state = state
        )
    }

    override suspend fun loadChatSnapshot(workspaceId: String?, sessionId: String?): AiChatSessionSnapshot? {
        val remoteWorkspaceId = requireRemoteWorkspaceId(workspaceId = workspaceId)
        val session = authorizedSession(workspaceId = remoteWorkspaceId)
        return try {
            recordingCustomInstructions(
                workspaceId = remoteWorkspaceId,
                request = {
                    aiChatRemoteService.loadSnapshot(
                        apiBaseUrl = session.apiBaseUrl,
                        authorizationHeader = session.authorizationHeader,
                        sessionId = sessionId,
                        workspaceId = remoteWorkspaceId
                    )
                },
                customInstructions = AiChatSessionSnapshot::customInstructions
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
        sessionId: String?,
        limit: Int,
        resumeDiagnostics: AiChatResumeDiagnostics?
    ): AiChatBootstrapResponse {
        return recordingCustomInstructions(
            workspaceId = preparedSession.workspaceId,
            request = {
                aiChatRemoteService.loadBootstrap(
                    apiBaseUrl = preparedSession.apiBaseUrl,
                    authorizationHeader = preparedSession.authorizationHeader,
                    sessionId = sessionId,
                    limit = limit,
                    workspaceId = preparedSession.workspaceId,
                    resumeDiagnostics = resumeDiagnostics
                )
            },
            customInstructions = AiChatBootstrapResponse::customInstructions
        )
    }

    override suspend fun loadCurrentBootstrap(workspaceId: String?, limit: Int): AiChatBootstrapResponse {
        val preparedSession = prepareSessionForAi(workspaceId = workspaceId)
        return loadBootstrapFromPreparedSession(
            preparedSession = preparedSession,
            sessionId = null,
            limit = limit,
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
        return recordingCustomInstructions(
            workspaceId = preparedSession.workspaceId,
            request = {
                aiChatRemoteService.createNewSession(
                    apiBaseUrl = preparedSession.apiBaseUrl,
                    authorizationHeader = preparedSession.authorizationHeader,
                    request = AiChatNewSessionRequest(
                        sessionId = sessionId,
                        workspaceId = preparedSession.workspaceId,
                        uiLocale = uiLocale
                    )
                )
            },
            customInstructions = AiChatSessionSnapshot::customInstructions
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
        uiLocale: String?,
        preparedImport: AiChatPreparedImport?
    ): AiChatStartRunResponse {
        val importRequest = preparedImport?.request
        val importTarget = importRequest?.target
        val remoteWorkspaceId = requireRemoteWorkspaceId(workspaceId = workspaceId)
        val resolvedSessionId = requireExplicitAiChatSessionIdForRun(state = state)
        if (
            importRequest != null &&
            (importRequest.sessionId != resolvedSessionId ||
                importRequest.target.workspaceId != remoteWorkspaceId ||
                importRequest.matchesDraft(message = draftMessage, attachments = pendingAttachments).not())
        ) {
            throw AiImportTargetChangedException()
        }
        val uploadSession = if (preparedImport == null) {
            authorizedSession(workspaceId = remoteWorkspaceId)
        } else {
            AuthorizedAiChatSession(
                apiBaseUrl = preparedImport.remoteSession.apiBaseUrl,
                authorizationHeader = preparedImport.remoteSession.authorizationHeader
            )
        }
        val uploadIdsByAttachmentId = uploadAttachments(
            session = uploadSession,
            pendingAttachments = pendingAttachments,
            importTarget = importTarget
        )
        val request = AiChatStartRunRequest(
            sessionId = resolvedSessionId,
            workspaceId = remoteWorkspaceId,
            clientRequestId = importRequest?.clientRequestId ?: UUID.randomUUID().toString().lowercase(),
            content = buildAiChatRequestContent(
                draftMessage = draftMessage,
                pendingAttachments = pendingAttachments,
                uploadIdsByAttachmentId = uploadIdsByAttachmentId
            ),
            timezone = TimeZone.getDefault().id,
            uiLocale = uiLocale,
        )

        // Uploads can outlast the token. Reauthorize the same target just before dispatch.
        val session = authorizedSession(workspaceId = remoteWorkspaceId, importTarget = importTarget)
        if (importTarget != null && session != uploadSession) {
            verifyImportAuthorization(target = importTarget, session = session)
        }
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
            val response = recordingCustomInstructions(
                workspaceId = remoteWorkspaceId,
                request = {
                    startRunRetryingTimeout(session = session, request = request, importTarget = importTarget)
                },
                customInstructions = AiChatStartRunResponse::customInstructions
            )
            if (importRequest != null && response.sessionId != importRequest.sessionId) {
                throw AiImportTargetChangedException()
            }
            response
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
        request: AiChatStartRunRequest,
        importTarget: AiImportTarget?
    ): AiChatStartRunResponse {
        suspend fun startRunAttempt(): AiChatStartRunResponse {
            val ownOpenAiKey = ownOpenAiKeyStore.activeApiKeyOrNull()
            if (importTarget != null) {
                operationCoordinator.runExclusive {
                    requireCurrentImportTarget(target = importTarget)
                }
            }
            return aiChatRemoteService.startRun(
                apiBaseUrl = session.apiBaseUrl,
                authorizationHeader = session.authorizationHeader,
                ownOpenAiKey = ownOpenAiKey,
                request = request
            )
        }

        for (attemptNumber in 1 until aiChatStartRunMaximumAttemptCount) {
            try {
                return startRunAttempt()
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

        return startRunAttempt()
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
        pendingAttachments: List<AiChatAttachment>,
        importTarget: AiImportTarget?
    ): Map<String, String> {
        return pendingAttachments.filterIsInstance<AiChatAttachment.Binary>().associate { attachment ->
            if (importTarget != null) {
                operationCoordinator.runExclusive {
                    requireCurrentImportTarget(target = importTarget)
                }
            }
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

    override fun observeCustomInstructions(workspaceId: String): Flow<String?> {
        return customInstructionsStore.observe(scopeId = historyScopeId(workspaceId = workspaceId))
    }

    override fun observeCustomInstructionsScope(): Flow<AiChatCustomInstructionsScope?> {
        return combine(
            observeCurrentWorkspace(database = database, preferencesStore = preferencesStore),
            preferencesStore.observeCloudSettings()
        ) { workspace, cloudSettings ->
            workspace?.let { current -> customInstructionsScope(workspaceId = current.workspaceId, cloudSettings = cloudSettings) }
        }.distinctUntilChanged()
    }

    override suspend fun loadCurrentCustomInstructions(): Pair<AiChatCustomInstructionsScope, AiChatCustomInstructions> {
        val scope = currentCustomInstructionsScopeOrNull() ?: throw AiChatCustomInstructionsScopeChangedException()
        val session = authorizedCustomInstructionsSession(scope = scope)
        val observedAt = customInstructionsStore.stamp()
        val instructions = aiChatRemoteService.loadCustomInstructions(
            apiBaseUrl = session.apiBaseUrl,
            authorizationHeader = session.authorizationHeader,
            workspaceId = scope.workspaceId
        )
        customInstructionsStore.record(
            scopeId = scope.scopeId,
            observedAt = observedAt,
            customInstructions = instructions.customInstructions
        )
        return scope to instructions
    }

    override suspend fun saveCustomInstructions(
        scope: AiChatCustomInstructionsScope,
        customInstructions: String
    ): AiChatCustomInstructions {
        val session = authorizedCustomInstructionsSession(scope = scope)
        val saved = aiChatRemoteService.saveCustomInstructions(
            apiBaseUrl = session.apiBaseUrl,
            authorizationHeader = session.authorizationHeader,
            workspaceId = scope.workspaceId,
            customInstructions = customInstructions.takeIf(String::isNotBlank)
        )
        customInstructionsStore.record(
            scopeId = scope.scopeId,
            observedAt = customInstructionsStore.stamp(),
            customInstructions = saved.customInstructions
        )
        return saved
    }

    private suspend fun currentCustomInstructionsScopeOrNull(): AiChatCustomInstructionsScope? {
        val workspaceId = loadCurrentWorkspaceOrNull(database = database, preferencesStore = preferencesStore)
            ?.workspaceId
            ?: return null
        return customInstructionsScope(workspaceId = workspaceId, cloudSettings = preferencesStore.currentCloudSettings())
    }

    private fun customInstructionsScope(workspaceId: String, cloudSettings: CloudSettings): AiChatCustomInstructionsScope? {
        if (cloudSettings.cloudState != CloudAccountState.LINKED || cloudSettings.linkedUserId == null) {
            return null
        }
        return AiChatCustomInstructionsScope(
            workspaceId = workspaceId,
            scopeId = makeAiChatHistoryScopedWorkspaceId(workspaceId = workspaceId, cloudSettings = cloudSettings)
        )
    }

    private suspend fun authorizedCustomInstructionsSession(
        scope: AiChatCustomInstructionsScope
    ): AuthorizedAiChatSession = operationCoordinator.runExclusive {
        requireCurrentCustomInstructionsScope(scope = scope)
        val session = loadLinkedAiChatSession()
        requireCurrentCustomInstructionsScope(scope = scope)
        session
    }

    private suspend fun requireCurrentCustomInstructionsScope(scope: AiChatCustomInstructionsScope) {
        if (currentCustomInstructionsScopeOrNull() != scope) {
            throw AiChatCustomInstructionsScopeChangedException()
        }
    }

    /** Records the workspace's custom instructions carried by a chat response, stamped when its request started. */
    private suspend fun <T> recordingCustomInstructions(
        workspaceId: String,
        request: suspend () -> T,
        customInstructions: (T) -> String?
    ): T {
        val scopeId = historyScopeId(workspaceId = workspaceId)
        val observedAt = customInstructionsStore.stamp()
        val response = request()
        customInstructionsStore.record(
            scopeId = scopeId,
            observedAt = observedAt,
            customInstructions = customInstructions(response)
        )
        return response
    }

    private suspend fun authorizedSession(workspaceId: String?): AuthorizedAiChatSession {
        return authorizedSession(workspaceId = workspaceId, importTarget = null)
    }

    private suspend fun authorizedSession(
        workspaceId: String?,
        importTarget: AiImportTarget?
    ): AuthorizedAiChatSession = operationCoordinator.runExclusive {
        if (importTarget != null) {
            requireCurrentImportTarget(target = importTarget)
        }
        val reconciliation = cloudGuestSessionCoordinator.reconcilePersistedCloudState()
        if (importTarget != null) {
            requireCurrentImportTarget(target = importTarget)
        }
        if (reconciliation.cloudSettings.cloudState == CloudAccountState.LINKED) {
            return@runExclusive loadLinkedAiChatSession()
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
        if (
            importTarget != null &&
            (guestSession.session.userId != importTarget.linkedUserId ||
                guestSession.session.workspaceId != importTarget.workspaceId ||
                isSameCloudService(
                    leftMode = guestSession.session.configurationMode,
                    leftApiBaseUrl = guestSession.session.apiBaseUrl,
                    rightMode = importTarget.configuration.mode,
                    rightApiBaseUrl = importTarget.configuration.apiBaseUrl
                ).not())
        ) {
            throw AiImportTargetChangedException()
        }
        if (guestSession.shouldSync) {
            syncRepository.syncNow()
        }
        AuthorizedAiChatSession(
            apiBaseUrl = guestSession.session.apiBaseUrl,
            authorizationHeader = "Guest ${guestSession.session.guestToken}"
        )
    }

    private suspend fun loadLinkedAiChatSession(): AuthorizedAiChatSession {
        val configuration = preferencesStore.currentServerConfiguration()
        val credentials = refreshedCredentials(
            storedCredentials = requireNotNull(
                withContext(Dispatchers.IO) { preferencesStore.loadCredentials() }
            ) {
                "Cloud account is not signed in."
            },
            authBaseUrl = configuration.authBaseUrl
        )
        return AuthorizedAiChatSession(
            apiBaseUrl = configuration.apiBaseUrl,
            authorizationHeader = "Bearer ${credentials.idToken}"
        )
    }

    private suspend fun verifyImportAuthorization(
        target: AiImportTarget,
        session: AuthorizedAiChatSession
    ) {
        if (target.cloudState == CloudAccountState.LINKED) {
            val settings = preferencesStore.currentCloudSettings()
            val account = cloudRemoteService.fetchCloudAccount(
                apiBaseUrl = session.apiBaseUrl,
                authorizationHeader = session.authorizationHeader
            ).preservingLocalAccountIdentity(settings = settings)
            if (account.userId != target.linkedUserId) {
                throw AiImportTargetChangedException()
            }
        }
        operationCoordinator.runExclusive {
            requireCurrentImportTarget(target = target)
        }
    }

    private suspend fun requireCurrentImportTarget(target: AiImportTarget) {
        val current = preferencesStore.currentCloudSettings()
        if (
            target.linkedUserId == null ||
            (target.cloudState != CloudAccountState.LINKED && target.cloudState != CloudAccountState.GUEST) ||
            current.cloudState != target.cloudState || current.linkedUserId != target.linkedUserId ||
            current.installationId != target.installationId || current.activeWorkspaceId != target.workspaceId ||
            preferencesStore.currentServerConfiguration() != target.configuration ||
            database.workspaceDao().loadWorkspaceById(workspaceId = target.workspaceId) == null
        ) {
            throw AiImportTargetChangedException()
        }
    }

    private fun historyScopeId(workspaceId: String?): String {
        return historyScopeId(workspaceId = workspaceId, importTarget = null)
    }

    private fun historyScopeId(workspaceId: String?, importTarget: AiImportTarget?): String {
        val currentSettings = preferencesStore.currentCloudSettings()
        return makeAiChatHistoryScopedWorkspaceId(
            workspaceId = workspaceId,
            cloudSettings = if (importTarget == null) {
                currentSettings
            } else {
                require(workspaceId == importTarget.workspaceId) { "Import draft does not match the requested workspace." }
                currentSettings.copy(
                    cloudState = importTarget.cloudState,
                    linkedUserId = importTarget.linkedUserId,
                    activeWorkspaceId = importTarget.workspaceId
                )
            }
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
        return refreshExpiredStoredCloudCredentials(
            storedCredentials = storedCredentials,
            authBaseUrl = authBaseUrl,
            preferencesStore = preferencesStore,
            remoteService = cloudRemoteService,
            operationCoordinator = operationCoordinator
        )
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
