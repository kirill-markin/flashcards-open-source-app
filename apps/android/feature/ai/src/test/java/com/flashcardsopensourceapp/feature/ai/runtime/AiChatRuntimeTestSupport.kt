package com.flashcardsopensourceapp.feature.ai.runtime

import com.flashcardsopensourceapp.data.local.ai.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.model.AiChatAcceptedConversationEnvelope
import com.flashcardsopensourceapp.data.local.model.AiChatActiveRun
import com.flashcardsopensourceapp.data.local.model.AiChatActiveRunLive
import com.flashcardsopensourceapp.data.local.model.AiChatBootstrapResponse
import com.flashcardsopensourceapp.data.local.model.AiChatComposerSuggestion
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatConversation
import com.flashcardsopensourceapp.data.local.model.AiChatDraftState
import com.flashcardsopensourceapp.data.local.model.AiChatLiveEvent
import com.flashcardsopensourceapp.data.local.model.AiChatLiveEventMetadata
import com.flashcardsopensourceapp.data.local.model.AiChatLiveStreamEnvelope
import com.flashcardsopensourceapp.data.local.model.AiChatMessage
import com.flashcardsopensourceapp.data.local.model.AiChatPersistedState
import com.flashcardsopensourceapp.data.local.model.AiChatResumeDiagnostics
import com.flashcardsopensourceapp.data.local.model.AiChatRunTerminalOutcome
import com.flashcardsopensourceapp.data.local.model.AiChatSessionProvisioningResult
import com.flashcardsopensourceapp.data.local.model.AiChatSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.AiChatStartRunResponse
import com.flashcardsopensourceapp.data.local.model.AiChatStopRunResponse
import com.flashcardsopensourceapp.data.local.model.AiChatTranscriptionResult
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.SyncStatus
import com.flashcardsopensourceapp.data.local.model.defaultAiChatServerConfig
import com.flashcardsopensourceapp.data.local.model.makeDefaultAiChatPersistedState
import com.flashcardsopensourceapp.data.local.model.makeOfficialCloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.repository.AiChatRepository
import com.flashcardsopensourceapp.data.local.repository.AiChatPreparedRemoteSession
import com.flashcardsopensourceapp.data.local.repository.AutoSyncEvent
import com.flashcardsopensourceapp.data.local.repository.AutoSyncEventRepository
import com.flashcardsopensourceapp.data.local.repository.AutoSyncRequest
import com.flashcardsopensourceapp.feature.ai.strings.testAiTextProvider
import java.util.ArrayDeque
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.withContext

internal const val defaultTestWorkspaceId: String = "workspace-1"
internal const val secondaryTestWorkspaceId: String = "workspace-2"

private const val testAppVersion: String = "1.3.0"
internal const val testUiLocaleTag: String = "en-US"

internal fun makeRuntime(scope: TestScope, repository: FakeAiChatRepository): AiChatRuntime {
    return makeRuntimeWithAutoSync(
        scope = scope,
        repository = repository,
        autoSyncEventRepository = FakeAutoSyncEventRepository()
    )
}

internal fun makeRuntimeContext(
    scope: TestScope,
    repository: FakeAiChatRepository,
    autoSyncEventRepository: FakeAutoSyncEventRepository
): AiChatRuntimeContext {
    return AiChatRuntimeContext(
        scope = scope,
        aiChatRepository = repository,
        autoSyncEventRepository = autoSyncEventRepository,
        appVersion = testAppVersion,
        textProvider = testAiTextProvider(),
        hasConsent = { repository.consent.value },
        currentCloudState = { CloudAccountState.GUEST },
        currentServerConfiguration = { makeOfficialCloudServiceConfiguration() },
        currentSyncStatus = { SyncStatus.Idle },
        currentUiLocaleTag = { testUiLocaleTag }
    )
}

internal fun makeRuntimeWithAutoSync(
    scope: TestScope,
    repository: FakeAiChatRepository,
    autoSyncEventRepository: FakeAutoSyncEventRepository
): AiChatRuntime {
    return makeRuntimeWithCloudState(
        scope = scope,
        repository = repository,
        autoSyncEventRepository = autoSyncEventRepository,
        cloudState = CloudAccountState.GUEST
    )
}

