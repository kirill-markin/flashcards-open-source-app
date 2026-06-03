package com.flashcardsopensourceapp.data.local.repository.cloudsync.sync

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.bootstrap.localWorkspaceName
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.database.CardEntity
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryReason
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryRequiredException
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.scheduling.EffortLevel
import com.flashcardsopensourceapp.data.local.model.scheduling.FsrsCardState
import com.flashcardsopensourceapp.data.local.model.sync.SyncStatus
import com.flashcardsopensourceapp.data.local.model.cloud.cloudCredentialRecoveryRequiredMessage
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.CloudIdentityTestEnvironment
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.FakeCloudRemoteGateway
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createCloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createCloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createStoredCloudCredentials
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createStoredGuestAiSession
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.syncStateEntityWithEmptyProgress
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LocalSyncRepositoryDisconnectedStateTest {
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
    fun syncDisconnectsCloudIdentityWhenRemoteAccountIsDeletedWithoutResettingLocalState() = runBlocking {
        val initialLocalWorkspaceId = environment.requireLocalWorkspaceId()
        val initialInstallationId = environment.cloudPreferencesStore.currentCloudSettings().installationId
        val remoteGateway = FakeCloudRemoteGateway.forFetchAccountError(
            fetchAccountError = CloudRemoteException(
                message = "Cloud request failed with status 410 for /me",
                statusCode = 410,
                responseBody = JSONObject()
                    .put("code", "ACCOUNT_DELETED")
                    .put("requestId", "request-1")
                    .toString(),
                errorCode = "ACCOUNT_DELETED",
                requestId = "request-1",
                syncConflict = null
            )
        )
        val repository = environment.createSyncRepository(remoteGateway = remoteGateway)

        environment.prepareLinkedCloudIdentity(localWorkspaceId = initialLocalWorkspaceId)
        environment.aiChatPreferencesStore.updateConsent(hasConsent = true)

        repository.syncNow()

        val localWorkspace = requireNotNull(environment.database.workspaceDao().loadAnyWorkspace()) {
            "Expected a local workspace after remote deletion."
        }

        assertEquals(CloudAccountState.DISCONNECTED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(initialInstallationId, environment.cloudPreferencesStore.currentCloudSettings().installationId)
        assertEquals(
            com.flashcardsopensourceapp.data.local.model.cloud.AccountDeletionState.Hidden,
            environment.cloudPreferencesStore.currentAccountDeletionState()
        )
        assertNull(environment.cloudPreferencesStore.loadCredentials())
        assertTrue(environment.aiChatPreferencesStore.hasConsent())
        assertEquals(SyncStatus.Idle, repository.observeSyncStatus().first().status)
        assertEquals(localWorkspaceName, localWorkspace.name)
        assertEquals(initialLocalWorkspaceId, localWorkspace.workspaceId)
    }

    @Test
    fun syncKeepsDisconnectedStateWhenStoredGuestSessionExistsButCloudStateIsDisconnected() = runBlocking {
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

        try {
            syncRepository.syncNow()
        } catch (_: IllegalStateException) {
        }

        val cloudSettings = environment.cloudPreferencesStore.currentCloudSettings()
        assertEquals(CloudAccountState.DISCONNECTED, cloudSettings.cloudState)
        assertEquals(localWorkspaceId, cloudSettings.activeWorkspaceId)
        assertEquals(localWorkspaceId, environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        assertTrue(syncRepository.observeSyncStatus().first().status is SyncStatus.Failed)
        assertTrue(remoteGateway.bootstrapPullWorkspaceIds.isEmpty())
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
    fun syncBlocksCredentialRecoveryWhenStoredGuestSessionIsMissing() = runBlocking {
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
            throw AssertionError("Expected missing guest session to require credential recovery.")
        } catch (error: CloudCredentialRecoveryRequiredException) {
            assertEquals(CloudCredentialRecoveryReason.GUEST_SESSION_MISSING, error.recoveryState.reason)
        }

        val localWorkspace = requireNotNull(environment.database.workspaceDao().loadAnyWorkspace()) {
            "Expected a local workspace after guest normalization."
        }
        val recoveryState = requireNotNull(environment.cloudPreferencesStore.loadCloudCredentialRecoveryState()) {
            "Expected missing guest session to persist credential recovery state."
        }
        val syncStatus = syncRepository.observeSyncStatus().first().status
        assertEquals(CloudAccountState.DISCONNECTED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(localWorkspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertEquals(localWorkspaceId, localWorkspace.workspaceId)
        assertEquals(initialInstallationId, environment.cloudPreferencesStore.currentCloudSettings().installationId)
        assertEquals(CloudCredentialRecoveryReason.GUEST_SESSION_MISSING, recoveryState.reason)
        assertTrue(syncStatus is SyncStatus.Blocked)
        val blockedStatus = syncStatus as SyncStatus.Blocked
        assertEquals(cloudCredentialRecoveryRequiredMessage, blockedStatus.message)
        assertEquals(initialInstallationId, blockedStatus.installationId)
    }

    @Test
    fun syncDoesNotKeepCredentialRecoveryBlockedAfterRecoveryClears() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val initialInstallationId = environment.cloudPreferencesStore.currentCloudSettings().installationId
        val remoteGateway = FakeCloudRemoteGateway.standard()
        val syncRepository = environment.createSyncRepository(remoteGateway = remoteGateway)
        environment.cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.GUEST,
            linkedUserId = "guest-user",
            linkedWorkspaceId = localWorkspaceId,
            linkedEmail = null,
            activeWorkspaceId = localWorkspaceId
        )

        try {
            syncRepository.syncNow()
            throw AssertionError("Expected missing guest session to require credential recovery.")
        } catch (error: CloudCredentialRecoveryRequiredException) {
            assertEquals(CloudCredentialRecoveryReason.GUEST_SESSION_MISSING, error.recoveryState.reason)
        }

        environment.cloudPreferencesStore.saveCredentials(
            createStoredCloudCredentials(idTokenExpiresAtMillis = Long.MAX_VALUE)
        )
        environment.cloudPreferencesStore.clearCloudCredentialRecoveryState()
        environment.cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.LINKED,
            linkedUserId = "user-1",
            linkedWorkspaceId = localWorkspaceId,
            linkedEmail = "user@example.com",
            activeWorkspaceId = localWorkspaceId
        )

        syncRepository.syncNow()

        assertEquals(initialInstallationId, environment.cloudPreferencesStore.currentCloudSettings().installationId)
        assertEquals(SyncStatus.Idle, syncRepository.observeSyncStatus().first().status)
        assertTrue(remoteGateway.syncRequestEvents.isNotEmpty())
    }

    @Test
    fun syncPrefersCredentialRecoveryWhenStoredGuestSessionIsMissingAndSyncStateIsBlocked() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val initialInstallationId = environment.cloudPreferencesStore.currentCloudSettings().installationId
        val remoteGateway = FakeCloudRemoteGateway.standard()
        val syncRepository = environment.createSyncRepository(remoteGateway = remoteGateway)
        environment.database.syncStateDao().insertSyncState(
            syncStateEntityWithEmptyProgress(workspaceId = localWorkspaceId).copy(
                lastSyncError = "Old persisted sync block.",
                blockedInstallationId = initialInstallationId
            )
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
            throw AssertionError("Expected credential recovery to take precedence over the old persisted block.")
        } catch (error: CloudCredentialRecoveryRequiredException) {
            assertEquals(CloudCredentialRecoveryReason.GUEST_SESSION_MISSING, error.recoveryState.reason)
        }

        val recoveryState = requireNotNull(environment.cloudPreferencesStore.loadCloudCredentialRecoveryState()) {
            "Expected missing guest session to persist credential recovery state."
        }
        val syncStatus = syncRepository.observeSyncStatus().first().status
        assertEquals(CloudCredentialRecoveryReason.GUEST_SESSION_MISSING, recoveryState.reason)
        assertTrue(syncStatus is SyncStatus.Blocked)
        val blockedStatus = syncStatus as SyncStatus.Blocked
        assertEquals(cloudCredentialRecoveryRequiredMessage, blockedStatus.message)
        assertEquals(initialInstallationId, blockedStatus.installationId)
        assertTrue(remoteGateway.syncRequestEvents.isEmpty())
    }

    @Test
    fun syncNormalizesStaleActiveWorkspaceBeforeRunningWithoutReset() = runBlocking {
        val syncRepository = environment.createSyncRepository(
            remoteGateway = FakeCloudRemoteGateway.standard()
        )
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val initialInstallationId = environment.cloudPreferencesStore.currentCloudSettings().installationId
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
        val localWorkspace = requireNotNull(environment.database.workspaceDao().loadAnyWorkspace()) {
            "Expected a local workspace after stale active workspace normalization."
        }
        assertEquals(CloudAccountState.DISCONNECTED, cloudSettings.cloudState)
        assertEquals(localWorkspaceId, cloudSettings.activeWorkspaceId)
        assertEquals(localWorkspaceId, localWorkspace.workspaceId)
        assertEquals(initialInstallationId, cloudSettings.installationId)
        assertTrue(syncRepository.observeSyncStatus().first().status is SyncStatus.Failed)
    }
}
