package com.flashcardsopensourceapp.data.local.repository.progress

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.core.observability.AndroidBreadcrumbEvent
import com.flashcardsopensourceapp.core.observability.AndroidExceptionIssueEvent
import com.flashcardsopensourceapp.core.observability.AndroidWarningIssueEvent
import com.flashcardsopensourceapp.core.observability.AppObservability
import com.flashcardsopensourceapp.core.observability.CloudObservationIdentity
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.sync.SyncStatus
import com.flashcardsopensourceapp.data.local.model.sync.SyncStatusSnapshot
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.CloudIdentityTestEnvironment
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.FakeCloudRemoteGateway
import com.flashcardsopensourceapp.data.local.repository.progress.cache.LocalProgressCacheStore
import com.flashcardsopensourceapp.data.local.repository.progress.cache.ProgressLocalCacheReadinessCoordinator
import com.flashcardsopensourceapp.data.local.repository.progress.inputs.createProgressClockSnapshot
import com.flashcardsopensourceapp.data.local.repository.progress.inputs.observeProgressInputs
import com.flashcardsopensourceapp.data.local.repository.progress.orchestration.ProgressSummaryOrchestration
import com.flashcardsopensourceapp.data.local.repository.progress.runtime.ProgressBackgroundLauncher
import com.flashcardsopensourceapp.data.local.repository.progress.runtime.ProgressObservationVersions
import com.flashcardsopensourceapp.data.local.repository.shared.SystemTimeProvider
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ProgressSummaryIdentityTransitionIntegrationTest {
    private lateinit var environment: CloudIdentityTestEnvironment

    @Before
    fun setUp() = runBlocking {
        environment = CloudIdentityTestEnvironment.create()
    }

    @After
    fun tearDown() {
        environment.close()
    }

    @Test
    fun linkedRefreshQueuedAcrossIdentityResetDoesNotEmitRemoteLoadWarning() = runBlocking {
        val workspaceId = environment.requireLocalWorkspaceId()
        val remoteGateway = FakeCloudRemoteGateway.standard()
        val syncRepository = TestSyncRepository()
        val observability = RecordingAppObservability()
        val appJob = SupervisorJob(coroutineContext[Job])
        val appScope = CoroutineScope(context = coroutineContext + appJob)

        try {
            environment.prepareLinkedCloudIdentity(localWorkspaceId = workspaceId)
            val linkedInputs = observeProgressInputs(
                database = environment.database,
                preferencesStore = environment.cloudPreferencesStore,
                syncRepository = syncRepository,
                timeProvider = SystemTimeProvider
            ).first()
            assertEquals(CloudAccountState.LINKED, linkedInputs.cloudSettings.cloudState)
            assertTrue(linkedInputs.syncStates.isNotEmpty())
            val clockSnapshot = createProgressClockSnapshot(timeProvider = SystemTimeProvider)

            val orchestration = ProgressSummaryOrchestration(
                database = environment.database,
                cloudAccountRepository = environment.createCloudAccountRepository(
                    remoteGateway = remoteGateway
                ),
                syncRepository = syncRepository,
                timeProvider = SystemTimeProvider,
                cacheReadinessCoordinator = ProgressLocalCacheReadinessCoordinator(
                    localProgressCacheStore = LocalProgressCacheStore(
                        database = environment.database,
                        timeProvider = SystemTimeProvider
                    ),
                    timeProvider = SystemTimeProvider
                ),
                backgroundLauncher = ProgressBackgroundLauncher(
                    appScope = appScope,
                    observability = observability,
                    observationVersions = testObservationVersions
                ),
                observability = observability,
                observationVersions = testObservationVersions
            )
            orchestration.handleInputs(
                inputs = linkedInputs,
                clockSnapshot = clockSnapshot
            )
            val handledInputs = orchestration.handleInputs(
                inputs = linkedInputs.copy(
                    syncStates = linkedInputs.syncStates.map { syncState ->
                        syncState.copy(lastReviewSequenceId = syncState.lastReviewSequenceId + 1L)
                    },
                    syncStatus = linkedInputs.syncStatus.copy(lastSuccessfulSyncAtMillis = 200L)
                ),
                clockSnapshot = clockSnapshot
            )
            val lockAcquired = CompletableDeferred<Unit>()
            val resetAllowed = CompletableDeferred<Unit>()
            val lockJob = launch {
                environment.operationCoordinator.runExclusive {
                    lockAcquired.complete(Unit)
                    resetAllowed.await()
                    environment.resetCoordinator.resetLocalStateForCloudIdentityChange()
                }
            }
            try {
                lockAcquired.await()

                orchestration.launchSyncCompletedRefreshIfNeeded(handledInputs = handledInputs)
                val refreshJob = requireNotNull(appJob.children.singleOrNull()) {
                    "Expected one queued Progress summary refresh."
                }
                yield()
                assertFalse(refreshJob.isCompleted)

                resetAllowed.complete(Unit)
                lockJob.join()
                refreshJob.join()

                assertEquals(
                    CloudAccountState.DISCONNECTED,
                    environment.cloudPreferencesStore.currentCloudSettings().cloudState
                )
                assertTrue(observability.warnings.isEmpty())
                assertTrue(observability.exceptions.isEmpty())
            } finally {
                resetAllowed.complete(Unit)
                lockJob.join()
            }
        } finally {
            appScope.cancel()
        }
    }
}

private class TestSyncRepository : SyncRepository {
    private val status = MutableStateFlow(
        SyncStatusSnapshot(
            status = SyncStatus.Idle,
            lastSuccessfulSyncAtMillis = 100L,
            lastErrorMessage = ""
        )
    )

    override fun observeSyncStatus(): Flow<SyncStatusSnapshot> {
        return status
    }

    override suspend fun scheduleSync() {
        error("Sync is not expected for a sync-completed Progress refresh.")
    }

    override suspend fun syncNow() {
        error("Sync is not expected for a sync-completed Progress refresh.")
    }
}

private class RecordingAppObservability : AppObservability {
    val warnings = mutableListOf<AndroidWarningIssueEvent>()
    val exceptions = mutableListOf<AndroidExceptionIssueEvent>()

    override fun setCloudIdentity(identity: CloudObservationIdentity) = Unit

    override fun clearCloudIdentity() = Unit

    override fun addBreadcrumb(event: AndroidBreadcrumbEvent) = Unit

    override fun captureWarning(event: AndroidWarningIssueEvent) {
        warnings.add(event)
    }

    override fun captureException(event: AndroidExceptionIssueEvent) {
        exceptions.add(event)
    }
}

private val testObservationVersions = ProgressObservationVersions(
    appVersion = "1.0.0",
    clientVersion = "1.0.0",
    versionCode = 1
)
