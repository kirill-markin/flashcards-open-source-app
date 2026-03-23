package com.flashcardsopensourceapp.feature.ai

import com.flashcardsopensourceapp.data.local.ai.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.model.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatDictationState
import com.flashcardsopensourceapp.data.local.model.AiChatPersistedState
import com.flashcardsopensourceapp.data.local.model.AiChatRepairAttemptStatus
import com.flashcardsopensourceapp.data.local.model.AiChatRole
import com.flashcardsopensourceapp.data.local.model.AiChatStreamEvent
import com.flashcardsopensourceapp.data.local.model.AiChatStreamOutcome
import com.flashcardsopensourceapp.data.local.model.AccountDeletionState
import com.flashcardsopensourceapp.data.local.model.AppMetadataSummary
import com.flashcardsopensourceapp.data.local.model.CloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudOtpChallenge
import com.flashcardsopensourceapp.data.local.model.CloudSendCodeResult
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.CloudSettings
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.DeviceDiagnosticsSummary
import com.flashcardsopensourceapp.data.local.model.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.WorkspaceExportData
import com.flashcardsopensourceapp.data.local.model.WorkspaceOverviewSummary
import com.flashcardsopensourceapp.data.local.model.WorkspaceSchedulerSettings
import com.flashcardsopensourceapp.data.local.model.WorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.WorkspaceTagSummary
import com.flashcardsopensourceapp.data.local.model.WorkspaceTagsSummary
import com.flashcardsopensourceapp.data.local.model.aiChatConsentRequiredMessage
import com.flashcardsopensourceapp.data.local.model.aiChatDefaultModelId
import com.flashcardsopensourceapp.data.local.model.makeAiChatAttachment
import com.flashcardsopensourceapp.data.local.model.makeDefaultAiChatPersistedState
import com.flashcardsopensourceapp.data.local.repository.AiChatRepository
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AiViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun sendRequiresConsent() = runTest(dispatcher) {
        val aiChatRepository = FakeAiChatRepository(hasConsent = false)
        val viewModel = AiViewModel(
            aiChatRepository = aiChatRepository,
            workspaceRepository = FakeWorkspaceRepository(),
            cloudAccountRepository = FakeCloudAccountRepository()
        )
        val collectionJob = startCollecting(scope = this, viewModel = viewModel)

        advanceUntilIdle()
        viewModel.updateDraftMessage("Help me")
        viewModel.sendMessage()
        advanceUntilIdle()

        assertEquals(aiChatConsentRequiredMessage, viewModel.uiState.value.errorMessage)
        assertTrue(viewModel.uiState.value.messages.isEmpty())
        collectionJob.cancel()
    }

    @Test
    fun guestModeLocksSelectedModelToDefault() = runTest(dispatcher) {
        val aiChatRepository = FakeAiChatRepository(
            hasConsent = true,
            persistedState = makeDefaultAiChatPersistedState().copy(
                selectedModelId = "claude-sonnet-4-6"
            )
        )
        val viewModel = AiViewModel(
            aiChatRepository = aiChatRepository,
            workspaceRepository = FakeWorkspaceRepository(),
            cloudAccountRepository = FakeCloudAccountRepository(
                cloudState = CloudAccountState.DISCONNECTED
            )
        )
        val collectionJob = startCollecting(scope = this, viewModel = viewModel)

        advanceUntilIdle()
        assertEquals(aiChatDefaultModelId, viewModel.uiState.value.selectedModelId)
        assertEquals(1, viewModel.uiState.value.availableModels.size)

        viewModel.selectModel(modelId = "claude-sonnet-4-6")
        advanceUntilIdle()

        assertEquals(aiChatDefaultModelId, viewModel.uiState.value.selectedModelId)
        collectionJob.cancel()
    }

    @Test
    fun sendAppliesStreamedAssistantTextAndToolCalls() = runTest(dispatcher) {
        val aiChatRepository = FakeAiChatRepository(
            hasConsent = true,
            streamHandler = { _, _, onEvent ->
                onEvent(AiChatStreamEvent.Delta(text = "Hello from AI"))
                onEvent(
                    AiChatStreamEvent.ToolCallRequest(
                        toolCallRequest = com.flashcardsopensourceapp.data.local.model.AiToolCallRequest(
                            toolCallId = "tool-1",
                            name = "sql",
                            input = "{\"sql\":\"SELECT 1\"}"
                        )
                    )
                )
                onEvent(
                    AiChatStreamEvent.ToolCall(
                        toolCall = com.flashcardsopensourceapp.data.local.model.AiChatToolCall(
                            toolCallId = "tool-1",
                            name = "sql",
                            status = com.flashcardsopensourceapp.data.local.model.AiChatToolCallStatus.COMPLETED,
                            input = "{\"sql\":\"SELECT 1\"}",
                            output = "{\"rows\":[1]}"
                        )
                    )
                )
                onEvent(AiChatStreamEvent.Done)
                AiChatStreamOutcome(
                    requestId = "request-1",
                    codeInterpreterContainerId = "container-1"
                )
            }
        )
        val viewModel = AiViewModel(
            aiChatRepository = aiChatRepository,
            workspaceRepository = FakeWorkspaceRepository(),
            cloudAccountRepository = FakeCloudAccountRepository(
                cloudState = CloudAccountState.LINKED
            )
        )
        val collectionJob = startCollecting(scope = this, viewModel = viewModel)

        advanceUntilIdle()
        viewModel.updateDraftMessage("Summarize my cards")
        advanceUntilIdle()
        viewModel.sendMessage()
        advanceUntilIdle()

        assertEquals(2, viewModel.uiState.value.messages.size)
        val assistantMessage = viewModel.uiState.value.messages.last()
        val textPart = assistantMessage.content.filterIsInstance<AiChatContentPart.Text>().single()
        assertEquals("Hello from AI", textPart.text)
        val toolCallPart = assistantMessage.content.filterIsInstance<AiChatContentPart.ToolCall>().single()
        assertEquals("sql", toolCallPart.toolCall.name)
        assertEquals(
            com.flashcardsopensourceapp.data.local.model.AiChatToolCallStatus.COMPLETED,
            toolCallPart.toolCall.status
        )
        assertFalse(viewModel.uiState.value.isStreaming)
        collectionJob.cancel()
    }

    @Test
    fun clearConversationResetsMessagesAndSessionId() = runTest(dispatcher) {
        val aiChatRepository = FakeAiChatRepository(
            hasConsent = true,
            persistedState = makeDefaultAiChatPersistedState().copy(
                messages = listOf(
                    com.flashcardsopensourceapp.data.local.model.AiChatMessage(
                        messageId = "message-1",
                        role = AiChatRole.USER,
                        content = listOf(AiChatContentPart.Text(text = "Hi")),
                        timestampMillis = 1L,
                        isError = false
                    )
                )
            )
        )
        val viewModel = AiViewModel(
            aiChatRepository = aiChatRepository,
            workspaceRepository = FakeWorkspaceRepository(),
            cloudAccountRepository = FakeCloudAccountRepository(
                cloudState = CloudAccountState.LINKED
            )
        )
        val collectionJob = startCollecting(scope = this, viewModel = viewModel)

        advanceUntilIdle()
        val initialSessionId = viewModel.uiState.value.messages
        assertEquals(1, initialSessionId.size)

        val previousChatSessionId = aiChatRepository.lastSavedState?.chatSessionId
        viewModel.clearConversation()
        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.messages.isEmpty())
        assertFalse(previousChatSessionId == aiChatRepository.lastSavedState?.chatSessionId)
        collectionJob.cancel()
    }

    @Test
    fun sendFailureMarksAssistantErrorAndSurfaceMessage() = runTest(dispatcher) {
        val aiChatRepository = FakeAiChatRepository(
            hasConsent = true,
            streamHandler = { _, _, _ ->
                throw AiChatRemoteException(
                    message = "Network failed.",
                    statusCode = 503,
                    code = "CHAT_UNAVAILABLE",
                    stage = "response_not_ok",
                    requestId = "request-2",
                    responseBody = null
                )
            }
        )
        val viewModel = AiViewModel(
            aiChatRepository = aiChatRepository,
            workspaceRepository = FakeWorkspaceRepository(),
            cloudAccountRepository = FakeCloudAccountRepository(
                cloudState = CloudAccountState.LINKED
            )
        )
        val collectionJob = startCollecting(scope = this, viewModel = viewModel)

        advanceUntilIdle()
        viewModel.updateDraftMessage("Summarize")
        advanceUntilIdle()
        viewModel.sendMessage()
        advanceUntilIdle()

        assertEquals("Network failed.", viewModel.uiState.value.errorMessage)
        val assistantMessage = viewModel.uiState.value.messages.last()
        val textPart = assistantMessage.content.filterIsInstance<AiChatContentPart.Text>().last()
        assertEquals("Network failed.", textPart.text)
        assertTrue(assistantMessage.isError)
        collectionJob.cancel()
    }

    @Test
    fun attachmentsOnlySendCreatesUserMessageWithImageContent() = runTest(dispatcher) {
        val aiChatRepository = FakeAiChatRepository(hasConsent = true)
        val viewModel = AiViewModel(
            aiChatRepository = aiChatRepository,
            workspaceRepository = FakeWorkspaceRepository(),
            cloudAccountRepository = FakeCloudAccountRepository(
                cloudState = CloudAccountState.LINKED
            )
        )
        val collectionJob = startCollecting(scope = this, viewModel = viewModel)

        advanceUntilIdle()
        viewModel.addPendingAttachment(
            makeAiChatAttachment(
                fileName = "photo.jpg",
                mediaType = "image/jpeg",
                base64Data = "abc"
            )
        )
        advanceUntilIdle()
        viewModel.sendMessage()
        advanceUntilIdle()

        assertEquals(2, viewModel.uiState.value.messages.size)
        val userMessage = viewModel.uiState.value.messages.first()
        val imagePart = userMessage.content.single() as AiChatContentPart.Image
        assertEquals("photo.jpg", imagePart.fileName)
        assertTrue(viewModel.uiState.value.pendingAttachments.isEmpty())
        collectionJob.cancel()
    }

    @Test
    fun applyEntryPrefillSetsCreateCardPrompt() = runTest(dispatcher) {
        val aiChatRepository = FakeAiChatRepository(hasConsent = true)
        val viewModel = AiViewModel(
            aiChatRepository = aiChatRepository,
            workspaceRepository = FakeWorkspaceRepository(),
            cloudAccountRepository = FakeCloudAccountRepository()
        )
        val collectionJob = startCollecting(scope = this, viewModel = viewModel)

        advanceUntilIdle()
        viewModel.applyEntryPrefill(prefill = AiEntryPrefill.CREATE_CARD)
        advanceUntilIdle()

        assertEquals("Help me create a card.", viewModel.uiState.value.draftMessage)
        assertTrue(viewModel.uiState.value.messages.isEmpty())
        collectionJob.cancel()
    }

    @Test
    fun transcriptionAppendsTranscriptToDraftWithoutSending() = runTest(dispatcher) {
        val aiChatRepository = FakeAiChatRepository(
            hasConsent = true,
            transcriptionText = "Added by dictation"
        )
        val viewModel = AiViewModel(
            aiChatRepository = aiChatRepository,
            workspaceRepository = FakeWorkspaceRepository(),
            cloudAccountRepository = FakeCloudAccountRepository(
                cloudState = CloudAccountState.LINKED
            )
        )
        val collectionJob = startCollecting(scope = this, viewModel = viewModel)

        advanceUntilIdle()
        viewModel.updateDraftMessage("Draft")
        viewModel.startDictationRecording()
        viewModel.transcribeRecordedAudio(
            fileName = "chat-dictation.m4a",
            mediaType = "audio/mp4",
            audioBytes = byteArrayOf(1, 2, 3)
        )
        advanceUntilIdle()

        assertEquals(AiChatDictationState.IDLE, viewModel.uiState.value.dictationState)
        assertEquals("Draft\nAdded by dictation", viewModel.uiState.value.draftMessage)
        assertTrue(viewModel.uiState.value.messages.isEmpty())
        collectionJob.cancel()
    }

    @Test
    fun warmUpRunsOnlyForLinkedAccountsWithConsent() = runTest(dispatcher) {
        val aiChatRepository = FakeAiChatRepository(hasConsent = true)
        val linkedViewModel = AiViewModel(
            aiChatRepository = aiChatRepository,
            workspaceRepository = FakeWorkspaceRepository(),
            cloudAccountRepository = FakeCloudAccountRepository(
                cloudState = CloudAccountState.LINKED
            )
        )
        val linkedCollectionJob = startCollecting(scope = this, viewModel = linkedViewModel)

        advanceUntilIdle()
        linkedViewModel.warmUpLinkedSessionIfNeeded()
        advanceUntilIdle()

        assertEquals(1, aiChatRepository.warmUpCalls)
        linkedCollectionJob.cancel()
    }

    @Test
    fun reloadRestoresPersistedMessagesForCurrentWorkspace() = runTest(dispatcher) {
        val aiChatRepository = FakeAiChatRepository(
            hasConsent = true,
            persistedState = makeDefaultAiChatPersistedState().copy(
                messages = listOf(
                    com.flashcardsopensourceapp.data.local.model.AiChatMessage(
                        messageId = "message-restore-1",
                        role = AiChatRole.ASSISTANT,
                        content = listOf(AiChatContentPart.Text(text = "Persisted answer")),
                        timestampMillis = 5L,
                        isError = false
                    )
                )
            )
        )

        val firstViewModel = AiViewModel(
            aiChatRepository = aiChatRepository,
            workspaceRepository = FakeWorkspaceRepository(),
            cloudAccountRepository = FakeCloudAccountRepository(
                cloudState = CloudAccountState.LINKED
            )
        )
        val firstCollectionJob = startCollecting(scope = this, viewModel = firstViewModel)
        advanceUntilIdle()
        assertEquals(1, firstViewModel.uiState.value.messages.size)
        firstCollectionJob.cancel()

        val secondViewModel = AiViewModel(
            aiChatRepository = aiChatRepository,
            workspaceRepository = FakeWorkspaceRepository(),
            cloudAccountRepository = FakeCloudAccountRepository(
                cloudState = CloudAccountState.LINKED
            )
        )
        val secondCollectionJob = startCollecting(scope = this, viewModel = secondViewModel)
        advanceUntilIdle()

        assertEquals(1, secondViewModel.uiState.value.messages.size)
        val assistantMessage = secondViewModel.uiState.value.messages.single()
        val textPart = assistantMessage.content.filterIsInstance<AiChatContentPart.Text>().single()
        assertEquals("Persisted answer", textPart.text)
        secondCollectionJob.cancel()
    }

    private fun startCollecting(scope: TestScope, viewModel: AiViewModel): Job {
        return scope.backgroundScope.launch {
            viewModel.uiState.collect()
        }
    }
}

