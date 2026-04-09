package com.flashcardsopensourceapp.data.local

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.migration5To6
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AppDatabaseMigrationTest {
    private val databaseName: String = "migration-test.db"

    @After
    fun tearDown() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        context.deleteDatabase(databaseName)
    }

    @Test
    fun migrationFromVersion5AddsAppLocalSettingsWithoutDestroyingCards() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        createVersion5Database(context = context)

        val database = Room.databaseBuilder(
            context = context,
            klass = AppDatabase::class.java,
            name = databaseName
        ).addMigrations(migration5To6).build()

        val migratedCard = database.cardDao().loadCard(cardId = "card-1")
        val schedulerSettings = database.workspaceSchedulerSettingsDao().loadWorkspaceSchedulerSettings(
            workspaceId = "workspace-local"
        )
        val appLocalSettings = database.appLocalSettingsDao().loadSettings()

        assertNotNull(migratedCard)
        assertEquals(0, migratedCard?.reps)
        assertEquals(0, migratedCard?.lapses)
        assertEquals("NEW", migratedCard?.fsrsCardState?.name)
        assertNotNull(schedulerSettings)
        assertEquals("fsrs-6", schedulerSettings?.algorithm)
        assertEquals("[1,10]", schedulerSettings?.learningStepsMinutesJson)
        assertNull(appLocalSettings)

        database.close()
    }

    private fun createVersion5Database(context: Context) {
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
                deletedAtMillis INTEGER,
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
                dueAtMillis INTEGER,
                createdAtMillis INTEGER NOT NULL,
                updatedAtMillis INTEGER NOT NULL,
                reps INTEGER NOT NULL,
                lapses INTEGER NOT NULL,
                fsrsCardState TEXT NOT NULL,
                fsrsStepIndex INTEGER,
                fsrsStability REAL,
                fsrsDifficulty REAL,
                fsrsLastReviewedAtMillis INTEGER,
                fsrsScheduledDays INTEGER,
                deletedAtMillis INTEGER,
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
                replicaId TEXT NOT NULL,
                clientEventId TEXT NOT NULL,
                rating TEXT NOT NULL,
                reviewedAtMillis INTEGER NOT NULL,
                reviewedAtServerIso TEXT NOT NULL,
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
                installationId TEXT NOT NULL,
                entityType TEXT NOT NULL,
                entityId TEXT NOT NULL,
                operationType TEXT NOT NULL,
                payloadJson TEXT NOT NULL,
                clientUpdatedAtIso TEXT NOT NULL,
                createdAtMillis INTEGER NOT NULL,
                attemptCount INTEGER NOT NULL,
                lastError TEXT,
                FOREIGN KEY(workspaceId) REFERENCES workspaces(workspaceId) ON DELETE CASCADE
            )
            """.trimIndent()
        )
        sqliteDatabase.execSQL(
            """
            CREATE TABLE sync_state (
                workspaceId TEXT NOT NULL PRIMARY KEY,
                lastSyncCursor TEXT,
                lastReviewSequenceId INTEGER NOT NULL,
                hasHydratedHotState INTEGER NOT NULL,
                hasHydratedReviewHistory INTEGER NOT NULL,
                lastSyncAttemptAtMillis INTEGER,
                lastSuccessfulSyncAtMillis INTEGER,
                lastSyncError TEXT
            )
            """.trimIndent()
        )
        sqliteDatabase.execSQL(
            """
            CREATE TABLE workspace_scheduler_settings (
                workspaceId TEXT NOT NULL PRIMARY KEY,
                algorithm TEXT NOT NULL,
                desiredRetention REAL NOT NULL,
                learningStepsMinutesJson TEXT NOT NULL,
                relearningStepsMinutesJson TEXT NOT NULL,
                maximumIntervalDays INTEGER NOT NULL,
                enableFuzz INTEGER NOT NULL,
                updatedAtMillis INTEGER NOT NULL,
                FOREIGN KEY(workspaceId) REFERENCES workspaces(workspaceId) ON DELETE CASCADE
            )
            """.trimIndent()
        )
        sqliteDatabase.execSQL("CREATE INDEX index_decks_workspaceId ON decks(workspaceId)")
        sqliteDatabase.execSQL("CREATE INDEX index_cards_workspaceId ON cards(workspaceId)")
        sqliteDatabase.execSQL("CREATE UNIQUE INDEX index_tags_workspaceId_name ON tags(workspaceId, name)")
        sqliteDatabase.execSQL("CREATE INDEX index_card_tags_tagId ON card_tags(tagId)")
        sqliteDatabase.execSQL("CREATE INDEX index_review_logs_workspaceId ON review_logs(workspaceId)")
        sqliteDatabase.execSQL("CREATE INDEX index_review_logs_cardId ON review_logs(cardId)")
        sqliteDatabase.execSQL("CREATE INDEX index_outbox_entries_workspaceId ON outbox_entries(workspaceId)")
        sqliteDatabase.execSQL("CREATE INDEX index_workspace_scheduler_settings_workspaceId ON workspace_scheduler_settings(workspaceId)")

        sqliteDatabase.execSQL(
            "INSERT INTO workspaces (workspaceId, name, createdAtMillis) VALUES ('workspace-local', 'Personal', 100)"
        )
        sqliteDatabase.execSQL(
            """
            INSERT INTO cards (
                cardId,
                workspaceId,
                frontText,
                backText,
                effortLevel,
                dueAtMillis,
                createdAtMillis,
                updatedAtMillis,
                reps,
                lapses,
                fsrsCardState,
                fsrsStepIndex,
                fsrsStability,
                fsrsDifficulty,
                fsrsLastReviewedAtMillis,
                fsrsScheduledDays,
                deletedAtMillis
            ) VALUES (
                'card-1',
                'workspace-local',
                'Front',
                'Back',
                'FAST',
                NULL,
                100,
                100,
                0,
                0,
                'NEW',
                NULL,
                NULL,
                NULL,
                NULL,
                NULL,
                NULL
            )
            """.trimIndent()
        )
        sqliteDatabase.execSQL(
            """
            INSERT INTO workspace_scheduler_settings (
                workspaceId,
                algorithm,
                desiredRetention,
                learningStepsMinutesJson,
                relearningStepsMinutesJson,
                maximumIntervalDays,
                enableFuzz,
                updatedAtMillis
            ) VALUES (
                'workspace-local',
                'fsrs-6',
                0.9,
                '[1,10]',
                '[10]',
                36500,
                1,
                100
            )
            """.trimIndent()
        )

        sqliteDatabase.version = 5
        sqliteDatabase.close()
    }
}
