package com.flashcardsopensourceapp.data.local.cloud.sync

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.database.entities.CardEntity
import com.flashcardsopensourceapp.data.local.database.entities.CardTagEntity
import com.flashcardsopensourceapp.data.local.database.entities.DeckEntity
import com.flashcardsopensourceapp.data.local.database.entities.ReviewLogEntity
import com.flashcardsopensourceapp.data.local.database.entities.TagEntity
import com.flashcardsopensourceapp.data.local.model.scheduling.EffortLevel
import com.flashcardsopensourceapp.data.local.model.scheduling.FsrsCardState
import com.flashcardsopensourceapp.data.local.model.review.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.review.ReviewRating
import com.flashcardsopensourceapp.data.local.model.sync.SyncEntityType
import com.flashcardsopensourceapp.data.local.model.sync.SyncOperationPayload
import com.flashcardsopensourceapp.data.local.review.ReviewPreferencesStore
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
class SyncLocalStoreForkReidentificationContractTest {
    private lateinit var runtime: SyncLocalStoreTestRuntime
    private val database: AppDatabase
        get() = runtime.database
    private val reviewPreferencesStore: ReviewPreferencesStore
        get() = runtime.reviewPreferencesStore
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
    fun reidentifyWorkspaceForkCardConflictRewritesLocalRowsAndOutboxReferences(): Unit = runBlocking {
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
            deletedAtMillis = null
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
            listOf(CardTagEntity(cardId = originalCard.cardId, tagId = "tag-1"))
        )
        database.reviewLogDao().insertReviewLog(originalReviewLog)
        reviewPreferencesStore.saveSelectedReviewFilter(
            workspaceId = syncLocalStoreContractWorkspaceId,
            reviewFilter = ReviewFilter.Tag(tag = "android")
        )
        syncLocalStore.enqueueCardUpsert(
            card = originalCard,
            tags = listOf("android"),
            affectsReviewSchedule = true
        )
        syncLocalStore.enqueueReviewEventAppend(reviewLog = originalReviewLog)

        val reidentifiedCardId = syncLocalStore.reidentifyWorkspaceForkConflictEntity(
            workspaceId = syncLocalStoreContractWorkspaceId,
            entityType = SyncEntityType.CARD,
            entityId = originalCard.cardId
        )

        val reidentifiedCard = requireNotNull(database.cardDao().loadCard(reidentifiedCardId))
        val reidentifiedReviewLog = database.reviewLogDao()
            .loadReviewLogs(workspaceId = syncLocalStoreContractWorkspaceId)
            .single()
        val reidentifiedCardWithRelations = database.cardDao().observeCardsWithRelations().first().single()
        val outboxEntries = syncLocalStore.loadOutboxEntries(workspaceId = syncLocalStoreContractWorkspaceId)
        val cardOutboxPayload = (
            outboxEntries.first { entry -> entry.operation.entityType == SyncEntityType.CARD }
                .operation.payload as SyncOperationPayload.Card
            ).payload
        val reviewEventOutboxPayload = (
            outboxEntries.first { entry -> entry.operation.entityType == SyncEntityType.REVIEW_EVENT }
                .operation.payload as SyncOperationPayload.ReviewEvent
            ).payload