private class FakeAiChatRepository(
    hasConsent: Boolean,
    persistedState: AiChatPersistedState = makeDefaultAiChatPersistedState(),
    private val transcriptionText: String = "",
    private val streamHandler: suspend (
        String?,
        AiChatPersistedState,
        suspend (AiChatStreamEvent) -> Unit
    ) -> AiChatStreamOutcome = { _, _, _ ->
        AiChatStreamOutcome(
            requestId = null,
            codeInterpreterContainerId = null
        )
    }
) : AiChatRepository {
    private val consentState = MutableStateFlow(hasConsent)
    private val storedStates = mutableMapOf<String?, AiChatPersistedState>()
    var lastSavedState: AiChatPersistedState? = null
    var warmUpCalls: Int = 0

    init {
        storedStates["workspace-1"] = persistedState
    }

    override fun observeConsent(): Flow<Boolean> {
        return consentState
    }

    override fun hasConsent(): Boolean {
        return consentState.value
    }

    override fun updateConsent(hasConsent: Boolean) {
        consentState.value = hasConsent
    }

    override suspend fun loadPersistedState(workspaceId: String?): AiChatPersistedState {
        return storedStates[workspaceId] ?: makeDefaultAiChatPersistedState()
    }

    override suspend fun savePersistedState(workspaceId: String?, state: AiChatPersistedState) {
        storedStates[workspaceId] = state
        lastSavedState = state
    }

    override suspend fun clearPersistedState(workspaceId: String?) {
        storedStates.remove(workspaceId)
    }

    override suspend fun transcribeAudio(
        workspaceId: String?,
        fileName: String,
        mediaType: String,
        audioBytes: ByteArray
    ): String {
        return transcriptionText
    }

    override suspend fun warmUpLinkedSession() {
        warmUpCalls += 1
    }

    override suspend fun streamTurn(
        workspaceId: String?,
        state: AiChatPersistedState,
        totalCards: Int,
        onEvent: suspend (AiChatStreamEvent) -> Unit
    ): AiChatStreamOutcome {
        return streamHandler(workspaceId, state, onEvent)
    }
}