internal fun makeRuntimeWithCloudState(
    scope: TestScope,
    repository: FakeAiChatRepository,
    autoSyncEventRepository: FakeAutoSyncEventRepository,
    cloudState: CloudAccountState
): AiChatRuntime {
    return AiChatRuntime(
        scope = scope,
        aiChatRepository = repository,
        autoSyncEventRepository = autoSyncEventRepository,
        appVersion = testAppVersion,
        textProvider = testAiTextProvider(),
        hasConsent = { repository.consent.value },
        currentCloudState = { cloudState },
        currentServerConfiguration = { makeOfficialCloudServiceConfiguration() },
        currentSyncStatus = { SyncStatus.Idle },
        currentUiLocaleTag = { testUiLocaleTag }
    )
}

internal fun makeAccessContext(workspaceId: String): AiAccessContext {
    return AiAccessContext(
        workspaceId = workspaceId,
        cloudState = CloudAccountState.GUEST,
        linkedUserId = null,
        activeWorkspaceId = null
    )
}

internal fun makeMetadata(runId: String, cursor: String): AiChatLiveEventMetadata {
    return makeMetadataForSession(
        sessionId = "session-1",
        runId = runId,
        cursor = cursor
    )
}

internal fun makeMetadataForSession(
    sessionId: String,
    runId: String,
    cursor: String
): AiChatLiveEventMetadata {
    return AiChatLiveEventMetadata(
        sessionId = sessionId,
        conversationScopeId = sessionId,
        runId = runId,
        cursor = cursor,
        sequenceNumber = 1,
        streamEpoch = runId
    )
}

internal fun makeActiveRun(runId: String, cursor: String): AiChatActiveRun {
    return AiChatActiveRun(
        runId = runId,
        status = "running",
        live = AiChatActiveRunLive(
            cursor = cursor,
            stream = AiChatLiveStreamEnvelope(
                url = "https://example.com/live",
                authorization = "Live token",
                expiresAt = 123L
            )
        ),
        lastHeartbeatAtMillis = 456L
    )
}

internal fun makeBootstrapResponse(
    sessionId: String,
    activeRun: AiChatActiveRun?
): AiChatBootstrapResponse {
    return AiChatBootstrapResponse(
        sessionId = sessionId,
        conversationScopeId = sessionId,
        conversation = AiChatConversation(
            messages = emptyList(),
            updatedAtMillis = 100L,
            mainContentInvalidationVersion = 0L,
            hasOlder = false,
            oldestCursor = null
        ),
        composerSuggestions = emptyList(),
        chatConfig = defaultAiChatServerConfig,
        activeRun = activeRun
    )
}

internal fun makeAcceptedStartRunResponse(
    sessionId: String,
    activeRun: AiChatActiveRun?,
    messages: List<AiChatMessage>,
    composerSuggestions: List<AiChatComposerSuggestion>
): AiChatStartRunResponse {
    return AiChatAcceptedConversationEnvelope(
        accepted = true,
        sessionId = sessionId,
        conversationScopeId = sessionId,
        conversation = AiChatConversation(
            messages = messages,
            updatedAtMillis = 100L,
            mainContentInvalidationVersion = 0L,
            hasOlder = false,
            oldestCursor = null
        ),
        composerSuggestions = composerSuggestions,
        chatConfig = defaultAiChatServerConfig,
        activeRun = activeRun,
        deduplicated = false
    )
}

internal fun makeSessionSnapshot(
    sessionId: String,
    composerSuggestions: List<AiChatComposerSuggestion>
): AiChatSessionSnapshot {
    return com.flashcardsopensourceapp.data.local.model.AiChatConversationEnvelope(
        sessionId = sessionId,
        conversationScopeId = sessionId,
        conversation = AiChatConversation(
            messages = emptyList(),
            updatedAtMillis = 100L,
            mainContentInvalidationVersion = 0L,
            hasOlder = false,
            oldestCursor = null
        ),
        composerSuggestions = composerSuggestions,
        chatConfig = defaultAiChatServerConfig,
        activeRun = null
    )
}

