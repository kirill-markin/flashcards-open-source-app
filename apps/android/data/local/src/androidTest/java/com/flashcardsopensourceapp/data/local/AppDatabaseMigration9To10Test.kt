package com.flashcardsopensourceapp.data.local

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.sqlite.db.SupportSQLiteOpenHelper
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.database.migrations.migration9To10
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

private const val migration9To10DatabaseName: String = "migration-9-to-10-test.db"

@RunWith(AndroidJUnit4::class)
class AppDatabaseMigration9To10Test {
    @After
    fun tearDown(): Unit {
        val context: Context = ApplicationProvider.getApplicationContext()
        deleteMigrationDatabaseFixture(
            context = context,
            databaseName = migration9To10DatabaseName
        )
    }

    @Test
    fun migrationFromVersion9SplitsProgressSnapshotCacheIntoSummaryAndSeriesTables(): Unit {
        val context: Context = ApplicationProvider.getApplicationContext()
        createVersion9Database(context = context)

        val openHelper: SupportSQLiteOpenHelper = openMigrationDatabaseAtVersion(
            context = context,
            databaseName = migration9To10DatabaseName,
            version = 9
        )
        val database: SupportSQLiteDatabase = openHelper.writableDatabase

        try {
            migration9To10.migrate(database)

            assertTrue(migrationTableExists(database = database, tableName = "progress_summary_cache"))
            assertTrue(migrationTableExists(database = database, tableName = "progress_series_cache"))
            assertFalse(migrationTableExists(database = database, tableName = "progress_snapshot_cache"))
            assertEquals(
                0L,
                readMigrationSingleLong(
                    database = database,
                    sql = "SELECT COUNT(*) FROM progress_summary_cache"
                )
            )
            assertEquals(
                1L,
                readMigrationSingleLong(
                    database = database,
                    sql = "SELECT COUNT(*) FROM progress_series_cache"
                )
            )
            assertEquals(
                "scope-1",
                readMigrationSingleStringByScopeKey(
                    database = database,
                    tableName = "progress_series_cache",
                    columnName = "scopeKey",
                    scopeKey = "scope-1"
                )
            )
            assertEquals(
                "local:installation-1",
                readMigrationSingleStringByScopeKey(
                    database = database,
                    tableName = "progress_series_cache",
                    columnName = "scopeId",
                    scopeKey = "scope-1"
                )
            )
            assertEquals(
                "Europe/Madrid",
                readMigrationSingleStringByScopeKey(
                    database = database,
                    tableName = "progress_series_cache",
                    columnName = "timeZone",
                    scopeKey = "scope-1"
                )
            )
            assertEquals(
                "2026-04-17",
                readMigrationSingleStringByScopeKey(
                    database = database,
                    tableName = "progress_series_cache",
                    columnName = "fromLocalDate",
                    scopeKey = "scope-1"
                )
            )
            assertEquals(
                "2026-04-18",
                readMigrationSingleStringByScopeKey(
                    database = database,
                    tableName = "progress_series_cache",
                    columnName = "toLocalDate",
                    scopeKey = "scope-1"
                )
            )
            assertEquals(
                "2026-04-18T12:00:00Z",
                readMigrationSingleStringByScopeKey(
                    database = database,
                    tableName = "progress_series_cache",
                    columnName = "generatedAt",
                    scopeKey = "scope-1"
                )
            )
            assertEquals(
                "[{\"date\":\"2026-04-17\",\"reviewCount\":3},{\"date\":\"2026-04-18\",\"reviewCount\":1}]",
                readMigrationSingleStringByScopeKey(
                    database = database,
                    tableName = "progress_series_cache",
                    columnName = "dailyReviewsJson",
                    scopeKey = "scope-1"
                )
            )
            assertEquals(
                123L,
                readMigrationSingleLongByScopeKey(
                    database = database,
                    tableName = "progress_series_cache",
                    columnName = "updatedAtMillis",
                    scopeKey = "scope-1"
                )
            )
        } finally {
            database.close()
            openHelper.close()
        }
    }

    private fun createVersion9Database(context: Context): Unit {
        createMigrationDatabaseFixture(
            context = context,
            databaseName = migration9To10DatabaseName,
            version = 9
        ) { sqliteDatabase: SQLiteDatabase ->
            sqliteDatabase.execSQL(
                "CREATE TABLE workspaces (workspaceId TEXT NOT NULL PRIMARY KEY, name TEXT NOT NULL, createdAtMillis INTEGER NOT NULL)"
            )
            sqliteDatabase.execSQL(
                """
                CREATE TABLE progress_snapshot_cache (
                    scopeKey TEXT NOT NULL PRIMARY KEY,
                    scopeId TEXT NOT NULL,
                    timeZone TEXT NOT NULL,
                    fromLocalDate TEXT NOT NULL,
                    toLocalDate TEXT NOT NULL,
                    generatedAt TEXT,
                    summaryCurrentStreakDays INTEGER,
                    summaryHasReviewedToday INTEGER,
                    summaryLastReviewedOn TEXT,
                    summaryActiveReviewDays INTEGER,
                    dailyReviewsJson TEXT NOT NULL,
                    updatedAtMillis INTEGER NOT NULL
                )
                """.trimIndent()
            )
            sqliteDatabase.execSQL(
                "INSERT INTO workspaces (workspaceId, name, createdAtMillis) VALUES ('workspace-local', 'Personal', 100)"
            )
            sqliteDatabase.execSQL(
                """
                INSERT INTO progress_snapshot_cache (
                    scopeKey,
                    scopeId,
                    timeZone,
                    fromLocalDate,
                    toLocalDate,
                    generatedAt,
                    summaryCurrentStreakDays,
                    summaryHasReviewedToday,
                    summaryLastReviewedOn,
                    summaryActiveReviewDays,
                    dailyReviewsJson,
                    updatedAtMillis
                ) VALUES (
                    'scope-1',
                    'local:installation-1',
                    'Europe/Madrid',
                    '2026-04-17',
                    '2026-04-18',
                    '2026-04-18T12:00:00Z',
                    4,
                    1,
                    '2026-04-18',
                    12,
                    '[{"date":"2026-04-17","reviewCount":3},{"date":"2026-04-18","reviewCount":1}]',
                    123
                )
                """.trimIndent()
            )
        }
    }
}