private class FakeWorkspaceRepository : WorkspaceRepository {
    override fun observeWorkspace(): Flow<WorkspaceSummary?> {
        return flowOf(
            WorkspaceSummary(
                workspaceId = "workspace-1",
                name = "Personal",
                createdAtMillis = 1L
            )
        )
    }

    override fun observeAppMetadata(): Flow<AppMetadataSummary> {
        return flowOf(
            AppMetadataSummary(
                currentWorkspaceName = "Personal",
                workspaceName = "Personal",
                deckCount = 2,
                cardCount = 12,
                localStorageLabel = "Room + SQLite",
                syncStatusText = "Synced"
            )
        )
    }

    override fun observeWorkspaceOverview(): Flow<WorkspaceOverviewSummary?> {
        return flowOf(null)
    }

    override fun observeWorkspaceSchedulerSettings(): Flow<WorkspaceSchedulerSettings?> {
        return flowOf(null)
    }

    override fun observeWorkspaceTagsSummary(): Flow<WorkspaceTagsSummary> {
        return flowOf(
            WorkspaceTagsSummary(
                tags = listOf(WorkspaceTagSummary(tag = "grammar", cardsCount = 2)),
                totalCards = 12
            )
        )
    }

    override fun observeDeviceDiagnostics(): Flow<DeviceDiagnosticsSummary?> {
        return flowOf(null)
    }

