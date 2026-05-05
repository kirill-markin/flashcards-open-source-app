package com.flashcardsopensourceapp.data.local.cloudidentity

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.cloud.CloudRemoteException
import com.flashcardsopensourceapp.data.local.cloud.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.cloud.RemotePushResponse
import com.flashcardsopensourceapp.data.local.cloud.syncWorkspaceForkRequiredErrorCode
import com.flashcardsopensourceapp.data.local.database.OutboxEntryEntity
import com.flashcardsopensourceapp.data.local.database.SyncStateEntity
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.SyncStatus
import com.flashcardsopensourceapp.data.local.repository.cloudsync.CloudSyncBlockedException
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LocalSyncRepositorySyncBlockingTest {
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
                requestId = "request-platform-mismatch",
                syncConflict = null
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
                requestId = "request-replica-conflict",
                syncConflict = null
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
    fun syncBlocksWorkspaceForkRequiredPushConflictWithoutPublicConflictDetails() = runBlocking {
        val workspaceId = environment.requireLocalWorkspaceId()
        val initialInstallationId = environment.cloudPreferencesStore.currentCloudSettings().installationId
        val baseGateway = FakeCloudRemoteGateway.forBootstrapPushScenario(
            bootstrapRemoteIsEmptyResponses = listOf(true),
            bootstrapPushErrors = emptyList()
        )
        val remoteGateway = object : CloudRemoteGateway by baseGateway {
            override suspend fun push(
                apiBaseUrl: String,
                authorizationHeader: String,
                workspaceId: String,
                body: JSONObject
            ): RemotePushResponse {
                throw CloudRemoteException(
                    message = "Cloud request failed with status 409 for /sync/push",
                    statusCode = 409,
                    responseBody = JSONObject()
                        .put("code", syncWorkspaceForkRequiredErrorCode)
                        .put("requestId", "request-push-fork")
                        .toString(),
                    errorCode = syncWorkspaceForkRequiredErrorCode,
                    requestId = "request-push-fork",
                    syncConflict = null
                )
            }
        }
        val schedulerSettings = requireNotNull(
            environment.database.workspaceSchedulerSettingsDao().loadWorkspaceSchedulerSettings(workspaceId)
        ) {
            "Expected workspace scheduler settings for workspace '$workspaceId'."
        }
        environment.database.syncStateDao().insertSyncState(
            SyncStateEntity(
                workspaceId = workspaceId,
                lastSyncCursor = "0",
                lastReviewSequenceId = 0L,
                hasHydratedHotState = true,
                hasHydratedReviewHistory = true,
                pendingReviewHistoryImport = false,
                lastSyncAttemptAtMillis = null,
                lastSuccessfulSyncAtMillis = null,
                lastSyncError = null,
                blockedInstallationId = null
            )
        )
        environment.database.outboxDao().insertOutboxEntry(
            OutboxEntryEntity(
                outboxEntryId = "outbox-1",
                workspaceId = workspaceId,
                installationId = initialInstallationId,
                entityType = "workspace_scheduler_settings",
                entityId = workspaceId,
                operationType = "upsert",
                payloadJson = JSONObject()
                    .put("algorithm", schedulerSettings.algorithm)
                    .put("desiredRetention", schedulerSettings.desiredRetention)
                    .put("learningStepsMinutes", JSONArray(schedulerSettings.learningStepsMinutesJson))
                    .put("relearningStepsMinutes", JSONArray(schedulerSettings.relearningStepsMinutesJson))
                    .put("maximumIntervalDays", schedulerSettings.maximumIntervalDays)
                    .put("enableFuzz", schedulerSettings.enableFuzz)
                    .toString(),
                clientUpdatedAtIso = "2026-04-02T15:50:57.000Z",
                createdAtMillis = 300L,
                affectsReviewSchedule = false,
                attemptCount = 0,
                lastError = null
            )
        )
        val syncRepository = environment.createSyncRepository(remoteGateway = remoteGateway)

        environment.prepareLinkedCloudIdentity(localWorkspaceId = workspaceId)

        try {
            syncRepository.syncNow()
        } catch (_: CloudSyncBlockedException) {
        }

        val cloudSettings = environment.cloudPreferencesStore.currentCloudSettings()
        val syncStatus = syncRepository.observeSyncStatus().first().status
        val persistedOutboxEntry = environment.database.outboxDao().loadAllOutboxEntries(workspaceId = workspaceId).single()
        assertEquals(CloudAccountState.LINKED, cloudSettings.cloudState)
        assertEquals(initialInstallationId, cloudSettings.installationId)
        assertEquals(workspaceId, cloudSettings.activeWorkspaceId)
        assertEquals(workspaceId, environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        assertNotNull(environment.cloudPreferencesStore.loadCredentials())
        assertTrue(syncStatus is SyncStatus.Blocked)
        assertEquals(
            "Cloud sync push is blocked for workspace '$workspaceId': backend did not provide public sync conflict details for automatic local id recovery. Reference: request-push-fork",
            (syncStatus as SyncStatus.Blocked).message
        )
        assertNull(persistedOutboxEntry.lastError)
        assertTrue(baseGateway.bootstrapPullWorkspaceIds.isEmpty())
    }
}
