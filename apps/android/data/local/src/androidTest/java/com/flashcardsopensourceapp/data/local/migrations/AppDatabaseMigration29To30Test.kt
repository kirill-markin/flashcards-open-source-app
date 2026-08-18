package com.flashcardsopensourceapp.data.local.migrations

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.sqlite.db.SupportSQLiteOpenHelper
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.database.migrations.migration29To30
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

private const val migration29To30DatabaseName: String = "migration-29-to-30-test.db"

@RunWith(AndroidJUnit4::class)
class AppDatabaseMigration29To30Test {
    @After
    fun tearDown(): Unit {
        val context: Context = ApplicationProvider.getApplicationContext()
        deleteMigrationDatabaseFixture(
            context = context,
            databaseName = migration29To30DatabaseName
        )
    }

    @Test
    fun migration29To30InvalidatesLegacyProgressCacheAndPreservesReviewLogs(): Unit {
        val context: Context = ApplicationProvider.getApplicationContext()
        createVersion29Database(context = context)

        val openHelper: SupportSQLiteOpenHelper = openMigrationDatabaseAtVersion(
            context = context,
            databaseName = migration29To30DatabaseName,
            version = 29
        )
        val database: SupportSQLiteDatabase = openHelper.writableDatabase

        try {
            migration29To30.migrate(database)

            assertEquals(
                0L,
                readMigrationSingleLong(
                    database = database,
                    sql = "SELECT COUNT(*) FROM progress_local_day_counts"
                )
            )
            assertEquals(
                0L,
                readMigrationSingleLong(
                    database = database,
                    sql = "SELECT COUNT(*) FROM progress_local_cache_state"
                )
            )
            assertEquals(
                2L,
                readMigrationSingleLong(
                    database = database,
                    sql = "SELECT COUNT(*) FROM review_logs"
                )
            )
            assertEquals(
                "GOOD",
                readMigrationSingleString(
                    database = database,
                    sql = "SELECT rating FROM review_logs WHERE reviewLogId = 'review-log-1'"
                )
            )
            assertEquals(
                "America/New_York",
                readMigrationSingleString(
                    database = database,
                    sql = "SELECT reviewedTimeZone FROM review_logs WHERE reviewLogId = 'review-log-2'"
                )
            )
            assertEquals(
                2L,
                readMigrationSingleLong(
                    database = database,
                    sql = "SELECT COUNT(*) FROM progress_review_history_state"
                )
            )
        } finally {
            database.close()
            openHelper.close()
        }
    }

    private fun createVersion29Database(context: Context): Unit {
        createMigrationDatabaseFixture(
            context = context,
            databaseName = migration29To30DatabaseName,
            version = 29
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
                    reviewedAtServerIso TEXT NOT NULL,
                    reviewedTimeZone TEXT
                )
                """.trimIndent()
            )
            sqliteDatabase.execSQL(
                """
                CREATE TABLE progress_review_history_state (
                    workspaceId TEXT NOT NULL PRIMARY KEY,
                    historyVersion INTEGER NOT NULL,
                    reviewLogCount INTEGER NOT NULL,
                    maxReviewedAtMillis INTEGER NOT NULL
                )
                """.trimIndent()
            )
            sqliteDatabase.execSQL(
                """
                CREATE TABLE progress_local_day_counts (
                    timeZone TEXT NOT NULL,
                    workspaceId TEXT NOT NULL,
                    localDate TEXT NOT NULL,
                    reviewCount INTEGER NOT NULL,
                    againCount INTEGER NOT NULL,
                    hardCount INTEGER NOT NULL,
                    goodCount INTEGER NOT NULL,
                    easyCount INTEGER NOT NULL,
                    PRIMARY KEY(timeZone, workspaceId, localDate)
                )
                """.trimIndent()
            )
            sqliteDatabase.execSQL(
                """
                CREATE TABLE progress_local_cache_state (
                    timeZone TEXT NOT NULL,
                    workspaceId TEXT NOT NULL,
                    historyVersion INTEGER NOT NULL,
                    updatedAtMillis INTEGER NOT NULL,
                    PRIMARY KEY(timeZone, workspaceId)
                )
                """.trimIndent()
            )
            sqliteDatabase.execSQL(
                """
                INSERT INTO review_logs (
                    reviewLogId,
                    workspaceId,
                    cardId,
                    replicaId,
                    clientEventId,
                    rating,
                    reviewedAtMillis,
                    reviewedAtServerIso,
                    reviewedTimeZone
                ) VALUES
                    ('review-log-1', 'workspace-1', 'card-1', 'replica-1', 'event-1', 'GOOD', 1000,
                        '1970-01-01T00:00:01.000Z', 'Europe/Paris'),
                    ('review-log-2', 'workspace-2', 'card-2', 'replica-2', 'event-2', 'HARD', 2000,
                        '1970-01-01T00:00:02.000Z', 'America/New_York')
                """.trimIndent()
            )
            sqliteDatabase.execSQL(
                """
                INSERT INTO progress_review_history_state (
                    workspaceId,
                    historyVersion,
                    reviewLogCount,
                    maxReviewedAtMillis
                ) VALUES
                    ('workspace-1', 1, 1, 1000),
                    ('workspace-2', 1, 1, 2000)
                """.trimIndent()
            )
            sqliteDatabase.execSQL(
                """
                INSERT INTO progress_local_day_counts (
                    timeZone,
                    workspaceId,
                    localDate,
                    reviewCount,
                    againCount,
                    hardCount,
                    goodCount,
                    easyCount
                ) VALUES
                    ('Europe/Paris', 'workspace-1', '1970-01-01', 1, 0, 0, 0, 0),
                    ('America/New_York', 'workspace-2', '1969-12-31', 1, 0, 0, 0, 0),
                    ('Asia/Tokyo', 'workspace-with-empty-history', '1970-01-01', 1, 0, 0, 0, 0)
                """.trimIndent()
            )
            sqliteDatabase.execSQL(
                """
                INSERT INTO progress_local_cache_state (
                    timeZone,
                    workspaceId,
                    historyVersion,
                    updatedAtMillis
                ) VALUES
                    ('Europe/Paris', 'workspace-1', 1, 1000),
                    ('America/New_York', 'workspace-2', 1, 2000),
                    ('Asia/Tokyo', 'workspace-with-empty-history', 0, 3000)
                """.trimIndent()
            )
        }
    }
}
