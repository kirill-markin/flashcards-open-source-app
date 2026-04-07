package com.flashcardsopensourceapp.feature.settings

import com.flashcardsopensourceapp.core.ui.TransientMessageController
import com.flashcardsopensourceapp.data.local.model.AccountDeletionState
import com.flashcardsopensourceapp.data.local.model.AgentApiKeyConnectionsResult
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudOtpChallenge
import com.flashcardsopensourceapp.data.local.model.CloudSendCodeResult
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.CloudSettings
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceDeletePreview
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceDeleteResult
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkContext
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceResetProgressPreview
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceResetProgressResult
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.SyncStatus
import com.flashcardsopensourceapp.data.local.model.SyncStatusSnapshot
import com.flashcardsopensourceapp.data.local.model.makeOfficialCloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class CloudSignInViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun lateVerifiedAttemptResultDoesNotReplaceCurrentPostAuthState() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        val repository = FakeCloudAccountRepository()
        val viewModel = CloudSignInViewModel(
            cloudAccountRepository = repository,
            syncRepository = FakeSyncRepository(),
            messageController = TransientMessageController { }
        )
        val postAuthCollection = backgroundScope.async {
            viewModel.postAuthUiState.collect()
        }
        val firstCredentials = makeCredentials(idToken = "id-token-1")
        val secondCredentials = makeCredentials(idToken = "id-token-2")
        val firstLinkContext = makeLinkContext(
            credentials = firstCredentials,
            email = "first@example.com",
            workspaceId = "workspace-first",
            workspaceName = "Workspace First"
        )
        val secondLinkContext = makeLinkContext(
            credentials = secondCredentials,
            email = "second@example.com",
            workspaceId = "workspace-second",
            workspaceName = "Workspace Second"
        )
        val blockedFirstPrepare = CompletableDeferred<CloudWorkspaceLinkContext>()
        repository.enqueueSendCodeResult(CloudSendCodeResult.Verified(credentials = firstCredentials))
        repository.enqueuePreparedLinkContext(
            idToken = firstCredentials.idToken,
            result = blockedFirstPrepare
        )
        repository.enqueueSendCodeResult(CloudSendCodeResult.Verified(credentials = secondCredentials))
        repository.enqueuePreparedLinkContext(
            idToken = secondCredentials.idToken,
            result = CompletableDeferred(secondLinkContext)
        )

        viewModel.updateEmail("first@example.com")
        val firstSendJob = backgroundScope.async {
            viewModel.sendCode()
        }
        advanceUntilIdle()

        viewModel.updateEmail("second@example.com")
        val secondOutcome = viewModel.sendCode()
        advanceUntilIdle()

        blockedFirstPrepare.complete(firstLinkContext)
        advanceUntilIdle()

        assertEquals(CloudSendCodeNavigationOutcome.Verified, secondOutcome)
        assertEquals(CloudSendCodeNavigationOutcome.NoNavigation, firstSendJob.await())
        assertEquals(CloudPostAuthMode.READY_TO_AUTO_LINK, viewModel.postAuthUiState.value.mode)
        assertEquals("second@example.com", viewModel.postAuthUiState.value.verifiedEmail)
        assertEquals("Workspace Second", viewModel.postAuthUiState.value.pendingWorkspaceTitle)
        assertEquals("workspace-second", viewModel.postAuthUiState.value.workspaces.first().workspaceId)

        postAuthCollection.cancel()
    }

    private fun makeCredentials(idToken: String): StoredCloudCredentials {
        return StoredCloudCredentials(
            refreshToken = "refresh-$idToken",
            idToken = idToken,
            idTokenExpiresAtMillis = Long.MAX_VALUE
        )
    }

    private fun makeLinkContext(
        credentials: StoredCloudCredentials,
        email: String,
        workspaceId: String,
        workspaceName: String
    ): CloudWorkspaceLinkContext {
        return CloudWorkspaceLinkContext(
            userId = "user-$workspaceId",
            email = email,
            credentials = credentials,
            workspaces = listOf(
                CloudWorkspaceSummary(
                    workspaceId = workspaceId,
                    name = workspaceName,
                    createdAtMillis = 100L,
                    isSelected = true
                )
            ),
            guestUpgradeMode = null,
            preferredWorkspaceId = workspaceId
        )
    }
}

