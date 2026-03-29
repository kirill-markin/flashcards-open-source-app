package com.flashcardsopensourceapp.feature.settings

import com.flashcardsopensourceapp.core.ui.TransientMessageController
import com.flashcardsopensourceapp.data.local.model.AccountDeletionState
import com.flashcardsopensourceapp.data.local.model.AgentApiKeyConnection
import com.flashcardsopensourceapp.data.local.model.AgentApiKeyConnectionsResult
import com.flashcardsopensourceapp.data.local.model.AppMetadataSummary
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeMode
import com.flashcardsopensourceapp.data.local.model.CloudOtpChallenge
import com.flashcardsopensourceapp.data.local.model.CloudSendCodeResult
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.CloudSettings
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkContext
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceDeletePreview
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceDeleteResult
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
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class CloudLifecycleViewModelTest {
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
    fun workspaceOverviewRenameUsesCloudRepositoryAndShowsSuccess() = runTest(dispatcher) {
        val workspaceRepository = FakeWorkspaceRepository()
        val cloudAccountRepository = FakeCloudAccountRepository(
            onRenameWorkspace = workspaceRepository::renameWorkspace
        )
        val viewModel = WorkspaceOverviewViewModel(
            workspaceRepository = workspaceRepository,
            cloudAccountRepository = cloudAccountRepository,
            syncRepository = FakeSyncRepository(),
            messageController = FakeMessageController()
        )
        val collectionJob = startCollecting(scope = this, viewModel = viewModel)

        advanceUntilIdle()
        viewModel.updateWorkspaceNameDraft("Renamed Workspace")
        advanceUntilIdle()

        val didSave = viewModel.saveWorkspaceName()
        advanceUntilIdle()

        assertTrue(didSave)
        assertEquals("Renamed Workspace", cloudAccountRepository.lastRenamedWorkspaceName)
        assertEquals("Renamed Workspace", viewModel.uiState.value.workspaceNameDraft)
        assertEquals("Workspace name saved.", viewModel.uiState.value.successMessage)
        collectionJob.cancel()
    }

    @Test
    fun workspaceDeleteRequiresExactConfirmationText() = runTest(dispatcher) {
        val viewModel = WorkspaceOverviewViewModel(
            workspaceRepository = FakeWorkspaceRepository(),
            cloudAccountRepository = FakeCloudAccountRepository(),
            syncRepository = FakeSyncRepository(),
            messageController = FakeMessageController()
        )
        val collectionJob = startCollecting(scope = this, viewModel = viewModel)

        advanceUntilIdle()
        viewModel.requestDeleteWorkspace()
        advanceUntilIdle()
        assertTrue(viewModel.uiState.value.showDeletePreviewAlert)

        viewModel.openDeleteConfirmation()
        viewModel.updateDeleteConfirmationText("wrong")
        advanceUntilIdle()

        val didDelete = viewModel.deleteWorkspace()
        advanceUntilIdle()

        assertFalse(didDelete)
        assertEquals(
            "Enter the confirmation phrase exactly to continue.",
            viewModel.uiState.value.errorMessage
        )
        collectionJob.cancel()
    }

    @Test
    fun agentConnectionsRevokeUpdatesExistingConnection() = runTest(dispatcher) {
        val cloudAccountRepository = FakeCloudAccountRepository(
            connections = listOf(
                AgentApiKeyConnection(
                    connectionId = "connection-1",
                    label = "MacBook",
                    createdAtMillis = 1L,
                    lastUsedAtMillis = 2L,
                    revokedAtMillis = null
                ),
                AgentApiKeyConnection(
                    connectionId = "connection-2",
                    label = "Terminal",
                    createdAtMillis = 3L,
                    lastUsedAtMillis = null,
                    revokedAtMillis = null
                )
            )
        )
        val viewModel = AgentConnectionsViewModel(cloudAccountRepository = cloudAccountRepository)
        val collectionJob = startCollecting(scope = this, viewModel = viewModel)

        advanceUntilIdle()
        viewModel.loadConnections()
        advanceUntilIdle()
        viewModel.revokeConnection(connectionId = "connection-1")
        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.connections.first().isRevoked)
        assertFalse(viewModel.uiState.value.connections.last().isRevoked)
        collectionJob.cancel()
    }

    @Test
    fun accountDangerZoneDeleteAccountClearsLinkedStateAfterSuccess() = runTest(dispatcher) {
        val cloudAccountRepository = FakeCloudAccountRepository()
        val viewModel = AccountDangerZoneViewModel(cloudAccountRepository = cloudAccountRepository)
        val collectionJob = startCollecting(scope = this, viewModel = viewModel)

        advanceUntilIdle()
        viewModel.requestDeleteConfirmation()
        viewModel.updateConfirmationText(accountDeletionConfirmationText)
        advanceUntilIdle()

        val didDelete = viewModel.deleteAccount()
        advanceUntilIdle()

        assertTrue(didDelete)
        assertFalse(viewModel.uiState.value.isLinked)
        assertEquals(DestructiveActionState.IDLE, viewModel.uiState.value.deleteState)
        assertEquals(AccountDeletionState.Hidden, cloudAccountRepository.accountDeletionState.value)
        collectionJob.cancel()
    }

    @Test
    fun accountStatusLogoutRequiresConfirmationAndEmitsMessage() = runTest(dispatcher) {
        val messages = FakeMessageController()
        val viewModel = AccountStatusViewModel(
            cloudAccountRepository = FakeCloudAccountRepository(),
            syncRepository = FakeSyncRepository(),
            messageController = messages,
            workspaceRepository = FakeWorkspaceRepository()
        )
        val collectionJob = startCollecting(scope = this, viewModel = viewModel)

        advanceUntilIdle()
        viewModel.requestLogoutConfirmation()
        advanceUntilIdle()
        assertTrue(viewModel.uiState.value.showLogoutConfirmation)

        viewModel.confirmLogout()
        advanceUntilIdle()

        assertFalse(viewModel.uiState.value.showLogoutConfirmation)
        assertFalse(viewModel.uiState.value.isLinked)
        assertEquals(listOf("Logged out. This device is disconnected."), messages.messages)
        collectionJob.cancel()
    }

    @Test
    fun cloudSignInAutoLinksSingleWorkspaceAndCompletes() = runTest(dispatcher) {
        val messages = FakeMessageController()
        val workspace = CloudWorkspaceSummary(
            workspaceId = "workspace-2",
            name = "Spanish",
            createdAtMillis = 2L,
            isSelected = false
        )
        val syncRepository = FakeSyncRepository()
        val viewModel = CloudSignInViewModel(
            cloudAccountRepository = FakeCloudAccountRepository(
                initialCloudState = CloudAccountState.DISCONNECTED,
                verifiedWorkspaces = listOf(workspace),
                linkedWorkspaces = listOf(workspace)
            ),
            syncRepository = syncRepository,
            messageController = messages
        )
        val uiCollectionJob = startCollecting(scope = this, viewModel = viewModel)
        val postAuthCollectionJob = startCollectingPostAuth(scope = this, viewModel = viewModel)

        viewModel.updateEmail("user@example.com")
        assertEquals(CloudSendCodeNavigationOutcome.OtpRequired, viewModel.sendCode())
        viewModel.updateCode("123456")
        assertTrue(viewModel.verifyCode())
        advanceUntilIdle()
        assertEquals(CloudPostAuthMode.READY_TO_AUTO_LINK, viewModel.postAuthUiState.value.mode)

        viewModel.completePendingPostAuthIfNeeded()
        advanceUntilIdle()

        assertEquals(1, syncRepository.syncNowCalls)
        assertEquals(CloudPostAuthMode.IDLE, viewModel.postAuthUiState.value.mode)
        assertTrue(viewModel.postAuthUiState.value.completionToken != null)
        assertEquals(listOf("Signed in and synced Spanish."), messages.messages)
        uiCollectionJob.cancel()
        postAuthCollectionJob.cancel()
    }

    @Test
    fun cloudSignInRetryKeepsVerifiedContextAfterSyncFailure() = runTest(dispatcher) {
        val messages = FakeMessageController()
        val workspaces = listOf(
            CloudWorkspaceSummary(
                workspaceId = "workspace-1",
                name = "Personal",
                createdAtMillis = 1L,
                isSelected = false
            ),
            CloudWorkspaceSummary(
                workspaceId = "workspace-2",
                name = "Spanish",
                createdAtMillis = 2L,
                isSelected = false
            )
        )
        val syncRepository = FakeSyncRepository(failuresRemaining = 1)
        val viewModel = CloudSignInViewModel(
            cloudAccountRepository = FakeCloudAccountRepository(
                initialCloudState = CloudAccountState.DISCONNECTED,
                verifiedWorkspaces = workspaces,
                linkedWorkspaces = workspaces
            ),
            syncRepository = syncRepository,
            messageController = messages
        )
        val uiCollectionJob = startCollecting(scope = this, viewModel = viewModel)
        val postAuthCollectionJob = startCollectingPostAuth(scope = this, viewModel = viewModel)

        viewModel.updateEmail("user@example.com")
        assertEquals(CloudSendCodeNavigationOutcome.OtpRequired, viewModel.sendCode())
        viewModel.updateCode("123456")
        assertTrue(viewModel.verifyCode())
        advanceUntilIdle()
        assertEquals(CloudPostAuthMode.CHOOSE_WORKSPACE, viewModel.postAuthUiState.value.mode)

        viewModel.selectPostAuthWorkspace(
            selection = CloudWorkspaceLinkSelection.Existing(workspaceId = "workspace-2")
        )
        advanceUntilIdle()

        assertEquals(CloudPostAuthMode.FAILED, viewModel.postAuthUiState.value.mode)
        assertEquals("user@example.com", viewModel.postAuthUiState.value.verifiedEmail)
        assertTrue(viewModel.postAuthUiState.value.canRetry)

        viewModel.retryPostAuth()
        advanceUntilIdle()

        assertEquals(2, syncRepository.syncNowCalls)
        assertTrue(viewModel.postAuthUiState.value.completionToken != null)
        assertEquals(listOf("Signed in and synced Spanish."), messages.messages)
        uiCollectionJob.cancel()
        postAuthCollectionJob.cancel()
    }

    @Test
    fun cloudSignInReviewDemoBypassSkipsOtpAndCompletes() = runTest(dispatcher) {
        val messages = FakeMessageController()
        val workspace = CloudWorkspaceSummary(
            workspaceId = "workspace-2",
            name = "Spanish",
            createdAtMillis = 2L,
            isSelected = false
        )
        val syncRepository = FakeSyncRepository()
        val viewModel = CloudSignInViewModel(
            cloudAccountRepository = FakeCloudAccountRepository(
                initialCloudState = CloudAccountState.DISCONNECTED,
                sendCodeResult = CloudSendCodeResult.Verified(
                    credentials = StoredCloudCredentials(
                        refreshToken = "refresh-token",
                        idToken = "id-token",
                        idTokenExpiresAtMillis = 10_000L
                    )
                ),
                verifiedWorkspaces = listOf(workspace),
                linkedWorkspaces = listOf(workspace)
            ),
            syncRepository = syncRepository,
            messageController = messages
        )
        val uiCollectionJob = startCollecting(scope = this, viewModel = viewModel)
        val postAuthCollectionJob = startCollectingPostAuth(scope = this, viewModel = viewModel)

        viewModel.updateEmail("google-review@example.com")
        assertEquals(CloudSendCodeNavigationOutcome.Verified, viewModel.sendCode())
        advanceUntilIdle()
        assertEquals(CloudPostAuthMode.READY_TO_AUTO_LINK, viewModel.postAuthUiState.value.mode)
        assertEquals("google-review@example.com", viewModel.postAuthUiState.value.verifiedEmail)

        viewModel.completePendingPostAuthIfNeeded()
        advanceUntilIdle()

        assertEquals(1, syncRepository.syncNowCalls)
        assertEquals(CloudPostAuthMode.IDLE, viewModel.postAuthUiState.value.mode)
        assertEquals(listOf("Signed in and synced Spanish."), messages.messages)
        uiCollectionJob.cancel()
        postAuthCollectionJob.cancel()
    }

    @Test
    fun cloudSignInGuestMergeRequiredUsesGuestUpgradeBranch() = runTest(dispatcher) {
        val messages = FakeMessageController()
        val workspace = CloudWorkspaceSummary(
            workspaceId = "workspace-2",
            name = "Spanish",
            createdAtMillis = 2L,
            isSelected = false
        )
        val syncRepository = FakeSyncRepository()
        val cloudAccountRepository = FakeCloudAccountRepository(
            initialCloudState = CloudAccountState.GUEST,
            guestUpgradeMode = CloudGuestUpgradeMode.MERGE_REQUIRED,
            verifiedWorkspaces = listOf(workspace),
            linkedWorkspaces = listOf(workspace)
        )
        val viewModel = CloudSignInViewModel(
            cloudAccountRepository = cloudAccountRepository,
            syncRepository = syncRepository,
            messageController = messages
        )
        val uiCollectionJob = startCollecting(scope = this, viewModel = viewModel)
        val postAuthCollectionJob = startCollectingPostAuth(scope = this, viewModel = viewModel)

        viewModel.updateEmail("user@example.com")
        assertEquals(CloudSendCodeNavigationOutcome.OtpRequired, viewModel.sendCode())
        viewModel.updateCode("123456")
        assertTrue(viewModel.verifyCode())
        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.isGuestUpgrade)
        assertTrue(viewModel.postAuthUiState.value.isGuestUpgrade)

        viewModel.completePendingPostAuthIfNeeded()
        advanceUntilIdle()

        assertEquals(1, cloudAccountRepository.completeGuestUpgradeCalls)
        assertEquals(0, cloudAccountRepository.completeCloudLinkCalls)
        assertEquals(1, syncRepository.syncNowCalls)
        assertEquals(listOf("Signed in and synced Spanish."), messages.messages)
        uiCollectionJob.cancel()
        postAuthCollectionJob.cancel()
    }

    @Test
    fun accountStatusUiMarksGuestState() = runTest(dispatcher) {
        val viewModel = AccountStatusViewModel(
            cloudAccountRepository = FakeCloudAccountRepository(initialCloudState = CloudAccountState.GUEST),
            syncRepository = FakeSyncRepository(),
            messageController = FakeMessageController(),
            workspaceRepository = FakeWorkspaceRepository()
        )
        val collectionJob = startCollecting(scope = this, viewModel = viewModel)

        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.isGuest)
        assertEquals("Guest AI", viewModel.uiState.value.cloudStatusTitle)
        assertEquals("Guest AI session", viewModel.uiState.value.syncStatusText)
        collectionJob.cancel()
    }

    @Test
    fun currentWorkspaceRetryRepeatsSyncWithoutRelinking() = runTest(dispatcher) {
        val messages = FakeMessageController()
        val workspaces = listOf(
            CloudWorkspaceSummary(
                workspaceId = "workspace-1",
                name = "Personal",
                createdAtMillis = 1L,
                isSelected = true
            ),
            CloudWorkspaceSummary(
                workspaceId = "workspace-2",
                name = "Spanish",
                createdAtMillis = 2L,
                isSelected = false
            )
        )
        val syncRepository = FakeSyncRepository(failuresRemaining = 1)
        val cloudAccountRepository = FakeCloudAccountRepository(
            linkedWorkspaces = workspaces
        )
        val viewModel = CurrentWorkspaceViewModel(
            cloudAccountRepository = cloudAccountRepository,
            syncRepository = syncRepository,
            messageController = messages,
            workspaceRepository = FakeWorkspaceRepository()
        )
        val collectionJob = startCollecting(scope = this, viewModel = viewModel)

        viewModel.loadWorkspaces()
        advanceUntilIdle()
        viewModel.switchWorkspace(selection = CloudWorkspaceLinkSelection.Existing(workspaceId = "workspace-2"))
        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.canRetryLastWorkspaceAction)
        assertEquals(CurrentWorkspaceOperation.IDLE, viewModel.uiState.value.operation)

        viewModel.retryLastWorkspaceAction()
        advanceUntilIdle()

        assertFalse(viewModel.uiState.value.canRetryLastWorkspaceAction)
        assertEquals(2, syncRepository.syncNowCalls)
        assertEquals(1, cloudAccountRepository.switchLinkedWorkspaceCalls)
        assertEquals(listOf("Current workspace is now Spanish."), messages.messages)
        collectionJob.cancel()
    }

    private fun startCollecting(
        scope: TestScope,
        viewModel: WorkspaceOverviewViewModel
    ): Job {
        return scope.launch {
            viewModel.uiState.collect()
        }
    }

    private fun startCollecting(
        scope: TestScope,
        viewModel: AgentConnectionsViewModel
    ): Job {
        return scope.launch {
            viewModel.uiState.collect()
        }
    }

    private fun startCollecting(
        scope: TestScope,
        viewModel: AccountDangerZoneViewModel
    ): Job {
        return scope.launch {
            viewModel.uiState.collect()
        }
    }

    private fun startCollecting(
        scope: TestScope,
        viewModel: AccountStatusViewModel
    ): Job {
        return scope.launch {
            viewModel.uiState.collect()
        }
    }

    private fun startCollecting(
        scope: TestScope,
        viewModel: CurrentWorkspaceViewModel
    ): Job {
        return scope.launch {
            viewModel.uiState.collect()
        }
    }

    private fun startCollecting(
        scope: TestScope,
        viewModel: CloudSignInViewModel
    ): Job {
        return scope.launch {
            viewModel.uiState.collect()
        }
    }

    private fun startCollectingPostAuth(
        scope: TestScope,
        viewModel: CloudSignInViewModel
    ): Job {
        return scope.launch {
            viewModel.postAuthUiState.collect()
        }
    }
}

