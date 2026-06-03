package com.flashcardsopensourceapp.data.local

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.sqlite.db.SupportSQLiteOpenHelper
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.database.entities.cardsRecentlyReviewedDueIndexName
import com.flashcardsopensourceapp.data.local.database.entities.cardsReviewQueueIndexName
import com.flashcardsopensourceapp.data.local.database.migrations.migration14To15
import com.flashcardsopensourceapp.data.local.database.migrations.migration15To16
import com.flashcardsopensourceapp.data.local.database.migrations.migration16To17
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

private const val migration14To15DatabaseName: String = "migration-14-to-15-test.db"
private const val migration15To16DatabaseName: String = "migration-15-to-16-test.db"
private const val migration16To17DatabaseName: String = "migration-16-to-17-test.db"

@RunWith(AndroidJUnit4::class)
class AppDatabaseMigration14To17Test {
    @After
    fun tearDown(): Unit {
        val context: Context = ApplicationProvider.getApplicationContext()
        deleteMigrationDatabaseFixture(
            context = context,
            databaseName = migration14To15DatabaseName
        )
        deleteMigrationDatabaseFixture(
            context = context,
            databaseName = migration15To16DatabaseName
        )
        deleteMigrationDatabaseFixture(
            context = context,
            databaseName = migration16To17DatabaseName
        )
    }

    @Test
    fun migration14To15AddsProgressReviewScheduleCacheTable(): Unit {
        val context: Context = ApplicationProvider.getApplicationContext()
        createVersion14Database(context = context)

        val openHelper: SupportSQLiteOpenHelper = openMigrationDatabaseAtVersion(
            context = context,
            databaseName = migration14To15DatabaseName,
            version = 14
        )
        val database: SupportSQLiteDatabase = openHelper.writableDatabase

        try {
            migration14To15.migrate(database)

            assertTrue(
                migrationTableExists(
                    database = database,
                    tableName = "progress_review_schedule_cache"
                )
            )
            assertEquals(
                0L,
                readMigrationSingleLong(
                    database = database,
                    sql = "SELECT COUNT(*) FROM progress_review_schedule_cache"
                )
            )
        } finally {
            database.close()
            openHelper.close()
        }
    }

    @Test
    fun migration15To16AddsReviewScheduleImpactFlagToOutboxEntries(): Unit {
        val context: Context = ApplicationProvider.getApplicationContext()
        createVersion15Database(context = context)

        val openHelper: SupportSQLiteOpenHelper = openMigrationDatabaseAtVersion(
            context = context,
            databaseName = migration15To16DatabaseName,
            version = 15
        )
        val database: SupportSQLiteDatabase = openHelper.writableDatabase

        try {
            migration15To16.migrate(database)

            assertEquals(
                1L,
                readMigrationSingleLong(
                    database = database,
                    sql = """
                        SELECT affectsReviewSchedule
                        FROM outbox_entries
                        WHERE outboxEntryId = 'outbox-card-upsert'
                    """.trimIndent()
                )
            )
            assertEquals(
                0L,
                readMigrationSingleLong(
                    database = database,
                    sql = """
                        SELECT affectsReviewSchedule
                        FROM outbox_entries
                        WHERE outboxEntryId = 'outbox-review-event'
                    """.trimIndent()
                )
            )
            assertEquals(
                0L,
                readMigrationSingleLong(
                    database = database,
                    sql = """
                        SELECT affectsReviewSchedule
                        FROM outbox_entries
                        WHERE outboxEntryId = 'outbox-deck-upsert'
                    """.trimIndent()
                )
            )
        } finally {
            database.close()
            openHelper.close()
        }
    }

