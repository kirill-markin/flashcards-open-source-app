package com.flashcardsopensourceapp.data.local.cloudidentity

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LocalSyncRepositoryCoordinatorLockingTest {
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
    fun syncReadsLinkedWorkspaceAfterCoordinatorLockIsReleased() = runBlocking {
        val initialLocalWorkspaceId = environment.requireLocalWorkspaceId()
        val lockAcquired = CompletableDeferred<Unit>()
        val releaseLock = CompletableDeferred<Unit>()
        val remoteGateway = FakeCloudRemoteGateway.standard()
        val syncRepository = environment.createSyncRepository(remoteGateway = remoteGateway)

        environment.prepareLinkedCloudIdentity(localWorkspaceId = initialLocalWorkspaceId)
        val lockJob = launch {
            environment.operationCoordinator.runExclusive {
                lockAcquired.complete(Unit)
                releaseLock.await()
            }
        }
        lockAcquired.await()
        environment.createWorkspaceShell(
            workspaceId = "workspace-after-lock",
            createdAtMillis = 200L
        )
        environment.cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.LINKED,
            linkedUserId = "user-1",
            linkedWorkspaceId = "workspace-after-lock",
            linkedEmail = "user@example.com",
            activeWorkspaceId = "workspace-after-lock"
        )

        val syncJob = launch {
            syncRepository.syncNow()
        }

        assertTrue(remoteGateway.bootstrapPullWorkspaceIds.isEmpty())

        releaseLock.complete(Unit)
        syncJob.join()
        lockJob.join()

        assertEquals(listOf("workspace-after-lock"), remoteGateway.bootstrapPullWorkspaceIds)
    }
}