private class FakeWorkspaceRepository : WorkspaceRepository {
    private val overviewState = MutableStateFlow(
        WorkspaceOverviewSummary(
            workspaceId = "workspace-1",
            workspaceName = "Personal",
            totalCards = 12,
            deckCount = 2,
            tagsCount = 3,
            dueCount = 4,
            newCount = 5,
            reviewedCount = 3
        )
    )

    override fun observeWorkspace(): Flow<WorkspaceSummary?> {
        return flowOf(
            WorkspaceSummary(
                workspaceId = "workspace-1",
                name = overviewState.value.workspaceName,
                createdAtMillis = 1L
            )
        )
    }

    override fun observeAppMetadata(): Flow<AppMetadataSummary> {
        return flowOf(
            AppMetadataSummary(
                currentWorkspaceName = overviewState.value.workspaceName,
                workspaceName = overviewState.value.workspaceName,
                deckCount = overviewState.value.deckCount,
                cardCount = overviewState.value.totalCards,
                localStorageLabel = "Room + SQLite",
                syncStatusText = "Synced"
            )
        )
    }

    override fun observeWorkspaceOverview(): Flow<WorkspaceOverviewSummary?> {
        return overviewState
    }

    override fun observeWorkspaceSchedulerSettings(): Flow<WorkspaceSchedulerSettings?> {
        return flowOf(null)
    }

