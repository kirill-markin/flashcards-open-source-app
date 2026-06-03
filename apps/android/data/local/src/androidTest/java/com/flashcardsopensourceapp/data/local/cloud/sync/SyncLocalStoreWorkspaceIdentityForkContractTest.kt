package com.flashcardsopensourceapp.data.local.cloud.sync

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.cloud.identity.forkedCardId
import com.flashcardsopensourceapp.data.local.cloud.identity.forkedDeckId
import com.flashcardsopensourceapp.data.local.cloud.identity.forkedReviewEventId
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.CardEntity
import com.flashcardsopensourceapp.data.local.database.CardTagEntity
import com.flashcardsopensourceapp.data.local.database.DeckEntity
import com.flashcardsopensourceapp.data.local.database.ReviewLogEntity
import com.flashcardsopensourceapp.data.local.database.SyncStateEntity
import com.flashcardsopensourceapp.data.local.database.TagEntity
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.FsrsCardState
import com.flashcardsopensourceapp.data.local.model.ReviewRating
import com.flashcardsopensourceapp.data.local.model.SyncEntityType
import com.flashcardsopensourceapp.data.local.model.SyncOperationPayload
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SyncLocalStoreWorkspaceIdentityForkContractTest {
    private lateinit var runtime: SyncLocalStoreTestRuntime
    private val database: AppDatabase
        get() = runtime.database
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
    fun forkWorkspaceIdentityRewritesIdsReferencesAndResetsSyncState(): Unit = runBlocking {
        insertSyncContractWorkspaceShell(
            database = database,
            workspaceId = syncLocalStoreContractWorkspaceId
        )
        val originalCard = CardEntity(
            cardId = "card-1",
            workspaceId = syncLocalStoreContractWorkspaceId,
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
            workspaceId = syncLocalStoreContractWorkspaceId,
            name = "Primary",
            filterDefinitionJson = JSONObject().put("version", 2).toString(),
            createdAtMillis = 4L,
            updatedAtMillis = 5L,
            deletedAtMillis = 10L
        )
        val originalReviewLog = ReviewLogEntity(
            reviewLogId = "review-log-1",
            workspaceId = syncLocalStoreContractWorkspaceId,
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
                    workspaceId = syncLocalStoreContractWorkspaceId,
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
            SyncStateEntity(
                workspaceId = syncLocalStoreContractWorkspaceId,
                lastSyncCursor = "123",
                lastReviewSequenceId = 456L,
                hasHydratedHotState = true,
                hasHydratedReviewHistory = true,
                pendingReviewHistoryImport = false,
                lastSyncAttemptAtMillis = 7L,
                lastSuccessfulSyncAtMillis = 8L,
                lastSyncError = "broken",
                blockedInstallationId = null
            )
        )
        syncLocalStore.enqueueCardUpsert(
            card = originalCard,
            tags = listOf("android"),
            affectsReviewSchedule = true
        )
        syncLocalStore.enqueueDeckUpsert(deck = originalDeck)
        syncLocalStore.enqueueReviewEventAppend(reviewLog = originalReviewLog)

        syncLocalStore.forkWorkspaceIdentity(
            currentLocalWorkspaceId = syncLocalStoreContractWorkspaceId,
            sourceWorkspaceId = syncLocalStoreContractWorkspaceId,
            destinationWorkspace = CloudWorkspaceSummary(
                workspaceId = "workspace-2",
                name = "Forked",
                createdAtMillis = 2_000L,
                isSelected = true
            )
        )

        val expectedForkedCardId = forkedCardId(
            sourceWorkspaceId = syncLocalStoreContractWorkspaceId,
            destinationWorkspaceId = "workspace-2",
            sourceCardId = originalCard.cardId
        )
        val expectedForkedDeckId = forkedDeckId(
            sourceWorkspaceId = syncLocalStoreContractWorkspaceId,
            destinationWorkspaceId = "workspace-2",
            sourceDeckId = originalDeck.deckId
        )
        val expectedForkedReviewEventId = forkedReviewEventId(
            sourceWorkspaceId = syncLocalStoreContractWorkspaceId,
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
            (forkedOutboxEntries.first { entry -> entry.operation.entityType == SyncEntityType.CARD }
                .operation.payload as SyncOperationPayload.Card).payload.cardId
        )
        assertEquals(
            expectedForkedDeckId,
            (forkedOutboxEntries.first { entry -> entry.operation.entityType == SyncEntityType.DECK }
                .operation.payload as SyncOperationPayload.Deck).payload.deckId
        )
        assertEquals(
            expectedForkedReviewEventId,
            (forkedOutboxEntries.first { entry -> entry.operation.entityType == SyncEntityType.REVIEW_EVENT }
                .operation.payload as SyncOperationPayload.ReviewEvent).payload.reviewEventId
        )
        assertEquals(
            expectedForkedCardId,
            (forkedOutboxEntries.first { entry -> entry.operation.entityType == SyncEntityType.REVIEW_EVENT }
                .operation.payload as SyncOperationPayload.ReviewEvent).payload.cardId
        )
        assertNull(database.syncStateDao().loadSyncState(syncLocalStoreContractWorkspaceId))
        assertEquals(
            SyncStateEntity(
                workspaceId = "workspace-2",
                lastSyncCursor = null,
                lastReviewSequenceId = 0L,
                hasHydratedHotState = false,
                hasHydratedReviewHistory = false,
                pendingReviewHistoryImport = false,
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
    fun forkWorkspaceIdentityRewritesCurrentLocalShellUsingSourceNamespace(): Unit = runBlocking {
        insertSyncContractWorkspaceShell(
            database = database,
            workspaceId = syncLocalStoreContractWorkspaceId
        )
        val originalCard = CardEntity(
            cardId = "card-1",
            workspaceId = syncLocalStoreContractWorkspaceId,
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
            workspaceId = syncLocalStoreContractWorkspaceId,
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
            SyncStateEntity(
                workspaceId = syncLocalStoreContractWorkspaceId,
                lastSyncCursor = "123",
                lastReviewSequenceId = 456L,
                hasHydratedHotState = true,
                hasHydratedReviewHistory = true,
                pendingReviewHistoryImport = false,
                lastSyncAttemptAtMillis = 7L,
                lastSuccessfulSyncAtMillis = 8L,
                lastSyncError = "broken",
                blockedInstallationId = null
            )
        )
        syncLocalStore.enqueueCardUpsert(
            card = originalCard,
            tags = emptyList(),
            affectsReviewSchedule = true
        )
        syncLocalStore.enqueueReviewEventAppend(reviewLog = originalReviewLog)

        syncLocalStore.forkWorkspaceIdentity(
            currentLocalWorkspaceId = syncLocalStoreContractWorkspaceId,
            sourceWorkspaceId = "workspace-conflict-source",
            destinationWorkspaceId = syncLocalStoreContractWorkspaceId
        )

        val expectedForkedCardId = forkedCardId(
            sourceWorkspaceId = "workspace-conflict-source",
            destinationWorkspaceId = syncLocalStoreContractWorkspaceId,
            sourceCardId = originalCard.cardId
        )
        val expectedForkedReviewEventId = forkedReviewEventId(
            sourceWorkspaceId = "workspace-conflict-source",
            destinationWorkspaceId = syncLocalStoreContractWorkspaceId,
            sourceReviewEventId = originalReviewLog.reviewLogId
        )
        val forkedReviewLog = database.reviewLogDao().loadReviewLogs().single()
        val forkedOutboxEntries = syncLocalStore.loadOutboxEntries(workspaceId = syncLocalStoreContractWorkspaceId)

        assertEquals(syncLocalStoreContractWorkspaceId, database.workspaceDao().loadAnyWorkspace()?.workspaceId)
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
            SyncStateEntity(
                workspaceId = syncLocalStoreContractWorkspaceId,
                lastSyncCursor = null,
                lastReviewSequenceId = 0L,
                hasHydratedHotState = false,
                hasHydratedReviewHistory = false,
                pendingReviewHistoryImport = false,
                lastSyncAttemptAtMillis = null,
                lastSuccessfulSyncAtMillis = null,
                lastSyncError = null,
                blockedInstallationId = null
            ),
            database.syncStateDao().loadSyncState(syncLocalStoreContractWorkspaceId)
        )
    }

    @Test
    fun forkWorkspaceIdentityKeepsRowsWhenEffectiveIdsDoNotChange(): Unit = runBlocking {
        insertSyncContractWorkspaceShell(
            database = database,
            workspaceId = syncLocalStoreContractWorkspaceId
        )
        val originalCard = CardEntity(
            cardId = "card-1",
            workspaceId = syncLocalStoreContractWorkspaceId,
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
            workspaceId = syncLocalStoreContractWorkspaceId,
            cardId = originalCard.cardId,
            replicaId = "replica-1",
            clientEventId = "client-event-1",
            rating = ReviewRating.GOOD,
            reviewedAtMillis = 3L,
            reviewedAtServerIso = "2026-03-27T19:05:00Z"
        )
        database.cardDao().insertCard(originalCard)
        database.reviewLogDao().insertReviewLog(originalReviewLog)
        syncLocalStore.enqueueCardUpsert(
            card = originalCard,
            tags = emptyList(),
            affectsReviewSchedule = true
        )
        syncLocalStore.enqueueReviewEventAppend(reviewLog = originalReviewLog)

        syncLocalStore.forkWorkspaceIdentity(
            currentLocalWorkspaceId = syncLocalStoreContractWorkspaceId,
            sourceWorkspaceId = syncLocalStoreContractWorkspaceId,
            destinationWorkspaceId = syncLocalStoreContractWorkspaceId
        )

        val reviewLog = database.reviewLogDao().loadReviewLogs().single()
        val outboxEntries = syncLocalStore.loadOutboxEntries(workspaceId = syncLocalStoreContractWorkspaceId)

        assertNotNull(database.cardDao().loadCard(originalCard.cardId))
        assertEquals(1, database.reviewLogDao().countReviewLogs())
        assertEquals(originalReviewLog.reviewLogId, reviewLog.reviewLogId)
        assertEquals(originalCard.cardId, reviewLog.cardId)
        assertEquals(
            setOf(originalCard.cardId, originalReviewLog.reviewLogId),
            outboxEntries.map { entry -> entry.operation.entityId }.toSet()
        )
    }
}