        assertTrue(reidentifiedCardId != originalCard.cardId)
        assertNull(database.cardDao().loadCard(originalCard.cardId))
        assertEquals(originalCard.frontText, reidentifiedCard.frontText)
        assertEquals(reidentifiedCardId, reidentifiedReviewLog.cardId)
        assertEquals(originalReviewLog.reviewLogId, reidentifiedReviewLog.reviewLogId)
        assertEquals(listOf("android"), reidentifiedCardWithRelations.tags.map(TagEntity::name))
        assertEquals(reidentifiedCardId, cardOutboxPayload.cardId)
        assertEquals(reidentifiedCardId, reviewEventOutboxPayload.cardId)
        assertEquals(
            reidentifiedCardId,
            outboxEntries.first { entry -> entry.operation.entityType == SyncEntityType.CARD }.operation.entityId
        )
        assertEquals(
            ReviewFilter.AllCards,
            reviewPreferencesStore.loadSelectedReviewFilter(workspaceId = syncLocalStoreContractWorkspaceId)
        )
    }

    @Test
    fun reidentifyWorkspaceForkReviewEventConflictRewritesReviewLogAndOutbox(): Unit = runBlocking {
        insertSyncContractWorkspaceShell(
            database = database,
            workspaceId = syncLocalStoreContractWorkspaceId
        )
        insertSyncContractCard(
            database = database,
            workspaceId = syncLocalStoreContractWorkspaceId,
            cardId = "card-1"
        )
        val originalReviewLog = ReviewLogEntity(
            reviewLogId = "review-log-1",
            workspaceId = syncLocalStoreContractWorkspaceId,
            cardId = "card-1",
            replicaId = "replica-1",
            clientEventId = "client-event-1",
            rating = ReviewRating.GOOD,
            reviewedAtMillis = 6L,
            reviewedAtServerIso = "2026-03-27T19:05:00Z"
        )
        database.reviewLogDao().insertReviewLog(originalReviewLog)
        syncLocalStore.enqueueReviewEventAppend(reviewLog = originalReviewLog)

        val reidentifiedReviewEventId = syncLocalStore.reidentifyWorkspaceForkConflictEntity(
            workspaceId = syncLocalStoreContractWorkspaceId,
            entityType = SyncEntityType.REVIEW_EVENT,
            entityId = originalReviewLog.reviewLogId
        )

        val reviewLog = database.reviewLogDao().loadReviewLogs(workspaceId = syncLocalStoreContractWorkspaceId).single()
        val outboxEntry = syncLocalStore.loadOutboxEntries(workspaceId = syncLocalStoreContractWorkspaceId).single()
        val outboxPayload = (outboxEntry.operation.payload as SyncOperationPayload.ReviewEvent).payload

        assertTrue(reidentifiedReviewEventId != originalReviewLog.reviewLogId)
        assertEquals(reidentifiedReviewEventId, reviewLog.reviewLogId)
        assertEquals(originalReviewLog.cardId, reviewLog.cardId)
        assertEquals(reidentifiedReviewEventId, outboxEntry.operation.entityId)
        assertEquals(reidentifiedReviewEventId, outboxPayload.reviewEventId)
        assertEquals(originalReviewLog.cardId, outboxPayload.cardId)
    }

    @Test
    fun reidentifyWorkspaceForkDeckConflictRewritesDeckAndOutbox(): Unit = runBlocking {
        insertSyncContractWorkspaceShell(
            database = database,
            workspaceId = syncLocalStoreContractWorkspaceId
        )
        val originalDeck = DeckEntity(
            deckId = "deck-1",
            workspaceId = syncLocalStoreContractWorkspaceId,
            name = "Primary",
            filterDefinitionJson = JSONObject().put("version", 2).toString(),
            createdAtMillis = 4L,
            updatedAtMillis = 5L,
            deletedAtMillis = null
        )
        database.deckDao().insertDeck(originalDeck)
        reviewPreferencesStore.saveSelectedReviewFilter(
            workspaceId = syncLocalStoreContractWorkspaceId,
            reviewFilter = ReviewFilter.Deck(deckId = originalDeck.deckId)
        )
        syncLocalStore.enqueueDeckUpsert(deck = originalDeck)

        val reidentifiedDeckId = syncLocalStore.reidentifyWorkspaceForkConflictEntity(
            workspaceId = syncLocalStoreContractWorkspaceId,
            entityType = SyncEntityType.DECK,
            entityId = originalDeck.deckId
        )

        val reidentifiedDeck = requireNotNull(database.deckDao().loadDeck(deckId = reidentifiedDeckId))
        val outboxEntry = syncLocalStore.loadOutboxEntries(workspaceId = syncLocalStoreContractWorkspaceId).single()
        val outboxPayload = (outboxEntry.operation.payload as SyncOperationPayload.Deck).payload

        assertTrue(reidentifiedDeckId != originalDeck.deckId)
        assertNull(database.deckDao().loadDeck(deckId = originalDeck.deckId))
        assertEquals(originalDeck.name, reidentifiedDeck.name)
        assertEquals(reidentifiedDeckId, outboxEntry.operation.entityId)
        assertEquals(reidentifiedDeckId, outboxPayload.deckId)
        assertEquals(
            ReviewFilter.AllCards,
            reviewPreferencesStore.loadSelectedReviewFilter(workspaceId = syncLocalStoreContractWorkspaceId)
        )
    }
}
