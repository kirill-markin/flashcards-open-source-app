package com.flashcardsopensourceapp.data.local

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.model.CardDraft
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.repository.LocalCardsRepository
import com.flashcardsopensourceapp.data.local.repository.LocalDecksRepository
import com.flashcardsopensourceapp.data.local.seed.DemoDataSeeder
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AppDatabaseTest {
    private lateinit var database: AppDatabase

    @Before
    fun setUp() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = Room.inMemoryDatabaseBuilder(
            context = context,
            klass = AppDatabase::class.java
        ).allowMainThreadQueries().build()
    }

    @After
    fun tearDown() {
        database.close()
    }

    @Test
    fun seedIsIdempotentAndCreatesDraftSyncTables(): Unit = runBlocking {
        val seeder = DemoDataSeeder(database = database)

        seeder.seedIfNeeded(currentTimeMillis = 100L)
        seeder.seedIfNeeded(currentTimeMillis = 200L)

        assertEquals(1, database.workspaceDao().countWorkspaces())
        assertEquals(1, database.outboxDao().countOutboxEntries())
        assertNotNull(database.syncStateDao().loadSyncState(workspaceId = "workspace-demo"))
    }

    @Test
    fun cardsCrudAndDeckRelationsWork(): Unit = runBlocking {
        DemoDataSeeder(database = database).seedIfNeeded(currentTimeMillis = 100L)
        val cardsRepository = LocalCardsRepository(database = database)
        val decksRepository = LocalDecksRepository(database = database)

        cardsRepository.createCard(
            cardDraft = CardDraft(
                deckId = "deck-android",
                frontText = "What is a ViewModel?",
                backText = "A lifecycle-aware state holder for a screen.",
                tags = listOf("ui", "state"),
                effortLevel = EffortLevel.FAST
            )
        )

        val cards = cardsRepository.observeCards().first()
        val decks = decksRepository.observeDecks().first()

        assertTrue(cards.any { card -> card.frontText == "What is a ViewModel?" && card.deckName == "Android" })
        assertEquals(3, decks.size)
    }
}