private class FakeCloudAccountRepository : CloudAccountRepository {
    private val cloudSettings = MutableStateFlow(
        CloudSettings(
            installationId = "installation-1",
            cloudState = CloudAccountState.DISCONNECTED,
            linkedUserId = null,
            linkedWorkspaceId = null,
            linkedEmail = null,
            activeWorkspaceId = "workspace-local",
            updatedAtMillis = 0L
        )
    )
    private val accountDeletionState = MutableStateFlow<AccountDeletionState>(AccountDeletionState.Hidden)
    private val serverConfiguration = MutableStateFlow(makeOfficialCloudServiceConfiguration())
    private val sendCodeResults = ArrayDeque<CloudSendCodeResult>()
    private val preparedLinkContexts = mutableMapOf<String, CompletableDeferred<CloudWorkspaceLinkContext>>()

    fun enqueueSendCodeResult(result: CloudSendCodeResult) {
        sendCodeResults.addLast(result)
    }

    fun enqueuePreparedLinkContext(
        idToken: String,
        result: CompletableDeferred<CloudWorkspaceLinkContext>
    ) {
        preparedLinkContexts[idToken] = result
    }

    override fun observeCloudSettings(): Flow<CloudSettings> {
        return cloudSettings
    }

    override fun observeAccountDeletionState(): Flow<AccountDeletionState> {
        return accountDeletionState
    }

    override fun observeServerConfiguration(): Flow<CloudServiceConfiguration> {
        return serverConfiguration
    }

    override suspend fun beginAccountDeletion() {
        throw UnsupportedOperationException()
    }

    override suspend fun resumePendingAccountDeletionIfNeeded() {
        throw UnsupportedOperationException()
    }

    override suspend fun retryPendingAccountDeletion() {
        throw UnsupportedOperationException()
    }

    override suspend fun sendCode(email: String): CloudSendCodeResult {
        return sendCodeResults.removeFirst()
    }

    override suspend fun prepareVerifiedSignIn(credentials: StoredCloudCredentials): CloudWorkspaceLinkContext {
        return requireNotNull(preparedLinkContexts[credentials.idToken]) {
            "Missing prepared link context for ${credentials.idToken}"
        }.await()
    }

    override suspend fun verifyCode(challenge: CloudOtpChallenge, code: String): CloudWorkspaceLinkContext {
        throw UnsupportedOperationException()
    }

    override suspend fun completeCloudLink(
        linkContext: CloudWorkspaceLinkContext,
        selection: CloudWorkspaceLinkSelection
    ): CloudWorkspaceSummary {
        throw UnsupportedOperationException()
    }

    override suspend fun completeGuestUpgrade(
        linkContext: CloudWorkspaceLinkContext,
        selection: CloudWorkspaceLinkSelection
    ): CloudWorkspaceSummary {
        throw UnsupportedOperationException()
    }

    override suspend fun completeLinkedWorkspaceTransition(selection: CloudWorkspaceLinkSelection): CloudWorkspaceSummary {
        throw UnsupportedOperationException()
    }

    override suspend fun logout() {
        throw UnsupportedOperationException()
    }

    override suspend fun renameCurrentWorkspace(name: String): CloudWorkspaceSummary {
        throw UnsupportedOperationException()
    }

    override suspend fun loadCurrentWorkspaceDeletePreview(): CloudWorkspaceDeletePreview {
        throw UnsupportedOperationException()
    }

    override suspend fun deleteCurrentWorkspace(confirmationText: String): CloudWorkspaceDeleteResult {
        throw UnsupportedOperationException()
    }

    override suspend fun loadCurrentWorkspaceResetProgressPreview(): CloudWorkspaceResetProgressPreview {
        throw UnsupportedOperationException()
    }

    override suspend fun resetCurrentWorkspaceProgress(confirmationText: String): CloudWorkspaceResetProgressResult {
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

    override suspend fun listAgentConnections(): AgentApiKeyConnectionsResult {
        throw UnsupportedOperationException()
    }

    override suspend fun revokeAgentConnection(connectionId: String): AgentApiKeyConnectionsResult {
        throw UnsupportedOperationException()
    }

    override suspend fun currentServerConfiguration(): CloudServiceConfiguration {
        return makeOfficialCloudServiceConfiguration()
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
    private val syncStatus = MutableStateFlow(
        SyncStatusSnapshot(
            status = SyncStatus.Idle,
            lastSuccessfulSyncAtMillis = null,
            lastErrorMessage = ""
        )
    )

    override fun observeSyncStatus(): Flow<SyncStatusSnapshot> {
        return syncStatus
    }

    override suspend fun scheduleSync() {
    }

    override suspend fun syncNow() {
    }
}
