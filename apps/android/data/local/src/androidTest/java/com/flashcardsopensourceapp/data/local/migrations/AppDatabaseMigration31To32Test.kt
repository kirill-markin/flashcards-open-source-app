package com.flashcardsopensourceapp.data.local.migrations

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.database.migrations.createAppDatabaseMigrations
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith

private const val migration31To32DatabaseName = "migration-31-to-32-test.db"

@RunWith(AndroidJUnit4::class)
class AppDatabaseMigration31To32Test {
    @After
    fun tearDown() {
        deleteMigrationDatabaseFixture(
            context = ApplicationProvider.getApplicationContext(),
            databaseName = migration31To32DatabaseName
        )
    }

    @Test
    fun freshInstallCreatesVersion32WithNullableInsights() {
        withDatabase { database ->
            val sqliteDatabase = database.openHelper.writableDatabase
            assertEquals(32, sqliteDatabase.version)
            sqliteDatabase.query("PRAGMA table_info(progress_summary_cache)").use { cursor ->
                val nameIndex = cursor.getColumnIndexOrThrow("name")
                val columns = buildList {
                    while (cursor.moveToNext()) {
                        if (cursor.getString(nameIndex) == "insightsJson") {
                            add(cursor.getString(cursor.getColumnIndexOrThrow("type")))
                            assertEquals(0, cursor.getInt(cursor.getColumnIndexOrThrow("notnull")))
                        }
                    }
                }
                assertEquals(listOf("TEXT"), columns)
            }
        }
    }

    @Test
    fun upgrade31To32PreservesCachedSummaryAndPersistsInsights() {
        withDatabase { fixture ->
            val sqliteDatabase = fixture.openHelper.writableDatabase
            sqliteDatabase.execSQL("ALTER TABLE progress_summary_cache DROP COLUMN insightsJson")
            sqliteDatabase.execSQL(
                """
                INSERT INTO progress_summary_cache (
                    scopeKey, scopeId, timeZone, generatedAt, reviewHistoryWatermarksJson,
                    currentStreakDays, longestStreakDays, hasReviewedToday, lastReviewedOn,
                    activeReviewDays, streakFreezeAvailableCredits, streakFreezeCapacity,
                    streakFreezeBalanceUnits, streakFreezeUnitsPerCredit,
                    streakFreezeEarnedUnitsPerStreakDay, streakFreezeNextCreditProgressUnits,
                    streakFreezeNextCreditRequiredUnits, updatedAtMillis
                ) VALUES ('scope-1', 'local:installation-1', 'Europe/Copenhagen', NULL, '[]',
                    4, 7, 1, '2026-11-16', 12, 1, 2, 1, 1, 1, 0, 1, 1000)
                """.trimIndent()
            )
            sqliteDatabase.version = 31
        }

        // Room opens and validates the complete migrated schema, not just the added column.
        withDatabase { database ->
            val sqliteDatabase = database.openHelper.writableDatabase
            assertEquals(32, sqliteDatabase.version)
            sqliteDatabase.query(
                "SELECT currentStreakDays, longestStreakDays, updatedAtMillis, insightsJson " +
                    "FROM progress_summary_cache WHERE scopeKey = 'scope-1'"
            ).use { cursor ->
                assertEquals(true, cursor.moveToFirst())
                assertEquals(4, cursor.getInt(0))
                assertEquals(7, cursor.getInt(1))
                assertEquals(1000L, cursor.getLong(2))
                assertNull(cursor.getString(3))
            }
            sqliteDatabase.execSQL(
                "UPDATE progress_summary_cache SET insightsJson = ? WHERE scopeKey = 'scope-1'",
                arrayOf("{\"totalReviews\":42}")
            )
        }

        withDatabase { database ->
            assertEquals(
                "{\"totalReviews\":42}",
                readMigrationSingleString(
                    database = database.openHelper.writableDatabase,
                    sql = "SELECT insightsJson FROM progress_summary_cache WHERE scopeKey = 'scope-1'"
                )
            )
        }
    }

    private fun withDatabase(block: (AppDatabase) -> Unit) {
        val database = openDatabase()
        try {
            block(database)
        } finally {
            database.close()
        }
    }

    private fun openDatabase(): AppDatabase {
        return Room.databaseBuilder(
            context = ApplicationProvider.getApplicationContext<Context>(),
            klass = AppDatabase::class.java,
            name = migration31To32DatabaseName
        ).addMigrations(*createAppDatabaseMigrations()).build()
    }
}
