package com.flashcardsopensourceapp.feature.progress

import androidx.lifecycle.Lifecycle
import com.flashcardsopensourceapp.data.local.model.AccountDeletionState
import com.flashcardsopensourceapp.data.local.model.AgentApiKeyConnectionsResult
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudDailyReviewPoint
import com.flashcardsopensourceapp.data.local.model.CloudOtpChallenge
import com.flashcardsopensourceapp.data.local.model.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.CloudSendCodeResult
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode
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
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withContext
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

@OptIn(ExperimentalCoroutinesApi::class)
class ProgressViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Test
    fun resumedLifecycleTriggersInitialProgressLoad() {
        val shouldTrigger = shouldTriggerInitialProgressLoad(
            lifecycleState = Lifecycle.State.RESUMED
        )

        assertTrue(shouldTrigger)
    }

    @Test
    fun nonResumedLifecycleDoesNotTriggerInitialProgressLoad() {
        assertEquals(
            false,
            shouldTriggerInitialProgressLoad(lifecycleState = Lifecycle.State.CREATED)
        )
        assertEquals(
            false,
            shouldTriggerInitialProgressLoad(lifecycleState = Lifecycle.State.STARTED)
        )
    }

    @Test
    fun disconnectedStateRequiresSignIn() {
        val uiState = unsupportedProgressUiStateForCloudState(
            cloudState = CloudAccountState.DISCONNECTED
        )

        assertEquals(ProgressUiState.SignInRequired, uiState)
    }

    @Test
    fun linkingReadyStateRendersUnavailableGuidance() {
        val uiState = unsupportedProgressUiStateForCloudState(
            cloudState = CloudAccountState.LINKING_READY
        )

        assertEquals(ProgressUiState.Unavailable, uiState)
    }

    @Test
    fun linkedAndGuestStatesRemainLoadable() {
        val linkedUiState = unsupportedProgressUiStateForCloudState(
            cloudState = CloudAccountState.LINKED
        )
        val guestUiState = unsupportedProgressUiStateForCloudState(
            cloudState = CloudAccountState.GUEST
        )

        assertNull(linkedUiState)
        assertNull(guestUiState)
    }

    @Test
    fun initialCloudStateObservationDoesNotTriggerLoadBeforeScreenVisible() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        try {
            val operations = mutableListOf<String>()
            val repository = FakeCloudAccountRepository(
                cloudState = CloudAccountState.LINKED,
                onProgressLoadStarted = {
                    operations.add("progress")
                }
            )
            val syncRepository = FakeSyncRepository(
                onSyncStarted = {
                    operations.add("sync")
                }
            )
            val initialSync = CompletableDeferred<SyncResult>()
            val initialSuccess = CompletableDeferred<ProgressLoadResult>()
            syncRepository.enqueueSyncResult(result = initialSync)
            repository.enqueueProgressResult(result = initialSuccess)

            val viewModel = ProgressViewModel(
                cloudAccountRepository = repository,
                syncRepository = syncRepository
            )
            advanceUntilIdle()

            assertEquals(0, repository.progressLoadCallCount)
            assertEquals(0, syncRepository.syncCallCount)
            assertEquals(ProgressUiState.Loading, viewModel.uiState.value)

            viewModel.loadProgress()
            advanceUntilIdle()

            assertEquals(1, syncRepository.syncCallCount)
            assertEquals(0, repository.progressLoadCallCount)
            assertEquals(listOf("sync"), operations)

            initialSync.complete(SyncResult.Success)
            advanceUntilIdle()

            assertEquals(1, repository.progressLoadCallCount)
            assertEquals(listOf("sync", "progress"), operations)

            initialSuccess.complete(
                ProgressLoadResult.Success(
                    progressSeries = createProgressSeriesForToday()
                )
            )
            advanceUntilIdle()

            assertTrue(viewModel.uiState.value is ProgressUiState.Loaded)
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun staleSameStateFailureDoesNotReplaceNewerLoadedState() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        try {
            val repository = FakeCloudAccountRepository(
                cloudState = CloudAccountState.LINKED,
                onProgressLoadStarted = {}
            )
            val syncRepository = FakeSyncRepository(
                onSyncStarted = {}
            )
            val staleFailure = CompletableDeferred<ProgressLoadResult>()
            val latestSuccess = CompletableDeferred<ProgressLoadResult>()
            syncRepository.enqueueSyncResult(result = CompletableDeferred(SyncResult.Success))
            syncRepository.enqueueSyncResult(result = CompletableDeferred(SyncResult.Success))
            repository.enqueueProgressResult(result = staleFailure)
            repository.enqueueProgressResult(result = latestSuccess)

            val viewModel = ProgressViewModel(
                cloudAccountRepository = repository,
                syncRepository = syncRepository
            )
            advanceUntilIdle()

            viewModel.loadProgress()
            advanceUntilIdle()

            viewModel.loadProgress()
            advanceUntilIdle()

            latestSuccess.complete(
                ProgressLoadResult.Success(
                    progressSeries = createProgressSeriesForToday()
                )
            )
            advanceUntilIdle()

            val loadedState = viewModel.uiState.value
            assertTrue(loadedState is ProgressUiState.Loaded)

            staleFailure.complete(
                ProgressLoadResult.Failure(
                    error = IllegalStateException("stale failure")
                )
            )
            advanceUntilIdle()

            assertEquals(loadedState, viewModel.uiState.value)
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun syncFailureShowsErrorWithoutRequestingProgress() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        try {
            val repository = FakeCloudAccountRepository(
                cloudState = CloudAccountState.LINKED,
                onProgressLoadStarted = {}
            )
            val syncRepository = FakeSyncRepository(
                onSyncStarted = {}
            )
            val failedSync = CompletableDeferred<SyncResult>()
            syncRepository.enqueueSyncResult(result = failedSync)

            val viewModel = ProgressViewModel(
                cloudAccountRepository = repository,
                syncRepository = syncRepository
            )
            advanceUntilIdle()

            viewModel.loadProgress()
            advanceUntilIdle()

            failedSync.complete(
                SyncResult.Failure(
                    error = IllegalStateException("sync failed")
                )
            )
            advanceUntilIdle()

            assertEquals(1, syncRepository.syncCallCount)
            assertEquals(0, repository.progressLoadCallCount)
            assertTrue(viewModel.uiState.value is ProgressUiState.Error)
        } finally {
            Dispatchers.resetMain()
        }
    }
}

