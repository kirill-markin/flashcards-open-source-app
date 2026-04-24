package com.flashcardsopensourceapp.data.local

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.cloud.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.bootstrap.localWorkspaceName
import com.flashcardsopensourceapp.data.local.cloud.CloudSyncConflictDetails
import com.flashcardsopensourceapp.data.local.cloud.CloudRemoteException
import com.flashcardsopensourceapp.data.local.cloud.forkedCardId
import com.flashcardsopensourceapp.data.local.cloud.forkedReviewEventId
import com.flashcardsopensourceapp.data.local.cloud.RemotePushResponse
import com.flashcardsopensourceapp.data.local.cloud.syncWorkspaceForkRequiredErrorCode
import com.flashcardsopensourceapp.data.local.database.CardEntity
import com.flashcardsopensourceapp.data.local.database.OutboxEntryEntity
import com.flashcardsopensourceapp.data.local.database.SyncStateEntity
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.FsrsCardState
import com.flashcardsopensourceapp.data.local.model.SyncStatus
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
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
            com.flashcardsopensourceapp.data.local.model.AccountDeletionState.Hidden,
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
    fun syncDisconnectsInvalidGuestStateWhenStoredGuestSessionIsMissing() = runBlocking {
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

        val localWorkspace = requireNotNull(environment.database.workspaceDao().loadAnyWorkspace()) {
            "Expected a local workspace after guest normalization."
        }
        assertEquals(CloudAccountState.DISCONNECTED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(localWorkspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertEquals(localWorkspaceId, localWorkspace.workspaceId)
        assertEquals(initialInstallationId, environment.cloudPreferencesStore.currentCloudSettings().installationId)
        assertTrue(syncRepository.observeSyncStatus().first().status is SyncStatus.Failed)
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
    fun syncBlocksWorkspaceForkRequiredPushConflictWithoutResettingIdentity() = runBlocking {
        val workspaceId = environment.requireLocalWorkspaceId()
        val initialInstallationId = environment.cloudPreferencesStore.currentCloudSettings().installationId
        val baseGateway = FakeCloudRemoteGateway.standard()
        val remoteGateway = object : CloudRemoteGateway by baseGateway {
            override suspend fun push(
                apiBaseUrl: String,
                authorizationHeader: String,
                workspaceId: String,
                body: JSONObject
            ): RemotePushResponse {
                throw createWorkspaceForkRequiredError(
                    path = "/sync/push",
                    requestId = "request-push-fork",
                    conflictingWorkspaceId = "workspace-conflict-source",
                    remoteIsEmpty = false
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
                attemptCount = 0,
                lastError = null
            )
        )
        val syncRepository = environment.createSyncRepository(remoteGateway = remoteGateway)

        environment.prepareLinkedCloudIdentity(localWorkspaceId = workspaceId)

        try {
            syncRepository.syncNow()
        } catch (_: CloudRemoteException) {
        }

        val cloudSettings = environment.cloudPreferencesStore.currentCloudSettings()
        val syncStatus = syncRepository.observeSyncStatus().first().status
        assertEquals(CloudAccountState.LINKED, cloudSettings.cloudState)
        assertEquals(initialInstallationId, cloudSettings.installationId)
        assertEquals(workspaceId, cloudSettings.activeWorkspaceId)
        assertEquals(workspaceId, environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        assertNotNull(environment.cloudPreferencesStore.loadCredentials())
        assertTrue(syncStatus is SyncStatus.Blocked)
        assertEquals(
            "Cloud request failed with status 409 for /sync/push",
            (syncStatus as SyncStatus.Blocked).message
        )
    }

    @Test
    fun syncRecoversFromWorkspaceForkConflictDuringBootstrapPush() = runBlocking {
        val workspaceId = environment.requireLocalWorkspaceId()
        val conflictingWorkspaceId = "workspace-conflict-source"
        val seededCardId = environment.seedWorkspaceData(workspaceId = workspaceId)
        val remoteGateway = FakeCloudRemoteGateway.forBootstrapPushScenario(
            bootstrapRemoteIsEmptyResponses = listOf(true, true, true),
            bootstrapPushErrors = listOf(
                createWorkspaceForkRequiredError(
                    path = "/sync/bootstrap",
                    requestId = "request-fork-bootstrap-1",
                    conflictingWorkspaceId = conflictingWorkspaceId,
                    remoteIsEmpty = true
                )
            )
        )
        val syncRepository = environment.createSyncRepository(remoteGateway = remoteGateway)

        environment.prepareLinkedCloudIdentity(localWorkspaceId = workspaceId)

        syncRepository.syncNow()

        val expectedForkedCardId = forkedCardId(
            sourceWorkspaceId = conflictingWorkspaceId,
            destinationWorkspaceId = workspaceId,
            sourceCardId = seededCardId
        )
        val expectedForkedReviewEventId = forkedReviewEventId(
            sourceWorkspaceId = conflictingWorkspaceId,
            destinationWorkspaceId = workspaceId,
            sourceReviewEventId = "review-$workspaceId"
        )
        val firstBootstrapEntries = remoteGateway.bootstrapPushBodies.first().getJSONArray("entries")
        val secondBootstrapEntries = remoteGateway.bootstrapPushBodies.last().getJSONArray("entries")
        val importedReviewEvent = remoteGateway.importReviewHistoryBodies.single()
            .getJSONArray("reviewEvents")
            .getJSONObject(0)

        assertEquals(SyncStatus.Idle, syncRepository.observeSyncStatus().first().status)
        assertNull(environment.database.cardDao().loadCard(seededCardId))
        assertNotNull(environment.database.cardDao().loadCard(expectedForkedCardId))
        assertEquals(
            seededCardId,
            findBootstrapEntryEntityId(entries = firstBootstrapEntries, entityType = "card")
        )
        assertEquals(
            expectedForkedCardId,
            findBootstrapEntryEntityId(entries = secondBootstrapEntries, entityType = "card")
        )
        assertEquals(expectedForkedCardId, importedReviewEvent.getString("cardId"))
        assertEquals(expectedForkedReviewEventId, importedReviewEvent.getString("reviewEventId"))
        assertEquals(2, remoteGateway.bootstrapPushBodies.size)
    }

    @Test
    fun syncBlocksWorkspaceForkConflictAfterSingleAutomaticRetry() = runBlocking {
        val workspaceId = environment.requireLocalWorkspaceId()
        val conflictingWorkspaceId = "workspace-conflict-source"
        val seededCardId = environment.seedWorkspaceData(workspaceId = workspaceId)
        val remoteGateway = FakeCloudRemoteGateway.forBootstrapPushScenario(
            bootstrapRemoteIsEmptyResponses = listOf(true, true, true),
            bootstrapPushErrors = listOf(
                createWorkspaceForkRequiredError(
                    path = "/sync/bootstrap",
                    requestId = "request-fork-bootstrap-1",
                    conflictingWorkspaceId = conflictingWorkspaceId,
                    remoteIsEmpty = true
                ),
                createWorkspaceForkRequiredError(
                    path = "/sync/bootstrap",
                    requestId = "request-fork-bootstrap-2",
                    conflictingWorkspaceId = conflictingWorkspaceId,
                    remoteIsEmpty = true
                )
            )
        )
        val syncRepository = environment.createSyncRepository(remoteGateway = remoteGateway)

        environment.prepareLinkedCloudIdentity(localWorkspaceId = workspaceId)

        try {
            syncRepository.syncNow()
        } catch (_: Exception) {
        }

        val expectedForkedCardId = forkedCardId(
            sourceWorkspaceId = conflictingWorkspaceId,
            destinationWorkspaceId = workspaceId,
            sourceCardId = seededCardId
        )
        val syncStatus = syncRepository.observeSyncStatus().first().status

        assertTrue(syncStatus is SyncStatus.Blocked)
        assertEquals(
            "Cloud sync bootstrap push is blocked for workspace '$workspaceId': automatic workspace identity fork already ran once in this sync attempt and the backend still requires another fork. Reference: request-fork-bootstrap-2",
            (syncStatus as SyncStatus.Blocked).message
        )
        assertNull(environment.database.cardDao().loadCard(seededCardId))
        assertNotNull(environment.database.cardDao().loadCard(expectedForkedCardId))
        assertEquals(2, remoteGateway.bootstrapPushBodies.size)
    }

    @Test
    fun syncPersistsWorkspaceForkBlockAcrossRepositoryRecreation() = runBlocking {
        val workspaceId = environment.requireLocalWorkspaceId()
        val installationId = environment.cloudPreferencesStore.currentCloudSettings().installationId
        val conflictingWorkspaceId = "workspace-conflict-source"
        val seededCardId = environment.seedWorkspaceData(workspaceId = workspaceId)
        val blockingGateway = FakeCloudRemoteGateway.forBootstrapPushScenario(
            bootstrapRemoteIsEmptyResponses = listOf(true, true, true),
            bootstrapPushErrors = listOf(
                createWorkspaceForkRequiredError(
                    path = "/sync/bootstrap",
                    requestId = "request-fork-bootstrap-1",
                    conflictingWorkspaceId = conflictingWorkspaceId,
                    remoteIsEmpty = true
                ),
                createWorkspaceForkRequiredError(
                    path = "/sync/bootstrap",
                    requestId = "request-fork-bootstrap-2",
                    conflictingWorkspaceId = conflictingWorkspaceId,
                    remoteIsEmpty = true
                )
            )
        )
        val initialRepository = environment.createSyncRepository(remoteGateway = blockingGateway)
        val expectedMessage =
            "Cloud sync bootstrap push is blocked for workspace '$workspaceId': automatic workspace identity fork already ran once in this sync attempt and the backend still requires another fork. Reference: request-fork-bootstrap-2"

        environment.prepareLinkedCloudIdentity(localWorkspaceId = workspaceId)

        try {
            initialRepository.syncNow()
        } catch (_: Exception) {
        }

        val persistedSyncState = requireNotNull(environment.database.syncStateDao().loadSyncState(workspaceId)) {
            "Expected persisted sync state for workspace '$workspaceId'."
        }
        val recreatedGateway = FakeCloudRemoteGateway.standard()
        val recreatedRepository = environment.createSyncRepository(remoteGateway = recreatedGateway)
        val recreatedStatus = recreatedRepository.observeSyncStatus().first().status

        assertEquals(expectedMessage, persistedSyncState.lastSyncError)
        assertEquals(installationId, persistedSyncState.blockedInstallationId)
        assertTrue(recreatedStatus is SyncStatus.Blocked)
        assertEquals(expectedMessage, (recreatedStatus as SyncStatus.Blocked).message)
        assertNull(environment.database.cardDao().loadCard(seededCardId))
        assertEquals(2, blockingGateway.bootstrapPushBodies.size)

        try {
            recreatedRepository.syncNow()
        } catch (error: IllegalStateException) {
            assertEquals(expectedMessage, error.message)
        }

        assertTrue(recreatedGateway.bootstrapPullWorkspaceIds.isEmpty())
        assertTrue(recreatedGateway.bootstrapPushBodies.isEmpty())
        assertTrue(recreatedGateway.importReviewHistoryBodies.isEmpty())
    }

    @Test
    fun disconnectClearsBlockedSyncStateAndSuppressesBlockedStatusAfterRecreation() = runBlocking {
        val workspaceId = environment.requireLocalWorkspaceId()
        val conflictingWorkspaceId = "workspace-conflict-source"
        val blockingGateway = FakeCloudRemoteGateway.forBootstrapPushScenario(
            bootstrapRemoteIsEmptyResponses = listOf(true, true, true),
            bootstrapPushErrors = listOf(
                createWorkspaceForkRequiredError(
                    path = "/sync/bootstrap",
                    requestId = "request-fork-bootstrap-1",
                    conflictingWorkspaceId = conflictingWorkspaceId,
                    remoteIsEmpty = true
                ),
                createWorkspaceForkRequiredError(
                    path = "/sync/bootstrap",
                    requestId = "request-fork-bootstrap-2",
                    conflictingWorkspaceId = conflictingWorkspaceId,
                    remoteIsEmpty = true
                )
            )
        )
        val syncRepository = environment.createSyncRepository(remoteGateway = blockingGateway)

        environment.prepareLinkedCloudIdentity(localWorkspaceId = workspaceId)

        try {
            syncRepository.syncNow()
        } catch (_: Exception) {
        }

        assertTrue(syncRepository.observeSyncStatus().first().status is SyncStatus.Blocked)

        environment.resetCoordinator.disconnectCloudIdentityPreservingLocalState()

        val clearedSyncState = requireNotNull(environment.database.syncStateDao().loadSyncState(workspaceId)) {
            "Expected sync state for workspace '$workspaceId' after disconnect."
        }
        val recreatedRepository = environment.createSyncRepository(remoteGateway = FakeCloudRemoteGateway.standard())

        assertEquals(CloudAccountState.DISCONNECTED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertNull(clearedSyncState.blockedInstallationId)
        assertNull(clearedSyncState.lastSyncError)
        assertEquals(SyncStatus.Idle, syncRepository.observeSyncStatus().first().status)
        assertEquals(SyncStatus.Idle, recreatedRepository.observeSyncStatus().first().status)
    }

    @Test
    fun syncBlocksReviewHistoryForkConflictWhenRemoteWorkspaceIsNoLongerEmpty() = runBlocking {
        val workspaceId = environment.requireLocalWorkspaceId()
        val conflictingWorkspaceId = "workspace-conflict-source"
        val seededCardId = environment.seedWorkspaceData(workspaceId = workspaceId)
        val remoteGateway = FakeCloudRemoteGateway.forReviewHistoryImportScenario(
            bootstrapRemoteIsEmptyResponses = listOf(true, false),
            importReviewHistoryErrors = listOf(
                createWorkspaceForkRequiredError(
                    path = "/sync/review-history/import",
                    requestId = "request-review-history-1",
                    conflictingWorkspaceId = conflictingWorkspaceId,
                    remoteIsEmpty = true
                )
            )
        )
        val syncRepository = environment.createSyncRepository(remoteGateway = remoteGateway)

        environment.prepareLinkedCloudIdentity(localWorkspaceId = workspaceId)

        try {
            syncRepository.syncNow()
        } catch (_: Exception) {
        }

        val syncStatus = syncRepository.observeSyncStatus().first().status

        assertTrue(syncStatus is SyncStatus.Blocked)
        assertEquals(
            "Cloud sync review history import is blocked for workspace '$workspaceId': backend requested a workspace identity fork, but the remote workspace is not empty. Reference: request-review-history-1",
            (syncStatus as SyncStatus.Blocked).message
        )
        assertNotNull(environment.database.cardDao().loadCard(seededCardId))
        assertEquals(1, remoteGateway.bootstrapPushBodies.size)
        assertEquals(1, remoteGateway.importReviewHistoryBodies.size)
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

private fun createWorkspaceForkRequiredError(
    path: String,
    requestId: String,
    conflictingWorkspaceId: String,
    remoteIsEmpty: Boolean
): CloudRemoteException {
    return CloudRemoteException(
        message = "Cloud request failed with status 409 for $path",
        statusCode = 409,
        responseBody = JSONObject()
            .put("code", syncWorkspaceForkRequiredErrorCode)
            .put("requestId", requestId)
            .put(
                "details",
                JSONObject().put(
                    "syncConflict",
                    JSONObject()
                        .put("conflictingWorkspaceId", conflictingWorkspaceId)
                        .put("remoteIsEmpty", remoteIsEmpty)
                )
            )
            .toString(),
        errorCode = syncWorkspaceForkRequiredErrorCode,
        requestId = requestId,
        syncConflict = CloudSyncConflictDetails(
            conflictingWorkspaceId = conflictingWorkspaceId,
            remoteIsEmpty = remoteIsEmpty
        )
    )
}

private fun findBootstrapEntryEntityId(entries: org.json.JSONArray, entityType: String): String {
    for (index in 0 until entries.length()) {
        val entry = entries.getJSONObject(index)
        if (entry.getString("entityType") == entityType) {
            return entry.getString("entityId")
        }
    }
    throw AssertionError("Missing bootstrap entry for entity type '$entityType'.")
}
