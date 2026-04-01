package com.flashcardsopensourceapp.data.local

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.migration2To3
import com.flashcardsopensourceapp.data.local.database.migration3To4
import com.flashcardsopensourceapp.data.local.database.migration4To5
import com.flashcardsopensourceapp.data.local.database.migration5To6
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class AppDatabaseMigrationTest {
    private val databaseName: String = "migration-test.db"

    @After
    fun tearDown() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        context.deleteDatabase(databaseName)
    }

    @Test
    fun migrationFromVersion2AddsSchedulerStateWithoutDestroyingCards() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        createVersion2Database(context = context)

        val database = Room.databaseBuilder(
            context = context,
            klass = AppDatabase::class.java,
            name = databaseName
        ).addMigrations(migration2To3, migration3To4, migration4To5, migration5To6).build()

        val migratedCard = database.cardDao().loadCard(cardId = "card-1")
        val schedulerSettings = database.workspaceSchedulerSettingsDao().loadWorkspaceSchedulerSettings(
            workspaceId = "workspace-local"
        )

        assertNotNull(migratedCard)
        assertEquals(0, migratedCard?.reps)
        assertEquals(0, migratedCard?.lapses)
        assertEquals("NEW", migratedCard?.fsrsCardState?.name)
        assertNotNull(schedulerSettings)
        assertEquals("fsrs-6", schedulerSettings?.algorithm)
        assertEquals("[1,10]", schedulerSettings?.learningStepsMinutesJson)

        database.close()
    }

    private fun createVersion2Database(context: Context) {
        val databaseFile = context.getDatabasePath(databaseName)
        if (databaseFile.exists()) {
            databaseFile.delete()
        }
        databaseFile.parentFile?.mkdirs()

        val sqliteDatabase = SQLiteDatabase.openOrCreateDatabase(databaseFile, null)
        sqliteDatabase.execSQL(
            "CREATE TABLE workspaces (workspaceId TEXT NOT NULL PRIMARY KEY, name TEXT NOT NULL, createdAtMillis INTEGER NOT NULL)"
        )
        sqliteDatabase.execSQL(
            """
            CREATE TABLE decks (
                deckId TEXT NOT NULL PRIMARY KEY,
                workspaceId TEXT NOT NULL,
                name TEXT NOT NULL,
                filterDefinitionJson TEXT NOT NULL,
                createdAtMillis INTEGER NOT NULL,
                updatedAtMillis INTEGER NOT NULL,
                FOREIGN KEY(workspaceId) REFERENCES workspaces(workspaceId) ON DELETE CASCADE
            )
            """.trimIndent()
        )
        sqliteDatabase.execSQL(
            """
            CREATE TABLE cards (
                cardId TEXT NOT NULL PRIMARY KEY,
                workspaceId TEXT NOT NULL,
                frontText TEXT NOT NULL,
                backText TEXT NOT NULL,
                effortLevel TEXT NOT NULL,
                createdAtMillis INTEGER NOT NULL,
                updatedAtMillis INTEGER NOT NULL,
                FOREIGN KEY(workspaceId) REFERENCES workspaces(workspaceId) ON DELETE CASCADE
            )
            """.trimIndent()
        )
        sqliteDatabase.execSQL(
            """
            CREATE TABLE tags (
                tagId TEXT NOT NULL PRIMARY KEY,
                workspaceId TEXT NOT NULL,
                name TEXT NOT NULL,
                FOREIGN KEY(workspaceId) REFERENCES workspaces(workspaceId) ON DELETE CASCADE
            )
            """.trimIndent()
        )
        sqliteDatabase.execSQL(
            """
            CREATE TABLE card_tags (
                cardId TEXT NOT NULL,
                tagId TEXT NOT NULL,
                PRIMARY KEY(cardId, tagId),
                FOREIGN KEY(cardId) REFERENCES cards(cardId) ON DELETE CASCADE,
                FOREIGN KEY(tagId) REFERENCES tags(tagId) ON DELETE CASCADE
            )
            """.trimIndent()
        )
        sqliteDatabase.execSQL(
            """
            CREATE TABLE review_logs (
                reviewLogId TEXT NOT NULL PRIMARY KEY,
                workspaceId TEXT NOT NULL,
                cardId TEXT NOT NULL,
                rating TEXT NOT NULL,
                reviewedAtMillis INTEGER NOT NULL,
                FOREIGN KEY(workspaceId) REFERENCES workspaces(workspaceId) ON DELETE CASCADE,
                FOREIGN KEY(cardId) REFERENCES cards(cardId) ON DELETE CASCADE
            )
            """.trimIndent()
        )
        sqliteDatabase.execSQL(
            """
            CREATE TABLE outbox_entries (
                outboxEntryId TEXT NOT NULL PRIMARY KEY,
                workspaceId TEXT NOT NULL,
                operationType TEXT NOT NULL,
                payloadJson TEXT NOT NULL,
                createdAtMillis INTEGER NOT NULL,
                FOREIGN KEY(workspaceId) REFERENCES workspaces(workspaceId) ON DELETE CASCADE
            )
            """.trimIndent()
        )
        sqliteDatabase.execSQL(
            "CREATE TABLE sync_state (workspaceId TEXT NOT NULL PRIMARY KEY, lastSyncCursor TEXT, lastSyncAttemptAtMillis INTEGER)"
        )
        sqliteDatabase.execSQL("CREATE INDEX index_decks_workspaceId ON decks(workspaceId)")
        sqliteDatabase.execSQL("CREATE INDEX index_cards_workspaceId ON cards(workspaceId)")
        sqliteDatabase.execSQL("CREATE UNIQUE INDEX index_tags_workspaceId_name ON tags(workspaceId, name)")
        sqliteDatabase.execSQL("CREATE INDEX index_card_tags_tagId ON card_tags(tagId)")
        sqliteDatabase.execSQL("CREATE INDEX index_review_logs_workspaceId ON review_logs(workspaceId)")
        sqliteDatabase.execSQL("CREATE INDEX index_review_logs_cardId ON review_logs(cardId)")
        sqliteDatabase.execSQL("CREATE INDEX index_outbox_entries_workspaceId ON outbox_entries(workspaceId)")

        sqliteDatabase.execSQL(
            "INSERT INTO workspaces (workspaceId, name, createdAtMillis) VALUES ('workspace-local', 'Personal', 100)"
        )
        sqliteDatabase.execSQL(
            "INSERT INTO cards (cardId, workspaceId, frontText, backText, effortLevel, createdAtMillis, updatedAtMillis) VALUES ('card-1', 'workspace-local', 'Front', 'Back', 'FAST', 100, 100)"
        )

        sqliteDatabase.version = 2
        sqliteDatabase.close()
    }
}
