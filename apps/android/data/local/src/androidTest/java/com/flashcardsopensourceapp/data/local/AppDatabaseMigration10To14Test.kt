package com.flashcardsopensourceapp.data.local

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.sqlite.db.SupportSQLiteOpenHelper
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.database.entities.cardsReviewQueueIndexName
import com.flashcardsopensourceapp.data.local.database.migrations.migration10To11
import com.flashcardsopensourceapp.data.local.database.migrations.migration12To13
import com.flashcardsopensourceapp.data.local.database.migrations.migration13To14
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

private const val migration10To11DatabaseName: String = "migration-10-to-11-test.db"
private const val migration12To13DatabaseName: String = "migration-12-to-13-test.db"
private const val migration13To14DatabaseName: String = "migration-13-to-14-test.db"

@RunWith(AndroidJUnit4::class)
class AppDatabaseMigration10To14Test {
    @After
    fun tearDown(): Unit {
        val context: Context = ApplicationProvider.getApplicationContext()
        deleteMigrationDatabaseFixture(
            context = context,
            databaseName = migration10To11DatabaseName
        )
        deleteMigrationDatabaseFixture(
            context = context,
            databaseName = migration12To13DatabaseName
        )
        deleteMigrationDatabaseFixture(
            context = context,
            databaseName = migration13To14DatabaseName
        )
    }

    @Test
    fun migration10To11AddsReviewedAtIndexToReviewLogs(): Unit {
        val context: Context = ApplicationProvider.getApplicationContext()
        createVersion10Database(context = context)

        val openHelper: SupportSQLiteOpenHelper = openMigrationDatabaseAtVersion(
            context = context,
            databaseName = migration10To11DatabaseName,
            version = 10
        )
        val database: SupportSQLiteDatabase = openHelper.writableDatabase

        try {
            migration10To11.migrate(database)

            val reviewLogIndexNames: List<String> = readMigrationIndexNames(
                database = database,
                tableName = "review_logs"
            )
            assertTrue(reviewLogIndexNames.contains("index_review_logs_reviewedAtMillis"))
        } finally {
            database.close()
            openHelper.close()
        }
    }

    @Test
    fun migration12To13AddsPendingReviewHistoryImportMarkerDefaultFalse(): Unit {
        val context: Context = ApplicationProvider.getApplicationContext()
        createVersion12Database(context = context)

        val openHelper: SupportSQLiteOpenHelper = openMigrationDatabaseAtVersion(
            context = context,
            databaseName = migration12To13DatabaseName,
            version = 12
        )
        val database: SupportSQLiteDatabase = openHelper.writableDatabase

        try {
            migration12To13.migrate(database)

            assertEquals(
                0L,
                readMigrationSingleLong(
                    database = database,
                    sql = """
                        SELECT pendingReviewHistoryImport
                        FROM sync_state
                        WHERE workspaceId = 'workspace-local'
                    """.trimIndent()
                )
            )
        } finally {
            database.close()
            openHelper.close()
        }
    }

    @Test
    fun migration13To14AddsCardsReviewQueueIndex(): Unit {
        val context: Context = ApplicationProvider.getApplicationContext()
        createVersion13Database(context = context)

        val openHelper: SupportSQLiteOpenHelper = openMigrationDatabaseAtVersion(
            context = context,
            databaseName = migration13To14DatabaseName,
            version = 13
        )
        val database: SupportSQLiteDatabase = openHelper.writableDatabase

        try {
            migration13To14.migrate(database)

            assertEquals(
                listOf("workspaceId", "dueAtMillis", "createdAtMillis", "cardId"),
                readMigrationIndexColumns(
                    database = database,
                    indexName = cardsReviewQueueIndexName
                )
            )
        } finally {
            database.close()
            openHelper.close()
        }
    }

    private fun createVersion10Database(context: Context): Unit {
        createMigrationDatabaseFixture(
            context = context,
            databaseName = migration10To11DatabaseName,
            version = 10
        ) { sqliteDatabase: SQLiteDatabase ->
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
                    reviewedAtServerIso TEXT NOT NULL
                )
                """.trimIndent()
            )
        }
    }

    private fun createVersion12Database(context: Context): Unit {
        createMigrationDatabaseFixture(
            context = context,
            databaseName = migration12To13DatabaseName,
            version = 12
        ) { sqliteDatabase: SQLiteDatabase ->
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
                    lastSyncError TEXT,
                    blockedInstallationId TEXT
                )
                """.trimIndent()
            )
            sqliteDatabase.execSQL(
                """
                INSERT INTO sync_state (
                    workspaceId,
                    lastSyncCursor,
                    lastReviewSequenceId,
                    hasHydratedHotState,
                    hasHydratedReviewHistory,
                    lastSyncAttemptAtMillis,
                    lastSuccessfulSyncAtMillis,
                    lastSyncError,
                    blockedInstallationId
                ) VALUES (
                    'workspace-local',
                    '123',
                    456,
                    1,
                    0,
                    1000,
                    NULL,
                    NULL,
                    NULL
                )
                """.trimIndent()
            )
        }
    }

    private fun createVersion13Database(context: Context): Unit {
        createMigrationDatabaseFixture(
            context = context,
            databaseName = migration13To14DatabaseName,
            version = 13
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
        }
    }
}