internal class FakeAiChatRepository : AiChatRepository {
    val consent: MutableStateFlow<Boolean> = MutableStateFlow(value = true)
    val bootstrapResponses: ArrayDeque<AiChatBootstrapResponse> = ArrayDeque()
    val loadBootstrapGates: ArrayDeque<CompletableDeferred<Unit>> = ArrayDeque()
    val loadBootstrapNonCancellableGates: ArrayDeque<CompletableDeferred<Unit>> = ArrayDeque()
    val liveFlows: MutableMap<String, Flow<AiChatLiveEvent>> = mutableMapOf()
    val attachRunIds: MutableList<String> = mutableListOf()
    val remoteCallEvents: MutableList<String> = mutableListOf()
    val loadBootstrapSessionIds: MutableList<String> = mutableListOf()
    val createNewSessionRequests: MutableList<String> = mutableListOf()
    val createNewSessionUiLocales: MutableList<String?> = mutableListOf()
    val prepareSessionRequests: MutableList<String?> = mutableListOf()
    val prepareSessionGates: ArrayDeque<CompletableDeferred<Unit>> = ArrayDeque()
    val prepareSessionErrors: ArrayDeque<Exception> = ArrayDeque()
    val createNewSessionGates: ArrayDeque<CompletableDeferred<Unit>> = ArrayDeque()
    val createNewSessionErrors: ArrayDeque<Exception> = ArrayDeque()
    val loadBootstrapErrors: ArrayDeque<Exception> = ArrayDeque()
    val loadDraftStateErrors: ArrayDeque<Exception> = ArrayDeque()
    val savePersistedStateErrors: ArrayDeque<Exception> = ArrayDeque()
    val transcribeAudioGates: ArrayDeque<CompletableDeferred<Unit>> = ArrayDeque()
    val createNewSessionResponses: ArrayDeque<AiChatSessionSnapshot> = ArrayDeque()
    val savePersistedStateGates: ArrayDeque<CompletableDeferred<Unit>> = ArrayDeque()
    val persistedStates: MutableMap<String?, AiChatPersistedState> = mutableMapOf()
    val draftStates: MutableMap<Pair<String?, String?>, AiChatDraftState> = mutableMapOf()
    val startRunGates: ArrayDeque<CompletableDeferred<Unit>> = ArrayDeque()
    val ensureSessionRequests: MutableList<String> = mutableListOf()
    val transcribeAudioWorkspaceIds: MutableList<String?> = mutableListOf()
    val transcribeAudioSessionIds: MutableList<String> = mutableListOf()
    val stopRunWorkspaceIds: MutableList<String?> = mutableListOf()
    val stopRunSessionIds: MutableList<String> = mutableListOf()
    val stopRunIds: MutableList<String?> = mutableListOf()
    var nextEnsureSessionId: String = "ensured-session-1"
    var transcribeAudioResponse: AiChatTranscriptionResult = AiChatTranscriptionResult(
        text = "transcribed speech",
        sessionId = nextEnsureSessionId
    )
    var transcribeAudioError: Exception? = null
    var ensureReadyForSendError: Exception? = null
    var startRunError: Exception? = null
    var loadBootstrapCalls: Int = 0
    var startRunCalls: Int = 0
    var lastStartRunState: AiChatPersistedState? = null
    var lastStartRunUiLocale: String? = null
    var stopRunResponse: AiChatStopRunResponse? = null
    var startRunResponse: AiChatStartRunResponse = AiChatAcceptedConversationEnvelope(
        accepted = true,
        sessionId = "session-1",
        conversationScopeId = "session-1",
        conversation = AiChatConversation(
            messages = emptyList(),
            updatedAtMillis = 100L,
            mainContentInvalidationVersion = 0L,
            hasOlder = false,
            oldestCursor = null
        ),
        composerSuggestions = emptyList(),
        chatConfig = defaultAiChatServerConfig,
        activeRun = null,
        deduplicated = false
    )

    override fun observeConsent(): Flow<Boolean> {
        return consent
    }

    override fun hasConsent(): Boolean {
        return consent.value
    }

    override fun updateConsent(hasConsent: Boolean) {
        consent.value = hasConsent
    }

    override fun makeExplicitSessionId(): String {
        return nextEnsureSessionId
    }