    @Test
    fun migration16To17AddsRecentlyReviewedDueIndex(): Unit {
        val context: Context = ApplicationProvider.getApplicationContext()
        createVersion16Database(context = context)

        val openHelper: SupportSQLiteOpenHelper = openMigrationDatabaseAtVersion(
            context = context,
            databaseName = migration16To17DatabaseName,
            version = 16
        )
        val database: SupportSQLiteDatabase = openHelper.writableDatabase

        try {
            migration16To17.migrate(database)

            assertEquals(
                listOf(
                    "workspaceId",
                    "fsrsLastReviewedAtMillis",
                    "dueAtMillis",
                    "createdAtMillis",
                    "cardId"
                ),
                readMigrationIndexColumns(
                    database = database,
                    indexName = cardsRecentlyReviewedDueIndexName
                )
            )
        } finally {
            database.close()
            openHelper.close()
        }
    }

    private fun createVersion14Database(context: Context): Unit {
        createMigrationDatabaseFixture(
            context = context,
            databaseName = migration14To15DatabaseName,
            version = 14
        ) { _: SQLiteDatabase -> }
    }

    private fun createVersion15Database(context: Context): Unit {
        createMigrationDatabaseFixture(
            context = context,
            databaseName = migration15To16DatabaseName,
            version = 15
        ) { sqliteDatabase: SQLiteDatabase ->
            sqliteDatabase.execSQL(
                "CREATE TABLE workspaces (workspaceId TEXT NOT NULL PRIMARY KEY, name TEXT NOT NULL, createdAtMillis INTEGER NOT NULL)"
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
                "INSERT INTO workspaces (workspaceId, name, createdAtMillis) VALUES ('workspace-local', 'Personal', 100)"
            )
            sqliteDatabase.execSQL(
                """
                INSERT INTO outbox_entries (
                    outboxEntryId,
                    workspaceId,
                    installationId,
                    entityType,
                    entityId,
                    operationType,
                    payloadJson,
                    clientUpdatedAtIso,
                    createdAtMillis,
                    attemptCount,
                    lastError
                ) VALUES (
                    'outbox-card-upsert',
                    'workspace-local',
                    'installation-1',
                    'card',
                    'card-1',
                    'upsert',
                    '{}',
                    '2026-05-03T10:00:00Z',
                    100,
                    0,
                    NULL
                )
                """.trimIndent()
            )
            sqliteDatabase.execSQL(
                """
                INSERT INTO outbox_entries (
                    outboxEntryId,
                    workspaceId,
                    installationId,
                    entityType,
                    entityId,
                    operationType,
                    payloadJson,
                    clientUpdatedAtIso,
                    createdAtMillis,
                    attemptCount,
                    lastError
                ) VALUES (
                    'outbox-review-event',
                    'workspace-local',
                    'installation-1',
                    'review_event',
                    'review-1',
                    'append',
                    '{}',
                    '2026-05-03T10:00:00Z',
                    101,
                    0,
                    NULL
                )
                """.trimIndent()
            )
            sqliteDatabase.execSQL(
                """
                INSERT INTO outbox_entries (
                    outboxEntryId,
                    workspaceId,
                    installationId,
                    entityType,
                    entityId,
                    operationType,
                    payloadJson,
                    clientUpdatedAtIso,
                    createdAtMillis,
                    attemptCount,
                    lastError
                ) VALUES (
                    'outbox-deck-upsert',
                    'workspace-local',
                    'installation-1',
                    'deck',
                    'deck-1',
                    'upsert',
                    '{}',
                    '2026-05-03T10:00:00Z',
                    102,
                    0,
                    NULL
                )
                """.trimIndent()
            )
        }
    }

    private fun createVersion16Database(context: Context): Unit {
        createMigrationDatabaseFixture(
            context = context,
            databaseName = migration16To17DatabaseName,
            version = 16
        ) { sqliteDatabase: SQLiteDatabase ->
            sqliteDatabase.execSQL(
                "CREATE TABLE workspaces (workspaceId TEXT NOT NULL PRIMARY KEY, name TEXT NOT NULL, createdAtMillis INTEGER NOT NULL)"
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
            sqliteDatabase.execSQL("CREATE INDEX index_cards_workspaceId ON cards(workspaceId)")
            sqliteDatabase.execSQL(
                """
                CREATE INDEX $cardsReviewQueueIndexName
                ON cards(workspaceId, dueAtMillis, createdAtMillis, cardId)
                """.trimIndent()
            )
        }
    }
}
