package com.flashcardsopensourceapp.data.local

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.cloud.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.bootstrap.localWorkspaceName
import com.flashcardsopensourceapp.data.local.cloud.CloudSyncConflictDetails
import com.flashcardsopensourceapp.data.local.cloud.CloudRemoteException
import com.flashcardsopensourceapp.data.local.cloud.RemoteBootstrapEntry
import com.flashcardsopensourceapp.data.local.cloud.RemoteBootstrapPullResponse
import com.flashcardsopensourceapp.data.local.cloud.RemoteBootstrapPushResponse
import com.flashcardsopensourceapp.data.local.cloud.RemotePushOperationResult
import com.flashcardsopensourceapp.data.local.cloud.RemotePullResponse
import com.flashcardsopensourceapp.data.local.cloud.RemotePushResponse
import com.flashcardsopensourceapp.data.local.cloud.RemoteReviewHistoryImportResponse
import com.flashcardsopensourceapp.data.local.cloud.RemoteSyncChange
import com.flashcardsopensourceapp.data.local.cloud.syncWorkspaceForkRequiredErrorCode
import com.flashcardsopensourceapp.data.local.database.CardEntity
import com.flashcardsopensourceapp.data.local.database.OutboxEntryEntity
import com.flashcardsopensourceapp.data.local.database.SyncStateEntity
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.FsrsCardState
import com.flashcardsopensourceapp.data.local.model.SyncEntityType
import com.flashcardsopensourceapp.data.local.model.SyncStatus
import com.flashcardsopensourceapp.data.local.repository.CloudSyncBlockedException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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

    @Test
    fun syncReIdsLocalCardAfterWorkspaceForkConflictDuringOrdinaryPush() = runBlocking {
        val workspaceId = environment.requireLocalWorkspaceId()
        val initialInstallationId = environment.cloudPreferencesStore.currentCloudSettings().installationId
        val seededCardId = environment.seedWorkspaceData(workspaceId = workspaceId)
        val seededCard = requireNotNull(environment.database.cardDao().loadCard(seededCardId)) {
            "Expected seeded card '$seededCardId' for workspace '$workspaceId'."
        }
        val pushBodies = mutableListOf<JSONObject>()
        val baseGateway = FakeCloudRemoteGateway.standard()
        var pushAttempts = 0
        val remoteGateway = object : CloudRemoteGateway by baseGateway {
            override suspend fun push(
                apiBaseUrl: String,
                authorizationHeader: String,
                workspaceId: String,
                body: JSONObject
            ): RemotePushResponse {
                pushBodies += JSONObject(body.toString())
                pushAttempts += 1
                if (pushAttempts == 1) {
                    throw createWorkspaceForkRequiredError(
                        path = "/sync/push",
                        requestId = "request-push-fork-recover",
                        entityType = SyncEntityType.CARD,
                        entityId = seededCardId
                    )
                }

                val operations = body.getJSONArray("operations")
                return RemotePushResponse(
                    operations = List(operations.length()) { index ->
                        RemotePushOperationResult(
                            operationId = operations.getJSONObject(index).getString("operationId"),
                            resultingHotChangeId = 100L + index
                        )
                    }
                )
            }
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
                outboxEntryId = "outbox-card-1",
                workspaceId = workspaceId,
                installationId = initialInstallationId,
                entityType = "card",
                entityId = seededCardId,
                operationType = "upsert",
                payloadJson = JSONObject()
                    .put("cardId", seededCard.cardId)
                    .put("frontText", seededCard.frontText)
                    .put("backText", seededCard.backText)
                    .put("tags", JSONArray())
                    .put("effortLevel", "medium")
                    .put("dueAt", JSONObject.NULL)
                    .put("createdAt", "2026-04-02T15:50:57.000Z")
                    .put("reps", seededCard.reps)
                    .put("lapses", seededCard.lapses)
                    .put("fsrsCardState", "new")
                    .put("fsrsStepIndex", JSONObject.NULL)
                    .put("fsrsStability", JSONObject.NULL)
                    .put("fsrsDifficulty", JSONObject.NULL)
                    .put("fsrsLastReviewedAt", JSONObject.NULL)
                    .put("fsrsScheduledDays", JSONObject.NULL)
                    .put("deletedAt", JSONObject.NULL)
                    .toString(),
                clientUpdatedAtIso = "2026-04-02T15:50:57.000Z",
                createdAtMillis = 300L,
                attemptCount = 0,
                lastError = null
            )
        )
        val syncRepository = environment.createSyncRepository(remoteGateway = remoteGateway)

        environment.prepareLinkedCloudIdentity(localWorkspaceId = workspaceId)

        syncRepository.syncNow()

        val recoveredCardId = environment.database.cardDao().loadCards(workspaceId = workspaceId).single().cardId
        val recoveredReviewLog = environment.database.reviewLogDao().loadReviewLogs(workspaceId = workspaceId).single()
        val persistedSyncState = requireNotNull(environment.database.syncStateDao().loadSyncState(workspaceId)) {
            "Expected sync state for workspace '$workspaceId' after push recovery."
        }
        val firstPushOperation = pushBodies.first().getJSONArray("operations").getJSONObject(0)
        val secondPushOperation = pushBodies.last().getJSONArray("operations").getJSONObject(0)

        assertEquals(SyncStatus.Idle, syncRepository.observeSyncStatus().first().status)
        assertNull(environment.database.cardDao().loadCard(seededCardId))
        assertTrue(recoveredCardId != seededCardId)
        assertEquals(recoveredCardId, recoveredReviewLog.cardId)
        assertEquals(0, environment.database.outboxDao().countOutboxEntries())
        assertEquals(2, pushBodies.size)
        assertEquals(seededCardId, firstPushOperation.getString("entityId"))
        assertEquals(seededCardId, firstPushOperation.getJSONObject("payload").getString("cardId"))
        assertEquals(recoveredCardId, secondPushOperation.getString("entityId"))
        assertEquals(recoveredCardId, secondPushOperation.getJSONObject("payload").getString("cardId"))
        assertTrue(baseGateway.bootstrapPullWorkspaceIds.isEmpty())
        assertTrue(baseGateway.bootstrapPushBodies.isEmpty())
        assertTrue(baseGateway.importReviewHistoryBodies.isEmpty())
        assertNull(persistedSyncState.lastSyncError)
        assertNull(persistedSyncState.blockedInstallationId)
    }

    @Test
    fun syncReplaysSkippedBootstrapHotRowsAfterDirtyOutboxPushIsIgnored() = runBlocking {
        val workspaceId = environment.requireLocalWorkspaceId()
        val installationId = environment.cloudPreferencesStore.currentCloudSettings().installationId
        val dirtyCard = CardEntity(
            cardId = "card-dirty-bootstrap",
            workspaceId = workspaceId,
            frontText = "Local pending front",
            backText = "Local pending back",
            effortLevel = EffortLevel.MEDIUM,
            dueAtMillis = null,
            createdAtMillis = 100L,
            updatedAtMillis = 200L,
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
        val remoteCardPayload = createRemoteCardHotPayload(
            cardId = dirtyCard.cardId,
            frontText = "Remote winning front",
            backText = "Remote winning back",
            tags = listOf("remote"),
            clientUpdatedAt = "2026-04-02T15:55:57.000Z"
        )
        val hotPullCursors = mutableListOf<Long>()
        val baseGateway = FakeCloudRemoteGateway.standard()
        val remoteGateway = object : CloudRemoteGateway by baseGateway {
            override suspend fun bootstrapPull(
                apiBaseUrl: String,
                authorizationHeader: String,
                workspaceId: String,
                body: JSONObject
            ): RemoteBootstrapPullResponse {
                return RemoteBootstrapPullResponse(
                    entries = listOf(
                        RemoteBootstrapEntry(
                            entityType = SyncEntityType.CARD,
                            entityId = dirtyCard.cardId,
                            action = "upsert",
                            payload = JSONObject(remoteCardPayload.toString())
                        )
                    ),
                    nextCursor = null,
                    hasMore = false,
                    bootstrapHotChangeId = 25L,
                    remoteIsEmpty = false
                )
            }

            override suspend fun push(
                apiBaseUrl: String,
                authorizationHeader: String,
                workspaceId: String,
                body: JSONObject
            ): RemotePushResponse {
                val operations = body.getJSONArray("operations")
                return RemotePushResponse(
                    operations = List(operations.length()) { index ->
                        RemotePushOperationResult(
                            operationId = operations.getJSONObject(index).getString("operationId"),
                            resultingHotChangeId = null
                        )
                    }
                )
            }

            override suspend fun pull(
                apiBaseUrl: String,
                authorizationHeader: String,
                workspaceId: String,
                body: JSONObject
            ): RemotePullResponse {
                val afterHotChangeId = body.getLong("afterHotChangeId")
                hotPullCursors += afterHotChangeId
                if (afterHotChangeId != 0L) {
                    return RemotePullResponse(
                        changes = emptyList(),
                        nextHotChangeId = afterHotChangeId,
                        hasMore = false
                    )
                }
                return RemotePullResponse(
                    changes = listOf(
                        RemoteSyncChange(
                            changeId = 25L,
                            entityType = SyncEntityType.CARD,
                            entityId = dirtyCard.cardId,
                            action = "upsert",
                            payload = JSONObject(remoteCardPayload.toString())
                        )
                    ),
                    nextHotChangeId = 25L,
                    hasMore = false
                )
            }
        }
        environment.database.cardDao().insertCard(dirtyCard)
        environment.database.outboxDao().insertOutboxEntry(
            createCardOutboxEntry(
                outboxEntryId = "outbox-dirty-bootstrap",
                workspaceId = workspaceId,
                installationId = installationId,
                card = dirtyCard,
                createdAtMillis = 300L
            )
        )
        val syncRepository = environment.createSyncRepository(remoteGateway = remoteGateway)

        environment.prepareLinkedCloudIdentity(localWorkspaceId = workspaceId)

        syncRepository.syncNow()

        val syncedCard = requireNotNull(environment.database.cardDao().loadCard(dirtyCard.cardId)) {
            "Expected dirty bootstrap card '${dirtyCard.cardId}' after sync."
        }
        val persistedSyncState = requireNotNull(environment.database.syncStateDao().loadSyncState(workspaceId)) {
            "Expected sync state for workspace '$workspaceId' after dirty bootstrap replay."
        }

        assertEquals(SyncStatus.Idle, syncRepository.observeSyncStatus().first().status)
        assertEquals("Remote winning front", syncedCard.frontText)
        assertEquals("Remote winning back", syncedCard.backText)
        assertEquals(0, environment.database.outboxDao().countOutboxEntries())
        assertEquals("25", persistedSyncState.lastSyncCursor)
        assertTrue(persistedSyncState.hasHydratedHotState)
        assertTrue(hotPullCursors.contains(0L))
    }

    @Test
    fun syncReplaysBootstrapHotRowsDirtiedAfterBootstrapApplyBeforeFinalization() = runBlocking {
        val workspaceId = environment.requireLocalWorkspaceId()
        val installationId = environment.cloudPreferencesStore.currentCloudSettings().installationId
        val dirtyCardId = "card-final-dirty-bootstrap"
        val remoteCardPayload = createRemoteCardHotPayload(
            cardId = dirtyCardId,
            frontText = "Remote winning final front",
            backText = "Remote winning final back",
            tags = listOf("remote"),
            clientUpdatedAt = "2026-04-02T15:55:57.000Z"
        )
        val hotPullCursors: MutableList<Long> = mutableListOf()
        var dirtiedAfterFirstBootstrapPage: Boolean = false
        val baseGateway = FakeCloudRemoteGateway.standard()
        val remoteGateway = object : CloudRemoteGateway by baseGateway {
            override suspend fun bootstrapPull(
                apiBaseUrl: String,
                authorizationHeader: String,
                workspaceId: String,
                body: JSONObject
            ): RemoteBootstrapPullResponse {
                if (body.isNull("cursor")) {
                    return RemoteBootstrapPullResponse(
                        entries = listOf(
                            RemoteBootstrapEntry(
                                entityType = SyncEntityType.CARD,
                                entityId = dirtyCardId,
                                action = "upsert",
                                payload = JSONObject(remoteCardPayload.toString())
                            )
                        ),
                        nextCursor = "page-2",
                        hasMore = true,
                        bootstrapHotChangeId = 10L,
                        remoteIsEmpty = false
                    )
                }

                if (dirtiedAfterFirstBootstrapPage.not()) {
                    val appliedCard = requireNotNull(environment.database.cardDao().loadCard(dirtyCardId)) {
                        "Expected first bootstrap page to apply card '$dirtyCardId'."
                    }
                    val localEditedCard = appliedCard.copy(
                        frontText = "Local pending final front",
                        backText = "Local pending final back",
                        updatedAtMillis = 300L
                    )
                    environment.database.cardDao().updateCard(localEditedCard)
                    environment.database.outboxDao().insertOutboxEntry(
                        createCardOutboxEntry(
                            outboxEntryId = "outbox-final-dirty-bootstrap",
                            workspaceId = workspaceId,
                            installationId = installationId,
                            card = localEditedCard,
                            createdAtMillis = 301L
                        )
                    )
                    dirtiedAfterFirstBootstrapPage = true
                }

                return RemoteBootstrapPullResponse(
                    entries = emptyList(),
                    nextCursor = null,
                    hasMore = false,
                    bootstrapHotChangeId = 25L,
                    remoteIsEmpty = false
                )
            }

            override suspend fun push(
                apiBaseUrl: String,
                authorizationHeader: String,
                workspaceId: String,
                body: JSONObject
            ): RemotePushResponse {
                val operations = body.getJSONArray("operations")
                return RemotePushResponse(
                    operations = List(operations.length()) { index ->
                        RemotePushOperationResult(
                            operationId = operations.getJSONObject(index).getString("operationId"),
                            resultingHotChangeId = null
                        )
                    }
                )
            }

            override suspend fun pull(
                apiBaseUrl: String,
                authorizationHeader: String,
                workspaceId: String,
                body: JSONObject
            ): RemotePullResponse {
                val afterHotChangeId = body.getLong("afterHotChangeId")
                hotPullCursors += afterHotChangeId
                if (afterHotChangeId != 0L) {
                    return RemotePullResponse(
                        changes = emptyList(),
                        nextHotChangeId = afterHotChangeId,
                        hasMore = false
                    )
                }
                return RemotePullResponse(
                    changes = listOf(
                        RemoteSyncChange(
                            changeId = 25L,
                            entityType = SyncEntityType.CARD,
                            entityId = dirtyCardId,
                            action = "upsert",
                            payload = JSONObject(remoteCardPayload.toString())
                        )
                    ),
                    nextHotChangeId = 25L,
                    hasMore = false
                )
            }
        }
        val syncRepository = environment.createSyncRepository(remoteGateway = remoteGateway)

        environment.prepareLinkedCloudIdentity(localWorkspaceId = workspaceId)

        syncRepository.syncNow()

        val syncedCard = requireNotNull(environment.database.cardDao().loadCard(dirtyCardId)) {
            "Expected dirty bootstrap card '$dirtyCardId' after final dirty-key replay."
        }
        val persistedSyncState = requireNotNull(environment.database.syncStateDao().loadSyncState(workspaceId)) {
            "Expected sync state for workspace '$workspaceId' after final dirty bootstrap replay."
        }

        assertEquals(SyncStatus.Idle, syncRepository.observeSyncStatus().first().status)
        assertTrue(dirtiedAfterFirstBootstrapPage)
        assertEquals("Remote winning final front", syncedCard.frontText)
        assertEquals("Remote winning final back", syncedCard.backText)
        assertEquals(0, environment.database.outboxDao().countOutboxEntries())
        assertEquals("25", persistedSyncState.lastSyncCursor)
        assertTrue(persistedSyncState.hasHydratedHotState)
        assertEquals(listOf(0L), hotPullCursors)
    }

    @Test
    fun syncPullsFromDurableHotCursorAfterOrdinaryPushResultingHotChangeId() = runBlocking {
        val workspaceId = environment.requireLocalWorkspaceId()
        val installationId = environment.cloudPreferencesStore.currentCloudSettings().installationId
        val localCardId = environment.seedWorkspaceData(workspaceId = workspaceId)
        val localCard = requireNotNull(environment.database.cardDao().loadCard(localCardId)) {
            "Expected seeded card '$localCardId' for workspace '$workspaceId'."
        }
        val remoteCardId = "card-remote-between-push"
        val remoteCardPayload = createRemoteCardHotPayload(
            cardId = remoteCardId,
            frontText = "Remote unseen front",
            backText = "Remote unseen back",
            tags = listOf("remote"),
            clientUpdatedAt = "2026-04-02T15:56:57.000Z"
        )
        val hotPullCursors = mutableListOf<Long>()
        val baseGateway = FakeCloudRemoteGateway.standard()
        val remoteGateway = object : CloudRemoteGateway by baseGateway {
            override suspend fun push(
                apiBaseUrl: String,
                authorizationHeader: String,
                workspaceId: String,
                body: JSONObject
            ): RemotePushResponse {
                val operations = body.getJSONArray("operations")
                return RemotePushResponse(
                    operations = List(operations.length()) { index ->
                        RemotePushOperationResult(
                            operationId = operations.getJSONObject(index).getString("operationId"),
                            resultingHotChangeId = 100L + index
                        )
                    }
                )
            }

            override suspend fun pull(
                apiBaseUrl: String,
                authorizationHeader: String,
                workspaceId: String,
                body: JSONObject
            ): RemotePullResponse {
                val afterHotChangeId = body.getLong("afterHotChangeId")
                hotPullCursors += afterHotChangeId
                if (afterHotChangeId != 5L) {
                    return RemotePullResponse(
                        changes = emptyList(),
                        nextHotChangeId = afterHotChangeId,
                        hasMore = false
                    )
                }
                return RemotePullResponse(
                    changes = listOf(
                        RemoteSyncChange(
                            changeId = 6L,
                            entityType = SyncEntityType.CARD,
                            entityId = remoteCardId,
                            action = "upsert",
                            payload = JSONObject(remoteCardPayload.toString())
                        )
                    ),
                    nextHotChangeId = 100L,
                    hasMore = false
                )
            }
        }
        environment.database.syncStateDao().insertSyncState(
            SyncStateEntity(
                workspaceId = workspaceId,
                lastSyncCursor = "5",
                lastReviewSequenceId = 0L,
                hasHydratedHotState = true,
                hasHydratedReviewHistory = true,
                pendingReviewHistoryImport = false,
                lastSyncAttemptAtMillis = null,
                lastSuccessfulSyncAtMillis = 400L,
                lastSyncError = null,
                blockedInstallationId = null
            )
        )
        environment.database.outboxDao().insertOutboxEntry(
            createCardOutboxEntry(
                outboxEntryId = "outbox-local-card",
                workspaceId = workspaceId,
                installationId = installationId,
                card = localCard,
                createdAtMillis = 500L
            )
        )
        val syncRepository = environment.createSyncRepository(remoteGateway = remoteGateway)

        environment.prepareLinkedCloudIdentity(localWorkspaceId = workspaceId)

        syncRepository.syncNow()

        val remoteCard = requireNotNull(environment.database.cardDao().loadCard(remoteCardId)) {
            "Expected pull to apply remote card '$remoteCardId'."
        }
        val persistedSyncState = requireNotNull(environment.database.syncStateDao().loadSyncState(workspaceId)) {
            "Expected sync state for workspace '$workspaceId' after ordinary push sync."
        }

        assertEquals(SyncStatus.Idle, syncRepository.observeSyncStatus().first().status)
        assertEquals(listOf(5L), hotPullCursors)
        assertEquals("Remote unseen front", remoteCard.frontText)
        assertEquals("Remote unseen back", remoteCard.backText)
        assertEquals(0, environment.database.outboxDao().countOutboxEntries())
        assertEquals("100", persistedSyncState.lastSyncCursor)
        assertTrue(baseGateway.bootstrapPullWorkspaceIds.isEmpty())
    }

    @Test
    fun syncReIdsMultipleDistinctWorkspaceForkConflictsDuringOrdinaryPush() = runBlocking {
        val workspaceId = environment.requireLocalWorkspaceId()
        val initialInstallationId = environment.cloudPreferencesStore.currentCloudSettings().installationId
        val firstCardId = environment.seedWorkspaceData(workspaceId = workspaceId)
        val firstCard = requireNotNull(environment.database.cardDao().loadCard(firstCardId)) {
            "Expected seeded card '$firstCardId' for workspace '$workspaceId'."
        }
        val secondCardId = "card-second-$workspaceId"
        val secondCard = CardEntity(
            cardId = secondCardId,
            workspaceId = workspaceId,
            frontText = "Question 2",
            backText = "Answer 2",
            effortLevel = EffortLevel.MEDIUM,
            dueAtMillis = null,
            createdAtMillis = 110L,
            updatedAtMillis = 110L,
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
        environment.database.cardDao().insertCard(secondCard)
        val pushBodies = mutableListOf<JSONObject>()
        val baseGateway = FakeCloudRemoteGateway.standard()
        var pushAttempts = 0
        val remoteGateway = object : CloudRemoteGateway by baseGateway {
            override suspend fun push(
                apiBaseUrl: String,
                authorizationHeader: String,
                workspaceId: String,
                body: JSONObject
            ): RemotePushResponse {
                pushBodies += JSONObject(body.toString())
                pushAttempts += 1
                if (pushAttempts == 1) {
                    throw createWorkspaceForkRequiredError(
                        path = "/sync/push",
                        requestId = "request-push-fork-first",
                        entityType = SyncEntityType.CARD,
                        entityId = firstCardId
                    )
                }
                if (pushAttempts == 2) {
                    throw createWorkspaceForkRequiredError(
                        path = "/sync/push",
                        requestId = "request-push-fork-second",
                        entityType = SyncEntityType.CARD,
                        entityId = secondCardId
                    )
                }

                val operations = body.getJSONArray("operations")
                return RemotePushResponse(
                    operations = List(operations.length()) { index ->
                        RemotePushOperationResult(
                            operationId = operations.getJSONObject(index).getString("operationId"),
                            resultingHotChangeId = 200L + index
                        )
                    }
                )
            }
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
            createCardOutboxEntry(
                outboxEntryId = "outbox-card-1",
                workspaceId = workspaceId,
                installationId = initialInstallationId,
                card = firstCard,
                createdAtMillis = 300L
            )
        )
        environment.database.outboxDao().insertOutboxEntry(
            createCardOutboxEntry(
                outboxEntryId = "outbox-card-2",
                workspaceId = workspaceId,
                installationId = initialInstallationId,
                card = secondCard,
                createdAtMillis = 301L
            )
        )
        val syncRepository = environment.createSyncRepository(remoteGateway = remoteGateway)

        environment.prepareLinkedCloudIdentity(localWorkspaceId = workspaceId)

        syncRepository.syncNow()

        val recoveredCardIds = environment.database.cardDao().loadCards(workspaceId = workspaceId).map(CardEntity::cardId)
        val firstPushEntityIds = collectPushOperationEntityIds(pushBodies[0])
        val secondPushEntityIds = collectPushOperationEntityIds(pushBodies[1])
        val thirdPushEntityIds = collectPushOperationEntityIds(pushBodies[2])

        assertEquals(SyncStatus.Idle, syncRepository.observeSyncStatus().first().status)
        assertEquals(2, recoveredCardIds.size)
        assertFalse(recoveredCardIds.contains(firstCardId))
        assertFalse(recoveredCardIds.contains(secondCardId))
        assertEquals(0, environment.database.outboxDao().countOutboxEntries())
        assertEquals(3, pushBodies.size)
        assertTrue(firstPushEntityIds.contains(firstCardId))
        assertTrue(firstPushEntityIds.contains(secondCardId))
        assertFalse(secondPushEntityIds.contains(firstCardId))
        assertTrue(secondPushEntityIds.contains(secondCardId))
        assertFalse(thirdPushEntityIds.contains(firstCardId))
        assertFalse(thirdPushEntityIds.contains(secondCardId))
        assertTrue(baseGateway.bootstrapPullWorkspaceIds.isEmpty())
        assertTrue(baseGateway.bootstrapPushBodies.isEmpty())
        assertTrue(baseGateway.importReviewHistoryBodies.isEmpty())
    }

    @Test
    fun syncRecoversFromWorkspaceForkConflictDuringBootstrapPush() = runBlocking {
        val workspaceId = environment.requireLocalWorkspaceId()
        val seededCardId = environment.seedWorkspaceData(workspaceId = workspaceId)
        val remoteGateway = FakeCloudRemoteGateway.forBootstrapPushScenario(
            bootstrapRemoteIsEmptyResponses = listOf(true, true, true),
            bootstrapPushErrors = listOf(
                createWorkspaceForkRequiredError(
                    path = "/sync/bootstrap",
                    requestId = "request-fork-bootstrap-1",
                    entityType = SyncEntityType.CARD,
                    entityId = seededCardId
                )
            )
        )
        val syncRepository = environment.createSyncRepository(remoteGateway = remoteGateway)

        environment.prepareLinkedCloudIdentity(localWorkspaceId = workspaceId)

        syncRepository.syncNow()

        val recoveredCardId = environment.database.cardDao().loadCards(workspaceId = workspaceId).single().cardId
        val firstBootstrapEntries = remoteGateway.bootstrapPushBodies.first().getJSONArray("entries")
        val secondBootstrapEntries = remoteGateway.bootstrapPushBodies.last().getJSONArray("entries")
        val importedReviewEvent = remoteGateway.importReviewHistoryBodies.single()
            .getJSONArray("reviewEvents")
            .getJSONObject(0)

        assertEquals(SyncStatus.Idle, syncRepository.observeSyncStatus().first().status)
        assertNull(environment.database.cardDao().loadCard(seededCardId))
        assertTrue(recoveredCardId != seededCardId)
        assertEquals(
            seededCardId,
            findBootstrapEntryEntityId(entries = firstBootstrapEntries, entityType = "card")
        )
        assertEquals(
            recoveredCardId,
            findBootstrapEntryEntityId(entries = secondBootstrapEntries, entityType = "card")
        )
        assertEquals(recoveredCardId, importedReviewEvent.getString("cardId"))
        assertEquals("review-$workspaceId", importedReviewEvent.getString("reviewEventId"))
        assertEquals(2, remoteGateway.bootstrapPushBodies.size)
    }

    @Test
    fun syncBlocksRepeatedWorkspaceForkConflictAfterAutomaticRecovery() = runBlocking {
        val workspaceId = environment.requireLocalWorkspaceId()
        val seededCardId = environment.seedWorkspaceData(workspaceId = workspaceId)
        val remoteGateway = FakeCloudRemoteGateway.forBootstrapPushScenario(
            bootstrapRemoteIsEmptyResponses = listOf(true, true, true),
            bootstrapPushErrors = listOf(
                createWorkspaceForkRequiredError(
                    path = "/sync/bootstrap",
                    requestId = "request-fork-bootstrap-1",
                    entityType = SyncEntityType.CARD,
                    entityId = seededCardId
                ),
                createWorkspaceForkRequiredError(
                    path = "/sync/bootstrap",
                    requestId = "request-fork-bootstrap-2",
                    entityType = SyncEntityType.CARD,
                    entityId = seededCardId
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
        val recoveredCardId = environment.database.cardDao().loadCards(workspaceId = workspaceId).single().cardId

        assertTrue(syncStatus is SyncStatus.Blocked)
        assertEquals(
            "Cloud sync bootstrap push is blocked for workspace '$workspaceId': automatic local id recovery already repaired card '$seededCardId' in this sync attempt and the backend still reports the same conflict. Reference: request-fork-bootstrap-2",
            (syncStatus as SyncStatus.Blocked).message
        )
        assertNull(environment.database.cardDao().loadCard(seededCardId))
        assertTrue(recoveredCardId != seededCardId)
        assertEquals(2, remoteGateway.bootstrapPushBodies.size)
    }

    @Test
    fun syncPersistsWorkspaceForkBlockAcrossRepositoryRecreation() = runBlocking {
        val workspaceId = environment.requireLocalWorkspaceId()
        val installationId = environment.cloudPreferencesStore.currentCloudSettings().installationId
        val seededCardId = environment.seedWorkspaceData(workspaceId = workspaceId)
        val blockingGateway = FakeCloudRemoteGateway.forBootstrapPushScenario(
            bootstrapRemoteIsEmptyResponses = listOf(true, true, true),
            bootstrapPushErrors = listOf(
                createWorkspaceForkRequiredError(
                    path = "/sync/bootstrap",
                    requestId = "request-fork-bootstrap-1",
                    entityType = SyncEntityType.CARD,
                    entityId = seededCardId
                ),
                createWorkspaceForkRequiredError(
                    path = "/sync/bootstrap",
                    requestId = "request-fork-bootstrap-2",
                    entityType = SyncEntityType.CARD,
                    entityId = seededCardId
                )
            )
        )
        val initialRepository = environment.createSyncRepository(remoteGateway = blockingGateway)
        val expectedMessage =
            "Cloud sync bootstrap push is blocked for workspace '$workspaceId': automatic local id recovery already repaired card '$seededCardId' in this sync attempt and the backend still reports the same conflict. Reference: request-fork-bootstrap-2"

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
        val seededCardId = environment.seedWorkspaceData(workspaceId = workspaceId)
        val blockingGateway = FakeCloudRemoteGateway.forBootstrapPushScenario(
            bootstrapRemoteIsEmptyResponses = listOf(true, true, true),
            bootstrapPushErrors = listOf(
                createWorkspaceForkRequiredError(
                    path = "/sync/bootstrap",
                    requestId = "request-fork-bootstrap-1",
                    entityType = SyncEntityType.CARD,
                    entityId = seededCardId
                ),
                createWorkspaceForkRequiredError(
                    path = "/sync/bootstrap",
                    requestId = "request-fork-bootstrap-2",
                    entityType = SyncEntityType.CARD,
                    entityId = seededCardId
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
    fun syncKeepsReviewHistoryImportMarkerWhenBootstrapPushCrashesAfterRemoteCommit() = runBlocking {
        val workspaceId = environment.requireLocalWorkspaceId()
        environment.seedWorkspaceData(workspaceId = workspaceId)
        val baseGateway = FakeCloudRemoteGateway.forBootstrapPushScenario(
            bootstrapRemoteIsEmptyResponses = listOf(true),
            bootstrapPushErrors = emptyList()
        )
        val interruptedGateway = object : CloudRemoteGateway by baseGateway {
            override suspend fun bootstrapPush(
                apiBaseUrl: String,
                authorizationHeader: String,
                workspaceId: String,
                body: JSONObject
            ): RemoteBootstrapPushResponse {
                val preCommitSyncState = requireNotNull(environment.database.syncStateDao().loadSyncState(workspaceId)) {
                    "Expected pending review-history import marker before bootstrap push."
                }
                assertTrue(preCommitSyncState.pendingReviewHistoryImport)
                assertFalse(preCommitSyncState.hasHydratedReviewHistory)

                baseGateway.bootstrapPush(
                    apiBaseUrl = apiBaseUrl,
                    authorizationHeader = authorizationHeader,
                    workspaceId = workspaceId,
                    body = body
                )

                val postCommitSyncState = requireNotNull(environment.database.syncStateDao().loadSyncState(workspaceId)) {
                    "Expected pending review-history import marker after bootstrap push commit."
                }
                assertTrue(postCommitSyncState.pendingReviewHistoryImport)
                assertFalse(postCommitSyncState.hasHydratedReviewHistory)
                throw IllegalStateException("Simulated process death after bootstrap hot state commit.")
            }
        }
        val interruptedRepository = environment.createSyncRepository(remoteGateway = interruptedGateway)

        environment.prepareLinkedCloudIdentity(localWorkspaceId = workspaceId)

        try {
            interruptedRepository.syncNow()
            throw AssertionError("Expected interrupted bootstrap push.")
        } catch (error: IllegalStateException) {
            assertEquals("Simulated process death after bootstrap hot state commit.", error.message)
        }

        val interruptedSyncState = requireNotNull(environment.database.syncStateDao().loadSyncState(workspaceId)) {
            "Expected sync state for workspace '$workspaceId' after interrupted bootstrap push."
        }
        assertTrue(interruptedSyncState.pendingReviewHistoryImport)
        assertFalse(interruptedSyncState.hasHydratedReviewHistory)
        assertEquals(1, baseGateway.bootstrapPushBodies.size)
        assertTrue(baseGateway.importReviewHistoryBodies.isEmpty())

        val resumedGateway = FakeCloudRemoteGateway.forReviewHistoryImportScenario(
            bootstrapRemoteIsEmptyResponses = listOf(false),
            importReviewHistoryErrors = emptyList()
        )
        val resumedRepository = environment.createSyncRepository(remoteGateway = resumedGateway)

        resumedRepository.syncNow()

        val importedReviewEvent = resumedGateway.importReviewHistoryBodies.single()
            .getJSONArray("reviewEvents")
            .getJSONObject(0)
        val completedSyncState = requireNotNull(environment.database.syncStateDao().loadSyncState(workspaceId)) {
            "Expected sync state for workspace '$workspaceId' after resumed review-history import."
        }

        assertEquals("review-$workspaceId", importedReviewEvent.getString("reviewEventId"))
        assertEquals("card-$workspaceId", importedReviewEvent.getString("cardId"))
        assertFalse(completedSyncState.pendingReviewHistoryImport)
        assertTrue(completedSyncState.hasHydratedReviewHistory)
        assertEquals(listOf(workspaceId), resumedGateway.bootstrapPullWorkspaceIds)
        assertTrue(resumedGateway.bootstrapPushBodies.isEmpty())
        assertEquals(
            listOf(
                "bootstrap_pull",
                "import_review_history",
                "pull",
                "pull_review_history"
            ),
            resumedGateway.syncRequestEvents
        )
    }

    @Test
    fun syncRetriesBootstrapPushWhenPendingReviewHistoryMarkerSurvivesFailedPush() = runBlocking {
        val workspaceId = environment.requireLocalWorkspaceId()
        environment.seedWorkspaceData(workspaceId = workspaceId)
        val remoteGateway = FakeCloudRemoteGateway.forBootstrapPushScenario(
            bootstrapRemoteIsEmptyResponses = listOf(true, true),
            bootstrapPushErrors = listOf(IllegalStateException("Simulated bootstrap push failure before commit."))
        )
        val syncRepository = environment.createSyncRepository(remoteGateway = remoteGateway)

        environment.prepareLinkedCloudIdentity(localWorkspaceId = workspaceId)

        try {
            syncRepository.syncNow()
            throw AssertionError("Expected failed bootstrap push.")
        } catch (error: IllegalStateException) {
            assertEquals("Simulated bootstrap push failure before commit.", error.message)
        }

        val failedSyncState = requireNotNull(environment.database.syncStateDao().loadSyncState(workspaceId)) {
            "Expected sync state for workspace '$workspaceId' after failed bootstrap push."
        }
        assertTrue(failedSyncState.pendingReviewHistoryImport)
        assertFalse(failedSyncState.hasHydratedReviewHistory)
        assertEquals(1, remoteGateway.bootstrapPushBodies.size)
        assertTrue(remoteGateway.importReviewHistoryBodies.isEmpty())

        syncRepository.syncNow()

        val importedReviewEvent = remoteGateway.importReviewHistoryBodies.single()
            .getJSONArray("reviewEvents")
            .getJSONObject(0)
        val completedSyncState = requireNotNull(environment.database.syncStateDao().loadSyncState(workspaceId)) {
            "Expected sync state for workspace '$workspaceId' after retrying bootstrap push."
        }

        assertEquals("review-$workspaceId", importedReviewEvent.getString("reviewEventId"))
        assertEquals("card-$workspaceId", importedReviewEvent.getString("cardId"))
        assertEquals(2, remoteGateway.bootstrapPushBodies.size)
        assertFalse(completedSyncState.pendingReviewHistoryImport)
        assertTrue(completedSyncState.hasHydratedReviewHistory)
        assertEquals(
            listOf(
                "bootstrap_pull",
                "bootstrap_push",
                "bootstrap_pull",
                "bootstrap_push",
                "import_review_history",
                "pull",
                "pull_review_history"
            ),
            remoteGateway.syncRequestEvents
        )
    }

    @Test
    fun syncResumesReviewHistoryImportAfterBootstrapPushCrashWhenRemoteIsNoLongerEmpty() = runBlocking {
        val workspaceId = environment.requireLocalWorkspaceId()
        environment.seedWorkspaceData(workspaceId = workspaceId)
        val baseGateway = FakeCloudRemoteGateway.forBootstrapPushScenario(
            bootstrapRemoteIsEmptyResponses = listOf(true),
            bootstrapPushErrors = emptyList()
        )
        val interruptedGateway = object : CloudRemoteGateway by baseGateway {
            override suspend fun importReviewHistory(
                apiBaseUrl: String,
                authorizationHeader: String,
                workspaceId: String,
                body: JSONObject
            ): RemoteReviewHistoryImportResponse {
                throw IllegalStateException("Simulated process death before review history import.")
            }
        }
        val interruptedRepository = environment.createSyncRepository(remoteGateway = interruptedGateway)

        environment.prepareLinkedCloudIdentity(localWorkspaceId = workspaceId)

        try {
            interruptedRepository.syncNow()
            throw AssertionError("Expected interrupted review-history import.")
        } catch (error: IllegalStateException) {
            assertEquals("Simulated process death before review history import.", error.message)
        }

        val interruptedSyncState = requireNotNull(environment.database.syncStateDao().loadSyncState(workspaceId)) {
            "Expected sync state for workspace '$workspaceId' after interrupted bootstrap push."
        }
        assertTrue(interruptedSyncState.pendingReviewHistoryImport)
        assertFalse(interruptedSyncState.hasHydratedReviewHistory)
        assertEquals(1, baseGateway.bootstrapPushBodies.size)
        assertTrue(baseGateway.importReviewHistoryBodies.isEmpty())

        val resumedGateway = FakeCloudRemoteGateway.forReviewHistoryImportScenario(
            bootstrapRemoteIsEmptyResponses = listOf(false),
            importReviewHistoryErrors = emptyList()
        )
        val resumedRepository = environment.createSyncRepository(remoteGateway = resumedGateway)

        resumedRepository.syncNow()

        val importedReviewEvent = resumedGateway.importReviewHistoryBodies.single()
            .getJSONArray("reviewEvents")
            .getJSONObject(0)
        val completedSyncState = requireNotNull(environment.database.syncStateDao().loadSyncState(workspaceId)) {
            "Expected sync state for workspace '$workspaceId' after resumed review-history import."
        }

        assertEquals("review-$workspaceId", importedReviewEvent.getString("reviewEventId"))
        assertEquals("card-$workspaceId", importedReviewEvent.getString("cardId"))
        assertFalse(completedSyncState.pendingReviewHistoryImport)
        assertTrue(completedSyncState.hasHydratedReviewHistory)
        assertEquals(listOf(workspaceId), resumedGateway.bootstrapPullWorkspaceIds)
        assertTrue(resumedGateway.bootstrapPushBodies.isEmpty())
        assertEquals(
            listOf(
                "bootstrap_pull",
                "import_review_history",
                "pull",
                "pull_review_history"
            ),
            resumedGateway.syncRequestEvents
        )
    }

    @Test
    fun syncRetriesReviewHistoryImportAfterReIdWithoutRestartingBootstrap() = runBlocking {
        val workspaceId = environment.requireLocalWorkspaceId()
        val seededCardId = environment.seedWorkspaceData(workspaceId = workspaceId)
        val originalReviewEventId = "review-$workspaceId"
        val remoteGateway = FakeCloudRemoteGateway.forReviewHistoryImportScenario(
            bootstrapRemoteIsEmptyResponses = listOf(true, false),
            importReviewHistoryErrors = listOf(
                createWorkspaceForkRequiredError(
                    path = "/sync/review-history/import",
                    requestId = "request-review-history-1",
                    entityType = SyncEntityType.REVIEW_EVENT,
                    entityId = originalReviewEventId
                )
            )
        )
        val syncRepository = environment.createSyncRepository(remoteGateway = remoteGateway)

        environment.prepareLinkedCloudIdentity(localWorkspaceId = workspaceId)

        syncRepository.syncNow()

        val recoveredReviewLog = environment.database.reviewLogDao().loadReviewLogs(workspaceId = workspaceId).single()
        val firstImportedReviewEvent = remoteGateway.importReviewHistoryBodies.first()
            .getJSONArray("reviewEvents")
            .getJSONObject(0)
        val secondImportedReviewEvent = remoteGateway.importReviewHistoryBodies.last()
            .getJSONArray("reviewEvents")
            .getJSONObject(0)
        val persistedSyncState = requireNotNull(environment.database.syncStateDao().loadSyncState(workspaceId)) {
            "Expected sync state for workspace '$workspaceId' after review-history import recovery."
        }

        assertEquals(SyncStatus.Idle, syncRepository.observeSyncStatus().first().status)
        assertNotNull(environment.database.cardDao().loadCard(seededCardId))
        assertEquals(seededCardId, recoveredReviewLog.cardId)
        assertTrue(recoveredReviewLog.reviewLogId != originalReviewEventId)
        assertEquals(originalReviewEventId, firstImportedReviewEvent.getString("reviewEventId"))
        assertEquals(recoveredReviewLog.reviewLogId, secondImportedReviewEvent.getString("reviewEventId"))
        assertEquals(1, remoteGateway.bootstrapPullWorkspaceIds.size)
        assertEquals(1, remoteGateway.bootstrapPushBodies.size)
        assertEquals(2, remoteGateway.importReviewHistoryBodies.size)
        assertTrue(persistedSyncState.hasHydratedReviewHistory)
        assertEquals(
            listOf(
                "bootstrap_pull",
                "bootstrap_push",
                "import_review_history",
                "import_review_history",
                "pull",
                "pull_review_history"
            ),
            remoteGateway.syncRequestEvents
        )
    }

    @Test
    fun syncBlocksRepeatedReviewHistoryImportForkConflictAfterAutomaticRecovery() = runBlocking {
        val workspaceId = environment.requireLocalWorkspaceId()
        environment.seedWorkspaceData(workspaceId = workspaceId)
        val originalReviewEventId = "review-$workspaceId"
        val remoteGateway = FakeCloudRemoteGateway.forReviewHistoryImportScenario(
            bootstrapRemoteIsEmptyResponses = listOf(true, false),
            importReviewHistoryErrors = listOf(
                createWorkspaceForkRequiredError(
                    path = "/sync/review-history/import",
                    requestId = "request-review-history-1",
                    entityType = SyncEntityType.REVIEW_EVENT,
                    entityId = originalReviewEventId
                ),
                createWorkspaceForkRequiredError(
                    path = "/sync/review-history/import",
                    requestId = "request-review-history-2",
                    entityType = SyncEntityType.REVIEW_EVENT,
                    entityId = originalReviewEventId
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
            "Cloud sync review history import is blocked for workspace '$workspaceId': automatic local id recovery already repaired review_event '$originalReviewEventId' in this sync attempt and the backend still reports the same conflict. Reference: request-review-history-2",
            (syncStatus as SyncStatus.Blocked).message
        )
        assertEquals(1, remoteGateway.bootstrapPullWorkspaceIds.size)
        assertEquals(1, remoteGateway.bootstrapPushBodies.size)
        assertEquals(2, remoteGateway.importReviewHistoryBodies.size)
        assertEquals(
            listOf(
                "bootstrap_pull",
                "bootstrap_push",
                "import_review_history",
                "import_review_history"
            ),
            remoteGateway.syncRequestEvents
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

private fun createWorkspaceForkRequiredError(
    path: String,
    requestId: String,
    entityType: SyncEntityType,
    entityId: String
): CloudRemoteException {
    val remoteEntityType = when (entityType) {
        SyncEntityType.CARD -> "card"
        SyncEntityType.DECK -> "deck"
        SyncEntityType.REVIEW_EVENT -> "review_event"
        SyncEntityType.WORKSPACE_SCHEDULER_SETTINGS -> "workspace_scheduler_settings"
    }
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
                        .put("entityType", remoteEntityType)
                        .put("entityId", entityId)
                        .put("recoverable", true)
                )
            )
            .toString(),
        errorCode = syncWorkspaceForkRequiredErrorCode,
        requestId = requestId,
        syncConflict = CloudSyncConflictDetails(
            entityType = entityType,
            entityId = entityId,
            entryIndex = null,
            reviewEventIndex = null,
            recoverable = true,
            conflictingWorkspaceId = null,
            remoteIsEmpty = null
        )
    )
}

private fun createCardOutboxEntry(
    outboxEntryId: String,
    workspaceId: String,
    installationId: String,
    card: CardEntity,
    createdAtMillis: Long
): OutboxEntryEntity {
    return OutboxEntryEntity(
        outboxEntryId = outboxEntryId,
        workspaceId = workspaceId,
        installationId = installationId,
        entityType = "card",
        entityId = card.cardId,
        operationType = "upsert",
        payloadJson = JSONObject()
            .put("cardId", card.cardId)
            .put("frontText", card.frontText)
            .put("backText", card.backText)
            .put("tags", JSONArray())
            .put("effortLevel", "medium")
            .put("dueAt", JSONObject.NULL)
            .put("createdAt", "2026-04-02T15:50:57.000Z")
            .put("reps", card.reps)
            .put("lapses", card.lapses)
            .put("fsrsCardState", "new")
            .put("fsrsStepIndex", JSONObject.NULL)
            .put("fsrsStability", JSONObject.NULL)
            .put("fsrsDifficulty", JSONObject.NULL)
            .put("fsrsLastReviewedAt", JSONObject.NULL)
            .put("fsrsScheduledDays", JSONObject.NULL)
            .put("deletedAt", JSONObject.NULL)
            .toString(),
        clientUpdatedAtIso = "2026-04-02T15:50:57.000Z",
        createdAtMillis = createdAtMillis,
        attemptCount = 0,
        lastError = null
    )
}

private fun createRemoteCardHotPayload(
    cardId: String,
    frontText: String,
    backText: String,
    tags: List<String>,
    clientUpdatedAt: String
): JSONObject {
    return JSONObject()
        .put("cardId", cardId)
        .put("frontText", frontText)
        .put("backText", backText)
        .put("tags", JSONArray(tags))
        .put("effortLevel", "fast")
        .put("dueAt", JSONObject.NULL)
        .put("createdAt", "2026-04-02T15:50:57.000Z")
        .put("clientUpdatedAt", clientUpdatedAt)
        .put("reps", 0)
        .put("lapses", 0)
        .put("fsrsCardState", "new")
        .put("fsrsStepIndex", JSONObject.NULL)
        .put("fsrsStability", JSONObject.NULL)
        .put("fsrsDifficulty", JSONObject.NULL)
        .put("fsrsLastReviewedAt", JSONObject.NULL)
        .put("fsrsScheduledDays", JSONObject.NULL)
        .put("deletedAt", JSONObject.NULL)
}

private fun collectPushOperationEntityIds(pushBody: JSONObject): List<String> {
    val operations = pushBody.getJSONArray("operations")
    return List(operations.length()) { index ->
        operations.getJSONObject(index).getString("entityId")
    }
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
