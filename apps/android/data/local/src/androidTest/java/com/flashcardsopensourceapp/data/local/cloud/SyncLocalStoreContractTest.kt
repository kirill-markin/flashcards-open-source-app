package com.flashcardsopensourceapp.data.local.cloud

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.CardTagEntity
import com.flashcardsopensourceapp.data.local.database.CardEntity
import com.flashcardsopensourceapp.data.local.database.DeckEntity
import com.flashcardsopensourceapp.data.local.database.OutboxEntryEntity
import com.flashcardsopensourceapp.data.local.database.ReviewLogEntity
import com.flashcardsopensourceapp.data.local.database.TagEntity
import com.flashcardsopensourceapp.data.local.database.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.database.WorkspaceSchedulerSettingsEntity
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.FsrsCardState
import com.flashcardsopensourceapp.data.local.model.ReviewRating
import com.flashcardsopensourceapp.data.local.model.SyncEntityType
import com.flashcardsopensourceapp.data.local.model.SyncOperationPayload
import com.flashcardsopensourceapp.data.local.model.encodeSchedulerStepListJson
import com.flashcardsopensourceapp.data.local.model.makeDefaultWorkspaceSchedulerSettings
import com.flashcardsopensourceapp.data.local.repository.LocalProgressCacheStore
import com.flashcardsopensourceapp.data.local.repository.SystemProgressTimeProvider
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import java.time.Instant
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SyncLocalStoreContractTest {
    private lateinit var context: Context
    private lateinit var database: AppDatabase
    private lateinit var preferencesStore: CloudPreferencesStore
    private lateinit var syncLocalStore: SyncLocalStore

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        context.deleteSharedPreferences("flashcards-cloud-metadata")
        context.deleteSharedPreferences("flashcards-cloud-secrets")
        database = Room.inMemoryDatabaseBuilder(
            context = context,
            klass = AppDatabase::class.java
        ).allowMainThreadQueries().build()
        preferencesStore = CloudPreferencesStore(context = context, database = database)
        syncLocalStore = SyncLocalStore(
            database = database,
            preferencesStore = preferencesStore,
            localProgressCacheStore = LocalProgressCacheStore(
                database = database,
                timeProvider = SystemProgressTimeProvider
            )
        )
    }

    @After
    fun tearDown() {
        database.close()
        context.deleteSharedPreferences("flashcards-cloud-metadata")
        context.deleteSharedPreferences("flashcards-cloud-secrets")
    }

    @Test
    fun applyBootstrapEntriesAcceptsNullableTimestampFields() = runBlocking {
        insertWorkspaceShell()

        syncLocalStore.applyBootstrapEntries(
            workspaceId = workspaceId,
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
    fun applyBootstrapEntriesFailsWithExplicitContractMismatchForWrongTimestampType() = runBlocking {
        insertWorkspaceShell()

        val error = expectThrows<CloudContractMismatchException> {
            runBlocking {
                syncLocalStore.applyBootstrapEntries(
                    workspaceId = workspaceId,
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
    fun loadOutboxEntriesKeepsNullableTimestampFieldsNull() = runBlocking {
        insertWorkspaceShell()
        database.outboxDao().insertOutboxEntry(
            OutboxEntryEntity(
                outboxEntryId = "outbox-1",
                workspaceId = workspaceId,
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
                attemptCount = 0,
                lastError = null
            )
        )

        val outboxEntries = syncLocalStore.loadOutboxEntries(workspaceId = workspaceId)
        val payload = (outboxEntries.single().operation.payload as SyncOperationPayload.Card).payload

        assertNull(payload.dueAt)
        assertNull(payload.fsrsLastReviewedAt)
        assertNull(payload.deletedAt)
    }

    @Test
    fun forkWorkspaceIdentityRewritesIdsReferencesAndResetsSyncState() = runBlocking {
        insertWorkspaceShell()
        val originalCard = CardEntity(
            cardId = "card-1",
            workspaceId = workspaceId,
            frontText = "Front",
            backText = "Back",
            effortLevel = EffortLevel.MEDIUM,
            dueAtMillis = null,
            createdAtMillis = 1L,
            updatedAtMillis = 2L,
            reps = 1,
            lapses = 0,
            fsrsCardState = FsrsCardState.REVIEW,
            fsrsStepIndex = null,
            fsrsStability = 3.5,
            fsrsDifficulty = 4.0,
            fsrsLastReviewedAtMillis = 3L,
            fsrsScheduledDays = 5,
            deletedAtMillis = 9L
        )
        val originalDeck = DeckEntity(
            deckId = "deck-1",
            workspaceId = workspaceId,
            name = "Primary",
            filterDefinitionJson = JSONObject().put("version", 2).toString(),
            createdAtMillis = 4L,
            updatedAtMillis = 5L,
            deletedAtMillis = 10L
        )
        val originalReviewLog = ReviewLogEntity(
            reviewLogId = "review-log-1",
            workspaceId = workspaceId,
            cardId = originalCard.cardId,
            replicaId = "replica-1",
            clientEventId = "client-event-1",
            rating = ReviewRating.GOOD,
            reviewedAtMillis = 6L,
            reviewedAtServerIso = "2026-03-27T19:05:00Z"
        )
        database.cardDao().insertCard(originalCard)
        database.deckDao().insertDeck(originalDeck)
        database.tagDao().insertTags(
            listOf(
                TagEntity(
                    tagId = "tag-1",
                    workspaceId = workspaceId,
                    name = "android"
                )
            )
        )
        database.tagDao().insertCardTags(
            listOf(
                CardTagEntity(
                    cardId = originalCard.cardId,
                    tagId = "tag-1"
                )
            )
        )
        database.reviewLogDao().insertReviewLog(originalReviewLog)
        database.syncStateDao().insertSyncState(
            com.flashcardsopensourceapp.data.local.database.SyncStateEntity(
                workspaceId = workspaceId,
                lastSyncCursor = "123",
                lastReviewSequenceId = 456L,
                hasHydratedHotState = true,
                hasHydratedReviewHistory = true,
                lastSyncAttemptAtMillis = 7L,
                lastSuccessfulSyncAtMillis = 8L,
                lastSyncError = "broken",
                blockedInstallationId = null
            )
        )
        syncLocalStore.enqueueCardUpsert(card = originalCard, tags = listOf("android"))
        syncLocalStore.enqueueDeckUpsert(deck = originalDeck)
        syncLocalStore.enqueueReviewEventAppend(reviewLog = originalReviewLog)

        syncLocalStore.forkWorkspaceIdentity(
            currentLocalWorkspaceId = workspaceId,
            sourceWorkspaceId = workspaceId,
            destinationWorkspace = CloudWorkspaceSummary(
                workspaceId = "workspace-2",
                name = "Forked",
                createdAtMillis = 2_000L,
                isSelected = true
            )
        )

        val expectedForkedCardId = forkedCardId(
            sourceWorkspaceId = workspaceId,
            destinationWorkspaceId = "workspace-2",
            sourceCardId = originalCard.cardId
        )
        val expectedForkedDeckId = forkedDeckId(
            sourceWorkspaceId = workspaceId,
            destinationWorkspaceId = "workspace-2",
            sourceDeckId = originalDeck.deckId
        )
        val expectedForkedReviewEventId = forkedReviewEventId(
            sourceWorkspaceId = workspaceId,
            destinationWorkspaceId = "workspace-2",
            sourceReviewEventId = originalReviewLog.reviewLogId
        )
        val forkedCard = requireNotNull(database.cardDao().loadCard(expectedForkedCardId))
        val forkedDeck = requireNotNull(database.deckDao().loadDeck(expectedForkedDeckId))
        val forkedReviewLog = database.reviewLogDao().loadReviewLogs().single()
        val forkedCardWithRelations = database.cardDao().observeCardsWithRelations().first().single()
        val forkedOutboxEntries = syncLocalStore.loadOutboxEntries(workspaceId = "workspace-2")

        assertNull(database.cardDao().loadCard(originalCard.cardId))
        assertNull(database.deckDao().loadDeck(originalDeck.deckId))
        assertEquals("workspace-2", database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        assertEquals("workspace-2", forkedCard.workspaceId)
        assertEquals(originalCard.frontText, forkedCard.frontText)
        assertEquals(originalCard.deletedAtMillis, forkedCard.deletedAtMillis)
        assertEquals("workspace-2", forkedDeck.workspaceId)
        assertEquals(originalDeck.deletedAtMillis, forkedDeck.deletedAtMillis)
        assertEquals(expectedForkedReviewEventId, forkedReviewLog.reviewLogId)
        assertEquals(expectedForkedCardId, forkedReviewLog.cardId)
        assertEquals("workspace-2", forkedReviewLog.workspaceId)
        assertEquals(listOf("android"), forkedCardWithRelations.tags.map(TagEntity::name))
        assertEquals(
            setOf(expectedForkedCardId, expectedForkedDeckId, expectedForkedReviewEventId),
            forkedOutboxEntries.map { entry -> entry.operation.entityId }.toSet()
        )
        assertEquals(
            expectedForkedCardId,
            (forkedOutboxEntries.first { entry -> entry.operation.entityType == com.flashcardsopensourceapp.data.local.model.SyncEntityType.CARD }
                .operation.payload as SyncOperationPayload.Card).payload.cardId
        )
        assertEquals(
            expectedForkedDeckId,
            (forkedOutboxEntries.first { entry -> entry.operation.entityType == com.flashcardsopensourceapp.data.local.model.SyncEntityType.DECK }
                .operation.payload as SyncOperationPayload.Deck).payload.deckId
        )
        assertEquals(
            expectedForkedReviewEventId,
            (forkedOutboxEntries.first { entry -> entry.operation.entityType == com.flashcardsopensourceapp.data.local.model.SyncEntityType.REVIEW_EVENT }
                .operation.payload as SyncOperationPayload.ReviewEvent).payload.reviewEventId
        )
        assertEquals(
            expectedForkedCardId,
            (forkedOutboxEntries.first { entry -> entry.operation.entityType == com.flashcardsopensourceapp.data.local.model.SyncEntityType.REVIEW_EVENT }
                .operation.payload as SyncOperationPayload.ReviewEvent).payload.cardId
        )
        assertNull(database.syncStateDao().loadSyncState(workspaceId))
        assertEquals(
            com.flashcardsopensourceapp.data.local.database.SyncStateEntity(
                workspaceId = "workspace-2",
                lastSyncCursor = null,
                lastReviewSequenceId = 0L,
                hasHydratedHotState = false,
                hasHydratedReviewHistory = false,
                lastSyncAttemptAtMillis = null,
                lastSuccessfulSyncAtMillis = null,
                lastSyncError = null,
                blockedInstallationId = null
            ),
            database.syncStateDao().loadSyncState("workspace-2")
        )
        assertEquals(
            "workspace-2",
            database.workspaceSchedulerSettingsDao().loadWorkspaceSchedulerSettings("workspace-2")?.workspaceId
        )
    }

    @Test
    fun forkWorkspaceIdentityRewritesCurrentLocalShellUsingSourceNamespace() = runBlocking {
        insertWorkspaceShell()
        val originalCard = CardEntity(
            cardId = "card-1",
            workspaceId = workspaceId,
            frontText = "Front",
            backText = "Back",
            effortLevel = EffortLevel.MEDIUM,
            dueAtMillis = null,
            createdAtMillis = 1L,
            updatedAtMillis = 2L,
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
        val originalReviewLog = ReviewLogEntity(
            reviewLogId = "review-log-1",
            workspaceId = workspaceId,
            cardId = originalCard.cardId,
            replicaId = "replica-1",
            clientEventId = "client-event-1",
            rating = ReviewRating.GOOD,
            reviewedAtMillis = 3L,
            reviewedAtServerIso = "2026-03-27T19:05:00Z"
        )
        database.cardDao().insertCard(originalCard)
        database.reviewLogDao().insertReviewLog(originalReviewLog)
        database.syncStateDao().insertSyncState(
            com.flashcardsopensourceapp.data.local.database.SyncStateEntity(
                workspaceId = workspaceId,
                lastSyncCursor = "123",
                lastReviewSequenceId = 456L,
                hasHydratedHotState = true,
                hasHydratedReviewHistory = true,
                lastSyncAttemptAtMillis = 7L,
                lastSuccessfulSyncAtMillis = 8L,
                lastSyncError = "broken",
                blockedInstallationId = null
            )
        )
        syncLocalStore.enqueueCardUpsert(card = originalCard, tags = emptyList())
        syncLocalStore.enqueueReviewEventAppend(reviewLog = originalReviewLog)

        syncLocalStore.forkWorkspaceIdentity(
            currentLocalWorkspaceId = workspaceId,
            sourceWorkspaceId = "workspace-conflict-source",
            destinationWorkspaceId = workspaceId
        )

        val expectedForkedCardId = forkedCardId(
            sourceWorkspaceId = "workspace-conflict-source",
            destinationWorkspaceId = workspaceId,
            sourceCardId = originalCard.cardId
        )
        val expectedForkedReviewEventId = forkedReviewEventId(
            sourceWorkspaceId = "workspace-conflict-source",
            destinationWorkspaceId = workspaceId,
            sourceReviewEventId = originalReviewLog.reviewLogId
        )
        val forkedReviewLog = database.reviewLogDao().loadReviewLogs().single()
        val forkedOutboxEntries = syncLocalStore.loadOutboxEntries(workspaceId = workspaceId)

        assertEquals(workspaceId, database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        assertNull(database.cardDao().loadCard(originalCard.cardId))
        assertNotNull(database.cardDao().loadCard(expectedForkedCardId))
        assertEquals(expectedForkedReviewEventId, forkedReviewLog.reviewLogId)
        assertEquals(expectedForkedCardId, forkedReviewLog.cardId)
        assertEquals(
            setOf(expectedForkedCardId, expectedForkedReviewEventId),
            forkedOutboxEntries.map { entry -> entry.operation.entityId }.toSet()
        )
        assertEquals(
            expectedForkedCardId,
            (forkedOutboxEntries.first { entry -> entry.operation.entityType == SyncEntityType.CARD }
                .operation.payload as SyncOperationPayload.Card).payload.cardId
        )
        assertEquals(
            expectedForkedReviewEventId,
            (forkedOutboxEntries.first { entry -> entry.operation.entityType == SyncEntityType.REVIEW_EVENT }
                .operation.payload as SyncOperationPayload.ReviewEvent).payload.reviewEventId
        )
        assertEquals(
            com.flashcardsopensourceapp.data.local.database.SyncStateEntity(
                workspaceId = workspaceId,
                lastSyncCursor = null,
                lastReviewSequenceId = 0L,
                hasHydratedHotState = false,
                hasHydratedReviewHistory = false,
                lastSyncAttemptAtMillis = null,
                lastSuccessfulSyncAtMillis = null,
                lastSyncError = null,
                blockedInstallationId = null
            ),
            database.syncStateDao().loadSyncState(workspaceId)
        )
    }

    @Test
    fun forkWorkspaceIdentityKeepsRowsWhenEffectiveIdsDoNotChange() = runBlocking {
        insertWorkspaceShell()
        val originalCard = CardEntity(
            cardId = "card-1",
            workspaceId = workspaceId,
            frontText = "Front",
            backText = "Back",
            effortLevel = EffortLevel.MEDIUM,
            dueAtMillis = null,
            createdAtMillis = 1L,
            updatedAtMillis = 2L,
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
        val originalReviewLog = ReviewLogEntity(
            reviewLogId = "review-log-1",
            workspaceId = workspaceId,
            cardId = originalCard.cardId,
            replicaId = "replica-1",
            clientEventId = "client-event-1",
            rating = ReviewRating.GOOD,
            reviewedAtMillis = 3L,
            reviewedAtServerIso = "2026-03-27T19:05:00Z"
        )
        database.cardDao().insertCard(originalCard)
        database.reviewLogDao().insertReviewLog(originalReviewLog)
        syncLocalStore.enqueueCardUpsert(card = originalCard, tags = emptyList())
        syncLocalStore.enqueueReviewEventAppend(reviewLog = originalReviewLog)

        syncLocalStore.forkWorkspaceIdentity(
            currentLocalWorkspaceId = workspaceId,
            sourceWorkspaceId = workspaceId,
            destinationWorkspaceId = workspaceId
        )

        val reviewLog = database.reviewLogDao().loadReviewLogs().single()
        val outboxEntries = syncLocalStore.loadOutboxEntries(workspaceId = workspaceId)

        assertNotNull(database.cardDao().loadCard(originalCard.cardId))
        assertEquals(1, database.reviewLogDao().countReviewLogs())
        assertEquals(originalReviewLog.reviewLogId, reviewLog.reviewLogId)
        assertEquals(originalCard.cardId, reviewLog.cardId)
        assertEquals(
            setOf(originalCard.cardId, originalReviewLog.reviewLogId),
            outboxEntries.map { entry -> entry.operation.entityId }.toSet()
        )
    }

    @Test
    fun migrateLocalShellEmitsReviewHistoryChangedEventWhenReviewLogsAreDeleted() = runBlocking {
        insertWorkspaceShell()
        insertCard()
        database.reviewLogDao().insertReviewLog(
            ReviewLogEntity(
                reviewLogId = "review-log-1",
                workspaceId = workspaceId,
                cardId = "card-1",
                replicaId = "replica-1",
                clientEventId = "client-event-1",
                rating = ReviewRating.GOOD,
                reviewedAtMillis = 1_000L,
                reviewedAtServerIso = "2026-03-27T19:05:00Z"
            )
        )

        val eventDeferred = async(start = CoroutineStart.UNDISPATCHED) {
            withTimeout(5_000L) {
                syncLocalStore.observeReviewHistoryChangedEvents().first()
            }
        }

        syncLocalStore.migrateLocalShellToLinkedWorkspace(
            workspace = CloudWorkspaceSummary(
                workspaceId = "workspace-2",
                name = "Replacement",
                createdAtMillis = 2_000L,
                isSelected = true
            ),
            remoteWorkspaceIsEmpty = false
        )

        val event = eventDeferred.await()

        assertEquals(setOf(workspaceId), event.workspaceIds)
        assertNull(event.latestReviewedAtMillis)
        assertEquals(0, database.reviewLogDao().countReviewLogs())
    }

    @Test
    fun reviewHistoryBatchFlushEmitsSingleMergedEventOnlyAfterFlush() = runBlocking {
        insertWorkspaceShell()
        insertCard()
        syncLocalStore.beginReviewHistoryChangeBatch()

        val eventDeferred = async(start = CoroutineStart.UNDISPATCHED) {
            withTimeout(5_000L) {
                syncLocalStore.observeReviewHistoryChangedEvents().first()
            }
        }

        syncLocalStore.applyReviewHistory(
            events = listOf(
                makeRemoteReviewHistoryEvent(
                    reviewEventId = "review-log-1",
                    reviewedAtClient = "2026-03-27T08:00:00Z"
                )
            )
        )
        syncLocalStore.applyReviewHistory(
            events = listOf(
                makeRemoteReviewHistoryEvent(
                    reviewEventId = "review-log-2",
                    reviewedAtClient = "2026-03-27T22:00:00Z"
                )
            )
        )

        assertFalse(eventDeferred.isCompleted)

        syncLocalStore.flushReviewHistoryChangeBatch()

        val event = eventDeferred.await()

        assertEquals(setOf(workspaceId), event.workspaceIds)
        assertEquals(
            Instant.parse("2026-03-27T22:00:00Z").toEpochMilli(),
            event.latestReviewedAtMillis
        )
    }

    @Test
    fun reviewHistoryBatchFlushReplaysMergedEventToLateSubscribers() = runBlocking {
        insertWorkspaceShell()
        insertCard()
        syncLocalStore.beginReviewHistoryChangeBatch()

        syncLocalStore.applyReviewHistory(
            events = listOf(
                makeRemoteReviewHistoryEvent(
                    reviewEventId = "review-log-1",
                    reviewedAtClient = "2026-03-27T08:00:00Z"
                )
            )
        )
        syncLocalStore.applyReviewHistory(
            events = listOf(
                makeRemoteReviewHistoryEvent(
                    reviewEventId = "review-log-2",
                    reviewedAtClient = "2026-03-27T22:00:00Z"
                )
            )
        )
        syncLocalStore.flushReviewHistoryChangeBatch()

        val event = withTimeout(5_000L) {
            syncLocalStore.observeReviewHistoryChangedEvents().first()
        }

        assertEquals(setOf(workspaceId), event.workspaceIds)
        assertEquals(
            Instant.parse("2026-03-27T22:00:00Z").toEpochMilli(),
            event.latestReviewedAtMillis
        )
    }

    private suspend fun insertWorkspaceShell() {
        database.workspaceDao().insertWorkspace(
            WorkspaceEntity(
                workspaceId = workspaceId,
                name = "Workspace",
                createdAtMillis = 1L
            )
        )
        val settings = makeDefaultWorkspaceSchedulerSettings(
            workspaceId = workspaceId,
            updatedAtMillis = 1L
        )
        database.workspaceSchedulerSettingsDao().insertWorkspaceSchedulerSettings(
            WorkspaceSchedulerSettingsEntity(
                workspaceId = settings.workspaceId,
                algorithm = settings.algorithm,
                desiredRetention = settings.desiredRetention,
                learningStepsMinutesJson = encodeSchedulerStepListJson(settings.learningStepsMinutes),
                relearningStepsMinutesJson = encodeSchedulerStepListJson(settings.relearningStepsMinutes),
                maximumIntervalDays = settings.maximumIntervalDays,
                enableFuzz = settings.enableFuzz,
                updatedAtMillis = settings.updatedAtMillis
            )
        )
    }

    private suspend fun insertCard() {
        database.cardDao().insertCard(
            CardEntity(
                cardId = "card-1",
                workspaceId = workspaceId,
                frontText = "Front",
                backText = "Back",
                effortLevel = EffortLevel.MEDIUM,
                dueAtMillis = null,
                createdAtMillis = 1L,
                updatedAtMillis = 1L,
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
    }
}

private const val workspaceId: String = "workspace-1"

private fun makeRemoteReviewHistoryEvent(
    reviewEventId: String,
    reviewedAtClient: String
): RemoteReviewHistoryEvent {
    return RemoteReviewHistoryEvent(
        reviewEventId = reviewEventId,
        workspaceId = workspaceId,
        cardId = "card-1",
        replicaId = "replica-1",
        clientEventId = "client-event-$reviewEventId",
        rating = ReviewRating.GOOD.ordinal,
        reviewedAtClient = reviewedAtClient,
        reviewedAtServer = reviewedAtClient
    )
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
