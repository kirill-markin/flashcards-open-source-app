package com.flashcardsopensourceapp.data.local

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.bootstrap.localWorkspaceName
import com.flashcardsopensourceapp.data.local.cloud.CloudRemoteException
import com.flashcardsopensourceapp.data.local.database.CardEntity
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.FsrsCardState
import com.flashcardsopensourceapp.data.local.model.SyncStatus
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LocalSyncRepositoryCloudIdentityTest {
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
    fun syncResetsLocalStateWhenRemoteAccountIsDeleted() = runBlocking {
        val initialLocalWorkspaceId = environment.requireLocalWorkspaceId()
        val remoteGateway = FakeCloudRemoteGateway.forFetchAccountError(
            fetchAccountError = CloudRemoteException(
                message = "Cloud request failed with status 410 for /me",
                statusCode = 410,
                responseBody = JSONObject()
                    .put("code", "ACCOUNT_DELETED")
                    .put("requestId", "request-1")
                    .toString(),
                errorCode = "ACCOUNT_DELETED",
                requestId = "request-1"
            )
        )
        val repository = environment.createSyncRepository(remoteGateway = remoteGateway)

        environment.prepareLinkedCloudIdentity(localWorkspaceId = initialLocalWorkspaceId)
        environment.aiChatPreferencesStore.updateConsent(hasConsent = true)

        repository.syncNow()

        val resetWorkspace = requireNotNull(environment.database.workspaceDao().loadAnyWorkspace()) {
            "Expected a local workspace after remote deletion."
        }

        assertEquals(CloudAccountState.DISCONNECTED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(
            com.flashcardsopensourceapp.data.local.model.AccountDeletionState.Hidden,
            environment.cloudPreferencesStore.currentAccountDeletionState()
        )
        assertNull(environment.cloudPreferencesStore.loadCredentials())
        assertTrue(environment.aiChatPreferencesStore.hasConsent().not())
        assertEquals(SyncStatus.Idle, repository.observeSyncStatus().first().status)
        assertEquals(localWorkspaceName, resetWorkspace.name)
        assertNotEquals(initialLocalWorkspaceId, resetWorkspace.workspaceId)
    }

    @Test
    fun syncRestoresStoredGuestSessionBeforeRunningWhenDisconnected() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val guestWorkspaceId = "guest-workspace"
        val remoteGateway = FakeCloudRemoteGateway.standard()
        val syncRepository = environment.createSyncRepository(remoteGateway = remoteGateway)
        environment.cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.DISCONNECTED,
            linkedUserId = null,
            linkedWorkspaceId = null,
            linkedEmail = null,
            activeWorkspaceId = localWorkspaceId
        )
        environment.guestAiSessionStore.saveSession(
            localWorkspaceId = guestWorkspaceId,
            session = createStoredGuestAiSession(
                workspaceId = guestWorkspaceId,
                configurationMode = CloudServiceConfigurationMode.OFFICIAL,
                apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
                guestToken = "guest-token",
                userId = "guest-user"
            )
        )

        syncRepository.syncNow()

        val cloudSettings = environment.cloudPreferencesStore.currentCloudSettings()
        assertEquals(CloudAccountState.GUEST, cloudSettings.cloudState)
        assertEquals(guestWorkspaceId, cloudSettings.activeWorkspaceId)
        assertEquals(guestWorkspaceId, environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        assertEquals(listOf(guestWorkspaceId), remoteGateway.bootstrapPullWorkspaceIds)
    }

    @Test
    fun syncKeepsDisconnectedStateWhenStoredCredentialsExistButCloudStateIsDisconnected() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val remoteGateway = FakeCloudRemoteGateway.forAccountSnapshot(
            accountSnapshot = createCloudAccountSnapshot(
                userId = "user-1",
                email = "user@example.com",
                workspaces = listOf(
                    createCloudWorkspaceSummary(
                        workspaceId = "workspace-linked",
                        name = "Personal",
                        createdAtMillis = 200L,
                        isSelected = true
                    )
                )
            )
        )
        val syncRepository = environment.createSyncRepository(remoteGateway = remoteGateway)
        environment.cloudPreferencesStore.saveCredentials(
            createStoredCloudCredentials(idTokenExpiresAtMillis = Long.MAX_VALUE)
        )
        environment.cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.DISCONNECTED,
            linkedUserId = null,
            linkedWorkspaceId = null,
            linkedEmail = null,
            activeWorkspaceId = localWorkspaceId
        )

        try {
            syncRepository.syncNow()
        } catch (_: IllegalStateException) {
        }

        val cloudSettings = environment.cloudPreferencesStore.currentCloudSettings()
        assertEquals(CloudAccountState.DISCONNECTED, cloudSettings.cloudState)
        assertEquals(localWorkspaceId, cloudSettings.activeWorkspaceId)
        assertNull(cloudSettings.linkedWorkspaceId)
        assertNull(cloudSettings.linkedEmail)
        assertEquals(localWorkspaceId, environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        assertTrue(syncRepository.observeSyncStatus().first().status is SyncStatus.Failed)
        assertTrue(remoteGateway.bootstrapPullWorkspaceIds.isEmpty())
    }

    @Test
    fun syncKeepsDisconnectedStateWhenLocalShellContainsData() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val remoteGateway = FakeCloudRemoteGateway.standard()
        val syncRepository = environment.createSyncRepository(remoteGateway = remoteGateway)
        environment.cloudPreferencesStore.saveCredentials(
            createStoredCloudCredentials(idTokenExpiresAtMillis = Long.MAX_VALUE)
        )
        environment.cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.DISCONNECTED,
            linkedUserId = null,
            linkedWorkspaceId = null,
            linkedEmail = null,
            activeWorkspaceId = localWorkspaceId
        )
        environment.database.cardDao().insertCard(
            CardEntity(
                cardId = "card-1",
                workspaceId = localWorkspaceId,
                frontText = "Question",
                backText = "Answer",
                effortLevel = EffortLevel.FAST,
                dueAtMillis = null,
                createdAtMillis = 100L,
                updatedAtMillis = 100L,
                reps = 0,
                lapses = 0,
                fsrsCardState = FsrsCardState.NEW,
                fsrsStepIndex = null,
                fsrsStability = null,
                fsrsDifficulty = null,
                fsrsLastReviewedAtMillis = null,
                fsrsScheduledDays = null,
                deletedAtMillis = null
            )
        )

        try {
            syncRepository.syncNow()
        } catch (_: IllegalStateException) {
        }

        val cloudSettings = environment.cloudPreferencesStore.currentCloudSettings()
        assertEquals(CloudAccountState.DISCONNECTED, cloudSettings.cloudState)
        assertEquals(localWorkspaceId, cloudSettings.activeWorkspaceId)
        assertEquals(localWorkspaceId, environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        assertTrue(remoteGateway.bootstrapPullWorkspaceIds.isEmpty())
    }

    @Test
    fun syncResetsInvalidGuestStateWhenStoredGuestSessionIsMissing() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val initialInstallationId = environment.cloudPreferencesStore.currentCloudSettings().installationId
        val syncRepository = environment.createSyncRepository(
            remoteGateway = FakeCloudRemoteGateway.standard()
        )
        environment.cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.GUEST,
            linkedUserId = "guest-user",
            linkedWorkspaceId = localWorkspaceId,
            linkedEmail = null,
            activeWorkspaceId = localWorkspaceId
        )

        try {
            syncRepository.syncNow()
        } catch (_: IllegalStateException) {
        }

        val resetWorkspace = requireNotNull(environment.database.workspaceDao().loadAnyWorkspace()) {
            "Expected a local workspace after guest reset."
        }
        assertEquals(CloudAccountState.DISCONNECTED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(resetWorkspace.workspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertNotEquals(initialInstallationId, environment.cloudPreferencesStore.currentCloudSettings().installationId)
    }

    @Test
    fun syncResetsStaleActiveWorkspaceBeforeRunning() = runBlocking {
        val syncRepository = environment.createSyncRepository(
            remoteGateway = FakeCloudRemoteGateway.standard()
        )
        environment.cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.DISCONNECTED,
            linkedUserId = null,
            linkedWorkspaceId = null,
            linkedEmail = null,
            activeWorkspaceId = "stale-workspace-id"
        )

        try {
            syncRepository.syncNow()
        } catch (_: IllegalStateException) {
        }

        val cloudSettings = environment.cloudPreferencesStore.currentCloudSettings()
        val resetWorkspace = requireNotNull(environment.database.workspaceDao().loadAnyWorkspace()) {
            "Expected a local workspace after stale active workspace reset."
        }
        assertEquals(CloudAccountState.DISCONNECTED, cloudSettings.cloudState)
        assertEquals(resetWorkspace.workspaceId, cloudSettings.activeWorkspaceId)
    }

    @Test
    fun syncBlocksInstallationPlatformMismatchWithoutResettingIdentity() = runBlocking {
        val initialLocalWorkspaceId = environment.requireLocalWorkspaceId()
        val initialInstallationId = environment.cloudPreferencesStore.currentCloudSettings().installationId
        val remoteGateway = FakeCloudRemoteGateway.forBootstrapPullError(
            bootstrapPullError = CloudRemoteException(
                message = "Cloud request failed with status 409 for /sync/bootstrap-pull",
                statusCode = 409,
                responseBody = JSONObject()
                    .put("code", "SYNC_INSTALLATION_PLATFORM_MISMATCH")
                    .put("requestId", "request-platform-mismatch")
                    .toString(),
                errorCode = "SYNC_INSTALLATION_PLATFORM_MISMATCH",
                requestId = "request-platform-mismatch"
            )
        )
        val syncRepository = environment.createSyncRepository(remoteGateway = remoteGateway)

        environment.prepareLinkedCloudIdentity(localWorkspaceId = initialLocalWorkspaceId)

        try {
            syncRepository.syncNow()
        } catch (_: CloudRemoteException) {
        }

        val cloudSettings = environment.cloudPreferencesStore.currentCloudSettings()
        val syncStatus = syncRepository.observeSyncStatus().first().status
        assertEquals(CloudAccountState.LINKED, cloudSettings.cloudState)
        assertEquals(initialInstallationId, cloudSettings.installationId)
        assertEquals(initialLocalWorkspaceId, cloudSettings.activeWorkspaceId)
        assertEquals(initialLocalWorkspaceId, environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        assertNotNull(environment.cloudPreferencesStore.loadCredentials())
        assertTrue(syncStatus is SyncStatus.Blocked)
        assertEquals(
            "Cloud request failed with status 409 for /sync/bootstrap-pull",
            (syncStatus as SyncStatus.Blocked).message
        )
    }

    @Test
    fun syncBlocksReplicaConflictWithoutResettingIdentity() = runBlocking {
        val initialLocalWorkspaceId = environment.requireLocalWorkspaceId()
        val initialInstallationId = environment.cloudPreferencesStore.currentCloudSettings().installationId
        val remoteGateway = FakeCloudRemoteGateway.forBootstrapPullError(
            bootstrapPullError = CloudRemoteException(
                message = "Cloud request failed with status 409 for /sync/bootstrap-pull",
                statusCode = 409,
                responseBody = JSONObject()
                    .put("code", "SYNC_REPLICA_CONFLICT")
                    .put("requestId", "request-replica-conflict")
                    .toString(),
                errorCode = "SYNC_REPLICA_CONFLICT",
                requestId = "request-replica-conflict"
            )
        )
        val syncRepository = environment.createSyncRepository(remoteGateway = remoteGateway)

        environment.prepareLinkedCloudIdentity(localWorkspaceId = initialLocalWorkspaceId)

        try {
            syncRepository.syncNow()
        } catch (_: CloudRemoteException) {
        }

        val cloudSettings = environment.cloudPreferencesStore.currentCloudSettings()
        val syncStatus = syncRepository.observeSyncStatus().first().status
        assertEquals(CloudAccountState.LINKED, cloudSettings.cloudState)
        assertEquals(initialInstallationId, cloudSettings.installationId)
        assertEquals(initialLocalWorkspaceId, cloudSettings.activeWorkspaceId)
        assertEquals(initialLocalWorkspaceId, environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        assertNotNull(environment.cloudPreferencesStore.loadCredentials())
        assertTrue(syncStatus is SyncStatus.Blocked)
        assertEquals(
            "Cloud request failed with status 409 for /sync/bootstrap-pull",
            (syncStatus as SyncStatus.Blocked).message
        )
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