private sealed interface ProgressLoadResult {
    data class Success(
        val progressSeries: CloudProgressSeries
    ) : ProgressLoadResult

    data class Failure(
        val error: Exception
    ) : ProgressLoadResult
}

private sealed interface SyncResult {
    data object Success : SyncResult

    data class Failure(
        val error: Exception
    ) : SyncResult
}

private class FakeCloudAccountRepository(
    cloudState: CloudAccountState,
    private val onProgressLoadStarted: () -> Unit
) : CloudAccountRepository {
    private val cloudSettings = MutableStateFlow(
        CloudSettings(
            installationId = "installation-1",
            cloudState = cloudState,
            linkedUserId = "user-1",
            linkedWorkspaceId = "workspace-1",
            linkedEmail = "user@example.com",
            activeWorkspaceId = "workspace-1",
            updatedAtMillis = 0L
        )
    )
    private val accountDeletionState = MutableStateFlow<AccountDeletionState>(AccountDeletionState.Hidden)
    private val serverConfiguration = MutableStateFlow(createOfficialServerConfiguration())
    private val progressResults = ArrayDeque<CompletableDeferred<ProgressLoadResult>>()
    var progressLoadCallCount: Int = 0
        private set

    fun enqueueProgressResult(
        result: CompletableDeferred<ProgressLoadResult>
    ) {
        progressResults.addLast(result)
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
        throw UnsupportedOperationException()
    }

    override suspend fun prepareVerifiedSignIn(credentials: StoredCloudCredentials): CloudWorkspaceLinkContext {
        throw UnsupportedOperationException()
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

    override suspend fun loadProgressSeries(
        timeZone: String,
        from: String,
        to: String
    ): CloudProgressSeries {
        onProgressLoadStarted()
        progressLoadCallCount += 1
        if (progressResults.isEmpty()) {
            throw IllegalStateException("Missing queued progress result.")
        }
        val deferredResult = progressResults.removeFirst()
        val resolvedResult = try {
            deferredResult.await()
        } catch (error: CancellationException) {
            withContext(NonCancellable) {
                deferredResult.await()
            }
        }

        return when (resolvedResult) {
            is ProgressLoadResult.Success -> resolvedResult.progressSeries
            is ProgressLoadResult.Failure -> throw resolvedResult.error
        }
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
        return createOfficialServerConfiguration()
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

private class FakeSyncRepository(
    private val onSyncStarted: () -> Unit
) : SyncRepository {
    private val syncResults = ArrayDeque<CompletableDeferred<SyncResult>>()
    private val syncStatus = MutableStateFlow(
        SyncStatusSnapshot(
            status = SyncStatus.Idle,
            lastSuccessfulSyncAtMillis = null,
            lastErrorMessage = ""
        )
    )
    var syncCallCount: Int = 0
        private set

    fun enqueueSyncResult(
        result: CompletableDeferred<SyncResult>
    ) {
        syncResults.addLast(result)
    }

    override fun observeSyncStatus(): Flow<SyncStatusSnapshot> {
        return syncStatus
    }

    override suspend fun scheduleSync() {
        syncNow()
    }

    override suspend fun syncNow() {
        onSyncStarted()
        syncCallCount += 1
        if (syncResults.isEmpty()) {
            return
        }
        val deferredResult = syncResults.removeFirst()
        val resolvedResult = try {
            deferredResult.await()
        } catch (error: CancellationException) {
            withContext(NonCancellable) {
                deferredResult.await()
            }
        }

        when (resolvedResult) {
            SyncResult.Success -> Unit
            is SyncResult.Failure -> throw resolvedResult.error
        }
    }
}

private fun createOfficialServerConfiguration(): CloudServiceConfiguration {
    return CloudServiceConfiguration(
        mode = CloudServiceConfigurationMode.OFFICIAL,
        customOrigin = null,
        apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
        authBaseUrl = "https://auth.flashcards-open-source-app.com"
    )
}

private fun createProgressSeriesForToday(): CloudProgressSeries {
    val today = LocalDate.now(ZoneId.systemDefault()).toString()

    return CloudProgressSeries(
        timeZone = ZoneId.systemDefault().id,
        from = today,
        to = today,
        dailyReviews = listOf(
            CloudDailyReviewPoint(
                date = today,
                reviewCount = 3
            )
        )
    )
}
