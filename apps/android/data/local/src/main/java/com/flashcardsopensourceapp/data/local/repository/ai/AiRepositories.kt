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
import com.flashcardsopensourceapp.data.local.model.ai.StoredGuestAiSession
import com.flashcardsopensourceapp.data.local.model.ai.aiChatSessionsPageLimit
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
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
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
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

    override suspend fun prepareSessionForAi(workspaceId: String?): AiChatPreparedRemoteSession =
        operationCoordinator.runExclusive {
            val requestedWorkspaceId = requireRemoteWorkspaceId(workspaceId = workspaceId)
            val previousScope = currentCustomInstructionsScopeOrNull()
            if (previousScope != null && previousScope.workspaceId != requestedWorkspaceId) {
                throw AiChatCustomInstructionsScopeChangedException()
            }
            val session = authorizedSession(workspaceId = requestedWorkspaceId)
            val scope = currentCustomInstructionsScopeOrNull() ?: throw AiChatCustomInstructionsScopeChangedException()
            if (previousScope != null && scope != previousScope) {
                throw AiChatCustomInstructionsScopeChangedException()
            }
            requireSessionMatchesCustomInstructionsScope(scope = scope, session = session)
            AiChatPreparedRemoteSession(
                workspaceId = scope.workspaceId,
                apiBaseUrl = session.apiBaseUrl,
                authorizationHeader = session.authorizationHeader,
                instructionsScope = scope
            )
        }

    override suspend fun prepareImportSession(request: AiChatImportRequest): AiChatPreparedImport {
        val target = request.target
        val session = authorizedSession(workspaceId = target.workspaceId, importTarget = target)
        verifyImportAuthorization(target = target, session = session)
        return operationCoordinator.runExclusive {
            requireCurrentImportTarget(target = target)
            val scope = currentCustomInstructionsScopeOrNull() ?: throw AiImportTargetChangedException()
            AiChatPreparedImport(
                request = request,
                remoteSession = AiChatPreparedRemoteSession(
                    workspaceId = target.workspaceId,
                    apiBaseUrl = session.apiBaseUrl,
                    authorizationHeader = session.authorizationHeader,
                    instructionsScope = scope
                )
            )
        }
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
        val preparedSession = prepareSessionForAi(workspaceId = workspaceId)
        return try {
            recordingCustomInstructions(
                scope = preparedSession.instructionsScope,
                request = { session ->
                    aiChatRemoteService.loadSnapshot(
                        apiBaseUrl = session.apiBaseUrl,
                        authorizationHeader = session.authorizationHeader,
                        sessionId = sessionId,
                        workspaceId = preparedSession.workspaceId
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
                        "apiBaseUrl" to preparedSession.apiBaseUrl,
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
                        "apiBaseUrl" to preparedSession.apiBaseUrl,
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
            scope = preparedSession.instructionsScope,
            request = { session ->
                aiChatRemoteService.loadBootstrap(
                    apiBaseUrl = session.apiBaseUrl,
                    authorizationHeader = session.authorizationHeader,
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
            scope = preparedSession.instructionsScope,
            request = { session ->
                aiChatRemoteService.createNewSession(
                    apiBaseUrl = session.apiBaseUrl,
                    authorizationHeader = session.authorizationHeader,
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
        val preparedSession = preparedImport?.remoteSession ?: prepareSessionForAi(workspaceId = remoteWorkspaceId)
        val scope = preparedSession.instructionsScope
        if (scope.workspaceId != remoteWorkspaceId) {
            throw AiChatCustomInstructionsScopeChangedException()
        }
        val uploadSession = AuthorizedAiChatSession(
            apiBaseUrl = preparedSession.apiBaseUrl,
            authorizationHeader = preparedSession.authorizationHeader
        )
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

        AiChatDiagnosticsLogger.info(
            event = "start_run_requested",
            fields = listOf(
                "workspaceId" to workspaceId,
                "chatSessionId" to request.sessionId,
                "apiBaseUrl" to preparedSession.apiBaseUrl,
                "messageCount" to state.messages.size.toString(),
                "contentSummary" to AiChatDiagnosticsLogger.summarizeOutgoingContent(content = request.content)
            )
        )

        val observedAt = customInstructionsStore.stamp()
        return try {
            val response = recordCustomInstructionsResponse(
                scope = scope,
                request = {
                    startRunRetryingTimeout(
                        uploadSession = uploadSession,
                        request = request,
                        importTarget = importTarget,
                        scope = scope
                    )
                },
                observedAt = { observedAt },
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
                    "apiBaseUrl" to preparedSession.apiBaseUrl,
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
        uploadSession: AuthorizedAiChatSession,
        request: AiChatStartRunRequest,
        importTarget: AiImportTarget?,
        scope: AiChatCustomInstructionsScope
    ): AiChatStartRunResponse {
        suspend fun startRunAttempt(): AiChatStartRunResponse {
            val ownOpenAiKey = ownOpenAiKeyStore.activeApiKeyOrNull()
            val session = operationCoordinator.runExclusive {
                if (importTarget != null) {
                    requireCurrentImportTarget(target = importTarget)
                }
                authorizedScopedSession(scope = scope)
            }
            if (importTarget != null && session != uploadSession) {
                verifyImportAuthorization(target = importTarget, session = session)
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

    @OptIn(ExperimentalCoroutinesApi::class)
    override fun observeCustomInstructions(workspaceId: String): Flow<String?> {
        return observeCustomInstructionsScope().flatMapLatest { scope ->
            if (scope?.workspaceId == workspaceId) {
                customInstructionsStore.observe(scopeId = scope.scopeId)
            } else {
                flowOf(value = null)
            }
        }
    }

    override fun observeCustomInstructionsScope(): Flow<AiChatCustomInstructionsScope?> {
        val pendingUpgrade = preferencesStore.observePendingGuestUpgrade().catch { error ->
            AiChatDiagnosticsLogger.error(
                event = "ai_chat_custom_instructions_recovery_check_failed",
                fields = emptyList(),
                throwable = error
            )
            emit(true)
        }
        return combine(
            database.workspaceDao().observeWorkspaces(),
            preferencesStore.observeCloudSettings(),
            preferencesStore.observeServerConfiguration(),
            pendingUpgrade
        ) { workspaces, cloudSettings, configuration, upgradePending ->
            if (upgradePending) {
                null
            } else {
                customInstructionsScope(cloudSettings = cloudSettings, configuration = configuration)
                    ?.takeIf { scope -> workspaces.any { workspace -> workspace.workspaceId == scope.workspaceId } }
            }
        }.distinctUntilChanged()
    }

    override suspend fun loadCustomInstructions(scope: AiChatCustomInstructionsScope): AiChatCustomInstructions {
        val session = withAuthorizedEditorSession(scope = scope) { session -> session }
        val observedAt = customInstructionsStore.stamp()
        return recordCustomInstructionsResponse(
            scope = scope,
            request = {
                aiChatRemoteService.loadCustomInstructions(
                    apiBaseUrl = session.apiBaseUrl,
                    authorizationHeader = session.authorizationHeader,
                    workspaceId = scope.workspaceId
                )
            },
            observedAt = { observedAt },
            customInstructions = AiChatCustomInstructions::customInstructions
        )
    }

    override suspend fun saveCustomInstructions(
        scope: AiChatCustomInstructionsScope,
        customInstructions: String
    ): AiChatCustomInstructions {
        return withAuthorizedEditorSession(scope = scope) { session ->
            currentCoroutineContext().ensureActive()
            // Keep conversion behind the write even if the editor leaves while the POST is in flight.
            withContext(NonCancellable) {
                recordCustomInstructionsResponse(
                    scope = scope,
                    request = {
                        aiChatRemoteService.saveCustomInstructions(
                            apiBaseUrl = session.apiBaseUrl,
                            authorizationHeader = session.authorizationHeader,
                            workspaceId = scope.workspaceId,
                            customInstructions = customInstructions.takeIf(String::isNotBlank)
                        )
                    },
                    observedAt = customInstructionsStore::stamp,
                    customInstructions = AiChatCustomInstructions::customInstructions
                )
            }
        }
    }

    private suspend fun currentCustomInstructionsScopeOrNull(): AiChatCustomInstructionsScope? {
        if (preferencesStore.hasPendingGuestUpgrade()) {
            return null
        }
        return customInstructionsScope(
            cloudSettings = preferencesStore.currentCloudSettings(),
            configuration = preferencesStore.currentServerConfiguration()
        )?.takeIf { scope -> database.workspaceDao().loadWorkspaceById(workspaceId = scope.workspaceId) != null }
    }

    private fun customInstructionsScope(
        cloudSettings: CloudSettings,
        configuration: CloudServiceConfiguration
    ): AiChatCustomInstructionsScope? {
        if (cloudSettings.cloudState != CloudAccountState.LINKED && cloudSettings.cloudState != CloudAccountState.GUEST) {
            return null
        }
        val workspaceId = cloudSettings.activeWorkspaceId ?: return null
        val userId = cloudSettings.linkedUserId ?: return null
        val historyScope = makeAiChatHistoryScopedWorkspaceId(workspaceId = workspaceId, cloudSettings = cloudSettings)
        return AiChatCustomInstructionsScope(
            workspaceId = workspaceId,
            scopeId = "${configuration.mode}::${configuration.apiBaseUrl}::${cloudSettings.installationId}::$historyScope",
            userId = userId,
            cloudState = cloudSettings.cloudState,
            configuration = configuration
        )
    }

    private suspend fun <T : Any> withAuthorizedEditorSession(
        scope: AiChatCustomInstructionsScope,
        action: suspend (AuthorizedAiChatSession) -> T
    ): T {
        if (scope.cloudState != CloudAccountState.LINKED) {
            return operationCoordinator.runExclusive {
                val session = authorizedScopedSession(scope = scope)
                requireSessionMatchesCustomInstructionsScope(scope = scope, session = session)
                action(session)
            }
        }

        repeat(2) {
            val (settings, session) = operationCoordinator.runExclusive {
                val session = authorizedScopedSession(scope = scope)
                preferencesStore.currentCloudSettings() to session
            }
            // Keep account and workspace paging outside the lock used by sync and conversion.
            val account = try {
                Result.success(
                    cloudRemoteService.fetchCloudAccount(
                        apiBaseUrl = session.apiBaseUrl,
                        authorizationHeader = session.authorizationHeader
                    ).preservingLocalAccountIdentity(settings = settings)
                )
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                Result.failure(error)
            }
            val result = operationCoordinator.runExclusive {
                requireCurrentCustomInstructionsScope(scope = scope)
                val credentials = withContext(Dispatchers.IO) { preferencesStore.loadCredentials() }
                    ?: throw AiChatCustomInstructionsScopeChangedException()
                if (session.authorizationHeader != "Bearer ${credentials.idToken}") {
                    return@runExclusive null
                }
                if (session.apiBaseUrl != scope.configuration.apiBaseUrl || account.getOrThrow().userId != scope.userId) {
                    throw AiChatCustomInstructionsScopeChangedException()
                }
                if (credentials.idTokenExpiresAtMillis <= System.currentTimeMillis()) {
                    throw IOException("The cloud credential expired while verifying chat instructions. Try again.")
                }
                action(session)
            }
            if (result != null) {
                return result
            }
        }
        throw IOException("The cloud credential changed again while verifying chat instructions. Try again.")
    }

    private suspend fun authorizedScopedSession(scope: AiChatCustomInstructionsScope): AuthorizedAiChatSession =
        operationCoordinator.runExclusive {
            requireCurrentCustomInstructionsScope(scope = scope)
            val session = when (scope.cloudState) {
                CloudAccountState.GUEST -> {
                    val guest = requireWorkspaceGuestSession(scope = scope)
                    AuthorizedAiChatSession(
                        apiBaseUrl = guest.apiBaseUrl,
                        authorizationHeader = "Guest ${guest.guestToken}"
                    )
                }

                CloudAccountState.LINKED -> loadLinkedAiChatSession()

                else -> throw AiChatCustomInstructionsScopeChangedException()
            }
            requireCurrentCustomInstructionsScope(scope = scope)
            session
        }

    private suspend fun requireWorkspaceGuestSession(scope: AiChatCustomInstructionsScope): StoredGuestAiSession {
        return cloudGuestSessionCoordinator.loadWorkspaceGuestSession(workspaceId = scope.workspaceId)
            ?.takeIf { guest -> !guest.isAnalyticsOnly && guest.userId == scope.userId && guest.workspaceId == scope.workspaceId }
            ?: throw AiChatCustomInstructionsScopeChangedException()
    }

    private suspend fun requireCurrentCustomInstructionsScope(scope: AiChatCustomInstructionsScope) {
        if (currentCustomInstructionsScopeOrNull() != scope) {
            throw AiChatCustomInstructionsScopeChangedException()
        }
    }

    private suspend fun requireSessionMatchesCustomInstructionsScope(
        scope: AiChatCustomInstructionsScope,
        session: AuthorizedAiChatSession
    ) {
        requireCurrentCustomInstructionsScope(scope = scope)
        if (!matchesCustomInstructionsCredential(scope = scope, session = session)) {
            throw AiChatCustomInstructionsScopeChangedException()
        }
    }

    private suspend fun matchesCustomInstructionsCredential(
        scope: AiChatCustomInstructionsScope,
        session: AuthorizedAiChatSession
    ): Boolean {
        return when (scope.cloudState) {
            CloudAccountState.GUEST -> {
                val guest = requireWorkspaceGuestSession(scope = scope)
                session.authorizationHeader == "Guest ${guest.guestToken}" && isSameCloudService(
                    leftMode = guest.configurationMode,
                    leftApiBaseUrl = session.apiBaseUrl,
                    rightMode = scope.configuration.mode,
                    rightApiBaseUrl = scope.configuration.apiBaseUrl
                )
            }

            CloudAccountState.LINKED -> {
                val credentials = withContext(Dispatchers.IO) { preferencesStore.loadCredentials() }
                credentials != null && session.apiBaseUrl == scope.configuration.apiBaseUrl &&
                    session.authorizationHeader == "Bearer ${credentials.idToken}" &&
                    credentials.idTokenExpiresAtMillis > System.currentTimeMillis()
            }

            else -> false
        }
    }

    private suspend fun <T> recordingCustomInstructions(
        scope: AiChatCustomInstructionsScope,
        request: suspend (AuthorizedAiChatSession) -> T,
        customInstructions: (T) -> String?
    ): T {
        val session = authorizedScopedSession(scope = scope)
        val observedAt = customInstructionsStore.stamp()
        return recordCustomInstructionsResponse(
            scope = scope,
            request = { request(session) },
            observedAt = { observedAt },
            customInstructions = customInstructions
        )
    }

    private suspend fun <T> recordCustomInstructionsResponse(
        scope: AiChatCustomInstructionsScope,
        request: suspend () -> T,
        observedAt: () -> Long,
        customInstructions: (T) -> String?
    ): T {
        val response = try {
            request()
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            operationCoordinator.runExclusive {
                requireCurrentCustomInstructionsScope(scope = scope)
            }
            throw error
        }
        return operationCoordinator.runExclusive {
            requireCurrentCustomInstructionsScope(scope = scope)
            customInstructionsStore.record(
                scopeId = scope.scopeId,
                observedAt = observedAt(),
                customInstructions = customInstructions(response)
            )
            response
        }
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