    override suspend fun prepareSessionForAi(workspaceId: String?): AiChatPreparedRemoteSession {
        prepareSessionRequests += workspaceId
        if (prepareSessionGates.isNotEmpty()) {
            prepareSessionGates.removeFirst().await()
        }
        if (prepareSessionErrors.isNotEmpty()) {
            throw prepareSessionErrors.removeFirst()
        }
        return AiChatPreparedRemoteSession(
            workspaceId = workspaceId ?: "",
            apiBaseUrl = "https://api.example.test",
            authorizationHeader = "Guest test-token"
        )
    }

    override suspend fun ensureReadyForSend(workspaceId: String?) {
        val error: Exception? = ensureReadyForSendError
        if (error != null) {
            throw error
        }
    }

    override suspend fun loadPersistedState(workspaceId: String?): AiChatPersistedState {
        return persistedStates[workspaceId] ?: makeDefaultAiChatPersistedState()
    }

    override suspend fun savePersistedState(workspaceId: String?, state: AiChatPersistedState) {
        if (savePersistedStateGates.isNotEmpty()) {
            savePersistedStateGates.removeFirst().await()
        }
        if (savePersistedStateErrors.isNotEmpty()) {
            throw savePersistedStateErrors.removeFirst()
        }
        persistedStates[workspaceId] = state
    }

    override suspend fun clearPersistedState(workspaceId: String?) {
        persistedStates[workspaceId] = makeDefaultAiChatPersistedState()
    }

    override suspend fun loadDraftState(workspaceId: String?, sessionId: String?): AiChatDraftState {
        if (loadDraftStateErrors.isNotEmpty()) {
            throw loadDraftStateErrors.removeFirst()
        }
        return draftStates[workspaceId to sessionId] ?: AiChatDraftState(
            draftMessage = "",
            pendingAttachments = emptyList()
        )
    }

    override suspend fun saveDraftState(workspaceId: String?, sessionId: String?, state: AiChatDraftState) {
        val key: Pair<String?, String?> = workspaceId to sessionId
        if (state.draftMessage.isBlank() && state.pendingAttachments.isEmpty()) {
            draftStates.remove(key)
            return
        }

        draftStates[key] = state
    }

    override suspend fun clearDraftState(workspaceId: String?, sessionId: String?) {
        draftStates.remove(workspaceId to sessionId)
    }

    override suspend fun loadChatSnapshot(workspaceId: String?, sessionId: String?): AiChatSessionSnapshot? {
        return null
    }

    override suspend fun ensureSessionId(
        workspaceId: String?,
        persistedState: AiChatPersistedState,
        provisionalSessionId: String?,
        uiLocale: String?
    ): AiChatSessionProvisioningResult {
        val normalizedSessionId = persistedState.chatSessionId.trim()
        ensureSessionRequests += normalizedSessionId
        if (normalizedSessionId.isNotEmpty()) {
            return AiChatSessionProvisioningResult(
                sessionId = normalizedSessionId,
                snapshot = null
            )
        }

        val sessionId = provisionalSessionId ?: nextEnsureSessionId
        val snapshot = createNewSession(
            workspaceId = workspaceId,
            sessionId = sessionId,
            uiLocale = uiLocale
        )
        return AiChatSessionProvisioningResult(
            sessionId = sessionId,
            snapshot = snapshot
        )
    }

    override suspend fun loadBootstrap(
        workspaceId: String?,
        sessionId: String,
        limit: Int,
        resumeDiagnostics: AiChatResumeDiagnostics?
    ): AiChatBootstrapResponse {
        loadBootstrapCalls += 1
        loadBootstrapSessionIds += sessionId
        remoteCallEvents += "loadBootstrap:$sessionId"
        if (loadBootstrapGates.isNotEmpty()) {
            loadBootstrapGates.removeFirst().await()
        }
        if (loadBootstrapNonCancellableGates.isNotEmpty()) {
            withContext(NonCancellable) {
                loadBootstrapNonCancellableGates.removeFirst().await()
            }
        }
        if (loadBootstrapErrors.isNotEmpty()) {
            throw loadBootstrapErrors.removeFirst()
        }
        return bootstrapResponses.removeFirst()
    }

