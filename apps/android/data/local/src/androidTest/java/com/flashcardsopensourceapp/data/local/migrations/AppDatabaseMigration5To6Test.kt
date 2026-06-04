package com.flashcardsopensourceapp.data.local.migrations

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.sqlite.db.SupportSQLiteOpenHelper
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.database.migrations.migration5To6
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

private const val migration5To6DatabaseName: String = "migration-5-to-6-test.db"

@RunWith(AndroidJUnit4::class)
class AppDatabaseMigration5To6Test {
    @After
    fun tearDown(): Unit {
        val context: Context = ApplicationProvider.getApplicationContext()
        deleteMigrationDatabaseFixture(
            context = context,
            databaseName = migration5To6DatabaseName
        )
    }

    @Test
    fun migrationFromVersion5AddsAppLocalSettingsWithoutDestroyingCards(): Unit {
        val context: Context = ApplicationProvider.getApplicationContext()
        createVersion5Database(context = context)

        val openHelper: SupportSQLiteOpenHelper = openMigrationDatabaseAtVersion(
            context = context,
            databaseName = migration5To6DatabaseName,
            version = 5
        )
        val database: SupportSQLiteDatabase = openHelper.writableDatabase

        try {
            migration5To6.migrate(database)

            assertTrue(migrationTableExists(database = database, tableName = "app_local_settings"))
            assertEquals(
                0L,
                readMigrationSingleLong(
                    database = database,
                    sql = "SELECT COUNT(*) FROM app_local_settings"
                )
            )
            assertEquals(
                1L,
                readMigrationSingleLong(
                    database = database,
                    sql = "SELECT COUNT(*) FROM cards WHERE cardId = 'card-1'"
                )
            )
            assertEquals(
                0L,
                readMigrationSingleLong(
                    database = database,
                    sql = "SELECT reps FROM cards WHERE cardId = 'card-1'"
                )
            )
            assertEquals(
                0L,
                readMigrationSingleLong(
                    database = database,
                    sql = "SELECT lapses FROM cards WHERE cardId = 'card-1'"
                )
            )
            assertEquals(
                "NEW",
                readMigrationSingleString(
                    database = database,
                    sql = "SELECT fsrsCardState FROM cards WHERE cardId = 'card-1'"
                )
            )
            assertEquals(
                "fsrs-6",
                readMigrationSingleString(
                    database = database,
                    sql = """
                        SELECT algorithm
                        FROM workspace_scheduler_settings
                        WHERE workspaceId = 'workspace-local'
                    """.trimIndent()
                )
            )
            assertEquals(
                "[1,10]",
                readMigrationSingleString(
                    database = database,
                    sql = """
                        SELECT learningStepsMinutesJson
                        FROM workspace_scheduler_settings
                        WHERE workspaceId = 'workspace-local'
                    """.trimIndent()
                )
            )
        } finally {
            database.close()
            openHelper.close()
        }
    }

    private fun createVersion5Database(context: Context): Unit {
        createMigrationDatabaseFixture(
            context = context,
            databaseName = migration5To6DatabaseName,
            version = 5
        ) { sqliteDatabase: SQLiteDatabase ->
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
        }
    }
}
