package com.flashcardsopensourceapp.data.local.cloud.sync

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.remote.sync.RemoteBootstrapEntry
import com.flashcardsopensourceapp.data.local.cloud.wire.CloudContractMismatchException
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.database.entities.OutboxEntryEntity
import com.flashcardsopensourceapp.data.local.model.sync.SyncEntityType
import com.flashcardsopensourceapp.data.local.model.sync.SyncOperationPayload
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SyncLocalStoreTimestampPayloadContractTest {
    private lateinit var runtime: SyncLocalStoreTestRuntime
    private val database: AppDatabase
        get() = runtime.database
    private val preferencesStore: CloudPreferencesStore
        get() = runtime.preferencesStore
    private val syncLocalStore: SyncLocalStore
        get() = runtime.syncLocalStore

    @Before
    fun setUp(): Unit {
        runtime = createSyncLocalStoreTestRuntime()
    }

    @After
    fun tearDown(): Unit {
        if (::runtime.isInitialized) {
            closeSyncLocalStoreTestRuntime(runtime = runtime)
        }
    }

    @Test
    fun applyBootstrapEntriesAcceptsNullableTimestampFields(): Unit = runBlocking {
        insertSyncContractWorkspaceShell(
            database = database,
            workspaceId = syncLocalStoreContractWorkspaceId
        )

        syncLocalStore.applyBootstrapEntries(
            workspaceId = syncLocalStoreContractWorkspaceId,
            entries = listOf(
                RemoteBootstrapEntry(
                    entityType = SyncEntityType.CARD,
                    entityId = "card-1",
                    action = "upsert",
                    payload = JSONObject()
                        .put("cardId", "card-1")
                        .put("frontText", "Front")
                        .put("backText", "Back")
                        .put("tags", JSONArray().put("android"))
                        .put("effortLevel", "fast")
                        .put("dueAt", JSONObject.NULL)
                        .put("createdAt", "2026-03-27T19:00:00Z")
                        .put("clientUpdatedAt", "2026-03-27T19:01:00Z")
                        .put("reps", 1)
                        .put("lapses", 0)
                        .put("fsrsCardState", "review")
                        .put("fsrsStepIndex", JSONObject.NULL)
                        .put("fsrsStability", JSONObject.NULL)
                        .put("fsrsDifficulty", JSONObject.NULL)
                        .put("fsrsLastReviewedAt", JSONObject.NULL)
                        .put("fsrsScheduledDays", JSONObject.NULL)
                        .put("deletedAt", JSONObject.NULL)
                ),
                RemoteBootstrapEntry(
                    entityType = SyncEntityType.DECK,
                    entityId = "deck-1",
                    action = "upsert",
                    payload = JSONObject()
                        .put("deckId", "deck-1")
                        .put("name", "Primary")
                        .put("filterDefinition", JSONObject().put("version", 2))
                        .put("createdAt", "2026-03-27T19:02:00Z")
                        .put("clientUpdatedAt", "2026-03-27T19:03:00Z")
                        .put("deletedAt", JSONObject.NULL)
                )
            )
        )

        val card = database.cardDao().loadCard("card-1")
        val deck = database.deckDao().loadDeck("deck-1")

        requireNotNull(card)
        requireNotNull(deck)
        assertNull(card.dueAtMillis)
        assertNull(card.fsrsLastReviewedAtMillis)
        assertNull(card.deletedAtMillis)
        assertNull(deck.deletedAtMillis)
    }

    @Test
    fun applyBootstrapEntriesFailsWithExplicitContractMismatchForWrongTimestampType(): Unit = runBlocking {
        insertSyncContractWorkspaceShell(
            database = database,
            workspaceId = syncLocalStoreContractWorkspaceId
        )

        val error = expectThrows<CloudContractMismatchException> {
            runBlocking {
                syncLocalStore.applyBootstrapEntries(
                    workspaceId = syncLocalStoreContractWorkspaceId,
                    entries = listOf(
                        RemoteBootstrapEntry(
                            entityType = SyncEntityType.CARD,
                            entityId = "card-1",
                            action = "upsert",
                            payload = JSONObject()
                                .put("cardId", "card-1")
                                .put("frontText", "Front")
                                .put("backText", "Back")
                                .put("tags", JSONArray())
                                .put("effortLevel", "fast")
                                .put("dueAt", 123)
                                .put("createdAt", "2026-03-27T19:00:00Z")
                                .put("clientUpdatedAt", "2026-03-27T19:01:00Z")
                                .put("reps", 1)
                                .put("lapses", 0)
                                .put("fsrsCardState", "review")
                                .put("fsrsStepIndex", JSONObject.NULL)
                                .put("fsrsStability", JSONObject.NULL)
                                .put("fsrsDifficulty", JSONObject.NULL)
                                .put("fsrsLastReviewedAt", JSONObject.NULL)
                                .put("fsrsScheduledDays", JSONObject.NULL)
                                .put("deletedAt", JSONObject.NULL)
                        )
                    )
                )
            }
        }

        assertEquals(
            "Cloud contract mismatch for bootstrap.entries[0].payload.dueAt: expected string or null, got integer",
            error.message
        )
    }

    @Test
    fun loadOutboxEntriesKeepsNullableTimestampFieldsNull(): Unit = runBlocking {
        insertSyncContractWorkspaceShell(
            database = database,
            workspaceId = syncLocalStoreContractWorkspaceId
        )
        database.outboxDao().insertOutboxEntry(
            OutboxEntryEntity(
                outboxEntryId = "outbox-1",
                workspaceId = syncLocalStoreContractWorkspaceId,
                installationId = preferencesStore.currentCloudSettings().installationId,
                entityType = "card",
                entityId = "card-1",
                operationType = "upsert",
                payloadJson = JSONObject()
                    .put("cardId", "card-1")
                    .put("frontText", "Front")
                    .put("backText", "Back")
                    .put("tags", JSONArray())
                    .put("effortLevel", "fast")
                    .put("dueAt", JSONObject.NULL)
                    .put("createdAt", "2026-03-27T19:00:00Z")
                    .put("reps", 1)
                    .put("lapses", 0)
                    .put("fsrsCardState", "review")
                    .put("fsrsStepIndex", JSONObject.NULL)
                    .put("fsrsStability", JSONObject.NULL)
                    .put("fsrsDifficulty", JSONObject.NULL)
                    .put("fsrsLastReviewedAt", JSONObject.NULL)
                    .put("fsrsScheduledDays", JSONObject.NULL)
                    .put("deletedAt", JSONObject.NULL)
                    .toString(),
                clientUpdatedAtIso = "2026-03-27T19:01:00Z",
                createdAtMillis = 1L,
                affectsReviewSchedule = true,
                attemptCount = 0,
                lastError = null
            )
        )

        val outboxEntries = syncLocalStore.loadOutboxEntries(workspaceId = syncLocalStoreContractWorkspaceId)
        val payload = (outboxEntries.single().operation.payload as SyncOperationPayload.Card).payload

        assertNull(payload.dueAt)
        assertNull(payload.fsrsLastReviewedAt)
        assertNull(payload.deletedAt)
    }
}

private inline fun <reified T : Throwable> expectThrows(block: () -> Unit): T {
    try {
        block()
    } catch (error: Throwable) {
        if (error is T) {
            return error
        }
        throw error
    }

    fail("Expected ${T::class.java.simpleName} to be thrown.")
    throw IllegalStateException("Unreachable")
}