    override fun observeWorkspaceTagsSummary(): Flow<WorkspaceTagsSummary> {
        return flowOf(
            WorkspaceTagsSummary(
                tags = listOf(WorkspaceTagSummary(tag = "android", cardsCount = 2)),
                totalCards = overviewState.value.totalCards
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

    fun renameWorkspace(name: String) {
        overviewState.value = overviewState.value.copy(workspaceName = name)
    }
}

private class FakeCloudAccountRepository(
    connections: List<AgentApiKeyConnection> = emptyList(),
    private val onRenameWorkspace: ((String) -> Unit)? = null,
    initialCloudState: CloudAccountState = CloudAccountState.LINKED,
    private val guestUpgradeMode: CloudGuestUpgradeMode? = null,
    private val sendCodeResult: CloudSendCodeResult = CloudSendCodeResult.OtpRequired(
        challenge = CloudOtpChallenge(
            email = "user@example.com",
            csrfToken = "csrf",
            otpSessionToken = "otp"
        )
    ),
    verifiedWorkspaces: List<CloudWorkspaceSummary> = emptyList(),
    linkedWorkspaces: List<CloudWorkspaceSummary> = emptyList()
) : CloudAccountRepository {
    private val cloudSettingsState = MutableStateFlow(
        CloudSettings(
            deviceId = "device-1",
            cloudState = initialCloudState,
            linkedUserId = if (initialCloudState == CloudAccountState.DISCONNECTED) null else "user-1",
            linkedWorkspaceId = if (initialCloudState == CloudAccountState.DISCONNECTED) null else "workspace-1",
            linkedEmail = if (initialCloudState == CloudAccountState.DISCONNECTED) null else "user@example.com",
            activeWorkspaceId = if (initialCloudState == CloudAccountState.DISCONNECTED) null else "workspace-1",
            updatedAtMillis = 1L
        )
    )
    val accountDeletionState = MutableStateFlow<AccountDeletionState>(AccountDeletionState.Hidden)
    private val connectionsState = MutableStateFlow(connections)
    private val verifiedWorkspacesState = MutableStateFlow(verifiedWorkspaces)
    private val linkedWorkspacesState = MutableStateFlow(linkedWorkspaces)
    var lastRenamedWorkspaceName: String? = null
    var switchLinkedWorkspaceCalls: Int = 0
    var completeCloudLinkCalls: Int = 0
    var completeGuestUpgradeCalls: Int = 0
    private var lastRequestedEmail: String = "user@example.com"

    override fun observeCloudSettings(): Flow<CloudSettings> {
        return cloudSettingsState
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

    override fun observeAccountDeletionState(): Flow<AccountDeletionState> {
        return accountDeletionState
    }

    override suspend fun beginAccountDeletion() {
        accountDeletionState.value = AccountDeletionState.InProgress
        cloudSettingsState.value = cloudSettingsState.value.copy(
            cloudState = CloudAccountState.DISCONNECTED,
            linkedUserId = null,
            linkedWorkspaceId = null,
            linkedEmail = null
        )
        accountDeletionState.value = AccountDeletionState.Hidden
    }

    override suspend fun resumePendingAccountDeletionIfNeeded() {
    }

    override suspend fun retryPendingAccountDeletion() {
        beginAccountDeletion()
    }

    override suspend fun sendCode(email: String): CloudSendCodeResult {
        lastRequestedEmail = email
        return when (sendCodeResult) {
            is CloudSendCodeResult.OtpRequired -> CloudSendCodeResult.OtpRequired(
                challenge = sendCodeResult.challenge.copy(email = email)
            )
            is CloudSendCodeResult.Verified -> sendCodeResult
        }
    }

    override suspend fun prepareVerifiedSignIn(credentials: StoredCloudCredentials): CloudWorkspaceLinkContext {
        cloudSettingsState.value = cloudSettingsState.value.copy(
            cloudState = CloudAccountState.LINKING_READY,
            linkedUserId = "user-1",
            linkedWorkspaceId = null,
            linkedEmail = lastRequestedEmail,
            activeWorkspaceId = null
        )
        return CloudWorkspaceLinkContext(
            userId = "user-1",
            email = lastRequestedEmail,
            workspaces = verifiedWorkspacesState.value,
            guestUpgradeMode = guestUpgradeMode
        )
    }

    override suspend fun verifyCode(
        challenge: CloudOtpChallenge,
        code: String
    ): CloudWorkspaceLinkContext {
        cloudSettingsState.value = cloudSettingsState.value.copy(
            cloudState = CloudAccountState.LINKING_READY,
            linkedUserId = "user-1",
            linkedWorkspaceId = null,
            linkedEmail = challenge.email,
            activeWorkspaceId = null
        )
        return CloudWorkspaceLinkContext(
            userId = "user-1",
            email = challenge.email,
            workspaces = verifiedWorkspacesState.value,
            guestUpgradeMode = guestUpgradeMode
        )
    }

    override suspend fun completeCloudLink(selection: CloudWorkspaceLinkSelection): CloudWorkspaceSummary {
        completeCloudLinkCalls += 1
        return applyPostAuthSelection(selection = selection)
    }

    override suspend fun completeGuestUpgrade(selection: CloudWorkspaceLinkSelection): CloudWorkspaceSummary {
        completeGuestUpgradeCalls += 1
        return applyPostAuthSelection(selection = selection)
    }

    override suspend fun logout() {
        cloudSettingsState.value = cloudSettingsState.value.copy(
            cloudState = CloudAccountState.DISCONNECTED,
            linkedUserId = null,
            linkedWorkspaceId = null,
            linkedEmail = null
        )
    }

    override suspend fun renameCurrentWorkspace(name: String): CloudWorkspaceSummary {
        lastRenamedWorkspaceName = name
        onRenameWorkspace?.invoke(name)
        return CloudWorkspaceSummary(
            workspaceId = "workspace-1",
            name = name,
            createdAtMillis = 1L,
            isSelected = true
        )
    }

    override suspend fun loadCurrentWorkspaceDeletePreview(): CloudWorkspaceDeletePreview {
        return CloudWorkspaceDeletePreview(
            workspaceId = "workspace-1",
            workspaceName = "Personal",
            activeCardCount = 12,
            confirmationText = "delete workspace",
            isLastAccessibleWorkspace = false
        )
    }

    override suspend fun deleteCurrentWorkspace(
        confirmationText: String
    ): CloudWorkspaceDeleteResult {
        return CloudWorkspaceDeleteResult(
            ok = true,
            deletedWorkspaceId = "workspace-1",
            deletedCardsCount = 12,
            workspace = CloudWorkspaceSummary(
                workspaceId = "workspace-2",
                name = "Replacement",
                createdAtMillis = 2L,
                isSelected = true
            )
        )
    }

    override suspend fun deleteAccount(confirmationText: String) {
        cloudSettingsState.value = cloudSettingsState.value.copy(
            cloudState = CloudAccountState.DISCONNECTED,
            linkedUserId = null,
            linkedWorkspaceId = null,
            linkedEmail = null
        )
    }

    override suspend fun listLinkedWorkspaces(): List<CloudWorkspaceSummary> {
        return linkedWorkspacesState.value
    }

    override suspend fun switchLinkedWorkspace(selection: CloudWorkspaceLinkSelection): CloudWorkspaceSummary {
        switchLinkedWorkspaceCalls += 1
        return applyPostAuthSelection(selection = selection)
    }

    private fun applyPostAuthSelection(selection: CloudWorkspaceLinkSelection): CloudWorkspaceSummary {
        val selectedWorkspace = when (selection) {
            is CloudWorkspaceLinkSelection.Existing -> linkedWorkspacesState.value.first { workspace ->
                workspace.workspaceId == selection.workspaceId
            }.copy(isSelected = true)

            CloudWorkspaceLinkSelection.CreateNew -> CloudWorkspaceSummary(
                workspaceId = "workspace-new",
                name = "New workspace",
                createdAtMillis = 3L,
                isSelected = true
            )
        }
        linkedWorkspacesState.value = (linkedWorkspacesState.value + selectedWorkspace)
            .distinctBy(CloudWorkspaceSummary::workspaceId)
            .map { workspace ->
                workspace.copy(isSelected = workspace.workspaceId == selectedWorkspace.workspaceId)
            }
        cloudSettingsState.value = cloudSettingsState.value.copy(
            cloudState = CloudAccountState.LINKED,
            linkedWorkspaceId = selectedWorkspace.workspaceId,
            activeWorkspaceId = selectedWorkspace.workspaceId
        )
        return selectedWorkspace
    }

    override suspend fun listAgentConnections(): AgentApiKeyConnectionsResult {
        return AgentApiKeyConnectionsResult(
            connections = connectionsState.value,
            instructions = "Manage long-lived bot connections."
        )
    }

    override suspend fun revokeAgentConnection(connectionId: String): AgentApiKeyConnectionsResult {
        val updatedConnection = connectionsState.value.first { connection ->
            connection.connectionId == connectionId
        }.copy(revokedAtMillis = 100L)
        connectionsState.value = connectionsState.value.map { connection ->
            if (connection.connectionId == connectionId) {
                updatedConnection
            } else {
                connection
            }
        }
        return AgentApiKeyConnectionsResult(
            connections = listOf(updatedConnection),
            instructions = "Manage long-lived bot connections."
        )
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

private class FakeSyncRepository : SyncRepository {
    constructor() : this(failuresRemaining = 0)

    constructor(failuresRemaining: Int) {
        this.failuresRemaining = failuresRemaining
    }

    var failuresRemaining: Int
    var syncNowCalls: Int = 0

    override fun observeSyncStatus(): Flow<com.flashcardsopensourceapp.data.local.model.SyncStatusSnapshot> {
        return flowOf(
            com.flashcardsopensourceapp.data.local.model.SyncStatusSnapshot(
                status = com.flashcardsopensourceapp.data.local.model.SyncStatus.Idle,
                lastSuccessfulSyncAtMillis = null,
                lastErrorMessage = ""
            )
        )
    }

    override suspend fun scheduleSync() {
    }

    override suspend fun syncNow() {
        syncNowCalls += 1
        if (failuresRemaining > 0) {
            failuresRemaining -= 1
            throw IllegalStateException("Sync failed.")
        }
    }
}

private class FakeMessageController : TransientMessageController {
    val messages = mutableListOf<String>()

    override fun showMessage(message: String) {
        messages += message
    }
}
