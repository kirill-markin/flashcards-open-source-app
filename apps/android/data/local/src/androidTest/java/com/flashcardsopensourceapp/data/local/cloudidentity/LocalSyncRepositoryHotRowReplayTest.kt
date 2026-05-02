package com.flashcardsopensourceapp.data.local.cloudidentity

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.cloud.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.cloud.RemoteBootstrapEntry
import com.flashcardsopensourceapp.data.local.cloud.RemoteBootstrapPullResponse
import com.flashcardsopensourceapp.data.local.cloud.RemotePullResponse
import com.flashcardsopensourceapp.data.local.cloud.RemotePushOperationResult
import com.flashcardsopensourceapp.data.local.cloud.RemotePushResponse
import com.flashcardsopensourceapp.data.local.cloud.RemoteSyncChange
import com.flashcardsopensourceapp.data.local.database.CardEntity
import com.flashcardsopensourceapp.data.local.database.SyncStateEntity
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
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LocalSyncRepositoryHotRowReplayTest {
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
            createSyncCardOutboxEntry(
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
                        createSyncCardOutboxEntry(
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
            createSyncCardOutboxEntry(
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