    override suspend fun loadWorkspaceExportData(): WorkspaceExportData? {
        return null
    }

    override suspend fun updateWorkspaceSchedulerSettings(
        desiredRetention: Double,
        learningStepsMinutes: List<Int>,
        relearningStepsMinutes: List<Int>,
        maximumIntervalDays: Int,
        enableFuzz: Boolean
    ) {
    }
}

private class FakeCloudAccountRepository(
    cloudState: CloudAccountState = CloudAccountState.DISCONNECTED
) : CloudAccountRepository {
    private val cloudSettingsFlow = MutableStateFlow(
        CloudSettings(
            deviceId = "device-1",
            cloudState = cloudState,
            linkedUserId = if (cloudState == CloudAccountState.LINKED) "user-1" else null,
            linkedWorkspaceId = if (cloudState == CloudAccountState.LINKED) "workspace-1" else null,
            linkedEmail = if (cloudState == CloudAccountState.LINKED) "user@example.com" else null,
            activeWorkspaceId = "workspace-1",
            updatedAtMillis = 1L
        )
    )
    private val accountDeletionStateFlow = MutableStateFlow<AccountDeletionState>(AccountDeletionState.Hidden)

    override fun observeCloudSettings(): Flow<CloudSettings> {
        return cloudSettingsFlow
    }

    override fun observeAccountDeletionState(): Flow<AccountDeletionState> {
        return accountDeletionStateFlow
    }

    override fun observeServerConfiguration(): Flow<CloudServiceConfiguration> {
        return flowOf(
            CloudServiceConfiguration(
                mode = CloudServiceConfigurationMode.OFFICIAL,
                customOrigin = null,
                apiBaseUrl = "https://api.example.com/v1",
                authBaseUrl = "https://auth.example.com"
            )
        )
    }

    override suspend fun sendCode(email: String): CloudSendCodeResult {
        throw UnsupportedOperationException()
    }

    override suspend fun beginAccountDeletion() {
        throw UnsupportedOperationException()
    }

    override suspend fun resumePendingAccountDeletionIfNeeded() {
    }

    override suspend fun retryPendingAccountDeletion() {
        throw UnsupportedOperationException()
    }

    override suspend fun verifyCode(
        challenge: CloudOtpChallenge,
        code: String
    ): List<CloudWorkspaceSummary> {
        throw UnsupportedOperationException()
    }

    override suspend fun logout() {
        throw UnsupportedOperationException()
    }

    override suspend fun renameCurrentWorkspace(name: String): CloudWorkspaceSummary {
        throw UnsupportedOperationException()
    }

    override suspend fun loadCurrentWorkspaceDeletePreview(): com.flashcardsopensourceapp.data.local.model.CloudWorkspaceDeletePreview {
        throw UnsupportedOperationException()
    }

    override suspend fun deleteCurrentWorkspace(
        confirmationText: String
    ): com.flashcardsopensourceapp.data.local.model.CloudWorkspaceDeleteResult {
        throw UnsupportedOperationException()
    }

    override suspend fun deleteAccount(confirmationText: String) {
        throw UnsupportedOperationException()
    }

    override suspend fun listLinkedWorkspaces(): List<CloudWorkspaceSummary> {
        throw UnsupportedOperationException()
    }

    override suspend fun switchLinkedWorkspace(selection: CloudWorkspaceLinkSelection): CloudWorkspaceSummary {
        throw UnsupportedOperationException()
    }

    override suspend fun listAgentConnections(): com.flashcardsopensourceapp.data.local.model.AgentApiKeyConnectionsResult {
        throw UnsupportedOperationException()
    }

    override suspend fun revokeAgentConnection(
        connectionId: String
    ): com.flashcardsopensourceapp.data.local.model.AgentApiKeyConnectionsResult {
        throw UnsupportedOperationException()
    }

    override suspend fun currentServerConfiguration(): CloudServiceConfiguration {
        return CloudServiceConfiguration(
            mode = CloudServiceConfigurationMode.OFFICIAL,
            customOrigin = null,
            apiBaseUrl = "https://api.example.com/v1",
            authBaseUrl = "https://auth.example.com"
        )
    }

    override suspend fun validateCustomServer(customOrigin: String): CloudServiceConfiguration {
        throw UnsupportedOperationException()
    }

    override suspend fun applyCustomServer(configuration: CloudServiceConfiguration) {
        throw UnsupportedOperationException()
    }

    override suspend fun resetToOfficialServer() {
        throw UnsupportedOperationException()
    }
}