    override suspend fun loadBootstrapFromPreparedSession(
        preparedSession: AiChatPreparedRemoteSession,
        sessionId: String,
        limit: Int,
        resumeDiagnostics: AiChatResumeDiagnostics?
    ): AiChatBootstrapResponse {
        return loadBootstrap(
            workspaceId = preparedSession.workspaceId,
            sessionId = sessionId,
            limit = limit,
            resumeDiagnostics = resumeDiagnostics
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
        createNewSessionRequests += sessionId
        createNewSessionUiLocales += uiLocale
        remoteCallEvents += "createNewSession:$sessionId"
        if (createNewSessionGates.isNotEmpty()) {
            createNewSessionGates.removeFirst().await()
        }
        if (createNewSessionErrors.isNotEmpty()) {
            throw createNewSessionErrors.removeFirst()
        }
        if (createNewSessionResponses.isNotEmpty()) {
            return createNewSessionResponses.removeFirst()
        }
        return com.flashcardsopensourceapp.data.local.model.AiChatConversationEnvelope(
            sessionId = sessionId,
            conversationScopeId = sessionId,
            conversation = AiChatConversation(
                messages = emptyList(),
                updatedAtMillis = 100L,
                mainContentInvalidationVersion = 0L,
                hasOlder = false,
                oldestCursor = null
            ),
            composerSuggestions = emptyList(),
            chatConfig = defaultAiChatServerConfig,
            activeRun = null
        )
    }

    override suspend fun transcribeAudio(
        workspaceId: String?,
        sessionId: String,
        fileName: String,
        mediaType: String,
        audioBytes: ByteArray
    ): AiChatTranscriptionResult {
        transcribeAudioWorkspaceIds += workspaceId
        transcribeAudioSessionIds += sessionId
        if (transcribeAudioGates.isNotEmpty()) {
            transcribeAudioGates.removeFirst().await()
        }
        val error = transcribeAudioError
        if (error != null) {
            throw error
        }
        return transcribeAudioResponse
    }

    override suspend fun warmUpLinkedSession() {
        Unit
    }

    override suspend fun startRun(
        workspaceId: String?,
        state: AiChatPersistedState,
        content: List<AiChatContentPart>,
        uiLocale: String?
    ): AiChatStartRunResponse {
        startRunCalls += 1
        remoteCallEvents += "startRun:${state.chatSessionId}"
        lastStartRunState = state
        lastStartRunUiLocale = uiLocale
        if (startRunGates.isNotEmpty()) {
            startRunGates.removeFirst().await()
        }
        val error: Exception? = startRunError
        if (error != null) {
            throw error
        }
        return startRunResponse
    }

    override fun attachLiveRun(
        workspaceId: String?,
        sessionId: String,
        runId: String,
        liveStream: AiChatLiveStreamEnvelope,
        afterCursor: String?,
        resumeDiagnostics: AiChatResumeDiagnostics?
    ): Flow<AiChatLiveEvent> {
        attachRunIds += runId
        return liveFlows[runId] ?: emptyFlow()
    }

    override suspend fun stopRun(workspaceId: String?, sessionId: String, runId: String?): AiChatStopRunResponse {
        stopRunWorkspaceIds += workspaceId
        stopRunSessionIds += sessionId
        stopRunIds += runId
        val configuredResponse: AiChatStopRunResponse? = stopRunResponse
        if (configuredResponse != null) {
            return configuredResponse
        }
        return AiChatStopRunResponse(
            sessionId = sessionId,
            stopped = true,
            stillRunning = false
        )
    }

    fun setPersistedState(
        workspaceId: String?,
        state: AiChatPersistedState
    ) {
        persistedStates[workspaceId] = state
    }
}

internal class FakeAutoSyncEventRepository : AutoSyncEventRepository {
    val requests: MutableList<AutoSyncRequest> = mutableListOf()
    val runAutoSyncErrors: ArrayDeque<Exception> = ArrayDeque()
    val runAutoSyncGates: ArrayDeque<CompletableDeferred<Unit>> = ArrayDeque()

    override fun observeAutoSyncEvents(): Flow<AutoSyncEvent> {
        return emptyFlow()
    }

    override suspend fun runAutoSync(request: AutoSyncRequest) {
        requests += request
        if (runAutoSyncGates.isNotEmpty()) {
            runAutoSyncGates.removeFirst().await()
        }
        if (runAutoSyncErrors.isNotEmpty()) {
            throw runAutoSyncErrors.removeFirst()
        }
    }
}
