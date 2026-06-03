package com.flashcardsopensourceapp.data.local.cloud.sync

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.cloud.remote.RemoteBootstrapEntry
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.CardEntity
import com.flashcardsopensourceapp.data.local.database.CardTagEntity
import com.flashcardsopensourceapp.data.local.database.DeckEntity
import com.flashcardsopensourceapp.data.local.database.TagEntity
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.FsrsCardState
import com.flashcardsopensourceapp.data.local.model.SyncEntityType
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SyncLocalStoreHotRowPreservationContractTest {
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
    fun applyBootstrapEntriesPreservesPendingLocalHotRows(): Unit = runBlocking {
        insertSyncContractWorkspaceShell(
            database = database,
            workspaceId = syncLocalStoreContractWorkspaceId
        )
        val dirtyCard = CardEntity(
            cardId = "card-dirty",
            workspaceId = syncLocalStoreContractWorkspaceId,
            frontText = "Local front",
            backText = "Local back",
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
        val dirtyDeck = DeckEntity(
            deckId = "deck-dirty",
            workspaceId = syncLocalStoreContractWorkspaceId,
            name = "Local deck",
            filterDefinitionJson = JSONObject()
                .put("version", 2)
                .put("tags", JSONArray().put("local"))
                .toString(),
            createdAtMillis = 3L,
            updatedAtMillis = 4L,
            deletedAtMillis = null
        )
        database.cardDao().insertCard(dirtyCard)
        database.deckDao().insertDeck(dirtyDeck)
        database.tagDao().insertTags(
            listOf(
                TagEntity(
                    tagId = "tag-local",
                    workspaceId = syncLocalStoreContractWorkspaceId,
                    name = "local"
                )
            )
        )
        database.tagDao().insertCardTags(
            listOf(CardTagEntity(cardId = dirtyCard.cardId, tagId = "tag-local"))
        )
        syncLocalStore.enqueueCardUpsert(
            card = dirtyCard,
            tags = listOf("local"),
            affectsReviewSchedule = true
        )
        syncLocalStore.enqueueDeckUpsert(deck = dirtyDeck)

        syncLocalStore.applyBootstrapEntries(
            workspaceId = syncLocalStoreContractWorkspaceId,
            entries = listOf(
                remoteCardBootstrapEntry(
                    cardId = dirtyCard.cardId,
                    frontText = "Remote front",
                    backText = "Remote back",
                    tags = listOf("remote"),
                    clientUpdatedAt = "2026-03-27T19:10:00Z"
                ),
                remoteDeckBootstrapEntry(
                    deckId = dirtyDeck.deckId,
                    name = "Remote deck",
                    clientUpdatedAt = "2026-03-27T19:11:00Z"
                ),
                remoteCardBootstrapEntry(
                    cardId = "card-clean",
                    frontText = "Clean front",
                    backText = "Clean back",
                    tags = listOf("clean"),
                    clientUpdatedAt = "2026-03-27T19:12:00Z"
                ),
                remoteDeckBootstrapEntry(
                    deckId = "deck-clean",
                    name = "Clean deck",
                    clientUpdatedAt = "2026-03-27T19:13:00Z"
                )
            )
        )

        val preservedCard = requireNotNull(database.cardDao().loadCard(dirtyCard.cardId))
        val preservedDeck = requireNotNull(database.deckDao().loadDeck(dirtyDeck.deckId))
        val cleanCard = requireNotNull(database.cardDao().loadCard("card-clean"))
        val cleanDeck = requireNotNull(database.deckDao().loadDeck("deck-clean"))
        val preservedCardTags = database.cardDao()
            .observeCardsWithRelations()
            .first()
            .single { card -> card.card.cardId == dirtyCard.cardId }
            .tags
            .map(TagEntity::name)

        assertEquals("Local front", preservedCard.frontText)
        assertEquals("Local back", preservedCard.backText)
        assertEquals(listOf("local"), preservedCardTags)
        assertEquals("Local deck", preservedDeck.name)
        assertEquals("Clean front", cleanCard.frontText)
        assertEquals("Clean deck", cleanDeck.name)
    }
}

private fun remoteCardBootstrapEntry(
    cardId: String,
    frontText: String,
    backText: String,
    tags: List<String>,
    clientUpdatedAt: String
): RemoteBootstrapEntry {
    return RemoteBootstrapEntry(
        entityType = SyncEntityType.CARD,
        entityId = cardId,
        action = "upsert",
        payload = JSONObject()
            .put("cardId", cardId)
            .put("frontText", frontText)
            .put("backText", backText)
            .put("tags", JSONArray(tags))
            .put("effortLevel", "fast")
            .put("dueAt", JSONObject.NULL)
            .put("createdAt", "2026-03-27T19:00:00Z")
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
    )
}

private fun remoteDeckBootstrapEntry(
    deckId: String,
    name: String,
    clientUpdatedAt: String
): RemoteBootstrapEntry {
    return RemoteBootstrapEntry(
        entityType = SyncEntityType.DECK,
        entityId = deckId,
        action = "upsert",
        payload = JSONObject()
            .put("deckId", deckId)
            .put("name", name)
            .put("filterDefinition", JSONObject().put("version", 2))
            .put("createdAt", "2026-03-27T19:00:00Z")
            .put("clientUpdatedAt", clientUpdatedAt)
            .put("deletedAt", JSONObject.NULL)
    )
}
