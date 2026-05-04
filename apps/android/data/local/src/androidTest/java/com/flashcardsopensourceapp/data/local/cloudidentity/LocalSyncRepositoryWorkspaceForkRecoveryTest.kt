package com.flashcardsopensourceapp.data.local.cloudidentity

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.cloud.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.cloud.RemotePushOperationResult
import com.flashcardsopensourceapp.data.local.cloud.RemotePushResponse
import com.flashcardsopensourceapp.data.local.database.CardEntity
import com.flashcardsopensourceapp.data.local.database.OutboxEntryEntity
import com.flashcardsopensourceapp.data.local.database.SyncStateEntity
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.FsrsCardState
import com.flashcardsopensourceapp.data.local.model.SyncEntityType
import com.flashcardsopensourceapp.data.local.model.SyncStatus
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LocalSyncRepositoryWorkspaceForkRecoveryTest {
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
                    throw createSyncWorkspaceForkRequiredError(
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
                affectsReviewSchedule = true,
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
                    throw createSyncWorkspaceForkRequiredError(
                        path = "/sync/push",
                        requestId = "request-push-fork-first",
                        entityType = SyncEntityType.CARD,
                        entityId = firstCardId
                    )
                }
                if (pushAttempts == 2) {
                    throw createSyncWorkspaceForkRequiredError(
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
            createSyncCardOutboxEntry(
                outboxEntryId = "outbox-card-1",
                workspaceId = workspaceId,
                installationId = initialInstallationId,
                card = firstCard,
                createdAtMillis = 300L
            )
        )
        environment.database.outboxDao().insertOutboxEntry(
            createSyncCardOutboxEntry(
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
                createSyncWorkspaceForkRequiredError(
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
                createSyncWorkspaceForkRequiredError(
                    path = "/sync/bootstrap",
                    requestId = "request-fork-bootstrap-1",
                    entityType = SyncEntityType.CARD,
                    entityId = seededCardId
                ),
                createSyncWorkspaceForkRequiredError(
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
                createSyncWorkspaceForkRequiredError(
                    path = "/sync/bootstrap",
                    requestId = "request-fork-bootstrap-1",
                    entityType = SyncEntityType.CARD,
                    entityId = seededCardId
                ),
                createSyncWorkspaceForkRequiredError(
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
                createSyncWorkspaceForkRequiredError(
                    path = "/sync/bootstrap",
                    requestId = "request-fork-bootstrap-1",
                    entityType = SyncEntityType.CARD,
                    entityId = seededCardId
                ),
                createSyncWorkspaceForkRequiredError(
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
